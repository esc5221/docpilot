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

// ── Structured document edits (the AI plans, the app applies) ────────────────

/**
 * A single mutation the app knows how to apply via the editor's structured API.
 * Targeting is by `paraId` (stable across turns) with `search` as a guard.
 */
export type MutationOp =
  | { op: "replace_text"; paraId?: string; search: string; replaceWith: string }
  | { op: "insert_after_paragraph"; paraId: string; text: string }
  | { op: "set_paragraph_style"; paraId: string; styleId: string }
  | { op: "add_comment"; paraId: string; search: string; comment: string };

/** The AI's proposed change set. `reviewMode` is decided by the app, not the model. */
export interface EditPlan {
  /** One-line human summary of what the plan does. */
  summary: string;
  ops: MutationOp[];
}

/** Paragraphs in scope (docx) so the model can target by stable paraId. */
export interface ScopeParagraph {
  paraId: string;
  text: string;
}

/** A request to PLAN edits (not apply them — the app applies). */
export interface PlanRequest {
  sessionId?: string;
  instruction: string;
  docKind: "markdown" | "docx";
  /** The user's current selection, if any. */
  selection?: string;
  /** docx: paragraphs in scope with stable ids. */
  paragraphs?: ScopeParagraph[];
  /** markdown: the in-scope text. */
  text?: string;
}

export type PlanStreamEvent =
  | SessionEvent
  | { type: "plan"; plan: EditPlan }
  | StreamErrorEvent;

// ── Agentic edit (Codex drives: reads the file, edits, verifies, retries) ────

export interface AgentEditRequest {
  docKind: "markdown" | "docx";
  instruction: string;
  /** The user's current selection, if any. */
  selection?: string;
  /** markdown document text (when docKind === "markdown"). */
  text?: string;
  /** docx bytes, base64-encoded (when docKind === "docx"). */
  docBase64?: string;
}

export type AgentEditStreamEvent =
  /** Codex's streamed narration of what it's doing. */
  | { type: "progress"; text: string }
  /** Terminal success — the edited document to load back. */
  | { type: "done"; text?: string; docBase64?: string; summary: string }
  | StreamErrorEvent;

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
