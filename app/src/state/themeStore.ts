import { create } from "zustand";

export type Theme = "dark" | "light";

const KEY = "dp.theme";

function load(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    /* ignore */
  }
  return "dark";
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  set: (t: Theme) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = load();
  apply(initial);
  return {
    theme: initial,
    toggle: () => get().set(get().theme === "dark" ? "light" : "dark"),
    set: (theme) => {
      apply(theme);
      try {
        localStorage.setItem(KEY, theme);
      } catch {
        /* ignore */
      }
      set({ theme });
    },
  };
});
