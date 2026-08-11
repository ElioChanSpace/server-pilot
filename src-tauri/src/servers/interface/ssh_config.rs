use serde::Serialize;
use std::fs;
use std::path::PathBuf;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_config_value_matches_case_insensitively() {
        assert_eq!(ssh_config_value("HostName 1.2.3.4", "hostname"), Some("1.2.3.4"));
        assert_eq!(ssh_config_value("HOST github.com", "host"), Some("github.com"));
        assert_eq!(ssh_config_value("Port 2222", "port"), Some("2222"));
        assert_eq!(ssh_config_value("User root", "hostname"), None);
    }

    #[test]
    fn ssh_config_parser_skips_wildcards_and_invalid_blocks() {
        let path = std::env::temp_dir().join(format!(
            "server-pilot-test-config-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_millis()
        ));
        std::fs::write(
            &path,
            "Host prod\n  HostName 10.0.0.1\n  User deploy\n  Port 2200\n  IdentityFile ~/.ssh/prod\n  ProxyJump jump@bastion\n\nHost *.example.com\n  HostName example.com\n\nHost broken\n  # 无 HostName，应被跳过\n",
        )
        .expect("write config");

        let hosts = parse_ssh_config(Some(path.to_string_lossy().to_string())).expect("parse");
        let _ = std::fs::remove_file(&path);

        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].host, "prod");
        assert_eq!(hosts[0].host_name, "10.0.0.1");
        assert_eq!(hosts[0].user.as_deref(), Some("deploy"));
        assert_eq!(hosts[0].port, Some(2200));
        assert_eq!(hosts[0].identity_file.as_deref(), Some("~/.ssh/prod"));
        assert_eq!(hosts[0].proxy_jump.as_deref(), Some("jump@bastion"));
    }
}
