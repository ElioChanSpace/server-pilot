use std::sync::{Arc, Mutex};
use tauri::{State, AppHandle, Manager, Window};
use std::fs;
use crate::models::{Server, Category, OsType, AppData};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem, MasterPty}; // <-- FIX: Import MasterPty

// This struct holds the in-memory state of the application.
pub struct AppState(pub Mutex<AppData>);

// --- Persistence Functions ---
const DATA_FILE: &str = "data.json";

fn save_data(app: &AppHandle, data: &AppData) -> Result<(), String> {
    let path = app.path_resolver().app_data_dir().ok_or("Could not resolve app data dir")?;
    if !path.exists() { fs::create_dir_all(&path).map_err(|e| e.to_string())?; }
    let file_path = path.join(DATA_FILE);
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(file_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_data(app: &AppHandle) -> AppData {
    if let Some(path) = app.path_resolver().app_data_dir() {
        let file_path = path.join(DATA_FILE);
        if file_path.exists() {
            if let Ok(json) = fs::read_to_string(file_path) {
                if let Ok(data) = serde_json::from_str(&json) { return data; }
            }
        }
    }
    AppData::default()
}

// --- PTY Management ---
// --- FIX: Store the MasterPty object directly ---
type PtyState = Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>;

// --- Tauri Commands ---

#[tauri::command]
pub fn create_server(state: State<'_, AppState>, app: AppHandle, name: String, host: String, port: u16, username: String, category_id: Option<String>, os_type: OsType, password: Option<String>) -> Result<Server, String> {
    let mut data = state.0.lock().map_err(|_| "Mutex lock failed")?;
    let server = Server::new(name, host, port, username, category_id, os_type, password);
    data.servers.push(server.clone());
    save_data(&app, &data)?;
    Ok(server)
}

#[tauri::command]
pub fn create_category(state: State<'_, AppState>, app: AppHandle, name: String, parent_id: Option<String>) -> Result<Category, String> {
    let mut data = state.0.lock().map_err(|_| "Mutex lock failed")?;
    let category = Category::new(name, parent_id);
    data.categories.push(category.clone());
    save_data(&app, &data)?;
    Ok(category)
}

#[tauri::command]
pub fn get_servers(state: State<'_, AppState>) -> Result<Vec<Server>, String> {
    Ok(state.0.lock().map_err(|_| "Mutex lock failed")?.servers.clone())
}

#[tauri::command]
pub fn get_categories(state: State<'_, AppState>) -> Result<Vec<Category>, String> {
    Ok(state.0.lock().map_err(|_| "Mutex lock failed")?.categories.clone())
}

#[tauri::command]
pub fn pty_write(pty_state: State<'_, PtyState>, data: String) -> Result<(), String> {
    if let Some(master) = pty_state.lock().unwrap().as_mut() {
        // --- FIX: Use the writer from the master object ---
        master.writer().write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_resize(pty_state: State<'_, PtyState>, rows: u16, cols: u16) -> Result<(), String> {
    if let Some(master) = pty_state.lock().unwrap().as_mut() {
        master.resize(PtySize { rows, cols, ..Default::default() }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn connect_server(
    window: Window,
    state: State<'_, AppState>,
    pty_state: State<'_, PtyState>,
    id: String,
) -> Result<(), String> {
    let server = {
        let mut data = state.0.lock().map_err(|_| "Mutex lock failed")?;
        let server = data.servers.iter_mut().find(|s| s.id == id).ok_or("Server not found")?;
        server.status = "connecting".to_string();
        window.emit("server-status-changed", server.clone()).unwrap();
        server.clone()
    };

    let emit_log = |log: String| {
        window.emit("connection-log", log).unwrap();
    };

    emit_log(format!("Connecting to {} ({}@{})...", server.name, server.username, server.host));

    match server.os_type {
        OsType::Linux => {
            let pty_system = NativePtySystem::default();
            let pair = pty_system.openpty(PtySize::default()).map_err(|e| e.to_string())?;

            let mut cmd = CommandBuilder::new("ssh");
            cmd.arg(format!("{}@{}", server.username, server.host));
            cmd.arg("-p");
            cmd.arg(server.port.to_string());

            let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
            let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

            // --- FIX: Store the master PTY object ---
            *pty_state.lock().unwrap() = Some(pair.master);

            // Reader task
            tauri::async_runtime::spawn(async move {
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(n) if n > 0 => {
                            let data = String::from_utf8_lossy(&buf[..n]).to_string();
                            window.emit("pty-data", data).unwrap();
                        }
                        _ => break,
                    }
                }
            });

            // Status check task
            tauri::async_runtime::spawn(async move {
                let status = child.wait().unwrap();
                let mut data = state.0.lock().unwrap();
                if let Some(s) = data.servers.iter_mut().find(|s| s.id == id) {
                    s.status = "disconnected".to_string();
                    window.emit("server-status-changed", s.clone()).unwrap();
                }
                window.emit("connection-log", format!("Disconnected. Exit status: {}", status)).unwrap();
                *pty_state.lock().unwrap() = None;
            });

            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let mut data = state.0.lock().unwrap();
            if let Some(s) = data.servers.iter_mut().find(|s| s.id == id) {
                s.status = "connected".to_string();
                window.emit("server-status-changed", s.clone()).unwrap();
            }
            emit_log("Connection established. PTY attached.".to_string());
        }
        OsType::Windows => {
            emit_log("Simulating RDP connection...".to_string());
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;

            let mut data = state.0.lock().unwrap();
            if let Some(s) = data.servers.iter_mut().find(|s| s.id == id) {
                s.status = "connected".to_string();
                window.emit("server-status-changed", s.clone()).unwrap();
            }
            emit_log("RDP connection successful (simulated).".to_string());
        }
    }
    Ok(())
}