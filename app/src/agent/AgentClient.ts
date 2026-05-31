import { invoke } from "@tauri-apps/api/core";
import type {
  AgentEditRequest,
  AgentEditStreamEvent,
  ChatRequest,
  ChatStreamEvent,
  EditRequest,
  EditStreamEvent,
} from "@docpilot/shared";

interface SidecarInfo {
  port: number;
  token: string;
}

/**
 * The frontend's single point of contact with the agent sidecar. Streams SSE
 * events straight from the local HTTP server — Rust is not in the hot path.
 */
export class AgentClient {
  private constructor(
    private readonly port: number,
    private readonly token: string,
  ) {}

  /** Resolve sidecar connection details from the Rust shell exactly once. */
  static async connect(): Promise<AgentClient> {
    const info = await invoke<SidecarInfo>("sidecar_info");
    return new AgentClient(info.port, info.token);
  }

  edit(req: EditRequest, signal?: AbortSignal): AsyncGenerator<EditStreamEvent> {
    return this.stream<EditStreamEvent>("/edit", req, signal);
  }

  chat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    return this.stream<ChatStreamEvent>("/chat", req, signal);
  }

  agentEdit(req: AgentEditRequest, signal?: AbortSignal): AsyncGenerator<AgentEditStreamEvent> {
    return this.stream<AgentEditStreamEvent>("/agent-edit", req, signal);
  }

  private async *stream<T>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): AsyncGenerator<T> {
    const res = await fetch(`http://127.0.0.1:${this.port}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`sidecar ${path} failed: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        yield JSON.parse(line.slice(5).trim()) as T;
      }
    }
  }
}
