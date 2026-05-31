//! Tauri commands exposed to the frontend.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::State;

use crate::sidecar::{SidecarInfo, SidecarState};
use crate::store::ThreadStore;

/// Where to reach the agent sidecar (port + bearer token).
#[tauri::command]
pub fn sidecar_info(sidecar: State<SidecarState>) -> SidecarInfo {
    sidecar.info()
}

/// Surface webview-side errors/logs into the terminal where `tauri dev` runs.
#[tauri::command]
pub fn log_frontend(message: String) {
    eprintln!("[webview] {message}");
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
