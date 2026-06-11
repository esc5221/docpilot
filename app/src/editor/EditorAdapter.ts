import type { DocContext } from "@docpilot/shared";

/** A snapshot of the document for agentic editing (one of text / docBase64). */
export interface DocSnapshot {
  text?: string;
  docBase64?: string;
}

/**
 * A durable pointer to a region, designed to survive the document being
 * reloaded after an edit (positions shift). We anchor by content (quote +
 * surrounding context / paraId), not by raw position.
 */
export type DurableAnchor =
  | { kind: "docx"; paraId?: string; quote: string; quoteNorm: string }
  | {
      kind: "markdown";
      quote: string;
      quoteNorm: string;
      prefix: string;
      suffix: string;
      fromHint?: number;
      toHint?: number;
    };

/** The user's selection, captured for the chat context chip. */
export interface SelectionSnapshot {
  text: string;
  preview: string;
  anchor: DurableAnchor;
}

/** A re-resolved anchor in the *current* document, ready to scroll/flash. */
export type ResolvedAnchor =
  | { kind: "docx"; paraId: string }
  | { kind: "markdown"; from: number; to: number };

/** A live editing range in the current document (ProseMirror positions). */
export interface EditRange {
  from: number;
  to: number;
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

  /** Grounding (before/after window) for the current selection — inline edit. */
  selectionContext(): DocContext;

  /** The current selection as raw PM positions, or null when collapsed. */
  getSelectionRange(): EditRange | null;

  /** Replace a range with new content (markdown-aware where supported). */
  replaceRange(range: EditRange, text: string): void;

  /** Subscribe to selection changes (snapshot, or null when collapsed). */
  onSelectionChange(cb: (snap: SelectionSnapshot | null) => void): () => void;

  /** The current selection as a durable snapshot, or null. */
  getSelectionSnapshot(): SelectionSnapshot | null;

  /** Snapshot the current document to hand to the agentic editor. */
  collectDoc(): Promise<DocSnapshot>;

  /** The document as plain text with line breaks — for before/after diffing. */
  getPlainText(): string;

  /** Load an edited document back into the editor. */
  reload(result: DocSnapshot): Promise<void>;

  /** Re-resolve an anchor in the current doc and scroll to it. */
  anchorTo(anchor: DurableAnchor): Promise<ResolvedAnchor | null>;

  /** Briefly highlight a resolved region (~1.2s). */
  flashRange(target: ResolvedAnchor, ms?: number): void;

  /** Capture the current page as a PNG (base64, no data-URL prefix) for vision. */
  capturePageImage?(): Promise<string | null>;

  /** Heading outline for the sidebar; each entry can jump to its heading. */
  getOutline?(): Array<{ level: number; text: string; jump: () => void }>;

  // ── Find bar (optional per format) ─────────────────────────────────────
  /** All case-insensitive plain-text matches in the document. */
  findMatches?(query: string): ResolvedAnchor[];
  /** Paint matches (markdown decorations; docx may no-op). */
  highlightMatches?(matches: ResolvedAnchor[], activeIndex: number): void;
  clearMatches?(): void;
  /** Scroll a match into view without stealing the caret. */
  revealMatch?(match: ResolvedAnchor): void;

  focus(): void;
}

/** Collapse whitespace + trim — for tolerant content matching. */
export const normalizeText = (t: string): string => t.replace(/\s+/g, " ").trim();

/** Short single-line preview for the context chip. */
export const previewText = (t: string, n = 42): string => {
  const s = normalizeText(t);
  return s.length > n ? s.slice(0, n) + "…" : s;
};
