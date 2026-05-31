/**
 * Sidecar entrypoint.
 *
 * Config comes from env (set by the Rust shell):
 *   DOCPILOT_PORT   — port to bind, or 0 / unset for an ephemeral port
 *   DOCPILOT_TOKEN  — bearer token the frontend must present
 *
 * On startup we print exactly one JSON handshake line to stdout so the shell
 * can learn the actual bound port and token:
 *   {"type":"ready","port":51234,"token":"..."}
 */

import type { SidecarReady } from "../../packages/shared/src/index";
import { serve } from "./server";

function genToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

const requestedPort = Number(process.env.DOCPILOT_PORT ?? 0) || 0;
const token = process.env.DOCPILOT_TOKEN || genToken();

const server = await serve({ port: requestedPort, token });

const ready: SidecarReady = { type: "ready", port: server.port, token };
console.log(JSON.stringify(ready));

function shutdown() {
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
