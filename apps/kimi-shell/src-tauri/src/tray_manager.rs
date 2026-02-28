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
        MenuItem::with_id(app, MENU_TOGGLE_WINDOW, "Toggle Window", true, None::<&str>)?;
    let restart_backend = MenuItem::with_id(
        app,
        MENU_RESTART_BACKEND,
        "Restart Backend",
        true,
        None::<&str>,
    )?;
    let open_diagnostics = MenuItem::with_id(
        app,
        MENU_OPEN_DIAGNOSTICS,
        "Open Diagnostics",
        true,
        None::<&str>,
    )?;
    let open_logs = MenuItem::with_id(app, MENU_OPEN_LOGS, "Open Logs Folder", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit This Instance", true, None::<&str>)?;
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

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_TOGGLE_WINDOW => window_manager::toggle_window(app),
            MENU_RESTART_BACKEND => backend_manager::restart_backend(app.clone()),
            MENU_OPEN_DIAGNOSTICS => {
                window_manager::show_and_focus(app);
                window_manager::navigate_diagnostics(app);
            }
            MENU_OPEN_LOGS => {
                if let Err(error) = backend_manager::open_logs_folder(app) {
                    eprintln!("failed to open logs folder: {error}");
                }
            }
            MENU_QUIT => {
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
