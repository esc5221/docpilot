import type { DocSnapshot } from "../editor/EditorAdapter";

/**
 * In-memory snapshots taken before each AI edit, keyed by a short id stored on
 * the chat message. Kept out of persisted sessions (docx bytes would bloat the
 * JSON), so revert works within a run but not across restarts — which is fine.
 */
const snapshots = new Map<string, DocSnapshot>();

export function stashSnapshot(snap: DocSnapshot): string {
  const id = crypto.randomUUID();
  snapshots.set(id, snap);
  return id;
}

export function takeSnapshot(id: string): DocSnapshot | undefined {
  return snapshots.get(id);
}

export function hasSnapshot(id: string): boolean {
  return snapshots.has(id);
}
