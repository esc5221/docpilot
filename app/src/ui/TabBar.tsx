import { tabTitle, useDocumentStore } from "../documents/documentStore";

interface Props {
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

/** Document tabs. Middle-click closes; the + button opens a new markdown buffer. */
export function TabBar({ onSelect, onClose, onNew }: Props) {
  const tabs = useDocumentStore((s) => s.tabs);
  const activeId = useDocumentStore((s) => s.activeId);

  if (tabs.length === 0) return null;

  return (
    <div className="dp-tabbar" role="tablist">
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.id === activeId}
          className={`dp-tab ${t.id === activeId ? "is-active" : ""}`}
          title={t.path ?? "Unsaved"}
          onClick={() => onSelect(t.id)}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(t.id);
          }}
        >
          <span className={`dp-tab-kind is-${t.kind}`}>{t.kind === "docx" ? "W" : "M"}</span>
          <span className="dp-tab-name">{tabTitle(t)}</span>
          <button
            className={`dp-tab-x ${t.dirty ? "is-dirty" : ""}`}
            title={t.dirty ? "Unsaved changes — close" : "Close (⌘W)"}
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.id);
            }}
          >
            <span className="dp-tab-x-icon">✕</span>
            <span className="dp-tab-dirty-dot" />
          </button>
        </div>
      ))}
      <button className="dp-tab-new" title="New document (⌘N)" onClick={onNew}>
        ＋
      </button>
    </div>
  );
}
