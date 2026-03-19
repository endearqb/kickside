use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle,
};

use crate::{backend_manager, window_manager};

const MENU_TOGGLE_WINDOW: &str = "toggle_window";
const MENU_RESTART_BACKEND: &str = "restart_backend";
const MENU_OPEN_DIAGNOSTICS: &str = "open_diagnostics";
const MENU_OPEN_LOGS: &str = "open_logs_folder";
const MENU_QUIT: &str = "quit_app";

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle_window =
        MenuItem::with_id(app, MENU_TOGGLE_WINDOW, "显示/隐藏窗口", true, None::<&str>)?;
    let restart_backend = MenuItem::with_id(
        app,
        MENU_RESTART_BACKEND,
        "重启后端服务",
        true,
        None::<&str>,
    )?;
    let open_diagnostics = MenuItem::with_id(
        app,
        MENU_OPEN_DIAGNOSTICS,
        "打开诊断",
        true,
        None::<&str>,
    )?;
    let open_logs = MenuItem::with_id(app, MENU_OPEN_LOGS, "打开日志目录", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "退出", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &toggle_window,
            &restart_backend,
            &open_diagnostics,
            &separator,
            &open_logs,
            &quit,
        ],
    )?;

    let mut tray_builder = TrayIconBuilder::with_id("kimi-shell-tray")
        .menu(&menu)
        .tooltip("Kimi Shell");

    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }

    let _tray = tray_builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_TOGGLE_WINDOW => window_manager::toggle_window(app),
            MENU_RESTART_BACKEND => backend_manager::restart_backend(app.clone()),
            MENU_OPEN_DIAGNOSTICS => {
                window_manager::show_and_focus(app);
                window_manager::show_diagnostics(app, "tray_open_diagnostics");
            }
            MENU_OPEN_LOGS => {
                if let Err(error) = backend_manager::open_logs_folder(app) {
                    eprintln!("failed to open logs folder: {error}");
                }
            }
            MENU_QUIT => {
                window_manager::permit_process_exit(app, "tray_quit");
                if let Err(error) = backend_manager::stop_backend(app) {
                    eprintln!("failed to stop backend on quit: {error:#}");
                }
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}
