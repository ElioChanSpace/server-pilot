use crate::servers::application::AppState;
use log::{info, warn};
use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
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

/// 会话输出环形缓冲上限（UI 刷新后恢复回放用）
const OUTPUT_RING_LIMIT: usize = 2 * 1024 * 1024;

// 代表一个活动的 PTY 会话
pub struct Session {
    pub session_id: String,
    pub server_id: String,
    /// 会话创建时间（Unix ms），用于 UI 刷新后恢复 tab 元数据
    pub created_at: u64,
    pub pty: Box<dyn MasterPty + Send>,
    /// Ordered, non-blocking write queue: the main thread never blocks on a
    /// stalled PTY while keystrokes keep their order (single writer thread).
    pub write_tx: std::sync::mpsc::Sender<Vec<u8>>,
    pub child_process: Box<dyn portable_pty::Child + Send>,
    pub alive: Arc<AtomicBool>,
    pub was_connected: bool,
    pub last_activity_at: Instant,
    pub close_reason: Option<String>,
    last_output: String,
    /// 环形输出缓冲：UI 刷新/重连后可整体回放，按字节上限裁剪
    output_ring: Vec<u8>,
    /// Last successfully probed remote working directory (cached so tab badges
    /// can show it without injecting a probe command into the terminal).
    pub last_known_cwd: Option<String>,
    pending_cwd_request: Option<PendingCwdRequest>,
    pending_host_key: Option<mpsc::Sender<bool>>,
}

// SessionManager 的状态
#[derive(Default)]
pub struct SessionManagerState(pub Arc<Mutex<HashMap<String, Arc<Mutex<Session>>>>>);

impl Clone for SessionManagerState {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

const PASSWORD_PROMPT_BUFFER_LIMIT: usize = 2048;
const PENDING_CWD_BUFFER_LIMIT: usize = 16384;
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
    message: String,
    should_remove: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostKeyPromptEvent {
    session_id: String,
    server_id: String,
    fingerprint: String,
}

fn emit_terminal_session_status(window: &Window, session_id: &str, server_id: &str, status: &str) {
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
    message: &str,
    should_remove: bool,
) {
    if let Err(err) = window.emit(
        "terminal-session-closed",
        TerminalSessionClosedEvent {
            session_id: session_id.to_string(),
            server_id: server_id.to_string(),
            reason: reason.to_string(),
            message: message.to_string(),
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SshPromptKind {
    LoginPassword,
    KeyPassphrase,
}

/// Classify interactive prompts that may accept saved credentials.
///
/// Only SSH login prompts are matched on purpose: generic prompts like
/// "New password:" (passwd), "Enter password:" (mysql) or gpg prompts must
/// never receive the saved SSH credentials.
fn classify_ssh_prompt(output_tail: &str) -> Option<SshPromptKind> {
    let sanitized = strip_ansi_sequences(output_tail).to_ascii_lowercase();
    let prompt_line = sanitized
        .rsplit(|ch| ch == '\n' || ch == '\r')
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();

    if prompt_line.contains("sudo") {
        return None;
    }

    if prompt_line.starts_with("enter passphrase for key") {
        return Some(SshPromptKind::KeyPassphrase);
    }

    // `user@host's password:` and bare `password:` (keyboard-interactive)
    if prompt_line == "password:" || prompt_line.ends_with("'s password:") {
        return Some(SshPromptKind::LoginPassword);
    }

    None
}

#[cfg(test)]
fn should_auto_fill_ssh_password(output_tail: &str) -> bool {
    classify_ssh_prompt(output_tail).is_some()
}

fn should_accept_host_key_prompt(output_tail: &str) -> bool {
    let sanitized = strip_ansi_sequences(output_tail).to_ascii_lowercase();
    let prompt_line = sanitized
        .rsplit(['\n', '\r'])
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();

    prompt_line.contains("are you sure you want to continue connecting")
        && (prompt_line.ends_with("(yes/no/[fingerprint])?")
            || prompt_line.ends_with("(yes/no)?")
            || prompt_line.ends_with('?'))
}

fn extract_host_key_fingerprint(buffer: &str) -> String {
    let sanitized = strip_ansi_sequences(buffer);
    let fingerprint_line = sanitized
        .lines()
        .map(str::trim)
        .find(|line| line.contains("fingerprint is"))
        .map(|line| line.to_string());

    fingerprint_line.unwrap_or_else(|| {
        sanitized
            .lines()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string()
    })
}

fn append_session_output(session: &Arc<Mutex<Session>>, data: &str) {
    if let Ok(mut guard) = session.lock() {
        // Receiving output counts as activity so long-running commands
        // (tail -f, builds, migrations) are not killed by the idle timeout.
        guard.last_activity_at = Instant::now();
        // 环形缓冲：供 UI 刷新后整体回放，超限从头部裁剪
        guard.output_ring.extend_from_slice(data.as_bytes());
        if guard.output_ring.len() > OUTPUT_RING_LIMIT {
            let excess = guard.output_ring.len() - OUTPUT_RING_LIMIT;
            guard.output_ring.drain(..excess);
        }
        guard.last_output.push_str(data);
        if guard.last_output.len() > 8192 {
            let keep_from = guard.last_output.len() - 8192;
            let start = guard
                .last_output
                .char_indices()
                .find(|(index, _)| *index >= keep_from)
                .map(|(index, _)| index)
                .unwrap_or(guard.last_output.len());
            guard.last_output.drain(..start);
        }
    }
}

fn extract_connect_error(output: &str) -> String {
    strip_ansi_sequences(output)
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| {
            !line.is_empty()
                && !line.eq_ignore_ascii_case("yes")
                && !line.ends_with("password:")
                && !line.contains("continue connecting")
                && !line.contains("are you sure")
                && !line.contains("fingerprint is")
        })
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "连接失败，请检查网络与服务器状态".to_string())
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

fn trim_pending_cwd_buffer(buffer: &mut String) {
    if buffer.len() <= PENDING_CWD_BUFFER_LIMIT {
        return;
    }
    let target = buffer.len().saturating_sub(PENDING_CWD_BUFFER_LIMIT);
    let keep_from = buffer
        .char_indices()
        .find(|(index, _)| *index >= target)
        .map(|(index, _)| index)
        .unwrap_or(buffer.len());
    buffer.drain(..keep_from);
}

fn process_pending_cwd_output(
    pending_request: &mut PendingCwdRequest,
    chunk: &str,
) -> (String, Option<Result<String, String>>) {
    pending_request.buffer.push_str(chunk);
    trim_pending_cwd_buffer(&mut pending_request.buffer);

    let mut display = String::new();

    loop {
        if let Some(command_index) = pending_request.buffer.find(&pending_request.command_text) {
            display.push_str(&pending_request.buffer[..command_index]);
            let command_end = command_index + pending_request.command_text.len();
            pending_request.buffer.drain(..command_end);
            continue;
        }

        if let Some(start_index) = pending_request.buffer.find(&pending_request.marker_start) {
            display.push_str(&pending_request.buffer[..start_index]);

            let marker_value_start = start_index + pending_request.marker_start.len();
            if let Some(end_rel) =
                pending_request.buffer[marker_value_start..].find(&pending_request.marker_end)
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
                    return (display, Some(Err("无法读取当前终端目录".to_string())));
                }

                return (display, Some(Ok(cwd)));
            }

            // End marker not arrived yet: keep only the tail in the buffer. The
            // pre-marker content was already appended to `display` above and must
            // not be appended twice.
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
    proxy_jump: Option<String>,
    app_state: State<'_, AppState>,
    session_manager_state: State<'_, SessionManagerState>,
) -> Result<String, String> {
    info!("Attempting to start session for server_id: {}", server_id);
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize::default())
        .map_err(|e| e.to_string())?;
    let session_id = Uuid::new_v4().to_string();

    let ssh_path = if cfg!(target_os = "windows") {
        "C:\\Windows\\System32\\OpenSSH\\ssh.exe"
    } else {
        "ssh"
    };
    let mut cmd = CommandBuilder::new(ssh_path);
    cmd.arg(format!("{}@{}", username, host));
    cmd.arg("-p");
    cmd.arg(port.to_string());
    if let Some(key_path) = key_path.as_deref() {
        cmd.arg("-i");
        cmd.arg(key_path);
    }
    if let Some(proxy_jump) = proxy_jump.as_deref() {
        cmd.arg("-J");
        cmd.arg(proxy_jump);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = Arc::new(Mutex::new(
        pair.master.take_writer().map_err(|e| e.to_string())?,
    ));

    // Single dedicated writer thread per session: writes are queued in order
    // and a slow/stalled PTY can never block the calling thread (UI).
    let (write_tx, write_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    let writer_for_thread = writer.clone();
    std::thread::spawn(move || {
        while let Ok(bytes) = write_rx.recv() {
            match writer_for_thread.lock() {
                Ok(mut writer_guard) => {
                    if writer_guard.write_all(&bytes).and_then(|_| writer_guard.flush()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let session = Arc::new(Mutex::new(Session {
        session_id: session_id.clone(),
        server_id: server_id.clone(),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        pty: pair.master,
        write_tx: write_tx.clone(),
        child_process: child,
        alive: Arc::new(AtomicBool::new(true)),
        was_connected: false,
        last_activity_at: Instant::now(),
        close_reason: None,
        last_output: String::new(),
        output_ring: Vec::new(),
        last_known_cwd: None,
        pending_cwd_request: None,
        pending_host_key: None,
    }));

    session_manager_state
        .0
        .lock()
        .map_err(|err| err.to_string())?
        .insert(session_id.clone(), session.clone());

    emit_terminal_session_status(&window, &session_id, &server_id, "connecting");

    // --- Reader 任务 ---
    let reader_window = window.clone();
    let reader_server_id = server_id.clone();
    let reader_session_id = session_id.clone();
    let reader_write_tx = write_tx.clone();
    let reader_app_data = app_state.data.clone();
    let reader_session = session.clone();
    let auto_password = password.filter(|password| !password.is_empty());
    let auto_passphrase = key_passphrase.filter(|passphrase| !passphrase.is_empty());
    tauri::async_runtime::spawn_blocking(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        let mut password_prompt_buffer = String::new();
        let mut password_sent = false;
        let mut connected_emitted = false;
        let mut host_key_confirmed = false;
        let mut remainder: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => {
                    // Build the full byte slice, prepending any incomplete UTF-8 bytes from last read
                    let combined;
                    let raw: &[u8] = if remainder.is_empty() {
                        &buf[..n]
                    } else {
                        combined = [remainder.as_slice(), &buf[..n]].concat();
                        remainder.clear();
                        &combined
                    };
                    // Decode UTF-8: only an *incomplete* trailing sequence may be carried
                    // over to the next read. Invalid bytes must be replaced right away,
                    // otherwise they poison `remainder` and freeze output forever.
                    let mut data = match std::str::from_utf8(raw) {
                        Ok(s) => {
                            remainder.clear();
                            s.to_string()
                        }
                        Err(err) => match err.error_len() {
                            Some(_) => {
                                // Truly invalid byte sequence: lossy-convert everything.
                                remainder.clear();
                                String::from_utf8_lossy(raw).to_string()
                            }
                            None => {
                                // Incomplete sequence at the end: cache at most 3 bytes.
                                let valid_up_to = err.valid_up_to();
                                let data =
                                    String::from_utf8_lossy(&raw[..valid_up_to]).to_string();
                                remainder.clear();
                                remainder.extend_from_slice(&raw[valid_up_to..]);
                                data
                            }
                        },
                    };
                    append_session_output(&reader_session, &data);
                    password_prompt_buffer.push_str(&data);
                    trim_prompt_buffer(&mut password_prompt_buffer);

                    if !host_key_confirmed && should_accept_host_key_prompt(&password_prompt_buffer)
                    {
                        let fingerprint = extract_host_key_fingerprint(&password_prompt_buffer);
                        let (responder, receiver) = mpsc::channel();
                        if let Ok(mut session_guard) = reader_session.lock() {
                            session_guard.pending_host_key = Some(responder);
                        }
                        let _ = reader_window.emit(
                            "host-key-prompt",
                            HostKeyPromptEvent {
                                session_id: reader_session_id.clone(),
                                server_id: reader_server_id.clone(),
                                fingerprint,
                            },
                        );
                        host_key_confirmed = true;

                        // 独立线程等待用户响应并写入 PTY，避免 reader 阻塞在 read() 时
                        // 无法处理指纹确认结果（否则首次连接会卡死）。
                        let response_writer = reader_write_tx.clone();
                        let response_session = reader_session.clone();
                        thread::spawn(move || match receiver.recv() {
                            Ok(accept) => {
                                let _ = response_writer
                                    .send(if accept { b"yes\r".to_vec() } else { b"no\r".to_vec() });
                                if let Ok(mut session_guard) = response_session.lock() {
                                    session_guard.pending_host_key = None;
                                }
                            }
                            Err(_) => {}
                        });
                    }

                    // Auto-fill saved credentials only during the login phase and
                    // only for the matching prompt type: a key passphrase prompt must
                    // never receive the login password and vice versa.
                    if !password_sent && !connected_emitted {
                        let prompt_kind = classify_ssh_prompt(&password_prompt_buffer);
                        let credential = match prompt_kind {
                            Some(SshPromptKind::LoginPassword) => {
                                auto_password.as_deref().or(auto_passphrase.as_deref())
                            }
                            Some(SshPromptKind::KeyPassphrase) => {
                                auto_passphrase.as_deref().or(auto_password.as_deref())
                            }
                            None => None,
                        };
                        if let Some(password) = credential {
                            let host_key_resolved = if host_key_confirmed {
                                reader_session
                                    .lock()
                                    .map(|guard| guard.pending_host_key.is_none())
                                    .unwrap_or(true)
                            } else {
                                true
                            };
                            if host_key_resolved {
                                let mut payload = password.as_bytes().to_vec();
                                payload.push(b'\r');
                                match reader_write_tx.send(payload) {
                                    Ok(()) => {
                                        password_sent = true;
                                    }
                                    Err(err) => {
                                        warn!(
                                            "Failed to queue saved SSH password for {}: {}",
                                            reader_server_id, err
                                        );
                                    }
                                }
                            }
                        }
                    }

                    if !connected_emitted {
                        if should_mark_session_connected(&password_prompt_buffer) {
                            // Lock ordering: never hold app_data and session locks at the
                            // same time (the monitor thread reads idle timeout via app_data
                            // while holding the session lock).
                            if let Ok(mut session_guard) = reader_session.lock() {
                                session_guard.was_connected = true;
                            }
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
                            if let Some(pending_request) =
                                session_guard.pending_cwd_request.as_mut()
                            {
                                process_pending_cwd_output(pending_request, &data)
                            } else {
                                (std::mem::take(&mut data), None)
                            }
                        }
                        Err(err) => {
                            warn!(
                                "Failed to lock session {} while processing PTY output: {}",
                                reader_session_id, err
                            );
                            (std::mem::take(&mut data), None)
                        }
                    };

                    if let Some(cwd_result) = cwd_response {
                        match reader_session.lock() {
                            Ok(mut session_guard) => {
                                if let Some(pending_request) =
                                    session_guard.pending_cwd_request.take()
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

                    if let Err(err) = reader_window.emit(
                        "pty-data",
                        (reader_session_id.clone(), display_data.clone()),
                    ) {
                        warn!("Failed to emit PTY data for {}: {}", reader_session_id, err);
                    }
                }
                Ok(_) => break,
                Err(err) => {
                    warn!(
                        "Failed to read PTY output for {}: {}",
                        reader_session_id, err
                    );
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
            // Read the idle timeout before taking the session lock to preserve a
            // global lock ordering of app_data -> session (see reader thread).
            let idle_timeout = resolve_idle_timeout(&monitor_app_data);
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
            let mut sessions = match monitor_session_manager_state.lock() {
                Ok(guard) => guard,
                Err(err) => {
                    warn!("Session manager lock poisoned during cleanup: {}", err);
                    return;
                }
            };
            sessions.remove(&monitor_session_id);
            !sessions.values().any(|session| {
                session
                    .lock()
                    .map(|guard| {
                        guard.server_id == monitor_server_id && guard.alive.load(Ordering::SeqCst)
                    })
                    .unwrap_or(false)
            })
        };

        if should_mark_disconnected {
            let mut app_data = match monitor_app_data.lock() {
                Ok(guard) => guard,
                Err(err) => {
                    warn!("App data lock poisoned during cleanup: {}", err);
                    return;
                }
            };
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
        let mut close_message = connection_log_message_for_reason(&close_reason);
        if close_reason == "connect-failed" {
            if let Ok(session_guard) = session.lock() {
                close_message = extract_connect_error(&session_guard.last_output);
            }
        }
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
            &close_message,
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

    let mut session_guard = session.lock().map_err(|e| e.to_string())?;
    session_guard
        .write_tx
        .send(data.into_bytes())
        .map_err(|e| format!("PTY writer terminated: {}", e))?;
    session_guard.last_activity_at = Instant::now();
    Ok(())
}

#[tauri::command]
pub fn respond_to_host_key_prompt(
    session_manager_state: State<'_, SessionManagerState>,
    session_id: String,
    accept: bool,
) -> Result<(), String> {
    let session = session_manager_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| format!("No active PTY session for session {}", session_id))?;

    let responder = {
        let mut session_guard = session.lock().map_err(|e| e.to_string())?;
        session_guard
            .pending_host_key
            .take()
            .ok_or("当前会话没有待确认的主机指纹请求")?
    };

    responder
        .send(accept)
        .map_err(|_| "主机指纹请求已失效，请重试".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_ansi_removes_escape_sequences() {
        assert_eq!(strip_ansi_sequences("\u{1b}[31mred\u{1b}[0m"), "red");
        assert_eq!(strip_ansi_sequences("plain"), "plain");
    }

    #[test]
    fn auto_fill_matches_password_and_passphrase_prompts() {
        assert_eq!(
            classify_ssh_prompt("user@host's password: "),
            Some(SshPromptKind::LoginPassword)
        );
        assert_eq!(
            classify_ssh_prompt("Enter passphrase for key '/root/.ssh/id_ed25519': "),
            Some(SshPromptKind::KeyPassphrase)
        );
        assert_eq!(classify_ssh_prompt("password:"), Some(SshPromptKind::LoginPassword));
        assert!(should_auto_fill_ssh_password("user@host's password: "));
        assert!(!should_auto_fill_ssh_password("sudo password: "));
        // Generic non-SSH prompts must never receive saved credentials
        assert!(!should_auto_fill_ssh_password("New password: "));
        assert!(!should_auto_fill_ssh_password("Retype new password: "));
        assert!(!should_auto_fill_ssh_password("Enter password: "));
    }

    #[test]
    fn host_key_prompt_detection_and_fingerprint_extraction() {
        let prompt = "The authenticity of host '1.2.3.4 (1.2.3.4)' can't be established.\r\nED25519 key fingerprint is SHA256:AbCdEf.\r\nAre you sure you want to continue connecting (yes/no/[fingerprint])? ";
        assert!(should_accept_host_key_prompt(prompt));

        let fingerprint = extract_host_key_fingerprint(prompt);
        assert!(fingerprint.contains("SHA256:AbCdEf"));
    }
}

pub fn read_session_current_directory(
    session_manager_state: State<'_, SessionManagerState>,
    session_id: String,
) -> Result<String, String> {
    probe_session_cwd(&session_manager_state, &session_id)
}

pub fn probe_session_cwd(
    session_manager_state: &SessionManagerState,
    session_id: &str,
) -> Result<String, String> {
    let session = session_manager_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(session_id)
        .cloned()
        .ok_or_else(|| format!("No active PTY session for session {}", session_id))?;

    let (command_text, responder_rx, write_tx) = {
        let mut session_guard = session.lock().map_err(|e| e.to_string())?;
        if session_guard.pending_cwd_request.is_some() {
            return Err("正在读取当前终端目录，请稍后重试".to_string());
        }

        let request_id = Uuid::new_v4().to_string();
        let marker_start = format!("__SERVER_PILOT_CWD_START_{}__", request_id);
        let marker_end = format!("__SERVER_PILOT_CWD_END_{}__", request_id);
        let command_text = format!("printf '{}%s{}' \"$PWD\"", marker_start, marker_end);
        let (responder, receiver) = mpsc::channel();
        session_guard.pending_cwd_request = Some(PendingCwdRequest {
            command_text: command_text.clone(),
            marker_start,
            marker_end,
            buffer: String::new(),
            responder,
        });

        (command_text, receiver, session_guard.write_tx.clone())
    };

    {
        let mut payload = command_text.into_bytes();
        payload.push(b'\r');
        write_tx
            .send(payload)
            .map_err(|e| format!("PTY writer terminated: {}", e))?;
    }

    match responder_rx.recv_timeout(Duration::from_secs(3)) {
        Ok(result) => {
            if let Ok(cwd) = &result {
                if let Ok(mut session_guard) = session.lock() {
                    session_guard.last_known_cwd = Some(cwd.clone());
                }
            }
            result
        }
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

/// Return the cached working directory of a session without probing the PTY.
pub fn session_cached_cwd(
    session_manager_state: &SessionManagerState,
    session_id: &str,
) -> Option<String> {
    let sessions = session_manager_state.0.lock().ok()?;
    let session = sessions.get(session_id)?.lock().ok()?;
    session.last_known_cwd.clone()
}

/// Whether the session has been idle (no input/output) for at least `min_idle`.
/// Probing the terminal while the user is typing would corrupt their input.
pub fn session_is_idle(
    session_manager_state: &SessionManagerState,
    session_id: &str,
    min_idle: Duration,
) -> bool {
    let sessions = session_manager_state.0.lock().ok();
    let Some(sessions) = sessions else { return false };
    let Some(session) = sessions.get(session_id) else { return false };
    let Ok(guard) = session.lock() else { return false };
    guard.alive.load(Ordering::SeqCst) && guard.last_activity_at.elapsed() >= min_idle
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
    let session = {
        let sessions = session_manager_state
            .0
            .lock()
            .map_err(|err| err.to_string())?;
        sessions.get(&session_id).cloned()
    };
    if let Some(session) = session {
        let mut session_guard = session.lock().map_err(|err| err.to_string())?;
        session_guard.alive.store(false, Ordering::SeqCst);
        session_guard.close_reason = Some("manual".to_string());
        session_guard.pending_host_key = None;
        session_guard.pending_cwd_request = None;
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
        session_guard.pending_host_key = None;
        session_guard.pending_cwd_request = None;
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
    let sessions = session_manager_state
        .0
        .lock()
        .map_err(|err| err.to_string())?;
    Ok(sessions.values().any(|session| {
        session
            .lock()
            .map(|guard| guard.server_id == server_id && guard.alive.load(Ordering::SeqCst))
            .unwrap_or(false)
    }))
}

/// UI 刷新后恢复 tab 用的会话摘要
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub session_id: String,
    pub server_id: String,
    pub alive: bool,
    pub was_connected: bool,
    pub created_at: u64,
}

/// 枚举全部存活的终端会话（UI 刷新/重启后对账恢复用）
pub fn list_active_sessions(
    session_manager_state: &State<'_, SessionManagerState>,
) -> Vec<SessionSummary> {
    let Ok(sessions) = session_manager_state.0.lock() else {
        return Vec::new();
    };
    sessions
        .values()
        .filter_map(|session| {
            let guard = session.lock().ok()?;
            if !guard.alive.load(Ordering::SeqCst) {
                return None;
            }
            Some(SessionSummary {
                session_id: guard.session_id.clone(),
                server_id: guard.server_id.clone(),
                alive: true,
                was_connected: guard.was_connected,
                created_at: guard.created_at,
            })
        })
        .collect()
}

/// 查找服务器已存在的存活会话（连接复用，避免重复建 PTY）
pub fn find_active_session_for_server(
    session_manager_state: &State<'_, SessionManagerState>,
    server_id: &str,
) -> Option<String> {
    let sessions = session_manager_state.0.lock().ok()?;
    sessions.values().find_map(|session| {
        let guard = session.lock().ok()?;
        if guard.server_id == server_id && guard.alive.load(Ordering::SeqCst) {
            Some(guard.session_id.clone())
        } else {
            None
        }
    })
}

/// 取会话输出环形缓冲快照（UI 刷新后回放历史输出）
pub fn session_output_snapshot(
    session_manager_state: &State<'_, SessionManagerState>,
    session_id: &str,
) -> Option<String> {
    let sessions = session_manager_state.0.lock().ok()?;
    let session = sessions.get(session_id)?.lock().ok()?;
    Some(String::from_utf8_lossy(&session.output_ring).into_owned())
}

/// 关闭全部终端会话（"刷新后不恢复"设置生效时的兜底清理，避免孤儿 PTY）
pub fn close_all_sessions(
    session_manager_state: &State<'_, SessionManagerState>,
) -> Result<usize, String> {
    let sessions: Vec<Arc<Mutex<Session>>> = {
        let guard = session_manager_state
            .0
            .lock()
            .map_err(|err| err.to_string())?;
        guard.values().cloned().collect()
    };
    let mut closed = 0;
    for session in sessions {
        if let Ok(mut session_guard) = session.lock() {
            if session_guard.alive.load(Ordering::SeqCst) {
                session_guard.alive.store(false, Ordering::SeqCst);
                session_guard.close_reason = Some("manual".to_string());
                session_guard.pending_host_key = None;
                session_guard.pending_cwd_request = None;
                let _ = session_guard.child_process.kill();
                closed += 1;
            }
        }
    }
    Ok(closed)
}
