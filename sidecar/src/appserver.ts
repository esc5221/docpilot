/**
 * appserver — a thin JSON-RPC client for `codex app-server`.
 *
 * Why app-server instead of `codex exec --experimental-json`: exec only emits a
 * single `item.completed` with the whole assistant message, so there is no real
 * token streaming. The app-server protocol emits `item/agentMessage/delta`
 * notifications, giving true token-by-token output. Sessions + prompt caching
 * are preserved via `thread/start` / `thread/resume` (threads persist under
 * ~/.codex/sessions, same as before).
 *
 * One long-lived app-server process per sidecar. Turns are correlated to their
 * thread by `threadId` on every notification.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import readline from "node:readline";

const require = createRequire(import.meta.url);

/**
 * Resolve the codex launcher. In production the Rust shell points us at the
 * user's system codex via DOCPILOT_CODEX (we don't bundle the native binary).
 * In dev we fall back to the arch-agnostic launcher shipped with @openai/codex.
 */
function codexLauncher(): { cmd: string; args: string[] } {
  const sys = process.env.DOCPILOT_CODEX;
  if (sys) return { cmd: sys, args: ["app-server"] };
  const js = require.resolve("@openai/codex/bin/codex.js");
  return { cmd: process.execPath, args: [js, "app-server"] };
}

export interface TurnUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export type CommandStatus = "running" | "done" | "failed";

/** What `runTurn` streams back to the caller. */
export type TurnEvent =
  | { kind: "session"; threadId: string }
  | { kind: "delta"; text: string }
  /** A shell command the agent ran (tool call), keyed by item id. */
  | { kind: "command"; id: string; command: string; status: CommandStatus }
  /** Streamed reasoning summary (the agent's "thinking"). */
  | { kind: "reasoning"; text: string }
  | { kind: "final"; text: string; usage?: TurnUsage };

interface TurnHandler {
  onDelta: (text: string) => void;
  onCommand: (id: string, command: string, status: CommandStatus) => void;
  onReasoning: (text: string) => void;
  onFinal: (text: string) => void;
  onUsage: (usage: TurnUsage) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

interface ThreadOpts {
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
  /** Working directory for the turn (used by agentic file edits). */
  cwd?: string;
}

interface RunTurnArgs {
  /** Existing thread id to resume; omit to start a new thread. */
  sessionId?: string;
  prompt: string;
  /** Optional JSON Schema to constrain the final assistant message. */
  outputSchema?: unknown;
  /** Per-turn thread options (sandbox, cwd). Defaults to read-only. */
  threadOpts?: ThreadOpts;
  /** Absolute paths of images to attach to the turn (Codex vision). */
  imagePaths?: string[];
}

const DEFAULT_THREAD_OPTS: ThreadOpts = { sandbox: "read-only", approvalPolicy: "never" };

export class AppServer {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  /** One active turn handler per thread id. */
  private handlers = new Map<string, TurnHandler>();
  private ready: Promise<void>;

  constructor() {
    const { cmd, args } = codexLauncher();
    this.child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
    readline.createInterface({ input: this.child.stdout }).on("line", (line) => this.onLine(line));
    this.child.stderr.on("data", (d) => {
      const s = String(d).trim();
      if (s) console.error("[app-server]", s.slice(0, 400));
    });
    this.child.on("exit", (code) => console.error("[app-server] exited", code));
    // Don't orphan the app-server when the sidecar dies.
    process.once("exit", () => {
      try {
        this.child.kill();
      } catch {
        /* already gone */
      }
    });
    this.ready = this.initialize();
  }

  private write(obj: unknown) {
    this.child.stdin.write(JSON.stringify(obj) + "\n");
  }

  private rpc<T = any>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: unknown) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private async initialize() {
    await this.rpc("initialize", {
      clientInfo: { name: "docpilot-sidecar", title: null, version: "0.1.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.notify("initialized", {});
  }

  private onLine(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    // JSON-RPC response.
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }

    // Notification — route to the owning thread's turn handler.
    const params = msg.params ?? {};
    const h = params.threadId ? this.handlers.get(params.threadId) : undefined;
    if (!h) return;
    switch (msg.method) {
      case "item/agentMessage/delta":
        h.onDelta(params.delta ?? "");
        break;
      case "item/reasoning/summaryTextDelta":
        h.onReasoning(params.delta ?? "");
        break;
      case "item/started":
      case "item/updated":
      case "item/completed": {
        // app-server v2 item types are camelCase: commandExecution, agentMessage, fileChange.
        const it = params.item;
        if (it?.type === "commandExecution") {
          const status: CommandStatus =
            it.status === "failed" ? "failed" : it.status === "completed" ? "done" : "running";
          h.onCommand(it.id, it.command ?? "", status);
        } else if (it?.type === "fileChange" && msg.method === "item/completed") {
          for (const c of it.changes ?? []) {
            const name = String(c.path ?? "").split("/").pop() || "file";
            h.onCommand(`${it.id}:${name}`, `edit ${name}`, "done");
          }
        } else if (msg.method === "item/completed" && it?.type === "agentMessage") {
          h.onFinal(it.text ?? "");
        }
        break;
      }
      case "thread/tokenUsage/updated": {
        const last = params.tokenUsage?.last;
        if (last) {
          h.onUsage({
            inputTokens: last.inputTokens,
            cachedInputTokens: last.cachedInputTokens,
            outputTokens: last.outputTokens,
          });
        }
        break;
      }
      case "turn/completed":
        h.onDone();
        break;
      case "turn/failed":
        h.onError(params.turn?.error?.message ?? "turn failed");
        break;
    }
  }

  /** Resume `sessionId`, or start a fresh thread; returns the active thread id. */
  private async openThread(
    sessionId: string | undefined,
    opts: ThreadOpts,
  ): Promise<{ threadId: string; isNew: boolean }> {
    if (sessionId) {
      try {
        await this.rpc("thread/resume", { threadId: sessionId, ...opts });
        return { threadId: sessionId, isNew: false };
      } catch {
        // Thread gone / unloadable — fall through and start fresh.
      }
    }
    const res = await this.rpc<{ thread: { id: string } }>("thread/start", opts);
    return { threadId: res.thread.id, isNew: true };
  }

  /** Run one turn, streaming token deltas. */
  async *runTurn({
    sessionId,
    prompt,
    outputSchema,
    threadOpts,
    imagePaths,
  }: RunTurnArgs): AsyncGenerator<TurnEvent> {
    await this.ready;
    const { threadId, isNew } = await this.openThread(sessionId, threadOpts ?? DEFAULT_THREAD_OPTS);
    if (isNew) yield { kind: "session", threadId };

    // Bridge push-based notifications into this pull-based generator.
    type QueueItem = Exclude<TurnEvent, { kind: "session" | "final" }> | { kind: "_end" };
    const queue: QueueItem[] = [];
    let wake: (() => void) | null = null;
    let acc = "";
    let finalText: string | null = null;
    let usage: TurnUsage | undefined;
    let error: string | null = null;

    const push = (item: QueueItem) => {
      queue.push(item);
      wake?.();
      wake = null;
    };

    this.handlers.set(threadId, {
      onDelta: (t) => {
        acc += t;
        push({ kind: "delta", text: t });
      },
      onCommand: (id, command, status) => push({ kind: "command", id, command, status }),
      onReasoning: (text) => push({ kind: "reasoning", text }),
      onFinal: (t) => {
        finalText = t;
      },
      onUsage: (u) => {
        usage = u;
      },
      onDone: () => push({ kind: "_end" }),
      onError: (m) => {
        error = m;
        push({ kind: "_end" });
      },
    });

    const input: unknown[] = [{ type: "text", text: prompt, text_elements: [] }];
    for (const path of imagePaths ?? []) input.push({ type: "localImage", path });
    this.rpc("turn/start", { threadId, input, ...(outputSchema ? { outputSchema } : {}) }).catch(
      (e) => {
        error = e instanceof Error ? e.message : String(e);
        push({ kind: "_end" });
      },
    );

    try {
      while (true) {
        if (queue.length === 0) await new Promise<void>((r) => (wake = r));
        const item = queue.shift()!;
        if (item.kind === "_end") break;
        yield item;
      }
    } finally {
      this.handlers.delete(threadId);
    }

    if (error) throw new Error(error);
    yield { kind: "final", text: finalText ?? acc, usage };
  }
}

/** Process-wide singleton — one app-server for the sidecar's lifetime. */
let instance: AppServer | null = null;
export function appServer(): AppServer {
  return (instance ??= new AppServer());
}
