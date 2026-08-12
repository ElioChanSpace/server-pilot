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
use tauri::{AppHandle, Emitter, State};

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
        Self {
            tunnels: Mutex::new(HashMap::new()),
        }
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
) -> Result<(String, String, u16, Option<String>, Option<String>, Option<String>), String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    let server = data
        .servers
        .iter()
        .find(|s| s.id == server_id)
        .ok_or("Server not found")?;

    if !matches!(server.os_type, OsType::Linux) {
        return Err("仅支持 Linux 服务器".to_string());
    }

    let password = credential_store::get_password(server_id)?
        .filter(|v| !v.is_empty());
    let _key_passphrase = credential_store::get_key_passphrase(server_id)?
        .filter(|v| !v.is_empty());

    Ok((
        server.username.clone(),
        server.host.clone(),
        server.port,
        password,
        server.key_path.clone(),
        server.proxy_jump.clone(),
    ))
}

#[tauri::command]
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
        // Create a temporary script for ssh-askpass
        let askpass_script = format!(
            "#!/bin/sh\necho '{}'",
            pwd.replace("'", "'\\''")
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let path = std::env::temp_dir().join(format!("server-pilot-askpass-{}", tunnel_id));
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

    let child = cmd
        .spawn()
        .map_err(|e| format!("启动 SSH 隧道失败: {}", e))?;

    let pid = child.id();

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
        .insert(tunnel_id.clone(), TunnelEntry { child, askpass_path });

    info!("SSH tunnel created: {} (PID: {})", tunnel_id, pid);

    // Emit event
    let _ = app.emit("ssh-tunnel-changed", &tunnel);

    Ok(tunnel)
}

#[tauri::command]
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

#[tauri::command]
pub fn list_ssh_tunnels(
    tunnel_manager: State<'_, TunnelManager>,
) -> Result<Vec<String>, String> {
    let tunnels = tunnel_manager.tunnels.lock().map_err(|e| e.to_string())?;
    Ok(tunnels.keys().cloned().collect())
}

#[tauri::command]
pub fn check_port_available(port: u16) -> Result<bool, String> {
    use std::net::TcpListener;

    match TcpListener::bind(format!("127.0.0.1:{}", port)) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}
