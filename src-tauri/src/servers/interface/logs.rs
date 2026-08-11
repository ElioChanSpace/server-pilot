use crate::servers::application::AppState;
use serde::Serialize;
use std::fs;
use std::fs::OpenOptions;
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

#[tauri::command]
pub async fn read_app_logs(
    app_handle: AppHandle,
    limit: Option<usize>,
) -> Result<AppLogSnapshot, String> {
    let log_path = resolve_app_log_path(&app_handle)?;
    let max_lines = limit.unwrap_or(500).max(1);
    let content = match fs::read_to_string(&log_path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(err) => return Err(format!("读取日志失败: {}", err)),
    };

    let mut lines = content
        .lines()
        .map(|line| line.to_string())
        .collect::<Vec<_>>();

    if lines.len() > max_lines {
        let start = lines.len() - max_lines;
        lines = lines.split_off(start);
    }

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
