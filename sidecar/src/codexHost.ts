/**
 * codexHost — builds prompts and maps Codex turns to the docpilot wire events.
 *
 * Transport is the app-server client (see appserver.ts), which gives real token
 * streaming. Codex is driven as a pure text transformer: read-only sandbox, no
 * approvals, and prompts that forbid tool use — we only want rewritten text.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ChatRequest,
  ChatStreamEvent,
  DocContext,
  EditRequest,
  EditStreamEvent,
} from "../../packages/shared/src/index";
import { appServer } from "./appserver";

function renderContext(ctx: DocContext): string {
  const parts: string[] = [];
  if (ctx.title) parts.push(`[DOCUMENT TITLE]\n${ctx.title}`);
  if (ctx.outline?.length) parts.push(`[OUTLINE]\n${ctx.outline.join("\n")}`);
  if (ctx.before) parts.push(`[TEXT BEFORE SELECTION]\n${ctx.before}`);
  if (ctx.after) parts.push(`[TEXT AFTER SELECTION]\n${ctx.after}`);
  return parts.join("\n\n");
}

function buildEditPrompt(req: EditRequest): string {
  return [
    "You are a precise in-document text editor, like Cursor but for prose.",
    "Rewrite ONLY the SELECTED TEXT according to the INSTRUCTION.",
    "",
    "Hard rules:",
    "- Output ONLY the rewritten selection. No preamble, no commentary,",
    "  no surrounding quotes, no markdown code fences.",
    "- Keep the original language unless the instruction says otherwise.",
    "- Preserve meaning unless the instruction explicitly asks to change it.",
    "- Match the surrounding style and formatting.",
    "- Never call tools, run commands, or read files. Answer directly.",
    "",
    renderContext(req.context),
    "",
    "[INSTRUCTION]",
    req.instruction,
    "",
    "[SELECTED TEXT]",
    req.selectedText,
  ].join("\n");
}

function buildChatPrompt(req: ChatRequest): string {
  const ctx = req.context ? renderContext(req.context) : "";
  return [
    "You are a helpful writing assistant inside a document editor.",
    "Answer concisely. Never call tools or run commands; answer directly.",
    ctx ? "\n" + ctx : "",
    req.selection ? `\n[SELECTED TEXT THE USER IS REFERRING TO]\n${req.selection}` : "",
    "\n[USER]",
    req.message,
  ].join("\n");
}

/** Stream a surgical edit of a selection. */
export async function* edit(req: EditRequest, signal?: AbortSignal): AsyncGenerator<EditStreamEvent> {
  try {
    for await (const e of appServer().runTurn({
      sessionId: req.sessionId,
      prompt: buildEditPrompt(req),
      signal,
    })) {
      if (e.kind === "session") yield { type: "session", sessionId: e.threadId };
      else if (e.kind === "delta") yield { type: "delta", text: e.text };
      else yield { type: "done", replacement: e.text.trim(), usage: e.usage };
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** Stream a side-panel chat reply. */
export async function* chat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
  // Stage an attached page image to a temp file (Codex needs a path).
  let imageDir: string | undefined;
  const imagePaths: string[] = [];
  if (req.imageBase64) {
    imageDir = mkdtempSync(join(tmpdir(), "docpilot-img-"));
    const path = join(imageDir, "page.png");
    writeFileSync(path, Buffer.from(req.imageBase64, "base64"));
    imagePaths.push(path);
  }
  try {
    for await (const e of appServer().runTurn({
      sessionId: req.sessionId,
      prompt: buildChatPrompt(req),
      imagePaths,
      signal,
    })) {
      if (e.kind === "session") yield { type: "session", sessionId: e.threadId };
      else if (e.kind === "delta") yield { type: "delta", text: e.text };
      else yield { type: "done", reply: e.text, usage: e.usage };
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  } finally {
    if (imageDir) rmSync(imageDir, { recursive: true, force: true });
  }
}
