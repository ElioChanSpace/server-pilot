// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod servers;

use crate::servers::application::AppState;
use crate::servers::infrastructure::session_manager::SessionManagerState;
use crate::servers::infrastructure::FileRepository;
use crate::servers::interface::commands::{
    connect_server, create_category, create_server, disconnect_server, download_file_from_server,
    fetch_server_metrics, get_categories, get_servers, list_remote_directory, pty_resize,
    pty_write, update_server, upload_file_to_server,
};
use std::sync::Arc;
use tauri::{CustomMenuItem, Manager, Menu, Submenu};

fn main() {
    log4rs::init_file("log4rs.yaml", Default::default()).expect("初始化日志失败");
    let system_menu = Submenu::new("System", Menu::new());

    #[cfg(debug_assertions)]
    let dev_menu = Submenu::new(
        "Developer",
        Menu::new().add_item(CustomMenuItem::new("inspect", "Inspect Element")),
    );

    let mut menu = Menu::new().add_submenu(system_menu);
    #[cfg(debug_assertions)]
    {
        menu = menu.add_submenu(dev_menu);
    }
    tauri::Builder::default()
        .menu(menu)
        .on_menu_event(|event| match event.menu_item_id() {
            "inspect" => {
                event.window().open_devtools();
            }
            _ => {}
        })
        .manage(SessionManagerState::default())
        .setup(|app| {
            // --- Dependency Injection ---
            let repository = Arc::new(FileRepository::new(app.handle()));
            let app_state = AppState::new(repository);

            app.manage(app_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_server,
            update_server,
            get_servers,
            connect_server,
            create_category,
            get_categories,
            pty_write,
            pty_resize,
            disconnect_server,
            fetch_server_metrics,
            list_remote_directory,
            upload_file_to_server,
            download_file_from_server
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {});
}
