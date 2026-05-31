//! docpilot Tauri shell. Responsibilities:
//!   - boot the Node agent sidecar and expose its connection info
//!   - persist document -> codex thread id mappings
//!   - read/write document files
//! Everything AI-related streams from the sidecar straight to the webview.

mod commands;
mod sidecar;
mod store;

use tauri::Manager;

use store::ThreadStore;

/// Absolute path to the sidecar entry. Overridable via `DOCPILOT_SIDECAR`;
/// defaults to the repo layout for local development.
fn sidecar_entry() -> String {
    std::env::var("DOCPILOT_SIDECAR").unwrap_or_else(|_| {
        format!("{}/../../sidecar/dist/index.js", env!("CARGO_MANIFEST_DIR"))
    })
}

fn node_bin() -> String {
    std::env::var("DOCPILOT_NODE").unwrap_or_else(|_| "node".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Per-app data dir for the thread-id store.
            let data_dir = app.path().app_data_dir()?;
            app.manage(ThreadStore::load(data_dir));

            // Boot the agent sidecar and stash its connection details.
            let state = sidecar::spawn(&node_bin(), &sidecar_entry())
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::sidecar_info,
            commands::log_frontend,
            commands::read_document,
            commands::write_document,
            commands::read_document_binary,
            commands::write_document_binary,
            commands::get_thread_id,
            commands::set_thread_id,
            commands::load_sessions,
            commands::save_sessions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running docpilot");
}
