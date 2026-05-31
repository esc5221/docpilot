import { AgentClient } from "./AgentClient";

let clientPromise: Promise<AgentClient> | null = null;

/** Lazily connect to the sidecar once and reuse the client everywhere. */
export function getAgent(): Promise<AgentClient> {
  return (clientPromise ??= AgentClient.connect());
}
