use crate::servers::application::AppState;
use serde::Serialize;
use std::path::Path;
use syntect::easy::HighlightLines;
use syntect::highlighting::ThemeSet;
use syntect::html::{styled_line_to_highlighted_html, IncludeBackground};
use syntect::parsing::SyntaxSet;
use tauri::State;

use super::file_transfer::resolve_transfer_server;
use super::util::{run_ssh_command, shell_quote, SSH_COMMAND_TIMEOUT};

/// Maximum file size for inline editing (512 KiB).
const EDITOR_FILE_SIZE_LIMIT: usize = 512 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub raw: String,
    pub html: String,
    pub language: String,
    pub line_count: usize,
    pub file_size: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightedCode {
    pub html: String,
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
        "ini" | "cfg" | "service" | "timer" | "socket" | "mount" | "automount" | "target" | "swap" | "path" => "ini",
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

fn highlight_to_html(code: &str, syntax_name: &str, theme_mode: &str) -> Result<String, String> {
    let ss = SyntaxSet::load_defaults_newlines();
    let ts = ThemeSet::load_defaults();

    let syntax = ss
        .find_syntax_by_name(syntax_name)
        .or_else(|| ss.find_syntax_by_extension(syntax_name))
        .unwrap_or_else(|| ss.find_syntax_plain_text());

    let theme_name = if theme_mode == "light" {
        "base16-ocean.light"
    } else {
        "base16-ocean.dark"
    };
    let theme = &ts.themes[theme_name];
    let mut highlighter = HighlightLines::new(syntax, theme);

    let mut html = String::new();
    html.push_str("<pre class=\"editor-code\">");

    for line in code.lines() {
        let ranges = highlighter
            .highlight_line(line, &ss)
            .map_err(|err| format!("高亮失败: {}", err))?;
        let line_html =
            styled_line_to_highlighted_html(&ranges, IncludeBackground::No)
                .map_err(|err| format!("HTML 转换失败: {}", err))?;
        html.push_str(&line_html);
        html.push('\n');
    }

    html.push_str("</pre>");
    Ok(html)
}

#[tauri::command]
pub async fn get_file_content(
    state: State<'_, AppState>,
    server_id: String,
    path: String,
    theme_mode: Option<String>,
) -> Result<FileContent, String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("文件路径不能为空".to_string());
    }

    let connection = resolve_transfer_server(&state, &server_id)?;
    let theme_mode = theme_mode.unwrap_or_else(|| "dark".to_string());

    tauri::async_runtime::spawn_blocking(move || {
        // First check file size
        let size_cmd = format!("stat -c %s -- {} 2>/dev/null || stat -f %z -- {} 2>/dev/null", shell_quote(&path), shell_quote(&path));
        let size_output = run_ssh_command(
            &connection.username,
            &connection.host,
            connection.port,
            connection.password.as_deref(),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &size_cmd,
            SSH_COMMAND_TIMEOUT,
            "check file size",
        );

        if let Ok(size_str) = size_output {
            if let Ok(size) = size_str.trim().parse::<usize>() {
                if size > EDITOR_FILE_SIZE_LIMIT {
                    return Err(format!(
                        "文件过大（{}），超过内嵌编辑器上限（512KB）。请使用外部编辑器打开。",
                        format_file_size(size)
                    ));
                }
            }
        }

        // Download file content via cat
        let cat_cmd = format!("cat -- {}", shell_quote(&path));
        let raw = run_ssh_command(
            &connection.username,
            &connection.host,
            connection.port,
            connection.password.as_deref(),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &cat_cmd,
            SSH_COMMAND_TIMEOUT,
            "read file content",
        )?;

        let language = detect_language(&path);
        let line_count = raw.lines().count();
        let file_size = raw.len();
        let html = highlight_to_html(&raw, language, &theme_mode)?;

        Ok(FileContent {
            raw,
            html,
            language: language.to_string(),
            line_count,
            file_size,
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn highlight_code(
    code: String,
    language: String,
    theme_mode: Option<String>,
) -> Result<HighlightedCode, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let theme_mode = theme_mode.unwrap_or_else(|| "dark".to_string());
        let html = highlight_to_html(&code, &language, &theme_mode)?;
        Ok(HighlightedCode { html })
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
        let write_cmd = format!(
            "echo '{}' | base64 -d > {}",
            encoded,
            shell_quote(&path)
        );

        run_ssh_command(
            &connection.username,
            &connection.host,
            connection.port,
            connection.password.as_deref(),
            connection.key_path.as_deref(),
            connection.proxy_jump.as_deref(),
            &write_cmd,
            SSH_COMMAND_TIMEOUT,
            "save file",
        )?;

        Ok(format!("已保存到 {}", path))
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
