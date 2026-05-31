import { invoke } from "@tauri-apps/api/core";

/** Forward a message to the Rust terminal log (best-effort). */
export function logToShell(message: string): void {
  void invoke("log_frontend", { message }).catch(() => {});
}

/**
 * Pipe webview errors into the `tauri dev` terminal so they're visible without
 * opening devtools. Patches console.error and catches global errors/rejections.
 */
export function installDiagnostics(): void {
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    origError(...args);
    logToShell("console.error: " + args.map(stringify).join(" "));
  };

  window.addEventListener("error", (e) => {
    logToShell(`window.error: ${e.message} @ ${e.filename}:${e.lineno}`);
  });

  window.addEventListener("unhandledrejection", (e) => {
    logToShell("unhandledrejection: " + stringify(e.reason));
  });
}

function stringify(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack ?? ""}`;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
