import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { DocxEditor, type DocxEditorRef, LocaleProvider } from "@eigenpal/docx-editor-react";
import "@eigenpal/docx-editor-react/styles.css";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { useResizablePanel } from "./ui/useResizablePanel";
import { buildExtensions } from "./editor/extensions";
import { TiptapAdapter } from "./editor/TiptapAdapter";
import { DocxAdapter } from "./editor/DocxAdapter";
import type { EditorAdapter } from "./editor/EditorAdapter";
import { ChatPanel } from "./chat/ChatPanel";
import { useDocumentStore } from "./documents/documentStore";
import { useSelectionStore } from "./state/selectionStore";
import {
  loadDocumentFromPath,
  openDocument,
  saveDocx,
  saveMarkdown,
  saveMarkdownAs,
} from "./documents/fileBridge";
import { logToShell } from "./diagnostics";

function basename(path: string | null): string {
  if (!path) return "Untitled";
  return path.split(/[\\/]/).pop() ?? path;
}

export default function App() {
  const { path, kind, dirty, openDoc, setDirty, setPath } = useDocumentStore();

  // Markdown editor (always instantiated; shown only in markdown mode).
  const editor = useEditor({
    extensions: buildExtensions(),
    content: "",
    onUpdate: () => setDirty(true),
  });

  // DOCX editor handle (stable callback ref — an inline ref re-attaches every
  // render and triggers an infinite setState loop).
  const docxRef = useRef<DocxEditorRef | null>(null);
  const [docxReady, setDocxReady] = useState(false);
  const [docxBuffer, setDocxBuffer] = useState<Uint8Array | null>(null);
  const setDocxRef = useCallback((r: DocxEditorRef | null) => {
    docxRef.current = r;
    setDocxReady(r != null);
  }, []);

  // The active adapter the inline-edit engine + chat operate through.
  const adapter: EditorAdapter | null = useMemo(() => {
    if (kind === "docx") {
      return docxReady && docxRef.current ? new DocxAdapter(docxRef.current) : null;
    }
    return editor ? new TiptapAdapter(editor) : null;
  }, [kind, docxReady, editor]);

  const panel = useResizablePanel({ initial: 384, min: 300, max: 680, storageKey: "dp.panelWidth" });

  // Mirror the editor's selection into the chat context store (Cursor-style).
  useEffect(() => {
    if (!adapter) return;
    return adapter.onSelectionChange((text) => {
      if (text.trim()) useSelectionStore.getState().set(text);
    });
  }, [adapter]);

  const applyLoaded = useCallback(
    (doc: Awaited<ReturnType<typeof openDocument>>) => {
      if (!doc) return;
      useSelectionStore.getState().clear();
      if (doc.kind === "markdown") {
        editor?.commands.setContent(doc.content, false);
        setDocxBuffer(null);
        openDoc(doc.path, "markdown", doc.threadId);
      } else {
        setDocxBuffer(doc.bytes);
        openDoc(doc.path, "docx", doc.threadId);
      }
    },
    [editor, openDoc],
  );

  const handleOpen = useCallback(async () => {
    applyLoaded(await openDocument());
  }, [applyLoaded]);

  // Dev-only: auto-open a file path (VITE_AUTOOPEN). No-op in normal use.
  useEffect(() => {
    const autoPath = import.meta.env.VITE_AUTOOPEN as string | undefined;
    if (!autoPath || !editor) return;
    void loadDocumentFromPath(autoPath).then(applyLoaded).catch((e) => logToShell("autoopen: " + e));
  }, [editor, applyLoaded]);

  const handleSave = useCallback(async () => {
    if (kind === "docx") {
      if (!docxRef.current || !path) return;
      const buffer = await docxRef.current.save();
      if (buffer) await saveDocx(path, new Uint8Array(buffer));
      setDirty(false);
      return;
    }
    if (!editor) return;
    const md = editor.storage.markdown.getMarkdown();
    if (path) {
      await saveMarkdown(path, md);
      setDirty(false);
    } else {
      const newPath = await saveMarkdownAs(md);
      if (newPath) {
        setPath(newPath);
        setDirty(false);
      }
    }
  }, [kind, editor, path, setDirty, setPath]);

  // Global shortcut: ⌘S save.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  return (
    <div className="dp-root">
      <header className="dp-toolbar">
        <div className="dp-brand">docpilot</div>
        <div className="dp-title">
          {basename(path)}
          {dirty && <span className="dp-dot" title="Unsaved" />}
        </div>
        <div className="dp-tools">
          <button className="dp-btn" onClick={() => void handleOpen()}>
            Open
          </button>
          <button className="dp-btn dp-primary" onClick={() => void handleSave()}>
            Save
          </button>
        </div>
      </header>

      <main className="dp-main">
        <section className="dp-editor-wrap" data-kind={kind}>
          {kind === "docx" ? (
            <ErrorBoundary label="docx editor">
              <LocaleProvider>
                <DocxEditor
                  ref={setDocxRef}
                  documentBuffer={docxBuffer}
                  showToolbar
                  className="dp-docx"
                  onChange={() => setDirty(true)}
                  onError={(e) => logToShell("DocxEditor.onError: " + e.message)}
                />
              </LocaleProvider>
            </ErrorBoundary>
          ) : (
            <div className="dp-paper">
              <EditorContent editor={editor} />
            </div>
          )}
        </section>

        <div
          className="dp-resizer"
          data-active={panel.active}
          onMouseDown={panel.onMouseDown}
        />

        <aside className="dp-chat" style={{ width: panel.width }}>
          <ChatPanel adapter={adapter} />
        </aside>
      </main>
    </div>
  );
}
