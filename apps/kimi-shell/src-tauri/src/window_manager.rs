use tauri::{AppHandle, Manager};
use url::Url;

const MAIN_WINDOW_LABEL: &str = "main";

pub fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
        }
        Ok(false) => {
            let _ = window.show();
            let _ = window.set_focus();
        }
        Err(_) => {}
    }
}

pub fn show_and_focus(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    let _ = window.show();
    let _ = window.set_focus();
}

pub fn navigate_loading(app: &AppHandle) {
    navigate_local(app, "loading");
}

pub fn navigate_missing_kimi(app: &AppHandle) {
    navigate_local(app, "missing-kimi");
}

pub fn navigate_error(app: &AppHandle) {
    navigate_local(app, "error");
}

pub fn navigate_diagnostics(app: &AppHandle) {
    navigate_local(app, "diagnostics");
}

pub fn navigate_onboarding(app: &AppHandle) {
    navigate_local(app, "onboarding");
}

fn navigate_local(app: &AppHandle, route: &str) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    let base = if cfg!(debug_assertions) {
        "http://localhost:1420"
    } else {
        "tauri://localhost"
    };
    let target = format!("{base}/#/{route}");
    let Ok(url) = Url::parse(&target) else {
        return;
    };

    let _ = window.navigate(url);
}
