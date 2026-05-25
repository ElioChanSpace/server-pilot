use crate::servers::application::AppState;
use crate::servers::domain::{Category, OsType, Server};
use crate::servers::infrastructure::session_manager::{self, SessionManagerState};
use log::info;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, State, Window};

const METRICS_OUTPUT_START: &str = "__SERVER_PILOT_METRICS_START__";
const METRICS_OUTPUT_END: &str = "__SERVER_PILOT_METRICS_END__";
const DIRECTORY_OUTPUT_START: &str = "__SERVER_PILOT_DIRECTORY_START__";
const DIRECTORY_OUTPUT_END: &str = "__SERVER_PILOT_DIRECTORY_END__";
const SSH_COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
const FILE_TRANSFER_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMetric {
    pub pid: u32,
    pub cpu_usage: f64,
    pub memory_usage: f64,
    pub command: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuMetric {
    pub name: String,
    pub usage: f64,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub memory_usage: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerMetricsSnapshot {
    pub collected_at: i64,
    pub cpu_usage: f64,
    pub memory_usage: f64,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub gpu: Option<GpuMetric>,
    pub gpu_status: String,
    pub top_processes: Vec<ProcessMetric>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferResult {
    pub direction: String,
    pub local_path: String,
    pub remote_path: String,
    pub message: String,
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

fn build_metrics_command() -> &'static str {
    r#"cpu_usage=$(top -bn1 2>/dev/null | awk -F'[, ]+' '/Cpu\(s\)/ {for (i = 1; i <= NF; i++) if ($i == "id") idle = $(i - 1)} END {if (idle == "") print "0.0"; else printf "%.1f", 100 - idle}')
mem_line=$(awk '/MemTotal:/ {total=$2} /MemAvailable:/ {available=$2} END {used=total-available; if (total == "") total=0; if (used == "") used=0; usage=(total>0?used*100/total:0); printf "%d %d %.1f\n", used/1024, total/1024, usage}' /proc/meminfo)
mem_used=$(printf "%s\n" "$mem_line" | awk '{print $1}')
mem_total=$(printf "%s\n" "$mem_line" | awk '{print $2}')
mem_usage=$(printf "%s\n" "$mem_line" | awk '{print $3}')
echo "__SERVER_PILOT_METRICS_START__"
echo "cpu_usage=${cpu_usage:-0.0}"
echo "memory_used_mb=${mem_used:-0}"
echo "memory_total_mb=${mem_total:-0}"
echo "memory_usage=${mem_usage:-0.0}"
if command -v nvidia-smi >/dev/null 2>&1; then
  gpu_line=$(nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -n 1)
  if [ -n "$gpu_line" ]; then
    gpu_name=$(printf "%s\n" "$gpu_line" | cut -d',' -f1 | sed 's/^ *//;s/ *$//')
    gpu_usage=$(printf "%s\n" "$gpu_line" | cut -d',' -f2 | sed 's/^ *//;s/ *$//')
    gpu_mem_used=$(printf "%s\n" "$gpu_line" | cut -d',' -f3 | sed 's/^ *//;s/ *$//')
    gpu_mem_total=$(printf "%s\n" "$gpu_line" | cut -d',' -f4 | sed 's/^ *//;s/ *$//')
    gpu_mem_usage=$(awk -v used="$gpu_mem_used" -v total="$gpu_mem_total" 'BEGIN { if (total > 0) printf "%.1f", used * 100 / total; else printf "0.0" }')
    echo "gpu_status=available"
    echo "gpu_name=$gpu_name"
    echo "gpu_usage=${gpu_usage:-0.0}"
    echo "gpu_memory_used_mb=${gpu_mem_used:-0}"
    echo "gpu_memory_total_mb=${gpu_mem_total:-0}"
    echo "gpu_memory_usage=${gpu_mem_usage:-0.0}"
  else
    echo "gpu_status=idle"
  fi
else
  echo "gpu_status=unsupported"
fi
ps -eo pid,comm,%cpu,%mem --sort=-%cpu | awk 'NR > 1 && count < 5 { printf "proc=%s|%s|%s|%s\n", $1, $3, $4, $2; count++ }'
echo "__SERVER_PILOT_METRICS_END__""#
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn shell_double_quote(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('$', "\\$")
        .replace('`', "\\`");
    format!("\"{}\"", escaped)
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

fn trim_prompt_buffer(buffer: &mut String) {
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

fn strip_ansi_sequences(input: &str) -> String {
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

fn should_auto_fill_ssh_password(output_tail: &str) -> bool {
    let sanitized = strip_ansi_sequences(output_tail).to_ascii_lowercase();
    let prompt_line = sanitized
        .rsplit(['\n', '\r'])
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();

    if !prompt_line.ends_with("password:") || prompt_line.contains("sudo") {
        return false;
    }

    prompt_line == "password:"
        || prompt_line.contains("'s password:")
        || prompt_line.ends_with(" password:")
}

fn should_accept_host_key_prompt(output_tail: &str) -> bool {
    let sanitized = strip_ansi_sequences(output_tail).to_ascii_lowercase();
    let prompt_line = sanitized
        .rsplit(['\n', '\r'])
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();

    prompt_line.contains("are you sure you want to continue connecting")
        && (prompt_line.ends_with("(yes/no/[fingerprint])?")
            || prompt_line.ends_with("(yes/no)?")
            || prompt_line.ends_with('?'))
}

fn needs_remote_path_escaping(path: &str) -> bool {
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

fn escape_remote_path(path: &str) -> String {
    if needs_remote_path_escaping(path) {
        format!("'{}'", path.replace('\'', "'\\''"))
    } else {
        path.to_string()
    }
}

fn build_remote_scp_argument(username: &str, host: &str, path: &str) -> String {
    format!("{}@{}:{}", username, host, escape_remote_path(path))
}

fn last_meaningful_output_line(output: &str) -> Option<String> {
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

fn command_error_message(action_label: &str, output: &str, fallback: &str) -> String {
    last_meaningful_output_line(output)
        .map(|line| format!("Failed to {}: {}", action_label, line))
        .unwrap_or_else(|| format!("Failed to {}: {}", action_label, fallback))
}

fn join_remote_path(base: &str, name: &str) -> String {
    if base == "/" {
        format!("/{}", name)
    } else {
        format!("{}/{}", base.trim_end_matches('/'), name)
    }
}

fn resolve_transfer_server(
    state: &State<'_, AppState>,
    id: &str,
) -> Result<(String, String, u16, String), String> {
    let server = {
        let data = state.data.lock().map_err(|err| err.to_string())?;
        data.servers
            .iter()
            .find(|server| server.id == id)
            .cloned()
            .ok_or("Server not found")?
    };

    if !matches!(server.os_type, OsType::Linux) {
        return Err("Only Linux file transfer is supported currently".to_string());
    }

    let password = server
        .password
        .filter(|value| !value.is_empty())
        .ok_or("File transfer requires a saved SSH password".to_string())?;

    let username = if server.username.eq_ignore_ascii_case("root") {
        "root".to_string()
    } else {
        server.username
    };

    Ok((username, server.host, server.port, password))
}

fn read_between_markers<'a>(
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

fn parse_metrics_output(output: &str) -> Result<ServerMetricsSnapshot, String> {
    let metrics_block = read_between_markers(output, METRICS_OUTPUT_START, METRICS_OUTPUT_END)?;

    let mut cpu_usage = 0.0;
    let mut memory_usage = 0.0;
    let mut memory_used_mb = 0_u64;
    let mut memory_total_mb = 0_u64;
    let mut gpu_status = "unsupported".to_string();
    let mut gpu_name: Option<String> = None;
    let mut gpu_usage: Option<f64> = None;
    let mut gpu_memory_used_mb: Option<u64> = None;
    let mut gpu_memory_total_mb: Option<u64> = None;
    let mut gpu_memory_usage: Option<f64> = None;
    let mut top_processes = Vec::new();

    for raw_line in metrics_block.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(value) = line.strip_prefix("cpu_usage=") {
            cpu_usage = value.parse::<f64>().unwrap_or(0.0);
            continue;
        }
        if let Some(value) = line.strip_prefix("memory_usage=") {
            memory_usage = value.parse::<f64>().unwrap_or(0.0);
            continue;
        }
        if let Some(value) = line.strip_prefix("memory_used_mb=") {
            memory_used_mb = value.parse::<u64>().unwrap_or(0);
            continue;
        }
        if let Some(value) = line.strip_prefix("memory_total_mb=") {
            memory_total_mb = value.parse::<u64>().unwrap_or(0);
            continue;
        }
        if let Some(value) = line.strip_prefix("gpu_status=") {
            gpu_status = value.to_string();
            continue;
        }
        if let Some(value) = line.strip_prefix("gpu_name=") {
            gpu_name = Some(value.to_string());
            continue;
        }
        if let Some(value) = line.strip_prefix("gpu_usage=") {
            gpu_usage = Some(value.parse::<f64>().unwrap_or(0.0));
            continue;
        }
        if let Some(value) = line.strip_prefix("gpu_memory_used_mb=") {
            gpu_memory_used_mb = Some(value.parse::<u64>().unwrap_or(0));
            continue;
        }
        if let Some(value) = line.strip_prefix("gpu_memory_total_mb=") {
            gpu_memory_total_mb = Some(value.parse::<u64>().unwrap_or(0));
            continue;
        }
        if let Some(value) = line.strip_prefix("gpu_memory_usage=") {
            gpu_memory_usage = Some(value.parse::<f64>().unwrap_or(0.0));
            continue;
        }
        if let Some(value) = line.strip_prefix("proc=") {
            let mut parts = value.splitn(4, '|');
            let pid = parts.next().and_then(|item| item.parse::<u32>().ok());
            let cpu = parts.next().and_then(|item| item.parse::<f64>().ok());
            let memory = parts.next().and_then(|item| item.parse::<f64>().ok());
            let command = parts.next().map(|item| item.to_string());

            if let (Some(pid), Some(cpu_usage), Some(memory_usage), Some(command)) =
                (pid, cpu, memory, command)
            {
                top_processes.push(ProcessMetric {
                    pid,
                    cpu_usage,
                    memory_usage,
                    command,
                });
            }
        }
    }

    let gpu = if gpu_status == "available" {
        Some(GpuMetric {
            name: gpu_name.unwrap_or_else(|| "NVIDIA GPU".to_string()),
            usage: gpu_usage.unwrap_or(0.0),
            memory_used_mb: gpu_memory_used_mb.unwrap_or(0),
            memory_total_mb: gpu_memory_total_mb.unwrap_or(0),
            memory_usage: gpu_memory_usage.unwrap_or(0.0),
        })
    } else {
        None
    };

    Ok(ServerMetricsSnapshot {
        collected_at: chrono::Utc::now().timestamp_millis(),
        cpu_usage,
        memory_usage,
        memory_used_mb,
        memory_total_mb,
        gpu,
        gpu_status,
        top_processes,
    })
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

fn run_ssh_command(
    username: &str,
    host: &str,
    port: u16,
    password: Option<&str>,
    remote_command: &str,
    timeout: Duration,
    action_label: &str,
) -> Result<String, String> {
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize::default())
        .map_err(|err| err.to_string())?;

    let mut cmd = CommandBuilder::new("ssh");
    cmd.arg("-p");
    cmd.arg(port.to_string());
    cmd.arg(format!("{}@{}", username, host));
    cmd.arg(format!("sh -lc {}", shell_quote(remote_command)));

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
    let mut host_key_confirmed = false;
    let deadline = Instant::now() + timeout;

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

                if !host_key_confirmed && should_accept_host_key_prompt(&prompt_buffer) {
                    writer.write_all(b"yes\r").map_err(|err| err.to_string())?;
                    writer.flush().map_err(|err| err.to_string())?;
                    host_key_confirmed = true;
                    continue;
                }

                if !password_sent {
                    if let Some(password) = password.filter(|value| !value.is_empty()) {
                        if should_auto_fill_ssh_password(&prompt_buffer) {
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
        Ok(output)
    } else {
        Err(command_error_message(
            action_label,
            &output,
            &status.to_string(),
        ))
    }
}

fn run_scp_transfer(
    port: u16,
    password: &str,
    source: &str,
    target: &str,
    action_label: &str,
) -> Result<(), String> {
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize::default())
        .map_err(|err| err.to_string())?;

    let mut cmd = CommandBuilder::new("scp");
    cmd.arg("-P");
    cmd.arg(port.to_string());
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
    let mut host_key_confirmed = false;
    let deadline = Instant::now() + FILE_TRANSFER_TIMEOUT;

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

                if !host_key_confirmed && should_accept_host_key_prompt(&prompt_buffer) {
                    writer.write_all(b"yes\r").map_err(|err| err.to_string())?;
                    writer.flush().map_err(|err| err.to_string())?;
                    host_key_confirmed = true;
                    continue;
                }

                if !password_sent && should_auto_fill_ssh_password(&prompt_buffer) {
                    writer
                        .write_all(password.as_bytes())
                        .map_err(|err| err.to_string())?;
                    writer.write_all(b"\r").map_err(|err| err.to_string())?;
                    writer.flush().map_err(|err| err.to_string())?;
                    password_sent = true;
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
pub fn create_server(
    state: State<'_, AppState>,
    _app: AppHandle, // AppHandle is no longer needed here as repository handles saving
    name: String,
    host: String,
    port: u16,
    username: String,
    category_id: Option<String>,
    os_type: OsType,
    password: Option<String>,
) -> Result<Server, String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let server = Server::new(name, host, port, username, category_id, os_type, password);
    data.servers.push(server.clone());
    drop(data); // Release lock before saving
    state.save()?;
    Ok(server)
}

#[tauri::command]
pub fn update_server(
    state: State<'_, AppState>,
    id: String,
    name: String,
    host: String,
    port: u16,
    username: String,
    category_id: Option<String>,
    os_type: OsType,
    password: Option<String>,
) -> Result<Server, String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let server = data
        .servers
        .iter_mut()
        .find(|server| server.id == id)
        .ok_or("Server not found")?;

    server.name = name;
    server.host = host;
    server.port = port;
    server.username = username;
    server.category_id = category_id;
    server.os_type = os_type;
    server.password = password;

    let updated_server = server.clone();
    drop(data);
    state.save()?;
    Ok(updated_server)
}

#[tauri::command]
pub fn create_category(
    state: State<'_, AppState>,
    _app: AppHandle,
    name: String,
    parent_id: Option<String>,
) -> Result<Category, String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let category = Category::new(name, parent_id);
    data.categories.push(category.clone());
    drop(data);
    state.save()?;
    Ok(category)
}

#[tauri::command]
pub fn get_servers(state: State<'_, AppState>) -> Result<Vec<Server>, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.servers.clone())
}

#[tauri::command]
pub fn get_categories(state: State<'_, AppState>) -> Result<Vec<Category>, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.categories.clone())
}

// --- PTY Commands (Delegated to SessionManager) ---

#[tauri::command]
pub async fn connect_server(
    window: Window,
    state: State<'_, AppState>,
    session_manager: State<'_, SessionManagerState>,
    id: String,
) -> Result<(), String> {
    info!("Received connect_server command for id: {}", id);
    let server = {
        let mut data = state.data.lock().map_err(|e| e.to_string())?;
        let s = data
            .servers
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or("Server not found")?;
        s.status = "connecting".into();
        let _ = window.emit("server-status-changed", s.clone());
        s.clone()
    };

    if !matches!(server.os_type, OsType::Linux) {
        return Err("Only Linux SSH is supported currently".into());
    }

    let username = if matches!(&server.os_type, OsType::Linux)
        && server.username.eq_ignore_ascii_case("root")
    {
        "root".to_string()
    } else {
        server.username
    };

    session_manager::start_session(
        window,
        server.id,
        username,
        server.host,
        server.port,
        server.password,
        state,
        session_manager,
    )
}

#[tauri::command]
pub fn pty_write(
    session_manager: State<'_, SessionManagerState>,
    server_id: String,
    data: String,
) -> Result<(), String> {
    session_manager::write_to_session(session_manager, server_id, data)
}

#[tauri::command]
pub fn pty_resize(
    session_manager: State<'_, SessionManagerState>,
    server_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    session_manager::resize_session(session_manager, server_id, rows, cols)
}

#[tauri::command]
pub fn disconnect_server(
    session_manager: State<'_, SessionManagerState>,
    server_id: String,
) -> Result<(), String> {
    session_manager::close_session(session_manager, server_id)
}

#[tauri::command]
pub async fn fetch_server_metrics(
    state: State<'_, AppState>,
    id: String,
) -> Result<ServerMetricsSnapshot, String> {
    let server = {
        let data = state.data.lock().map_err(|err| err.to_string())?;
        data.servers
            .iter()
            .find(|server| server.id == id)
            .cloned()
            .ok_or("Server not found")?
    };

    if !matches!(server.os_type, OsType::Linux) {
        return Err("Only Linux server monitoring is supported currently".to_string());
    }

    let username = if server.username.eq_ignore_ascii_case("root") {
        "root".to_string()
    } else {
        server.username.clone()
    };
    let host = server.host.clone();
    let port = server.port;
    let password = server.password.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let output = run_ssh_command(
            &username,
            &host,
            port,
            password.as_deref(),
            build_metrics_command(),
            SSH_COMMAND_TIMEOUT,
            "collect server metrics",
        )?;
        parse_metrics_output(&output)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn list_remote_directory(
    state: State<'_, AppState>,
    id: String,
    path: Option<String>,
) -> Result<RemoteDirectoryListing, String> {
    let requested_path = path.unwrap_or_default().trim().to_string();
    info!("查询目录:{}", requested_path);

    let (username, host, port, password) = resolve_transfer_server(&state, &id)?;
    let remote_command = build_list_directory_command(&requested_path);

    tauri::async_runtime::spawn_blocking(move || {
        let output = run_ssh_command(
            &username,
            &host,
            port,
            Some(&password),
            &remote_command,
            SSH_COMMAND_TIMEOUT,
            "list remote directory",
        )?;

        info!("查询[{}]目录结果:{}", requested_path, output);
        parse_remote_directory_output(&output)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn upload_file_to_server(
    state: State<'_, AppState>,
    id: String,
    local_path: String,
    remote_path: String,
) -> Result<FileTransferResult, String> {
    if !Path::new(&local_path).exists() {
        return Err("Local file does not exist".to_string());
    }

    let remote_path = remote_path.trim().to_string();
    if remote_path.is_empty() {
        return Err("Remote path is required".to_string());
    }

    let (username, host, port, password) = resolve_transfer_server(&state, &id)?;
    let target = build_remote_scp_argument(&username, &host, &remote_path);
    let local_path_for_result = local_path.clone();
    let remote_path_for_result = remote_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        run_scp_transfer(port, &password, &local_path, &target, "upload file")?;

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
    state: State<'_, AppState>,
    id: String,
    remote_path: String,
    local_path: String,
) -> Result<FileTransferResult, String> {
    let remote_path = remote_path.trim().to_string();
    if remote_path.is_empty() {
        return Err("Remote path is required".to_string());
    }

    let local_path = local_path.trim().to_string();
    if local_path.is_empty() {
        return Err("Local path is required".to_string());
    }

    let (username, host, port, password) = resolve_transfer_server(&state, &id)?;
    let source = build_remote_scp_argument(&username, &host, &remote_path);
    let local_path_for_result = local_path.clone();
    let remote_path_for_result = remote_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        run_scp_transfer(port, &password, &source, &local_path, "download file")?;

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
