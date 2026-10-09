use crate::servers::application::AppState;
use crate::servers::domain::OsType;
use crate::servers::infrastructure::credential_store;
use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnel {
    pub id: String,
    pub server_id: String,
    pub tunnel_type: String, // "local" or "remote"
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub status: String, // "active", "inactive", "error"
    pub pid: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTunnelRequest {
    pub server_id: String,
    pub tunnel_type: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

struct TunnelEntry {
    child: Child,
    askpass_path: Option<PathBuf>,
}

pub struct TunnelManager {
    tunnels: Mutex<HashMap<String, TunnelEntry>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        // Remove stale askpass scripts that a previous crash may have left behind.
        if let Ok(dir) = std::env::temp_dir().read_dir() {
            for entry in dir.flatten() {
                if entry.file_name().to_string_lossy().starts_with("server-pilot-askpass-") {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
        Self {
            tunnels: Mutex::new(HashMap::new()),
        }
    }

    /// Reap tunnels whose ssh process has exited so they don't linger as
    /// zombies with a stale "active" status.
    pub fn reap_dead_tunnels(&self) -> Vec<(String, u32)> {
        let mut dead = Vec::new();
        if let Ok(mut tunnels) = self.tunnels.lock() {
            let finished: Vec<String> = tunnels
                .iter_mut()
                .filter_map(|(id, entry)| match entry.child.try_wait() {
                    Ok(Some(status)) => {
                        dead.push((id.clone(), status.code().unwrap_or(-1) as u32));
                        Some(id.clone())
                    }
                    _ => None,
                })
                .collect();
            for id in finished {
                if let Some(mut entry) = tunnels.remove(&id) {
                    if let Some(path) = entry.askpass_path.take() {
                        let _ = fs::remove_file(path);
                    }
                }
            }
        }
        dead
    }
}

impl Drop for TunnelManager {
    fn drop(&mut self) {
        if let Ok(mut tunnels) = self.tunnels.lock() {
            for (_id, mut entry) in tunnels.drain() {
                let _ = entry.child.kill();
                let _ = entry.child.wait();
                if let Some(path) = entry.askpass_path {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }
}

fn get_server_connection_info(
    state: &State<'_, AppState>,
    server_id: &str,
) -> Result<
    (
        String,
        String,
        u16,
        Option<String>,
        Option<String>,
        Option<String>,
    ),
    String,
> {
    // Clone what we need and release the global lock before keychain IPC.
    let (username, host, port, key_path, proxy_jump) = {
        let data = state.data.lock().map_err(|e| e.to_string())?;
        let server = data
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .ok_or("Server not found")?;

        if !matches!(server.os_type, OsType::Linux) {
            return Err("仅支持 Linux 服务器".to_string());
        }

        (
            server.username.clone(),
            server.host.clone(),
            server.port,
            server.key_path.clone(),
            server.proxy_jump.clone(),
        )
    };

    let password = credential_store::get_password(server_id)?.filter(|v| !v.is_empty());
    let _key_passphrase =
        credential_store::get_key_passphrase(server_id)?.filter(|v| !v.is_empty());

    Ok((username, host, port, password, key_path, proxy_jump))
}

/// Remove stale askpass scripts left behind by crashed runs.
pub fn cleanup_stale_askpass_files(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        if let Ok(entries) = dir.read_dir() {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with("askpass-") {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }
    // Legacy location (older versions wrote to the system temp dir).
    if let Ok(entries) = std::env::temp_dir().read_dir() {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with("server-pilot-askpass-") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

#[tauri::command(async)]
pub fn create_ssh_tunnel(
    app: AppHandle,
    state: State<'_, AppState>,
    tunnel_manager: State<'_, TunnelManager>,
    request: CreateTunnelRequest,
) -> Result<SshTunnel, String> {
    let (username, host, port, password, key_path, proxy_jump) =
        get_server_connection_info(&state, &request.server_id)?;

    let tunnel_id = uuid::Uuid::new_v4().to_string();
    let mut askpass_path: Option<PathBuf> = None;

    let mut cmd = Command::new("ssh");

    // Common SSH options
    cmd.arg("-o").arg("StrictHostKeyChecking=accept-new");
    cmd.arg("-o").arg("ExitOnForwardFailure=yes");
    cmd.arg("-N"); // No remote command

    // Port forwarding
    match request.tunnel_type.as_str() {
        "local" => {
            cmd.arg("-L").arg(format!(
                "{}:{}:{}",
                request.local_port, request.remote_host, request.remote_port
            ));
        }
        "remote" => {
            cmd.arg("-R").arg(format!(
                "{}:{}:{}",
                request.local_port, request.remote_host, request.remote_port
            ));
        }
        _ => return Err("无效的隧道类型，支持: local, remote".to_string()),
    }

    // Proxy jump
    if let Some(proxy) = proxy_jump {
        cmd.arg("-J").arg(proxy);
    }

    // Key path
    if let Some(key) = key_path {
        cmd.arg("-i").arg(key);
    }

    // Port and host
    cmd.arg("-p").arg(port.to_string());
    cmd.arg(format!("{}@{}", username, host));

    // Set SSH_ASKPASS for password authentication
    if let Some(pwd) = password {
        // Create a temporary script for ssh-askpass. Keep it inside the app's
        // private data dir and always delete it afterwards (including stale
        // files from crashed runs, see TunnelManager::new).
        let askpass_script = format!("#!/bin/sh\necho '{}'", pwd.replace('\'', "'\\''"));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = dir.join(format!("askpass-{}", tunnel_id));
            std::fs::write(&path, &askpass_script)
                .map_err(|e| format!("Failed to create askpass script: {}", e))?;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| format!("Failed to set askpass permissions: {}", e))?;

            cmd.env("SSH_ASKPASS", &path);
            cmd.env("SSH_ASKPASS_REQUIRE", "force");
            askpass_path = Some(path);
        }
    }

    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 SSH 隧道失败: {}", e))?;

    let pid = child.id();

    // Give ssh a moment to fail fast (auth error, unreachable host, ...) so a
    // dead process is never reported as an active tunnel.
    std::thread::sleep(std::time::Duration::from_millis(400));
    match child.try_wait() {
        Ok(Some(status)) => {
            if let Some(path) = askpass_path.take() {
                let _ = fs::remove_file(path);
            }
            return Err(format!(
                "SSH 隧道启动失败（进程立即退出，status: {}），请检查认证信息和端口配置",
                status
            ));
        }
        Ok(None) => {}
        Err(e) => {
            if let Some(path) = askpass_path.take() {
                let _ = fs::remove_file(path);
            }
            return Err(format!("检查 SSH 隧道进程失败: {}", e));
        }
    }

    let tunnel = SshTunnel {
        id: tunnel_id.clone(),
        server_id: request.server_id,
        tunnel_type: request.tunnel_type,
        local_port: request.local_port,
        remote_host: request.remote_host,
        remote_port: request.remote_port,
        status: "active".to_string(),
        pid: Some(pid),
    };

    tunnel_manager
        .tunnels
        .lock()
        .map_err(|e| e.to_string())?
        .insert(
            tunnel_id.clone(),
            TunnelEntry {
                child,
                askpass_path,
            },
        );

    info!("SSH tunnel created: {} (PID: {})", tunnel_id, pid);

    // Emit event
    let _ = app.emit("ssh-tunnel-changed", &tunnel);

    Ok(tunnel)
}

#[tauri::command(async)]
pub fn close_ssh_tunnel(
    app: AppHandle,
    tunnel_manager: State<'_, TunnelManager>,
    tunnel_id: String,
) -> Result<(), String> {
    let mut tunnels = tunnel_manager.tunnels.lock().map_err(|e| e.to_string())?;

    if let Some(mut entry) = tunnels.remove(&tunnel_id) {
        let _ = entry.child.kill();
        let _ = entry.child.wait();
        if let Some(path) = entry.askpass_path {
            let _ = fs::remove_file(&path);
        }
        info!("SSH tunnel closed: {}", tunnel_id);

        let _ = app.emit(
            "ssh-tunnel-changed",
            serde_json::json!({
                "id": tunnel_id,
                "status": "inactive"
            }),
        );

        Ok(())
    } else {
        Err("隧道不存在或已关闭".to_string())
    }
}

#[tauri::command(async)]
pub fn list_ssh_tunnels(tunnel_manager: State<'_, TunnelManager>) -> Result<Vec<String>, String> {
    tunnel_manager.reap_dead_tunnels();
    let tunnels = tunnel_manager.tunnels.lock().map_err(|e| e.to_string())?;
    Ok(tunnels.keys().cloned().collect())
}

#[tauri::command(async)]
pub fn check_port_available(port: u16) -> Result<bool, String> {
    use std::net::TcpListener;

    match TcpListener::bind(format!("127.0.0.1:{}", port)) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}
