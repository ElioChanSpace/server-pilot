// 独立工具箱命令：进程管理、磁盘分析、系统信息、网络连接、日志跟踪、定时任务等。
// 所有远端命令均通过 run_ssh_exec 执行（带超时/输出上限），用户输入做白名单校验。

use crate::servers::application::AppState;
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
}
