// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod models;

use commands::{
    create_server, get_servers, connect_server, create_category, get_categories,
    pty_write, pty_resize, AppState, load_data
};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use crate::models::AppData;

fn main() {
    tauri::Builder::default()
        .manage(Arc::new(Mutex::new(AppData::default()))) // PtyState
        .setup(|app| {
            let initial_data = load_data(&app.handle());
            app.manage(AppState(Arc::from(Mutex::new(initial_data))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_server,
            get_servers,
            connect_server,
            create_category,
            get_categories,
            pty_write,
            pty_resize
        ])
        .build(tauri::generate_context!()) // Use build() instead of run() to get access to the App
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {}); // Run the app
}