use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use log::{error, info};
use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use tauri::{AppHandle, Manager, State, Window};
use crate::servers::{AppState, PtyState};

// 代表一个活动的 PTY 会话
pub struct Session {
    pub pty: Box<dyn MasterPty + Send>,
    pub child_process: Box<dyn portable_pty::Child + Send>,
    pub alive: Arc<AtomicBool>,
}

// SessionManager 的状态，由 Tauri 管理
#[derive(Default)]
pub struct SessionManagerState(pub Arc<Mutex<HashMap<String, Arc<Mutex<Session>>>>>);

// 启动一个新的会话
pub fn start_session(
    window: Window,
    server_id: String,
    username: String,
    host: String,
    port: u16,
    app_state: State<'_, AppState>,
    session_manager_state: State<'_, SessionManagerState>,
) -> Result<(), String> {
    info!("Attempting to start session for server_id: {}", server_id);
    let pty_system = NativePtySystem::default();
    let pair = pty_system.openpty(PtySize::default()).map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new("ssh");
    cmd.arg(format!("{}@{}", username, host));
    cmd.arg("-p");
    cmd.arg(port.to_string());

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let session = Arc::new(Mutex::new(Session {
        pty: pair.master,
        child_process: child,
        alive: Arc::new(AtomicBool::new(true)),
    }));

    // 将新会话存入管理器
    session_manager_state.0.lock().unwrap().insert(server_id.clone(), session.clone());

    // --- Reader 任务 ---
    let reader_window = window.clone();
    let reader_server_id = server_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    // 定向发送事件
                    let event_name = format!("pty-data-{}", reader_server_id);
                    reader_window.emit(&event_name, data).unwrap();
                }
                _ => break,
            }
        }
    });

    // --- Monitor 任务 ---
    let monitor_window = window.clone();
    let monitor_server_id = server_id.clone();
    let monitor_app_state = Arc::clone(&app_state.0);
    let monitor_session_manager_state = Arc::clone(&session_manager_state.0);
    tauri::async_runtime::spawn(async move {
        let child_session = session.lock().unwrap().child_process.try_wait();
        if let Ok(Some(status)) = child_session {
             info!("Session {} exited with status: {}", monitor_server_id, status);
        }

        // 清理工作
        {
            let mut app_data = monitor_app_state.lock().unwrap();
            if let Some(s) = app_data.servers.iter_mut().find(|s| s.id == monitor_server_id) {
                s.status = "disconnected".into();
                monitor_window.emit("server-status-changed", s.clone()).unwrap();
            }
        }
        monitor_session_manager_state.lock().unwrap().remove(&monitor_server_id);
        let log_event = format!("connection-log-{}", monitor_server_id);
        monitor_window.emit(&log_event, "Connection closed.").unwrap();
    });

    Ok(())
}

// 向指定会话写入数据
pub fn write_to_session(
    session_manager_state: State<'_, SessionManagerState>,
    server_id: String,
    data: String,
) -> Result<(), String> {
    if let Some(session) = session_manager_state.0.lock().unwrap().get(&server_id) {
        let mut session_guard = session.lock().unwrap();
        session_guard.pty.take_writer().map_err(|e| e.to_string())?
            .write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// 调整指定会话的大小
pub fn resize_session(
    session_manager_state: State<'_, SessionManagerState>,
    server_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
     if let Some(session) = session_manager_state.0.lock().unwrap().get(&server_id) {
        let mut session_guard = session.lock().unwrap();
        session_guard.pty.resize(PtySize { rows, cols, ..Default::default() }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// 关闭指定会话
pub fn close_session(
    session_manager_state: State<'_, SessionManagerState>,
    server_id: String,
) -> Result<(), String> {
    if let Some(session) = session_manager_state.0.lock().unwrap().remove(&server_id) {
        let session_guard = session.lock().unwrap();
        session_guard.alive.store(false, Ordering::SeqCst);
        // child_process and pty will be dropped here, terminating the connection.
        info!("Session {} closed by user.", server_id);
    }
    Ok(())
}