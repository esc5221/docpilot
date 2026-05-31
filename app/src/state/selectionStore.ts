import { create } from "zustand";

interface SelectionState {
  /** Snapshot of the user's last non-empty selection (the chat context pill). */
  text: string;
  set: (text: string) => void;
  clear: () => void;
}

/**
 * Holds the selection the chat panel treats as context — Cursor-style. The
 * editor updates it on every drag-select; the composer renders it as a pill and
 * the user can detach it. Collapsing the selection keeps the snapshot.
 */
export const useSelectionStore = create<SelectionState>((set) => ({
  text: "",
  set: (text) => set({ text }),
  clear: () => set({ text: "" }),
}));
