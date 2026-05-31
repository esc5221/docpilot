import type { Editor } from "@tiptap/react";
import type { DocSnapshot, EditorAdapter } from "./EditorAdapter";
import { extractContext } from "./context";

/** Adapts a Tiptap (markdown) editor to the app's editor contract. */
export class TiptapAdapter implements EditorAdapter {
  readonly kind = "markdown" as const;

  constructor(private readonly editor: Editor) {}

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

  async collectDoc(): Promise<DocSnapshot> {
    return { text: this.editor.storage.markdown.getMarkdown() };
  }

  async reload(result: DocSnapshot): Promise<void> {
    if (result.text != null) this.editor.commands.setContent(result.text, true);
  }

  focus(): void {
    this.editor.commands.focus();
  }
}
