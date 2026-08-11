use crate::servers::application::AppState;
use crate::servers::domain::OsType;
use crate::servers::infrastructure::credential_store;
use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use tauri::{Emitter, State, Window};

use super::util::{
    shell_quote, shell_double_quote, trim_prompt_buffer, should_auto_fill_ssh_password,
    build_remote_scp_argument, command_error_message, join_remote_path,
    read_between_markers, run_ssh_command,
    SSH_COMMAND_TIMEOUT, FILE_TRANSFER_TIMEOUT,
    DIRECTORY_OUTPUT_START, DIRECTORY_OUTPUT_END,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferResult {
    pub direction: String,
    pub local_path: String,
    pub remote_path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferProgressEvent {
    pub transfer_id: String,
    pub direction: String,
    pub local_path: String,
    pub remote_path: String,
    pub status: String,
    pub progress_percent: u8,
    pub transferred_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub bytes_per_second: Option<f64>,
    pub eta_seconds: Option<u64>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDirectoryListing {
    pub current_path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<RemoteDirectoryEntry>,
}

#[derive(Debug, Clone)]
pub struct TransferConnection {
    pub username: String,
    pub host: String,
    pub port: u16,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub key_passphrase: Option<String>,
    pub proxy_jump: Option<String>,
}

pub fn resolve_transfer_server(
    state: &State<'_, AppState>,
    id: &str,
) -> Result<TransferConnection, String> {
    let server = {
        let data = state.data.lock().map_err(|err| err.to_string())?;
        data.servers
            .iter()
            .find(|server| server.id == id)
            .cloned()
            .ok_or("Server not found")?
    };

    if !matches!(server.os_type, OsType::Linux) {
        return Err("当前版本仅支持 Linux 服务器传输文件".to_string());
    }

    let password = credential_store::get_password(id)?.filter(|value| !value.is_empty());
    let key_passphrase =
        credential_store::get_key_passphrase(id)?.filter(|value| !value.is_empty());

    if server.auth_method != "key" && password.is_none() {
        return Err("文件传输需要已保存的 SSH 密码，请编辑服务器并保存密码".to_string());
    }

    let username = if server.username.eq_ignore_ascii_case("root") {
        "root".to_string()
    } else {
        server.username
    };

    Ok(TransferConnection {
        username,
        host: server.host,
        port: server.port,
        password,
        key_path: server.key_path,
        key_passphrase,
        proxy_jump: server.proxy_jump,
    })
}

fn build_list_directory_command(path: &str) -> String {
    let target_dir = if path.trim().is_empty() {
        "\"${HOME:-/}\"".to_string()
    } else {
        shell_double_quote(path)
    };
    format!(
        r#"TARGET_DIR={target_dir}
if ! cd "$TARGET_DIR" 2>/dev/null; then
  echo "Unable to access directory: $TARGET_DIR"
  exit 1
fi
CURRENT_DIR=$(pwd)
if [ "$CURRENT_DIR" = "/" ]; then
  PARENT_DIR=""
else
  PARENT_DIR=$(dirname -- "$CURRENT_DIR")
fi
echo "{directory_output_start}"
printf "current_path=%s\n" "$CURRENT_DIR"
printf "parent_path=%s\n" "$PARENT_DIR"
find "$CURRENT_DIR" -mindepth 1 -maxdepth 1 -printf "entry=%P\t%y\t%s\n" 2>/dev/null | sort
echo "{directory_output_end}""#,
        target_dir = target_dir,
        directory_output_start = DIRECTORY_OUTPUT_START,
        directory_output_end = DIRECTORY_OUTPUT_END
    )
}

fn parse_remote_directory_output(output: &str) -> Result<RemoteDirectoryListing, String> {
    let directory_block =
        read_between_markers(output, DIRECTORY_OUTPUT_START, DIRECTORY_OUTPUT_END)?;

    let mut current_path = "/".to_string();
    let mut parent_path: Option<String> = None;
    let mut entries = Vec::new();

    for raw_line in directory_block.lines() {
        let line = raw_line.trim_end();
        if line.is_empty() {
            continue;
        }

        if let Some(value) = line.strip_prefix("current_path=") {
            current_path = value.to_string();
            continue;
        }

        if let Some(value) = line.strip_prefix("parent_path=") {
            if !value.is_empty() {
                parent_path = Some(value.to_string());
            }
            continue;
        }

        if let Some(value) = line.strip_prefix("entry=") {
            let mut parts = value.splitn(3, '\t');
            let name = parts.next().unwrap_or("").to_string();
            let entry_type = parts.next().unwrap_or("");
            let size = parts
                .next()
                .and_then(|item| item.parse::<u64>().ok())
                .unwrap_or(0);

            if name.is_empty() {
                continue;
            }

            entries.push(RemoteDirectoryEntry {
                path: join_remote_path(&current_path, &name),
                name,
                is_dir: entry_type == "d",
                size,
            });
        }
    }

    entries.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(RemoteDirectoryListing {
        current_path,
        parent_path,
        entries,
    })
}

fn emit_file_transfer_progress(
    window: Option<&Window>,
    transfer_id: Option<&str>,
    payload: FileTransferProgressEvent,
) {
    if window.is_none() || transfer_id.is_none() {
        return;
    }

    if let Some(window) = window {
        let _ = window.emit("file-transfer-progress", payload);
    }
}

fn parse_scp_speed(speed: &str) -> Option<f64> {
    let normalized = speed.trim();
    let units = [
        ("GB/s", 1024.0 * 1024.0 * 1024.0),
        ("MB/s", 1024.0 * 1024.0),
        ("KB/s", 1024.0),
        ("B/s", 1.0),
    ];

    for (suffix, multiplier) in units {
        if let Some(value) = normalized.strip_suffix(suffix) {
            let parsed = value.trim().parse::<f64>().ok()?;
            return Some(parsed * multiplier);
        }
    }

    None
}

fn parse_scp_eta(value: &str) -> Option<u64> {
    let parts = value
        .split(':')
        .map(|segment| segment.trim().parse::<u64>().ok())
        .collect::<Option<Vec<_>>>()?;

    match parts.as_slice() {
        [minutes, seconds] => Some(minutes * 60 + seconds),
        [hours, minutes, seconds] => Some(hours * 3600 + minutes * 60 + seconds),
        _ => None,
    }
}

fn parse_scp_progress(
    chunk: &str,
    file_name: &str,
    total_bytes: Option<u64>,
) -> Option<(u8, Option<u64>, Option<f64>, Option<u64>)> {
    for line in chunk.split(['\r', '\n']).rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.contains('%') || !trimmed.contains(file_name) {
            continue;
        }

        let tokens = trimmed.split_whitespace().collect::<Vec<_>>();
        let percent_index = tokens.iter().position(|token| {
            token.ends_with('%')
                && token
                    .trim_end_matches('%')
                    .chars()
                    .all(|ch| ch.is_ascii_digit())
        })?;
        let progress_percent = tokens[percent_index]
            .trim_end_matches('%')
            .parse::<u8>()
            .ok()?;
        let transferred_bytes =
            total_bytes.map(|total| total.saturating_mul(u64::from(progress_percent)) / 100);
        let bytes_per_second = tokens
            .get(percent_index + 2)
            .and_then(|value| parse_scp_speed(value));
        let eta_seconds = tokens
            .get(percent_index + 3)
            .and_then(|value| parse_scp_eta(value));

        return Some((
            progress_percent,
            transferred_bytes,
            bytes_per_second,
            eta_seconds,
        ));
    }

    None
}

fn run_scp_transfer(
    window: Option<Window>,
    transfer_id: Option<String>,
    port: u16,
    credential: Option<&str>,
    key_path: Option<&str>,
    proxy_jump: Option<&str>,
    source: &str,
    target: &str,
    action_label: &str,
    direction: &str,
    local_path: &str,
    remote_path: &str,
    total_bytes: Option<u64>,
) -> Result<(), String> {
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize::default())
        .map_err(|err| err.to_string())?;

    let mut cmd = CommandBuilder::new("scp");
    cmd.arg("-P");
    cmd.arg(port.to_string());
    cmd.arg("-o");
    cmd.arg("StrictHostKeyChecking=accept-new");
    if let Some(proxy_jump) = proxy_jump {
        cmd.arg("-J");
        cmd.arg(proxy_jump);
    }
    if let Some(key_path) = key_path {
        cmd.arg("-i");
        cmd.arg(key_path);
    }
    cmd.arg(source);
    cmd.arg(target);

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|err| err.to_string())?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| err.to_string())?;
    let writer = pair.master.take_writer().map_err(|err| err.to_string())?;

    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    thread::spawn(move || {
        let mut local_reader = reader;
        loop {
            let mut buffer = vec![0_u8; 8192];
            match local_reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = tx.send(Ok(Vec::new()));
                    break;
                }
                Ok(size) => {
                    buffer.truncate(size);
                    if tx.send(Ok(buffer)).is_err() {
                        break;
                    }
                }
                Err(err) => {
                    let _ = tx.send(Err(err.to_string()));
                    break;
                }
            }
        }
    });

    let mut writer = writer;
    let mut output = String::new();
    let mut prompt_buffer = String::new();
    let mut password_sent = false;
    let mut last_progress_percent = None;
    let deadline = Instant::now() + FILE_TRANSFER_TIMEOUT;
    let file_name = Path::new(local_path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(local_path)
        .to_string();

    loop {
        if Instant::now() > deadline {
            let _ = child.kill();
            return Err(format!("Timed out while trying to {}", action_label));
        }

        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(Ok(chunk)) => {
                if chunk.is_empty() {
                    break;
                }

                let text = String::from_utf8_lossy(&chunk).to_string();
                output.push_str(&text);
                prompt_buffer.push_str(&text);
                trim_prompt_buffer(&mut prompt_buffer);

                if let Some((progress_percent, transferred_bytes, bytes_per_second, eta_seconds)) =
                    parse_scp_progress(&text, &file_name, total_bytes)
                {
                    if last_progress_percent != Some(progress_percent) {
                        last_progress_percent = Some(progress_percent);
                        emit_file_transfer_progress(
                            window.as_ref(),
                            transfer_id.as_deref(),
                            FileTransferProgressEvent {
                                transfer_id: transfer_id.clone().unwrap_or_default(),
                                direction: direction.to_string(),
                                local_path: local_path.to_string(),
                                remote_path: remote_path.to_string(),
                                status: "progress".to_string(),
                                progress_percent,
                                transferred_bytes,
                                total_bytes,
                                bytes_per_second,
                                eta_seconds,
                                message: None,
                            },
                        );
                    }
                }

                if !password_sent {
                    if let Some(credential) = credential.filter(|value| !value.is_empty()) {
                        if should_auto_fill_ssh_password(&prompt_buffer) {
                            writer
                                .write_all(credential.as_bytes())
                                .map_err(|err| err.to_string())?;
                            writer.write_all(b"\r").map_err(|err| err.to_string())?;
                            writer.flush().map_err(|err| err.to_string())?;
                            password_sent = true;
                        }
                    }
                }
            }
            Ok(Err(err)) => return Err(err),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(status) = child.try_wait().map_err(|err| err.to_string())? {
                    if !status.success() {
                        return Err(command_error_message(
                            action_label,
                            &output,
                            &status.to_string(),
                        ));
                    }
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    let status = child.wait().map_err(|err| err.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(command_error_message(
            action_label,
            &output,
            &status.to_string(),
        ))
    }
}

#[tauri::command]
pub async fn list_remote_directory(
    state: State<'_, AppState>,
    id: String,
    path: Option<String>,
) -> Result<RemoteDirectoryListing, String> {
    let requested_path = path.unwrap_or_default().trim().to_string();

    let connection = resolve_transfer_server(&state, &id)?;
    let remote_command = build_list_directory_command(&requested_path);

    tauri::async_runtime::spawn_blocking(move || {
        let output = run_ssh_command(
            &connection.username,
            &connection.host,
            connection.port,
            connection.password.as_deref(),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &remote_command,
            SSH_COMMAND_TIMEOUT,
            "list remote directory",
        )?;
        parse_remote_directory_output(&output)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn upload_file_to_server(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    local_path: String,
    remote_path: String,
    transfer_id: Option<String>,
) -> Result<FileTransferResult, String> {
    let local_metadata = fs::metadata(&local_path)
        .map_err(|_| "Local file does not exist".to_string())?;
    if !local_metadata.is_file() {
        return Err("Only single file upload is supported".to_string());
    }

    if !Path::new(&local_path).exists() {
        return Err("Local file does not exist".to_string());
    }

    let remote_path = remote_path.trim().to_string();
    if remote_path.is_empty() {
        return Err("Remote path is required".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;
    let target = build_remote_scp_argument(&connection.username, &connection.host, &remote_path);
    let local_path_for_result = local_path.clone();
    let remote_path_for_result = remote_path.clone();
    let transfer_id_for_result = transfer_id.clone();
    let total_bytes = Some(local_metadata.len());

    if let Some(current_transfer_id) = transfer_id.as_deref() {
        emit_file_transfer_progress(
            Some(&window),
            Some(current_transfer_id),
            FileTransferProgressEvent {
                transfer_id: current_transfer_id.to_string(),
                direction: "upload".to_string(),
                local_path: local_path.clone(),
                remote_path: remote_path.clone(),
                status: "preparing".to_string(),
                progress_percent: 0,
                transferred_bytes: Some(0),
                total_bytes,
                bytes_per_second: None,
                eta_seconds: None,
                message: Some("准备上传文件".to_string()),
            },
        );
    }

    tauri::async_runtime::spawn_blocking(move || -> Result<FileTransferResult, String> {
        let transfer_result = run_scp_transfer(
            Some(window.clone()),
            transfer_id.clone(),
            connection.port,
            connection
                .password
                .as_deref()
                .or(connection.key_passphrase.as_deref()),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &local_path,
            &target,
            "upload file",
            "upload",
            &local_path,
            &remote_path,
            total_bytes,
        );

        if let Err(err) = transfer_result {
            if let Some(current_transfer_id) = transfer_id.as_deref() {
                emit_file_transfer_progress(
                    Some(&window),
                    Some(current_transfer_id),
                    FileTransferProgressEvent {
                        transfer_id: current_transfer_id.to_string(),
                        direction: "upload".to_string(),
                        local_path: local_path.clone(),
                        remote_path: remote_path.clone(),
                        status: "failed".to_string(),
                        progress_percent: 0,
                        transferred_bytes: None,
                        total_bytes,
                        bytes_per_second: None,
                        eta_seconds: None,
                        message: Some(err.clone()),
                    },
                );
            }
            return Err(err);
        }

        if let Some(current_transfer_id) = transfer_id_for_result.as_deref() {
            emit_file_transfer_progress(
                Some(&window),
                Some(current_transfer_id),
                FileTransferProgressEvent {
                    transfer_id: current_transfer_id.to_string(),
                    direction: "upload".to_string(),
                    local_path: local_path_for_result.clone(),
                    remote_path: remote_path_for_result.clone(),
                    status: "completed".to_string(),
                    progress_percent: 100,
                    transferred_bytes: total_bytes,
                    total_bytes,
                    bytes_per_second: None,
                    eta_seconds: Some(0),
                    message: Some(format!("已上传到 {}", remote_path_for_result)),
                },
            );
        }

        Ok(FileTransferResult {
            direction: "upload".to_string(),
            local_path: local_path_for_result,
            remote_path: remote_path_for_result.clone(),
            message: format!("Uploaded file to {}", remote_path_for_result),
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn download_file_from_server(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    remote_path: String,
    local_path: String,
    transfer_id: Option<String>,
) -> Result<FileTransferResult, String> {
    let remote_path = remote_path.trim().to_string();
    if remote_path.is_empty() {
        return Err("Remote path is required".to_string());
    }

    let local_path = local_path.trim().to_string();
    if local_path.is_empty() {
        return Err("Local path is required".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;
    let source = build_remote_scp_argument(&connection.username, &connection.host, &remote_path);
    let local_path_for_result = local_path.clone();
    let remote_path_for_result = remote_path.clone();
    let transfer_id_for_result = transfer_id.clone();

    if let Some(current_transfer_id) = transfer_id.as_deref() {
        emit_file_transfer_progress(
            Some(&window),
            Some(current_transfer_id),
            FileTransferProgressEvent {
                transfer_id: current_transfer_id.to_string(),
                direction: "download".to_string(),
                local_path: local_path.clone(),
                remote_path: remote_path.clone(),
                status: "preparing".to_string(),
                progress_percent: 0,
                transferred_bytes: Some(0),
                total_bytes: None,
                bytes_per_second: None,
                eta_seconds: None,
                message: Some("准备下载文件".to_string()),
            },
        );
    }

    tauri::async_runtime::spawn_blocking(move || -> Result<FileTransferResult, String> {
        let transfer_result = run_scp_transfer(
            Some(window.clone()),
            transfer_id.clone(),
            connection.port,
            connection
                .password
                .as_deref()
                .or(connection.key_passphrase.as_deref()),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &source,
            &local_path,
            "download file",
            "download",
            &local_path,
            &remote_path,
            None,
        );

        if let Err(err) = transfer_result {
            if let Some(current_transfer_id) = transfer_id.as_deref() {
                emit_file_transfer_progress(
                    Some(&window),
                    Some(current_transfer_id),
                    FileTransferProgressEvent {
                        transfer_id: current_transfer_id.to_string(),
                        direction: "download".to_string(),
                        local_path: local_path.clone(),
                        remote_path: remote_path.clone(),
                        status: "failed".to_string(),
                        progress_percent: 0,
                        transferred_bytes: None,
                        total_bytes: None,
                        bytes_per_second: None,
                        eta_seconds: None,
                        message: Some(err.clone()),
                    },
                );
            }
            return Err(err);
        }

        if let Some(current_transfer_id) = transfer_id_for_result.as_deref() {
            emit_file_transfer_progress(
                Some(&window),
                Some(current_transfer_id),
                FileTransferProgressEvent {
                    transfer_id: current_transfer_id.to_string(),
                    direction: "download".to_string(),
                    local_path: local_path_for_result.clone(),
                    remote_path: remote_path_for_result.clone(),
                    status: "completed".to_string(),
                    progress_percent: 100,
                    transferred_bytes: None,
                    total_bytes: None,
                    bytes_per_second: None,
                    eta_seconds: Some(0),
                    message: Some(format!("已下载到 {}", local_path_for_result)),
                },
            );
        }

        Ok(FileTransferResult {
            direction: "download".to_string(),
            local_path: local_path_for_result.clone(),
            remote_path: remote_path_for_result,
            message: format!("Downloaded file to {}", local_path_for_result),
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn delete_remote_path(
    state: State<'_, AppState>,
    id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let path = path.trim().to_string();
    if path.is_empty() || path == "/" {
        return Err("无效的远程路径".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;
    let command = if is_dir {
        format!("rm -rf -- {}", shell_quote(&path))
    } else {
        format!("rm -f -- {}", shell_quote(&path))
    };

    tauri::async_runtime::spawn_blocking(move || {
        run_ssh_command(
            &connection.username,
            &connection.host,
            connection.port,
            connection.password.as_deref(),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &command,
            SSH_COMMAND_TIMEOUT,
            "delete remote path",
        )?;
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn rename_remote_path(
    state: State<'_, AppState>,
    id: String,
    path: String,
    new_path: String,
) -> Result<(), String> {
    let path = path.trim().to_string();
    let new_path = new_path.trim().to_string();
    if path.is_empty() || new_path.is_empty() {
        return Err("无效的远程路径".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;
    let command = format!(
        "mv -- {} {}",
        shell_quote(&path),
        shell_quote(&new_path)
    );

    tauri::async_runtime::spawn_blocking(move || {
        run_ssh_command(
            &connection.username,
            &connection.host,
            connection.port,
            connection.password.as_deref(),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &command,
            SSH_COMMAND_TIMEOUT,
            "rename remote path",
        )?;
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn create_remote_directory(
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> Result<(), String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("无效的远程路径".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;
    let command = format!("mkdir -p -- {}", shell_quote(&path));

    tauri::async_runtime::spawn_blocking(move || {
        run_ssh_command(
            &connection.username,
            &connection.host,
            connection.port,
            connection.password.as_deref(),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &command,
            SSH_COMMAND_TIMEOUT,
            "create remote directory",
        )?;
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}
