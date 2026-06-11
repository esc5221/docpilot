import { useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { EditorAdapter } from "../editor/EditorAdapter";
import { useRecentsStore } from "../state/recentsStore";
import { useDocumentStore } from "../documents/documentStore";

interface Props {
  adapter: EditorAdapter | null;
  /** Bumps on content change so the outline stays fresh. */
  docVersion: number;
  onOpenFile: () => void;
  onNewMarkdown: () => void;
  onOpenPath: (path: string) => void;
}

export function WorkspaceSidebar({
  adapter,
  docVersion,
  onOpenFile,
  onNewMarkdown,
  onOpenPath,
}: Props) {
  const recents = useRecentsStore((s) => s.recents);
  const removeRecent = useRecentsStore((s) => s.remove);
  const currentPath = useDocumentStore((s) => s.path);
  const activeId = useDocumentStore((s) => s.activeId);

  const outline = useMemo(() => {
    if (!adapter || !activeId) return [];
    try {
      return adapter.getOutline?.() ?? [];
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, activeId, docVersion]);

  return (
    <div className="dp-sidebar">
      <div className="dp-side-actions">
        <button className="dp-side-action" onClick={onNewMarkdown}>
          ＋ New
        </button>
        <button className="dp-side-action" onClick={onOpenFile}>
          Open…
        </button>
      </div>

      {outline.length > 0 && (
        <>
          <div className="dp-side-section">Outline</div>
          <div className="dp-side-outline">
            {outline.map((h, i) => (
              <button
                key={i}
                className="dp-outline-item"
                style={{ paddingLeft: 10 + (h.level - 1) * 14 }}
                title={h.text}
                onClick={h.jump}
              >
                {h.text}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="dp-side-section">Recent</div>
      <div className="dp-side-list">
        {recents.length === 0 && <div className="dp-side-empty">No recent documents</div>}
        {recents.map((r) => (
          <div
            key={r.path}
            className={`dp-recent ${r.path === currentPath ? "is-on" : ""}`}
            title={r.path}
          >
            <button className="dp-recent-open" onClick={() => onOpenPath(r.path)}>
              <span className="dp-recent-icon">{r.kind === "docx" ? "📘" : "📄"}</span>
              <span className="dp-recent-name">{r.name}</span>
            </button>
            <button
              className="dp-recent-act"
              title="Reveal in Finder"
              onClick={() => void invoke("reveal_in_os", { path: r.path }).catch(() => {})}
            >
              ⤴
            </button>
            <button
              className="dp-recent-act"
              title="Remove from recent"
              onClick={() => removeRecent(r.path)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
