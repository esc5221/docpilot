import { create } from "zustand";
import type { SelectionSnapshot } from "../editor/EditorAdapter";

interface SelectionState {
  /** The user's last non-empty selection (chat context pill + edit target). */
  snapshot: SelectionSnapshot | null;
  set: (snap: SelectionSnapshot) => void;
  clear: () => void;
}

/**
 * Holds the selection the chat panel treats as context — Cursor-style. The
 * editor updates it on every drag-select; the composer renders a pill and the
 * user can detach it. Collapsing the selection keeps the snapshot.
 */
export const useSelectionStore = create<SelectionState>((set) => ({
  snapshot: null,
  set: (snapshot) => set({ snapshot }),
  clear: () => set({ snapshot: null }),
}));
