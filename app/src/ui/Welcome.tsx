import { useRecentsStore } from "../state/recentsStore";

interface Props {
  onNew: () => void;
  onOpen: () => void;
  onOpenPath: (path: string) => void;
}

const HINTS: Array<[string, string]> = [
  ["⌘N", "New document"],
  ["⌘O", "Open file"],
  ["⌘P", "Command palette"],
  ["⌘K", "Edit selection with AI"],
  ["⌘L", "Chat about the document"],
];

/** Zero-tab state: brand moment + fast paths into a document. */
export function Welcome({ onNew, onOpen, onOpenPath }: Props) {
  const recents = useRecentsStore((s) => s.recents);

  return (
    <div className="dp-welcome">
      <div className="dp-welcome-inner">
        <div className="dp-welcome-brand">
          <span className="dp-welcome-logo" />
          docpilot
        </div>
        <div className="dp-welcome-tagline">AI 문서 편집기 — 문장 단위로 고치고, 문서 전체와 대화하세요.</div>

        <div className="dp-welcome-actions">
          <button className="dp-welcome-action" onClick={onNew}>
            <span className="dp-welcome-action-icon">＋</span>
            <span>
              <b>New Markdown</b>
              <small>빈 문서에서 시작</small>
            </span>
            <kbd>⌘N</kbd>
          </button>
          <button className="dp-welcome-action" onClick={onOpen}>
            <span className="dp-welcome-action-icon">📂</span>
            <span>
              <b>Open…</b>
              <small>.md / .docx 열기 (창에 드래그해도 됩니다)</small>
            </span>
            <kbd>⌘O</kbd>
          </button>
        </div>

        {recents.length > 0 && (
          <div className="dp-welcome-recents">
            <div className="dp-welcome-section">최근 문서</div>
            {recents.slice(0, 6).map((r) => (
              <button
                key={r.path}
                className="dp-welcome-recent"
                title={r.path}
                onClick={() => onOpenPath(r.path)}
              >
                <span className="dp-recent-icon">{r.kind === "docx" ? "📘" : "📄"}</span>
                <span className="dp-welcome-recent-name">{r.name}</span>
                <span className="dp-welcome-recent-path">{r.path}</span>
              </button>
            ))}
          </div>
        )}

        <div className="dp-welcome-hints">
          {HINTS.map(([k, label]) => (
            <span key={k} className="dp-welcome-hint">
              <kbd>{k}</kbd> {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
