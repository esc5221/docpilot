import type { DocxEditorRef } from "@eigenpal/docx-editor-react";
import type { DocSnapshot, EditorAdapter } from "./EditorAdapter";
import { base64ToBytes, bytesToBase64 } from "../util/base64";

/**
 * Adapts the eigenpal docx-editor to the app's editor contract. Snapshots go
 * through the editor's own save() (full-fidelity OOXML) and edits come back via
 * loadDocumentBuffer — so the agentic edit round-trips through the live engine.
 */
export class DocxAdapter implements EditorAdapter {
  readonly kind = "docx" as const;

  constructor(private readonly ref: DocxEditorRef) {}

  docContext() {
    // Grounding for chat is optional here; the message itself carries intent.
    return {};
  }

  onSelectionChange(cb: (text: string) => void): () => void {
    return this.ref.onSelectionChange(() => {
      cb(this.ref.getSelectionInfo()?.selectedText ?? "");
    });
  }

  async collectDoc(): Promise<DocSnapshot> {
    const buffer = await this.ref.save();
    return { docBase64: buffer ? bytesToBase64(new Uint8Array(buffer)) : "" };
  }

  async reload(result: DocSnapshot): Promise<void> {
    if (result.docBase64) await this.ref.loadDocumentBuffer(base64ToBytes(result.docBase64));
  }

  focus(): void {
    this.ref.focus();
  }
}
