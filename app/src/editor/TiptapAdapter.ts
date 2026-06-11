import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type {
  DocSnapshot,
  DurableAnchor,
  EditorAdapter,
  EditRange,
  ResolvedAnchor,
  SelectionSnapshot,
} from "./EditorAdapter";
import { normalizeText, previewText } from "./EditorAdapter";
import { extractContext } from "./context";
import { flashKey } from "./FlashHighlight";
import { searchKey } from "./SearchHighlight";

const CTX = 40; // chars of surrounding context captured for anchoring

/** Find an exact substring within any textblock; map to ProseMirror positions. */
function findText(doc: PMNode, needle: string): { from: number; to: number } | null {
  if (!needle) return null;
  let hit: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (hit) return false;
    if (!node.isTextblock) return true;
    const idx = node.textContent.indexOf(needle);
    if (idx >= 0) {
      const from = pos + 1 + idx;
      hit = { from, to: from + needle.length };
      return false;
    }
    return true;
  });
  return hit;
}

/** Adapts a Tiptap (markdown) editor to the app's editor contract. */
export class TiptapAdapter implements EditorAdapter {
  readonly kind = "markdown" as const;

  constructor(private readonly editor: Editor) {}

  docContext() {
    const ctx = extractContext(this.editor, 0, 0);
    return { title: ctx.title, outline: ctx.outline };
  }

  selectionContext() {
    const { from, to } = this.editor.state.selection;
    return extractContext(this.editor, from, to);
  }

  getSelectionRange(): EditRange | null {
    const { from, to } = this.editor.state.selection;
    return from === to ? null : { from, to };
  }

  replaceRange(range: EditRange, text: string): void {
    // tiptap-markdown patches insertContentAt to parse markdown (inline-aware),
    // so bold/lists/etc. in the replacement render instead of showing markup.
    this.editor.chain().focus().insertContentAt(range, text).run();
  }

  getSelectionSnapshot(): SelectionSnapshot | null {
    const { from, to } = this.editor.state.selection;
    if (from === to) return null;
    const doc = this.editor.state.doc;
    const text = doc.textBetween(from, to, "\n", " ");
    const prefix = doc.textBetween(Math.max(0, from - CTX), from, " ", " ");
    const suffix = doc.textBetween(to, Math.min(doc.content.size, to + CTX), " ", " ");
    return {
      text,
      preview: previewText(text),
      anchor: {
        kind: "markdown",
        quote: text,
        quoteNorm: normalizeText(text),
        prefix,
        suffix,
        fromHint: from,
        toHint: to,
      },
    };
  }

  onSelectionChange(cb: (snap: SelectionSnapshot | null) => void): () => void {
    const handler = () => cb(this.getSelectionSnapshot());
    this.editor.on("selectionUpdate", handler);
    return () => this.editor.off("selectionUpdate", handler);
  }

  async collectDoc(): Promise<DocSnapshot> {
    return { text: this.editor.storage.markdown.getMarkdown() };
  }

  getPlainText(): string {
    return this.editor.storage.markdown.getMarkdown();
  }

  async reload(result: DocSnapshot): Promise<void> {
    if (result.text != null) this.editor.commands.setContent(result.text, true);
  }

  async anchorTo(anchor: DurableAnchor): Promise<ResolvedAnchor | null> {
    if (anchor.kind !== "markdown") return null;
    const doc = this.editor.state.doc;
    const size = doc.content.size;

    let range: { from: number; to: number } | null = null;

    // 1) the exact quote (unchanged text — Ask, or an unedited region)
    range = findText(doc, anchor.quote);

    // 2) the surviving prefix → the edited region starts right after it
    if (!range && anchor.prefix.trim()) {
      const tail = anchor.prefix.trim().slice(-24);
      const pr = findText(doc, tail);
      if (pr) range = { from: pr.to, to: Math.min(size, pr.to + 1) };
    }

    // 3) fall back to the capture-time position, clamped
    if (!range && anchor.fromHint != null) {
      const from = Math.min(anchor.fromHint, size);
      range = { from, to: Math.min(anchor.toHint ?? from, size) };
    }
    if (!range) return null;

    this.editor.chain().setTextSelection(range).scrollIntoView().run();
    return { kind: "markdown", ...range };
  }

  flashRange(target: ResolvedAnchor, ms = 1200): void {
    if (target.kind !== "markdown") return;
    const view = this.editor.view;
    view.dispatch(view.state.tr.setMeta(flashKey, { from: target.from, to: target.to }));
    setTimeout(() => {
      try {
        view.dispatch(view.state.tr.setMeta(flashKey, null));
      } catch {
        /* view torn down */
      }
    }, ms);
  }

  getOutline(): Array<{ level: number; text: string; jump: () => void }> {
    const out: Array<{ level: number; text: string; jump: () => void }> = [];
    this.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading" && node.textContent.trim()) {
        out.push({
          level: (node.attrs.level as number) ?? 1,
          text: node.textContent.trim(),
          jump: () =>
            this.editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run(),
        });
      }
    });
    return out;
  }

  // ── Find bar ──────────────────────────────────────────────────────────

  findMatches(query: string): ResolvedAnchor[] {
    const needle = query.toLowerCase();
    if (!needle) return [];
    const out: ResolvedAnchor[] = [];
    this.editor.state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      const text = node.textContent.toLowerCase();
      let idx = text.indexOf(needle);
      while (idx >= 0) {
        const from = pos + 1 + idx;
        out.push({ kind: "markdown", from, to: from + needle.length });
        idx = text.indexOf(needle, idx + needle.length);
      }
      return false;
    });
    return out;
  }

  highlightMatches(matches: ResolvedAnchor[], activeIndex: number): void {
    const ranges = matches.flatMap((m) =>
      m.kind === "markdown" ? [{ from: m.from, to: m.to }] : [],
    );
    const view = this.editor.view;
    view.dispatch(view.state.tr.setMeta(searchKey, { ranges, activeIndex }));
  }

  clearMatches(): void {
    const view = this.editor.view;
    view.dispatch(view.state.tr.setMeta(searchKey, null));
  }

  revealMatch(match: ResolvedAnchor): void {
    if (match.kind !== "markdown") return;
    const dom = this.editor.view.domAtPos(match.from);
    const el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
    el?.scrollIntoView({ block: "center" });
  }

  focus(): void {
    this.editor.commands.focus();
  }
}
