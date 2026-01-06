
// --- Persistence Functions ---

use std::fs;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use log::info;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use tauri::{AppHandle, State, Window};
use crate::servers::{AppData, AppState, Category, OsType, PtySession, PtyState, Server, DATA_FILE};

fn save_data(app: &AppHandle, data: &AppData) -> Result<(), String> {
    let path = app.path_resolver().app_data_dir().ok_or("Could not resolve app data dir")?;
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    let file_path = path.join(DATA_FILE);
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(file_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_data(app: &AppHandle) -> AppData {
    if let Some(path) = app.path_resolver().app_data_dir() {
        let file_path = path.join(DATA_FILE);
        if file_path.exists() {
            if let Ok(json) = fs::read_to_string(file_path) {
                if let Ok(data) = serde_json::from_str(&json) {
                    return data;
                }
            }
        }
    }
    AppData::default()
}

// --- Tauri Commands ---

#[tauri::command]
pub fn create_server(
    state: State<'_, AppState>,
    app: AppHandle,
    name: String,
    host: String,
    port: u16,
    username: String,
    category_id: Option<String>,
    os_type: OsType,
    password: Option<String>
) -> Result<Server, String> {
    let mut data = state.0.lock().map_err(|e| e.to_string())?;
    let server = Server::new(name, host, port, username, category_id, os_type, password);
    data.servers.push(server.clone());
    save_data(&app, &data)?;
    Ok(server)
}

#[tauri::command]
pub fn create_category(
    state: State<'_, AppState>,
    app: AppHandle,
    name: String,
    parent_id: Option<String>
) -> Result<Category, String> {
    let mut data = state.0.lock().map_err(|e| e.to_string())?;
    let category = Category::new(name, parent_id);
    data.categories.push(category.clone());
    save_data(&app, &data)?;
    Ok(category)
}

#[tauri::command]
pub fn get_servers(state: State<'_, AppState>) -> Result<Vec<Server>, String> {
    let data = state.0.lock().map_err(|e| e.to_string())?;
    Ok(data.servers.clone())
}

#[tauri::command]
pub fn get_categories(state: State<'_, AppState>) -> Result<Vec<Category>, String> {
    let data = state.0.lock().map_err(|e| e.to_string())?;
    Ok(data.categories.clone())
}

#[tauri::command]
pub fn pty_write(
    pty_state: State<'_, PtyState>,
    server_id: String,
    data: String
) -> Result<(), String> {
    let mut sessions = pty_state.sessions.lock().map_err(|e| e.to_string())?;

    if let Some(session) = sessions.get_mut(&server_id) {
        session.pty
            .take_writer()
            .map_err(|e| e.to_string())?
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("PTY session not found for server: {}", server_id))
    }
}

#[tauri::command]
pub fn pty_resize(
    pty_state: State<'_, PtyState>,
    server_id: String,
    rows: u16,
    cols: u16
) -> Result<(), String> {
    let mut sessions = pty_state.sessions.lock().map_err(|e| e.to_string())?;

    if let Some(session) = sessions.get_mut(&server_id) {
        session.pty
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("PTY session not found for server: {}", server_id))
    }
}

#[tauri::command]
pub fn disconnect_server(
    state: State<'_, AppState>,
    pty_state: State<'_, PtyState>,
    window: Window,
    server_id: String,
) -> Result<(), String> {
    // 标记会话为不活跃
    {
        let sessions = pty_state.sessions.lock().map_err(|e| e.to_string())?;
        if let Some(session) = sessions.get(&server_id) {
            session.alive.store(false, Ordering::SeqCst);
        }
    }

    // 更新服务器状态
    {
        let mut data = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(server) = data.servers.iter_mut().find(|s| s.id == server_id) {
            server.status = "disconnected".into();
            let _ = window.emit("server-status-changed", server.clone());
        }
    }

    // 移除会话
    {
        let mut sessions = pty_state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.remove(&server_id);
    }

    let _ = window.emit("connection-log", "Disconnected by user.".to_string());

    Ok(())
}

#[tauri::command]
pub async fn connect_server(
    window: Window,
    state: State<'_, AppState>,
    pty_state: State<'_, PtyState>,
    id: String,
) -> Result<(), String> {

    // ---------- 1. 获取服务器并设置 connecting ----------
    let server = {
        let mut data = state.0.lock().map_err(|e| e.to_string())?;
        let s = data.servers.iter_mut()
            .find(|s| s.id == id)
            .ok_or("Server not found")?;

        s.status = "connecting".into();
        let _ = window.emit("server-status-changed", s.clone());
        s.clone()
    };
    info!("开始连接服务器:{:?}", server);
    let _ = window.emit(
        "connection-log",
        format!("Connecting to {} ({}@{})...", server.name, server.username, server.host),
    );

    // ---------- 2. 目前只实现 Linux / macOS ----------
    if !matches!(server.os_type, OsType::Linux) {
        let mut data = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(s) = data.servers.iter_mut().find(|s| s.id == server.id) {
            s.status = "disconnected".into();
            let _ = window.emit("server-status-changed", s.clone());
        }
        return Err("Only Linux SSH is supported currently".into());
    }

    // ---------- 3. 创建 PTY ----------
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // 修复：SSH 命令参数应该分开传递
    let mut cmd = CommandBuilder::new("ssh");
    cmd.arg(format!("{}@{}", server.username, server.host));
    cmd.arg("-p");
    cmd.arg(server.port.to_string());

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| {
            // 连接失败时更新状态
            let mut data = state.0.lock().unwrap();
            if let Some(s) = data.servers.iter_mut().find(|s| s.id == server.id) {
                s.status = "disconnected".into();
                info!("断开连接!");
                let _ = window.emit("server-status-changed", s.clone());
            }
            e.to_string()
        })?;

    let reader = pair.master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;

    let alive = Arc::new(AtomicBool::new(true));

    // ---------- 4. 保存 session ----------
    {
        let mut sessions = pty_state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.insert(
            server.id.clone(),
            PtySession {
                server_id: server.id.clone(),
                pty: pair.master,
                alive: alive.clone(),
            },
        );
    }

    // ---------- 5. PTY 读取线程 ----------
    {
        let window = window.clone();
        let server_id = server.id.clone();
        let alive_clone = alive.clone();

        tauri::async_runtime::spawn_blocking(move || {
            let mut reader = reader;
            let mut buf = [0u8; 8192];

            while alive_clone.load(Ordering::SeqCst) {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        info!("读取到数据:{:?}", data);
                        // --- THE FIX: Use a session-specific event name ---
                        let event_name = format!("pty-data-{}", server_id);
                        let _ = window.emit(&event_name, data);
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // ---------- 6. 子进程监控 ----------
    // 克隆 Arc 以便在 'static 闭包中使用
    let state_arc = Arc::clone(&state.0);
    let pty_sessions_arc = Arc::clone(&pty_state.sessions);

    {
        let window = window.clone();
        let server_id = server.id.clone();
        let alive_clone = alive.clone();

        tauri::async_runtime::spawn_blocking(move || {
            let result = child.wait();

            alive_clone.store(false, Ordering::SeqCst);

            let status_msg = match result {
                Ok(s) => format!("Disconnected. Exit status: {:?}", s.exit_code()),
                Err(e) => format!("Disconnected with error: {}", e),
            };

            {
                let mut data = state_arc.lock().unwrap();
                if let Some(s) = data.servers.iter_mut().find(|s| s.id == server_id) {
                    s.status = "disconnected".into();
                    let _ = window.emit("server-status-changed", s.clone());
                }
            }

            let _ = window.emit("connection-log", status_msg);

            let mut sessions = pty_sessions_arc.lock().unwrap();
            sessions.remove(&server_id);
        });
    }

    // ---------- 7. 标记 connected ----------
    {
        let mut data = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(s) = data.servers.iter_mut().find(|s| s.id == server.id) {
            s.status = "connected".into();
            let _ = window.emit("server-status-changed", s.clone());
        }
    }

    let _ = window.emit("connection-log", "Connection established.".to_string());

    Ok(())
}