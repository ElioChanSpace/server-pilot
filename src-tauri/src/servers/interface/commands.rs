use log::info;
use tauri::{AppHandle, State, Window};
use crate::servers::application::AppState;
use crate::servers::domain::{Category, OsType, Server};
use crate::servers::infrastructure::session_manager::{self, SessionManagerState};

#[tauri::command]
pub fn create_server(
    state: State<'_, AppState>,
    _app: AppHandle, // AppHandle is no longer needed here as repository handles saving
    name: String,
    host: String,
    port: u16,
    username: String,
    category_id: Option<String>,
    os_type: OsType,
    password: Option<String>
) -> Result<Server, String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let server = Server::new(name, host, port, username, category_id, os_type, password);
    data.servers.push(server.clone());
    drop(data); // Release lock before saving
    state.save()?;
    Ok(server)
}

#[tauri::command]
pub fn create_category(
    state: State<'_, AppState>,
    _app: AppHandle,
    name: String,
    parent_id: Option<String>
) -> Result<Category, String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let category = Category::new(name, parent_id);
    data.categories.push(category.clone());
    drop(data);
    state.save()?;
    Ok(category)
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

// --- PTY Commands (Delegated to SessionManager) ---

#[tauri::command]
pub async fn connect_server(
    window: Window,
    state: State<'_, AppState>,
    session_manager: State<'_, SessionManagerState>,
    id: String,
) -> Result<(), String> {
    info!("Received connect_server command for id: {}", id);
    let server = {
        let mut data = state.data.lock().map_err(|e| e.to_string())?;
        let s = data.servers.iter_mut().find(|s| s.id == id).ok_or("Server not found")?;
        s.status = "connecting".into();
        let _ = window.emit("server-status-changed", s.clone());
        s.clone()
    };

    if !matches!(server.os_type, OsType::Linux) {
        return Err("Only Linux SSH is supported currently".into());
    }

    session_manager::start_session(window, server.id, server.username, server.host, server.port, state, session_manager)
}

#[tauri::command]
pub fn pty_write(
    session_manager: State<'_, SessionManagerState>,
    server_id: String,
    data: String,
) -> Result<(), String> {
    session_manager::write_to_session(session_manager, server_id, data)
}

#[tauri::command]
pub fn pty_resize(
    session_manager: State<'_, SessionManagerState>,
    server_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    session_manager::resize_session(session_manager, server_id, rows, cols)
}

#[tauri::command]
pub fn disconnect_server(
    session_manager: State<'_, SessionManagerState>,
    server_id: String,
) -> Result<(), String> {
    session_manager::close_session(session_manager, server_id)
}
