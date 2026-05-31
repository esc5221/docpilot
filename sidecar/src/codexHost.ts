/**
 * codexHost — the only place that talks to @openai/codex-sdk.
 *
 * Design notes:
 * - Stateless across requests. Each call resumes the thread from
 *   ~/.codex/sessions by id (or starts a fresh one), so the sidecar holds no
 *   session state of its own. Restart-safe by construction.
 * - Codex is driven as a *pure text transformer*: read-only sandbox, no
 *   approvals, no tools, no network. We only want rewritten text back.
 * - Streaming works by diffing the agent_message item's text as it grows.
 */

import { Codex, type Thread, type ThreadEvent, type ThreadOptions } from "@openai/codex-sdk";
import type {
  ChatRequest,
  ChatStreamEvent,
  DocContext,
  EditRequest,
  EditStreamEvent,
  TurnUsage,
} from "../../packages/shared/src/index";

/** Lock Codex down to "just rewrite the text I give you". */
const TEXT_ONLY_OPTIONS: ThreadOptions = {
  sandboxMode: "read-only",
  approvalPolicy: "never",
  skipGitRepoCheck: true,
  networkAccessEnabled: false,
  webSearchMode: "disabled",
};

const codex = new Codex();

function newThread(sessionId: string | undefined): Thread {
  return sessionId
    ? codex.resumeThread(sessionId, TEXT_ONLY_OPTIONS)
    : codex.startThread(TEXT_ONLY_OPTIONS);
}

function renderContext(ctx: DocContext): string {
  const parts: string[] = [];
  if (ctx.title) parts.push(`[DOCUMENT TITLE]\n${ctx.title}`);
  if (ctx.outline?.length) parts.push(`[OUTLINE]\n${ctx.outline.join("\n")}`);
  if (ctx.before) parts.push(`[TEXT BEFORE SELECTION]\n${ctx.before}`);
  if (ctx.after) parts.push(`[TEXT AFTER SELECTION]\n${ctx.after}`);
  return parts.join("\n\n");
}

function buildEditPrompt(req: EditRequest): string {
  return [
    "You are a precise in-document text editor, like Cursor but for prose.",
    "Rewrite ONLY the SELECTED TEXT according to the INSTRUCTION.",
    "",
    "Hard rules:",
    "- Output ONLY the rewritten selection. No preamble, no commentary,",
    "  no surrounding quotes, no markdown code fences.",
    "- Keep the original language unless the instruction says otherwise.",
    "- Preserve meaning unless the instruction explicitly asks to change it.",
    "- Match the surrounding style and formatting.",
    "- Never call tools, run commands, or read files. Answer directly.",
    "",
    renderContext(req.context),
    "",
    "[INSTRUCTION]",
    req.instruction,
    "",
    "[SELECTED TEXT]",
    req.selectedText,
  ].join("\n");
}

function buildChatPrompt(req: ChatRequest): string {
  const ctx = req.context ? renderContext(req.context) : "";
  return [
    "You are a helpful writing assistant inside a document editor.",
    "Answer concisely. Never call tools or run commands; answer directly.",
    ctx ? "\n" + ctx : "",
    req.selection ? `\n[SELECTED TEXT THE USER IS REFERRING TO]\n${req.selection}` : "",
    "\n[USER]",
    req.message,
  ].join("\n");
}

function toUsage(ev: Extract<ThreadEvent, { type: "turn.completed" }>): TurnUsage {
  return {
    inputTokens: ev.usage.input_tokens,
    cachedInputTokens: ev.usage.cached_input_tokens,
    outputTokens: ev.usage.output_tokens,
  };
}

/**
 * Core streaming loop shared by edit() and chat(). Yields:
 *   - { kind: "session", id }   once, for a freshly started thread
 *   - { kind: "delta", text }   incremental agent_message text
 *   - { kind: "final", text, usage }
 * Throws on a fatal stream error.
 */
async function* streamTurn(
  prompt: string,
  sessionId: string | undefined,
): AsyncGenerator<
  | { kind: "session"; id: string }
  | { kind: "delta"; text: string }
  | { kind: "final"; text: string; usage?: TurnUsage }
> {
  const thread = newThread(sessionId);
  const { events } = await thread.runStreamed(prompt);

  let emitted = ""; // text already sent as deltas
  let finalText = "";
  let usage: TurnUsage | undefined;

  for await (const ev of events) {
    switch (ev.type) {
      case "thread.started":
        if (!sessionId) yield { kind: "session", id: ev.thread_id };
        break;

      case "item.started":
      case "item.updated":
      case "item.completed": {
        const item = ev.item;
        if (item.type !== "agent_message") break; // ignore reasoning/tools
        const text = item.text ?? "";
        if (text.length > emitted.length) {
          yield { kind: "delta", text: text.slice(emitted.length) };
          emitted = text;
        }
        finalText = text;
        break;
      }

      case "turn.completed":
        usage = toUsage(ev);
        break;

      case "turn.failed":
        throw new Error(ev.error.message);

      case "error":
        throw new Error(ev.message);
    }
  }

  yield { kind: "final", text: finalText, usage };
}

/** Stream a surgical edit of a selection. */
export async function* edit(req: EditRequest): AsyncGenerator<EditStreamEvent> {
  try {
    for await (const e of streamTurn(buildEditPrompt(req), req.sessionId)) {
      if (e.kind === "session") yield { type: "session", sessionId: e.id };
      else if (e.kind === "delta") yield { type: "delta", text: e.text };
      else yield { type: "done", replacement: e.text.trim(), usage: e.usage };
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** Stream a side-panel chat reply. */
export async function* chat(req: ChatRequest): AsyncGenerator<ChatStreamEvent> {
  try {
    for await (const e of streamTurn(buildChatPrompt(req), req.sessionId)) {
      if (e.kind === "session") yield { type: "session", sessionId: e.id };
      else if (e.kind === "delta") yield { type: "delta", text: e.text };
      else yield { type: "done", reply: e.text, usage: e.usage };
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
