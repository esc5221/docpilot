import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export type DocKind = "markdown" | "docx";

export type LoadedDocument =
  | { kind: "markdown"; path: string; content: string; threadId: string | null }
  | { kind: "docx"; path: string; bytes: Uint8Array; threadId: string | null };

const FILTERS = [
  { name: "문서", extensions: ["md", "markdown", "txt", "docx"] },
  { name: "Markdown", extensions: ["md", "markdown", "txt"] },
  { name: "Word", extensions: ["docx"] },
];

function kindOf(path: string): DocKind {
  return /\.docx$/i.test(path) ? "docx" : "markdown";
}

// ── base64 <-> bytes (chunked to stay safe on large files) ──────────────────

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// ── Open ────────────────────────────────────────────────────────────────────

/** Read a file by absolute path (no dialog) and recover its thread id. */
export async function loadDocumentFromPath(path: string): Promise<LoadedDocument> {
  const threadId = await invoke<string | null>("get_thread_id", { path });

  if (kindOf(path) === "docx") {
    const b64 = await invoke<string>("read_document_binary", { path });
    return { kind: "docx", path, bytes: base64ToBytes(b64), threadId };
  }

  const content = await invoke<string>("read_document", { path });
  return { kind: "markdown", path, content, threadId };
}

/** Prompt for a file, read it (text or binary), and recover its thread id. */
export async function openDocument(): Promise<LoadedDocument | null> {
  const selected = await open({ multiple: false, filters: FILTERS });
  if (typeof selected !== "string") return null;
  return loadDocumentFromPath(selected);
}

// ── Save ────────────────────────────────────────────────────────────────────

export async function saveMarkdown(path: string, content: string): Promise<void> {
  await invoke("write_document", { path, content });
}

export async function saveDocx(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("write_document_binary", { path, base64: bytesToBase64(bytes) });
}

export async function saveMarkdownAs(
  content: string,
  defaultPath = "untitled.md",
): Promise<string | null> {
  const path = await save({
    filters: [{ name: "Markdown", extensions: ["md"] }],
    defaultPath,
  });
  if (!path) return null;
  await invoke("write_document", { path, content });
  return path;
}

export async function saveDocxAs(
  bytes: Uint8Array,
  defaultPath = "untitled.docx",
): Promise<string | null> {
  const path = await save({
    filters: [{ name: "Word", extensions: ["docx"] }],
    defaultPath,
  });
  if (!path) return null;
  await saveDocx(path, bytes);
  return path;
}

/** Persist the codex thread id against a document path. */
export async function persistThreadId(path: string, threadId: string): Promise<void> {
  await invoke("set_thread_id", { path, threadId });
}
