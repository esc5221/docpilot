import type { DocContext } from "@docpilot/shared";

/** A snapshot of the document for agentic editing (one of text / docBase64). */
export interface DocSnapshot {
  text?: string;
  docBase64?: string;
}

/**
 * The single contract the rest of the app depends on for an open document.
 * Markdown (Tiptap) and DOCX (eigenpal docx-editor) each provide one, so adding
 * a format is "write one adapter" — nothing upstream changes.
 */
export interface EditorAdapter {
  readonly kind: "markdown" | "docx";

  /** Title + outline grounding for the chat panel. */
  docContext(): DocContext;

  /**
   * Subscribe to selection changes. The callback receives the selected text
   * (empty when the selection collapses). Returns an unsubscribe fn.
   */
  onSelectionChange(cb: (text: string) => void): () => void;

  /** Snapshot the current document to hand to the agentic editor. */
  collectDoc(): Promise<DocSnapshot>;

  /** The document as plain text with line breaks — for before/after diffing. */
  getPlainText(): string;

  /** Load an edited document back into the editor. */
  reload(result: DocSnapshot): Promise<void>;

  /** Capture the current page as a PNG (base64, no data-URL prefix) for vision. */
  capturePageImage?(): Promise<string | null>;

  focus(): void;
}
