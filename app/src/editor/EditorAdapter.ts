import type { DocContext } from "@docpilot/shared";

/** ProseMirror document positions. Both Tiptap and docx-editor speak these. */
export interface SelRange {
  from: number;
  to: number;
}

/** A captured selection ready to be sent to the agent for editing. */
export interface EditTarget {
  range: SelRange;
  text: string;
  context: DocContext;
  /** Viewport anchor for the popover. */
  anchor: { x: number; y: number };
}

/**
 * The single contract the inline-edit engine depends on. Markdown (Tiptap) and
 * DOCX (eigenpal docx-editor) each provide one. The engine never touches a
 * concrete editor — only `EditTarget`s and `SelRange`s flow through it, so
 * adding a format is "write one adapter", nothing else changes.
 */
export interface EditorAdapter {
  readonly kind: "markdown" | "docx";

  /** Capture the current selection for a ⌘K edit, or null if none. */
  captureSelection(): EditTarget | null;

  /** Apply the rewrite to `range` as a single undoable operation. */
  applyReplacement(range: SelRange, text: string): void;

  /** Highlight (or clear) the range the AI is working on. May be a no-op. */
  setPending(range: SelRange | null): void;

  /** Title + outline grounding for the chat panel (no selection needed). */
  docContext(): DocContext;

  /**
   * Subscribe to selection changes. The callback receives the selected text
   * (empty string when the selection collapses). Returns an unsubscribe fn.
   */
  onSelectionChange(cb: (text: string) => void): () => void;

  focus(): void;
}
