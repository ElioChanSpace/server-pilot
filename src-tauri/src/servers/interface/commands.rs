use crate::servers::application::AppState;
use crate::servers::domain::{AppSettings, Category, OsType, Server};
use crate::servers::infrastructure::credential_store;
use crate::servers::infrastructure::session_manager::{self, SessionManagerState};
use log::info;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State, Window};

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
    #[serde(default)]
    pub disk_usage: f64,
    #[serde(default)]
    pub load_1: f64,
    #[serde(default)]
    pub load_5: f64,
    #[serde(default)]
    pub load_15: f64,
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHost {
    pub host: String,
    pub host_name: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
}

fn ssh_config_path_from_env() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_default()
            .join(".ssh\\config")
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_default()
            .join(".ssh/config")
    }
}

fn ssh_config_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let (keyword, value) = line.split_once(char::is_whitespace)?;
    if keyword.eq_ignore_ascii_case(key) {
        Some(value.trim())
    } else {
        None
    }
}

#[tauri::command]
pub fn parse_ssh_config(path: Option<String>) -> Result<Vec<SshConfigHost>, String> {
    let config_path = path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            let default = ssh_config_path_from_env();
            if default.exists() {
                Some(default)
            } else {
                None
            }
        })
        .ok_or("未找到 SSH config 文件，请指定路径")?;

    let content = fs::read_to_string(&config_path)
        .map_err(|err| format!("读取 SSH config 失败: {err}"))?;

    let mut results: Vec<SshConfigHost> = Vec::new();
    let mut current_hosts: Vec<String> = Vec::new();
    let mut current_host_name: Option<String> = None;
    let mut current_user: Option<String> = None;
    let mut current_port: Option<String> = None;
    let mut current_identity: Option<String> = None;
    let mut current_proxy: Option<String> = None;

    let flush_block = |results: &mut Vec<SshConfigHost>,
                       hosts: &[String],
                       host_name: &Option<String>,
                       user: &Option<String>,
                       port: &Option<String>,
                       identity: &Option<String>,
                       proxy: &Option<String>| {
        let Some(host_name) = host_name else {
            return;
        };
        let parsed_port = port.as_deref().and_then(|value| value.parse::<u16>().ok());
        for host in hosts {
            if host.contains('*') || host.contains('?') {
                continue;
            }
            results.push(SshConfigHost {
                host: host.clone(),
                host_name: host_name.clone(),
                user: user.clone(),
                port: parsed_port,
                identity_file: identity.clone(),
                proxy_jump: proxy.clone(),
            });
        }
    };

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        if let Some(value) = ssh_config_value(line, "host") {
            flush_block(
                &mut results,
                &current_hosts,
                &current_host_name,
                &current_user,
                &current_port,
                &current_identity,
                &current_proxy,
            );
            current_hosts = value.split_whitespace().map(str::to_string).collect();
            current_host_name = None;
            current_user = None;
            current_port = None;
            current_identity = None;
            current_proxy = None;
        } else if let Some(value) = ssh_config_value(line, "hostname") {
            current_host_name = Some(value.to_string());
        } else if let Some(value) = ssh_config_value(line, "user") {
            current_user = Some(value.to_string());
        } else if let Some(value) = ssh_config_value(line, "port") {
            current_port = Some(value.to_string());
        } else if let Some(value) = ssh_config_value(line, "identityfile") {
            if current_identity.is_none() {
                current_identity = Some(value.to_string());
            }
        } else if let Some(value) = ssh_config_value(line, "proxyjump") {
            current_proxy = Some(value.to_string());
        }
    }

    flush_block(
        &mut results,
        &current_hosts,
        &current_host_name,
        &current_user,
        &current_port,
        &current_identity,
        &current_proxy,
    );

    Ok(results)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLogSnapshot {
    pub file_path: String,
    pub lines: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConnectResult {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAppSettingsRequest {
    pub terminal_idle_disconnect_enabled: bool,
    pub terminal_idle_disconnect_minutes: u32,
    pub terminal_font_size: Option<u8>,
    pub terminal_scrollback: Option<u32>,
    pub minimize_to_tray_on_close: Option<bool>,
}

fn resolve_app_log_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let log_dir = app_handle
        .path()
        .app_log_dir()
        .or_else(|_| {
            app_handle
                .path()
                .app_local_data_dir()
                .map(|path| path.join("logs"))
        })
        .map_err(|_| "无法解析应用日志目录".to_string())?;

    Ok(log_dir.join("app.log"))
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
disk_usage=$(df -P / 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')
load_line=$(cat /proc/loadavg 2>/dev/null)
load_1=$(printf "%s\n" "$load_line" | awk '{print $1}')
load_5=$(printf "%s\n" "$load_line" | awk '{print $2}')
load_15=$(printf "%s\n" "$load_line" | awk '{print $3}')
echo "disk_usage=${disk_usage:-0.0}"
echo "load_1=${load_1:-0.0}"
echo "load_5=${load_5:-0.0}"
echo "load_15=${load_15:-0.0}"
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

#[derive(Debug, Clone)]
struct TransferConnection {
    username: String,
    host: String,
    port: u16,
    password: Option<String>,
    key_path: Option<String>,
    key_passphrase: Option<String>,
    proxy_jump: Option<String>,
}

fn resolve_transfer_server(
    state: &State<'_, AppState>,
    id: &str,
) -> Result<TransferConnection, String> {
    let server = {
        let data = state.data.lock().map_err(|err| err.to_string())?;
        data.servers
            .iter()
            .find(|server| server.id == id)
            .cloned()
            .ok_or("Server not found")?
    };

    if !matches!(server.os_type, OsType::Linux) {
        return Err("当前版本仅支持 Linux 服务器传输文件".to_string());
    }

    let password = credential_store::get_password(id)?.filter(|value| !value.is_empty());
    let key_passphrase =
        credential_store::get_key_passphrase(id)?.filter(|value| !value.is_empty());

    if server.auth_method != "key" && password.is_none() {
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
    let mut disk_usage = 0.0;
    let mut load_1 = 0.0;
    let mut load_5 = 0.0;
    let mut load_15 = 0.0;
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
        if let Some(value) = line.strip_prefix("disk_usage=") {
            disk_usage = value.parse::<f64>().unwrap_or(0.0);
            continue;
        }
        if let Some(value) = line.strip_prefix("load_1=") {
            load_1 = value.parse::<f64>().unwrap_or(0.0);
            continue;
        }
        if let Some(value) = line.strip_prefix("load_5=") {
            load_5 = value.parse::<f64>().unwrap_or(0.0);
            continue;
        }
        if let Some(value) = line.strip_prefix("load_15=") {
            load_15 = value.parse::<f64>().unwrap_or(0.0);
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
        disk_usage,
        load_1,
        load_5,
        load_15,
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
    key_path: Option<&str>,
    proxy_jump: Option<&str>,
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

fn parse_scp_speed(speed: &str) -> Option<f64> {
    let normalized = speed.trim();
    let units = [
        ("GB/s", 1024.0 * 1024.0 * 1024.0),
        ("MB/s", 1024.0 * 1024.0),
        ("KB/s", 1024.0),
        ("B/s", 1.0),
    ];

    for (suffix, multiplier) in units {
        if let Some(value) = normalized.strip_suffix(suffix) {
            let parsed = value.trim().parse::<f64>().ok()?;
            return Some(parsed * multiplier);
        }
    }

    None
}

fn parse_scp_eta(value: &str) -> Option<u64> {
    let parts = value
        .split(':')
        .map(|segment| segment.trim().parse::<u64>().ok())
        .collect::<Option<Vec<_>>>()?;

    match parts.as_slice() {
        [minutes, seconds] => Some(minutes * 60 + seconds),
        [hours, minutes, seconds] => Some(hours * 3600 + minutes * 60 + seconds),
        _ => None,
    }
}

fn parse_scp_progress(
    chunk: &str,
    file_name: &str,
    total_bytes: Option<u64>,
) -> Option<(u8, Option<u64>, Option<f64>, Option<u64>)> {
    for line in chunk.split(['\r', '\n']).rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.contains('%') || !trimmed.contains(file_name) {
            continue;
        }

        let tokens = trimmed.split_whitespace().collect::<Vec<_>>();
        let percent_index = tokens.iter().position(|token| {
            token.ends_with('%')
                && token
                    .trim_end_matches('%')
                    .chars()
                    .all(|ch| ch.is_ascii_digit())
        })?;
        let progress_percent = tokens[percent_index]
            .trim_end_matches('%')
            .parse::<u8>()
            .ok()?;
        let transferred_bytes =
            total_bytes.map(|total| total.saturating_mul(u64::from(progress_percent)) / 100);
        let bytes_per_second = tokens
            .get(percent_index + 2)
            .and_then(|value| parse_scp_speed(value));
        let eta_seconds = tokens
            .get(percent_index + 3)
            .and_then(|value| parse_scp_eta(value));

        return Some((
            progress_percent,
            transferred_bytes,
            bytes_per_second,
            eta_seconds,
        ));
    }

    None
}

fn run_scp_transfer(
    window: Option<Window>,
    transfer_id: Option<String>,
    port: u16,
    credential: Option<&str>,
    key_path: Option<&str>,
    proxy_jump: Option<&str>,
    source: &str,
    target: &str,
    action_label: &str,
    direction: &str,
    local_path: &str,
    remote_path: &str,
    total_bytes: Option<u64>,
) -> Result<(), String> {
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize::default())
        .map_err(|err| err.to_string())?;

    let mut cmd = CommandBuilder::new("scp");
    cmd.arg("-P");
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
    let mut last_progress_percent = None;
    let deadline = Instant::now() + FILE_TRANSFER_TIMEOUT;
    let file_name = Path::new(local_path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(local_path)
        .to_string();

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

                if let Some((progress_percent, transferred_bytes, bytes_per_second, eta_seconds)) =
                    parse_scp_progress(&text, &file_name, total_bytes)
                {
                    if last_progress_percent != Some(progress_percent) {
                        last_progress_percent = Some(progress_percent);
                        emit_file_transfer_progress(
                            window.as_ref(),
                            transfer_id.as_deref(),
                            FileTransferProgressEvent {
                                transfer_id: transfer_id.clone().unwrap_or_default(),
                                direction: direction.to_string(),
                                local_path: local_path.to_string(),
                                remote_path: remote_path.to_string(),
                                status: "progress".to_string(),
                                progress_percent,
                                transferred_bytes,
                                total_bytes,
                                bytes_per_second,
                                eta_seconds,
                                message: None,
                            },
                        );
                    }
                }

                if !password_sent {
                    if let Some(credential) = credential.filter(|value| !value.is_empty()) {
                        if should_auto_fill_ssh_password(&prompt_buffer) {
                            writer
                                .write_all(credential.as_bytes())
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
    auth_method: String,
    password: Option<String>,
    key_path: Option<String>,
    key_passphrase: Option<String>,
    proxy_jump: Option<String>,
) -> Result<Server, String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let mut server = Server::new(
        name,
        host,
        port,
        username,
        category_id,
        os_type,
        auth_method,
        password,
        key_path,
        key_passphrase,
        proxy_jump,
    );
    if server.has_password {
        if let Some(password) = server.password.clone() {
            credential_store::save_password(&server.id, &password)?;
        }
    }
    if server.has_key_passphrase {
        if let Some(passphrase) = server.key_passphrase.clone() {
            credential_store::save_key_passphrase(&server.id, &passphrase)?;
        }
    }
    // 密码已存入系统钥匙串，内存与返回值均不保留明文。
    server.password = None;
    server.key_passphrase = None;
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
    auth_method: String,
    password: Option<String>,
    key_path: Option<String>,
    key_passphrase: Option<String>,
    proxy_jump: Option<String>,
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
    server.auth_method = auth_method;
    server.key_path = key_path;
    server.proxy_jump = proxy_jump;
    match password.as_deref() {
        Some(value) if !value.is_empty() => {
            credential_store::save_password(&server.id, value)?;
            server.has_password = true;
        }
        _ => {
            // 空密码或未提供时保留钥匙串中的既有凭据。
        }
    }
    match key_passphrase.as_deref() {
        Some(value) if !value.is_empty() => {
            credential_store::save_key_passphrase(&server.id, value)?;
            server.has_key_passphrase = true;
        }
        _ => {}
    }
    server.password = None;
    server.key_passphrase = None;

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

#[tauri::command]
pub fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.settings.clone())
}

#[tauri::command]
pub fn update_app_settings(
    state: State<'_, AppState>,
    payload: UpdateAppSettingsRequest,
) -> Result<AppSettings, String> {
    if payload.terminal_idle_disconnect_enabled && payload.terminal_idle_disconnect_minutes == 0 {
        return Err("空闲断连时间必须大于 0 分钟".to_string());
    }

    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let current = data.settings.clone();
    data.settings = AppSettings {
        terminal_idle_disconnect_enabled: payload.terminal_idle_disconnect_enabled,
        terminal_idle_disconnect_minutes: payload.terminal_idle_disconnect_minutes.max(1),
        terminal_font_size: payload
            .terminal_font_size
            .unwrap_or(current.terminal_font_size)
            .clamp(12, 24),
        terminal_scrollback: payload
            .terminal_scrollback
            .unwrap_or(current.terminal_scrollback)
            .max(500),
        minimize_to_tray_on_close: payload
            .minimize_to_tray_on_close
            .unwrap_or(current.minimize_to_tray_on_close),
    };
    let settings = data.settings.clone();
    drop(data);
    state.save()?;
    Ok(settings)
}

// --- PTY Commands (Delegated to SessionManager) ---

#[tauri::command]
pub async fn connect_server(
    window: Window,
    state: State<'_, AppState>,
    session_manager: State<'_, SessionManagerState>,
    id: String,
) -> Result<SessionConnectResult, String> {
    info!("Received connect_server command for id: {}", id);
    let has_existing_session =
        session_manager::has_active_session_for_server(&session_manager, &id)?;
    let server = {
        let mut data = state.data.lock().map_err(|e| e.to_string())?;
        let s = data
            .servers
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or("Server not found")?;
        if !has_existing_session {
            s.status = "connecting".into();
            let _ = window.emit("server-status-changed", s.clone());
        }
        s.clone()
    };

    let password = credential_store::get_password(&server.id)?;
    let key_passphrase = credential_store::get_key_passphrase(&server.id)?;
    let use_key_auth = server.auth_method == "key";

    if !matches!(server.os_type, OsType::Linux) {
        return Err("当前版本暂不支持 Windows 服务器（仅支持 Linux SSH）".into());
    }

    let username = if matches!(&server.os_type, OsType::Linux)
        && server.username.eq_ignore_ascii_case("root")
    {
        "root".to_string()
    } else {
        server.username
    };

    let session_id = session_manager::start_session(
        window,
        server.id,
        username,
        server.host,
        server.port,
        password,
        if use_key_auth { server.key_path } else { None },
        if use_key_auth { key_passphrase } else { None },
        server.proxy_jump,
        state,
        session_manager,
    )?;

    Ok(SessionConnectResult { session_id })
}

#[tauri::command]
pub fn pty_write(
    session_manager: State<'_, SessionManagerState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    session_manager::write_to_session(session_manager, session_id, data)
}

#[tauri::command]
pub fn pty_resize(
    session_manager: State<'_, SessionManagerState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    session_manager::resize_session(session_manager, session_id, rows, cols)
}

#[tauri::command]
pub fn get_terminal_session_directory(
    session_manager: State<'_, SessionManagerState>,
    session_id: String,
) -> Result<String, String> {
    session_manager::read_session_current_directory(session_manager, session_id)
}

#[tauri::command]
pub fn disconnect_server(
    session_manager: State<'_, SessionManagerState>,
    server_id: String,
) -> Result<(), String> {
    session_manager::close_server_sessions(session_manager, server_id)
}

#[tauri::command]
pub fn close_terminal_session(
    session_manager: State<'_, SessionManagerState>,
    session_id: String,
) -> Result<(), String> {
    session_manager::close_session(session_manager, session_id)
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
        return Err("当前版本仅支持 Linux 服务器监控".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;

    tauri::async_runtime::spawn_blocking(move || {
        let output = run_ssh_command(
            &connection.username,
            &connection.host,
            connection.port,
            connection.password.as_deref(),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
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

    let connection = resolve_transfer_server(&state, &id)?;
    let remote_command = build_list_directory_command(&requested_path);

    tauri::async_runtime::spawn_blocking(move || {
        let output = run_ssh_command(
            &connection.username,
            &connection.host,
            connection.port,
            connection.password.as_deref(),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &remote_command,
            SSH_COMMAND_TIMEOUT,
            "list remote directory",
        )?;
        parse_remote_directory_output(&output)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn upload_file_to_server(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    local_path: String,
    remote_path: String,
    transfer_id: Option<String>,
) -> Result<FileTransferResult, String> {
    let local_metadata = fs::metadata(&local_path)
        .map_err(|_| "Local file does not exist".to_string())?;
    if !local_metadata.is_file() {
        return Err("Only single file upload is supported".to_string());
    }

    if !Path::new(&local_path).exists() {
        return Err("Local file does not exist".to_string());
    }

    let remote_path = remote_path.trim().to_string();
    if remote_path.is_empty() {
        return Err("Remote path is required".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;
    let target = build_remote_scp_argument(&connection.username, &connection.host, &remote_path);
    let local_path_for_result = local_path.clone();
    let remote_path_for_result = remote_path.clone();
    let transfer_id_for_result = transfer_id.clone();
    let total_bytes = Some(local_metadata.len());

    if let Some(current_transfer_id) = transfer_id.as_deref() {
        emit_file_transfer_progress(
            Some(&window),
            Some(current_transfer_id),
            FileTransferProgressEvent {
                transfer_id: current_transfer_id.to_string(),
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
        let transfer_result = run_scp_transfer(
            Some(window.clone()),
            transfer_id.clone(),
            connection.port,
            connection
                .password
                .as_deref()
                .or(connection.key_passphrase.as_deref()),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &local_path,
            &target,
            "upload file",
            "upload",
            &local_path,
            &remote_path,
            total_bytes,
        );

        if let Err(err) = transfer_result {
            if let Some(current_transfer_id) = transfer_id.as_deref() {
                emit_file_transfer_progress(
                    Some(&window),
                    Some(current_transfer_id),
                    FileTransferProgressEvent {
                        transfer_id: current_transfer_id.to_string(),
                        direction: "upload".to_string(),
                        local_path: local_path.clone(),
                        remote_path: remote_path.clone(),
                        status: "failed".to_string(),
                        progress_percent: 0,
                        transferred_bytes: None,
                        total_bytes,
                        bytes_per_second: None,
                        eta_seconds: None,
                        message: Some(err.clone()),
                    },
                );
            }
            return Err(err);
        }

        if let Some(current_transfer_id) = transfer_id_for_result.as_deref() {
            emit_file_transfer_progress(
                Some(&window),
                Some(current_transfer_id),
                FileTransferProgressEvent {
                    transfer_id: current_transfer_id.to_string(),
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

    let connection = resolve_transfer_server(&state, &id)?;
    let source = build_remote_scp_argument(&connection.username, &connection.host, &remote_path);
    let local_path_for_result = local_path.clone();
    let remote_path_for_result = remote_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        run_scp_transfer(
            None,
            None,
            connection.port,
            connection
                .password
                .as_deref()
                .or(connection.key_passphrase.as_deref()),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &source,
            &local_path,
            "download file",
            "download",
            &local_path,
            &remote_path,
            None,
        )?;

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

#[tauri::command]
pub async fn delete_remote_path(
    state: State<'_, AppState>,
    id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let path = path.trim().to_string();
    if path.is_empty() || path == "/" {
        return Err("无效的远程路径".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;
    let command = if is_dir {
        format!("rm -rf -- {}", shell_quote(&path))
    } else {
        format!("rm -f -- {}", shell_quote(&path))
    };

    tauri::async_runtime::spawn_blocking(move || {
        run_ssh_command(
            &connection.username,
            &connection.host,
            connection.port,
            connection.password.as_deref(),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &command,
            SSH_COMMAND_TIMEOUT,
            "delete remote path",
        )?;
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn rename_remote_path(
    state: State<'_, AppState>,
    id: String,
    path: String,
    new_path: String,
) -> Result<(), String> {
    let path = path.trim().to_string();
    let new_path = new_path.trim().to_string();
    if path.is_empty() || new_path.is_empty() {
        return Err("无效的远程路径".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;
    let command = format!(
        "mv -- {} {}",
        shell_quote(&path),
        shell_quote(&new_path)
    );

    tauri::async_runtime::spawn_blocking(move || {
        run_ssh_command(
            &connection.username,
            &connection.host,
            connection.port,
            connection.password.as_deref(),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &command,
            SSH_COMMAND_TIMEOUT,
            "rename remote path",
        )?;
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn create_remote_directory(
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> Result<(), String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("无效的远程路径".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;
    let command = format!("mkdir -p -- {}", shell_quote(&path));

    tauri::async_runtime::spawn_blocking(move || {
        run_ssh_command(
            &connection.username,
            &connection.host,
            connection.port,
            connection.password.as_deref(),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &command,
            SSH_COMMAND_TIMEOUT,
            "create remote directory",
        )?;
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteLogResult {
    pub path: String,
    pub lines: Vec<String>,
}

#[tauri::command]
pub async fn read_remote_log(
    state: State<'_, AppState>,
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
