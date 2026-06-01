import { create } from "zustand";

const KEY = "dp.recents";
const CAP = 15;

export interface RecentDoc {
  path: string;
  name: string;
  kind: "markdown" | "docx";
  lastOpened: number;
}

function load(): RecentDoc[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as RecentDoc[];
  } catch {
    /* ignore */
  }
  return [];
}

interface RecentsState {
  recents: RecentDoc[];
  add: (doc: Omit<RecentDoc, "lastOpened">) => void;
  remove: (path: string) => void;
}

export const useRecentsStore = create<RecentsState>((set, get) => {
  const save = (recents: RecentDoc[]) => {
    localStorage.setItem(KEY, JSON.stringify(recents));
    set({ recents });
  };
  return {
    recents: load(),
    add: (doc) => {
      const rest = get().recents.filter((r) => r.path !== doc.path);
      save([{ ...doc, lastOpened: Date.now() }, ...rest].slice(0, CAP));
    },
    remove: (path) => save(get().recents.filter((r) => r.path !== path)),
  };
});
