use async_trait::async_trait;
use log::info;
use russh::client::{self, Handler};
use russh::keys::key;
use russh_sftp::client::SftpSession;
use std::sync::Arc;

use super::file_transfer::TransferConnection;

struct SshClientHandler;

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
    let config = Arc::new(client::Config::default());
    let addr = (conn.host.as_str(), conn.port);

    info!(
        "[SshClient] Connecting to {}@{}:{}",
        conn.username, conn.host, conn.port
    );

    let mut session = client::connect(config, addr, SshClientHandler)
        .await
        .map_err(|e| format!("SSH connection failed: {}", e))?;

    // Authenticate: try key first, then password
    if let Some(key_path) = conn.key_path.as_deref() {
        if !key_path.is_empty() {
            info!("[SshClient] Authenticating with key: {}", key_path);
            let passphrase = conn
                .key_passphrase
                .as_deref()
                .filter(|s| !s.is_empty());

            let key_pair = russh::keys::load_secret_key(key_path, passphrase)
                .map_err(|e| format!("Failed to load SSH key '{}': {}", key_path, e))?;

            let auth_result = session
                .authenticate_publickey(&conn.username, Arc::new(key_pair))
                .await
                .map_err(|e| format!("Key authentication error: {}", e))?;

            if auth_result {
                info!("[SshClient] Key authentication successful");
                return Ok(session);
            }
            info!("[SshClient] Key authentication failed, trying password");
        }
    }

    if let Some(password) = conn.password.as_deref() {
        if !password.is_empty() {
            info!("[SshClient] Authenticating with password");
            let auth_result = session
                .authenticate_password(&conn.username, password)
                .await
                .map_err(|e| format!("Password authentication error: {}", e))?;

            if auth_result {
                info!("[SshClient] Password authentication successful");
                return Ok(session);
            }
            return Err("Password authentication failed".to_string());
        }
    }

    Err("No valid authentication method available".to_string())
}

/// Create an SFTP session from an SSH connection.
pub(crate) async fn create_sftp_session(
    conn: &TransferConnection,
) -> Result<SftpSession, String> {
    let session = create_ssh_session(conn).await?;

    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;

    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("Failed to request SFTP subsystem: {}", e))?;

    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("Failed to create SFTP session: {}", e))?;

    info!("[SshClient] SFTP session established");
    Ok(sftp)
}

