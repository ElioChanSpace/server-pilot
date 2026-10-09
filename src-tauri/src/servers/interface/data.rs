use crate::servers::application::AppState;
use crate::servers::domain::AppData;
use crate::servers::infrastructure::credential_store;
use crate::servers::infrastructure::StateDatabase;
use std::fs;
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tauri::State;

#[tauri::command(async)]
pub fn export_app_data(
    state: State<'_, AppState>,
    database: State<'_, StateDatabase>,
    save_path: String,
) -> Result<(), String> {
    let mut sanitized = {
        let data = state.data.lock().map_err(|e| e.to_string())?;
        data.clone()
    };
    // SQLite / disk IO happens without holding the global data lock.
    for server in &mut sanitized.servers {
        server.password = None;
        server.key_passphrase = None;
    }
    sanitized.command_history = database.command_history()?;
    let json = serde_json::to_string_pretty(&sanitized).map_err(|e| e.to_string())?;
    fs::write(&save_path, json).map_err(|e| format!("写入导出文件失败: {e}"))
}

#[tauri::command(async)]
pub fn import_app_data(
    state: State<'_, AppState>,
    database: State<'_, StateDatabase>,
    load_path: String,
) -> Result<u32, String> {
    let json = fs::read_to_string(&load_path).map_err(|e| format!("读取导入文件失败: {e}"))?;
    let mut imported: AppData =
        serde_json::from_str(&json).map_err(|e| format!("配置文件格式无效: {e}"))?;

    let changed = credential_store::migrate_legacy_passwords(&mut imported)?;
    let server_count = imported.servers.len() as u32;
    let imported_command_history = imported.command_history.clone();

    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.servers = imported.servers;
    data.categories = imported.categories;
    data.settings = imported.settings;
    data.custom_themes = imported.custom_themes;
    data.command_history.clear();
    drop(data);
    state.save()?;

    if !imported_command_history.is_empty() {
        database.replace_command_history(imported_command_history)?;
    }

    let _ = changed;
    Ok(server_count)
}

#[tauri::command(async)]
pub async fn test_server_connection(
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let server = {
        let data = state.data.lock().map_err(|err| err.to_string())?;
        data.servers
            .iter()
            .find(|server| server.id == id)
            .cloned()
            .ok_or("Server not found")?
    };

    let host = server.host.clone();
    let port = server.port;

    tauri::async_runtime::spawn_blocking(move || {
        let start = Instant::now();
        let address = format!("{host}:{port}");
        let parsed = address
            .parse::<SocketAddr>()
            .map_err(|err| format!("地址解析失败: {err}"))?;

        match std::net::TcpStream::connect_timeout(&parsed, Duration::from_secs(5)) {
            Ok(_) => Ok(format!(
                "端口可达（延迟约 {:.0} ms）",
                start.elapsed().as_millis()
            )),
            Err(err) => Err(format!("连接失败: {err}")),
        }
    })
    .await
    .map_err(|err| err.to_string())?
}
