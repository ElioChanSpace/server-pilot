use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
    pub fn new(
        name: String,
        host: String,
        port: u16,
        username: String,
        category_id: Option<String>,
        os_type: OsType,
        password: Option<String>,
    ) -> Self {
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

fn default_terminal_idle_disconnect_enabled() -> bool {
    true
}

fn default_terminal_idle_disconnect_minutes() -> u32 {
    30
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_terminal_idle_disconnect_enabled")]
    pub terminal_idle_disconnect_enabled: bool,
    #[serde(default = "default_terminal_idle_disconnect_minutes")]
    pub terminal_idle_disconnect_minutes: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            terminal_idle_disconnect_enabled: default_terminal_idle_disconnect_enabled(),
            terminal_idle_disconnect_minutes: default_terminal_idle_disconnect_minutes(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub servers: Vec<Server>,
    pub categories: Vec<Category>,
    #[serde(default)]
    pub settings: AppSettings,
}
