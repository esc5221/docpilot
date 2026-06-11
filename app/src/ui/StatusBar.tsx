import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { EditorAdapter } from "../editor/EditorAdapter";
import { useDocumentStore } from "../documents/documentStore";
import { useSelectionStore } from "../state/selectionStore";
import { useThemeStore } from "../state/themeStore";
import { useUiStore } from "../state/uiStore";

interface CodexStatus {
  path: string | null;
  logged_in: boolean;
}

interface Props {
  adapter: EditorAdapter | null;
  /** Bumps whenever the document content changes (drives the word count). */
  docVersion: number;
}

function countWords(text: string): { words: number; chars: number } {
  const trimmed = text.trim();
  if (!trimmed) return { words: 0, chars: 0 };
  return { words: trimmed.split(/\s+/).length, chars: trimmed.replace(/\s/g, "").length };
}

/** Bottom status strip: doc stats, AI status, theme — quiet but always there. */
export function StatusBar({ adapter, docVersion }: Props) {
  const kind = useDocumentStore((s) => s.kind);
  const dirty = useDocumentStore((s) => s.dirty);
  const activeId = useDocumentStore((s) => s.activeId);
  const selection = useSelectionStore((s) => s.snapshot);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const openHelp = useUiStore((s) => s.openHelp);

  const [stats, setStats] = useState({ words: 0, chars: 0 });
  const [codex, setCodex] = useState<CodexStatus | null>(null);

  // Recount on content changes, debounced — counting is O(doc) but cheap enough.
  useEffect(() => {
    if (!adapter || !activeId) {
      setStats({ words: 0, chars: 0 });
      return;
    }
    const t = setTimeout(() => {
      try {
        setStats(countWords(adapter.getPlainText()));
      } catch {
        /* editor mid-teardown */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [adapter, docVersion, activeId]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await invoke<CodexStatus>("codex_status");
        if (alive) setCodex(s);
      } catch {
        /* shell not ready */
      }
    };
    void tick();
    const id = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const aiReady = !!codex?.path && !!codex.logged_in;

  return (
    <footer className="dp-statusbar">
      {activeId && (
        <>
          <span className="dp-status-item dp-status-kind">{kind === "docx" ? "Word" : "Markdown"}</span>
          <span className="dp-status-item">{dirty ? "● Unsaved" : "Saved"}</span>
        </>
      )}

      <span className="dp-status-spacer" />

      {selection && (
        <span className="dp-status-item">{selection.text.length} selected</span>
      )}
      {activeId && (
        <span className="dp-status-item">
          {stats.words.toLocaleString()} words · {stats.chars.toLocaleString()} chars
        </span>
      )}

      <span
        className={`dp-status-item dp-status-ai ${aiReady ? "is-ok" : "is-off"}`}
        title={
          aiReady
            ? "Codex connected"
            : codex?.path
              ? "Codex installed but signed out"
              : "Codex CLI not found"
        }
      >
        <span className="dp-status-dot" />
        {aiReady ? "AI ready" : "AI off"}
      </span>

      <button
        className="dp-status-btn"
        title="Toggle theme"
        onClick={toggleTheme}
      >
        {theme === "dark" ? "☾" : "☀"}
      </button>
      <button className="dp-status-btn" title="Keyboard shortcuts (⌘/)" onClick={openHelp}>
        ⌘
      </button>
    </footer>
  );
}
