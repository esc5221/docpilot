import { diffLines } from "diff";

export interface DiffPart {
  kind: "add" | "del";
  text: string;
}

/**
 * A compact line diff of before → after: only the changed lines (additions and
 * deletions), unchanged context dropped. Good for a chat-panel change summary.
 * Returns [] when nothing changed.
 */
export function computeDiff(before: string, after: string): DiffPart[] {
  if (before === after) return [];
  const out: DiffPart[] = [];
  for (const part of diffLines(before, after)) {
    if (part.added) out.push({ kind: "add", text: part.value.replace(/\n+$/, "") });
    else if (part.removed) out.push({ kind: "del", text: part.value.replace(/\n+$/, "") });
  }
  return out;
}
