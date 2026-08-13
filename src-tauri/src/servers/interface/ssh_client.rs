use async_trait::async_trait;
use log::{error, info, warn};
use russh::client::{self, Handler};
use russh::keys::key;
use russh_sftp::client::SftpSession;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;

use super::file_transfer::TransferConnection;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const AUTH_TIMEOUT: Duration = Duration::from_secs(15);

pub(crate) struct SshClientHandler;

#[async_trait]
impl Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// Create an authenticated russh SSH session.
async fn create_ssh_session(
    conn: &TransferConnection,
) -> Result<client::Handle<SshClientHandler>, String> {
    let mut config = client::Config::default();
    config.inactivity_timeout = Some(Duration::from_secs(30));
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

    // SSH handshake
    let mut session = client::connect_stream(config, socket, SshClientHandler)
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
            let passphrase = conn
                .key_passphrase
                .as_deref()
                .filter(|s| !s.is_empty());

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
            info!("[SshClient] Authenticating with password for {}", conn.username);
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
pub(crate) async fn create_sftp_session(
    conn: &TransferConnection,
) -> Result<SftpSession, String> {
    info!(
        "[SshClient] Creating SFTP session for {}@{}",
        conn.username, conn.host
    );
    let session = create_ssh_session(conn).await?;

    info!("[SshClient] Opening channel...");
    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| {
            error!("[SshClient] Failed to open channel: {}", e);
            format!("打开通道失败: {}", e)
        })?;

    info!("[SshClient] Requesting SFTP subsystem...");
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| {
            error!("[SshClient] Failed to request SFTP subsystem: {}", e);
            format!("请求 SFTP 子系统失败: {}", e)
        })?;

    info!("[SshClient] Initializing SFTP session...");
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| {
            error!("[SshClient] Failed to init SFTP session: {}", e);
            format!("初始化 SFTP 会话失败: {}", e)
        })?;

    info!("[SshClient] SFTP session established successfully");
    Ok(sftp)
}
