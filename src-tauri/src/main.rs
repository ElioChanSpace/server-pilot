// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod servers;

use std::collections::HashMap;
use servers::{AppState, AppData};
use servers::command::{
    create_server, get_servers, connect_server, create_category, get_categories,
    pty_write, pty_resize, load_data, disconnect_server
};
use servers::session_manager::SessionManagerState; // <-- 引入新的 SessionManager 状态
use std::sync::{Arc, Mutex};
use tauri::{CustomMenuItem, Manager, Menu, Submenu};
use crate::servers::PtyState;

fn main() {
    log4rs::init_file("log4rs.yaml", Default::default())
        .expect("初始化日志失败");
    let system_menu = Submenu::new("System", Menu::new());

    #[cfg(debug_assertions)]
    let dev_menu = Submenu::new("Developer", Menu::new().add_item(CustomMenuItem::new("inspect", "Inspect Element")));

    let mut menu = Menu::new().add_submenu(system_menu);
    #[cfg(debug_assertions)]
    {
        menu = menu.add_submenu(dev_menu);
    }
    tauri::Builder::default()
        .menu(menu)
        .on_menu_event(|event| {
            match event.menu_item_id() {
                "inspect" => {
                    event.window().open_devtools();
                }
                _ => {}
            }
        })
        .manage(SessionManagerState::default()) // <-- 注册 SessionManager 状态
        .setup(|app| {
            let initial_data = load_data(&app.handle());
            app.manage(AppState(Arc::from(Mutex::new(initial_data))));
            app.manage(PtyState {
                sessions: Arc::new(Mutex::new(HashMap::new()))
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_server,
            get_servers,
            connect_server,
            create_category,
            get_categories,
            pty_write,
            pty_resize,
            disconnect_server
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {});
}