use crate::servers::application::AppState;
use crate::servers::domain::OsType;
use crate::servers::infrastructure::credential_store;
use log::{error, info, warn};
use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::time::Instant;
use tauri::{Emitter, State, Window};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::ssh_client;

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
    info!("[Transfer] Resolving server: id={}", id);
    let server = {
        let data = state.data.lock().map_err(|err| err.to_string())?;
        data.servers
            .iter()
            .find(|server| server.id == id)
            .cloned()
            .ok_or_else(|| {
                error!("[Transfer] Server not found: id={}", id);
                "Server not found"
            })?
    };

    if !matches!(server.os_type, OsType::Linux) {
        error!("[Transfer] Unsupported OS type: {:?} for server {}", server.os_type, id);
        return Err("当前版本仅支持 Linux 服务器传输文件".to_string());
    }

    let password = credential_store::get_password(id)?.filter(|value| !value.is_empty());
    let key_passphrase =
        credential_store::get_key_passphrase(id)?.filter(|value| !value.is_empty());

    info!(
        "[Transfer] Credential resolved: server={}, host={}, port={}, user={}, has_password={}, has_key={}, auth_method={}",
        id, server.host, server.port, server.username,
        password.is_some(), server.key_path.is_some(), server.auth_method
    );

    if server.auth_method != "key" && password.is_none() {
        warn!("[Transfer] No password saved for server {} (auth_method={})", id, server.auth_method);
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

fn join_remote_path(base: &str, name: &str) -> String {
    if base.ends_with('/') {
        format!("{}{}", base, name)
    } else {
        format!("{}/{}", base, name)
    }
}

/// Create a tokio runtime for async SFTP operations inside spawn_blocking.
fn create_async_runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("Failed to create tokio runtime")
}

// ============================================================
// list_remote_directory
// ============================================================

#[tauri::command]
pub async fn list_remote_directory(
    state: State<'_, AppState>,
    id: String,
    path: Option<String>,
) -> Result<RemoteDirectoryListing, String> {
    let requested_path = path.unwrap_or_default().trim().to_string();
    info!("[Transfer] List directory: server_id={}, path={}", id, requested_path);

    let connection = resolve_transfer_server(&state, &id)?;

    tauri::async_runtime::spawn_blocking(move || {
        let rt = create_async_runtime();
        rt.block_on(async {
            let sftp = ssh_client::create_sftp_session(&connection).await?;

            // Resolve the target path
            let target_path = if requested_path.is_empty() {
                let home = sftp
                    .canonicalize(".")
                    .await
                    .unwrap_or_else(|_| "/".to_string());
                home
            } else {
                requested_path.clone()
            };

            // Get parent path
            let parent_path = if target_path == "/" {
                None
            } else {
                let parent = Path::new(&target_path)
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .filter(|p| !p.is_empty());
                parent.or_else(|| Some("/".to_string()))
            };

            // Read directory entries
            let read_dir = sftp
                .read_dir(&target_path)
                .await
                .map_err(|e| format!("Failed to read directory '{}': {}", target_path, e))?;

            let mut entries = Vec::new();
            for entry in read_dir {
                let name = entry.file_name();
                if name == "." || name == ".." {
                    continue;
                }
                let is_dir = entry
                    .metadata()
                    .file_type()
                    .is_dir();
                let size = entry.metadata().size.unwrap_or(0);
                entries.push(RemoteDirectoryEntry {
                    path: join_remote_path(&target_path, &name),
                    name,
                    is_dir,
                    size,
                });
            }

            // Sort: directories first, then by name
            entries.sort_by(|a, b| {
                b.is_dir
                    .cmp(&a.is_dir)
                    .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            });

            let _ = sftp.close().await;

            Ok(RemoteDirectoryListing {
                current_path: target_path,
                parent_path,
                entries,
            })
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

// ============================================================
// upload_file_to_server
// ============================================================

#[tauri::command]
pub async fn upload_file_to_server(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    local_path: String,
    remote_path: String,
    transfer_id: Option<String>,
) -> Result<FileTransferResult, String> {
    info!(
        "[Transfer] Upload file: server_id={}, local={}, remote={}, transfer_id={:?}",
        id, local_path, remote_path, transfer_id
    );

    let local_metadata =
        fs::metadata(&local_path).map_err(|_| "Local file does not exist".to_string())?;
    if !local_metadata.is_file() {
        return Err("Only single file upload is supported".to_string());
    }

    let remote_path = remote_path.trim().to_string();
    if remote_path.is_empty() {
        return Err("Remote path is required".to_string());
    }

    let total_bytes = Some(local_metadata.len());
    let connection = resolve_transfer_server(&state, &id)?;
    let local_path_for_result = local_path.clone();
    let remote_path_for_result = remote_path.clone();
    let transfer_id_for_result = transfer_id.clone();

    // Emit preparing
    if let Some(tid) = transfer_id.as_deref() {
        emit_file_transfer_progress(
            Some(&window),
            Some(tid),
            FileTransferProgressEvent {
                transfer_id: tid.to_string(),
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
        let rt = create_async_runtime();
        let result = rt.block_on(async {
            let sftp = ssh_client::create_sftp_session(&connection).await?;

            let mut remote_file = sftp
                .open_with_flags(
                    &remote_path,
                    russh_sftp::protocol::OpenFlags::CREATE
                        | russh_sftp::protocol::OpenFlags::TRUNCATE
                        | russh_sftp::protocol::OpenFlags::WRITE
                        | russh_sftp::protocol::OpenFlags::READ,
                )
                .await
                .map_err(|e| format!("Failed to open remote file '{}': {}", remote_path, e))?;

            let mut local_file =
                fs::File::open(&local_path).map_err(|e| format!("Failed to open local file: {}", e))?;

            let total = local_metadata.len();
            let mut transferred: u64 = 0;
            let start_time = Instant::now();
            let chunk_size = 256 * 1024; // 256KB
            let mut buffer = vec![0u8; chunk_size];
            let mut last_percent: u8 = 0;

            loop {
                let bytes_read = local_file
                    .read(&mut buffer)
                    .map_err(|e| format!("Failed to read local file: {}", e))?;

                if bytes_read == 0 {
                    break;
                }

                remote_file
                    .write_all(&buffer[..bytes_read])
                    .await
                    .map_err(|e| format!("Failed to write remote file: {}", e))?;

                transferred += bytes_read as u64;

                // Emit progress
                let percent = if total > 0 {
                    ((transferred as f64 / total as f64) * 100.0) as u8
                } else {
                    0
                };
                if percent != last_percent {
                    last_percent = percent;
                    let elapsed = start_time.elapsed().as_secs_f64();
                    let bps = if elapsed > 0.0 {
                        Some(transferred as f64 / elapsed)
                    } else {
                        None
                    };
                    let eta = if elapsed > 0.0 && transferred > 0 {
                        Some(((total - transferred) as f64 / (transferred as f64 / elapsed)) as u64)
                    } else {
                        None
                    };

                    emit_file_transfer_progress(
                        Some(&window),
                        transfer_id.as_deref(),
                        FileTransferProgressEvent {
                            transfer_id: transfer_id.clone().unwrap_or_default(),
                            direction: "upload".to_string(),
                            local_path: local_path.clone(),
                            remote_path: remote_path.clone(),
                            status: "progress".to_string(),
                            progress_percent: percent,
                            transferred_bytes: Some(transferred),
                            total_bytes,
                            bytes_per_second: bps,
                            eta_seconds: eta,
                            message: None,
                        },
                    );
                }
            }

            remote_file
                .flush()
                .await
                .map_err(|e| format!("Failed to flush remote file: {}", e))?;
            remote_file
                .shutdown()
                .await
                .map_err(|e| format!("Failed to close remote file: {}", e))?;

            let _ = sftp.close().await;
            Ok::<(), String>(())
        });

        result?;

        // Emit completed
        if let Some(tid) = transfer_id_for_result.as_deref() {
            emit_file_transfer_progress(
                Some(&window),
                Some(tid),
                FileTransferProgressEvent {
                    transfer_id: tid.to_string(),
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

// ============================================================
// upload_directory_to_server
// ============================================================

#[tauri::command]
pub async fn upload_directory_to_server(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    local_path: String,
    remote_path: String,
    transfer_id: Option<String>,
) -> Result<FileTransferResult, String> {
    info!(
        "[Transfer] Upload directory: server_id={}, local={}, remote={}, transfer_id={:?}",
        id, local_path, remote_path, transfer_id
    );

    let local_path_obj = Path::new(&local_path);
    if !local_path_obj.exists() {
        return Err("Local path does not exist".to_string());
    }
    if !local_path_obj.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let remote_path = remote_path.trim().to_string();
    if remote_path.is_empty() {
        return Err("Remote path is required".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;
    let local_path_for_result = local_path.clone();
    let remote_path_for_result = remote_path.clone();
    let transfer_id_for_result = transfer_id.clone();

    // Emit preparing
    if let Some(tid) = transfer_id.as_deref() {
        emit_file_transfer_progress(
            Some(&window),
            Some(tid),
            FileTransferProgressEvent {
                transfer_id: tid.to_string(),
                direction: "upload".to_string(),
                local_path: local_path.clone(),
                remote_path: remote_path.clone(),
                status: "preparing".to_string(),
                progress_percent: 0,
                transferred_bytes: Some(0),
                total_bytes: None,
                bytes_per_second: None,
                eta_seconds: None,
                message: Some("准备上传目录".to_string()),
            },
        );
    }

    tauri::async_runtime::spawn_blocking(move || -> Result<FileTransferResult, String> {
        let rt = create_async_runtime();
        rt.block_on(async {
            let sftp = ssh_client::create_sftp_session(&connection).await?;

            // Collect all files and directories
            let base_dir_name = Path::new(&local_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let remote_base = join_remote_path(&remote_path, &base_dir_name);

            // Create the base remote directory
            let _ = sftp.create_dir(&remote_base).await;

            // Walk the local directory tree
            let mut dirs_to_create: Vec<String> = Vec::new();
            let mut files_to_upload: Vec<(String, String)> = Vec::new(); // (local, remote)

            fn collect_entries(
                local_dir: &Path,
                remote_dir: &str,
                dirs: &mut Vec<String>,
                files: &mut Vec<(String, String)>,
            ) -> Result<(), String> {
                let read_dir = fs::read_dir(local_dir)
                    .map_err(|e| format!("Failed to read local dir: {}", e))?;

                for entry in read_dir {
                    let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    let local_entry_path = entry.path();
                    let remote_entry_path = format!("{}/{}", remote_dir, file_name);

                    if local_entry_path.is_dir() {
                        dirs.push(remote_entry_path.clone());
                        collect_entries(&local_entry_path, &remote_entry_path, dirs, files)?;
                    } else {
                        files.push((local_entry_path.to_string_lossy().to_string(), remote_entry_path));
                    }
                }
                Ok(())
            }

            collect_entries(
                Path::new(&local_path),
                &remote_base,
                &mut dirs_to_create,
                &mut files_to_upload,
            )?;

            // Create all remote directories
            for dir in &dirs_to_create {
                if let Err(e) = sftp.create_dir(dir).await {
                    warn!("[Transfer] Failed to create remote dir '{}': {}", dir, e);
                }
            }

            // Upload all files
            let total_files = files_to_upload.len();
            let mut uploaded_files = 0u64;

            for (local_file, remote_file) in &files_to_upload {
                let mut local_fh = fs::File::open(local_file)
                    .map_err(|e| format!("Failed to open '{}': {}", local_file, e))?;

                let mut remote_fh = sftp
                    .open_with_flags(
                        remote_file,
                        russh_sftp::protocol::OpenFlags::CREATE
                            | russh_sftp::protocol::OpenFlags::TRUNCATE
                            | russh_sftp::protocol::OpenFlags::WRITE
                            | russh_sftp::protocol::OpenFlags::READ,
                    )
                    .await
                    .map_err(|e| format!("Failed to open remote '{}': {}", remote_file, e))?;

                let chunk_size = 256 * 1024;
                let mut buffer = vec![0u8; chunk_size];
                loop {
                    let bytes_read = local_fh
                        .read(&mut buffer)
                        .map_err(|e| format!("Failed to read '{}': {}", local_file, e))?;
                    if bytes_read == 0 {
                        break;
                    }
                    remote_fh
                        .write_all(&buffer[..bytes_read])
                        .await
                        .map_err(|e| format!("Failed to write '{}': {}", remote_file, e))?;
                }

                remote_fh.flush().await.ok();
                remote_fh.shutdown().await.ok();

                uploaded_files += 1;
                let percent = if total_files > 0 {
                    ((uploaded_files as f64 / total_files as f64) * 100.0) as u8
                } else {
                    100
                };

                emit_file_transfer_progress(
                    Some(&window),
                    transfer_id.as_deref(),
                    FileTransferProgressEvent {
                        transfer_id: transfer_id.clone().unwrap_or_default(),
                        direction: "upload".to_string(),
                        local_path: local_path.clone(),
                        remote_path: remote_path.clone(),
                        status: "progress".to_string(),
                        progress_percent: percent,
                        transferred_bytes: Some(uploaded_files),
                        total_bytes: Some(total_files as u64),
                        bytes_per_second: None,
                        eta_seconds: None,
                        message: Some(format!(
                            "正在上传 {}/{} ({})",
                            uploaded_files, total_files, local_file
                        )),
                    },
                );
            }

            let _ = sftp.close().await;
            Ok::<(), String>(())
        })?;

        // Emit completed
        if let Some(tid) = transfer_id_for_result.as_deref() {
            emit_file_transfer_progress(
                Some(&window),
                Some(tid),
                FileTransferProgressEvent {
                    transfer_id: tid.to_string(),
                    direction: "upload".to_string(),
                    local_path: local_path_for_result.clone(),
                    remote_path: remote_path_for_result.clone(),
                    status: "completed".to_string(),
                    progress_percent: 100,
                    transferred_bytes: None,
                    total_bytes: None,
                    bytes_per_second: None,
                    eta_seconds: Some(0),
                    message: Some(format!("已上传目录到 {}", remote_path_for_result)),
                },
            );
        }

        Ok(FileTransferResult {
            direction: "upload".to_string(),
            local_path: local_path_for_result,
            remote_path: remote_path_for_result.clone(),
            message: format!("Uploaded directory to {}", remote_path_for_result),
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

// ============================================================
// download_file_from_server
// ============================================================

#[tauri::command]
pub async fn download_file_from_server(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    remote_path: String,
    local_path: String,
    transfer_id: Option<String>,
) -> Result<FileTransferResult, String> {
    info!(
        "[Transfer] Download file: server_id={}, remote={}, local={}, transfer_id={:?}",
        id, remote_path, local_path, transfer_id
    );

    let remote_path = remote_path.trim().to_string();
    if remote_path.is_empty() {
        return Err("Remote path is required".to_string());
    }

    let local_path = local_path.trim().to_string();
    if local_path.is_empty() {
        return Err("Local path is required".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;
    let local_path_for_result = local_path.clone();
    let remote_path_for_result = remote_path.clone();
    let transfer_id_for_result = transfer_id.clone();

    // Emit preparing
    if let Some(tid) = transfer_id.as_deref() {
        emit_file_transfer_progress(
            Some(&window),
            Some(tid),
            FileTransferProgressEvent {
                transfer_id: tid.to_string(),
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
        let rt = create_async_runtime();
        let result = rt.block_on(async {
            let sftp = ssh_client::create_sftp_session(&connection).await?;

            // Get file size for progress
            let metadata = sftp
                .metadata(&remote_path)
                .await
                .map_err(|e| format!("Failed to stat remote file '{}': {}", remote_path, e))?;
            let total_bytes = Some(metadata.size.unwrap_or(0));

            let mut remote_file = sftp
                .open(&remote_path)
                .await
                .map_err(|e| format!("Failed to open remote file '{}': {}", remote_path, e))?;

            // Ensure parent directory exists
            if let Some(parent) = Path::new(&local_path).parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create local directory: {}", e))?;
                }
            }

            let mut local_file = fs::File::create(&local_path)
                .map_err(|e| format!("Failed to create local file '{}': {}", local_path, e))?;

            let total = total_bytes.unwrap_or(0);
            let mut transferred: u64 = 0;
            let start_time = Instant::now();
            let chunk_size = 256 * 1024;
            let mut buffer = vec![0u8; chunk_size];
            let mut last_percent: u8 = 0;

            loop {
                let bytes_read = remote_file
                    .read(&mut buffer)
                    .await
                    .map_err(|e| format!("Failed to read remote file: {}", e))?;

                if bytes_read == 0 {
                    break;
                }

                local_file
                    .write_all(&buffer[..bytes_read])
                    .map_err(|e| format!("Failed to write local file: {}", e))?;

                transferred += bytes_read as u64;

                let percent = if total > 0 {
                    ((transferred as f64 / total as f64) * 100.0) as u8
                } else {
                    0
                };
                if percent != last_percent {
                    last_percent = percent;
                    let elapsed = start_time.elapsed().as_secs_f64();
                    let bps = if elapsed > 0.0 {
                        Some(transferred as f64 / elapsed)
                    } else {
                        None
                    };
                    let eta = if elapsed > 0.0 && transferred > 0 && total > transferred {
                        Some(((total - transferred) as f64 / (transferred as f64 / elapsed)) as u64)
                    } else {
                        None
                    };

                    emit_file_transfer_progress(
                        Some(&window),
                        transfer_id.as_deref(),
                        FileTransferProgressEvent {
                            transfer_id: transfer_id.clone().unwrap_or_default(),
                            direction: "download".to_string(),
                            local_path: local_path.clone(),
                            remote_path: remote_path.clone(),
                            status: "progress".to_string(),
                            progress_percent: percent,
                            transferred_bytes: Some(transferred),
                            total_bytes,
                            bytes_per_second: bps,
                            eta_seconds: eta,
                            message: None,
                        },
                    );
                }
            }

            local_file
                .flush()
                .map_err(|e| format!("Failed to flush local file: {}", e))?;

            remote_file.shutdown().await.ok();
            let _ = sftp.close().await;
            Ok::<(), String>(())
        });

        result?;

        // Emit completed
        if let Some(tid) = transfer_id_for_result.as_deref() {
            emit_file_transfer_progress(
                Some(&window),
                Some(tid),
                FileTransferProgressEvent {
                    transfer_id: tid.to_string(),
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

// ============================================================
// delete_remote_path
// ============================================================

#[tauri::command]
pub async fn delete_remote_path(
    state: State<'_, AppState>,
    id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    info!("[Transfer] Delete path: server_id={}, path={}, is_dir={}", id, path, is_dir);

    let path = path.trim().to_string();
    if path.is_empty() || path == "/" {
        return Err("无效的远程路径".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;

    tauri::async_runtime::spawn_blocking(move || {
        let rt = create_async_runtime();
        rt.block_on(async {
            let sftp = ssh_client::create_sftp_session(&connection).await?;

            if is_dir {
                sftp.remove_dir(&path)
                    .await
                    .map_err(|e| format!("Failed to delete directory '{}': {}", path, e))?;
            } else {
                sftp.remove_file(&path)
                    .await
                    .map_err(|e| format!("Failed to delete file '{}': {}", path, e))?;
            }

            let _ = sftp.close().await;
            Ok(())
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

// ============================================================
// rename_remote_path
// ============================================================

#[tauri::command]
pub async fn rename_remote_path(
    state: State<'_, AppState>,
    id: String,
    path: String,
    new_path: String,
) -> Result<(), String> {
    info!("[Transfer] Rename: server_id={}, {} -> {}", id, path, new_path);

    let path = path.trim().to_string();
    let new_path = new_path.trim().to_string();
    if path.is_empty() || new_path.is_empty() {
        return Err("无效的远程路径".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;

    tauri::async_runtime::spawn_blocking(move || {
        let rt = create_async_runtime();
        rt.block_on(async {
            let sftp = ssh_client::create_sftp_session(&connection).await?;

            sftp.rename(&path, &new_path)
                .await
                .map_err(|e| format!("Failed to rename '{}' -> '{}': {}", path, new_path, e))?;

            let _ = sftp.close().await;
            Ok(())
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

// ============================================================
// create_remote_directory
// ============================================================

#[tauri::command]
pub async fn create_remote_directory(
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> Result<(), String> {
    info!("[Transfer] Create directory: server_id={}, path={}", id, path);

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("无效的远程路径".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;

    tauri::async_runtime::spawn_blocking(move || {
        let rt = create_async_runtime();
        rt.block_on(async {
            let sftp = ssh_client::create_sftp_session(&connection).await?;

            sftp.create_dir(&path)
                .await
                .map_err(|e| format!("Failed to create directory '{}': {}", path, e))?;

            let _ = sftp.close().await;
            Ok(())
        })
    })
    .await
    .map_err(|err| err.to_string())?
}
