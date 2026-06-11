//! docpilot Tauri shell. Responsibilities:
//!   - boot the Node agent sidecar and expose its connection info
//!   - persist document -> codex thread id mappings
//!   - read/write document files
//! Everything AI-related streams from the sidecar straight to the webview.

mod commands;
mod runtime;
mod sidecar;
mod store;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use store::ThreadStore;

/// App menu: File/Edit/View with accelerators that forward to the webview as
/// "menu" events. This also reclaims ⌘W (Close Tab) from the default
/// close-window binding.
fn build_menu<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        handle,
        "docpilot",
        true,
        &[
            &PredefinedMenuItem::about(handle, None, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, None)?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::show_all(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::quit(handle, None)?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &MenuItem::with_id(handle, "new", "New Markdown", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(handle, "open", "Open…", true, Some("CmdOrCtrl+O"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(handle, "save_as", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "close_tab", "Close Tab", true, Some("CmdOrCtrl+W"))?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "ai_edit", "Edit Selection with AI", true, Some("CmdOrCtrl+K"))?,
            &MenuItem::with_id(handle, "find", "Find…", true, Some("CmdOrCtrl+F"))?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &MenuItem::with_id(handle, "command_palette", "Command Palette…", true, Some("CmdOrCtrl+P"))?,
            &MenuItem::with_id(handle, "chat", "Chat About Document", true, Some("CmdOrCtrl+L"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "toggle_sidebar", "Toggle Sidebar", true, Some("Alt+CmdOrCtrl+B"))?,
            &MenuItem::with_id(handle, "toggle_chat", "Toggle Chat Panel", true, Some("CmdOrCtrl+J"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "shortcuts", "Keyboard Shortcuts", true, None::<&str>)?,
            &PredefinedMenuItem::fullscreen(handle, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        handle,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
        ],
    )?;

    Menu::with_items(
        handle,
        &[
            #[cfg(target_os = "macos")]
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
        ],
    )
}

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

            // Native menu → "menu" events the frontend reacts to.
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let _ = app.emit("menu", event.id().0.clone());
            });

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
