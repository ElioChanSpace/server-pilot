// 独立工具箱命令：进程管理、磁盘分析、系统信息、网络连接、日志跟踪、定时任务等。
// 所有远端命令均通过 run_ssh_exec 执行（带超时/输出上限），用户输入做白名单校验。

use crate::servers::application::AppState;
use serde::Serialize;
use tauri::State;

use super::file_transfer::resolve_transfer_server;
use super::ssh_client;

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
}
