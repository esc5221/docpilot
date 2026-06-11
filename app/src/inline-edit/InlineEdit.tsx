import { useCallback, useEffect, useRef, useState } from "react";
import type { EditRequest } from "@docpilot/shared";
import { getAgent } from "../agent/agentSingleton";
import type { EditorAdapter, EditRange } from "../editor/EditorAdapter";
import { useDocumentStore } from "../documents/documentStore";

const WIDTH = 480;

const QUICK_CHIPS: Array<[string, string]> = [
  ["간결하게", "더 간결하게 다듬어줘"],
  ["맞춤법", "문법과 맞춤법을 교정해줘"],
  ["격식 있게", "더 격식 있는 문체로 바꿔줘"],
  ["쉽게", "더 쉬운 표현으로 풀어써줘"],
  ["English", "Translate to natural English"],
];

type Phase = "input" | "streaming" | "review" | "error";

interface Capture {
  range: EditRange;
  selectedText: string;
  rect: { left: number; top: number; bottom: number };
}

interface Props {
  adapter: EditorAdapter | null;
  /** Bumps when the user presses ⌘K — captures the live selection and opens. */
  nonce: number;
}

/**
 * The product's heart: select → ⌘K → instruct → streamed rewrite → diff →
 * Enter accepts / Esc rejects. The document is untouched until accept, and
 * accept is one transaction (⌘Z undoes it).
 */
export function InlineEdit({ adapter, nonce }: Props) {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [phase, setPhase] = useState<Phase>("input");
  const [instruction, setInstruction] = useState("");
  const [streamed, setStreamed] = useState("");
  const [replacement, setReplacement] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setCapture(null);
    setPhase("input");
    setInstruction("");
    setStreamed("");
    setReplacement("");
    setError("");
  }, []);

  // ⌘K pressed: capture the selection + its screen position, then open.
  useEffect(() => {
    if (nonce === 0 || !adapter) return;
    const range = adapter.getSelectionRange();
    const snap = adapter.getSelectionSnapshot();
    if (!range || !snap?.text.trim()) return;

    const sel = window.getSelection();
    const domRect =
      sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const rect = domRect && (domRect.width || domRect.height)
      ? { left: domRect.left, top: domRect.top, bottom: domRect.bottom }
      : { left: window.innerWidth / 2 - WIDTH / 2, top: 120, bottom: 140 };

    setCapture({ range, selectedText: snap.text, rect });
    setPhase("input");
    setInstruction("");
    setStreamed("");
    setReplacement("");
    setError("");
    requestAnimationFrame(() => inputRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const submit = useCallback(
    async (text: string) => {
      if (!adapter || !capture || !text.trim()) return;
      setPhase("streaming");
      setStreamed("");
      const ac = new AbortController();
      abortRef.current = ac;

      const req: EditRequest = {
        sessionId: useDocumentStore.getState().threadId ?? undefined,
        instruction: text.trim(),
        selectedText: capture.selectedText,
        context: adapter.selectionContext(),
      };
      try {
        const agent = await getAgent();
        let acc = "";
        for await (const ev of agent.edit(req, ac.signal)) {
          if (ev.type === "session") {
            useDocumentStore.getState().bindThreadId(ev.sessionId);
          } else if (ev.type === "delta") {
            acc += ev.text;
            setStreamed(acc);
          } else if (ev.type === "done") {
            setReplacement(ev.replacement);
            setPhase("review");
          } else if (ev.type === "error") {
            setError(ev.message);
            setPhase("error");
          }
        }
      } catch (err) {
        if (ac.signal.aborted) return; // user cancelled — popover already closed
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [adapter, capture],
  );

  const accept = useCallback(() => {
    if (!adapter || !capture || !replacement) return;
    adapter.replaceRange(capture.range, replacement);
    useDocumentStore.getState().setDirty(true);
    close();
  }, [adapter, capture, replacement, close]);

  // Global keys while open: Esc rejects/closes; Enter accepts in review.
  useEffect(() => {
    if (!capture) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === "Enter" && phase === "review") {
        e.preventDefault();
        e.stopPropagation();
        accept();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [capture, phase, accept, close]);

  if (!capture) return null;

  // Position: under the selection, clamped; flip above when too low.
  const left = Math.min(Math.max(capture.rect.left, 8), window.innerWidth - WIDTH - 8);
  const below = capture.rect.bottom + 8;
  const flip = below > window.innerHeight - 280;
  const style: React.CSSProperties = flip
    ? { left, bottom: window.innerHeight - capture.rect.top + 8, width: WIDTH }
    : { left, top: below, width: WIDTH };

  return (
    <div className="dp-popover dp-inline-edit" style={style} ref={popRef}>
      <div className="dp-pop-body">
        {phase === "input" && (
          <>
            <input
              ref={inputRef}
              className="dp-pop-input"
              placeholder="이 선택 부분을 어떻게 고칠까요?"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && instruction.trim()) {
                  e.preventDefault();
                  void submit(instruction);
                }
              }}
            />
            <div className="dp-quick">
              {QUICK_CHIPS.map(([label, text]) => (
                <button key={label} className="dp-chip" onClick={() => void submit(text)}>
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        {phase === "streaming" && (
          <>
            <div className="dp-streaming">
              <span className="dp-spinner" /> rewriting…
            </div>
            {streamed && <div className="dp-preview">{streamed}</div>}
          </>
        )}

        {phase === "review" && (
          <>
            <div className="dp-diff">
              <div className="dp-old">{capture.selectedText}</div>
              <div className="dp-new">{replacement}</div>
            </div>
            <div className="dp-actions">
              <button className="dp-btn dp-primary" onClick={accept}>
                Accept ⏎
              </button>
              <button className="dp-btn" onClick={close}>
                Reject Esc
              </button>
              <button
                className="dp-btn"
                title="Try a different instruction"
                onClick={() => {
                  setPhase("input");
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              >
                ↻ Retry
              </button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <div className="dp-error">⚠ {error}</div>
            <div className="dp-actions">
              <button className="dp-btn" onClick={() => setPhase("input")}>
                Try again
              </button>
              <button className="dp-btn" onClick={close}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
