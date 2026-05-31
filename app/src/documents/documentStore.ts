import { create } from "zustand";
import { type DocKind, persistThreadId } from "./fileBridge";

interface DocumentState {
  /** Absolute path of the open file, or null for an unsaved buffer. */
  path: string | null;
  /** Document format — selects which editor pane and save path is used. */
  kind: DocKind;
  /** codex thread id bound to this document (drives session resume + cache). */
  threadId: string | null;
  /** Unsaved changes since the last write. */
  dirty: boolean;

  openDoc: (path: string | null, kind: DocKind, threadId: string | null) => void;
  /** Record a freshly created thread id and persist it against the file. */
  bindThreadId: (threadId: string) => void;
  setDirty: (dirty: boolean) => void;
  setPath: (path: string) => void;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  path: null,
  kind: "markdown",
  threadId: null,
  dirty: false,

  openDoc: (path, kind, threadId) => set({ path, kind, threadId, dirty: false }),

  bindThreadId: (threadId) => {
    if (get().threadId === threadId) return;
    set({ threadId });
    const { path } = get();
    if (path) void persistThreadId(path, threadId);
  },

  setDirty: (dirty) => set({ dirty }),
  setPath: (path) => set({ path }),
}));
