use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyPair {
    pub key_type: String,
    pub public_key: String,
    pub private_key_path: String,
    pub public_key_path: String,
    pub fingerprint: String,
}

fn ssh_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let ssh_dir = home.join(".ssh");
    if !ssh_dir.exists() {
        fs::create_dir_all(&ssh_dir)
            .map_err(|err| format!("创建 .ssh 目录失败: {err}"))?;
        // Set permissions to 700
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&ssh_dir, fs::Permissions::from_mode(0o700))
                .map_err(|err| format!("设置 .ssh 目录权限失败: {err}"))?;
        }
    }
    Ok(ssh_dir)
}

#[tauri::command]
pub fn generate_ssh_key(
    key_type: Option<String>,
    comment: Option<String>,
    passphrase: Option<String>,
) -> Result<SshKeyPair, String> {
    let key_algo = key_type.unwrap_or_else(|| "ed25519".to_string());
    if !matches!(key_algo.as_str(), "ed25519" | "rsa" | "ecdsa") {
        return Err("不支持的密钥类型，支持: ed25519, rsa, ecdsa".to_string());
    }

    let ssh_dir = ssh_dir()?;
    let key_name = format!("id_{}", key_algo);
    let private_key_path = ssh_dir.join(&key_name);
    let public_key_path = ssh_dir.join(format!("{}.pub", key_name));

    // Check if key already exists
    if private_key_path.exists() {
        return Err(format!("密钥文件已存在: {}", private_key_path.display()));
    }

    let comment_str = comment.unwrap_or_else(|| {
        let username = whoami::username().unwrap_or_else(|_| "user".to_string());
        let hostname = hostname::get()
            .map(|h: std::ffi::OsString| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "unknown".to_string());
        format!("{}@{}", username, hostname)
    });

    let mut cmd = Command::new("ssh-keygen");
    cmd.arg("-t").arg(&key_algo);
    cmd.arg("-f").arg(&private_key_path);
    cmd.arg("-C").arg(&comment_str);
    cmd.arg("-N").arg(passphrase.as_deref().unwrap_or(""));

    let output = cmd
        .output()
        .map_err(|err| format!("执行 ssh-keygen 失败: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ssh-keygen 失败: {}", stderr));
    }

    // Set permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&private_key_path, fs::Permissions::from_mode(0o600))
            .map_err(|err| format!("设置私钥权限失败: {err}"))?;
        fs::set_permissions(&public_key_path, fs::Permissions::from_mode(0o644))
            .map_err(|err| format!("设置公钥权限失败: {err}"))?;
    }

    let public_key = fs::read_to_string(&public_key_path)
        .map_err(|err| format!("读取公钥文件失败: {err}"))?;

    // Get fingerprint
    let fp_output = Command::new("ssh-keygen")
        .arg("-lf")
        .arg(&public_key_path)
        .output()
        .map_err(|err| format!("获取指纹失败: {err}"))?;

    let fingerprint = if fp_output.status.success() {
        String::from_utf8_lossy(&fp_output.stdout).trim().to_string()
    } else {
        "无法获取指纹".to_string()
    };

    Ok(SshKeyPair {
        key_type: key_algo,
        public_key: public_key.trim().to_string(),
        private_key_path: private_key_path.to_string_lossy().to_string(),
        public_key_path: public_key_path.to_string_lossy().to_string(),
        fingerprint,
    })
}

#[tauri::command]
pub fn list_ssh_keys() -> Result<Vec<SshKeyPair>, String> {
    let ssh_dir = ssh_dir()?;
    let mut keys = Vec::new();

    let key_types = ["ed25519", "rsa", "ecdsa"];

    for key_type in key_types {
        let private_key_path = ssh_dir.join(format!("id_{}", key_type));
        let public_key_path = ssh_dir.join(format!("id_{}.pub", key_type));

        if private_key_path.exists() && public_key_path.exists() {
            let public_key = fs::read_to_string(&public_key_path)
                .map_err(|err| format!("读取公钥文件失败: {err}"))?;

            let fp_output = Command::new("ssh-keygen")
                .arg("-lf")
                .arg(&public_key_path)
                .output()
                .ok();

            let fingerprint = fp_output
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_else(|| "无法获取指纹".to_string());

            keys.push(SshKeyPair {
                key_type: key_type.to_string(),
                public_key: public_key.trim().to_string(),
                private_key_path: private_key_path.to_string_lossy().to_string(),
                public_key_path: public_key_path.to_string_lossy().to_string(),
                fingerprint,
            });
        }
    }

    Ok(keys)
}

#[tauri::command]
pub fn get_default_ssh_key_path() -> Result<Option<String>, String> {
    let ssh_dir = ssh_dir()?;
    let key_types = ["ed25519", "rsa", "ecdsa"];

    for key_type in key_types {
        let key_path = ssh_dir.join(format!("id_{}", key_type));
        if key_path.exists() {
            return Ok(Some(key_path.to_string_lossy().to_string()));
        }
    }

    Ok(None)
}
