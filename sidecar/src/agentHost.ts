/**
 * agentHost — agentic document editing. Instead of one-shot planning, Codex
 * DRIVES: it reads the real file, edits it, re-reads to verify, and retries
 * until done. We give it an isolated work dir (a copy of the doc + the headless
 * engine + a guide), run a workspace-write turn, then read the file back.
 *
 * docx fidelity is preserved because the headless engine is the same core as
 * the live editor. The save recipe in the guide is mandatory — the engine's
 * toBuffer/repackDocx are broken on edited documents (they drop the original
 * zip handle); swapping document.xml into the original zip is the path that
 * works.
 */

import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEditRequest, AgentEditStreamEvent } from "../../packages/shared/src/index";
import { appServer } from "./appserver";

const require = createRequire(import.meta.url);

/** Locate the sidecar's node_modules so the work dir can symlink to it. */
function nodeModulesDir(): string {
  // Resolve a real export subpath, then walk back to the node_modules root.
  const entry = require.resolve("@eigenpal/docx-editor-core/headless");
  const marker = entry.indexOf("/@eigenpal/");
  if (marker === -1) throw new Error(`cannot locate node_modules from ${entry}`);
  return entry.slice(0, marker);
}

function docxGuide(file: string): string {
  return [
    `# Task: edit ./${file}`,
    "",
    "@eigenpal/docx-editor-core is installed (./node_modules). Do NOT search the filesystem.",
    "Write a Node ESM script and run it with `node <script>.mjs`.",
    "",
    "MANDATORY save recipe — toBuffer()/repackDocx()/createDocx() are BROKEN on edited",
    "docs (they drop the original zip). Use exactly this:",
    "",
    "```js",
    'import { DocumentAgent, serializeDocx, updateMultipleFiles } from "@eigenpal/docx-editor-core/headless";',
    'import { readFileSync, writeFileSync } from "node:fs";',
    `const load = () => { const b = readFileSync("${file}"); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };`,
    "const agent = await DocumentAgent.fromBuffer(load());",
    "console.log(agent.getText()); // inspect; paragraphs are 0-indexed, joined by '\\n'",
    "// edits are immutable — chain and keep the returned agent:",
    "const edited = agent.replaceRange(",
    "  { start: { paragraphIndex: I, offset: O }, end: { paragraphIndex: I, offset: O2 } },",
    '  "NEW TEXT",',
    ");",
    "// other ops: insertText({paragraphIndex,offset}, text), applyStyle(idx, 'Heading2'), deleteRange(range)",
    "const xml = serializeDocx(edited.getDocument());",
    `const out = await updateMultipleFiles(load(), new Map([["word/document.xml", xml]]));`,
    `writeFileSync("${file}", Buffer.from(out));`,
    "```",
    "",
    "Compute paragraphIndex/offset from agent.getText(). After saving, reload the file",
    "and print the changed paragraph to VERIFY before finishing. Make ONLY the requested change.",
  ].join("\n");
}

function markdownGuide(file: string): string {
  return [
    `# Task: edit ./${file}`,
    "",
    `This is a plain Markdown file. Edit ./${file} directly to satisfy the instruction.`,
    "Make ONLY the requested change; preserve everything else and the document's language.",
    "After editing, re-read the file to verify the change is correct before finishing.",
  ].join("\n");
}

export async function* agentEdit(req: AgentEditRequest): AsyncGenerator<AgentEditStreamEvent> {
  const work = mkdtempSync(join(tmpdir(), "docpilot-edit-"));
  const file = req.docKind === "docx" ? "document.docx" : "document.md";
  try {
    // Materialize the document + engine + guide in the isolated work dir.
    if (req.docKind === "docx") {
      writeFileSync(join(work, file), Buffer.from(req.docBase64 ?? "", "base64"));
      writeFileSync(join(work, "AGENTS.md"), docxGuide(file));
      // "junction" on Windows: directory symlinks there need admin/dev mode.
      symlinkSync(nodeModulesDir(), join(work, "node_modules"), process.platform === "win32" ? "junction" : undefined);
    } else {
      writeFileSync(join(work, file), req.text ?? "");
      writeFileSync(join(work, "AGENTS.md"), markdownGuide(file));
    }

    // Optional page screenshot for visual context.
    const imagePaths: string[] = [];
    if (req.imageBase64) {
      const img = join(work, "page.png");
      writeFileSync(img, Buffer.from(req.imageBase64, "base64"));
      imagePaths.push(img);
    }

    const prompt = [
      `Edit ./${file} per the instruction. Read AGENTS.md first and follow it exactly.`,
      req.imageBase64 ? "An image of the current page is attached for visual context." : "",
      req.selection ? `\nThe user has selected this text (focus your edit here):\n${req.selection}` : "",
      "\nWhen done, reply with ONE short sentence summarizing the change.",
      "Do NOT paste the document text or verification output in your reply — your tool steps already show the work.",
      `\n[INSTRUCTION]\n${req.instruction}`,
    ].join("\n");

    let summary = "";
    for await (const ev of appServer().runTurn({
      prompt,
      threadOpts: { sandbox: "workspace-write", approvalPolicy: "never", cwd: work },
      imagePaths,
    })) {
      if (ev.kind === "delta") yield { type: "progress", text: ev.text };
      else if (ev.kind === "command")
        yield { type: "command", id: ev.id, command: ev.command, status: ev.status };
      else if (ev.kind === "reasoning") yield { type: "reasoning", text: ev.text };
      else if (ev.kind === "final") summary = ev.text;
    }

    // Read the edited document back.
    if (req.docKind === "docx") {
      const bytes = readFileSync(join(work, file));
      yield { type: "done", docBase64: bytes.toString("base64"), summary: summary || "편집 완료" };
    } else {
      const text = readFileSync(join(work, file), "utf8");
      yield { type: "done", text, summary: summary || "편집 완료" };
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
