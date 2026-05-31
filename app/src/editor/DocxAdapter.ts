import html2canvas from "html2canvas";
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

  /** Screenshot the current page element (docx renders to DOM, not canvas). */
  async capturePageImage(): Promise<string | null> {
    const page = this.ref.getCurrentPage?.() ?? 1;
    const el =
      (document.querySelector(`[data-page-number="${page}"]`) as HTMLElement | null) ??
      (document.querySelector("[data-page-number]") as HTMLElement | null);
    if (!el) return null;
    try {
      const canvas = await html2canvas(el, { backgroundColor: "#ffffff", scale: 1.5, logging: false });
      return canvas.toDataURL("image/png").split(",")[1] ?? null;
    } catch {
      return null; // capture is best-effort; never block the message
    }
  }

  focus(): void {
    this.ref.focus();
  }
}

