import { useCallback, useRef, useState } from "react";

interface Options {
  initial: number;
  min: number;
  max: number;
  storageKey: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keep at least this much room for the editor, no matter how wide the panel. */
const MIN_EDITOR = 320;

/**
 * Drag-to-resize for the right-hand panel. The upper bound is dynamic: you can
 * drag it as wide as the viewport allows (leaving the editor `MIN_EDITOR`),
 * capped by `max`. Width persists to localStorage.
 */
export function useResizablePanel({ initial, min, max, storageKey }: Options) {
  const effectiveMax = () => Math.min(max, Math.max(min, window.innerWidth - MIN_EDITOR));

  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved >= min ? clamp(saved, min, effectiveMax()) : initial;
  });
  const [active, setActive] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setActive(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const move = (ev: MouseEvent) => {
        setWidth(clamp(window.innerWidth - ev.clientX, min, effectiveMax()));
      };
      const up = () => {
        setActive(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        localStorage.setItem(storageKey, String(Math.round(widthRef.current)));
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [min, max, storageKey],
  );

  return { width, active, onMouseDown };
}
