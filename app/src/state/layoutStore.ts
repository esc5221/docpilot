import { create } from "zustand";

const KEY = "dp.layout";

interface Persisted {
  sizes: number[];
  leftVisible: boolean;
  rightVisible: boolean;
}

const DEFAULT: Persisted = { sizes: [248, 800, 384], leftVisible: true, rightVisible: true };

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...(JSON.parse(raw) as Persisted) };
  } catch {
    /* ignore */
  }
  return DEFAULT;
}

interface LayoutState extends Persisted {
  setSizes: (sizes: number[]) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => {
  const persist = () => {
    const { sizes, leftVisible, rightVisible } = get();
    localStorage.setItem(KEY, JSON.stringify({ sizes, leftVisible, rightVisible }));
  };
  return {
    ...load(),
    setSizes: (sizes) => {
      set({ sizes });
      persist();
    },
    toggleLeft: () => {
      set({ leftVisible: !get().leftVisible });
      persist();
    },
    toggleRight: () => {
      set({ rightVisible: !get().rightVisible });
      persist();
    },
  };
});
