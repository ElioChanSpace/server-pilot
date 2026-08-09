// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod servers;

use crate::servers::application::AppState;
use crate::servers::infrastructure::credential_store;
use crate::servers::infrastructure::session_manager::SessionManagerState;
use crate::servers::infrastructure::FileRepository;
use crate::servers::interface::commands::{
    clear_app_logs, close_terminal_session, connect_server, create_category, create_server,
    create_remote_directory, delete_remote_path, disconnect_server, download_file_from_server,
    fetch_server_metrics, get_app_settings, get_categories, get_servers,
    get_terminal_session_directory, list_remote_directory, parse_ssh_config, pty_resize, pty_write,
    read_app_logs, read_remote_log, rename_remote_path, update_app_settings, update_server,
    upload_file_to_server,
};
use crate::servers::infrastructure::session_manager;
use log::LevelFilter;
use log4rs::{
    append::{console::ConsoleAppender, file::FileAppender},
    config::{Appender, Config, Root},
    encode::pattern::PatternEncoder,
};
use std::{fs, path::PathBuf, sync::Arc};
use tauri::{
    menu::{MenuBuilder, SubmenuBuilder},
    path::PathResolver,
    Manager,
};

fn resolve_app_log_path<R: tauri::Runtime>(
    path_resolver: &PathResolver<R>,
) -> Result<PathBuf, String> {
    let log_dir = path_resolver
        .app_log_dir()
        .or_else(|_| {
            path_resolver
                .app_local_data_dir()
                .map(|path| path.join("logs"))
        })
        .map_err(|_| "无法解析应用日志目录".to_string())?;
    Ok(log_dir.join("app.log"))
}

fn initialize_logging<R: tauri::Runtime>(
    path_resolver: &PathResolver<R>,
) -> Result<(), String> {
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

fn migrate_legacy_passwords(app_state: &AppState) -> Result<(), String> {
    let mut changed = false;
    {
        let mut data = app_state.data.lock().map_err(|err| err.to_string())?;
        for server in data.servers.iter_mut() {
            if let Some(password) = server.password.take() {
                if !password.is_empty() {
                    credential_store::save_password(&server.id, &password)?;
                    server.has_password = true;
                }
                changed = true;
            }
        }
    }

    if changed {
        app_state.save()?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SessionManagerState::default())
        .setup(|app| {
            initialize_logging(app.path())?;

            let system_menu = SubmenuBuilder::new(app, "系统")
                .build()
                .map_err(|err| err.to_string())?;
            let mut menu_builder = MenuBuilder::new(app).item(&system_menu);

            #[cfg(debug_assertions)]
            {
                let dev_menu = SubmenuBuilder::new(app, "开发")
                    .text("inspect", "检查元素")
                    .build()
                    .map_err(|err| err.to_string())?;
                menu_builder = menu_builder.item(&dev_menu);
            }

            let menu = menu_builder.build().map_err(|err| err.to_string())?;
            app.set_menu(menu).map_err(|err| err.to_string())?;

            #[cfg(debug_assertions)]
            app.on_menu_event(|app, event| {
                if event.id() == "inspect" {
                    if let Some(window) = app.get_webview_window("main") {
                        window.open_devtools();
                    }
                }
            });

            // --- Dependency Injection ---
            let repository = Arc::new(FileRepository::new(app.handle().clone()));
            let app_state = AppState::new(repository);
            migrate_legacy_passwords(&app_state)?;

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
            get_app_settings,
            update_app_settings,
            pty_write,
            pty_resize,
            get_terminal_session_directory,
            parse_ssh_config,
            session_manager::respond_to_host_key_prompt,
            disconnect_server,
            close_terminal_session,
            fetch_server_metrics,
            list_remote_directory,
            read_app_logs,
            clear_app_logs,
            upload_file_to_server,
            download_file_from_server,
            delete_remote_path,
            rename_remote_path,
            create_remote_directory,
            read_remote_log
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {});
}
