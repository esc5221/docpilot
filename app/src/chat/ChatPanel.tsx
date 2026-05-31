import { useEffect, useRef, useState } from "react";
import type { AgentEditRequest, ChatRequest } from "@docpilot/shared";
import { getAgent } from "../agent/agentSingleton";
import type { EditorAdapter } from "../editor/EditorAdapter";
import { useDocumentStore } from "../documents/documentStore";
import { useSelectionStore } from "../state/selectionStore";
import { type ChatMessage, useSessionsStore } from "../state/sessionsStore";

type Mode = "ask" | "edit";

interface Props {
  adapter: EditorAdapter | null;
}

export function ChatPanel({ adapter }: Props) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("edit");
  const [busy, setBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selection = useSelectionStore((s) => s.text);
  const clearSelection = useSelectionStore((s) => s.clear);

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
    next[next.length - 1] = { role: "assistant", text: last.text + delta };
    store().setMessages(next);
  };
  const scrollDown = () =>
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));

  // ── turns ─────────────────────────────────────────────────────────────────
  const runAsk = async (text: string, image: string | null) => {
    const req: ChatRequest = {
      sessionId: store().sessions.find((s) => s.id === store().currentId)?.threadId ?? undefined,
      message: text,
      context: adapter?.docContext(),
      selection: selection || undefined,
      imageBase64: image ?? undefined,
    };
    const agent = await getAgent();
    for await (const ev of agent.chat(req)) {
      if (ev.type === "session") store().bindThread(ev.sessionId);
      else if (ev.type === "delta") appendLast(ev.text);
      else if (ev.type === "error") replaceLast(`⚠ ${ev.message}`);
    }
  };

  const runEdit = async (text: string, image: string | null) => {
    if (!adapter) {
      replaceLast("Open a document first.");
      return;
    }
    const doc = await adapter.collectDoc();
    const req: AgentEditRequest = {
      docKind: adapter.kind,
      instruction: text,
      selection: selection || undefined,
      text: doc.text,
      docBase64: doc.docBase64,
      imageBase64: image ?? undefined,
    };
    const agent = await getAgent();
    let progress = "";
    for await (const ev of agent.agentEdit(req)) {
      if (ev.type === "progress") {
        progress += ev.text;
        replaceLast(progress);
      } else if (ev.type === "done") {
        await adapter.reload({ text: ev.text, docBase64: ev.docBase64 });
        useDocumentStore.getState().setDirty(true);
        replaceLast(`✏️ ${ev.summary}`);
      } else if (ev.type === "error") {
        replaceLast(`⚠ ${ev.message}`);
      }
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);

    // Title a fresh chat from its first message.
    const cur = store().sessions.find((s) => s.id === store().currentId);
    if (cur && cur.title === "New chat") store().rename(cur.id, text.slice(0, 40));

    store().setMessages([...curMessages(), { role: "user", text }, { role: "assistant", text: "" }]);

    try {
      const image = adapter?.capturePageImage ? await adapter.capturePageImage() : null;
      if (mode === "edit") await runEdit(text, image);
      else await runAsk(text, image);
    } catch (err) {
      replaceLast(`⚠ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      store().persist();
      scrollDown();
    }
  };

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
          {sessions.map((s) => (
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
            <b>Edit</b> the document, or <b>Ask</b> a question.
            <br />
            Drag to select — it becomes context for your edit.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`dp-msg dp-msg-${m.role}`}>
            {m.text || (busy && i === messages.length - 1 ? "…" : "")}
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="dp-composer">
        <div className="dp-mode">
          <button className={`dp-seg ${mode === "edit" ? "is-on" : ""}`} onClick={() => setMode("edit")}>
            Edit
          </button>
          <button className={`dp-seg ${mode === "ask" ? "is-on" : ""}`} onClick={() => setMode("ask")}>
            Ask
          </button>
        </div>

        {selection && (
          <div className="dp-context-pill">
            <span className="dp-context-tag">{selection.length} chars</span>
            <span className="dp-context-snippet">{selection}</span>
            <button className="dp-context-x" title="Remove context" onClick={clearSelection}>
              ✕
            </button>
          </div>
        )}

        <div className="dp-composer-row">
          <textarea
            value={input}
            placeholder={mode === "edit" ? "How should I change this document?" : "Message…"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="dp-btn dp-primary" onClick={() => void send()} disabled={busy}>
            {mode === "edit" ? "Edit" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
