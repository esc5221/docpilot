//! docpilot Tauri shell. Responsibilities:
//!   - boot the Node agent sidecar and expose its connection info
//!   - persist document -> codex thread id mappings
//!   - read/write document files
//! Everything AI-related streams from the sidecar straight to the webview.

mod commands;
mod runtime;
mod sidecar;
mod store;

use tauri::Manager;

use store::ThreadStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Per-app data dir for the thread-id store.
            let data_dir = app.path().app_data_dir()?;
            app.manage(ThreadStore::load(data_dir));

            // Resolve node / sidecar / codex for this environment and boot.
            let rt = runtime::resolve(app.handle());
            let state =
                sidecar::spawn(&rt.node, &rt.sidecar, rt.codex.as_deref(), rt.node_dir.as_deref())
                    .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::sidecar_info,
            commands::log_frontend,
            commands::reveal_in_os,
            commands::read_document,
            commands::write_document,
            commands::read_document_binary,
            commands::write_document_binary,
            commands::get_thread_id,
            commands::set_thread_id,
            commands::load_sessions,
            commands::save_sessions,
            commands::codex_status,
            commands::codex_login,
        ])
        .run(tauri::generate_context!())
        .expect("error while running docpilot");
}
