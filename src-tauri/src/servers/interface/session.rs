use crate::servers::application::AppState;
use crate::servers::domain::OsType;
use crate::servers::infrastructure::credential_store;
use crate::servers::infrastructure::session_manager::{self, SessionManagerState};
use log::{info, warn};
use serde::Serialize;
use tauri::{Emitter, State, Window};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConnectResult {
    pub session_id: String,
}

#[tauri::command]
pub async fn connect_server(
    window: Window,
    state: State<'_, AppState>,
    session_manager: State<'_, SessionManagerState>,
    id: String,
) -> Result<SessionConnectResult, String> {
    info!("Received connect_server command for id: {}", id);
    // 连接复用：该服务器已有存活会话时直接返回（UI 刷新后再点连接不应叠加 PTY）
    if let Some(existing) = session_manager::find_active_session_for_server(&session_manager, &id) {
        info!("Reusing existing terminal session {} for server {}", existing, id);
        return Ok(SessionConnectResult { session_id: existing });
    }
    let server = {
        let mut data = state.data.lock().map_err(|e| e.to_string())?;
        let s = data
            .servers
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or("Server not found")?;
        s.status = "connecting".into();
        let _ = window.emit("server-status-changed", s.clone());
        s.clone()
    };

    // Keychain IPC is blocking — keep it off the async runtime workers.
    let server_id_for_creds = server.id.clone();
    let (password, key_passphrase) = tauri::async_runtime::spawn_blocking(move || {
        let password = match credential_store::get_password(&server_id_for_creds) {
            Ok(password) => password,
            Err(err) => {
                warn!(
                    "Failed to read password from keychain for {}: {}",
                    server_id_for_creds, err
                );
                None
            }
        };
        let key_passphrase = match credential_store::get_key_passphrase(&server_id_for_creds) {
            Ok(passphrase) => passphrase,
            Err(err) => {
                warn!(
                    "Failed to read key passphrase from keychain for {}: {}",
                    server_id_for_creds, err
                );
                None
            }
        };
        (password, key_passphrase)
    })
    .await
    .map_err(|err| err.to_string())?;
    let use_key_auth = server.auth_method == "key";

    if !matches!(server.os_type, OsType::Linux) {
        return Err("当前版本暂不支持 Windows 服务器（仅支持 Linux SSH）".into());
    }

    let username = if matches!(&server.os_type, OsType::Linux)
        && server.username.eq_ignore_ascii_case("root")
    {
        "root".to_string()
    } else {
        server.username
    };

    let session_id = session_manager::start_session(
        window,
        server.id,
        username,
        server.host,
        server.port,
        password,
        if use_key_auth { server.key_path } else { None },
        if use_key_auth { key_passphrase } else { None },
        server.proxy_jump,
        state,
        session_manager,
    )?;

    Ok(SessionConnectResult { session_id })
}

#[tauri::command(async)]
pub fn list_terminal_sessions(
    session_manager: State<'_, SessionManagerState>,
) -> Result<Vec<session_manager::SessionSummary>, String> {
    Ok(session_manager::list_active_sessions(&session_manager))
}

/// 取会话历史输出快照（UI 刷新后回放）
#[tauri::command(async)]
pub fn get_terminal_session_output(
    session_manager: State<'_, SessionManagerState>,
    session_id: String,
) -> Result<String, String> {
    Ok(session_manager::session_output_snapshot(&session_manager, &session_id)
        .unwrap_or_default())
}

#[tauri::command]
pub fn pty_write(
    session_manager: State<'_, SessionManagerState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    session_manager::write_to_session(session_manager, session_id, data)
}

#[tauri::command(async)]
pub fn pty_resize(
    session_manager: State<'_, SessionManagerState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    session_manager::resize_session(session_manager, session_id, rows, cols)
}

#[tauri::command(async)]
pub fn get_terminal_session_directory(
    session_manager: State<'_, SessionManagerState>,
    session_id: String,
) -> Result<String, String> {
    session_manager::read_session_current_directory(session_manager, session_id)
}

#[tauri::command(async)]
pub fn disconnect_server(
    session_manager: State<'_, SessionManagerState>,
    server_id: String,
) -> Result<(), String> {
    session_manager::close_server_sessions(session_manager, server_id)
}

#[tauri::command(async)]
pub fn close_terminal_session(
    session_manager: State<'_, SessionManagerState>,
    session_id: String,
) -> Result<(), String> {
    session_manager::close_session(session_manager, session_id)
}
