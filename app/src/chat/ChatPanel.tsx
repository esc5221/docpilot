import { useRef, useState } from "react";
import type { AgentEditRequest, ChatRequest } from "@docpilot/shared";
import { getAgent } from "../agent/agentSingleton";
import type { EditorAdapter } from "../editor/EditorAdapter";
import { useDocumentStore } from "../documents/documentStore";
import { useSelectionStore } from "../state/selectionStore";

type Mode = "ask" | "edit";

interface Message {
  role: "user" | "assistant";
  text: string;
}

interface Props {
  adapter: EditorAdapter | null;
}

export function ChatPanel({ adapter }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("edit");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selection = useSelectionStore((s) => s.text);
  const clearSelection = useSelectionStore((s) => s.clear);

  const replaceLast = (text: string) =>
    setMessages((m) => {
      const next = [...m];
      next[next.length - 1] = { role: "assistant", text };
      return next;
    });

  const appendLast = (delta: string) =>
    setMessages((m) => {
      const next = [...m];
      next[next.length - 1] = { role: "assistant", text: next[next.length - 1].text + delta };
      return next;
    });

  const scrollDown = () =>
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));

  const runAsk = async (text: string) => {
    const { threadId, bindThreadId } = useDocumentStore.getState();
    const req: ChatRequest = {
      sessionId: threadId ?? undefined,
      message: text,
      context: adapter?.docContext(),
      selection: selection || undefined,
    };
    const agent = await getAgent();
    for await (const ev of agent.chat(req)) {
      if (ev.type === "session") bindThreadId(ev.sessionId);
      else if (ev.type === "delta") appendLast(ev.text);
      else if (ev.type === "error") replaceLast(`⚠ ${ev.message}`);
    }
  };

  const runEdit = async (text: string) => {
    if (!adapter) {
      replaceLast("Open a document first.");
      return;
    }
    const { setDirty } = useDocumentStore.getState();
    const doc = await adapter.collectDoc();
    const req: AgentEditRequest = {
      docKind: adapter.kind,
      instruction: text,
      selection: selection || undefined,
      text: doc.text,
      docBase64: doc.docBase64,
    };
    const agent = await getAgent();
    let progress = "";
    for await (const ev of agent.agentEdit(req)) {
      if (ev.type === "progress") {
        progress += ev.text;
        replaceLast(progress); // Codex narrates as it drives the edit
      } else if (ev.type === "done") {
        await adapter.reload({ text: ev.text, docBase64: ev.docBase64 });
        setDirty(true);
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
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", text: "" }]);
    try {
      if (mode === "edit") await runEdit(text);
      else await runAsk(text);
    } catch (err) {
      replaceLast(`⚠ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      scrollDown();
    }
  };

  return (
    <div className="dp-chat-inner">
      <div className="dp-chat-header">AI</div>

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

      <div className="dp-composer">
        <div className="dp-mode">
          <button
            className={`dp-seg ${mode === "edit" ? "is-on" : ""}`}
            onClick={() => setMode("edit")}
          >
            Edit
          </button>
          <button
            className={`dp-seg ${mode === "ask" ? "is-on" : ""}`}
            onClick={() => setMode("ask")}
          >
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
