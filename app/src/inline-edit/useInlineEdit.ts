import { useCallback, useRef, useState } from "react";
import type { EditRequest } from "@docpilot/shared";
import { getAgent } from "../agent/agentSingleton";
import type { EditorAdapter, SelRange } from "../editor/EditorAdapter";
import { useDocumentStore } from "../documents/documentStore";

export type InlineStatus = "idle" | "prompting" | "streaming" | "review" | "error";

export interface InlineEditState {
  status: InlineStatus;
  /** Viewport anchor for the popover. */
  anchor: { x: number; y: number } | null;
  selectedText: string;
  streamText: string;
  replacement: string;
  error: string;
}

const INITIAL: InlineEditState = {
  status: "idle",
  anchor: null,
  selectedText: "",
  streamText: "",
  replacement: "",
  error: "",
};

/**
 * Drives the select → instruct → stream → diff → accept/reject loop against any
 * {@link EditorAdapter}. The document is never mutated until the user accepts,
 * and acceptance is a single editor operation so it lands in the undo stack.
 */
export function useInlineEdit(adapter: EditorAdapter | null) {
  const [state, setState] = useState<InlineEditState>(INITIAL);
  const rangeRef = useRef<SelRange | null>(null);
  const contextRef = useRef<EditRequest["context"]>({});
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    rangeRef.current = null;
    adapter?.setPending(null);
    setState(INITIAL);
  }, [adapter]);

  /** Open the prompt popover for the current selection. */
  const begin = useCallback(() => {
    if (!adapter) return;
    const target = adapter.captureSelection();
    if (!target) return;

    rangeRef.current = target.range;
    contextRef.current = target.context;
    adapter.setPending(target.range);

    setState({
      ...INITIAL,
      status: "prompting",
      anchor: target.anchor,
      selectedText: target.text,
    });
  }, [adapter]);

  /** Send the instruction and stream the rewrite. */
  const submit = useCallback(
    async (instruction: string) => {
      const range = rangeRef.current;
      if (!adapter || !range || !instruction.trim()) return;

      const { threadId, bindThreadId } = useDocumentStore.getState();
      const req: EditRequest = {
        sessionId: threadId ?? undefined,
        instruction: instruction.trim(),
        selectedText: state.selectedText,
        context: contextRef.current,
      };

      const abort = new AbortController();
      abortRef.current = abort;
      setState((s) => ({ ...s, status: "streaming", streamText: "", error: "" }));

      try {
        const agent = await getAgent();
        for await (const ev of agent.edit(req, abort.signal)) {
          if (ev.type === "session") {
            bindThreadId(ev.sessionId);
          } else if (ev.type === "delta") {
            setState((s) => ({ ...s, streamText: s.streamText + ev.text }));
          } else if (ev.type === "done") {
            setState((s) => ({ ...s, status: "review", replacement: ev.replacement }));
          } else if (ev.type === "error") {
            setState((s) => ({ ...s, status: "error", error: ev.message }));
          }
        }
      } catch (err) {
        if (abort.signal.aborted) return; // user cancelled
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [adapter, state.selectedText],
  );

  /** Apply the rewrite as one undoable operation. */
  const accept = useCallback(() => {
    const range = rangeRef.current;
    if (!adapter || !range || !state.replacement) return reset();
    adapter.applyReplacement(range, state.replacement);
    useDocumentStore.getState().setDirty(true);
    reset();
  }, [adapter, state.replacement, reset]);

  const cancel = useCallback(() => {
    reset();
    adapter?.focus();
  }, [adapter, reset]);

  return { state, begin, submit, accept, cancel };
}
