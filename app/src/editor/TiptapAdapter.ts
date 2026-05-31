import type { Editor } from "@tiptap/react";
import type { EditorAdapter, EditTarget, SelRange } from "./EditorAdapter";
import { extractContext } from "./context";
import { pendingKey } from "./PendingHighlight";

/** Adapts a Tiptap (markdown) editor to the inline-edit engine. */
export class TiptapAdapter implements EditorAdapter {
  readonly kind = "markdown" as const;

  constructor(private readonly editor: Editor) {}

  captureSelection(): EditTarget | null {
    const { from, to } = this.editor.state.selection;
    if (from === to) return null;

    const text = this.editor.state.doc.textBetween(from, to, "\n", " ");
    const coords = this.editor.view.coordsAtPos(from);
    return {
      range: { from, to },
      text,
      context: extractContext(this.editor, from, to),
      anchor: { x: coords.left, y: coords.bottom },
    };
  }

  applyReplacement(range: SelRange, text: string): void {
    this.editor
      .chain()
      .focus()
      .insertContentAt({ from: range.from, to: range.to }, text)
      .run();
  }

  setPending(range: SelRange | null): void {
    this.editor.view.dispatch(this.editor.state.tr.setMeta(pendingKey, range));
  }

  docContext() {
    const ctx = extractContext(this.editor, 0, 0);
    return { title: ctx.title, outline: ctx.outline };
  }

  onSelectionChange(cb: (text: string) => void): () => void {
    const handler = () => {
      const { from, to } = this.editor.state.selection;
      cb(from === to ? "" : this.editor.state.doc.textBetween(from, to, "\n", " "));
    };
    this.editor.on("selectionUpdate", handler);
    return () => this.editor.off("selectionUpdate", handler);
  }

  focus(): void {
    this.editor.commands.focus();
  }
}
