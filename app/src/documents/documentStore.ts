import { create } from "zustand";
import { type DocKind, persistThreadId } from "./fileBridge";

/**
 * Multi-document tab model. The ACTIVE tab's truth lives in the editor; every
 * other tab "parks" its content here. Tabs with a path are persisted across
 * restarts (content reloaded lazily from disk on first activation).
 */
export interface DocTab {
  id: string;
  /** Absolute path, or null for an unsaved buffer. */
  path: string | null;
  kind: DocKind;
  /** codex thread id bound to this document (inline-edit resume + cache). */
  threadId: string | null;
  dirty: boolean;
  /** Parked markdown source (inactive tabs / untitled persistence). */
  mdContent: string | null;
  /** Parked docx bytes (inactive tabs). */
  docxBytes: Uint8Array | null;
  /** False for restored tabs whose content hasn't been read from disk yet. */
  loaded: boolean;
}

export function tabTitle(tab: { path: string | null }): string {
  if (!tab.path) return "Untitled";
  return tab.path.split(/[\\/]/).pop() ?? tab.path;
}

const LS_KEY = "dp.tabs";

interface PersistedTab {
  path: string | null;
  kind: DocKind;
  /** Untitled markdown survives a restart via localStorage. */
  mdContent?: string;
}

interface PersistedTabs {
  tabs: PersistedTab[];
  activeIndex: number;
}

function makeTab(partial: Partial<DocTab>): DocTab {
  return {
    id: crypto.randomUUID(),
    path: null,
    kind: "markdown",
    threadId: null,
    dirty: false,
    mdContent: null,
    docxBytes: null,
    loaded: true,
    ...partial,
  };
}

export interface OpenTabInput {
  path: string | null;
  kind: DocKind;
  threadId: string | null;
  mdContent?: string | null;
  docxBytes?: Uint8Array | null;
}

interface DocumentState {
  tabs: DocTab[];
  activeId: string | null;

  // ── Mirrors of the active tab so existing consumers stay one-hop ─────────
  path: string | null;
  kind: DocKind;
  threadId: string | null;
  dirty: boolean;

  /** Open a tab for a loaded document; focuses the existing tab for the same path. */
  openTab: (input: OpenTabInput) => string;
  newMarkdownTab: () => string;
  activate: (id: string) => void;
  closeTab: (id: string) => void;
  /** Park editor content into a tab (called before switching away / persisting). */
  park: (id: string, content: { mdContent?: string | null; docxBytes?: Uint8Array | null }) => void;
  /** Mark a lazily-restored tab as materialized with its disk content. */
  markLoaded: (id: string, content: { mdContent?: string | null; docxBytes?: Uint8Array | null }) => void;
  setDirty: (dirty: boolean) => void;
  setPath: (path: string) => void;
  /** Record a freshly created codex thread id and persist it against the file. */
  bindThreadId: (threadId: string) => void;
  /** Restore the persisted tab set (paths only; content loads lazily). */
  restore: () => void;
}

export const useDocumentStore = create<DocumentState>((set, get) => {
  /** Recompute the active-tab mirror fields. */
  const sync = () => {
    const { tabs, activeId } = get();
    const t = tabs.find((x) => x.id === activeId) ?? null;
    set({
      path: t?.path ?? null,
      kind: t?.kind ?? "markdown",
      threadId: t?.threadId ?? null,
      dirty: t?.dirty ?? false,
    });
  };

  const persistTabs = () => {
    const { tabs, activeId } = get();
    const blob: PersistedTabs = {
      tabs: tabs.map((t) => ({
        path: t.path,
        kind: t.kind,
        ...(t.path == null && t.mdContent != null ? { mdContent: t.mdContent } : {}),
      })),
      activeIndex: Math.max(0, tabs.findIndex((t) => t.id === activeId)),
    };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(blob));
    } catch {
      /* quota — fine, tabs just won't restore */
    }
  };

  const update = (id: string, fn: (t: DocTab) => DocTab) => {
    set({ tabs: get().tabs.map((t) => (t.id === id ? fn(t) : t)) });
  };

  return {
    tabs: [],
    activeId: null,
    path: null,
    kind: "markdown",
    threadId: null,
    dirty: false,

    openTab: (input) => {
      if (input.path) {
        const existing = get().tabs.find((t) => t.path === input.path);
        if (existing) {
          // Refresh content from the (re-)loaded document.
          update(existing.id, (t) => ({
            ...t,
            kind: input.kind,
            threadId: input.threadId ?? t.threadId,
            mdContent: input.mdContent ?? t.mdContent,
            docxBytes: input.docxBytes ?? t.docxBytes,
            loaded: true,
          }));
          set({ activeId: existing.id });
          sync();
          persistTabs();
          return existing.id;
        }
      }
      const tab = makeTab({
        path: input.path,
        kind: input.kind,
        threadId: input.threadId,
        mdContent: input.mdContent ?? null,
        docxBytes: input.docxBytes ?? null,
        loaded: true,
      });
      set({ tabs: [...get().tabs, tab], activeId: tab.id });
      sync();
      persistTabs();
      return tab.id;
    },

    newMarkdownTab: () => {
      const tab = makeTab({ kind: "markdown", mdContent: "", loaded: true });
      set({ tabs: [...get().tabs, tab], activeId: tab.id });
      sync();
      persistTabs();
      return tab.id;
    },

    activate: (id) => {
      if (!get().tabs.some((t) => t.id === id)) return;
      set({ activeId: id });
      sync();
      persistTabs();
    },

    closeTab: (id) => {
      const { tabs, activeId } = get();
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const rest = tabs.filter((t) => t.id !== id);
      let nextActive = activeId;
      if (activeId === id) {
        nextActive = rest.length ? (rest[Math.min(idx, rest.length - 1)]?.id ?? null) : null;
      }
      set({ tabs: rest, activeId: nextActive });
      sync();
      persistTabs();
    },

    park: (id, content) => {
      update(id, (t) => ({
        ...t,
        mdContent: content.mdContent !== undefined ? content.mdContent : t.mdContent,
        docxBytes: content.docxBytes !== undefined ? content.docxBytes : t.docxBytes,
      }));
      persistTabs();
    },

    markLoaded: (id, content) => {
      update(id, (t) => ({
        ...t,
        mdContent: content.mdContent !== undefined ? content.mdContent : t.mdContent,
        docxBytes: content.docxBytes !== undefined ? content.docxBytes : t.docxBytes,
        loaded: true,
      }));
    },

    setDirty: (dirty) => {
      const { activeId } = get();
      if (activeId) update(activeId, (t) => ({ ...t, dirty }));
      set({ dirty });
    },

    setPath: (path) => {
      const { activeId } = get();
      if (activeId) update(activeId, (t) => ({ ...t, path }));
      set({ path });
      persistTabs();
    },

    bindThreadId: (threadId) => {
      const { activeId, tabs } = get();
      const t = tabs.find((x) => x.id === activeId);
      if (!t || t.threadId === threadId) return;
      update(t.id, (x) => ({ ...x, threadId }));
      set({ threadId });
      if (t.path) void persistThreadId(t.path, threadId);
    },

    restore: () => {
      if (get().tabs.length) return;
      let parsed: PersistedTabs | null = null;
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) parsed = JSON.parse(raw) as PersistedTabs;
      } catch {
        /* corrupted — start fresh */
      }
      if (!parsed?.tabs.length) return;
      const tabs = parsed.tabs
        .filter((p) => p.path != null || p.mdContent != null)
        .map((p) =>
          makeTab({
            path: p.path,
            kind: p.kind,
            mdContent: p.mdContent ?? null,
            // Tabs with a path lazy-load from disk on first activation.
            loaded: p.path == null,
          }),
        );
      if (!tabs.length) return;
      const active = tabs[Math.min(Math.max(parsed.activeIndex, 0), tabs.length - 1)];
      set({ tabs, activeId: active.id });
      sync();
    },
  };
});
