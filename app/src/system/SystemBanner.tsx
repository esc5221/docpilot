import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

interface CodexStatus {
  path: string | null;
  logged_in: boolean;
}

/**
 * Top-of-app banner for the two things a fresh install needs: codex present +
 * signed in, and (separately) an available update. Silent when all is well.
 */
export function SystemBanner() {
  const [codex, setCodex] = useState<CodexStatus | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [update, setUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState(false);

  const refreshCodex = useCallback(async () => {
    try {
      setCodex(await invoke<CodexStatus>("codex_status"));
    } catch {
      /* sidecar/runtime not ready yet */
    }
  }, []);

  useEffect(() => {
    void refreshCodex();
    // Check for updates in the background (no-op in dev / unsigned local runs).
    check()
      .then((u) => u?.available && setUpdate(u))
      .catch(() => {});
  }, [refreshCodex]);

  const signIn = useCallback(async () => {
    setSigningIn(true);
    try {
      await invoke("codex_login");
    } catch {
      /* surfaced below if it stays not-logged-in */
    }
    // Poll until the browser OAuth completes.
    const started = Date.now();
    const tick = async () => {
      await refreshCodex();
      const s = await invoke<CodexStatus>("codex_status").catch(() => null);
      if (s?.logged_in || Date.now() - started > 180_000) {
        setSigningIn(false);
        return;
      }
      setTimeout(tick, 2500);
    };
    setTimeout(tick, 2500);
  }, [refreshCodex]);

  const installUpdate = useCallback(async () => {
    if (!update) return;
    setUpdating(true);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch {
      setUpdating(false);
    }
  }, [update]);

  // Codex missing entirely.
  if (codex && !codex.path) {
    return (
      <div className="dp-banner dp-banner-warn">
        <span>
          Codex CLI not found. Install it (<code>npm i -g @openai/codex</code>) to enable AI features.
        </span>
      </div>
    );
  }

  // Codex present but not signed in.
  if (codex && codex.path && !codex.logged_in) {
    return (
      <div className="dp-banner dp-banner-warn">
        <span>Sign in with your ChatGPT account to use docpilot's AI.</span>
        <button className="dp-btn dp-primary" onClick={() => void signIn()} disabled={signingIn}>
          {signingIn ? "Waiting for sign-in…" : "Sign in with ChatGPT"}
        </button>
      </div>
    );
  }

  // Update available.
  if (update) {
    return (
      <div className="dp-banner">
        <span>Update available — v{update.version}.</span>
        <button className="dp-btn dp-primary" onClick={() => void installUpdate()} disabled={updating}>
          {updating ? "Updating…" : "Update & Restart"}
        </button>
      </div>
    );
  }

  return null;
}
