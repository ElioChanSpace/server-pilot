use crate::servers::application::AppState;
use log::{info, warn};
use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, State, Window};

// 代表一个活动的 PTY 会话
pub struct Session {
    pub pty: Box<dyn MasterPty + Send>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub child_process: Box<dyn portable_pty::Child + Send>,
    pub alive: Arc<AtomicBool>,
}

// SessionManager 的状态
#[derive(Default)]
pub struct SessionManagerState(pub Arc<Mutex<HashMap<String, Arc<Mutex<Session>>>>>);

const PASSWORD_PROMPT_BUFFER_LIMIT: usize = 2048;

fn trim_prompt_buffer(buffer: &mut String) {
    if buffer.len() <= PASSWORD_PROMPT_BUFFER_LIMIT {
        return;
    }

    let target = buffer.len().saturating_sub(PASSWORD_PROMPT_BUFFER_LIMIT);
    let keep_from = buffer
        .char_indices()
        .find(|(index, _)| *index >= target)
        .map(|(index, _)| index)
        .unwrap_or(buffer.len());
    buffer.drain(..keep_from);
}

fn strip_ansi_sequences(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\x1b' && matches!(chars.peek(), Some('[')) {
            chars.next();
            for control in chars.by_ref() {
                if ('@'..='~').contains(&control) {
                    break;
                }
            }
            continue;
        }

        output.push(ch);
    }

    output
}

fn should_auto_fill_ssh_password(output_tail: &str) -> bool {
    let sanitized = strip_ansi_sequences(output_tail).to_ascii_lowercase();
    let prompt_line = sanitized
        .rsplit(|ch| ch == '\n' || ch == '\r')
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();

    if !prompt_line.ends_with("password:") || prompt_line.contains("sudo") {
        return false;
    }

    prompt_line == "password:"
        || prompt_line.contains("'s password:")
        || prompt_line.ends_with(" password:")
}

fn should_mark_session_connected(output_tail: &str) -> bool {
    let sanitized = strip_ansi_sequences(output_tail);
    let prompt_line = sanitized
        .rsplit(|ch| ch == '\n' || ch == '\r')
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();
    let normalized = prompt_line.to_ascii_lowercase();

    sanitized.contains("Last login")
        || (prompt_line.contains('@')
            && (prompt_line.ends_with('$')
                || prompt_line.ends_with('#')
                || prompt_line.ends_with('>')))
        || normalized.starts_with("welcome to ")
}

// 启动一个新的会话
pub fn start_session(
    window: Window,
    server_id: String,
    username: String,
    host: String,
    port: u16,
    password: Option<String>,
    app_state: State<'_, AppState>,
    session_manager_state: State<'_, SessionManagerState>,
) -> Result<(), String> {
    info!("Attempting to start session for server_id: {}", server_id);
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize::default())
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new("ssh");
    cmd.arg(format!("{}@{}", username, host));
    cmd.arg("-p");
    cmd.arg(port.to_string());

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = Arc::new(Mutex::new(
        pair.master.take_writer().map_err(|e| e.to_string())?,
    ));

    let session = Arc::new(Mutex::new(Session {
        pty: pair.master,
        writer: writer.clone(),
        child_process: child,
        alive: Arc::new(AtomicBool::new(true)),
    }));

    session_manager_state
        .0
        .lock()
        .unwrap()
        .insert(server_id.clone(), session.clone());

    // --- Reader 任务 ---
    let reader_window = window.clone();
    let reader_server_id = server_id.clone();
    let reader_writer = writer.clone();
    let reader_app_data = app_state.data.clone();
    let auto_password = password.filter(|password| !password.is_empty());
    tauri::async_runtime::spawn_blocking(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        let mut password_prompt_buffer = String::new();
        let mut password_sent = false;
        let mut connected_emitted = false;
        loop {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    if let Err(err) =
                        reader_window.emit("pty-data", (reader_server_id.clone(), data.clone()))
                    {
                        warn!("Failed to emit PTY data for {}: {}", reader_server_id, err);
                    }
                    let event_name = format!("pty-data-{}", reader_server_id);
                    if let Err(err) = reader_window.emit(&event_name, data.clone()) {
                        warn!(
                            "Failed to emit PTY data event for {}: {}",
                            reader_server_id, err
                        );
                    }

                    if !password_sent {
                        if let Some(password) = auto_password.as_deref() {
                            password_prompt_buffer.push_str(&data);
                            trim_prompt_buffer(&mut password_prompt_buffer);

                            if should_auto_fill_ssh_password(&password_prompt_buffer) {
                                match reader_writer.lock() {
                                    Ok(mut writer) => {
                                        if let Err(err) = writer.write_all(password.as_bytes()) {
                                            warn!(
                                                "Failed to write saved SSH password for {}: {}",
                                                reader_server_id, err
                                            );
                                        } else if let Err(err) = writer.write_all(b"\r") {
                                            warn!(
                                                "Failed to submit saved SSH password for {}: {}",
                                                reader_server_id, err
                                            );
                                        } else if let Err(err) = writer.flush() {
                                            warn!(
                                                "Failed to flush saved SSH password for {}: {}",
                                                reader_server_id, err
                                            );
                                        } else {
                                            password_sent = true;
                                        }
                                    }
                                    Err(err) => {
                                        warn!(
                                            "Failed to lock PTY writer for {}: {}",
                                            reader_server_id, err
                                        );
                                    }
                                }
                            }
                        }
                    }

                    if !connected_emitted {
                        password_prompt_buffer.push_str(&data);
                        trim_prompt_buffer(&mut password_prompt_buffer);

                        if should_mark_session_connected(&password_prompt_buffer) {
                            match reader_app_data.lock() {
                                Ok(mut app_data) => {
                                    if let Some(server) = app_data
                                        .servers
                                        .iter_mut()
                                        .find(|server| server.id == reader_server_id)
                                    {
                                        server.status = "connected".into();
                                        if let Err(err) = reader_window
                                            .emit("server-status-changed", server.clone())
                                        {
                                            warn!(
                                                "Failed to emit connected status for {}: {}",
                                                reader_server_id, err
                                            );
                                        } else {
                                            connected_emitted = true;
                                        }
                                    }
                                }
                                Err(err) => {
                                    warn!(
                                        "Failed to lock app data while marking {} connected: {}",
                                        reader_server_id, err
                                    );
                                }
                            }
                        }
                    }
                }
                _ => break,
            }
        }
    });

    // --- Monitor 任务 ---
    let monitor_window = window.clone();
    let monitor_server_id = server_id.clone();
    let monitor_app_data = app_state.data.clone();
    let monitor_session_manager_state = session_manager_state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        loop {
            let child_status = {
                let mut session_guard = match session.lock() {
                    Ok(guard) => guard,
                    Err(err) => {
                        warn!("Session {} lock poisoned: {}", monitor_server_id, err);
                        break;
                    }
                };

                if !session_guard.alive.load(Ordering::SeqCst) {
                    break;
                }

                session_guard.child_process.try_wait()
            };

            match child_status {
                Ok(Some(status)) => {
                    info!(
                        "Session {} exited with status: {}",
                        monitor_server_id, status
                    );
                    break;
                }
                Ok(None) => thread::sleep(Duration::from_millis(250)),
                Err(err) => {
                    warn!(
                        "Failed to check session {} status: {}",
                        monitor_server_id, err
                    );
                    break;
                }
            }
        }

        // 清理工作
        {
            let mut app_data = monitor_app_data.lock().unwrap();
            if let Some(s) = app_data
                .servers
                .iter_mut()
                .find(|s| s.id == monitor_server_id)
            {
                s.status = "disconnected".into();
                if let Err(err) = monitor_window.emit("server-status-changed", s.clone()) {
                    warn!(
                        "Failed to emit server status for {}: {}",
                        monitor_server_id, err
                    );
                }
            }
        }
        monitor_session_manager_state
            .lock()
            .unwrap()
            .remove(&monitor_server_id);
        let log_event = format!("connection-log-{}", monitor_server_id);
        if let Err(err) = monitor_window.emit(
            "connection-log",
            (monitor_server_id.clone(), "Connection closed.".to_string()),
        ) {
            warn!(
                "Failed to emit connection log for {}: {}",
                monitor_server_id, err
            );
        }
        if let Err(err) = monitor_window.emit(&log_event, "Connection closed.") {
            warn!(
                "Failed to emit connection log event for {}: {}",
                monitor_server_id, err
            );
        }
    });

    Ok(())
}

pub fn write_to_session(
    session_manager_state: State<'_, SessionManagerState>,
    server_id: String,
    data: String,
) -> Result<(), String> {
    let session = session_manager_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&server_id)
        .cloned()
        .ok_or_else(|| format!("No active PTY session for server {}", server_id))?;

    let writer = {
        let session_guard = session.lock().map_err(|e| e.to_string())?;
        session_guard.writer.clone()
    };

    let mut writer_guard = writer.lock().map_err(|e| e.to_string())?;
    writer_guard
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    writer_guard.flush().map_err(|e| e.to_string())
}

pub fn resize_session(
    session_manager_state: State<'_, SessionManagerState>,
    server_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let session = session_manager_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&server_id)
        .cloned()
        .ok_or_else(|| format!("No active PTY session for server {}", server_id))?;

    let session_guard = session.lock().map_err(|e| e.to_string())?;
    session_guard
        .pty
        .resize(PtySize {
            rows,
            cols,
            ..Default::default()
        })
        .map_err(|e| e.to_string())
}

pub fn close_session(
    session_manager_state: State<'_, SessionManagerState>,
    server_id: String,
) -> Result<(), String> {
    if let Some(session) = session_manager_state.0.lock().unwrap().remove(&server_id) {
        let mut session_guard = session.lock().unwrap();
        session_guard.alive.store(false, Ordering::SeqCst);
        if let Err(err) = session_guard.child_process.kill() {
            warn!("Failed to kill session {}: {}", server_id, err);
        }
        info!("Session {} closed by user.", server_id);
    }
    Ok(())
}
