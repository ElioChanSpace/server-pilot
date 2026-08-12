use crate::servers::application::AppState;
use serde::Serialize;
use std::fs;
use std::fs::OpenOptions;
use std::io::{self, SeekFrom, Seek};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use super::util::{run_ssh_command, shell_quote, SSH_COMMAND_TIMEOUT};
use super::file_transfer::resolve_transfer_server;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLogSnapshot {
    pub file_path: String,
    pub lines: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteLogResult {
    pub path: String,
    pub lines: Vec<String>,
}

fn resolve_app_log_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let log_dir = app_handle
        .path()
        .app_log_dir()
        .or_else(|_| {
            app_handle
                .path()
                .app_local_data_dir()
                .map(|path: PathBuf| path.join("logs"))
        })
        .map_err(|_| "无法解析应用日志目录".to_string())?;

    Ok(log_dir.join("app.log"))
}

/// Read the last `max_lines` lines from a file efficiently by seeking from the end.
/// This avoids loading the entire file into memory.
fn tail_file(path: &PathBuf, max_lines: usize) -> io::Result<Vec<String>> {
    let mut file = fs::File::open(path)?;
    let file_len = file.metadata()?.len();

    if file_len == 0 {
        return Ok(Vec::new());
    }

    // Read backwards in chunks to find line boundaries
    let chunk_size: u64 = 8192;
    let mut lines_found: Vec<String> = Vec::new();
    let mut buf = Vec::new();
    let mut pos = file_len;
    let mut leftover = Vec::new();

    while pos > 0 && lines_found.len() < max_lines {
        let read_size = chunk_size.min(pos);
        pos -= read_size;
        buf.resize(read_size as usize, 0);
        file.seek(SeekFrom::Start(pos))?;
        io::Read::read_exact(&mut file, &mut buf)?;

        // Prepend the new chunk to leftover from previous iteration
        let mut combined = buf.clone();
        combined.extend_from_slice(&leftover);

        // Split into lines (from the end)
        let mut remaining = combined.len();
        while remaining > 0 && lines_found.len() < max_lines {
            // Find the last newline in combined[..remaining]
            let search_end = remaining;
            let newline_pos = combined[..search_end]
                .iter()
                .rposition(|&b| b == b'\n');

            if let Some(nl_pos) = newline_pos {
                let line_bytes = &combined[nl_pos + 1..remaining];
                if !line_bytes.is_empty() || remaining > nl_pos + 1 {
                    if let Ok(line) = String::from_utf8(line_bytes.to_vec()) {
                        lines_found.push(line);
                    }
                }
                remaining = nl_pos;
            } else {
                // No newline found — this is the beginning of the file
                break;
            }
        }

        // Save the unconsumed prefix for the next iteration
        leftover = combined[..remaining].to_vec();
    }

    // Handle the very first line (no leading newline)
    if !leftover.is_empty() && lines_found.len() < max_lines {
        if let Ok(line) = String::from_utf8(leftover) {
            let trimmed = line.trim_end_matches('\n');
            if !trimmed.is_empty() {
                lines_found.push(trimmed.to_string());
            }
        }
    }

    lines_found.reverse();
    Ok(lines_found)
}

#[tauri::command]
pub async fn read_app_logs(
    app_handle: AppHandle,
    limit: Option<usize>,
) -> Result<AppLogSnapshot, String> {
    let log_path = resolve_app_log_path(&app_handle)?;
    let max_lines = limit.unwrap_or(500).max(1);

    if !log_path.exists() {
        return Ok(AppLogSnapshot {
            file_path: log_path.display().to_string(),
            lines: Vec::new(),
        });
    }

    let lines = tail_file(&log_path, max_lines)
        .map_err(|err| format!("读取日志失败: {}", err))?;

    Ok(AppLogSnapshot {
        file_path: log_path.display().to_string(),
        lines,
    })
}

#[tauri::command]
pub async fn clear_app_logs(app_handle: AppHandle) -> Result<(), String> {
    let log_path = resolve_app_log_path(&app_handle)?;

    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("创建日志目录失败: {}", err))?;
    }

    OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
        .map_err(|err| format!("清空日志失败: {}", err))?;

    Ok(())
}

#[tauri::command]
pub async fn read_remote_log(
    state: tauri::State<'_, AppState>,
    id: String,
    path: String,
    lines: Option<u32>,
) -> Result<RemoteLogResult, String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("请指定远程日志文件路径".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;
    let count = lines.unwrap_or(200).clamp(10, 2000);
    let command = format!("tail -n {} -- {}", count, shell_quote(&path));

    tauri::async_runtime::spawn_blocking(move || {
        let output = run_ssh_command(
            &connection.username,
            &connection.host,
            connection.port,
            connection.password.as_deref(),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &command,
            SSH_COMMAND_TIMEOUT,
            "read remote log",
        )?;
        Ok(RemoteLogResult {
            path: path.clone(),
            lines: output.lines().map(str::to_string).collect(),
        })
    })
    .await
    .map_err(|err| err.to_string())?
}
