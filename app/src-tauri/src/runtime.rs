//! Runtime path resolution — bridges "dev (repo layout)" and "production
//! (bundled .app/.exe)". In production the sidecar + its node_modules are
//! bundled as resources, a `node` binary ships next to the executable, and the
//! user's own `codex` is located on the system (we never bundle the codex
//! native binary — that keeps macOS notarization tractable).

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

pub struct Runtime {
    /// Node binary to run the sidecar with.
    pub node: String,
    /// Sidecar entry script.
    pub sidecar: String,
    /// User's system codex binary, if found.
    pub codex: Option<String>,
    /// Directory of `node`, prepended to PATH so codex's child `node` resolves.
    pub node_dir: Option<String>,
}

pub fn resolve(app: &AppHandle) -> Runtime {
    let node = resolve_node();
    let node_dir = Path::new(&node)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_string_lossy().into_owned());
    Runtime {
        sidecar: resolve_sidecar(app),
        codex: find_codex(),
        node,
        node_dir,
    }
}

fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Sidecar entry: bundled resource in production, repo path in dev.
fn resolve_sidecar(app: &AppHandle) -> String {
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("sidecar").join("dist").join("index.js");
        if p.exists() {
            return p.to_string_lossy().into_owned();
        }
    }
    std::env::var("DOCPILOT_SIDECAR")
        .unwrap_or_else(|_| format!("{}/../../sidecar/dist/index.js", env!("CARGO_MANIFEST_DIR")))
}

/// Node binary: the one bundled next to the executable, else PATH / override.
fn resolve_node() -> String {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let name = if cfg!(windows) { "node.exe" } else { "node" };
            let p = dir.join(name);
            if p.exists() {
                return p.to_string_lossy().into_owned();
            }
        }
    }
    std::env::var("DOCPILOT_NODE").unwrap_or_else(|_| "node".into())
}

/// Locate the user's codex binary. GUI apps inherit a minimal PATH, so we also
/// probe common install locations explicitly.
pub fn find_codex() -> Option<String> {
    let name = if cfg!(windows) { "codex.exe" } else { "codex" };

    if let Some(p) = std::env::var_os("DOCPILOT_CODEX") {
        let p = PathBuf::from(p);
        if p.exists() {
            return Some(p.to_string_lossy().into_owned());
        }
    }

    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let c = dir.join(name);
            if c.exists() {
                return Some(c.to_string_lossy().into_owned());
            }
        }
    }

    let mut cands: Vec<PathBuf> = Vec::new();
    if let Some(h) = home() {
        cands.push(h.join(".codex").join("bin").join(name));
        cands.push(h.join(".local").join("bin").join(name));
        if cfg!(windows) {
            cands.push(h.join("AppData").join("Roaming").join("npm").join("codex.cmd"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        cands.push(PathBuf::from("/opt/homebrew/bin/codex"));
        cands.push(PathBuf::from("/usr/local/bin/codex"));
        cands.push(PathBuf::from(
            "/Applications/Codex.app/Contents/Resources/codex",
        ));
    }
    cands
        .into_iter()
        .find(|c| c.exists())
        .map(|c| c.to_string_lossy().into_owned())
}

/// Whether the user is logged into codex (ChatGPT auth on disk).
pub fn codex_logged_in() -> bool {
    home()
        .map(|h| h.join(".codex").join("auth.json").exists())
        .unwrap_or(false)
}
