use crate::servers::application::AppState;
use log::{info, warn};
use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::sync::mpsc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, State, Window};
use uuid::Uuid;

struct PendingCwdRequest {
    command_text: String,
    marker_start: String,
    marker_end: String,
    buffer: String,
    responder: mpsc::Sender<Result<String, String>>,
}

// 代表一个活动的 PTY 会话
pub struct Session {
    pub session_id: String,
    pub server_id: String,
    pub pty: Box<dyn MasterPty + Send>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub child_process: Box<dyn portable_pty::Child + Send>,
    pub alive: Arc<AtomicBool>,
    pub was_connected: bool,
    pub last_activity_at: Instant,
    pub close_reason: Option<String>,
    pending_cwd_request: Option<PendingCwdRequest>,
}

// SessionManager 的状态
#[derive(Default)]
pub struct SessionManagerState(pub Arc<Mutex<HashMap<String, Arc<Mutex<Session>>>>>);

const PASSWORD_PROMPT_BUFFER_LIMIT: usize = 2048;
const SESSION_MONITOR_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionStatusEvent {
    session_id: String,
    server_id: String,
    status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionClosedEvent {
    session_id: String,
    server_id: String,
    reason: String,
    should_remove: bool,
}

fn emit_terminal_session_status(
    window: &Window,
    session_id: &str,
    server_id: &str,
    status: &str,
) {
    if let Err(err) = window.emit(
        "terminal-session-status-changed",
        TerminalSessionStatusEvent {
            session_id: session_id.to_string(),
            server_id: server_id.to_string(),
            status: status.to_string(),
        },
    ) {
        warn!(
            "Failed to emit session status {} for session {}: {}",
            status, session_id, err
        );
    }
}

fn emit_terminal_session_closed(
    window: &Window,
    session_id: &str,
    server_id: &str,
    reason: &str,
    should_remove: bool,
) {
    if let Err(err) = window.emit(
        "terminal-session-closed",
        TerminalSessionClosedEvent {
            session_id: session_id.to_string(),
            server_id: server_id.to_string(),
            reason: reason.to_string(),
            should_remove,
        },
    ) {
        warn!(
            "Failed to emit session closed event for {}: {}",
            session_id, err
        );
    }
}

fn connection_log_message_for_reason(reason: &str) -> String {
    match reason {
        "idle-timeout" => "Connection closed due to inactivity.".to_string(),
        "server-disconnect" => "Connection closed by server disconnect.".to_string(),
        "manual" => "Connection closed by user.".to_string(),
        "connect-failed" => "Connection failed.".to_string(),
        _ => "Connection closed.".to_string(),
    }
}

fn resolve_idle_timeout(app_data: &Arc<Mutex<crate::servers::domain::AppData>>) -> Duration {
    let settings = app_data
        .lock()
        .ok()
        .map(|data| data.settings.clone())
        .unwrap_or_default();

    if !settings.terminal_idle_disconnect_enabled {
        return Duration::MAX;
    }

    Duration::from_secs(u64::from(settings.terminal_idle_disconnect_minutes.max(1)) * 60)
}

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

fn process_pending_cwd_output(
    pending_request: &mut PendingCwdRequest,
    chunk: &str,
) -> (String, Option<Result<String, String>>) {
    pending_request.buffer.push_str(chunk);

    let mut display = String::new();

    loop {
        if let Some(command_index) = pending_request
            .buffer
            .find(&pending_request.command_text)
        {
            display.push_str(&pending_request.buffer[..command_index]);
            let command_end = command_index + pending_request.command_text.len();
            pending_request.buffer.drain(..command_end);
            continue;
        }

        if let Some(start_index) = pending_request
            .buffer
            .find(&pending_request.marker_start)
        {
            display.push_str(&pending_request.buffer[..start_index]);

            let marker_value_start = start_index + pending_request.marker_start.len();
            if let Some(end_rel) = pending_request.buffer[marker_value_start..]
                .find(&pending_request.marker_end)
            {
                let marker_value_end = marker_value_start + end_rel;
                let cwd = pending_request.buffer[marker_value_start..marker_value_end]
                    .trim()
                    .to_string();
                let marker_end = marker_value_end + pending_request.marker_end.len();
                pending_request.buffer.drain(..marker_end);

                if pending_request.buffer.starts_with("\r\n") {
                    pending_request.buffer.drain(..2);
                } else if pending_request.buffer.starts_with('\n')
                    || pending_request.buffer.starts_with('\r')
                {
                    pending_request.buffer.drain(..1);
                }

                display.push_str(&pending_request.buffer);
                pending_request.buffer.clear();

                if cwd.is_empty() {
                    return (
                        display,
                        Some(Err("无法读取当前终端目录".to_string())),
                    );
                }

                return (display, Some(Ok(cwd)));
            }

            display.push_str(&pending_request.buffer[..start_index]);
            pending_request.buffer.drain(..start_index);
            break;
        }

        let preserve_tail_len = pending_request
            .command_text
            .len()
            .max(pending_request.marker_start.len().saturating_sub(1))
            .max(pending_request.marker_end.len().saturating_sub(1));
        let carry_len = pending_request.buffer.len().min(preserve_tail_len);
        let split_index = pending_request.buffer.len().saturating_sub(carry_len);
        display.push_str(&pending_request.buffer[..split_index]);
        pending_request.buffer.drain(..split_index);
        break;
    }

    (display, None)
}

// 启动一个新的会话
pub fn start_session(
    window: Window,
    server_id: String,
    username: String,
    host: String,
    port: u16,
    password: Option<String>,
    key_path: Option<String>,
    key_passphrase: Option<String>,
    app_state: State<'_, AppState>,
    session_manager_state: State<'_, SessionManagerState>,
) -> Result<String, String> {
    info!("Attempting to start session for server_id: {}", server_id);
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize::default())
        .map_err(|e| e.to_string())?;
    let session_id = Uuid::new_v4().to_string();

    let mut cmd = CommandBuilder::new("ssh");
    cmd.arg(format!("{}@{}", username, host));
    cmd.arg("-p");
    cmd.arg(port.to_string());
    if let Some(key_path) = key_path.as_deref() {
        cmd.arg("-i");
        cmd.arg(key_path);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = Arc::new(Mutex::new(
        pair.master.take_writer().map_err(|e| e.to_string())?,
    ));

    let session = Arc::new(Mutex::new(Session {
        session_id: session_id.clone(),
        server_id: server_id.clone(),
        pty: pair.master,
        writer: writer.clone(),
        child_process: child,
        alive: Arc::new(AtomicBool::new(true)),
        was_connected: false,
        last_activity_at: Instant::now(),
        close_reason: None,
        pending_cwd_request: None,
    }));

    session_manager_state
        .0
        .lock()
        .unwrap()
        .insert(session_id.clone(), session.clone());

    emit_terminal_session_status(&window, &session_id, &server_id, "connecting");

    // --- Reader 任务 ---
    let reader_window = window.clone();
    let reader_server_id = server_id.clone();
    let reader_session_id = session_id.clone();
    let reader_writer = writer.clone();
    let reader_app_data = app_state.data.clone();
    let reader_session = session.clone();
    let auto_password = password
        .or(key_passphrase)
        .filter(|password| !password.is_empty());
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
                                        emit_terminal_session_status(
                                            &reader_window,
                                            &reader_session_id,
                                            &reader_server_id,
                                            "connected",
                                        );
                                        if let Ok(mut session_guard) = reader_session.lock() {
                                            session_guard.was_connected = true;
                                        }
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

                    let (display_data, cwd_response) = match reader_session.lock() {
                        Ok(mut session_guard) => {
                            if let Some(pending_request) = session_guard.pending_cwd_request.as_mut() {
                                process_pending_cwd_output(pending_request, &data)
                            } else {
                                (data.clone(), None)
                            }
                        }
                        Err(err) => {
                            warn!(
                                "Failed to lock session {} while processing PTY output: {}",
                                reader_session_id, err
                            );
                            (data.clone(), None)
                        }
                    };

                    if let Some(cwd_result) = cwd_response {
                        match reader_session.lock() {
                            Ok(mut session_guard) => {
                                if let Some(pending_request) = session_guard.pending_cwd_request.take()
                                {
                                    let _ = pending_request.responder.send(cwd_result);
                                }
                            }
                            Err(err) => {
                                warn!(
                                    "Failed to clear cwd request for session {}: {}",
                                    reader_session_id, err
                                );
                            }
                        }
                    }

                    if display_data.is_empty() {
                        continue;
                    }

                    if let Err(err) = reader_window
                        .emit("pty-data", (reader_session_id.clone(), display_data.clone()))
                    {
                        warn!("Failed to emit PTY data for {}: {}", reader_session_id, err);
                    }
                }
                Ok(_) => break,
                Err(err) => {
                    warn!("Failed to read PTY output for {}: {}", reader_session_id, err);
                    break;
                }
            }
        }
    });

    // --- Monitor 任务 ---
    let monitor_window = window.clone();
    let monitor_server_id = server_id.clone();
    let monitor_session_id = session_id.clone();
    let monitor_app_data = app_state.data.clone();
    let monitor_session_manager_state = session_manager_state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut close_reason: Option<String> = None;
        let mut should_remove = true;
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
                    close_reason = session_guard.close_reason.clone();
                    break;
                }

                let idle_timeout = resolve_idle_timeout(&monitor_app_data);
                if idle_timeout != Duration::MAX
                    && session_guard.last_activity_at.elapsed() >= idle_timeout
                {
                    session_guard.alive.store(false, Ordering::SeqCst);
                    session_guard.close_reason = Some("idle-timeout".to_string());
                    close_reason = session_guard.close_reason.clone();
                    if let Err(err) = session_guard.child_process.kill() {
                        warn!(
                            "Failed to kill idle session {}: {}",
                            monitor_session_id, err
                        );
                    }
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
                    if close_reason.is_none() {
                        close_reason = Some(match session.lock() {
                            Ok(session_guard) if !session_guard.was_connected => {
                                should_remove = false;
                                "connect-failed".to_string()
                            }
                            _ => "process-exit".to_string(),
                        });
                    }
                    break;
                }
                Ok(None) => thread::sleep(SESSION_MONITOR_INTERVAL),
                Err(err) => {
                    warn!(
                        "Failed to check session {} status: {}",
                        monitor_server_id, err
                    );
                    if close_reason.is_none() {
                        close_reason = Some("process-exit".to_string());
                    }
                    break;
                }
            }
        }

        // 清理工作
        let should_mark_disconnected = {
            let mut sessions = monitor_session_manager_state.lock().unwrap();
            sessions.remove(&monitor_session_id);
            !sessions.values().any(|session| {
                session
                    .lock()
                    .map(|guard| {
                        guard.server_id == monitor_server_id
                            && guard.alive.load(Ordering::SeqCst)
                    })
                    .unwrap_or(false)
            })
        };

        if should_mark_disconnected {
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

        emit_terminal_session_status(
            &monitor_window,
            &monitor_session_id,
            &monitor_server_id,
            "disconnected",
        );
        let close_reason = close_reason.unwrap_or_else(|| "process-exit".to_string());
        let close_message = connection_log_message_for_reason(&close_reason);
        if let Err(err) = monitor_window.emit(
            "connection-log",
            (monitor_session_id.clone(), close_message.clone()),
        ) {
            warn!(
                "Failed to emit connection log for {}: {}",
                monitor_session_id, err
            );
        }
        emit_terminal_session_closed(
            &monitor_window,
            &monitor_session_id,
            &monitor_server_id,
            &close_reason,
            should_remove,
        );
    });

    Ok(session_id)
}

pub fn write_to_session(
    session_manager_state: State<'_, SessionManagerState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let session = session_manager_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| format!("No active PTY session for session {}", session_id))?;

    let writer = {
        let session_guard = session.lock().map_err(|e| e.to_string())?;
        session_guard.writer.clone()
    };

    let mut writer_guard = writer.lock().map_err(|e| e.to_string())?;
    writer_guard
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    writer_guard.flush().map_err(|e| e.to_string())?;
    if let Ok(mut session_guard) = session.lock() {
        session_guard.last_activity_at = Instant::now();
    }
    Ok(())
}

pub fn read_session_current_directory(
    session_manager_state: State<'_, SessionManagerState>,
    session_id: String,
) -> Result<String, String> {
    let session = session_manager_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| format!("No active PTY session for session {}", session_id))?;

    let (command_text, responder_rx, writer) = {
        let mut session_guard = session.lock().map_err(|e| e.to_string())?;
        if session_guard.pending_cwd_request.is_some() {
            return Err("正在读取当前终端目录，请稍后重试".to_string());
        }

        let request_id = Uuid::new_v4().to_string();
        let marker_start = format!("__SERVER_PILOT_CWD_START_{}__", request_id);
        let marker_end = format!("__SERVER_PILOT_CWD_END_{}__", request_id);
        let command_text = format!(
            "printf '{}%s{}' \"$PWD\"",
            marker_start, marker_end
        );
        let (responder, receiver) = mpsc::channel();
        session_guard.pending_cwd_request = Some(PendingCwdRequest {
            command_text: command_text.clone(),
            marker_start,
            marker_end,
            buffer: String::new(),
            responder,
        });

        (command_text, receiver, session_guard.writer.clone())
    };

    {
        let mut writer_guard = writer.lock().map_err(|e| e.to_string())?;
        writer_guard
            .write_all(command_text.as_bytes())
            .map_err(|e| e.to_string())?;
        writer_guard.write_all(b"\r").map_err(|e| e.to_string())?;
        writer_guard.flush().map_err(|e| e.to_string())?;
    }

    match responder_rx.recv_timeout(Duration::from_secs(3)) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            if let Ok(mut session_guard) = session.lock() {
                session_guard.pending_cwd_request = None;
            }
            Err("读取当前终端目录超时".to_string())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            if let Ok(mut session_guard) = session.lock() {
                session_guard.pending_cwd_request = None;
            }
            Err("读取当前终端目录失败".to_string())
        }
    }
}

pub fn resize_session(
    session_manager_state: State<'_, SessionManagerState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let session = session_manager_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| format!("No active PTY session for session {}", session_id))?;

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
    session_id: String,
) -> Result<(), String> {
    if let Some(session) = session_manager_state.0.lock().unwrap().get(&session_id).cloned() {
        let mut session_guard = session.lock().unwrap();
        session_guard.alive.store(false, Ordering::SeqCst);
        session_guard.close_reason = Some("manual".to_string());
        if let Err(err) = session_guard.child_process.kill() {
            warn!("Failed to kill session {}: {}", session_id, err);
        }
        info!("Session {} closed by user.", session_id);
    }
    Ok(())
}

pub fn close_server_sessions(
    session_manager_state: State<'_, SessionManagerState>,
    server_id: String,
) -> Result<(), String> {
    let sessions = session_manager_state
        .0
        .lock()
        .map_err(|err| err.to_string())?
        .values()
        .cloned()
        .collect::<Vec<_>>();

    for session in sessions {
        let mut session_guard = session.lock().map_err(|err| err.to_string())?;
        if session_guard.server_id != server_id {
            continue;
        }
        session_guard.alive.store(false, Ordering::SeqCst);
        session_guard.close_reason = Some("server-disconnect".to_string());
        if let Err(err) = session_guard.child_process.kill() {
            warn!(
                "Failed to kill session {} for server {}: {}",
                session_guard.session_id, server_id, err
            );
        }
    }

    Ok(())
}

pub fn has_active_session_for_server(
    session_manager_state: &State<'_, SessionManagerState>,
    server_id: &str,
) -> Result<bool, String> {
    let sessions = session_manager_state.0.lock().map_err(|err| err.to_string())?;
    Ok(sessions.values().any(|session| {
        session
            .lock()
            .map(|guard| guard.server_id == server_id && guard.alive.load(Ordering::SeqCst))
            .unwrap_or(false)
    }))
}
