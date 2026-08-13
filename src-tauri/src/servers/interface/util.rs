#![allow(dead_code)]

use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use log::{error, info, warn};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};

pub const METRICS_OUTPUT_START: &str = "__SERVER_PILOT_METRICS_START__";
pub const METRICS_OUTPUT_END: &str = "__SERVER_PILOT_METRICS_END__";
pub const DIRECTORY_OUTPUT_START: &str = "__SERVER_PILOT_DIRECTORY_START__";
pub const DIRECTORY_OUTPUT_END: &str = "__SERVER_PILOT_DIRECTORY_END__";
pub const SSH_COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
pub const FILE_TRANSFER_TIMEOUT: Duration = Duration::from_secs(120);
/// Maximum bytes kept from SSH/SCP command stdout to prevent OOM on large output.
pub const SSH_OUTPUT_LIMIT: usize = 1024 * 1024; // 1 MiB

pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn shell_double_quote(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('$', "\\$")
        .replace('`', "\\`");
    format!("\"{}\"", escaped)
}

pub fn trim_prompt_buffer(buffer: &mut String) {
    const LIMIT: usize = 2048;

    if buffer.len() <= LIMIT {
        return;
    }

    let target = buffer.len().saturating_sub(LIMIT);
    let keep_from = buffer
        .char_indices()
        .find(|(index, _)| *index >= target)
        .map(|(index, _)| index)
        .unwrap_or(buffer.len());
    buffer.drain(..keep_from);
}

pub fn strip_ansi_sequences(input: &str) -> String {
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

pub fn should_auto_fill_ssh_password(output_tail: &str) -> bool {
    let sanitized = strip_ansi_sequences(output_tail).to_ascii_lowercase();
    let prompt_line = sanitized
        .rsplit(['\n', '\r'])
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();

    if prompt_line.contains("sudo") {
        return false;
    }

    let is_password_prompt = prompt_line.ends_with("password:")
        && (prompt_line == "password:"
            || prompt_line.contains("'s password:")
            || prompt_line.ends_with(" password:"));
    let is_passphrase_prompt = prompt_line.starts_with("enter passphrase for key");
    is_password_prompt || is_passphrase_prompt
}

pub fn needs_remote_path_escaping(path: &str) -> bool {
    path.chars().any(|ch| {
        ch.is_whitespace()
            || matches!(
                ch,
                '\'' | '"'
                    | '\\'
                    | '('
                    | ')'
                    | '['
                    | ']'
                    | '{'
                    | '}'
                    | '&'
                    | ';'
                    | '<'
                    | '>'
                    | '|'
                    | '$'
                    | '`'
            )
    })
}

pub fn escape_remote_path(path: &str) -> String {
    if needs_remote_path_escaping(path) {
        format!("'{}'", path.replace('\'', "'\\''"))
    } else {
        path.to_string()
    }
}

pub fn build_remote_scp_argument(username: &str, host: &str, path: &str) -> String {
    format!("{}@{}:{}", username, host, escape_remote_path(path))
}

pub fn last_meaningful_output_line(output: &str) -> Option<String> {
    strip_ansi_sequences(output)
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| {
            !line.is_empty()
                && !line.eq_ignore_ascii_case("yes")
                && !line.ends_with("password:")
                && !line.contains("continue connecting")
        })
        .map(ToOwned::to_owned)
}

pub fn command_error_message(action_label: &str, output: &str, fallback: &str) -> String {
    last_meaningful_output_line(output)
        .map(|line| format!("Failed to {}: {}", action_label, line))
        .unwrap_or_else(|| format!("Failed to {}: {}", action_label, fallback))
}

pub fn join_remote_path(base: &str, name: &str) -> String {
    if base == "/" {
        format!("/{}", name)
    } else {
        format!("{}/{}", base.trim_end_matches('/'), name)
    }
}

pub fn read_between_markers<'a>(
    output: &'a str,
    start_marker: &str,
    end_marker: &str,
) -> Result<&'a str, String> {
    let start = output
        .find(start_marker)
        .ok_or_else(|| "Output start marker not found".to_string())?;
    let end = output
        .find(end_marker)
        .ok_or_else(|| "Output end marker not found".to_string())?;

    if end <= start {
        return Err("Output markers are invalid".to_string());
    }

    Ok(&output[start + start_marker.len()..end])
}

pub fn run_ssh_command(
    username: &str,
    host: &str,
    port: u16,
    password: Option<&str>,
    key_path: Option<&str>,
    proxy_jump: Option<&str>,
    remote_command: &str,
    timeout: Duration,
    action_label: &str,
) -> Result<String, String> {
    info!(
        "[SSH] Executing command: host={}, port={}, user={}, action={:?}, timeout={:?}",
        host, port, username, action_label, timeout
    );

    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize::default())
        .map_err(|err| {
            error!("[SSH] Failed to create PTY: {}", err);
            err.to_string()
        })?;

    let ssh_path = if cfg!(target_os = "windows") {
        "C:\\Windows\\System32\\OpenSSH\\ssh.exe"
    } else {
        "ssh"
    };
    let mut cmd = CommandBuilder::new(ssh_path);
    cmd.arg("-p");
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
    cmd.arg(format!("{}@{}", username, host));
    cmd.arg(format!("sh -lc {}", shell_quote(remote_command)));

    info!("[SSH] Spawning SSH command...");
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|err| {
            error!("[SSH] Failed to spawn SSH command: {}", err);
            err.to_string()
        })?;
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
    let deadline = Instant::now() + timeout;

    loop {
        if Instant::now() > deadline {
            let elapsed = timeout;
            let _ = child.kill();
            error!(
                "[SSH] Timed out after {:?} while trying to {} (host={}, port={}, user={})",
                elapsed, action_label, host, port, username
            );
            return Err(format!("Timed out while trying to {}", action_label));
        }

        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(Ok(chunk)) => {
                if chunk.is_empty() {
                    break;
                }

                let text = String::from_utf8_lossy(&chunk).to_string();
                if output.len() < SSH_OUTPUT_LIMIT {
                    let remaining = SSH_OUTPUT_LIMIT.saturating_sub(output.len());
                    if text.len() <= remaining {
                        output.push_str(&text);
                    } else {
                        // Find a valid char boundary and truncate
                        let mut boundary = remaining;
                        while boundary > 0 && !text.is_char_boundary(boundary) {
                            boundary -= 1;
                        }
                        output.push_str(&text[..boundary]);
                    }
                }
                prompt_buffer.push_str(&text);
                trim_prompt_buffer(&mut prompt_buffer);

                if !password_sent {
                    if let Some(password) = password.filter(|value| !value.is_empty()) {
                        if should_auto_fill_ssh_password(&prompt_buffer) {
                            info!("[SSH] Password prompt detected, auto-filling credential");
                            writer
                                .write_all(password.as_bytes())
                                .map_err(|err| err.to_string())?;
                            writer.write_all(b"\r").map_err(|err| err.to_string())?;
                            writer.flush().map_err(|err| err.to_string())?;
                            password_sent = true;
                        }
                    }
                }
            }
            Ok(Err(err)) => {
                error!("[SSH] Reader error during {}: {}", action_label, err);
                return Err(err);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(status) = child.try_wait().map_err(|err| err.to_string())? {
                    if !status.success() {
                        warn!(
                            "[SSH] Command exited with non-zero status: {} (action={})",
                            status, action_label
                        );
                        return Err(command_error_message(
                            action_label,
                            &output,
                            &status.to_string(),
                        ));
                    }
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                warn!("[SSH] Reader channel disconnected during {}", action_label);
                break;
            }
        }
    }

    let status = child.wait().map_err(|err| err.to_string())?;
    if status.success() {
        info!(
            "[SSH] Command completed successfully: action={}, output_len={}",
            action_label,
            output.len()
        );
        Ok(output)
    } else {
        error!(
            "[SSH] Command failed: action={}, status={}, output_len={}",
            action_label,
            status,
            output.len()
        );
        Err(command_error_message(
            action_label,
            &output,
            &status.to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_quote_escapes_single_quotes() {
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        assert_eq!(shell_quote("plain"), "'plain'");
    }

    #[test]
    fn join_remote_path_handles_root_and_trailing_slash() {
        assert_eq!(join_remote_path("/", "file.txt"), "/file.txt");
        assert_eq!(join_remote_path("/tmp", "a.txt"), "/tmp/a.txt");
        assert_eq!(join_remote_path("/tmp/", "a.txt"), "/tmp/a.txt");
    }
}
