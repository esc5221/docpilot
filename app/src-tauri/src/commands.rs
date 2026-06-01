//! Tauri commands exposed to the frontend.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, Manager, State};

use crate::sidecar::{SidecarInfo, SidecarState};
use crate::store::ThreadStore;

fn sessions_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("sessions.json"))
}

/// Load the persisted chat sessions blob (JSON string), or "" if none.
#[tauri::command]
pub fn load_sessions(app: AppHandle) -> Result<String, String> {
    let path = sessions_path(&app)?;
    Ok(std::fs::read_to_string(path).unwrap_or_default())
}

/// Persist the chat sessions blob (whole list as a JSON string).
#[tauri::command]
pub fn save_sessions(app: AppHandle, data: String) -> Result<(), String> {
    let path = sessions_path(&app)?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

/// Where to reach the agent sidecar (port + bearer token).
#[tauri::command]
pub fn sidecar_info(sidecar: State<SidecarState>) -> SidecarInfo {
    sidecar.info()
}

#[derive(serde::Serialize)]
pub struct CodexStatus {
    /// Path to the located codex binary, or null if not installed.
    pub path: Option<String>,
    /// Whether the user is signed in (ChatGPT auth on disk).
    pub logged_in: bool,
}

/// Report whether codex is installed and signed in (drives first-run onboarding).
#[tauri::command]
pub fn codex_status() -> CodexStatus {
    CodexStatus {
        path: crate::runtime::find_codex(),
        logged_in: crate::runtime::codex_logged_in(),
    }
}

/// Kick off `codex login` (opens a browser for the ChatGPT OAuth flow).
#[tauri::command]
pub fn codex_login() -> Result<(), String> {
    let codex = crate::runtime::find_codex().ok_or_else(|| "codex not found".to_string())?;
    std::process::Command::new(codex)
        .arg("login")
        .spawn()
        .map_err(|e| format!("failed to start codex login: {e}"))?;
    Ok(())
}

/// Surface webview-side errors/logs into the terminal where `tauri dev` runs.
#[tauri::command]
pub fn log_frontend(message: String) {
    eprintln!("[webview] {message}");
}

/// Reveal a file in the OS file manager (Finder / Explorer).
#[tauri::command]
pub fn reveal_in_os(path: String) -> Result<(), String> {
    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        c.arg("-R").arg(&path);
        c
    } else if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new("explorer");
        c.arg(format!("/select,{path}"));
        c
    } else {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&path);
        c
    };
    cmd.spawn().map_err(|e| format!("reveal {path}: {e}"))?;
    Ok(())
}

/// Read a document's text content from disk.
#[tauri::command]
pub fn read_document(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))
}

/// Write a document's text content to disk.
#[tauri::command]
pub fn write_document(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("write {path}: {e}"))
}

/// Read a binary document (e.g. .docx) as base64 for transfer to the webview.
#[tauri::command]
pub fn read_document_binary(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("read {path}: {e}"))?;
    Ok(STANDARD.encode(bytes))
}

/// Write a binary document (base64-encoded) to disk.
#[tauri::command]
pub fn write_document_binary(path: String, base64: String) -> Result<(), String> {
    let bytes = STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("decode base64: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("write {path}: {e}"))
}

/// Look up the codex thread id previously associated with a document.
#[tauri::command]
pub fn get_thread_id(store: State<ThreadStore>, path: String) -> Option<String> {
    store.get(&path)
}

/// Persist the codex thread id for a document so future sessions resume it.
#[tauri::command]
pub fn set_thread_id(
    store: State<ThreadStore>,
    path: String,
    thread_id: String,
) -> Result<(), String> {
    store.set(path, thread_id)
}
