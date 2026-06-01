import html2canvas from "html2canvas";
import type { DocxEditorRef } from "@eigenpal/docx-editor-react";
import type {
  DocSnapshot,
  DurableAnchor,
  EditorAdapter,
  ResolvedAnchor,
  SelectionSnapshot,
} from "./EditorAdapter";
import { normalizeText, previewText } from "./EditorAdapter";
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

  getSelectionSnapshot(): SelectionSnapshot | null {
    const info = this.ref.getSelectionInfo();
    if (!info || !info.selectedText) return null;
    return {
      text: info.selectedText,
      preview: previewText(info.selectedText),
      anchor: {
        kind: "docx",
        paraId: info.paraId ?? undefined,
        quote: info.selectedText,
        quoteNorm: normalizeText(info.selectedText),
      },
    };
  }

  onSelectionChange(cb: (snap: SelectionSnapshot | null) => void): () => void {
    return this.ref.onSelectionChange(() => cb(this.getSelectionSnapshot()));
  }

  async anchorTo(anchor: DurableAnchor): Promise<ResolvedAnchor | null> {
    if (anchor.kind !== "docx") return null;
    // 1) the model's paraId, if it still exists (scrollToParaId returns found?)
    if (anchor.paraId && this.ref.scrollToParaId(anchor.paraId)) {
      return { kind: "docx", paraId: anchor.paraId };
    }
    // 2) recover by searching the text
    const query = anchor.quote.trim();
    const hits = query ? (this.ref.findInDocument?.(query, { limit: 1 }) ?? []) : [];
    if (hits[0]) {
      this.ref.scrollToParaId(hits[0].paraId);
      return { kind: "docx", paraId: hits[0].paraId };
    }
    return null;
  }

  flashRange(target: ResolvedAnchor, ms = 1200): void {
    if (target.kind !== "docx") return;
    const editorRef = this.ref.getEditorRef();
    const view = editorRef?.getView();
    if (!editorRef || !view) return;

    let found: { from: number; to: number } | undefined;
    view.state.doc.descendants((node, pos) => {
      if (found) return false;
      if ((node.attrs as { paraId?: string })?.paraId === target.paraId) {
        found = { from: pos + 1, to: pos + node.nodeSize - 1 };
        return false;
      }
      return true;
    });
    if (!found) return;

    const range = found;
    editorRef.setSelection(range.from, range.to); // brief highlight via selection
    setTimeout(() => {
      try {
        editorRef.setSelection(range.from, range.from);
      } catch {
        /* view torn down */
      }
    }, ms);
  }

  async collectDoc(): Promise<DocSnapshot> {
    const buffer = await this.ref.save();
    return { docBase64: buffer ? bytesToBase64(new Uint8Array(buffer)) : "" };
  }

  async reload(result: DocSnapshot): Promise<void> {
    if (result.docBase64) await this.ref.loadDocumentBuffer(base64ToBytes(result.docBase64));
  }

  getPlainText(): string {
    const doc = this.ref.getEditorRef()?.getView()?.state.doc;
    return doc ? doc.textBetween(0, doc.content.size, "\n", "\n") : "";
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

