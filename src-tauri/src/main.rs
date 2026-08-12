// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod servers;

use crate::servers::application::AppState;
use crate::servers::infrastructure::credential_store;
use crate::servers::infrastructure::session_manager::SessionManagerState;
use crate::servers::infrastructure::FileRepository;
use crate::servers::interface::commands::{
    check_port_available, clear_app_logs, close_ssh_tunnel, close_terminal_session,
    connect_server, create_category, create_remote_directory, create_server, create_ssh_tunnel,
    delete_category, delete_remote_path, delete_server, disconnect_server,
    download_file_from_server, export_app_data, fetch_server_metrics, generate_ssh_key,
    get_app_settings, get_categories, get_default_ssh_key_path, get_file_content, get_servers,
    get_terminal_session_directory, highlight_code, import_app_data, list_remote_directory,
    list_ssh_keys, list_ssh_tunnels, parse_ssh_config, pty_resize, pty_write, read_app_logs,
    read_remote_log, rename_remote_path, save_remote_file, test_server_connection,
    update_app_settings, update_category, update_category_order, update_server,
    upload_directory_to_server, upload_file_to_server,
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
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    path::PathResolver,
    Manager,
};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

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
    let changed = {
        let mut data = app_state.data.lock().map_err(|err| err.to_string())?;
        credential_store::migrate_legacy_passwords(&mut data)?
    };

    if changed {
        app_state.save()?;
    }
    Ok(())
}

/// Reset all server statuses to "disconnected" on startup.
/// If the app was force-quit while servers were connected, the persisted status
/// would be stale ("connected") with no active sessions, leaving only a disconnect button.
fn reset_server_statuses(app_state: &AppState) -> Result<(), String> {
    let mut data = app_state.data.lock().map_err(|err| err.to_string())?;
    let mut changed = false;
    for server in &mut data.servers {
        if server.status != "disconnected" {
            server.status = "disconnected".to_string();
            changed = true;
        }
    }
    drop(data);
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
        .plugin(tauri_plugin_notification::init())
        .manage(SessionManagerState::default())
        .manage(servers::interface::ssh_tunnel::TunnelManager::new())
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
            reset_server_statuses(&app_state)?;

            // --- 系统托盘 ---
            let show_item = MenuItemBuilder::with_id("show", "显示主窗口")
                .build(app)
                .map_err(|err| err.to_string())?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出")
                .build(app)
                .map_err(|err| err.to_string())?;
            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&quit_item)
                .build()
                .map_err(|err| err.to_string())?;

            TrayIconBuilder::with_id("main-tray")
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .ok_or("缺少应用图标")?,
                )
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)
                .map_err(|err| err.to_string())?;

            // --- 关闭时最小化到托盘 ---
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let minimize = window_clone
                            .state::<AppState>()
                            .data
                            .lock()
                            .ok()
                            .map(|data| data.settings.minimize_to_tray_on_close)
                            .unwrap_or(false);
                        if minimize {
                            api.prevent_close();
                            let _ = window_clone.hide();
                        }
                    }
                });
            }

            app.manage(app_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_server,
            update_server,
            delete_server,
            get_servers,
            connect_server,
            create_category,
            update_category,
            update_category_order,
            delete_category,
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
            upload_directory_to_server,
            download_file_from_server,
            delete_remote_path,
            rename_remote_path,
            create_remote_directory,
            read_remote_log,
            export_app_data,
            import_app_data,
            test_server_connection,
            generate_ssh_key,
            list_ssh_keys,
            get_default_ssh_key_path,
            create_ssh_tunnel,
            close_ssh_tunnel,
            list_ssh_tunnels,
            check_port_available,
            get_file_content,
            highlight_code,
            save_remote_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {});
}
