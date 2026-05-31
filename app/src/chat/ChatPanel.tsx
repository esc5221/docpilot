import { useRef, useState } from "react";
import type { ChatRequest } from "@docpilot/shared";
import { getAgent } from "../agent/agentSingleton";
import type { EditorAdapter } from "../editor/EditorAdapter";
import { useDocumentStore } from "../documents/documentStore";
import { useSelectionStore } from "../state/selectionStore";

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
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selection = useSelectionStore((s) => s.text);
  const clearSelection = useSelectionStore((s) => s.clear);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", text: "" }]);

    const { threadId, bindThreadId } = useDocumentStore.getState();
    const req: ChatRequest = {
      sessionId: threadId ?? undefined,
      message: text,
      context: adapter?.docContext(),
      selection: selection || undefined,
    };

    try {
      const agent = await getAgent();
      for await (const ev of agent.chat(req)) {
        if (ev.type === "session") {
          bindThreadId(ev.sessionId);
        } else if (ev.type === "delta") {
          setMessages((m) => {
            const next = [...m];
            next[next.length - 1] = {
              role: "assistant",
              text: next[next.length - 1].text + ev.text,
            };
            return next;
          });
        } else if (ev.type === "error") {
          setMessages((m) => {
            const next = [...m];
            next[next.length - 1] = { role: "assistant", text: `⚠ ${ev.message}` };
            return next;
          });
        }
      }
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      });
    }
  };

  return (
    <div className="dp-chat-inner">
      <div className="dp-chat-header">AI</div>

      <div className="dp-chat-log" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="dp-chat-empty">
            문서를 드래그하면 선택이 컨텍스트로 잡힙니다.
            <br />
            본문 수정은 <kbd>⌘K</kbd>, 질문은 여기에.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`dp-msg dp-msg-${m.role}`}>
            {m.text || (busy && i === messages.length - 1 ? "…" : "")}
          </div>
        ))}
      </div>

      <div className="dp-composer">
        {selection && (
          <div className="dp-context-pill">
            <span className="dp-context-tag">선택 {selection.length}자</span>
            <span className="dp-context-snippet">{selection}</span>
            <button className="dp-context-x" title="컨텍스트 해제" onClick={clearSelection}>
              ✕
            </button>
          </div>
        )}
        <div className="dp-composer-row">
          <textarea
            value={input}
            placeholder={selection ? "선택한 내용에 대해 물어보세요…" : "메시지…"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="dp-btn dp-primary" onClick={() => void send()} disabled={busy}>
            보내기
          </button>
        </div>
      </div>
    </div>
  );
}
