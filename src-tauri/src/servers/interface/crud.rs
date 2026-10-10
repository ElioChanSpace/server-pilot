use crate::servers::application::AppState;
use crate::servers::domain::{AppSettings, Category, OsType, Server};
use crate::servers::infrastructure::credential_store;
use serde::Deserialize;
use tauri::{AppHandle, State};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAppSettingsRequest {
    pub terminal_idle_disconnect_enabled: bool,
    pub terminal_idle_disconnect_minutes: u32,
    pub terminal_font_size: Option<u8>,
    pub terminal_scrollback: Option<u32>,
    pub minimize_to_tray_on_close: Option<bool>,
    pub theme_preference: Option<String>,
    pub notifications_enabled: Option<bool>,
    pub confirm_on_disconnect: Option<bool>,
    pub restore_sessions_on_launch: Option<bool>,
}

#[tauri::command(async)]
pub fn create_server(
    state: State<'_, AppState>,
    _app: AppHandle,
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
) -> Result<Server, String> {
    let mut server = Server::new(
        name,
        host,
        port,
        username,
        category_id,
        os_type,
        auth_method,
        password,
        key_path,
        key_passphrase,
        proxy_jump,
    );
    // Keychain IPC first, without holding the global data lock.
    if server.has_password {
        if let Some(password) = server.password.clone() {
            credential_store::save_password(&server.id, &password)?;
        }
    }
    if server.has_key_passphrase {
        if let Some(passphrase) = server.key_passphrase.clone() {
            credential_store::save_key_passphrase(&server.id, &passphrase)?;
        }
    }
    server.password = None;
    server.key_passphrase = None;
    {
        let mut data = state.data.lock().map_err(|e| e.to_string())?;
        data.servers.push(server.clone());
    }
    state.save()?;
    Ok(server)
}

#[tauri::command(async)]
pub fn update_server(
    state: State<'_, AppState>,
    id: String,
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
) -> Result<Server, String> {
    // Keychain IPC first, without holding the global data lock.
    let mut password_updated = false;
    let mut passphrase_updated = false;
    match password.as_deref() {
        Some(value) if !value.is_empty() => {
            credential_store::save_password(&id, value)?;
            password_updated = true;
        }
        _ => {}
    }
    match key_passphrase.as_deref() {
        Some(value) if !value.is_empty() => {
            credential_store::save_key_passphrase(&id, value)?;
            passphrase_updated = true;
        }
        _ => {}
    }

    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let server = data
        .servers
        .iter_mut()
        .find(|server| server.id == id)
        .ok_or("Server not found")?;

    server.name = name;
    server.host = host;
    server.port = port;
    server.username = username;
    server.category_id = category_id;
    server.os_type = os_type;
    server.auth_method = auth_method;
    server.key_path = key_path;
    server.proxy_jump = proxy_jump;
    if password_updated {
        server.has_password = true;
    }
    if passphrase_updated {
        server.has_key_passphrase = true;
    }
    server.password = None;
    server.key_passphrase = None;

    let updated_server = server.clone();
    drop(data);
    state.save()?;
    Ok(updated_server)
}

#[tauri::command(async)]
pub fn create_category(
    state: State<'_, AppState>,
    _app: AppHandle,
    name: String,
    parent_id: Option<String>,
) -> Result<Category, String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let category = Category::new(name, parent_id);
    data.categories.push(category.clone());
    drop(data);
    state.save()?;
    Ok(category)
}

#[tauri::command(async)]
pub fn delete_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let idx = data
        .servers
        .iter()
        .position(|s| s.id == id)
        .ok_or("Server not found")?;
    let server = data.servers.remove(idx);
    drop(data);

    // Clean up stored credentials
    if server.has_password {
        let _ = credential_store::delete_password(&id);
    }
    if server.has_key_passphrase {
        let _ = credential_store::delete_key_passphrase(&id);
    }

    state.save()?;
    Ok(())
}

#[tauri::command(async)]
pub fn update_category(
    state: State<'_, AppState>,
    id: String,
    name: String,
    parent_id: Option<String>,
) -> Result<Category, String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let category = data
        .categories
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or("Category not found")?;
    category.name = name;
    category.parent_id = parent_id;
    let updated = category.clone();
    drop(data);
    state.save()?;
    Ok(updated)
}

#[tauri::command(async)]
pub fn delete_category(
    state: State<'_, AppState>,
    id: String,
    move_to_uncategorized: bool,
) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let idx = data
        .categories
        .iter()
        .position(|c| c.id == id)
        .ok_or("Category not found")?;
    let deleted_parent = data.categories[idx].parent_id.clone();

    // Collect the whole subtree (all descendants, not only direct children)
    let mut to_remove: Vec<String> = vec![id.clone()];
    let mut i = 0;
    while i < to_remove.len() {
        let current = to_remove[i].clone();
        for category in &data.categories {
            if category.parent_id.as_deref() == Some(current.as_str())
                && !to_remove.contains(&category.id)
            {
                to_remove.push(category.id.clone());
            }
        }
        i += 1;
    }

    // Servers in removed categories are either left uncategorized or moved to
    // the deleted category's parent.
    for server in &mut data.servers {
        if server
            .category_id
            .as_deref()
            .is_some_and(|cid| to_remove.iter().any(|r| r == cid))
        {
            server.category_id = if move_to_uncategorized {
                None
            } else {
                deleted_parent.clone()
            };
        }
    }

    data.categories.retain(|c| !to_remove.contains(&c.id));
    drop(data);
    state.save()?;
    Ok(())
}

#[tauri::command(async)]
pub fn get_servers(state: State<'_, AppState>) -> Result<Vec<Server>, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.servers.clone())
}

#[tauri::command(async)]
pub fn get_categories(state: State<'_, AppState>) -> Result<Vec<Category>, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.categories.clone())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryOrderItem {
    pub id: String,
    pub order: u32,
}

#[tauri::command(async)]
pub fn update_category_order(
    state: State<'_, AppState>,
    items: Vec<CategoryOrderItem>,
) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    for item in items {
        if let Some(category) = data.categories.iter_mut().find(|c| c.id == item.id) {
            category.order = item.order;
        }
    }
    drop(data);
    state.save()?;
    Ok(())
}

#[tauri::command(async)]
pub fn move_category(
    state: State<'_, AppState>,
    id: String,
    new_parent_id: Option<String>,
    new_order: u32,
) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;

    // 防止将分类移入自身或自己的后代（否则分类树成环）
    if Some(&id) == new_parent_id.as_ref() {
        return Err("不能将分类移入自身".to_string());
    }
    if let Some(new_parent_id) = new_parent_id.as_ref() {
        let mut cursor = Some(new_parent_id.as_str());
        let mut depth = 0;
        while let Some(current) = cursor {
            if current == id {
                return Err("不能将分类移入自己的子分类".to_string());
            }
            cursor = data
                .categories
                .iter()
                .find(|c| c.id == current)
                .and_then(|c| c.parent_id.as_deref());
            depth += 1;
            if depth > data.categories.len() {
                // Existing data already contains a cycle — don't make it worse.
                return Err("分类层级数据异常，无法移动".to_string());
            }
        }
    }

    if let Some(category) = data.categories.iter_mut().find(|c| c.id == id) {
        category.parent_id = new_parent_id;
        category.order = new_order;
    }

    drop(data);
    state.save()?;
    Ok(())
}

#[tauri::command(async)]
pub fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.settings.clone())
}

#[tauri::command(async)]
pub fn update_app_settings(
    state: State<'_, AppState>,
    payload: UpdateAppSettingsRequest,
) -> Result<AppSettings, String> {
    if payload.terminal_idle_disconnect_enabled && payload.terminal_idle_disconnect_minutes == 0 {
        return Err("空闲断连时间必须大于 0 分钟".to_string());
    }
    // theme_preference accepts any theme ID (built-in or custom)

    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let current = data.settings.clone();
    data.settings = AppSettings {
        terminal_idle_disconnect_enabled: payload.terminal_idle_disconnect_enabled,
        terminal_idle_disconnect_minutes: payload.terminal_idle_disconnect_minutes.max(1),
        terminal_font_size: payload
            .terminal_font_size
            .unwrap_or(current.terminal_font_size)
            .clamp(12, 24),
        terminal_scrollback: payload
            .terminal_scrollback
            .unwrap_or(current.terminal_scrollback)
            .max(500),
        minimize_to_tray_on_close: payload
            .minimize_to_tray_on_close
            .unwrap_or(current.minimize_to_tray_on_close),
        theme_preference: payload.theme_preference.unwrap_or(current.theme_preference),
        notifications_enabled: payload
            .notifications_enabled
            .unwrap_or(current.notifications_enabled),
        confirm_on_disconnect: payload
            .confirm_on_disconnect
            .unwrap_or(current.confirm_on_disconnect),
        restore_sessions_on_launch: payload
            .restore_sessions_on_launch
            .unwrap_or(current.restore_sessions_on_launch),
    };
    let settings = data.settings.clone();
    drop(data);
    state.save()?;
    Ok(settings)
}

/// Get custom app themes
#[tauri::command(async)]
pub fn get_custom_themes(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "appThemes": data.custom_themes,
    }))
}

/// Save custom app themes (full replacement of the custom_themes field)
#[tauri::command(async)]
pub fn save_custom_app_themes(
    state: State<'_, AppState>,
    themes: serde_json::Value,
) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.custom_themes = themes;
    drop(data);
    state.save()
}

/// Get local app stats (memory and CPU usage)
#[tauri::command(async)]
pub fn get_app_stats() -> Result<serde_json::Value, String> {
    use std::sync::{Mutex, OnceLock};
    use sysinfo::System;

    // Keep a single System across calls and refresh only our own process —
    // `System::new_all()` scans every process/disk on the machine, which is far
    // too heavy for a 3-second poll.
    static APP_SYS: OnceLock<Mutex<System>> = OnceLock::new();
    let sys_mutex = APP_SYS.get_or_init(|| Mutex::new(System::new()));

    let pid = sysinfo::get_current_pid().map_err(|e| e.to_string())?;
    let mut sys = sys_mutex.lock().map_err(|e| e.to_string())?;
    sys.refresh_process(pid);

    let process = sys.process(pid).ok_or("Failed to get current process")?;

    // sysinfo returns memory in bytes, convert to MB
    let memory_mb = process.memory() / 1024 / 1024;
    let cpu_percent = process.cpu_usage() as f64;

    Ok(serde_json::json!({
        "memoryMb": memory_mb,
        "cpuPercent": cpu_percent,
    }))
}
