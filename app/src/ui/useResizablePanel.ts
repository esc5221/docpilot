import { useCallback, useRef, useState } from "react";

interface Options {
  initial: number;
  min: number;
  max: number;
  storageKey: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Drag-to-resize for the right-hand panel. Width persists to localStorage and
 * is clamped to [min, max]. Returns the width, the drag-handle's onMouseDown,
 * and an `active` flag for handle styling.
 */
export function useResizablePanel({ initial, min, max, storageKey }: Options) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved >= min && saved <= max ? saved : initial;
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
        setWidth(clamp(window.innerWidth - ev.clientX, min, max));
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
