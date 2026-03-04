use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter, Manager};

use crate::{
    log_manager,
    types::{PrefillChatPayload, ShellRoutePayload, SubmitPrefillAck},
};

const MAIN_WINDOW_LABEL: &str = "main";
const PREFILL_WINDOW_LABEL: &str = "prefill";
const SHELL_ROUTE_EVENT: &str = "shell-route";
const PREFILL_CHAT_EVENT: &str = "prefill-chat";

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

#[derive(Debug, Clone)]
struct NavigationState {
    stage: NavigationStage,
    route: Option<LocalRoute>,
    frontend_ready: bool,
    queued_route: Option<LocalRoute>,
    pending_prefill: Option<PrefillChatPayload>,
    next_prefill_id: u64,
    allow_prefill_close: bool,
}

impl Default for NavigationState {
    fn default() -> Self {
        Self {
            stage: NavigationStage::Init,
            route: None,
            frontend_ready: false,
            queued_route: None,
            pending_prefill: None,
            next_prefill_id: 0,
            allow_prefill_close: false,
        }
    }
}

pub struct FrontendReadyTransition {
    pub accepted: bool,
    pub pending_prefill: Option<PrefillChatPayload>,
}

enum DispatchOutcome {
    Dispatch(LocalRoute),
    Queued(LocalRoute, &'static str),
    Skipped,
}

fn shared_navigation_state() -> &'static Mutex<NavigationState> {
    static STATE: OnceLock<Mutex<NavigationState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(NavigationState::default()))
}

pub fn toggle_window(app: &AppHandle) {
    if let Some(prefill) = app.get_webview_window(PREFILL_WINDOW_LABEL) {
        match prefill.is_visible() {
            Ok(true) => {
                let _ = prefill.hide();
                return;
            }
            Ok(false) => {}
            Err(_) => {}
        }
    }

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
    if let Some(prefill) = app.get_webview_window(PREFILL_WINDOW_LABEL) {
        if prefill.is_visible().unwrap_or(false) {
            let _ = prefill.show();
            let _ = prefill.set_focus();
            return;
        }
    }

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

pub fn mark_backend_ready(app: &AppHandle, source: &str) {
    transition(app, NavigationStage::BackendReady, None, source, false);
}

pub fn mark_frontend_ready(app: &AppHandle, source: &str) -> FrontendReadyTransition {
    let (accepted, queued_route, pending_prefill) = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned, failed to mark frontend ready (source={source})"
                ),
            );
            return FrontendReadyTransition {
                accepted: false,
                pending_prefill: None,
            };
        };

        let accepted = !state.frontend_ready;
        state.frontend_ready = true;
        let queued_route = state.queued_route.take();
        let pending_prefill = state.pending_prefill.take();
        (accepted, queued_route, pending_prefill)
    };

    if accepted {
        log_manager::append_line(
            app,
            format!("frontend ready acknowledged (source={source})"),
        );
    }

    if let Some(route) = queued_route {
        if !emit_shell_route_event(app, route, source) {
            requeue_route(app, route, source, "emit_failed_after_frontend_ready");
        }
    }

    if let Some(payload) = pending_prefill.clone() {
        if !emit_prefill_event(app, &payload, source) {
            requeue_prefill(
                app,
                payload.clone(),
                source,
                "emit_failed_after_frontend_ready",
            );
        }
    }

    FrontendReadyTransition {
        accepted,
        pending_prefill,
    }
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

pub fn submit_prefill(app: &AppHandle, text: String, source: &str) -> SubmitPrefillAck {
    let text_length = text.chars().count();
    let trimmed_is_empty = text.trim().is_empty();

    let (request_id, queued, payload_for_dispatch) = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned, submit_prefill dropped (source={source})"
                ),
            );
            return SubmitPrefillAck {
                accepted: false,
                request_id: None,
                queued: false,
                dispatched: false,
                text_length,
            };
        };

        if trimmed_is_empty {
            (None, false, None)
        } else {
            let next_request_id = next_prefill_request_id_locked(&mut state);
            let payload = PrefillChatPayload {
                request_id: next_request_id.clone(),
                text,
                auto_send: true,
            };

            if state.frontend_ready {
                (Some(next_request_id), false, Some(payload))
            } else {
                state.pending_prefill = Some(payload);
                (Some(next_request_id), true, None)
            }
        }
    };

    complete_prefill_flow(app, source);

    let mut dispatched = false;
    if let Some(payload) = payload_for_dispatch {
        dispatched = emit_prefill_event(app, &payload, source);
        if !dispatched {
            requeue_prefill(app, payload, source, "emit_failed_after_submit");
        }
    }

    if let Some(request_id) = request_id.as_deref() {
        log_manager::append_line(
            app,
            format!(
                "prefill submitted (source={source}, request_id={request_id}, text_length={text_length}, queued={queued}, dispatched={dispatched})"
            ),
        );
    } else {
        log_manager::append_line(
            app,
            format!("prefill submitted with empty text (source={source})"),
        );
    }

    SubmitPrefillAck {
        accepted: true,
        request_id,
        queued,
        dispatched,
        text_length,
    }
}

pub fn complete_prefill_without_text(app: &AppHandle, source: &str) {
    log_manager::append_line(
        app,
        format!("prefill completed without text (source={source})"),
    );
    complete_prefill_flow(app, source);
}

pub fn consume_prefill_close_allowance(app: &AppHandle) -> bool {
    let lock = shared_navigation_state().lock();
    let Ok(mut state) = lock else {
        log_manager::append_line(
            app,
            "navigation state mutex poisoned while consuming prefill close allowance",
        );
        return false;
    };

    if state.allow_prefill_close {
        state.allow_prefill_close = false;
        true
    } else {
        false
    }
}

fn complete_prefill_flow(app: &AppHandle, source: &str) {
    request_prefill_close(app, source);

    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

fn request_prefill_close(app: &AppHandle, source: &str) {
    let should_close = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!("navigation state mutex poisoned while closing prefill (source={source})"),
            );
            return;
        };
        state.allow_prefill_close = true;
        true
    };

    if !should_close {
        return;
    }

    if let Some(prefill) = app.get_webview_window(PREFILL_WINDOW_LABEL) {
        if let Err(error) = prefill.close() {
            log_manager::append_line(
                app,
                format!("failed to close prefill window (source={source}): {error}"),
            );
        }
    }
}

fn transition(
    app: &AppHandle,
    stage: NavigationStage,
    route: Option<LocalRoute>,
    source: &str,
    force_navigate: bool,
) {
    let (
        dispatch_outcome,
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
                format!("navigation state mutex poisoned, skip transition (source={source})"),
            );
            return;
        };

        let previous_stage = state.stage;
        let previous_route = state.route;

        let stage_changed = state.stage != stage;
        if stage_changed {
            state.stage = stage;
        }

        let mut route_changed = false;
        let mut dispatch_outcome = DispatchOutcome::Skipped;
        if let Some(next_route) = route {
            route_changed = state.route != Some(next_route);
            state.route = Some(next_route);

            if force_navigate || route_changed {
                dispatch_outcome = request_route_locked(&mut state, next_route);
            }
        }

        (
            dispatch_outcome,
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

    match dispatch_outcome {
        DispatchOutcome::Dispatch(route) => {
            if !emit_shell_route_event(app, route, source) {
                requeue_route(app, route, source, "emit_failed");
            }
        }
        DispatchOutcome::Queued(route, reason) => {
            log_manager::append_line(
                app,
                format!(
                    "navigation queued (source={source}, route={}, reason={reason})",
                    route_label(Some(route))
                ),
            );
        }
        DispatchOutcome::Skipped => {}
    }
}

fn request_route_locked(state: &mut NavigationState, route: LocalRoute) -> DispatchOutcome {
    if !state.frontend_ready {
        state.queued_route = Some(route);
        return DispatchOutcome::Queued(route, "frontend_not_ready");
    }
    DispatchOutcome::Dispatch(route)
}

fn requeue_route(app: &AppHandle, route: LocalRoute, source: &str, detail: &str) {
    let lock = shared_navigation_state().lock();
    let Ok(mut state) = lock else {
        log_manager::append_line(
            app,
            format!(
                "navigation state mutex poisoned while re-queueing route (source={source}, detail={detail})"
            ),
        );
        return;
    };

    state.queued_route = Some(route);
    log_manager::append_line(
        app,
        format!(
            "navigation event dispatch failed and route re-queued (source={source}, route={}, detail={detail})",
            route_label(Some(route))
        ),
    );
}

fn requeue_prefill(app: &AppHandle, payload: PrefillChatPayload, source: &str, detail: &str) {
    let request_id = payload.request_id.clone();
    let text_length = payload.text.chars().count();

    let lock = shared_navigation_state().lock();
    let Ok(mut state) = lock else {
        log_manager::append_line(
            app,
            format!(
                "navigation state mutex poisoned while re-queueing prefill (source={source}, detail={detail})"
            ),
        );
        return;
    };

    state.pending_prefill = Some(payload);
    log_manager::append_line(
        app,
        format!(
            "prefill event dispatch failed and payload re-queued (source={source}, request_id={request_id}, text_length={text_length}, detail={detail})"
        ),
    );
}

fn emit_shell_route_event(app: &AppHandle, route: LocalRoute, source: &str) -> bool {
    let payload = ShellRoutePayload {
        route: route_path(route).to_string(),
        source: source.to_string(),
    };

    match app.emit_to(MAIN_WINDOW_LABEL, SHELL_ROUTE_EVENT, payload) {
        Ok(_) => true,
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "failed to emit shell route event (source={source}, route={}): {error}",
                    route_label(Some(route))
                ),
            );
            false
        }
    }
}

fn emit_prefill_event(app: &AppHandle, payload: &PrefillChatPayload, source: &str) -> bool {
    let text_length = payload.text.chars().count();
    match app.emit_to(MAIN_WINDOW_LABEL, PREFILL_CHAT_EVENT, payload) {
        Ok(_) => true,
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "failed to emit prefill event (source={source}, request_id={}, text_length={}): {error}",
                    payload.request_id, text_length
                ),
            );
            false
        }
    }
}

fn next_prefill_request_id_locked(state: &mut NavigationState) -> String {
    state.next_prefill_id = state.next_prefill_id.saturating_add(1);
    format!("prefill-{:010}", state.next_prefill_id)
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
