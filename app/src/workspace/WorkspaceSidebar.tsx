import { invoke } from "@tauri-apps/api/core";
import { useRecentsStore } from "../state/recentsStore";
import { useDocumentStore } from "../documents/documentStore";

interface Props {
  onOpenFile: () => void;
  onNewMarkdown: () => void;
  onOpenPath: (path: string) => void;
}

export function WorkspaceSidebar({ onOpenFile, onNewMarkdown, onOpenPath }: Props) {
  const recents = useRecentsStore((s) => s.recents);
  const removeRecent = useRecentsStore((s) => s.remove);
  const currentPath = useDocumentStore((s) => s.path);

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
