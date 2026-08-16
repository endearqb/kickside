#[cfg(target_os = "macos")]
use tauri::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle,
};

#[cfg(target_os = "macos")]
const MENU_SETTINGS: &str = "app_settings";
#[cfg(target_os = "macos")]
const MENU_DIAGNOSTICS: &str = "app_diagnostics";
#[cfg(target_os = "macos")]
const MENU_QUIT: &str = "app_quit_gracefully";

#[cfg(target_os = "macos")]
pub(crate) fn setup_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let about = PredefinedMenuItem::about(app, None, None)?;
    let settings = MenuItem::with_id(app, MENU_SETTINGS, "Settings…", true, Some("CmdOrCtrl+,"))?;
    let services = PredefinedMenuItem::services(app, None)?;
    let hide = PredefinedMenuItem::hide(app, None)?;
    let hide_others = PredefinedMenuItem::hide_others(app, None)?;
    let show_all = PredefinedMenuItem::show_all(app, None)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit KickSide", true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(
        app,
        "KickSide",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &services,
            &PredefinedMenuItem::separator(app)?,
            &hide,
            &hide_others,
            &show_all,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[&PredefinedMenuItem::close_window(app, None)?],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
        ],
    )?;

    let diagnostics = MenuItem::with_id(app, MENU_DIAGNOSTICS, "Diagnostics", true, None::<&str>)?;
    let help_menu = Submenu::with_items(app, "Help", true, &[&diagnostics])?;

    let menu = Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn setup_app_menu(_app: &tauri::AppHandle) -> tauri::Result<()> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn handle_menu_event(app: &AppHandle, event: &MenuEvent) {
    match event.id().as_ref() {
        MENU_SETTINGS => {
            crate::window_manager::show_and_focus(app);
            crate::window_manager::show_control_center(app, "macos_app_menu_settings");
        }
        MENU_DIAGNOSTICS => {
            crate::window_manager::show_and_focus(app);
            crate::window_manager::show_diagnostics(app, "macos_app_menu_diagnostics");
        }
        MENU_QUIT => crate::start_graceful_exit(app.clone(), "macos_app_menu_quit"),
        _ => {}
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn handle_menu_event(_app: &tauri::AppHandle, _event: &tauri::menu::MenuEvent) {}
