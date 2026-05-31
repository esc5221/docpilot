import type { Editor } from "@tiptap/react";
import type { DocContext } from "@docpilot/shared";

/** How much surrounding text to send as grounding on each side of a selection. */
const WINDOW = 600;

/**
 * Build the grounding context for a selection: the document's title + heading
 * outline plus a bounded window of text before/after. Deliberately *not* the
 * whole document — keeps the prompt cache stable and the cost low.
 */
export function extractContext(editor: Editor, from: number, to: number): DocContext {
  const doc = editor.state.doc;

  const before = doc.textBetween(Math.max(0, from - WINDOW), from, "\n", " ");
  const after = doc.textBetween(to, Math.min(doc.content.size, to + WINDOW), "\n", " ");

  const outline: string[] = [];
  let title: string | undefined;
  doc.descendants((node) => {
    if (node.type.name === "heading") {
      const text = node.textContent.trim();
      if (!text) return;
      const level = (node.attrs.level as number) ?? 1;
      outline.push(`${"#".repeat(level)} ${text}`);
      if (!title) title = text;
    }
  });

  return {
    title,
    outline: outline.length ? outline : undefined,
    before: before.trim() || undefined,
    after: after.trim() || undefined,
  };
}
