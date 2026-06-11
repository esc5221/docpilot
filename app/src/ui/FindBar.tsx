import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorAdapter, ResolvedAnchor } from "../editor/EditorAdapter";

interface Props {
  open: boolean;
  adapter: EditorAdapter | null;
  onClose: () => void;
}

/** ⌘F find bar — live highlight (markdown) / paragraph hits (docx). */
export function FindBar({ open, adapter, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ResolvedAnchor[]>([]);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const clear = useCallback(() => {
    adapter?.clearMatches?.();
    setMatches([]);
    setIndex(0);
  }, [adapter]);

  // Recompute matches as the query changes.
  useEffect(() => {
    if (!open || !adapter) return;
    if (!query) {
      clear();
      return;
    }
    const found = adapter.findMatches?.(query) ?? [];
    setMatches(found);
    setIndex(0);
    adapter.highlightMatches?.(found, 0);
    if (found[0]) adapter.revealMatch?.(found[0]);
  }, [open, adapter, query, clear]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    } else {
      clear();
    }
  }, [open, clear]);

  const go = (dir: 1 | -1) => {
    if (!matches.length || !adapter) return;
    const next = (index + dir + matches.length) % matches.length;
    setIndex(next);
    adapter.highlightMatches?.(matches, next);
    adapter.revealMatch?.(matches[next]);
  };

  if (!open) return null;

  return (
    <div className="dp-findbar">
      <input
        ref={inputRef}
        className="dp-find-input"
        placeholder="Find in document…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter") {
            e.preventDefault();
            go(e.shiftKey ? -1 : 1);
          }
        }}
      />
      <span className="dp-find-count">
        {query ? (matches.length ? `${index + 1}/${matches.length}` : "0") : ""}
      </span>
      <button className="dp-find-btn" title="Previous (⇧Enter)" onClick={() => go(-1)}>
        ↑
      </button>
      <button className="dp-find-btn" title="Next (Enter)" onClick={() => go(1)}>
        ↓
      </button>
      <button className="dp-find-btn" title="Close (Esc)" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}
