import { create } from "zustand";

/**
 * Ephemeral UI surfaces (palette / find / help / inline edit). One place so
 * shortcuts, menu events, and buttons all drive the same state — and so
 * opening one surface closes the others.
 */
interface UiState {
  paletteOpen: boolean;
  findOpen: boolean;
  helpOpen: boolean;
  /** Monotonic trigger for "start an inline edit now" (App consumes it). */
  inlineEditNonce: number;
  /** Monotonic trigger for "focus the chat composer". */
  chatFocusNonce: number;

  openPalette: () => void;
  openFind: () => void;
  openHelp: () => void;
  closeAll: () => void;
  setPaletteOpen: (v: boolean) => void;
  setFindOpen: (v: boolean) => void;
  setHelpOpen: (v: boolean) => void;
  requestInlineEdit: () => void;
  requestChatFocus: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  paletteOpen: false,
  findOpen: false,
  helpOpen: false,
  inlineEditNonce: 0,
  chatFocusNonce: 0,

  openPalette: () => set({ paletteOpen: true, findOpen: false, helpOpen: false }),
  openFind: () => set({ findOpen: true, paletteOpen: false, helpOpen: false }),
  openHelp: () => set({ helpOpen: true, paletteOpen: false, findOpen: false }),
  closeAll: () => set({ paletteOpen: false, findOpen: false, helpOpen: false }),
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  setFindOpen: (v) => set({ findOpen: v }),
  setHelpOpen: (v) => set({ helpOpen: v }),
  requestInlineEdit: () => set({ inlineEditNonce: get().inlineEditNonce + 1 }),
  requestChatFocus: () =>
    set({ chatFocusNonce: get().chatFocusNonce + 1, paletteOpen: false }),
}));
