import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { DocxEditor, type DocxEditorRef, LocaleProvider } from "@eigenpal/docx-editor-react";
import { Allotment } from "allotment";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { confirm } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import "@eigenpal/docx-editor-react/styles.css";
import "./design/docx-skin.css";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { buildExtensions } from "./editor/extensions";
import { TiptapAdapter } from "./editor/TiptapAdapter";
import { DocxAdapter } from "./editor/DocxAdapter";
import type { EditorAdapter } from "./editor/EditorAdapter";
import { BubbleMenuBar } from "./editor/BubbleMenuBar";
import { ChatPanel } from "./chat/ChatPanel";
import { SystemBanner } from "./system/SystemBanner";
import { WorkspaceSidebar } from "./workspace/WorkspaceSidebar";
import { TabBar } from "./ui/TabBar";
import { Welcome } from "./ui/Welcome";
import { StatusBar } from "./ui/StatusBar";
import { CommandPalette, type PaletteCommand } from "./ui/CommandPalette";
import { FindBar } from "./ui/FindBar";
import { ShortcutsHelp } from "./ui/ShortcutsHelp";
import { InlineEdit } from "./inline-edit/InlineEdit";
import { tabTitle, useDocumentStore } from "./documents/documentStore";
import { useSelectionStore } from "./state/selectionStore";
import { useLayoutStore } from "./state/layoutStore";
import { useRecentsStore } from "./state/recentsStore";
import { useThemeStore } from "./state/themeStore";
import { useUiStore } from "./state/uiStore";
import {
  type LoadedDocument,
  loadDocumentFromPath,
  openDocument,
  saveDocx,
  saveDocxAs,
  saveMarkdown,
  saveMarkdownAs,
} from "./documents/fileBridge";
import { logToShell } from "./diagnostics";

function basename(path: string | null): string {
  if (!path) return "Untitled";
  return path.split(/[\\/]/).pop() ?? path;
}

const OPENABLE = /\.(md|markdown|txt|docx)$/i;

export default function App() {
  const tabs = useDocumentStore((s) => s.tabs);
  const activeId = useDocumentStore((s) => s.activeId);
  const kind = useDocumentStore((s) => s.kind);
  const active = tabs.find((t) => t.id === activeId) ?? null;

  const { sizes, leftVisible, rightVisible, setSizes, toggleLeft, toggleRight } = useLayoutStore();
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const findOpen = useUiStore((s) => s.findOpen);
  const helpOpen = useUiStore((s) => s.helpOpen);
  const inlineEditNonce = useUiStore((s) => s.inlineEditNonce);

  // Bumps on every content change — drives word count / outline refresh.
  const [docVersion, setDocVersion] = useState(0);
  const bumpDoc = useCallback(() => setDocVersion((v) => v + 1), []);

  // Suppress dirty-marking for editor change events caused by programmatic loads.
  const loadGuardRef = useRef(0);
  const guardLoad = () => {
    loadGuardRef.current = Date.now();
  };
  const userChange = () => Date.now() - loadGuardRef.current > 800;

  // Markdown editor (always instantiated; shown only in markdown mode).
  const editor = useEditor({
    extensions: buildExtensions(),
    content: "",
    onUpdate: () => {
      if (userChange()) useDocumentStore.getState().setDirty(true);
      bumpDoc();
    },
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

  // The active adapter the chat + anchoring + inline edit operate through.
  const adapter: EditorAdapter | null = useMemo(() => {
    if (!active) return null;
    if (kind === "docx") {
      return docxReady && docxRef.current ? new DocxAdapter(docxRef.current) : null;
    }
    return editor ? new TiptapAdapter(editor) : null;
  }, [active, kind, docxReady, editor]);

  // Mirror the editor's selection into the chat context store (Cursor-style).
  useEffect(() => {
    if (!adapter) return;
    return adapter.onSelectionChange((snap) => {
      if (snap) useSelectionStore.getState().set(snap);
    });
  }, [adapter]);

  // ── Tab content lifecycle ──────────────────────────────────────────────────

  /** Which tab's content currently lives in the editor. */
  const loadedTabRef = useRef<string | null>(null);

  /** Park the active tab's live editor content into the store. */
  const parkActive = useCallback(async () => {
    const st = useDocumentStore.getState();
    const tab = st.tabs.find((t) => t.id === st.activeId);
    if (!tab || !tab.loaded || loadedTabRef.current !== tab.id) return;
    if (tab.kind === "markdown") {
      if (editor) st.park(tab.id, { mdContent: editor.storage.markdown.getMarkdown() });
    } else if (docxRef.current) {
      try {
        const buf = await docxRef.current.save();
        if (buf) st.park(tab.id, { docxBytes: new Uint8Array(buf) });
      } catch (e) {
        logToShell("park docx: " + e);
      }
    }
  }, [editor]);

  /** Apply a tab's parked content to the editors. */
  const applyTab = useCallback(
    (tab: { id: string; kind: string; mdContent: string | null; docxBytes: Uint8Array | null }) => {
      useSelectionStore.getState().clear();
      if (tab.kind === "markdown") {
        // setContent(…, false) emits no update event — no dirty guard needed.
        editor?.commands.setContent(tab.mdContent ?? "", false);
        setDocxBuffer(null);
      } else {
        // The docx engine fires onChange while parsing the loaded buffer.
        guardLoad();
        setDocxBuffer(tab.docxBytes ?? null);
      }
      loadedTabRef.current = tab.id;
      bumpDoc();
    },
    [editor, bumpDoc],
  );

  // Activation effect: when the active tab changes, materialize + apply it.
  useEffect(() => {
    if (!activeId || !editor) return;
    if (loadedTabRef.current === activeId) return;
    void (async () => {
      const st = useDocumentStore.getState();
      let tab = st.tabs.find((t) => t.id === activeId);
      if (!tab) return;
      if (!tab.loaded && tab.path) {
        try {
          const doc = await loadDocumentFromPath(tab.path);
          st.markLoaded(
            tab.id,
            doc.kind === "markdown" ? { mdContent: doc.content } : { docxBytes: doc.bytes },
          );
        } catch (e) {
          logToShell("load tab: " + e);
          st.markLoaded(tab.id, { mdContent: "" });
        }
        tab = useDocumentStore.getState().tabs.find((t) => t.id === activeId);
        if (!tab) return;
      }
      applyTab(tab);
    })();
  }, [activeId, editor, applyTab]);

  // Restore last session's tabs once the editor exists.
  useEffect(() => {
    if (editor) useDocumentStore.getState().restore();
  }, [editor]);

  // ── Document operations ────────────────────────────────────────────────────

  const openLoadedDoc = useCallback(
    async (doc: LoadedDocument | null) => {
      if (!doc) return;
      await parkActive();
      const st = useDocumentStore.getState();
      const id = st.openTab({
        path: doc.path,
        kind: doc.kind,
        threadId: doc.threadId,
        mdContent: doc.kind === "markdown" ? doc.content : null,
        docxBytes: doc.kind === "docx" ? doc.bytes : null,
      });
      const tab = useDocumentStore.getState().tabs.find((t) => t.id === id);
      if (tab) applyTab(tab);
      if (doc.path) {
        useRecentsStore.getState().add({ path: doc.path, name: basename(doc.path), kind: doc.kind });
      }
    },
    [parkActive, applyTab],
  );

  const handleOpen = useCallback(async () => {
    try {
      await openLoadedDoc(await openDocument());
    } catch (e) {
      logToShell("open: " + e);
    }
  }, [openLoadedDoc]);

  const handleOpenPath = useCallback(
    async (p: string) => {
      try {
        await openLoadedDoc(await loadDocumentFromPath(p));
      } catch (e) {
        logToShell("open " + e);
      }
    },
    [openLoadedDoc],
  );

  const handleNew = useCallback(async () => {
    await parkActive();
    const id = useDocumentStore.getState().newMarkdownTab();
    const tab = useDocumentStore.getState().tabs.find((t) => t.id === id);
    if (tab) applyTab(tab);
    editor?.commands.focus();
  }, [parkActive, applyTab, editor]);

  const switchTab = useCallback(
    async (id: string) => {
      if (id === useDocumentStore.getState().activeId) return;
      await parkActive();
      useDocumentStore.getState().activate(id);
    },
    [parkActive],
  );

  const closeTab = useCallback(async (id: string) => {
    const st = useDocumentStore.getState();
    const tab = st.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.dirty) {
      const ok = await confirm(`"${tabTitle(tab)}"에 저장하지 않은 변경이 있습니다. 닫을까요?`, {
        title: "docpilot",
        kind: "warning",
      });
      if (!ok) return;
    }
    if (loadedTabRef.current === id) loadedTabRef.current = null;
    st.closeTab(id);
  }, []);

  const cycleTab = useCallback(
    async (dir: 1 | -1) => {
      const st = useDocumentStore.getState();
      if (st.tabs.length < 2) return;
      const idx = st.tabs.findIndex((t) => t.id === st.activeId);
      const next = st.tabs[(idx + dir + st.tabs.length) % st.tabs.length];
      await switchTab(next.id);
    },
    [switchTab],
  );

  const handleSave = useCallback(
    async (saveAs = false) => {
      const st = useDocumentStore.getState();
      const tab = st.tabs.find((t) => t.id === st.activeId);
      if (!tab) return;

      if (tab.kind === "docx") {
        if (!docxRef.current) return;
        const buf = await docxRef.current.save();
        if (!buf) return;
        const bytes = new Uint8Array(buf);
        if (saveAs || !tab.path) {
          const p = await saveDocxAs(bytes, tab.path ? tabTitle(tab) : "untitled.docx");
          if (!p) return;
          st.setPath(p);
        } else {
          await saveDocx(tab.path, bytes);
        }
        st.park(tab.id, { docxBytes: bytes });
      } else {
        if (!editor) return;
        const md = editor.storage.markdown.getMarkdown();
        if (saveAs || !tab.path) {
          const p = await saveMarkdownAs(md, tab.path ? tabTitle(tab) : "untitled.md");
          if (!p) return;
          st.setPath(p);
        } else {
          await saveMarkdown(tab.path, md);
        }
        st.park(tab.id, { mdContent: md });
      }
      st.setDirty(false);
      const path = useDocumentStore.getState().path;
      if (path) {
        useRecentsStore.getState().add({ path, name: basename(path), kind: tab.kind });
      }
    },
    [editor],
  );

  // Dev-only: auto-open a file path (VITE_AUTOOPEN). No-op in normal use.
  useEffect(() => {
    const autoPath = import.meta.env.VITE_AUTOOPEN as string | undefined;
    if (!autoPath || !editor) return;
    void loadDocumentFromPath(autoPath)
      .then(openLoadedDoc)
      .catch((e) => logToShell("autoopen: " + e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // ── Window integration ─────────────────────────────────────────────────────

  // Title bar mirrors the active document.
  useEffect(() => {
    const title = active ? `${tabTitle(active)}${active.dirty ? " •" : ""} — docpilot` : "docpilot";
    void getCurrentWindow().setTitle(title).catch(() => {});
  }, [active]);

  // Quit guard: confirm when any tab has unsaved changes.
  useEffect(() => {
    const un = getCurrentWindow().onCloseRequested(async (event) => {
      await parkActive();
      const dirty = useDocumentStore.getState().tabs.filter((t) => t.dirty);
      if (!dirty.length) return;
      const ok = await confirm(
        `저장하지 않은 문서가 ${dirty.length}개 있습니다. 종료할까요?`,
        { title: "docpilot", kind: "warning" },
      );
      if (!ok) event.preventDefault();
    });
    return () => {
      void un.then((f) => f());
    };
  }, [parkActive]);

  // Drag & drop a file anywhere to open it.
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((event) => {
      const t = event.payload.type;
      if (t === "over" || t === "enter") setDragging(true);
      else if (t === "leave") setDragging(false);
      else if (t === "drop") {
        setDragging(false);
        for (const p of event.payload.paths) {
          if (OPENABLE.test(p)) void handleOpenPath(p);
        }
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, [handleOpenPath]);

  // Native menu events (File / View menus defined in the Rust shell). The
  // listener registers once and dispatches through a ref, so handler identity
  // churn (editor mounting, etc.) can never drop events mid-re-registration.
  const menuDispatchRef = useRef<(payload: string) => void>(() => {});
  menuDispatchRef.current = (payload) => {
    const ui = useUiStore.getState();
    switch (payload) {
      case "new": void handleNew(); break;
      case "open": void handleOpen(); break;
      case "save": void handleSave(false); break;
      case "save_as": void handleSave(true); break;
      case "close_tab": {
        const id = useDocumentStore.getState().activeId;
        if (id) void closeTab(id);
        break;
      }
      case "ai_edit": ui.requestInlineEdit(); break;
      case "chat": ui.requestChatFocus(); if (!useLayoutStore.getState().rightVisible) toggleRight(); break;
      case "command_palette": ui.openPalette(); break;
      case "find": ui.openFind(); break;
      case "toggle_sidebar": toggleLeft(); break;
      case "toggle_chat": toggleRight(); break;
      case "shortcuts": ui.openHelp(); break;
    }
  };
  useEffect(() => {
    const un = listen<string>("menu", ({ payload }) => menuDispatchRef.current(payload));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Keyboard shortcuts (fallback path on platforms where menu accelerators
  // don't reach us; on macOS the native menu handles most of these).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const ui = useUiStore.getState();
      const key = e.key.toLowerCase();

      if (e.ctrlKey && key === "tab") {
        e.preventDefault();
        void cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      if (!mod) return;

      if (key >= "1" && key <= "9" && !e.shiftKey && !e.altKey) {
        const tab = useDocumentStore.getState().tabs[Number(key) - 1];
        if (tab) {
          e.preventDefault();
          void switchTab(tab.id);
        }
        return;
      }

      switch (key) {
        case "s": e.preventDefault(); void handleSave(e.shiftKey); break;
        case "o": e.preventDefault(); void handleOpen(); break;
        case "n": e.preventDefault(); void handleNew(); break;
        case "w": {
          e.preventDefault();
          const id = useDocumentStore.getState().activeId;
          if (id) void closeTab(id);
          break;
        }
        case "p": e.preventDefault(); ui.openPalette(); break;
        case "k": e.preventDefault(); ui.requestInlineEdit(); break;
        case "f": e.preventDefault(); ui.openFind(); break;
        case "l": e.preventDefault(); ui.requestChatFocus(); if (!useLayoutStore.getState().rightVisible) toggleRight(); break;
        case "j": e.preventDefault(); toggleRight(); break;
        case "b": if (e.altKey) { e.preventDefault(); toggleLeft(); } break;
        case "/": e.preventDefault(); ui.openHelp(); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, handleOpen, handleNew, closeTab, cycleTab, switchTab, toggleLeft, toggleRight]);

  // ── Command palette ────────────────────────────────────────────────────────

  const recents = useRecentsStore((s) => s.recents);
  const paletteCommands: PaletteCommand[] = useMemo(() => {
    if (!paletteOpen) return [];
    const ui = useUiStore.getState();
    const cmds: PaletteCommand[] = [
      { id: "new", title: "New markdown document", hint: "⌘N", section: "Actions", run: () => void handleNew() },
      { id: "open", title: "Open file…", hint: "⌘O", section: "Actions", run: () => void handleOpen() },
      { id: "save", title: "Save", hint: "⌘S", section: "Actions", run: () => void handleSave(false) },
      { id: "save-as", title: "Save as…", hint: "⇧⌘S", section: "Actions", run: () => void handleSave(true) },
      { id: "find", title: "Find in document", hint: "⌘F", section: "Actions", run: () => ui.openFind() },
      { id: "ai-edit", title: "Edit selection with AI", hint: "⌘K", section: "Actions", run: () => ui.requestInlineEdit() },
      { id: "chat", title: "Chat about this document", hint: "⌘L", section: "Actions", run: () => { ui.requestChatFocus(); if (!useLayoutStore.getState().rightVisible) toggleRight(); } },
      { id: "toggle-sidebar", title: "Toggle sidebar", hint: "⌥⌘B", section: "Actions", run: toggleLeft },
      { id: "toggle-chat", title: "Toggle chat panel", hint: "⌘J", section: "Actions", run: toggleRight },
      { id: "theme", title: "Toggle light/dark theme", section: "Actions", run: () => useThemeStore.getState().toggle() },
      { id: "shortcuts", title: "Keyboard shortcuts", hint: "⌘/", section: "Actions", run: () => ui.openHelp() },
    ];
    const path = useDocumentStore.getState().path;
    if (path) {
      cmds.push({
        id: "reveal",
        title: "Reveal current file in Finder",
        section: "Actions",
        run: () => void invoke("reveal_in_os", { path }).catch(() => {}),
      });
    }
    for (const h of adapter?.getOutline?.() ?? []) {
      cmds.push({
        id: `h-${h.text}`,
        title: `${"#".repeat(h.level)} ${h.text}`,
        section: "Outline",
        run: h.jump,
      });
    }
    for (const r of recents.slice(0, 10)) {
      cmds.push({
        id: `r-${r.path}`,
        title: r.name,
        section: "Recent files",
        run: () => void handleOpenPath(r.path),
      });
    }
    return cmds;
  }, [paletteOpen, adapter, recents, handleNew, handleOpen, handleSave, handleOpenPath, toggleLeft, toggleRight]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={`dp-root ${dragging ? "is-dragging" : ""}`}>
      <SystemBanner />
      <header className="dp-toolbar">
        <button
          className={`dp-icon-btn ${leftVisible ? "is-on" : ""}`}
          title="Toggle sidebar (⌥⌘B)"
          onClick={toggleLeft}
        >
          ◧
        </button>
        <div className="dp-brand">docpilot</div>
        <div className="dp-toolbar-tabs">
          <TabBar
            onSelect={(id) => void switchTab(id)}
            onClose={(id) => void closeTab(id)}
            onNew={() => void handleNew()}
          />
        </div>
        <div className="dp-tools">
          <button className="dp-btn" title="⌘P" onClick={() => useUiStore.getState().openPalette()}>
            ⌘P
          </button>
          <button className="dp-btn" onClick={() => void handleOpen()}>
            Open
          </button>
          <button
            className="dp-btn dp-primary"
            disabled={!active}
            onClick={() => void handleSave(false)}
          >
            Save
          </button>
          <button
            className={`dp-icon-btn ${rightVisible ? "is-on" : ""}`}
            title="Toggle chat (⌘J)"
            onClick={toggleRight}
          >
            ◨
          </button>
        </div>
      </header>

      <div className="dp-workspace">
        <Allotment proportionalLayout={false} defaultSizes={sizes} onChange={setSizes}>
          <Allotment.Pane minSize={180} preferredSize={sizes[0]} snap visible={leftVisible}>
            <WorkspaceSidebar
              adapter={adapter}
              docVersion={docVersion}
              onOpenFile={() => void handleOpen()}
              onNewMarkdown={() => void handleNew()}
              onOpenPath={(p) => void handleOpenPath(p)}
            />
          </Allotment.Pane>

          <Allotment.Pane minSize={420}>
            <section className="dp-editor-wrap" data-kind={active ? kind : "welcome"}>
              <FindBar
                open={findOpen && !!active}
                adapter={adapter}
                onClose={() => useUiStore.getState().setFindOpen(false)}
              />
              {!active ? (
                <Welcome
                  onNew={() => void handleNew()}
                  onOpen={() => void handleOpen()}
                  onOpenPath={(p) => void handleOpenPath(p)}
                />
              ) : kind === "docx" ? (
                <ErrorBoundary label="docx editor">
                  <LocaleProvider>
                    <DocxEditor
                      ref={setDocxRef}
                      documentBuffer={docxBuffer}
                      showToolbar
                      className="dp-docx"
                      onChange={() => {
                        if (userChange()) useDocumentStore.getState().setDirty(true);
                        bumpDoc();
                      }}
                      onError={(e) => logToShell("DocxEditor.onError: " + e.message)}
                    />
                  </LocaleProvider>
                </ErrorBoundary>
              ) : (
                <div className="dp-paper">
                  {editor && (
                    <BubbleMenuBar
                      editor={editor}
                      onAiEdit={() => useUiStore.getState().requestInlineEdit()}
                    />
                  )}
                  <EditorContent editor={editor} />
                </div>
              )}
            </section>
          </Allotment.Pane>

          <Allotment.Pane minSize={320} preferredSize={sizes[2]} snap visible={rightVisible}>
            <div className="dp-chat">
              <ChatPanel adapter={adapter} />
            </div>
          </Allotment.Pane>
        </Allotment>
      </div>

      <StatusBar adapter={adapter} docVersion={docVersion} />

      <InlineEdit adapter={adapter} nonce={inlineEditNonce} />
      <CommandPalette
        open={paletteOpen}
        commands={paletteCommands}
        onClose={() => useUiStore.getState().setPaletteOpen(false)}
      />
      <ShortcutsHelp open={helpOpen} onClose={() => useUiStore.getState().setHelpOpen(false)} />

      {dragging && (
        <div className="dp-dropzone">
          <div className="dp-dropzone-card">파일을 놓으면 열립니다 (.md / .docx)</div>
        </div>
      )}
    </div>
  );
}
