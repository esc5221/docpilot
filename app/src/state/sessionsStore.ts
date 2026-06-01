import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { DiffPart } from "../util/diffText";

/** A tool-call or reasoning step the agent emitted while editing (Codex-style). */
export interface ChatStep {
  kind: "command" | "reasoning";
  text: string;
  /** command only: stable id (for in-place status updates) + run state. */
  id?: string;
  status?: "running" | "done" | "failed";
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Agent timeline (edit turns): shell commands + reasoning, in order. */
  steps?: ChatStep[];
  /** Changed lines (before → after) for an edit turn. */
  diff?: DiffPart[];
  /** Key into the in-memory snapshot store, enabling a one-click revert. */
  revertId?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  /** codex thread id for this chat (Ask resume + prompt caching). */
  threadId: string | null;
  messages: ChatMessage[];
  updatedAt: number;
}

interface Persisted {
  sessions: ChatSession[];
  currentId: string | null;
}

function newSession(): ChatSession {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    threadId: null,
    messages: [],
    updatedAt: Date.now(),
  };
}

interface SessionsState {
  sessions: ChatSession[];
  currentId: string | null;
  loaded: boolean;

  load: () => Promise<void>;
  persist: () => void;

  create: () => void;
  switchTo: (id: string) => void;
  rename: (id: string, title: string) => void;
  remove: (id: string) => void;

  /** Replace the current session's messages (in-memory; for streaming). */
  setMessages: (messages: ChatMessage[]) => void;
  /** Bind a codex thread id to the current session and persist. */
  bindThread: (threadId: string) => void;
}

export const useSessionsStore = create<SessionsState>((set, get) => {
  const writeThrough = () => {
    const { sessions, currentId } = get();
    const blob: Persisted = { sessions, currentId };
    void invoke("save_sessions", { data: JSON.stringify(blob) }).catch(() => {});
  };

  const updateCurrent = (fn: (s: ChatSession) => ChatSession) => {
    const { sessions, currentId } = get();
    set({ sessions: sessions.map((s) => (s.id === currentId ? fn(s) : s)) });
  };

  return {
    sessions: [],
    currentId: null,
    loaded: false,

    load: async () => {
      let parsed: Persisted | null = null;
      try {
        const raw = await invoke<string>("load_sessions");
        if (raw) parsed = JSON.parse(raw) as Persisted;
      } catch {
        /* fall through to a fresh session */
      }
      if (parsed && parsed.sessions.length) {
        const currentId =
          parsed.currentId && parsed.sessions.some((s) => s.id === parsed!.currentId)
            ? parsed.currentId
            : parsed.sessions[0].id;
        set({ sessions: parsed.sessions, currentId, loaded: true });
      } else {
        const s = newSession();
        set({ sessions: [s], currentId: s.id, loaded: true });
        writeThrough();
      }
    },

    persist: writeThrough,

    create: () => {
      const s = newSession();
      set({ sessions: [s, ...get().sessions], currentId: s.id });
      writeThrough();
    },

    switchTo: (id) => {
      set({ currentId: id });
      writeThrough();
    },

    rename: (id, title) => {
      set({ sessions: get().sessions.map((s) => (s.id === id ? { ...s, title } : s)) });
      writeThrough();
    },

    remove: (id) => {
      const rest = get().sessions.filter((s) => s.id !== id);
      if (rest.length === 0) {
        const s = newSession();
        set({ sessions: [s], currentId: s.id });
      } else {
        const currentId = get().currentId === id ? rest[0].id : get().currentId;
        set({ sessions: rest, currentId });
      }
      writeThrough();
    },

    setMessages: (messages) =>
      updateCurrent((s) => ({ ...s, messages, updatedAt: Date.now() })),

    bindThread: (threadId) => {
      updateCurrent((s) => ({ ...s, threadId }));
      writeThrough();
    },
  };
});
