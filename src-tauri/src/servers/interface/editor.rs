use crate::servers::application::AppState;
use serde::Serialize;
use std::path::Path;
use tauri::State;

use super::file_transfer::resolve_transfer_server;
use super::ssh_client;
use super::util::shell_quote;

/// Maximum file size for inline editing (512 KiB).
const EDITOR_FILE_SIZE_LIMIT: usize = 512 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub raw: String,
    pub language: String,
    pub line_count: usize,
    pub file_size: usize,
}

fn detect_language(path: &str) -> &'static str {
    // Check filename patterns first (more specific)
    let filename = Path::new(path)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match filename.as_str() {
        "dockerfile" | "dockerfile.dev" => return "dockerfile",
        "makefile" | "gnumakefile" => return "makefile",
        "cmakelists.txt" => return "cmake",
        ".gitignore" | ".gitattributes" => return "gitignore",
        ".editorconfig" => return "ini",
        "vagrantfile" => return "ruby",
        "gemfile" | "rakefile" => return "ruby",
        "justfile" => return "just",
        "nginx.conf" => return "nginx",
        _ => {}
    }

    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "xml" | "html" | "htm" => "html",
        "css" | "scss" | "sass" | "less" => "css",
        "js" | "mjs" | "cjs" => "javascript",
        "ts" | "tsx" => "typescript",
        "jsx" => "jsx",
        "py" | "pyw" => "python",
        "rb" => "ruby",
        "rs" => "rust",
        "go" => "go",
        "java" => "java",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" => "cpp",
        "cs" => "csharp",
        "sh" | "bash" | "zsh" => "shellscript",
        "lua" => "lua",
        "sql" => "sql",
        "md" | "markdown" => "markdown",
        "ini" | "cfg" | "service" | "timer" | "socket" | "mount" | "automount" | "target"
        | "swap" | "path" => "ini",
        "env" => "shellscript",
        "dockerfile" => "dockerfile",
        "tf" | "hcl" => "terraform",
        "vim" => "vim",
        "el" => "lisp",
        "ex" | "exs" => "elixir",
        "erl" => "erlang",
        "hs" => "haskell",
        "r" => "r",
        "swift" => "swift",
        "kt" | "kts" => "kotlin",
        "php" => "php",
        "pl" | "pm" => "perl",
        "proto" => "protobuf",
        "graphql" | "gql" => "graphql",
        "conf" => "ini",
        _ => "plain text",
    }
}

#[tauri::command]
pub async fn get_file_content(
    state: State<'_, AppState>,
    server_id: String,
    path: String,
) -> Result<FileContent, String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("文件路径不能为空".to_string());
    }

    let connection = resolve_transfer_server(&state, &server_id)?;

    tauri::async_runtime::spawn_blocking(move || {
        // Single SSH command: check size, then cat if within limit.
        // The size marker embeds a per-request random token so file content can
        // never be mistaken for the marker.
        let token = uuid::Uuid::new_v4().to_string();
        let marker = format!("__SERVER_PILOT_TOO_LARGE_{}__", token);
        let cmd = format!(
            "SIZE=$(stat -c %s -- {p} 2>/dev/null || stat -f %z -- {p} 2>/dev/null); \
             if [ \"$SIZE\" -gt {limit} ] 2>/dev/null; then echo \"{marker}$SIZE\"; else cat -- {p}; fi",
            p = shell_quote(&path),
            limit = EDITOR_FILE_SIZE_LIMIT,
            marker = marker,
        );
        let output = ssh_client::run_ssh_exec_blocking(
            &connection,
            &cmd,
            "read file content",
        )?;

        // Check if file was too large (marker only valid as the first line)
        if let Some(rest) = output.strip_prefix(marker.as_str()) {
            let size_line = rest.split('\n').next().unwrap_or("").trim();
            let size = size_line.parse::<usize>().unwrap_or(0);
            return Err(format!(
                "文件过大（{}），超过内嵌编辑器上限（512KB）。请使用外部编辑器打开。",
                format_file_size(size)
            ));
        }

        let raw = output;

        let language = detect_language(&path);
        // Match JavaScript split("\n").length — include trailing empty segment
        let line_count = raw.split('\n').count();
        let file_size = raw.len();

        // 语法高亮由前端 Monaco 负责（原 syntect html 字段已废弃移除）
        Ok(FileContent {
            raw,
            language: language.to_string(),
            line_count,
            file_size,
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn save_remote_file(
    state: State<'_, AppState>,
    server_id: String,
    path: String,
    content: String,
) -> Result<String, String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("文件路径不能为空".to_string());
    }

    let connection = resolve_transfer_server(&state, &server_id)?;

    tauri::async_runtime::spawn_blocking(move || {
        // Use base64 encoding to safely transfer content through shell
        // This avoids issues with special characters, newlines, etc.
        let encoded = base64_encode(&content);
        let write_cmd = format!("echo '{}' | base64 -d > {}", encoded, shell_quote(&path));

        ssh_client::run_ssh_exec_blocking(&connection, &write_cmd, "save file")?;

        Ok(format!("已保存到 {}", path))
    })
    .await
    .map_err(|err| err.to_string())?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileStat {
    pub size: u64,
    pub mtime: i64,
}

/// Stat a remote file (size + mtime) — used by the editor for conflict
/// detection before saving (the remote file may have changed since load).
#[tauri::command]
pub async fn stat_remote_file(
    state: State<'_, AppState>,
    server_id: String,
    path: String,
) -> Result<RemoteFileStat, String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("文件路径不能为空".to_string());
    }

    let connection = resolve_transfer_server(&state, &server_id)?;

    tauri::async_runtime::spawn_blocking(move || {
        // GNU stat first, BSD stat fallback
        let cmd = format!(
            "stat -c '%s %Y' -- {p} 2>/dev/null || stat -f '%z %m' -- {p} 2>/dev/null",
            p = shell_quote(&path)
        );
        let output = ssh_client::run_ssh_exec_blocking(&connection, &cmd, "stat file")?;
        let mut parts = output.split_whitespace();
        let size = parts
            .next()
            .and_then(|v| v.parse::<u64>().ok())
            .ok_or_else(|| format!("无法获取文件信息: {}", path))?;
        let mtime = parts
            .next()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);
        Ok(RemoteFileStat { size, mtime })
    })
    .await
    .map_err(|err| err.to_string())?
}

fn format_file_size(bytes: usize) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

/// Minimal base64 encoder (no external dependency needed).
fn base64_encode(input: &str) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let bytes = input.as_bytes();
    let mut result = String::with_capacity((bytes.len() + 2) / 3 * 4);

    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };

        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);

        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }

        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_language_by_extension() {
        assert_eq!(detect_language("/etc/nginx/nginx.conf"), "nginx");
        assert_eq!(detect_language("/home/app/main.py"), "python");
        assert_eq!(detect_language("/app/docker-compose.yml"), "yaml");
        assert_eq!(detect_language("/src/main.rs"), "rust");
        assert_eq!(detect_language("/etc/systemd/system/svc.service"), "ini");
    }

    #[test]
    fn detect_language_by_filename() {
        assert_eq!(detect_language("/app/Dockerfile"), "dockerfile");
        assert_eq!(detect_language("/project/Makefile"), "makefile");
        assert_eq!(detect_language("/repo/.gitignore"), "gitignore");
    }

    #[test]
    fn base64_basic() {
        assert_eq!(base64_encode(""), "");
        assert_eq!(base64_encode("f"), "Zg==");
        assert_eq!(base64_encode("fo"), "Zm8=");
        assert_eq!(base64_encode("foo"), "Zm9v");
        assert_eq!(base64_encode("hello world"), "aGVsbG8gd29ybGQ=");
    }

    #[test]
    fn format_file_size_display() {
        assert_eq!(format_file_size(500), "500 B");
        assert_eq!(format_file_size(1536), "1.5 KB");
        assert_eq!(format_file_size(2 * 1024 * 1024), "2.0 MB");
    }
}
