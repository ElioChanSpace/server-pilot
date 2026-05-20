use std::fs;
use std::sync::Arc;
use tauri::AppHandle;
use crate::servers::domain::{AppData, Repository};

const DATA_FILE: &str = "data.json";

pub struct FileRepository {
    app_handle: Arc<AppHandle>,
}

impl FileRepository {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle: Arc::new(app_handle),
        }
    }
}

impl Repository for FileRepository {
    fn load(&self) -> Result<AppData, String> {
        if let Some(path) = self.app_handle.path_resolver().app_data_dir() {
            let file_path = path.join(DATA_FILE);
            if file_path.exists() {
                let json = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
                let data = serde_json::from_str(&json).map_err(|e| e.to_string())?;
                return Ok(data);
            }
        }
        Ok(AppData::default())
    }

    fn save(&self, data: &AppData) -> Result<(), String> {
        let path = self.app_handle.path_resolver().app_data_dir().ok_or("Could not resolve app data dir")?;
        if !path.exists() {
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        }
        let file_path = path.join(DATA_FILE);
        let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        fs::write(file_path, json).map_err(|e| e.to_string())?;
        Ok(())
    }
}
