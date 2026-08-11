use crate::servers::application::AppState;
use crate::servers::domain::OsType;
use serde::Serialize;
use tauri::State;

use super::util::{
    run_ssh_command, read_between_markers, SSH_COMMAND_TIMEOUT,
    METRICS_OUTPUT_START, METRICS_OUTPUT_END,
};
use super::file_transfer::resolve_transfer_server;

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
