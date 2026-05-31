import { useEffect, useRef, useState } from "react";
import type { InlineEditState } from "./useInlineEdit";

interface Props {
  state: InlineEditState;
  onSubmit: (instruction: string) => void;
  onAccept: () => void;
  onCancel: () => void;
}

const QUICK_ACTIONS = ["더 간결하게", "더 자연스럽게", "존댓말로", "평어체로", "오타·문법 교정"];

export function EditPopover({ state, onSubmit, onAccept, onCancel }: Props) {
  const [instruction, setInstruction] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the instruction field when the popover opens.
  useEffect(() => {
    if (state.status === "prompting") {
      setInstruction("");
      inputRef.current?.focus();
    }
  }, [state.status]);

  // Global keys for the review stage (Enter accept / Esc cancel).
  useEffect(() => {
    if (state.status !== "review") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onAccept();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state.status, onAccept, onCancel]);

  if (state.status === "idle" || !state.anchor) return null;

  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(state.anchor.x, window.innerWidth - 460),
    top: state.anchor.y + 8,
  };

  return (
    <div className="dp-popover" style={style} onMouseDown={(e) => e.stopPropagation()}>
      {state.status === "prompting" && (
        <div className="dp-pop-body">
          <input
            ref={inputRef}
            className="dp-pop-input"
            placeholder="어떻게 고칠까요?  예: 더 간결하게"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit(instruction);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
            }}
          />
          <div className="dp-quick">
            {QUICK_ACTIONS.map((a) => (
              <button key={a} className="dp-chip" onClick={() => onSubmit(a)}>
                {a}
              </button>
            ))}
          </div>
        </div>
      )}

      {state.status === "streaming" && (
        <div className="dp-pop-body">
          <div className="dp-streaming">
            <span className="dp-spinner" /> 고치는 중…
          </div>
          <div className="dp-preview">{state.streamText || "…"}</div>
          <div className="dp-actions">
            <button className="dp-btn" onClick={onCancel}>
              중단 (Esc)
            </button>
          </div>
        </div>
      )}

      {state.status === "review" && (
        <div className="dp-pop-body">
          <div className="dp-diff">
            <div className="dp-old">{state.selectedText}</div>
            <div className="dp-new">{state.replacement}</div>
          </div>
          <div className="dp-actions">
            <button className="dp-btn dp-primary" onClick={onAccept}>
              수락 (⏎)
            </button>
            <button className="dp-btn" onClick={onCancel}>
              거절 (Esc)
            </button>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div className="dp-pop-body">
          <div className="dp-error">⚠ {state.error}</div>
          <div className="dp-actions">
            <button className="dp-btn" onClick={onCancel}>
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
