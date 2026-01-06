use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::sync::atomic::AtomicBool;
use portable_pty::MasterPty;
use uuid::Uuid;

pub mod command;
pub mod session_manager; // <-- 导出新模块

pub const DATA_FILE: &str = "data.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub enum OsType {
    Linux,
    Windows,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub category_id: Option<String>,
    pub status: String,
    pub os_type: OsType,
    pub password: Option<String>,
}

impl Server {
    pub fn new(name: String, host: String, port: u16, username: String, category_id: Option<String>, os_type: OsType, password: Option<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            host,
            port,
            username,
            category_id,
            status: "disconnected".to_string(),
            os_type,
            password,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

impl Category {
    pub fn new(name: String, parent_id: Option<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            parent_id,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub servers: Vec<Server>,
    pub categories: Vec<Category>,
}

pub struct AppState(pub Arc<Mutex<AppData>>);

// --- PTY 会话管理 ---
pub struct PtySession {
    pub server_id: String,
    pub pty: Box<dyn MasterPty + Send>,
    pub alive: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct PtyState {
    pub sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}