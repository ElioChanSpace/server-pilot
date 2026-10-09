// 独立工具箱命令：进程管理、磁盘分析、系统信息、网络连接、日志跟踪、定时任务等。
// 所有远端命令均通过 run_ssh_exec 执行（带超时/输出上限），用户输入做白名单校验。

use crate::servers::application::AppState;
use crate::servers::domain::MetricSample;
use crate::servers::infrastructure::StateDatabase;
use serde::Serialize;
use tauri::State;

use super::file_transfer::resolve_transfer_server;
use super::ssh_client;
use super::util::shell_quote;

// ---- Process manager ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: u32,
    pub user: String,
    pub cpu: f64,
    pub mem: f64,
    pub rss_kb: u64,
    pub stat: String,
    pub etime: String,
    pub command: String,
}

fn parse_ps_output(output: &str) -> Vec<ProcessInfo> {
    let mut processes = Vec::new();
    for line in output.lines().skip(1) {
        // ps aligns columns with runs of spaces — split off the 8 fixed
        // whitespace-separated fields and keep the rest as the command.
        let mut fixed: [&str; 8] = [""; 8];
        let mut rest = line;
        let mut ok = true;
        for slot in fixed.iter_mut() {
            let trimmed = rest.trim_start();
            let end = trimmed
                .find(char::is_whitespace)
                .unwrap_or(trimmed.len());
            if end == 0 {
                ok = false;
                break;
            }
            *slot = &trimmed[..end];
            rest = &trimmed[end..];
        }
        if !ok {
            continue;
        }
        let Ok(pid) = fixed[0].parse::<u32>() else { continue };
        processes.push(ProcessInfo {
            pid,
            ppid: fixed[1].parse().unwrap_or(0),
            user: fixed[2].to_string(),
            cpu: fixed[3].parse().unwrap_or(0.0),
            mem: fixed[4].parse().unwrap_or(0.0),
            rss_kb: fixed[5].parse().unwrap_or(0),
            stat: fixed[6].to_string(),
            etime: fixed[7].to_string(),
            command: rest.trim().to_string(),
        });
    }
    processes
}

#[tauri::command(async)]
pub async fn fetch_processes(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<ProcessInfo>, String> {
    let connection = resolve_transfer_server(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let output = ssh_client::run_ssh_exec_blocking(
            &connection,
            "ps -eo pid,ppid,user,%cpu,%mem,rss,stat,etime,command 2>/dev/null | head -n 500",
            "fetch processes",
        )?;
        Ok(parse_ps_output(&output))
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command(async)]
pub async fn process_action(
    state: State<'_, AppState>,
    id: String,
    pid: u32,
    action: String,
) -> Result<String, String> {
    // Signal whitelist — pid is a u32 so no interpolation risk.
    let signal = match action.as_str() {
        "term" => "TERM",
        "kill" => "KILL",
        "stop" => "STOP",
        "cont" => "CONT",
        "hup" => "HUP",
        other => return Err(format!("Unsupported action: {}", other)),
    };
    let connection = resolve_transfer_server(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let cmd = format!("kill -s {} {} 2>&1", signal, pid);
        ssh_client::run_ssh_exec_blocking(&connection, &cmd, "process action")?;
        Ok(format!("已向进程 {} 发送 SIG{}", pid, signal))
    })
    .await
    .map_err(|err| err.to_string())?
}

// ---- Disk analysis ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    pub filesystem: String,
    pub size: String,
    pub used: String,
    pub avail: String,
    pub use_percent: u8,
    pub mount: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirUsage {
    pub path: String,
    pub name: String,
    pub size_kb: u64,
}

fn parse_df_output(output: &str) -> Vec<DiskUsage> {
    let mut disks = Vec::new();
    for line in output.lines().skip(1) {
        let mut fields = line.split_whitespace();
        let (Some(fs), Some(size), Some(used), Some(avail), Some(usepct), Some(mount)) = (
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
        ) else {
            continue;
        };
        disks.push(DiskUsage {
            filesystem: fs.to_string(),
            size: size.to_string(),
            used: used.to_string(),
            avail: avail.to_string(),
            use_percent: usepct.trim_end_matches('%').parse().unwrap_or(0),
            mount: mount.to_string(),
        });
    }
    disks
}

fn parse_du_output(output: &str, parent: &str) -> Vec<DirUsage> {
    let mut entries: Vec<DirUsage> = Vec::new();
    for line in output.lines() {
        let mut fields = line.splitn(2, char::is_whitespace);
        let (Some(size_kb), Some(path)) = (fields.next(), fields.next()) else {
            continue;
        };
        let Ok(size_kb) = size_kb.parse::<u64>() else { continue };
        let path = path.trim();
        // Skip the summary line for the parent directory itself
        if path.trim_end_matches('/') == parent.trim_end_matches('/') {
            continue;
        }
        let name = path
            .rsplit('/')
            .next()
            .filter(|n| !n.is_empty())
            .unwrap_or(path)
            .to_string();
        entries.push(DirUsage {
            path: path.to_string(),
            name,
            size_kb,
        });
    }
    entries.sort_by(|a, b| b.size_kb.cmp(&a.size_kb));
    entries.truncate(50);
    entries
}

#[tauri::command(async)]
pub async fn fetch_disk_usage(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<DiskUsage>, String> {
    let connection = resolve_transfer_server(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let output = ssh_client::run_ssh_exec_blocking(
            &connection,
            "df -hP -x tmpfs -x devtmpfs -x squashfs 2>/dev/null || df -hP 2>/dev/null",
            "fetch disk usage",
        )?;
        Ok(parse_df_output(&output))
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command(async)]
pub async fn fetch_dir_usage(
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> Result<Vec<DirUsage>, String> {
    if path.trim().is_empty() {
        return Err("路径不能为空".to_string());
    }
    let connection = resolve_transfer_server(&state, &id)?;
    let quoted = shell_quote(path.trim().trim_end_matches('/'));
    let parent = path.trim().trim_end_matches('/').to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let cmd = format!(
            "du -x -k -d 1 -- {} 2>/dev/null | sort -rn | head -n 60",
            quoted
        );
        let output = ssh_client::run_ssh_exec_blocking(&connection, &cmd, "fetch directory usage")?;
        Ok(parse_du_output(&output, &parent))
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command(async)]
pub async fn fetch_large_files(
    state: State<'_, AppState>,
    id: String,
    path: String,
    min_size_mb: u32,
) -> Result<Vec<DirUsage>, String> {
    if path.trim().is_empty() {
        return Err("路径不能为空".to_string());
    }
    let min_mb = min_size_mb.clamp(1, 100_000);
    let connection = resolve_transfer_server(&state, &id)?;
    let quoted = shell_quote(path.trim().trim_end_matches('/'));
    tauri::async_runtime::spawn_blocking(move || {
        let cmd = format!(
            "find -- {} -xdev -type f -size +{}M -printf '%s\\t%p\\n' 2>/dev/null | sort -rn | head -n 40",
            quoted, min_mb
        );
        let output = ssh_client::run_ssh_exec_blocking(&connection, &cmd, "fetch large files")?;
        let mut files: Vec<DirUsage> = output
            .lines()
            .filter_map(|line| {
                let (size, path) = line.split_once('\t')?;
                let size_kb = size.parse::<u64>().ok()? / 1024;
                let name = path.rsplit('/').next().unwrap_or(path).to_string();
                Some(DirUsage {
                    path: path.to_string(),
                    name,
                    size_kb,
                })
            })
            .collect();
        files.sort_by(|a, b| b.size_kb.cmp(&a.size_kb));
        Ok(files)
    })
    .await
    .map_err(|err| err.to_string())?
}

// ---- System info ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub hostname: String,
    pub kernel: String,
    pub arch: String,
    pub distro: String,
    pub cpu_model: String,
    pub cpu_cores: u32,
    pub load1: f64,
    pub load5: f64,
    pub load15: f64,
    pub procs_running: u32,
    pub uptime_seconds: u64,
    pub mem_total_kb: u64,
    pub mem_used_kb: u64,
    pub mem_avail_kb: u64,
    pub swap_total_kb: u64,
    pub swap_used_kb: u64,
}

const SYSINFO_COMMAND: &str = r#"{ \
echo "hostname=$(hostname 2>/dev/null)"; \
echo "kernel=$(uname -sr 2>/dev/null)"; \
echo "arch=$(uname -m 2>/dev/null)"; \
echo "distro=$(grep -m1 PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d '\"')"; \
echo "cpu_model=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed 's/^ *//')"; \
echo "cpu_cores=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null)"; \
awk '{print "load1="$1; print "load5="$2; print "load15="$3; split($4,p,"/"); print "procs_running="p[1]}' /proc/loadavg 2>/dev/null; \
awk '{print "uptime_seconds="$1}' /proc/uptime 2>/dev/null; \
awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}/MemFree/{f=$2}/MemFree:/{}/SwapTotal/{st=$2}/SwapFree/{sf=$2}END{print "mem_total_kb="t; print "mem_avail_kb="a; print "mem_used_kb="(t-a); print "swap_total_kb="st; print "swap_used_kb="(st-sf)}' /proc/meminfo 2>/dev/null; \
} 2>/dev/null"#;

fn parse_kv_output(output: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for line in output.lines() {
        if let Some((key, value)) = line.split_once('=') {
            map.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    map
}

#[tauri::command(async)]
pub async fn fetch_system_info(
    state: State<'_, AppState>,
    id: String,
) -> Result<SystemInfo, String> {
    let connection = resolve_transfer_server(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let output = ssh_client::run_ssh_exec_blocking(&connection, SYSINFO_COMMAND, "fetch system info")?;
        let kv = parse_kv_output(&output);
        let get = |key: &str| kv.get(key).cloned().unwrap_or_default();
        let num = |key: &str| kv.get(key).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
        Ok(SystemInfo {
            hostname: get("hostname"),
            kernel: get("kernel"),
            arch: get("arch"),
            distro: get("distro"),
            cpu_model: get("cpu_model"),
            cpu_cores: num("cpu_cores") as u32,
            load1: get("load1").parse().unwrap_or(0.0),
            load5: get("load5").parse().unwrap_or(0.0),
            load15: get("load15").parse().unwrap_or(0.0),
            procs_running: num("procs_running") as u32,
            uptime_seconds: num("uptime_seconds"),
            mem_total_kb: num("mem_total_kb"),
            mem_used_kb: num("mem_used_kb"),
            mem_avail_kb: num("mem_avail_kb"),
            swap_total_kb: num("swap_total_kb"),
            swap_used_kb: num("swap_used_kb"),
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

// ---- Network connections ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetConnection {
    pub proto: String,
    pub state: String,
    pub recv_q: u64,
    pub send_q: u64,
    pub local: String,
    pub peer: String,
    pub process: String,
    pub pid: Option<u32>,
}

fn parse_ss_output(output: &str) -> Vec<NetConnection> {
    let mut connections = Vec::new();
    for line in output.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 6 {
            continue;
        }
        // ss -tanup: Netid State Recv-Q Send-Q Local Peer [Process]
        let (proto, state, local, peer) = (fields[0], fields[1], fields[4], fields[5]);
        let proc_field = fields.get(6).copied().unwrap_or("");
        // users:(("sshd",pid=123,fd=3)) — extract name and pid
        let process = proc_field
            .split('"')
            .nth(1)
            .unwrap_or("")
            .to_string();
        let pid = proc_field
            .split("pid=")
            .nth(1)
            .and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next())
            .and_then(|s| s.parse::<u32>().ok());
        connections.push(NetConnection {
            proto: proto.to_string(),
            state: state.to_string(),
            recv_q: fields[2].parse().unwrap_or(0),
            send_q: fields[3].parse().unwrap_or(0),
            local: local.to_string(),
            peer: peer.to_string(),
            process,
            pid,
        });
    }
    connections
}

#[tauri::command(async)]
pub async fn fetch_network_connections(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<NetConnection>, String> {
    let connection = resolve_transfer_server(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let output = ssh_client::run_ssh_exec_blocking(
            &connection,
            "ss -tanup 2>/dev/null",
            "fetch network connections",
        )?;
        if output.trim().is_empty() {
            return Err("服务器未返回网络连接信息（需要 ss 命令）".to_string());
        }
        Ok(parse_ss_output(&output))
    })
    .await
    .map_err(|err| err.to_string())?
}

// ---- Real-time log tail ----

const LOG_CHUNK_LIMIT: usize = 200 * 1024;
const LOG_INITIAL_BACK: u64 = 64 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogChunk {
    pub content: String,
    pub next_offset: u64,
    pub file_size: u64,
}

#[tauri::command(async)]
pub async fn read_log_chunk(
    state: State<'_, AppState>,
    id: String,
    path: String,
    offset: Option<u64>,
) -> Result<LogChunk, String> {
    if path.trim().is_empty() {
        return Err("日志路径不能为空".to_string());
    }
    let connection = resolve_transfer_server(&state, &id)?;
    let quoted = shell_quote(path.trim());
    tauri::async_runtime::spawn_blocking(move || {
        // offset = None → first read: jump to the last 64KB of the file.
        // offset = Some(n) → incremental read from byte n (1-based tail).
        let cmd = match offset {
            None => format!(
                "SIZE=$(stat -c %s -- {p} 2>/dev/null || echo 0); \
                 OFF=$SIZE; if [ \"$OFF\" -gt {back} ]; then OFF=$((SIZE-{back})); fi; \
                 echo \"__META__${{SIZE}}_${{OFF}}\"; tail -c +$((OFF+1)) -- {p} 2>/dev/null | head -c {limit}",
                p = quoted,
                back = LOG_INITIAL_BACK,
                limit = LOG_CHUNK_LIMIT,
            ),
            Some(offset) => format!(
                "SIZE=$(stat -c %s -- {p} 2>/dev/null || echo 0); \
                 echo \"__SIZE__${{SIZE}}\"; tail -c +{off} -- {p} 2>/dev/null | head -c {limit}",
                p = quoted,
                off = offset + 1,
                limit = LOG_CHUNK_LIMIT,
            ),
        };
        let output = ssh_client::run_ssh_exec_blocking(&connection, &cmd, "read log chunk")?;

        let (file_size, base_offset, content) = match offset {
            None => {
                // First line is __META__<size>_<offset>
                let (meta, rest) = output
                    .split_once('\n')
                    .ok_or("读取日志失败：返回内容异常")?;
                let meta = meta.trim().trim_start_matches("__META__");
                let (size_str, off_str) = meta.split_once('_').unwrap_or(("0", "0"));
                (
                    size_str.parse::<u64>().unwrap_or(0),
                    off_str.parse::<u64>().unwrap_or(0),
                    rest.to_string(),
                )
            }
            Some(offset) => {
                let size = output
                    .lines()
                    .next()
                    .and_then(|l| l.strip_prefix("__SIZE__"))
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(0);
                // The size echo is followed by the tail output
                let content = match output.find('\n') {
                    Some(idx) => output[idx + 1..].to_string(),
                    None => String::new(),
                };
                (size, offset, content)
            }
        };

        let next_offset = base_offset + content.len() as u64;
        Ok(LogChunk {
            content,
            next_offset,
            file_size,
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

// ---- Scheduled tasks (cron + systemd timers) ----

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CronJob {
    pub source: String,
    pub schedule: String,
    pub user: String,
    pub command: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SystemdTimer {
    pub unit: String,
    pub activates: String,
    pub next: String,
    pub left: String,
}

fn parse_cron_sections(output: &str) -> Vec<CronJob> {
    let mut jobs = Vec::new();
    let mut source = String::new();
    for line in output.lines() {
        if let Some(src) = line.trim().strip_prefix("__SRC__") {
            source = src.trim().to_string();
            continue;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        // Skip env assignments (KEY=value) in /etc/crontab & cron.d
        if !trimmed.starts_with('@') && trimmed.split_whitespace().next().is_some_and(|f| f.contains('=') && !f.starts_with(|c: char| c.is_ascii_digit())) {
            continue;
        }
        let is_system = source.starts_with("/etc/");
        let mut fields = trimmed.split_whitespace();
        let schedule = if trimmed.starts_with('@') {
            fields.next().unwrap_or("").to_string()
        } else {
            (0..5).filter_map(|_| fields.next()).collect::<Vec<_>>().join(" ")
        };
        if schedule.is_empty() {
            continue;
        }
        let user = if is_system {
            fields.next().unwrap_or("-").to_string()
        } else {
            "-".to_string()
        };
        let command = fields.collect::<Vec<_>>().join(" ");
        if command.is_empty() {
            continue;
        }
        jobs.push(CronJob {
            source: source.clone(),
            schedule,
            user,
            command,
        });
    }
    jobs
}

fn parse_timers_output(output: &str) -> Vec<SystemdTimer> {
    let mut timers = Vec::new();
    for line in output.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 2 {
            continue;
        }
        // UNIT and ACTIVATES are the last two columns; everything before is
        // NEXT/LEFT/LAST/PASSED display text (dates contain spaces).
        let activates = fields[fields.len() - 1].to_string();
        let unit = fields[fields.len() - 2].to_string();
        if !unit.ends_with(".timer") {
            continue;
        }
        let head = fields[..fields.len() - 2].join(" ");
        // "next left" — next is usually the leading date/time, left the duration
        // right before the unit column. Split loosely on double-space if present.
        let (next, left) = match head.rsplit_once(' ') {
            Some((n, l)) => (n.trim().to_string(), l.trim().to_string()),
            None => (head, String::new()),
        };
        timers.push(SystemdTimer {
            unit,
            activates,
            next,
            left,
        });
    }
    timers
}

#[tauri::command(async)]
pub async fn fetch_cron_jobs(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<CronJob>, String> {
    let connection = resolve_transfer_server(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let token = uuid::Uuid::new_v4().to_string();
        let marker = format!("__SRC_{}__", token);
        let cmd = format!(
            "{{ echo \"{m}user-crontab\"; crontab -l 2>/dev/null; \
               echo \"{m}/etc/crontab\"; cat /etc/crontab 2>/dev/null; \
               for f in /etc/cron.d/*; do echo \"{m}$f\"; cat \"$f\" 2>/dev/null; done; \
               echo \"{m}root-crontab\"; sudo -n crontab -l 2>/dev/null; }} | sed 's/^{m}/__SRC__/'",
            m = marker
        );
        let output = ssh_client::run_ssh_exec_blocking(&connection, &cmd, "fetch cron jobs")?;
        Ok(parse_cron_sections(&output))
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command(async)]
pub async fn fetch_systemd_timers(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<SystemdTimer>, String> {
    let connection = resolve_transfer_server(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let output = ssh_client::run_ssh_exec_blocking(
            &connection,
            "systemctl list-timers --all --no-pager --no-legend 2>/dev/null",
            "fetch systemd timers",
        )?;
        Ok(parse_timers_output(&output))
    })
    .await
    .map_err(|err| err.to_string())?
}

// ---- Metric samples (resource history) ----

#[tauri::command(async)]
pub fn add_metric_samples(
    database: State<'_, StateDatabase>,
    samples: Vec<MetricSample>,
) -> Result<(), String> {
    database.add_metric_samples(&samples)
}

#[tauri::command(async)]
pub fn get_metric_history(
    database: State<'_, StateDatabase>,
    server_id: String,
    since_ms: u64,
    limit: Option<u32>,
) -> Result<Vec<MetricSample>, String> {
    database.metric_history(&server_id, since_ms, limit.unwrap_or(2000).clamp(1, 10_000))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ps_output_extracts_processes() {
        let output = "    PID    PPID USER     %CPU %MEM    RSS STAT ELAPSED COMMAND\n\
                      1       0 root      0.1  0.5  12345 Ss   1-02:03 /sbin/init\n\
                      42      1 www       5.2  2.1  98765 R    00:10 nginx: worker";
        let processes = parse_ps_output(output);
        assert_eq!(processes.len(), 2);
        assert_eq!(processes[0].pid, 1);
        assert_eq!(processes[0].user, "root");
        assert_eq!(processes[1].command, "nginx: worker");
        assert_eq!(processes[1].cpu, 5.2);
    }

    #[test]
    fn parse_df_output_extracts_mounts() {
        let output = "Filesystem      Size  Used Avail Use% Mounted on\n\
                      /dev/vda1        40G   12G   26G  32% /\n\
                      /dev/vdb1       100G   80G   20G  80% /data";
        let disks = parse_df_output(output);
        assert_eq!(disks.len(), 2);
        assert_eq!(disks[0].mount, "/");
        assert_eq!(disks[0].use_percent, 32);
        assert_eq!(disks[1].use_percent, 80);
    }

    #[test]
    fn parse_du_output_skips_parent_and_sorts() {
        let output = "12000\t/var/log\n\
                      300\t/var/cache\n\
                      50000\t/var";
        let entries = parse_du_output(output, "/var");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "/var/log");
        assert_eq!(entries[0].name, "log");
        assert_eq!(entries[1].name, "cache");
    }

    #[test]
    fn parse_kv_output_extracts_fields() {
        let output = "hostname=web-01\nkernel=Linux 6.1.0\nmem_total_kb=8000000\nmalformed line\n";
        let kv = parse_kv_output(output);
        assert_eq!(kv.get("hostname").unwrap(), "web-01");
        assert_eq!(kv.get("kernel").unwrap(), "Linux 6.1.0");
        assert_eq!(kv.len(), 3);
    }

    #[test]
    fn parse_ss_output_extracts_connections() {
        let output = "Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process\n\
                      tcp   LISTEN 0      128    0.0.0.0:22          0.0.0.0:*          users:((\"sshd\",pid=812,fd=3))\n\
                      tcp   ESTAB  0      0      10.0.0.5:22         203.0.113.7:51422  users:((\"sshd\",pid=1934,fd=4))\n\
                      udp   UNCONN 0      0      127.0.0.1:323       0.0.0.0:*";
        let conns = parse_ss_output(output);
        assert_eq!(conns.len(), 3);
        assert_eq!(conns[0].proto, "tcp");
        assert_eq!(conns[0].state, "LISTEN");
        assert_eq!(conns[0].process, "sshd");
        assert_eq!(conns[0].pid, Some(812));
        assert_eq!(conns[1].peer, "203.0.113.7:51422");
        assert_eq!(conns[2].pid, None);
    }

    #[test]
    fn parse_cron_sections_handles_sources() {
        let output = "__SRC__user-crontab\n\
                      0 3 * * * /home/u/backup.sh\n\
                      @reboot /home/u/start.sh\n\
                      __SRC__/etc/crontab\n\
                      SHELL=/bin/sh\n\
                      17 * * * * root /usr/bin/run-parts /etc/cron.hourly\n\
                      __SRC__root-crontab\n\
                      # comment line";
        let jobs = parse_cron_sections(output);
        assert_eq!(jobs.len(), 3);
        assert_eq!(jobs[0].schedule, "0 3 * * *");
        assert_eq!(jobs[0].command, "/home/u/backup.sh");
        assert_eq!(jobs[1].schedule, "@reboot");
        assert_eq!(jobs[2].user, "root");
        assert_eq!(jobs[2].source, "/etc/crontab");
    }

    #[test]
    fn parse_timers_output_extracts_units() {
        let output = "Wed 2026-10-09 10:00:00 CST  43min left  Wed 2026-10-09 09:00:00 CST  4min ago   apt-daily.timer              apt-daily.service\n\
                      n/a                          n/a         n/a                          n/a        fstrim.timer                 fstrim.service";
        let timers = parse_timers_output(output);
        assert_eq!(timers.len(), 2);
        assert_eq!(timers[0].unit, "apt-daily.timer");
        assert_eq!(timers[0].activates, "apt-daily.service");
        assert_eq!(timers[1].unit, "fstrim.timer");
    }
}
