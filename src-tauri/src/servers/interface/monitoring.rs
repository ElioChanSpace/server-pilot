use crate::servers::application::AppState;
use crate::servers::domain::OsType;
use log::{error, info, warn};
use serde::Serialize;
use tauri::State;

use super::util::{
    read_between_markers,
    METRICS_OUTPUT_START, METRICS_OUTPUT_END,
};
use super::file_transfer::resolve_transfer_server;
use super::ssh_client;

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

fn parse_metrics_output(output: &str) -> Result<ServerMetricsSnapshot, String> {
    let metrics_block = read_between_markers(output, METRICS_OUTPUT_START, METRICS_OUTPUT_END)
        .map_err(|e| {
            error!("[Monitor] Failed to read metrics markers: {}", e);
            warn!("[Monitor] Raw output (first 500 chars): {}", &output[..output.len().min(500)]);
            e
        })?;

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

#[tauri::command]
pub async fn fetch_server_metrics(
    state: State<'_, AppState>,
    id: String,
) -> Result<ServerMetricsSnapshot, String> {
    info!("[Monitor] Fetching metrics for server: {}", id);

    let server = {
        let data = state.data.lock().map_err(|err| err.to_string())?;
        data.servers
            .iter()
            .find(|server| server.id == id)
            .cloned()
            .ok_or_else(|| {
                error!("[Monitor] Server not found: {}", id);
                "Server not found"
            })?
    };

    if !matches!(server.os_type, OsType::Linux) {
        error!("[Monitor] Unsupported OS type: {:?} for server {}", server.os_type, id);
        return Err("当前版本仅支持 Linux 服务器监控".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;
    info!("[Monitor] Connection resolved: host={}, port={}, user={}", connection.host, connection.port, connection.username);

    tauri::async_runtime::spawn_blocking(move || {
        info!("[Monitor] Executing metrics SSH command...");
        let output = ssh_client::run_ssh_exec_blocking(
            &connection,
            &build_metrics_command(),
            "collect server metrics",
        )?;
        info!("[Monitor] Metrics command output: {} bytes", output.len());
        match parse_metrics_output(&output) {
            Ok(ref metrics) => {
                info!(
                    "[Monitor] Metrics parsed: cpu={}%, mem={}%, mem_used={}MB, mem_total={}MB, disk={}%",
                    metrics.cpu_usage, metrics.memory_usage, metrics.memory_used_mb,
                    metrics.memory_total_mb, metrics.disk_usage
                );
            }
            Err(ref e) => {
                error!("[Monitor] Failed to parse metrics output: {}", e);
                warn!("[Monitor] Raw output (first 500 chars): {}", &output[..output.len().min(500)]);
            }
        }
        parse_metrics_output(&output)
    })
    .await
    .map_err(|err| err.to_string())?
}

// ---- Port monitoring ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub port: u16,
    pub protocol: String,
    pub address: String,
    pub process: String,
    pub pid: u32,
}

fn parse_ss_output(output: &str) -> Vec<PortInfo> {
    let mut ports = Vec::new();
    for line in output.lines().skip(1) { // skip header
        let line = line.trim();
        if line.is_empty() { continue; }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 { continue; }

        // State Recv-Q Send-Q LocalAddress:Port PeerAddress:Port Process
        let state = parts[0];
        if state != "LISTEN" { continue; }

        let local = parts[3];
        // Extract port from address (last colon-separated part)
        let (address, port_str) = match local.rfind(':') {
            Some(pos) => (&local[..pos], &local[pos + 1..]),
            None => continue,
        };
        let port: u16 = match port_str.parse() {
            Ok(p) => p,
            Err(_) => continue,
        };

        // Strip zone ID suffix (e.g. %lo, %eth0)
        let address = match address.find('%') {
            Some(pos) => &address[..pos],
            None => address,
        };

        // Determine protocol from address
        let protocol = if address.contains(':') { "tcp6" } else { "tcp" }.to_string();

        // Parse process info: users:(("name",pid=1234,fd=3))
        let process_info = parts[5..].join(" ");
        let (process, pid) = parse_process_info(&process_info);

        ports.push(PortInfo {
            port,
            protocol,
            address: address.to_string(),
            process,
            pid,
        });
    }
    ports
}

fn parse_netstat_output(output: &str) -> Vec<PortInfo> {
    let mut ports = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 7 { continue; }

        let proto = parts[0];
        if !proto.starts_with("tcp") { continue; }

        let state = parts[5];
        if state != "LISTEN" { continue; }

        let local = parts[3];
        let (address, port_str) = match local.rfind(':') {
            Some(pos) => (&local[..pos], &local[pos + 1..]),
            None => continue,
        };
        let port: u16 = match port_str.parse() {
            Ok(p) => p,
            Err(_) => continue,
        };

        // Strip zone ID suffix
        let address = match address.find('%') {
            Some(pos) => &address[..pos],
            None => address,
        };

        // netstat: PID/ProgramName
        let pid_program = parts[6];
        let (pid, process) = if let Some(slash_pos) = pid_program.find('/') {
            let pid_str = &pid_program[..slash_pos];
            let name = &pid_program[slash_pos + 1..];
            (pid_str.parse::<u32>().unwrap_or(0), name.to_string())
        } else {
            (0, pid_program.to_string())
        };

        ports.push(PortInfo {
            port,
            protocol: proto.to_string(),
            address: address.to_string(),
            process,
            pid,
        });
    }
    ports
}

fn parse_process_info(info: &str) -> (String, u32) {
    // Format: users:(("name",pid=1234,fd=3))
    let default = ("—".to_string(), 0);
    let start = match info.find('"') {
        Some(s) => s + 1,
        None => return default,
    };
    let end = match info[start..].find('"') {
        Some(e) => start + e,
        None => return default,
    };
    let name = &info[start..end];

    let pid = info
        .find("pid=")
        .and_then(|pos| {
            let rest = &info[pos + 4..];
            rest.split(|c: char| !c.is_ascii_digit()).next()
        })
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);

    (name.to_string(), pid)
}

/// Enrich ports missing process info using lsof output
fn enrich_with_lsof(ports: &mut [PortInfo], lsof_output: &str) {
    // lsof output: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
    // We extract: PID, COMMAND, and the local port from the NAME column
    for line in lsof_output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("COMMAND") { continue; }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 9 { continue; }

        let command = parts[0];
        let pid: u32 = parts[1].parse().unwrap_or(0);
        // NAME column is last, format: *:port or addr:port
        let name = parts.last().unwrap_or(&"");
        let port_str = name.rfind(':').map(|i| &name[i + 1..]).unwrap_or("");
        let port: u16 = match port_str.parse() {
            Ok(p) => p,
            Err(_) => continue,
        };

        for p in ports.iter_mut() {
            if p.port == port && (p.process == "—" || p.process.is_empty()) {
                p.process = command.to_string();
                p.pid = pid;
            }
        }
    }
}

/// Enrich ports with Docker container names
fn enrich_with_docker(ports: &mut [PortInfo], docker_output: &str) {
    // docker ps format: "container_name|0.0.0.0:8080->80/tcp, 0.0.0.0:9090->9090/tcp"
    for line in docker_output.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }

        let (name, port_mappings) = match line.find('|') {
            Some(pos) => (&line[..pos], &line[pos + 1..]),
            None => continue,
        };

        // Parse port mappings: "0.0.0.0:8080->80/tcp, 0.0.0.0:9090->9090/tcp"
        for mapping in port_mappings.split(',') {
            let mapping = mapping.trim();
            // Extract host port from "0.0.0.0:8080->80/tcp"
            let arrow_pos = match mapping.find("->") {
                Some(p) => p,
                None => continue,
            };
            let host_part = &mapping[..arrow_pos];
            let host_port_str = match host_part.rfind(':') {
                Some(i) => &host_part[i + 1..],
                None => continue,
            };
            let host_port: u16 = match host_port_str.parse() {
                Ok(p) => p,
                Err(_) => continue,
            };

            for p in ports.iter_mut() {
                if p.port == host_port && (p.process == "—" || p.process.is_empty()) {
                    p.process = format!("docker:{}", name);
                }
            }
        }
    }
}

#[tauri::command]
pub async fn fetch_server_ports(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<PortInfo>, String> {
    info!("[PortMonitor] Fetching ports for server: {}", id);

    let server = {
        let data = state.data.lock().map_err(|err| err.to_string())?;
        data.servers
            .iter()
            .find(|server| server.id == id)
            .cloned()
            .ok_or_else(|| "Server not found")?
    };

    if !matches!(server.os_type, OsType::Linux) {
        return Err("当前版本仅支持 Linux 服务器端口监测".to_string());
    }

    let connection = resolve_transfer_server(&state, &id)?;

    tauri::async_runtime::spawn_blocking(move || {
        // Step 1: Get listening ports — try sudo first, then fallback
        let port_cmd = r#"
            _ss_out=$(sudo -n ss -tlnp 2>/dev/null)
            if printf '%s' "$_ss_out" | grep -q '^State'; then
                printf '%s' "$_ss_out"
            else
                ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null
            fi
        "#;
        let port_output = ssh_client::run_ssh_exec_blocking(
            &connection,
            port_cmd,
            "fetch server ports",
        )?;

        let mut ports = if port_output.trim_start().starts_with("Proto") {
            parse_netstat_output(&port_output)
        } else {
            parse_ss_output(&port_output)
        };

        // Step 2: Enrich ports missing process info with sudo lsof
        let empty_ports: Vec<u16> = ports.iter()
            .filter(|p| p.process == "—" || p.process.is_empty())
            .map(|p| p.port)
            .collect();

        if !empty_ports.is_empty() {
            // Build: lsof -i :53 -i :22 -i :445 -P -n -sTCP:LISTEN
            let port_args: String = empty_ports.iter()
                .map(|p| format!("-i :{}", p))
                .collect::<Vec<_>>()
                .join(" ");
            let lsof_cmd = format!(
                "sudo -n lsof {} -P -n -sTCP:LISTEN 2>/dev/null || lsof {} -P -n -sTCP:LISTEN 2>/dev/null",
                port_args, port_args
            );
            if let Ok(lsof_output) = ssh_client::run_ssh_exec_blocking(
                &connection,
                &lsof_cmd,
                "enrich ports with lsof",
            ) {
                enrich_with_lsof(&mut ports, &lsof_output);
            }
        }

        // Step 3: Enrich with Docker container info
        if let Ok(docker_output) = ssh_client::run_ssh_exec_blocking(
            &connection,
            "docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null",
            "get docker port mappings",
        ) {
            enrich_with_docker(&mut ports, &docker_output);
        }

        Ok(ports)
    })
    .await
    .map_err(|err| err.to_string())?
}

// ---- Docker management ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub ports: String,
    pub created: String,
}

#[tauri::command]
pub async fn fetch_docker_containers(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<DockerContainer>, String> {
    let connection = resolve_transfer_server(&state, &id)?;

    tauri::async_runtime::spawn_blocking(move || {
        let output = ssh_client::run_ssh_exec_blocking(
            &connection,
            "docker ps -a --format '{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.State}}\\t{{.Ports}}\\t{{.CreatedAt}}' 2>/dev/null",
            "fetch docker containers",
        )?;
        let mut containers = Vec::new();
        for line in output.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 7 { continue; }
            containers.push(DockerContainer {
                id: parts[0].to_string(),
                name: parts[1].to_string(),
                image: parts[2].to_string(),
                status: parts[3].to_string(),
                state: parts[4].to_string(),
                ports: parts[5].to_string(),
                created: parts[6].to_string(),
            });
        }
        Ok(containers)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn docker_container_action(
    state: State<'_, AppState>,
    id: String,
    container_id: String,
    action: String,
) -> Result<String, String> {
    if !["start", "stop", "restart", "pause", "unpause"].contains(&action.as_str()) {
        return Err(format!("Invalid action: {}", action));
    }
    let connection = resolve_transfer_server(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let cmd = format!("sudo -n docker {} {} 2>&1", action, container_id);
        ssh_client::run_ssh_exec_blocking(&connection, &cmd, &format!("docker {} container", action))
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn fetch_docker_logs(
    state: State<'_, AppState>,
    id: String,
    container_id: String,
    tail: u32,
) -> Result<String, String> {
    let connection = resolve_transfer_server(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let cmd = format!("docker logs --tail {} {} 2>&1", tail, container_id);
        ssh_client::run_ssh_exec_blocking(&connection, &cmd, "fetch docker logs")
    })
    .await
    .map_err(|err| err.to_string())?
}

// ---- System service management ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemService {
    pub name: String,
    pub display_name: String,
    pub active: String,
    pub sub: String,
    pub description: String,
}

#[tauri::command]
pub async fn fetch_system_services(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<SystemService>, String> {
    let connection = resolve_transfer_server(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let output = ssh_client::run_ssh_exec_blocking(
            &connection,
            "systemctl list-units --type=service --all --no-pager --plain --no-legend 2>/dev/null",
            "fetch system services",
        )?;
        let mut services = Vec::new();
        for line in output.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 4 { continue; }
            let full_name = parts[0]; // e.g. "nginx.service"
            let active = parts[2].to_string();
            let sub = parts[3].to_string();
            let description = if parts.len() > 4 { parts[4..].join(" ") } else { String::new() };
            let display_name = full_name.strip_suffix(".service").unwrap_or(full_name).to_string();
            services.push(SystemService {
                name: full_name.to_string(),
                display_name,
                active,
                sub,
                description,
            });
        }
        Ok(services)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn system_service_action(
    state: State<'_, AppState>,
    id: String,
    service_name: String,
    action: String,
) -> Result<String, String> {
    if !["start", "stop", "restart", "enable", "disable", "status"].contains(&action.as_str()) {
        return Err(format!("Invalid action: {}", action));
    }
    let connection = resolve_transfer_server(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let cmd = if action == "status" {
            format!("sudo -n systemctl {} {} 2>&1", action, service_name)
        } else {
            format!("sudo -n systemctl {} {} 2>&1 && echo 'OK'", action, service_name)
        };
        ssh_client::run_ssh_exec_blocking(&connection, &cmd, &format!("systemctl {} service", action))
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn fetch_service_logs(
    state: State<'_, AppState>,
    id: String,
    service_name: String,
    tail: u32,
) -> Result<String, String> {
    let connection = resolve_transfer_server(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let cmd = format!("sudo -n journalctl -u {} --no-pager -n {} 2>&1", service_name, tail);
        ssh_client::run_ssh_exec_blocking(&connection, &cmd, "fetch service logs")
    })
    .await
    .map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::util::{METRICS_OUTPUT_START, METRICS_OUTPUT_END};

    #[test]
    fn parse_metrics_output_extracts_disk_and_load() {
        let output = format!(
            "prefix\n{start}\ncpu_usage=12.5\nmemory_used_mb=1024\nmemory_total_mb=4096\nmemory_usage=25.0\ndisk_usage=41.0\nload_1=0.5\nload_5=0.3\nload_15=0.2\ngpu_status=unsupported\n{end}\nsuffix",
            start = METRICS_OUTPUT_START,
            end = METRICS_OUTPUT_END,
        );

        let snapshot = parse_metrics_output(&output).expect("metrics should parse");
        assert_eq!(snapshot.cpu_usage, 12.5);
        assert_eq!(snapshot.memory_used_mb, 1024);
        assert_eq!(snapshot.disk_usage, 41.0);
        assert_eq!(snapshot.load_1, 0.5);
        assert_eq!(snapshot.load_15, 0.2);
        assert!(snapshot.gpu.is_none());
        assert_eq!(snapshot.gpu_status, "unsupported");
    }
}
