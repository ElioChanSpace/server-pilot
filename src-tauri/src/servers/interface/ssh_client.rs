use async_trait::async_trait;
use log::{error, info, warn};
use russh::client::{self, Handler};
use russh::keys::key;
use russh_sftp::client::SftpSession;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::net::TcpStream;

use super::file_transfer::TransferConnection;
use super::util::SSH_COMMAND_TIMEOUT;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const AUTH_TIMEOUT: Duration = Duration::from_secs(15);
/// SSH connections are kept alive between commands for this long so that
/// bursts of commands (monitoring polls, port enrichment) reuse one
/// authenticated session instead of reconnecting per command.
const POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const POOL_MAX_AGE: Duration = Duration::from_secs(60 * 10);
/// Upper bound for command output kept in memory. Output beyond this limit is
/// discarded and a truncation marker is appended.
const EXEC_OUTPUT_LIMIT: usize = 4 * 1024 * 1024;

pub(crate) struct SshClientHandler {
    pub(crate) host: String,
    pub(crate) port: u16,
}

#[async_trait]
impl Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        match russh::keys::check_known_hosts(&self.host, self.port, server_public_key) {
            Ok(true) => Ok(true),
            Err(russh::keys::Error::KeyChanged { line }) => {
                error!(
                    "[SshClient] REFUSING connection to {}:{}: host key changed (known_hosts line {}) — possible MITM attack",
                    self.host, self.port, line
                );
                Ok(false)
            }
            Err(err) => {
                warn!(
                    "[SshClient] known_hosts check failed for {}:{}: {} — accepting key",
                    self.host, self.port, err
                );
                Ok(true)
            }
            Ok(false) => {
                // Trust on first use: record the key so future mismatches are detected.
                info!(
                    "[SshClient] Unknown host key for {}:{}, recording to known_hosts (TOFU)",
                    self.host, self.port
                );
                if let Err(err) = russh::keys::learn_known_hosts(&self.host, self.port, server_public_key)
                {
                    warn!(
                        "[SshClient] Failed to record host key for {}:{}: {}",
                        self.host, self.port, err
                    );
                }
                Ok(true)
            }
        }
    }
}

/// Create an authenticated russh SSH session.
async fn create_ssh_session(
    conn: &TransferConnection,
) -> Result<client::Handle<SshClientHandler>, String> {
    let mut config = client::Config::default();
    config.inactivity_timeout = Some(POOL_MAX_AGE);
    let config = Arc::new(config);
    let addr = (conn.host.as_str(), conn.port);

    info!(
        "[SshClient] Connecting to {}@{}:{} (timeout={:?})",
        conn.username, conn.host, conn.port, CONNECT_TIMEOUT
    );

    // TCP connect with explicit timeout
    let socket = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(addr))
        .await
        .map_err(|_| {
            error!(
                "[SshClient] TCP connect timed out after {:?} to {}:{}",
                CONNECT_TIMEOUT, conn.host, conn.port
            );
            format!(
                "TCP 连接超时 ({:?})，无法连接到 {}:{}，请检查网络和防火墙设置",
                CONNECT_TIMEOUT, conn.host, conn.port
            )
        })?
        .map_err(|e| {
            error!(
                "[SshClient] TCP connect failed to {}:{}: {}",
                conn.host, conn.port, e
            );
            format!("TCP 连接失败 {}:{}: {}", conn.host, conn.port, e)
        })?;

    info!("[SshClient] TCP connected, starting SSH handshake...");

    let handler = SshClientHandler {
        host: conn.host.clone(),
        port: conn.port,
    };

    // SSH handshake
    let mut session = client::connect_stream(config, socket, handler)
        .await
        .map_err(|e| {
            error!(
                "[SshClient] SSH handshake failed to {}:{}: {}",
                conn.host, conn.port, e
            );
            format!("SSH 握手失败 {}:{}: {}", conn.host, conn.port, e)
        })?;

    info!("[SshClient] SSH handshake complete, authenticating...");

    // Authenticate: try key first, then password
    if let Some(key_path) = conn.key_path.as_deref() {
        if !key_path.is_empty() {
            info!("[SshClient] Authenticating with key: {}", key_path);
            let passphrase = conn.key_passphrase.as_deref().filter(|s| !s.is_empty());

            match russh::keys::load_secret_key(key_path, passphrase) {
                Ok(key_pair) => {
                    let auth_result = tokio::time::timeout(
                        AUTH_TIMEOUT,
                        session.authenticate_publickey(&conn.username, Arc::new(key_pair)),
                    )
                    .await
                    .map_err(|_| {
                        error!("[SshClient] Key auth timed out for {}", conn.username);
                        format!("密钥认证超时 ({:?})", AUTH_TIMEOUT)
                    })?
                    .map_err(|e| {
                        error!("[SshClient] Key auth error: {}", e);
                        format!("密钥认证错误: {}", e)
                    })?;

                    if auth_result {
                        info!("[SshClient] Key authentication successful");
                        return Ok(session);
                    }
                    info!("[SshClient] Key authentication failed, trying password");
                }
                Err(e) => {
                    warn!(
                        "[SshClient] Failed to load key '{}': {}, falling back to password",
                        key_path, e
                    );
                }
            }
        }
    }

    // Password authentication
    if let Some(password) = conn.password.as_deref() {
        if !password.is_empty() {
            info!(
                "[SshClient] Authenticating with password for {}",
                conn.username
            );
            let auth_result = tokio::time::timeout(
                AUTH_TIMEOUT,
                session.authenticate_password(&conn.username, password),
            )
            .await
            .map_err(|_| {
                error!("[SshClient] Password auth timed out for {}", conn.username);
                format!("密码认证超时 ({:?})", AUTH_TIMEOUT)
            })?
            .map_err(|e| {
                error!("[SshClient] Password auth error: {}", e);
                format!("密码认证错误: {}", e)
            })?;

            if auth_result {
                info!("[SshClient] Password authentication successful");
                return Ok(session);
            }
            error!(
                "[SshClient] Password authentication rejected for {}",
                conn.username
            );
            return Err("密码认证失败，请检查用户名和密码".to_string());
        }
    }

    error!("[SshClient] No valid auth method for {}", conn.username);
    Err("没有可用的认证方式，请配置密码或密钥".to_string())
}

/// Create an SFTP session from an SSH connection.
pub(crate) async fn create_sftp_session(conn: &TransferConnection) -> Result<SftpSession, String> {
    info!(
        "[SshClient] Creating SFTP session for {}@{}",
        conn.username, conn.host
    );
    let session = create_ssh_session(conn).await?;

    info!("[SshClient] Opening channel...");
    let channel = session.channel_open_session().await.map_err(|e| {
        error!("[SshClient] Failed to open channel: {}", e);
        format!("打开通道失败: {}", e)
    })?;

    info!("[SshClient] Requesting SFTP subsystem...");
    channel.request_subsystem(true, "sftp").await.map_err(|e| {
        error!("[SshClient] Failed to request SFTP subsystem: {}", e);
        format!("请求 SFTP 子系统失败: {}", e)
    })?;

    info!("[SshClient] Initializing SFTP session...");
    let sftp = SftpSession::new(channel.into_stream()).await.map_err(|e| {
        error!("[SshClient] Failed to init SFTP session: {}", e);
        format!("初始化 SFTP 会话失败: {}", e)
    })?;

    info!("[SshClient] SFTP session established successfully");
    Ok(sftp)
}

// ---- Shared runtime & connection pool -------------------------------------

fn ssh_runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("ssh-client")
            .enable_all()
            .build()
            .expect("failed to build SSH client runtime")
    })
}

/// Run a future on the shared SSH runtime from a blocking context.
pub(crate) fn block_on_shared<F: std::future::Future>(fut: F) -> F::Output {
    ssh_runtime().block_on(fut)
}

struct PooledConnection {
    handle: Arc<client::Handle<SshClientHandler>>,
    created_at: Instant,
    last_used: Instant,
}

fn connection_pool() -> &'static Mutex<HashMap<(String, u16, String, String), PooledConnection>> {
    static POOL: OnceLock<Mutex<HashMap<(String, u16, String, String), PooledConnection>>> =
        OnceLock::new();
    POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Pool key. The password itself is never stored in the key — only whether one
/// was configured — so secrets do not leak through the map.
fn pool_key(conn: &TransferConnection) -> (String, u16, String, String) {
    let auth_id = format!(
        "key={}|pw={}",
        conn.key_path.as_deref().unwrap_or(""),
        if conn.password.as_deref().is_some_and(|p| !p.is_empty()) {
            1
        } else {
            0
        }
    );
    (
        conn.host.clone(),
        conn.port,
        conn.username.clone(),
        auth_id,
    )
}

fn evict_pool_entries(pool: &mut HashMap<(String, u16, String, String), PooledConnection>) {
    pool.retain(|_, entry| {
        let fresh = entry.last_used.elapsed() < POOL_IDLE_TIMEOUT
            && entry.created_at.elapsed() < POOL_MAX_AGE;
        let alive = !entry.handle.is_closed();
        if !(fresh && alive) {
            info!("[SshClient] Evicting pooled SSH connection (stale or closed)");
        }
        fresh && alive
    });
}

async fn acquire_shared_session(
    conn: &TransferConnection,
) -> Result<Arc<client::Handle<SshClientHandler>>, String> {
    let key = pool_key(conn);
    {
        let mut pool = connection_pool().lock().map_err(|e| e.to_string())?;
        evict_pool_entries(&mut pool);
        if let Some(entry) = pool.get_mut(&key) {
            if !entry.handle.is_closed() {
                entry.last_used = Instant::now();
                return Ok(entry.handle.clone());
            }
        }
    }

    // Drop the lock while connecting (connect can take seconds).
    let handle = Arc::new(create_ssh_session(conn).await?);
    let mut pool = connection_pool().lock().map_err(|e| e.to_string())?;
    evict_pool_entries(&mut pool);
    pool.insert(
        key,
        PooledConnection {
            handle: handle.clone(),
            created_at: Instant::now(),
            last_used: Instant::now(),
        },
    );
    Ok(handle)
}

/// Remove and close a pooled connection (e.g. after a timed-out command so a
/// possibly half-dead channel/connection is not reused).
fn evict_shared_session(conn: &TransferConnection) {
    if let Ok(mut pool) = connection_pool().lock() {
        pool.remove(&pool_key(conn));
    }
}

/// Run a command via SSH exec and return stdout.
///
/// Uses (and reuses) a pooled SSH connection, enforces a total timeout and
/// caps the amount of buffered output.
pub(crate) async fn run_ssh_exec(
    conn: &TransferConnection,
    command: &str,
    action_label: &str,
) -> Result<String, String> {
    run_ssh_exec_with_stdin(conn, command, action_label, None).await
}

/// Same as [`run_ssh_exec`] but optionally writes `stdin` to the remote
/// process (used e.g. to feed `sudo -S` a password — sent over the encrypted
/// channel, never embedded in the command line).
pub(crate) async fn run_ssh_exec_with_stdin(
    conn: &TransferConnection,
    command: &str,
    action_label: &str,
    stdin: Option<&str>,
) -> Result<String, String> {
    let timeout = SSH_COMMAND_TIMEOUT;
    info!(
        "[SshClient] Executing command: action={:?}, timeout={:?}, cmd={}",
        action_label, timeout, command
    );

    let exec_future = run_ssh_exec_on_pooled(conn, command, action_label, stdin);
    match tokio::time::timeout(timeout, exec_future).await {
        Ok(result) => result,
        Err(_) => {
            error!(
                "[SshClient] Command timed out after {:?} for action: {}",
                timeout, action_label
            );
            evict_shared_session(conn);
            Err(format!(
                "Timed out after {:?} while trying to {}",
                timeout, action_label
            ))
        }
    }
}

/// Whether an error output looks like a privilege problem (not a real
/// command failure) so a sudo fallback is worth trying.
fn is_permission_error(output: &str) -> bool {
    let lower = output.to_lowercase();
    lower.contains("permission denied")
        || lower.contains("需要密码")
        || lower.contains("a password is required")
        || lower.contains("authentication is required")
        || lower.contains("access denied")
        || lower.contains("must be root")
        || lower.contains("need to be root")
        || lower.contains("需要 root")
        || lower.contains("not allowed to")
        || lower.contains("insufficient privileges")
        || lower.contains("operation not permitted")
}

/// Run a command that may need root privileges, with graceful fallback:
/// 1. run directly (works for docker-group users etc. — no sudo involved);
/// 2. retry with `sudo -n` (passwordless sudo);
/// 3. retry with `sudo -S` feeding the saved password via stdin.
///
/// This matches how read-only commands (`docker ps`) already behave, so
/// operations work whenever listing works.
pub(crate) async fn run_ssh_exec_privileged(
    conn: &TransferConnection,
    command: &str,
    action_label: &str,
) -> Result<String, String> {
    // 1. direct
    match run_ssh_exec(conn, command, action_label).await {
        Ok(output) => return Ok(output),
        Err(err) => {
            if !is_permission_error(&err) {
                return Err(err);
            }
            info!(
                "[SshClient] Direct run lacks privileges for {}, retrying with sudo: {}",
                action_label, err
            );
        }
    }

    // 2. sudo -n
    let sudo_n_cmd = format!("sudo -n {}", command);
    match run_ssh_exec(conn, &sudo_n_cmd, action_label).await {
        Ok(output) => return Ok(output),
        Err(err) => {
            if !is_permission_error(&err) {
                return Err(err);
            }
            info!(
                "[SshClient] Passwordless sudo failed for {}, trying saved password",
                action_label
            );
        }
    }

    // 3. sudo -S with the saved password on stdin
    if let Some(password) = conn.password.as_deref().filter(|p| !p.is_empty()) {
        let sudo_s_cmd = format!("sudo -S -p '' {}", command);
        let mut stdin = String::from(password);
        stdin.push('\n');
        return run_ssh_exec_with_stdin(conn, &sudo_s_cmd, action_label, Some(&stdin)).await;
    }

    Err(format!(
        "{} 需要 root 权限：请将用户加入对应组（如 sudo usermod -aG docker $USER 并重新登录），\
         或配置免密 sudo（如 echo \"$USER ALL=(ALL) NOPASSWD: /usr/bin/docker\" | sudo tee /etc/sudoers.d/docker）后重试",
        action_label
    ))
}

async fn run_ssh_exec_on_pooled(
    conn: &TransferConnection,
    command: &str,
    action_label: &str,
    stdin: Option<&str>,
) -> Result<String, String> {
    let session = acquire_shared_session(conn).await?;

    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel for {}: {}", action_label, e))?;

    channel
        .exec(true, command)
        .await
        .map_err(|e| format!("Failed to execute command for {}: {}", action_label, e))?;

    if let Some(stdin_data) = stdin {
        let _ = channel.data(stdin_data.as_bytes()).await;
        let _ = channel.eof().await;
    }

    let mut output: Vec<u8> = Vec::new();
    let mut truncated = false;
    let mut exit_code: Option<u32> = None;

    while let Some(msg) = channel.wait().await {
        match msg {
            russh::ChannelMsg::Data { data } | russh::ChannelMsg::ExtendedData { data, .. } => {
                if output.len() < EXEC_OUTPUT_LIMIT {
                    let remaining = EXEC_OUTPUT_LIMIT - output.len();
                    let take = remaining.min(data.len());
                    output.extend_from_slice(&data[..take]);
                    if take < data.len() {
                        truncated = true;
                    }
                } else {
                    truncated = true;
                }
            }
            russh::ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
            _ => {}
        }
    }

    let mut output_str = String::from_utf8_lossy(&output).to_string();
    if truncated {
        output_str.push_str("\n...[output truncated]...");
    }
    info!(
        "[SshClient] Command completed: action={:?}, exit_code={:?}, output={} bytes",
        action_label,
        exit_code,
        output_str.len()
    );

    match exit_code {
        Some(0) => Ok(output_str),
        Some(code) => Err(format!(
            "Command exited with status {} during {}: {}",
            code, action_label, output_str
        )),
        None => Err(format!(
            "Connection closed before command finished during {}: {}",
            action_label, output_str
        )),
    }
}

/// Synchronous wrapper for run_ssh_exec, for use in spawn_blocking contexts.
pub(crate) fn run_ssh_exec_blocking(
    conn: &TransferConnection,
    command: &str,
    action_label: &str,
) -> Result<String, String> {
    ssh_runtime().block_on(run_ssh_exec(conn, command, action_label))
}

/// Synchronous wrapper for [`run_ssh_exec_privileged`].
pub(crate) fn run_ssh_exec_privileged_blocking(
    conn: &TransferConnection,
    command: &str,
    action_label: &str,
) -> Result<String, String> {
    ssh_runtime().block_on(run_ssh_exec_privileged(conn, command, action_label))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_permission_errors_for_sudo_fallback() {
        assert!(is_permission_error(
            "Command exited with status 1 during docker stop container: sudo: 需要密码"
        ));
        assert!(is_permission_error(
            "permission denied while trying to connect to the Docker daemon socket"
        ));
        assert!(is_permission_error("sudo: a password is required"));
        assert!(is_permission_error("Failed to restart nginx: Access denied"));
        assert!(!is_permission_error(
            "Command exited with status 1 during docker stop container: Error: No such container: x"
        ));
    }
}
