//! Sidecar lifecycle: spawn the Node agent server, read its handshake to learn
//! the bound port + bearer token, keep it alive for the app's lifetime, and
//! tear it down on exit. The frontend talks to the sidecar directly over HTTP;
//! Rust only brokers the connection details.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Connection details handed to the frontend via the `sidecar_info` command.
#[derive(Clone, Serialize)]
pub struct SidecarInfo {
    pub port: u16,
    pub token: String,
}

/// The handshake line the sidecar prints on stdout at startup.
#[derive(Deserialize)]
struct Ready {
    port: u16,
    token: String,
}

pub struct SidecarState {
    info: SidecarInfo,
    _child: Mutex<Child>,
}

impl SidecarState {
    pub fn info(&self) -> SidecarInfo {
        self.info.clone()
    }
}

/// Spawn `node <entry>` and block until the handshake line is parsed.
///
/// `codex` is the user's codex binary (passed to the sidecar via DOCPILOT_CODEX)
/// and `node_dir` is prepended to PATH so codex's own `node` subprocesses (the
/// agent-edit scripts) resolve the bundled node.
pub fn spawn(
    node_bin: &str,
    entry: &str,
    codex: Option<&str>,
    node_dir: Option<&str>,
) -> Result<SidecarState, String> {
    let mut cmd = Command::new(node_bin);
    cmd.arg(entry)
        .env("DOCPILOT_PORT", "0") // ephemeral port; real one comes back in handshake
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(cx) = codex {
        cmd.env("DOCPILOT_CODEX", cx);
    }
    if let Some(nd) = node_dir {
        let existing = std::env::var("PATH").unwrap_or_default();
        let sep = if cfg!(windows) { ";" } else { ":" };
        cmd.env("PATH", format!("{nd}{sep}{existing}"));
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn sidecar ({node_bin} {entry}): {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "sidecar has no stdout".to_string())?;
    let mut reader = BufReader::new(stdout);

    // First line must be the JSON handshake.
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|e| format!("failed to read sidecar handshake: {e}"))?;
    let ready: Ready = serde_json::from_str(line.trim())
        .map_err(|e| format!("bad sidecar handshake {line:?}: {e}"))?;

    // Drain remaining stdout in the background so the pipe never blocks the child.
    std::thread::spawn(move || {
        for line in reader.lines().map_while(Result::ok) {
            eprintln!("[sidecar] {line}");
        }
    });
    // Surface sidecar stderr for debugging.
    if let Some(err) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                eprintln!("[sidecar:err] {line}");
            }
        });
    }

    Ok(SidecarState {
        info: SidecarInfo {
            port: ready.port,
            token: ready.token,
        },
        _child: Mutex::new(child),
    })
}

impl Drop for SidecarState {
    fn drop(&mut self) {
        if let Ok(mut child) = self._child.lock() {
            let _ = child.kill();
        }
    }
}
