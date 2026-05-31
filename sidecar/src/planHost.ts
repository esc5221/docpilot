/**
 * planHost — turns a natural-language instruction into a structured EditPlan.
 *
 * The model only PLANS; the app applies the ops via the editor's structured API
 * (so OOXML fidelity, undo, and review stay local and deterministic). We ask for
 * strict JSON in the prompt and parse it tolerantly — more robust across codex
 * versions than relying on output-schema strict mode.
 */

import type { EditPlan, PlanRequest, PlanStreamEvent } from "../../packages/shared/src/index";
import { appServer } from "./appserver";

function buildPlanPrompt(req: PlanRequest): string {
  const lines: string[] = [
    "You are a meticulous document editor. Turn the INSTRUCTION into a JSON edit plan.",
    "You do NOT apply edits; you emit a plan the application will apply.",
    "",
    "Operation vocabulary (each op is an object with an \"op\" field):",
    '- {"op":"replace_text","paraId":"<id>","search":"<exact substring>","replaceWith":"<new text>"}',
    '- {"op":"insert_after_paragraph","paraId":"<id>","text":"<new paragraph text>"}',
    '- {"op":"set_paragraph_style","paraId":"<id>","styleId":"Heading1|Heading2|Heading3|Normal|Quote"}',
    '- {"op":"add_comment","paraId":"<id>","search":"<exact substring>","comment":"<comment text>"}',
    "",
    "Rules:",
    "- Only make changes the INSTRUCTION asks for. Be surgical; do not rewrite the whole document.",
    "- `search` MUST be an exact substring of the referenced paragraph's text.",
    "- Target paragraphs by their paraId from the CONTEXT below.",
    "- Preserve meaning and language unless the instruction says otherwise.",
    "- Output ONLY a single JSON object. No prose, no markdown fences.",
    "",
    'JSON shape: {"summary":"<one line>","ops":[ ... ]}',
    "",
  ];

  if (req.docKind === "markdown") {
    lines.push(
      "This is a MARKDOWN document — omit paraId and target by `search`/`replaceWith` only.",
      "",
      "[DOCUMENT TEXT]",
      req.text ?? "",
    );
  } else {
    lines.push("[PARAGRAPHS] (paraId :: text)");
    for (const p of req.paragraphs ?? []) lines.push(`${p.paraId} :: ${p.text}`);
  }

  if (req.selection) lines.push("", "[USER SELECTION]", req.selection);
  lines.push("", "[INSTRUCTION]", req.instruction);
  return lines.join("\n");
}

/** Extract a JSON object from the model's final message, tolerating stray text. */
function parsePlan(text: string): EditPlan {
  let s = text.trim();
  // Strip ```json fences if present.
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // Fall back to the outermost {...} span.
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);

  const parsed = JSON.parse(s) as Partial<EditPlan>;
  if (!parsed || !Array.isArray(parsed.ops)) {
    throw new Error("model did not return a valid ops array");
  }
  return { summary: parsed.summary ?? "문서 수정", ops: parsed.ops };
}

/** Plan an edit. Emits the new session id (if any), then the parsed plan. */
export async function* plan(req: PlanRequest): AsyncGenerator<PlanStreamEvent> {
  try {
    let finalText = "";
    let sessionId: string | undefined;
    for await (const e of appServer().runTurn({
      sessionId: req.sessionId,
      prompt: buildPlanPrompt(req),
    })) {
      if (e.kind === "session") {
        sessionId = e.threadId;
        yield { type: "session", sessionId: e.threadId };
      } else if (e.kind === "final") {
        finalText = e.text;
      }
    }
    yield { type: "plan", plan: parsePlan(finalText) };
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
