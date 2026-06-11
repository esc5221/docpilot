/**
 * server — a tiny local HTTP server (127.0.0.1 only) exposing the agent over
 * SSE. The Rust shell spawns this, reads the `ready` handshake from stdout to
 * learn the port + bearer token, and hands them to the frontend. The frontend
 * then streams directly from here, so Rust never relays tokens.
 *
 * Built on Node's `http` so the same code runs under `node` (we avoid the Bun
 * runtime because its readline shim yields a spurious trailing value that
 * breaks the Codex SDK's JSONL parser).
 *
 * CORS: the webview origin (http://localhost:1420 in dev, tauri://localhost in
 * prod) is cross-origin to 127.0.0.1, and the bearer/JSON request triggers a
 * preflight. We answer OPTIONS and tag every response so the fetch isn't
 * blocked. Binding to 127.0.0.1 + a per-launch token is the real guard.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type {
  AgentEditRequest,
  ChatRequest,
  EditRequest,
  PlanRequest,
} from "../../packages/shared/src/index";
import { chat, edit } from "./codexHost";
import { plan } from "./planHost";
import { agentEdit } from "./agentHost";

interface ServeConfig {
  port: number;
  token: string;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function pipeSse(res: ServerResponse, stream: AsyncGenerator<unknown>): Promise<void> {
  res.writeHead(200, {
    ...CORS,
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  try {
    for await (const event of stream) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
  } finally {
    res.end();
  }
}

/** Aborts when the client disconnects mid-stream (Stop button / closed app). */
function disconnectSignal(res: ServerResponse): AbortSignal {
  const ac = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) ac.abort();
  });
  return ac.signal;
}

export interface RunningServer {
  port: number;
  close: () => void;
}

export function serve({ port, token }: ServeConfig): Promise<RunningServer> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    // CORS preflight.
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    if (url.pathname === "/health") {
      res.writeHead(200, { ...CORS, "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Everything else requires the bearer token.
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, CORS);
      res.end("unauthorized");
      return;
    }

    if (req.method === "POST" && url.pathname === "/edit") {
      const payload = JSON.parse(await readBody(req)) as EditRequest;
      await pipeSse(res, edit(payload, disconnectSignal(res)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/chat") {
      const payload = JSON.parse(await readBody(req)) as ChatRequest;
      await pipeSse(res, chat(payload, disconnectSignal(res)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/plan") {
      const payload = JSON.parse(await readBody(req)) as PlanRequest;
      await pipeSse(res, plan(payload));
      return;
    }

    if (req.method === "POST" && url.pathname === "/agent-edit") {
      const payload = JSON.parse(await readBody(req)) as AgentEditRequest;
      await pipeSse(res, agentEdit(payload, disconnectSignal(res)));
      return;
    }

    res.writeHead(404, CORS);
    res.end("not found");
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({ port: boundPort, close: () => server.close() });
    });
  });
}
