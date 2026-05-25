// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod servers;

use crate::servers::application::AppState;
use crate::servers::infrastructure::session_manager::SessionManagerState;
use crate::servers::infrastructure::FileRepository;
use crate::servers::interface::commands::{
    clear_app_logs, connect_server, create_category, create_server, disconnect_server,
    download_file_from_server, fetch_server_metrics, get_categories, get_servers,
    list_remote_directory, pty_resize, pty_write, read_app_logs, update_server,
    upload_file_to_server,
};
use log::LevelFilter;
use log4rs::{
    append::{console::ConsoleAppender, file::FileAppender},
    config::{Appender, Config, Root},
    encode::pattern::PatternEncoder,
};
use std::{fs, path::PathBuf, sync::Arc};
use tauri::{CustomMenuItem, Manager, Menu, PathResolver, Submenu};

fn resolve_app_log_path(path_resolver: &PathResolver) -> Result<PathBuf, String> {
    let log_dir = path_resolver
        .app_log_dir()
        .or_else(|| path_resolver.app_local_data_dir().map(|path| path.join("logs")))
        .ok_or_else(|| "无法解析应用日志目录".to_string())?;
    Ok(log_dir.join("app.log"))
}

fn initialize_logging(path_resolver: &PathResolver) -> Result<(), String> {
    let log_path = resolve_app_log_path(path_resolver)?;
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("创建日志目录失败: {}", err))?;
    }

    let stdout = ConsoleAppender::builder()
        .encoder(Box::new(PatternEncoder::new(
            "{d(%Y-%m-%d %H:%M:%S)} [{l}] {m}{n}",
        )))
        .build();

    let file = FileAppender::builder()
        .encoder(Box::new(PatternEncoder::new(
            "{d(%Y-%m-%d %H:%M:%S)} [{l}] [{f}:{L}] {m}{n}",
        )))
        .build(&log_path)
        .map_err(|err| format!("创建日志文件失败: {}", err))?;

    let config = Config::builder()
        .appender(Appender::builder().build("stdout", Box::new(stdout)))
        .appender(Appender::builder().build("file", Box::new(file)))
        .build(
            Root::builder()
                .appender("stdout")
                .appender("file")
                .build(LevelFilter::Info),
        )
        .map_err(|err| format!("构建日志配置失败: {}", err))?;

    log4rs::init_config(config).map_err(|err| format!("初始化日志失败: {}", err))?;
    Ok(())
}

fn main() {
    let system_menu = Submenu::new("系统", Menu::new());

    #[cfg(debug_assertions)]
    let dev_menu = Submenu::new(
        "开发",
        Menu::new().add_item(CustomMenuItem::new("inspect", "检查元素")),
    );

    let mut menu = Menu::new().add_submenu(system_menu);
    #[cfg(debug_assertions)]
    {
        menu = menu.add_submenu(dev_menu);
    }
    tauri::Builder::default()
        .menu(menu)
        .on_menu_event(|event| {
            #[cfg(debug_assertions)]
            if event.menu_item_id() == "inspect" {
                event.window().open_devtools();
            }
        })
        .manage(SessionManagerState::default())
        .setup(|app| {
            initialize_logging(&app.path_resolver())?;

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
            read_app_logs,
            clear_app_logs,
            upload_file_to_server,
            download_file_from_server
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {});
}
