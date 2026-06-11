import { useEffect, useRef, useState } from "react";
import type { AgentEditRequest, ChatRequest } from "@docpilot/shared";
import { getAgent } from "../agent/agentSingleton";
import type { EditorAdapter } from "../editor/EditorAdapter";
import { useDocumentStore } from "../documents/documentStore";
import { useSelectionStore } from "../state/selectionStore";
import { useUiStore } from "../state/uiStore";
import {
  type ChatMessage,
  type ChatStep,
  type EditTargetRef,
  useSessionsStore,
} from "../state/sessionsStore";
import { computeDiff } from "../util/diffText";
import { renderMarkdown } from "../util/renderMarkdown";
import { hasSnapshot, stashSnapshot, takeSnapshot } from "../util/revertStore";

type Mode = "ask" | "edit";

interface Props {
  adapter: EditorAdapter | null;
}

const EDIT_CHIPS: Array<[string, string]> = [
  ["문법 교정", "문서 전체의 문법과 맞춤법을 교정해줘"],
  ["간결하게", "문서를 더 간결하게 다듬어줘"],
  ["제목 다듬기", "제목과 소제목을 더 명확하게 다듬어줘"],
];

const ASK_CHIPS: Array<[string, string]> = [
  ["요약", "이 문서를 3줄로 요약해줘"],
  ["피드백", "이 문서에서 개선할 점을 알려줘"],
  ["구조 제안", "이 문서의 구조를 어떻게 바꾸면 좋을지 제안해줘"],
];

/** Strip the "/bin/zsh -lc '...'" wrapper Codex uses, for a clean command line. */
function prettyCommand(cmd: string): string {
  const m = cmd.match(/^(?:\S*\/)?(?:bash|sh|zsh)\s+-lc\s+(['"])([\s\S]*)\1$/);
  return (m ? m[2] : cmd).trim();
}

function basename(path: string | null): string {
  if (!path) return "Untitled";
  return path.split(/[\\/]/).pop() ?? path;
}

function relativeTime(ts: number): string {
  const d = Date.now() - ts;
  const min = Math.floor(d / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function ChatPanel({ adapter }: Props) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("edit");
  const [busy, setBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selection = useSelectionStore((s) => s.snapshot);
  const clearSelection = useSelectionStore((s) => s.clear);
  const chatFocusNonce = useUiStore((s) => s.chatFocusNonce);

  // ⌘L: focus the composer.
  useEffect(() => {
    if (chatFocusNonce > 0) inputRef.current?.focus();
  }, [chatFocusNonce]);

  const toggleSteps = (i: number) =>
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  /** Jump to + flash the region an edit targeted. */
  const anchorClick = async (t: EditTargetRef) => {
    if (!t.anchor || !adapter) return;
    const r = await adapter.anchorTo(t.anchor);
    if (r) adapter.flashRange(r);
  };

  const sessions = useSessionsStore((s) => s.sessions);
  const currentId = useSessionsStore((s) => s.currentId);
  const current = sessions.find((s) => s.id === currentId);
  const messages = current?.messages ?? [];

  useEffect(() => {
    void useSessionsStore.getState().load();
  }, []);

  // ── message helpers (operate on the current session via the store) ────────
  const store = () => useSessionsStore.getState();
  const curMessages = (): ChatMessage[] => {
    const st = store();
    return st.sessions.find((s) => s.id === st.currentId)?.messages ?? [];
  };
  const replaceLast = (text: string) => {
    const next = [...curMessages()];
    next[next.length - 1] = { role: "assistant", text };
    store().setMessages(next);
  };
  const appendLast = (delta: string) => {
    const next = [...curMessages()];
    const last = next[next.length - 1];
    next[next.length - 1] = { ...last, role: "assistant", text: last.text + delta };
    store().setMessages(next);
  };
  /** Patch the last (assistant) message in place. */
  const patchLast = (fn: (m: ChatMessage) => ChatMessage) => {
    const next = [...curMessages()];
    next[next.length - 1] = fn(next[next.length - 1]);
    store().setMessages(next);
  };
  const patchAt = (i: number, fn: (m: ChatMessage) => ChatMessage) => {
    const next = [...curMessages()];
    if (!next[i]) return;
    next[i] = fn(next[i]);
    store().setMessages(next);
  };

  /** Restore the document to the snapshot taken before this edit. */
  const revert = async (index: number, revertId: string) => {
    const snap = takeSnapshot(revertId);
    if (!snap || !adapter) return;
    await adapter.reload(snap);
    useDocumentStore.getState().setDirty(true);
    patchAt(index, (m) => ({ ...m, diff: undefined, revertId: undefined, text: "↩ Reverted" }));
    store().persist();
  };
  const scrollDown = () =>
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));

  // ── turns ─────────────────────────────────────────────────────────────────
  const runAsk = async (text: string, image: string | null, signal: AbortSignal) => {
    const req: ChatRequest = {
      sessionId: store().sessions.find((s) => s.id === store().currentId)?.threadId ?? undefined,
      message: text,
      context: adapter?.docContext(),
      selection: selection?.text || undefined,
      imageBase64: image ?? undefined,
    };
    const agent = await getAgent();
    for await (const ev of agent.chat(req, signal)) {
      if (ev.type === "session") store().bindThread(ev.sessionId);
      else if (ev.type === "delta") appendLast(ev.text);
      else if (ev.type === "error") replaceLast(`⚠ ${ev.message}`);
    }
  };

  const runEdit = async (text: string, image: string | null, signal: AbortSignal) => {
    if (!adapter) {
      replaceLast("문서를 먼저 열어주세요. (Ask 모드는 문서 없이도 됩니다)");
      return;
    }
    // Snapshot the doc (both the request payload and the revert point) + its
    // text, so we can diff before → after once the edit lands.
    const snapshot = await adapter.collectDoc();
    const beforeText = adapter.getPlainText();
    const req: AgentEditRequest = {
      docKind: adapter.kind,
      instruction: text,
      selection: selection?.text || undefined,
      text: snapshot.text,
      docBase64: snapshot.docBase64,
      imageBase64: image ?? undefined,
    };
    const agent = await getAgent();
    // Append streamed text (reasoning / narration) to the timeline, merging
    // consecutive chunks of the same kind so order is preserved against commands.
    const appendText = (kind: "reasoning" | "text", text: string) =>
      patchLast((m) => {
        const steps = [...(m.steps ?? [])];
        const last = steps[steps.length - 1];
        if (last?.kind === kind) steps[steps.length - 1] = { ...last, text: last.text + text };
        else steps.push({ kind, text });
        return { ...m, steps };
      });

    for await (const ev of agent.agentEdit(req, signal)) {
      if (ev.type === "command") {
        patchLast((m) => {
          const steps = [...(m.steps ?? [])];
          const i = steps.findIndex((s) => s.kind === "command" && s.id === ev.id);
          const step: ChatStep = { kind: "command", id: ev.id, text: ev.command, status: ev.status };
          if (i >= 0) steps[i] = step;
          else steps.push(step);
          return { ...m, steps };
        });
      } else if (ev.type === "reasoning") {
        appendText("reasoning", ev.text);
      } else if (ev.type === "progress") {
        // The agent's narration — part of the timeline, not a trailing block.
        appendText("text", ev.text);
      } else if (ev.type === "done") {
        await adapter.reload({ text: ev.text, docBase64: ev.docBase64 });
        useDocumentStore.getState().setDirty(true);
        const diff = computeDiff(beforeText, adapter.getPlainText());
        const revertId = stashSnapshot(snapshot);
        patchLast((m) => ({
          ...m,
          text: ev.summary ? `✏️ ${ev.summary}` : m.text,
          diff: diff.length ? diff : undefined,
          revertId,
        }));
      } else if (ev.type === "error") {
        patchLast((m) => ({ ...m, text: `⚠ ${ev.message}` }));
      }
      scrollDown();
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const send = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if (!text || busy) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;

    // Title a fresh chat from its first message.
    const cur = store().sessions.find((s) => s.id === store().currentId);
    if (cur && cur.title === "New chat") store().rename(cur.id, text.slice(0, 40));

    // For an edit turn, capture which document + region it targets.
    let editTarget: EditTargetRef | undefined;
    if (mode === "edit" && adapter) {
      const { path, kind } = useDocumentStore.getState();
      const sel = useSelectionStore.getState().snapshot;
      editTarget = {
        docKind: kind,
        docName: basename(path),
        selectionPreview: sel?.preview ?? "",
        selectionLength: sel?.text.length ?? 0,
        anchor: sel?.anchor,
        capturedAt: Date.now(),
      };
    }

    store().setMessages([
      ...curMessages(),
      { role: "user", text },
      { role: "assistant", text: "", messageKind: mode, editTarget },
    ]);

    try {
      const image = adapter?.capturePageImage ? await adapter.capturePageImage() : null;
      if (mode === "edit") await runEdit(text, image, ac.signal);
      else await runAsk(text, image, ac.signal);
    } catch (err) {
      if (ac.signal.aborted) {
        patchLast((m) => ({ ...m, text: m.text ? `${m.text}\n\n⏹ 중단됨` : "⏹ 중단됨" }));
      } else {
        replaceLast(`⚠ ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setBusy(false);
      store().persist();
      scrollDown();
    }
  };

  const copyMessage = async (i: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  const chips = mode === "edit" ? EDIT_CHIPS : ASK_CHIPS;
  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="dp-chat-inner">
      {/* Session bar */}
      <div className="dp-chat-header">
        <button className="dp-session-current" onClick={() => setListOpen((v) => !v)}>
          {current?.title ?? "New chat"} <span className="dp-caret">▾</span>
        </button>
        <button
          className="dp-session-new"
          title="New chat"
          onClick={() => {
            store().create();
            setListOpen(false);
          }}
        >
          +
        </button>
      </div>

      {listOpen && (
        <div className="dp-session-list">
          {sortedSessions.map((s) => (
            <div key={s.id} className={`dp-session-item ${s.id === currentId ? "is-on" : ""}`}>
              {editingId === s.id ? (
                <input
                  className="dp-session-rename"
                  defaultValue={s.title}
                  autoFocus
                  onBlur={(e) => {
                    store().rename(s.id, e.target.value.trim() || "Untitled");
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <button
                  className="dp-session-pick"
                  onClick={() => {
                    store().switchTo(s.id);
                    setListOpen(false);
                  }}
                  onDoubleClick={() => setEditingId(s.id)}
                >
                  {s.title}
                  <span className="dp-session-time">{relativeTime(s.updatedAt)}</span>
                </button>
              )}
              <button className="dp-session-act" title="Rename" onClick={() => setEditingId(s.id)}>
                ✎
              </button>
              <button className="dp-session-act" title="Delete" onClick={() => store().remove(s.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Log */}
      <div className="dp-chat-log" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="dp-chat-empty">
            <div className="dp-chat-empty-title">
              <b>Edit</b>는 문서를 고치고, <b>Ask</b>는 문서에 대해 답합니다.
            </div>
            드래그한 선택 영역이 자동으로 컨텍스트가 됩니다.
            <br />
            선택 후 <kbd>⌘K</kbd>로 그 자리에서 바로 고칠 수도 있어요.
          </div>
        )}
        {messages.map((m, i) => {
          const hasSteps = !!(m.steps && m.steps.length);
          const expanded =
            expandedSteps.has(i) ||
            (busy && i === messages.length - 1) ||
            m.text.startsWith("⚠");
          return (
            <div key={i} className={`dp-msg dp-msg-${m.role}`}>
              {m.editTarget && (
                <button
                  className="dp-ctx-chip"
                  disabled={!m.editTarget.anchor || !adapter}
                  title="Jump to this region"
                  onClick={() => void anchorClick(m.editTarget!)}
                >
                  <span className="dp-ctx-doc">📄 {m.editTarget.docName}</span>
                  {m.editTarget.selectionPreview && (
                    <span className="dp-ctx-sel">{m.editTarget.selectionPreview}</span>
                  )}
                </button>
              )}

              {m.text ? (
                m.role === "assistant" ? (
                  <div
                    className="dp-msg-text dp-md"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }}
                  />
                ) : (
                  <div className="dp-msg-text">{m.text}</div>
                )
              ) : busy && i === messages.length - 1 && !hasSteps ? (
                <span className="dp-thinking">
                  <span className="dp-spinner-xs" /> thinking…
                </span>
              ) : null}

              {hasSteps && (
                <div className="dp-steps-wrap">
                  <button className="dp-steps-toggle" onClick={() => toggleSteps(i)}>
                    {expanded ? "▾" : "▸"} Details ({m.steps!.length})
                  </button>
                  {expanded && (
                    <div className="dp-steps">
                      {m.steps!.map((s, j) =>
                        s.kind === "command" ? (
                          <div key={j} className={`dp-step dp-step-cmd is-${s.status}`}>
                            <span className="dp-step-icon">
                              {s.status === "running" ? (
                                <span className="dp-spinner-xs" />
                              ) : s.status === "failed" ? (
                                "✗"
                              ) : (
                                "✓"
                              )}
                            </span>
                            <code>{prettyCommand(s.text)}</code>
                          </div>
                        ) : s.kind === "reasoning" ? (
                          <div key={j} className="dp-step dp-step-reason">
                            {s.text}
                          </div>
                        ) : (
                          <div key={j} className="dp-step dp-step-text">
                            {s.text}
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              )}

              {m.diff && m.diff.length > 0 && (
                <div className="dp-diff-block">
                  {m.diff.map((p, j) => (
                    <pre key={j} className={`dp-diff-line dp-diff-${p.kind}`}>
                      {p.text}
                    </pre>
                  ))}
                </div>
              )}

              {(m.revertId && hasSnapshot(m.revertId)) || (m.role === "assistant" && m.text) ? (
                <div className="dp-msg-actions">
                  {m.revertId && hasSnapshot(m.revertId) && (
                    <button className="dp-revert" onClick={() => void revert(i, m.revertId!)}>
                      ↩ Revert
                    </button>
                  )}
                  {m.role === "assistant" && m.text && (
                    <button
                      className="dp-msg-copy"
                      title="Copy"
                      onClick={() => void copyMessage(i, m.text)}
                    >
                      {copied === i ? "✓ Copied" : "⧉ Copy"}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div className="dp-composer">
        <div className="dp-composer-top">
          <div className="dp-mode">
            <button
              className={`dp-seg ${mode === "edit" ? "is-on" : ""}`}
              title="문서를 고칩니다"
              onClick={() => setMode("edit")}
            >
              Edit
            </button>
            <button
              className={`dp-seg ${mode === "ask" ? "is-on" : ""}`}
              title="문서에 대해 묻습니다"
              onClick={() => setMode("ask")}
            >
              Ask
            </button>
          </div>
          {!busy && !input && messages.length === 0 && (
            <div className="dp-composer-chips">
              {chips.map(([label, text]) => (
                <button key={label} className="dp-chip" onClick={() => void send(text)}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {selection && (
          <div className="dp-context-pill">
            <span className="dp-context-tag">{selection.text.length} chars</span>
            <span className="dp-context-snippet">{selection.preview}</span>
            <button className="dp-context-x" title="Remove context" onClick={clearSelection}>
              ✕
            </button>
          </div>
        )}

        <div className="dp-composer-row">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            placeholder={mode === "edit" ? "문서를 어떻게 고칠까요?" : "무엇이든 물어보세요…"}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {busy ? (
            <button className="dp-btn dp-stop" title="Stop" onClick={stop}>
              ◼ Stop
            </button>
          ) : (
            <button className="dp-btn dp-primary" onClick={() => void send()} disabled={!input.trim()}>
              {mode === "edit" ? "Edit" : "Send"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
