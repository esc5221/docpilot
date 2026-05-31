/**
 * @docpilot/shared — single source of truth for the contract between
 * the React frontend and the Bun sidecar. Both sides import from here so the
 * wire protocol can never silently drift.
 */

// ── Document context sent alongside an edit ─────────────────────────────────

/** Surrounding context for a selection. We never send the whole document. */
export interface DocContext {
  /** Document title or first heading, for high-level grounding. */
  title?: string;
  /** Heading outline (e.g. ["# Intro", "## Goals"]) for structure awareness. */
  outline?: string[];
  /** Text immediately before the selection. */
  before?: string;
  /** Text immediately after the selection. */
  after?: string;
}

// ── Requests (frontend → sidecar) ───────────────────────────────────────────

/** A surgical edit of a selected range. */
export interface EditRequest {
  /** Existing codex thread id; omit for the first edit of a document. */
  sessionId?: string;
  /** Natural-language instruction, e.g. "더 간결하게". */
  instruction: string;
  /** The exact text the user selected. */
  selectedText: string;
  /** Surrounding context (not the whole doc — keeps cache stable, cost low). */
  context: DocContext;
}

/** A free-form chat turn in the side panel. */
export interface ChatRequest {
  sessionId?: string;
  message: string;
  /** Optional document grounding for the chat. */
  context?: DocContext;
  /** Text the user selected in the editor, attached as a context pill. */
  selection?: string;
}

// ── Streamed events (sidecar → frontend, one SSE `data:` line each) ──────────

/**
 * Emitted first when a brand-new thread is created so the frontend can persist
 * the id against the document. Not emitted on resume.
 */
export interface SessionEvent {
  type: "session";
  sessionId: string;
}

/** A streamed chunk of the rewritten text (for live inline preview). */
export interface DeltaEvent {
  type: "delta";
  text: string;
}

/** Token accounting for a completed turn. `cached` reflects prompt-cache hits. */
export interface TurnUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** Terminal success: the full replacement text for the selection. */
export interface EditDoneEvent {
  type: "done";
  replacement: string;
  usage?: TurnUsage;
}

/** Terminal success for chat. */
export interface ChatDoneEvent {
  type: "done";
  reply: string;
  usage?: TurnUsage;
}

/** Terminal failure. */
export interface StreamErrorEvent {
  type: "error";
  message: string;
}

export type EditStreamEvent =
  | SessionEvent
  | DeltaEvent
  | EditDoneEvent
  | StreamErrorEvent;

export type ChatStreamEvent =
  | SessionEvent
  | DeltaEvent
  | ChatDoneEvent
  | StreamErrorEvent;

// ── Sidecar handshake (sidecar stdout line 1 → Rust shell) ──────────────────

/** Printed by the sidecar on startup so the Rust shell can reach it. */
export interface SidecarReady {
  type: "ready";
  port: number;
  token: string;
}
