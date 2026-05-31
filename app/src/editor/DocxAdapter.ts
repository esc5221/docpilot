import type { DocxEditorRef } from "@eigenpal/docx-editor-react";
import type { EditorAdapter, EditTarget, SelRange } from "./EditorAdapter";

/**
 * Adapts the eigenpal docx-editor to the same inline-edit engine the markdown
 * path uses. It shares the prosemirror-* core with Tiptap, so positions and
 * transactions work identically — we just reach them through the docx ref.
 */
export class DocxAdapter implements EditorAdapter {
  readonly kind = "docx" as const;

  constructor(private readonly ref: DocxEditorRef) {}

  private view() {
    return this.ref.getEditorRef()?.getView() ?? null;
  }

  captureSelection(): EditTarget | null {
    const info = this.ref.getSelectionInfo();
    const view = this.view();
    if (!info || !info.selectedText || !view) return null;

    const { from, to } = view.state.selection;
    if (from === to) return null;

    const coords = view.coordsAtPos(from);
    return {
      range: { from, to },
      text: info.selectedText,
      context: {
        before: info.before || undefined,
        after: info.after || undefined,
      },
      anchor: { x: coords.left, y: coords.bottom },
    };
  }

  applyReplacement(range: SelRange, text: string): void {
    const view = this.view();
    if (!view) return;
    // Direct, undoable edit: replace the captured range with plain text.
    view.dispatch(view.state.tr.insertText(text, range.from, range.to));
    view.focus();
  }

  setPending(): void {
    // No in-editor highlight for docx yet; the popover diff carries the intent.
  }

  docContext() {
    // Grounding for chat is optional here; the message itself carries intent.
    return {};
  }

  onSelectionChange(cb: (text: string) => void): () => void {
    return this.ref.onSelectionChange(() => {
      cb(this.ref.getSelectionInfo()?.selectedText ?? "");
    });
  }

  focus(): void {
    this.ref.focus();
  }
}
