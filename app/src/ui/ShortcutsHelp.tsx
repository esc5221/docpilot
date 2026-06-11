interface Props {
  open: boolean;
  onClose: () => void;
}

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: "Documents",
    items: [
      ["⌘N", "New markdown document"],
      ["⌘O", "Open file"],
      ["⌘S", "Save"],
      ["⇧⌘S", "Save as…"],
      ["⌘W", "Close tab"],
      ["⌃Tab / ⌃⇧Tab", "Next / previous tab"],
      ["⌘1…9", "Jump to tab"],
    ],
  },
  {
    title: "AI",
    items: [
      ["⌘K", "Edit selection with AI"],
      ["⌘L", "Chat about the document"],
      ["Enter / Esc", "Accept / reject inline edit"],
    ],
  },
  {
    title: "Navigate",
    items: [
      ["⌘P", "Command palette"],
      ["⌘F", "Find in document"],
      ["⌥⌘B", "Toggle sidebar"],
      ["⌘J", "Toggle chat panel"],
      ["⌘/", "This help"],
    ],
  },
];

/** ⌘/ cheat-sheet. */
export function ShortcutsHelp({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="dp-overlay" onMouseDown={onClose}>
      <div className="dp-help" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dp-help-title">Keyboard shortcuts</div>
        <div className="dp-help-grid">
          {GROUPS.map((g) => (
            <div key={g.title} className="dp-help-group">
              <div className="dp-help-group-title">{g.title}</div>
              {g.items.map(([keys, label]) => (
                <div key={keys} className="dp-help-row">
                  <span className="dp-help-label">{label}</span>
                  <kbd>{keys}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
        <button className="dp-btn dp-help-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
