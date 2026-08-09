use serde::{Deserialize, Serialize};
use uuid::Uuid;

fn default_auth_method() -> String {
    "password".to_string()
}

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
    #[serde(default = "default_auth_method")]
    pub auth_method: String,
    pub key_path: Option<String>,
    pub proxy_jump: Option<String>,
    #[serde(default)]
    pub has_password: bool,
    #[serde(default)]
    pub has_key_passphrase: bool,
    /// 仅用于从旧版 data.json 迁移；序列化时永不写入磁盘，也永不返回给前端。
    #[serde(skip_serializing)]
    pub password: Option<String>,
    #[serde(skip_serializing)]
    pub key_passphrase: Option<String>,
}

impl Server {
    pub fn new(
        name: String,
        host: String,
        port: u16,
        username: String,
        category_id: Option<String>,
        os_type: OsType,
        auth_method: String,
        password: Option<String>,
        key_path: Option<String>,
        key_passphrase: Option<String>,
        proxy_jump: Option<String>,
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
            auth_method,
            key_path,
            proxy_jump,
            has_password: password.as_ref().is_some_and(|value| !value.is_empty()),
            password,
            has_key_passphrase: key_passphrase
                .as_ref()
                .is_some_and(|value| !value.is_empty()),
            key_passphrase,
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
