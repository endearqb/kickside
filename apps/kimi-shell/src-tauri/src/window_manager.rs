use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager};
use url::Url;

use crate::log_manager;

const MAIN_WINDOW_LABEL: &str = "main";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationStage {
    Init,
    LocalBoot,
    BackendReady,
    ControlCenter,
    Diagnostics,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalRoute {
    Loading,
    MissingKimi,
    Diagnostics,
    ControlCenter,
}

#[derive(Debug, Clone, Copy)]
struct NavigationState {
    stage: NavigationStage,
    route: Option<LocalRoute>,
}

impl Default for NavigationState {
    fn default() -> Self {
        Self {
            stage: NavigationStage::Init,
            route: None,
        }
    }
}

fn shared_navigation_state() -> &'static Mutex<NavigationState> {
    static STATE: OnceLock<Mutex<NavigationState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(NavigationState::default()))
}

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

pub fn enter_local_boot(app: &AppHandle, source: &str) {
    transition(
        app,
        NavigationStage::LocalBoot,
        Some(LocalRoute::Loading),
        source,
        false,
    );
}

pub fn recover_loading_route(app: &AppHandle, source: &str) {
    transition(
        app,
        NavigationStage::LocalBoot,
        Some(LocalRoute::Loading),
        source,
        true,
    );
}

pub fn mark_backend_ready(app: &AppHandle, source: &str) {
    transition(app, NavigationStage::BackendReady, None, source, false);
}

pub fn show_missing_kimi(app: &AppHandle, source: &str) {
    transition(
        app,
        NavigationStage::ControlCenter,
        Some(LocalRoute::MissingKimi),
        source,
        false,
    );
}

pub fn show_control_center(app: &AppHandle, source: &str) {
    transition(
        app,
        NavigationStage::ControlCenter,
        Some(LocalRoute::ControlCenter),
        source,
        false,
    );
}

pub fn show_diagnostics(app: &AppHandle, source: &str) {
    transition(
        app,
        NavigationStage::Diagnostics,
        Some(LocalRoute::Diagnostics),
        source,
        false,
    );
}

fn transition(
    app: &AppHandle,
    stage: NavigationStage,
    route: Option<LocalRoute>,
    source: &str,
    force_navigate: bool,
) {
    let (
        should_navigate,
        route_to_navigate,
        final_route_for_log,
        stage_changed,
        route_changed,
        previous_stage,
        previous_route,
    ) = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!("navigation state mutex poisoned, fallback direct route (source={source})"),
            );
            if let Some(route) = route {
                navigate_local(app, route);
            }
            return;
        };

        let previous_stage = state.stage;
        let previous_route = state.route;

        let stage_changed = state.stage != stage;
        if stage_changed {
            state.stage = stage;
        }

        let mut route_changed = false;
        if let Some(next_route) = route {
            route_changed = state.route != Some(next_route);
            state.route = Some(next_route);
        }

        (
            force_navigate || route_changed,
            route,
            state.route,
            stage_changed,
            route_changed,
            previous_stage,
            previous_route,
        )
    };

    if stage_changed || route_changed {
        log_manager::append_line(
            app,
            format!(
                "navigation transition (source={source}) stage: {} -> {}; route: {} -> {}",
                stage_label(previous_stage),
                stage_label(stage),
                route_label(previous_route),
                route_label(final_route_for_log),
            ),
        );
    }

    if should_navigate {
        if let Some(route) = route_to_navigate {
            navigate_local(app, route);
        }
    }
}

fn stage_label(stage: NavigationStage) -> &'static str {
    match stage {
        NavigationStage::Init => "init",
        NavigationStage::LocalBoot => "local_boot",
        NavigationStage::BackendReady => "backend_ready",
        NavigationStage::ControlCenter => "control_center",
        NavigationStage::Diagnostics => "diagnostics",
    }
}

fn route_label(route: Option<LocalRoute>) -> &'static str {
    match route {
        Some(LocalRoute::Loading) => "loading",
        Some(LocalRoute::MissingKimi) => "missing_kimi",
        Some(LocalRoute::Diagnostics) => "diagnostics",
        Some(LocalRoute::ControlCenter) => "control_center",
        None => "none",
    }
}

fn route_path(route: LocalRoute) -> &'static str {
    match route {
        LocalRoute::Loading => "loading",
        LocalRoute::MissingKimi => "missing-kimi",
        LocalRoute::Diagnostics => "diagnostics",
        LocalRoute::ControlCenter => "control-center",
    }
}

fn navigate_local(app: &AppHandle, route: LocalRoute) {
    let route_path = route_path(route);
    let target = if cfg!(debug_assertions) {
        format!("http://localhost:1420/#/{route_path}")
    } else {
        format!("tauri://localhost/#/{route_path}")
    };

    let app_handle = app.clone();
    let target_for_thread = target.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) else {
            return;
        };

        let Ok(url) = Url::parse(&target_for_thread) else {
            log_manager::append_line(
                &app_handle,
                format!("failed to parse local route url: {target_for_thread}"),
            );
            return;
        };

        if let Err(error) = window.navigate(url) {
            log_manager::append_line(
                &app_handle,
                format!("failed to navigate local route `{target_for_thread}`: {error}"),
            );
        }
    }) {
        log_manager::append_line(
            app,
            format!("failed to schedule local navigation on main thread `{target}`: {error}"),
        );
    }
}
