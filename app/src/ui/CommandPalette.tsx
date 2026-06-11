import { useEffect, useMemo, useRef, useState } from "react";

export interface PaletteCommand {
  id: string;
  title: string;
  /** Keyboard hint rendered right-aligned (e.g. "⌘S"). */
  hint?: string;
  section: string;
  run: () => void;
}

interface Props {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
}

/** Substring-then-subsequence match, case-insensitive. */
function matches(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return true;
  if (t.includes(q)) return true;
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}

/** ⌘P launcher: every action, recent file, and heading one keystroke away. */
export function CommandPalette({ open, commands, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => commands.filter((c) => matches(query, c.title)),
    [commands, query],
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  // Keep the active row in view while arrowing.
  useEffect(() => {
    listRef.current
      ?.querySelector(".dp-palette-item.is-active")
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open) return null;

  const pick = (cmd: PaletteCommand) => {
    onClose();
    cmd.run();
  };

  return (
    <div className="dp-overlay" onMouseDown={onClose}>
      <div className="dp-palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="dp-palette-input"
          placeholder="Type a command or file name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const cmd = filtered[index];
              if (cmd) pick(cmd);
            }
          }}
        />
        <div className="dp-palette-list" ref={listRef}>
          {filtered.length === 0 && <div className="dp-palette-empty">No matches</div>}
          {filtered.map((c, i) => {
            const sectionStart = i === 0 || filtered[i - 1].section !== c.section;
            return (
              <div key={c.id}>
                {sectionStart && <div className="dp-palette-section">{c.section}</div>}
                <button
                  className={`dp-palette-item ${i === index ? "is-active" : ""}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => pick(c)}
                >
                  <span className="dp-palette-title">{c.title}</span>
                  {c.hint && <kbd className="dp-palette-hint">{c.hint}</kbd>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
