//! Tiny JSON-backed map of `absolute document path -> codex thread id`.
//!
//! This is what makes editing sessions persistent and cache-warm: reopening a
//! document looks up its thread id and resumes the same Codex conversation.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Default, Serialize, Deserialize)]
struct ThreadMap {
    threads: HashMap<String, String>,
}

pub struct ThreadStore {
    path: PathBuf,
    map: Mutex<ThreadMap>,
}

impl ThreadStore {
    /// Load (or initialize) the store at `<app_data_dir>/threads.json`.
    pub fn load(app_data_dir: PathBuf) -> Self {
        let path = app_data_dir.join("threads.json");
        let map = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        ThreadStore {
            path,
            map: Mutex::new(map),
        }
    }

    pub fn get(&self, doc_path: &str) -> Option<String> {
        self.map.lock().ok()?.threads.get(doc_path).cloned()
    }

    pub fn set(&self, doc_path: String, thread_id: String) -> Result<(), String> {
        let mut guard = self.map.lock().map_err(|e| e.to_string())?;
        guard.threads.insert(doc_path, thread_id);
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&*guard).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, json).map_err(|e| e.to_string())
    }
}
