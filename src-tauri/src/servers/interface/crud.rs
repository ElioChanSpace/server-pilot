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
}

#[tauri::command]
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
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
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
    data.servers.push(server.clone());
    drop(data);
    state.save()?;
    Ok(server)
}

#[tauri::command]
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
    match password.as_deref() {
        Some(value) if !value.is_empty() => {
            credential_store::save_password(&server.id, value)?;
            server.has_password = true;
        }
        _ => {}
    }
    match key_passphrase.as_deref() {
        Some(value) if !value.is_empty() => {
            credential_store::save_key_passphrase(&server.id, value)?;
            server.has_key_passphrase = true;
        }
        _ => {}
    }
    server.password = None;
    server.key_passphrase = None;

    let updated_server = server.clone();
    drop(data);
    state.save()?;
    Ok(updated_server)
}

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

    // Remove child categories recursively
    let child_ids: Vec<String> = data
        .categories
        .iter()
        .filter(|c| c.parent_id.as_deref() == Some(&id))
        .map(|c| c.id.clone())
        .collect();
    for child_id in child_ids {
        data.categories.retain(|c| c.id != child_id);
        // Move servers from child categories
        for server in &mut data.servers {
            if server.category_id.as_deref() == Some(&child_id) {
                server.category_id = if move_to_uncategorized {
                    None
                } else {
                    None
                };
            }
        }
    }

    // Move servers from this category
    if move_to_uncategorized {
        for server in &mut data.servers {
            if server.category_id.as_deref() == Some(&id) {
                server.category_id = None;
            }
        }
    }

    data.categories.remove(idx);
    drop(data);
    state.save()?;
    Ok(())
}

#[tauri::command]
pub fn get_servers(state: State<'_, AppState>) -> Result<Vec<Server>, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.servers.clone())
}

#[tauri::command]
pub fn get_categories(state: State<'_, AppState>) -> Result<Vec<Category>, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.categories.clone())
}

#[tauri::command]
pub fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.settings.clone())
}

#[tauri::command]
pub fn update_app_settings(
    state: State<'_, AppState>,
    payload: UpdateAppSettingsRequest,
) -> Result<AppSettings, String> {
    if payload.terminal_idle_disconnect_enabled && payload.terminal_idle_disconnect_minutes == 0 {
        return Err("空闲断连时间必须大于 0 分钟".to_string());
    }
    if let Some(preference) = payload.theme_preference.as_deref() {
        if !matches!(preference, "system" | "light" | "dark") {
            return Err("无效的主题偏好".to_string());
        }
    }

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
        theme_preference: payload
            .theme_preference
            .unwrap_or(current.theme_preference),
        notifications_enabled: payload
            .notifications_enabled
            .unwrap_or(current.notifications_enabled),
        confirm_on_disconnect: payload
            .confirm_on_disconnect
            .unwrap_or(current.confirm_on_disconnect),
    };
    let settings = data.settings.clone();
    drop(data);
    state.save()?;
    Ok(settings)
}
