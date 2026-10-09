use crate::servers::domain::{AppData, Repository};
use std::fs;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

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
        if let Ok(path) = self.app_handle.path().app_data_dir() {
            let file_path = path.join(DATA_FILE);
            if file_path.exists() {
                let json = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
                match serde_json::from_str(&json) {
                    Ok(data) => return Ok(data),
                    Err(e) => {
                        // Preserve the corrupted file so user data can be recovered
                        // manually instead of being silently overwritten on next save.
                        let backup = path.join(format!(
                            "data.json.corrupt-{}",
                            std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_secs())
                                .unwrap_or(0)
                        ));
                        if let Err(copy_err) = fs::copy(&file_path, &backup) {
                            log::error!(
                                "[Repository] Failed to back up corrupted data.json: {}",
                                copy_err
                            );
                        } else {
                            log::error!(
                                "[Repository] data.json is corrupted ({}). Backup saved to {:?}. Starting with empty data.",
                                e,
                                backup
                            );
                        }
                        return Err(format!("data.json 解析失败: {}", e));
                    }
                }
            }
        }
        Ok(AppData::default())
    }

    fn save(&self, data: &AppData) -> Result<(), String> {
        let path = self
            .app_handle
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?;
        if !path.exists() {
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        }
        let file_path = path.join(DATA_FILE);
        // 双保险：无论内存中状态如何，写盘前一律清除明文密码。
        let mut sanitized = data.clone();
        for server in &mut sanitized.servers {
            server.password = None;
        }
        sanitized.command_history.clear();
        let json = serde_json::to_string_pretty(&sanitized).map_err(|e| e.to_string())?;
        // Atomic write: write to a temp file first, then rename over the target
        // so a crash mid-write can never corrupt data.json.
        let tmp_path = path.join(format!("{}.tmp", DATA_FILE));
        fs::write(&tmp_path, &json).map_err(|e| e.to_string())?;
        fs::rename(&tmp_path, &file_path).map_err(|e| e.to_string())?;
        Ok(())
    }
}
