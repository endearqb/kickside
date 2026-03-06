use std::{
    sync::{Mutex, OnceLock},
    thread,
    time::Duration,
};

use tauri::{
    webview::PageLoadEvent, AppHandle, Emitter, LogicalSize, Manager, Size, Url,
    WebviewWindowBuilder,
};

use crate::{
    app_state::AppState,
    log_manager,
    types::{
        OpenRequestErrorPayload, PrefillChatPayload, PrefillStatusPayload, PrefillStatusState,
        ShellRoutePayload, StartupFailureKind, StartupMonitorTargetRoute, StartupPhase,
        SubmitPrefillAck, WebviewRuntimeKind, WorkspaceSessionBridgePayload,
    },
};

const MAIN_WINDOW_LABEL: &str = "main";
const SHELL_ROUTE_EVENT: &str = "shell-route";
const PREFILL_CHAT_EVENT: &str = "prefill-chat";
const PREFILL_STATUS_EVENT: &str = "prefill-status";
const OPEN_REQUEST_ERROR_EVENT: &str = "open-request-error";
const STARTUP_TRACE_LIMIT: usize = 48;
const MAIN_TASK_ENTER_TIMEOUT: Duration = Duration::from_secs(2);
const MAIN_WINDOW_READY_TIMEOUT: Duration = Duration::from_secs(3);
const FRONTEND_READY_TIMEOUT: Duration = Duration::from_secs(5);

const PREFILL_WIDTH: f64 = 720.0;
const PREFILL_HEIGHT: f64 = 420.0;
const PREFILL_MIN_WIDTH: f64 = 660.0;
const PREFILL_MIN_HEIGHT: f64 = 380.0;
const SHELL_WIDTH: f64 = 1200.0;
const SHELL_HEIGHT: f64 = 820.0;
const SHELL_MIN_WIDTH: f64 = 900.0;
const SHELL_MIN_HEIGHT: f64 = 640.0;

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
    Onboarding,
    Diagnostics,
    ControlCenter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MainWindowSurface {
    Prefill,
    Shell,
}

#[derive(Debug, Clone)]
struct NavigationState {
    stage: NavigationStage,
    route: Option<LocalRoute>,
    frontend_ready: bool,
    queued_route: Option<LocalRoute>,
    pending_prefill: Option<PrefillChatPayload>,
    pending_main_events: Vec<QueuedMainEvent>,
    next_prefill_id: u64,
    allow_process_exit: bool,
    prefill_completion_pending: bool,
    startup_pending: bool,
    startup_exit_cause: Option<String>,
    startup_attempt_id: u64,
    startup_phase: StartupPhase,
    startup_failure_kind: Option<StartupFailureKind>,
    startup_failure_detail: Option<String>,
    main_ready_watchdog_armed: bool,
    startup_guard_failed: bool,
    main_ready_watchdog_generation: u64,
    main_window_surface: MainWindowSurface,
}

impl Default for NavigationState {
    fn default() -> Self {
        Self {
            stage: NavigationStage::Init,
            route: None,
            frontend_ready: false,
            queued_route: None,
            pending_prefill: None,
            pending_main_events: Vec::new(),
            next_prefill_id: 0,
            allow_process_exit: false,
            prefill_completion_pending: false,
            startup_pending: false,
            startup_exit_cause: None,
            startup_attempt_id: 0,
            startup_phase: StartupPhase::Idle,
            startup_failure_kind: None,
            startup_failure_detail: None,
            main_ready_watchdog_armed: false,
            startup_guard_failed: false,
            main_ready_watchdog_generation: 0,
            main_window_surface: MainWindowSurface::Prefill,
        }
    }
}

#[derive(Debug, Clone)]
enum QueuedMainEvent {
    WorkspaceSession {
        event_name: String,
        payload: WorkspaceSessionBridgePayload,
    },
    OpenRequestError(OpenRequestErrorPayload),
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

enum MainWindowBootDecision {
    FinalizeNow {
        pending_prefill: Option<PrefillChatPayload>,
    },
    Deferred {
        startup_attempt_id: u64,
        arm_watchdog: bool,
        watchdog_generation: u64,
    },
}

#[derive(Debug, Clone)]
struct StartupSnapshot {
    attempt_id: u64,
    pending: bool,
    exit_cause: Option<String>,
    phase: StartupPhase,
    failure_kind: Option<StartupFailureKind>,
    failure_detail: Option<String>,
}

fn shared_navigation_state() -> &'static Mutex<NavigationState> {
    static STATE: OnceLock<Mutex<NavigationState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(NavigationState::default()))
}

pub fn create_startup_main_window(app: &AppHandle, source: &str) -> Result<(), String> {
    create_main_window_direct(app, source, MainWindowSurface::Prefill)
}

pub fn record_prefill_shown(app: &AppHandle, source: &str) {
    let snapshot = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!("navigation state mutex poisoned while recording prefill shown (source={source})"),
            );
            return;
        };

        state.main_window_surface = MainWindowSurface::Prefill;
        state.startup_phase = StartupPhase::PrefillSurfaceShown;
        state.startup_failure_kind = None;
        state.startup_failure_detail = None;
        state.startup_guard_failed = false;
        state.startup_pending = false;
        state.startup_exit_cause = None;
        snapshot_from_state(&state)
    };

    sync_runtime_startup_snapshot(app, &snapshot);
    record_startup_trace(
        app,
        format!(
            "attempt={} phase={}:{}",
            snapshot.attempt_id,
            startup_phase_label(snapshot.phase),
            source
        ),
    );
}

pub fn set_webview_runtime_info(
    app: &AppHandle,
    kind: WebviewRuntimeKind,
    version: Option<String>,
    source: &str,
) {
    let version_for_runtime = version.clone();
    with_runtime_state(app, |runtime| {
        runtime.webview_runtime_kind = kind;
        runtime.webview_runtime_version = version_for_runtime;
    });

    let version_display = version.as_deref().unwrap_or("unknown");
    log_manager::append_line(
        app,
        format!(
            "webview runtime resolved (source={source}, kind={}, version={version_display})",
            webview_runtime_kind_label(kind)
        ),
    );
}

pub fn permit_process_exit(app: &AppHandle, source: &str) {
    let lock = shared_navigation_state().lock();
    let Ok(mut state) = lock else {
        log_manager::append_line(
            app,
            format!("navigation state mutex poisoned while permitting exit (source={source})"),
        );
        return;
    };
    state.allow_process_exit = true;
    log_manager::append_line(app, format!("process exit permitted (source={source})"));
}

pub fn should_prevent_process_exit(_app: &AppHandle) -> bool {
    let lock = shared_navigation_state().lock();
    let Ok(state) = lock else {
        return false;
    };
    !state.allow_process_exit && (state.startup_pending || state.startup_guard_failed)
}

pub fn handle_main_close_requested(app: &AppHandle, source: &str) -> bool {
    let action = {
        let lock = shared_navigation_state().lock();
        let Ok(state) = lock else {
            return false;
        };

        if state.main_window_surface == MainWindowSurface::Prefill {
            1_u8
        } else if state.startup_pending && !state.allow_process_exit {
            2_u8
        } else {
            0_u8
        }
    };

    match action {
        1 => false,
        2 => {
            mark_startup_guard_failed(
                app,
                StartupFailureKind::MainCloseRequestedDuringStartup,
                "主界面在启动过程中被关闭，请重试。",
                source,
                Some("main_close_requested_during_startup"),
            );
            true
        }
        _ => false,
    }
}

pub fn complete_startup_monitor_route(
    app: &AppHandle,
    target_route: StartupMonitorTargetRoute,
    source: &str,
) -> Result<(), String> {
    match target_route {
        StartupMonitorTargetRoute::Workspace => {
            transition(
                app,
                NavigationStage::LocalBoot,
                Some(LocalRoute::Loading),
                source,
                true,
            );
            request_main_window_boot(app, &format!("{source}:startup_monitor_workspace"));
        }
        StartupMonitorTargetRoute::Onboarding => {
            transition(
                app,
                NavigationStage::ControlCenter,
                Some(LocalRoute::Onboarding),
                source,
                true,
            );
        }
        StartupMonitorTargetRoute::Diagnostics => {
            transition(
                app,
                NavigationStage::Diagnostics,
                Some(LocalRoute::Diagnostics),
                source,
                true,
            );
        }
        StartupMonitorTargetRoute::ControlCenter => {
            transition(
                app,
                NavigationStage::ControlCenter,
                Some(LocalRoute::ControlCenter),
                source,
                true,
            );
        }
    }

    Ok(())
}

pub fn handle_main_window_destroyed(app: &AppHandle, source: &str) {
    let (startup_failed, snapshot) = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned while handling main destroy (source={source})"
                ),
            );
            return;
        };

        if state.startup_pending {
            state.startup_pending = false;
            state.startup_guard_failed = true;
            state.main_ready_watchdog_armed = false;
            state.startup_phase = StartupPhase::Failed;
            state.startup_failure_kind = Some(StartupFailureKind::MainDestroyedDuringStartup);
            state.startup_failure_detail = Some("主界面在启动过程中被销毁，请重试。".to_string());
            state.startup_exit_cause = Some("main_destroyed_during_startup".to_string());
            (true, snapshot_from_state(&state))
        } else {
            (false, snapshot_from_state(&state))
        }
    };

    sync_runtime_startup_snapshot(app, &snapshot);
    if startup_failed {
        record_startup_trace(
            app,
            format!(
                "attempt={} phase=failed:{}:{}",
                snapshot.attempt_id,
                startup_failure_kind_label(
                    snapshot
                        .failure_kind
                        .unwrap_or(StartupFailureKind::MainDestroyedDuringStartup)
                ),
                source
            ),
        );
        emit_prefill_status(
            app,
            PrefillStatusState::StartupFailed,
            snapshot.failure_detail.as_deref(),
            source,
        );
        ensure_failure_fallback_window(app, &format!("{source}:destroyed_fallback"));
        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

pub fn publish_workspace_session_event(
    app: &AppHandle,
    event_name: &str,
    payload: &WorkspaceSessionBridgePayload,
    source: &str,
) {
    let should_queue = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!("navigation state mutex poisoned while publishing workspace event (source={source})"),
            );
            return;
        };

        if state.frontend_ready && app.get_webview_window(MAIN_WINDOW_LABEL).is_some() {
            false
        } else {
            state
                .pending_main_events
                .push(QueuedMainEvent::WorkspaceSession {
                    event_name: event_name.to_string(),
                    payload: payload.clone(),
                });
            true
        }
    };

    if should_queue {
        log_manager::append_line(
            app,
            format!(
                "queued workspace main event (source={source}, event={event_name}, action={})",
                payload.action
            ),
        );
        return;
    }

    if !emit_workspace_session_event(app, event_name, payload, source) {
        requeue_main_event(
            app,
            QueuedMainEvent::WorkspaceSession {
                event_name: event_name.to_string(),
                payload: payload.clone(),
            },
            source,
            "emit_failed",
        );
    }
}

pub fn publish_open_request_error(
    app: &AppHandle,
    payload: &OpenRequestErrorPayload,
    source: &str,
) {
    let should_queue = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!("navigation state mutex poisoned while publishing open-request error (source={source})"),
            );
            return;
        };

        if state.frontend_ready && app.get_webview_window(MAIN_WINDOW_LABEL).is_some() {
            false
        } else {
            state
                .pending_main_events
                .push(QueuedMainEvent::OpenRequestError(payload.clone()));
            true
        }
    };

    if should_queue {
        log_manager::append_line(
            app,
            format!(
                "queued open-request error for main window (source={source}, stage={})",
                payload.stage
            ),
        );
        return;
    }

    if !emit_open_request_error_event(app, payload, source) {
        requeue_main_event(
            app,
            QueuedMainEvent::OpenRequestError(payload.clone()),
            source,
            "emit_failed",
        );
    }
}

pub fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
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
        return;
    }

    let _ = navigate_main_window_to_shell(app, "toggle_window_auto_create", true);
}

pub fn show_and_focus(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let _ = navigate_main_window_to_shell(app, "show_and_focus_auto_create", true);
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
    let (
        accepted,
        queued_route,
        queued_main_events,
        pending_prefill,
        should_complete_prefill,
        snapshot,
    ) = {
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
        let queued_main_events = std::mem::take(&mut state.pending_main_events);
        let pending_prefill = state.pending_prefill.take();
        let should_complete_prefill = state.prefill_completion_pending;
        if should_complete_prefill {
            clear_boot_guard_locked(&mut state);
        } else {
            state.startup_pending = false;
            state.startup_exit_cause = None;
        }
        state.startup_phase = StartupPhase::FrontendReady;
        state.startup_failure_kind = None;
        state.startup_failure_detail = None;
        let snapshot = snapshot_from_state(&state);
        (
            accepted,
            queued_route,
            queued_main_events,
            pending_prefill,
            should_complete_prefill,
            snapshot,
        )
    };

    sync_runtime_startup_snapshot(app, &snapshot);
    if accepted {
        log_manager::append_line(
            app,
            format!("frontend ready acknowledged (source={source})"),
        );
        record_startup_trace(
            app,
            format!(
                "attempt={} phase={}:{}",
                snapshot.attempt_id,
                startup_phase_label(snapshot.phase),
                source
            ),
        );
    }

    if let Some(route) = queued_route {
        if !emit_shell_route_event(app, route, source) {
            requeue_route(app, route, source, "emit_failed_after_frontend_ready");
        }
    }

    flush_pending_main_events(app, queued_main_events, source);

    if should_complete_prefill {
        finalize_main_window_boot(app, pending_prefill.clone(), source);
    } else if let Some(payload) = pending_prefill.clone() {
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
        Some(LocalRoute::Onboarding),
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

pub fn recover_main_window_boot(app: &AppHandle, source: &str) -> Result<(), String> {
    let (decision, snapshot) = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            let message = format!(
                "navigation state mutex poisoned, failed to recover main window (source={source})"
            );
            log_manager::append_line(app, &message);
            return Err(message);
        };
        let decision = plan_main_window_boot_locked(&mut state, true);
        let snapshot = snapshot_from_state(&state);
        (decision, snapshot)
    };
    sync_runtime_startup_snapshot(app, &snapshot);

    match decision {
        MainWindowBootDecision::FinalizeNow { pending_prefill } => {
            log_manager::append_line(
                app,
                format!("manual main recovery completed immediately (source={source})"),
            );
            finalize_main_window_boot(app, pending_prefill, source);
            Ok(())
        }
        MainWindowBootDecision::Deferred {
            startup_attempt_id,
            watchdog_generation,
            arm_watchdog,
        } => {
            log_manager::append_line(
                app,
                format!("manual main recovery requested (source={source})"),
            );
            if arm_watchdog {
                spawn_main_ready_watchdog(
                    app.clone(),
                    startup_attempt_id,
                    watchdog_generation,
                    source.to_string(),
                );
            }
            navigate_main_window_to_shell(app, source, true)?;
            Ok(())
        }
    }
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

    request_main_window_boot(app, source);

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

fn request_main_window_boot(app: &AppHandle, source: &str) {
    let (decision, snapshot) = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned while preparing main window boot (source={source})"
                ),
            );
            return;
        };
        let decision = plan_main_window_boot_locked(&mut state, false);
        let snapshot = snapshot_from_state(&state);
        (decision, snapshot)
    };
    sync_runtime_startup_snapshot(app, &snapshot);

    match decision {
        MainWindowBootDecision::FinalizeNow { pending_prefill } => {
            log_manager::append_line(
                app,
                format!("main window boot proceeding immediately (source={source})"),
            );
            finalize_main_window_boot(app, pending_prefill, source);
        }
        MainWindowBootDecision::Deferred {
            startup_attempt_id,
            arm_watchdog,
            watchdog_generation,
        } => {
            log_manager::append_line(
                app,
                format!(
                    "main window boot deferred until frontend is ready (source={source}, watchdog_armed={arm_watchdog})"
                ),
            );
            if arm_watchdog {
                spawn_main_ready_watchdog(
                    app.clone(),
                    startup_attempt_id,
                    watchdog_generation,
                    source.to_string(),
                );
            }

            if let Err(error) = navigate_main_window_to_shell(app, source, false) {
                mark_startup_guard_failed(
                    app,
                    StartupFailureKind::MainNavigationFailed,
                    &format!("主界面导航失败：{error}"),
                    &format!("{source}:navigate_failed"),
                    Some("main_navigation_failed"),
                );
                return;
            }
        }
    }
}

fn finalize_main_window_boot(
    app: &AppHandle,
    pending_prefill: Option<PrefillChatPayload>,
    source: &str,
) {
    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = main.show();
        let _ = main.set_focus();
    }

    if let Some(payload) = pending_prefill {
        if !emit_prefill_event(app, &payload, source) {
            requeue_prefill(app, payload, source, "emit_failed_after_finalize");
        }
    }
}

fn plan_main_window_boot_locked(
    state: &mut NavigationState,
    force_rearm_watchdog: bool,
) -> MainWindowBootDecision {
    if state.frontend_ready {
        let pending_prefill = state.pending_prefill.take();
        clear_boot_guard_locked(state);
        MainWindowBootDecision::FinalizeNow { pending_prefill }
    } else {
        let should_increment_attempt = force_rearm_watchdog
            || !state.startup_pending
            || state.startup_phase == StartupPhase::Failed
            || state.main_window_surface == MainWindowSurface::Prefill;
        if should_increment_attempt {
            state.startup_attempt_id = state.startup_attempt_id.saturating_add(1);
        }

        state.prefill_completion_pending = true;
        state.startup_guard_failed = false;
        state.startup_pending = true;
        state.startup_exit_cause = None;
        state.startup_phase = StartupPhase::MainBootRequested;
        state.startup_failure_kind = None;
        state.startup_failure_detail = None;
        state.main_window_surface = MainWindowSurface::Shell;
        let arm_watchdog = force_rearm_watchdog || !state.main_ready_watchdog_armed;
        if arm_watchdog {
            state.main_ready_watchdog_armed = true;
            state.main_ready_watchdog_generation =
                state.main_ready_watchdog_generation.saturating_add(1);
        }

        MainWindowBootDecision::Deferred {
            startup_attempt_id: state.startup_attempt_id,
            arm_watchdog,
            watchdog_generation: state.main_ready_watchdog_generation,
        }
    }
}

fn clear_boot_guard_locked(state: &mut NavigationState) {
    state.prefill_completion_pending = false;
    state.startup_pending = false;
    state.startup_exit_cause = None;
    state.main_ready_watchdog_armed = false;
    state.startup_guard_failed = false;
    state.startup_phase = StartupPhase::FrontendReady;
    state.startup_failure_kind = None;
    state.startup_failure_detail = None;
}

fn spawn_main_ready_watchdog(
    app: AppHandle,
    startup_attempt_id: u64,
    watchdog_generation: u64,
    source: String,
) {
    thread::spawn(move || {
        thread::sleep(MAIN_TASK_ENTER_TIMEOUT);
        if let Some(snapshot) = watchdog_snapshot(&app, startup_attempt_id, watchdog_generation) {
            if startup_phase_rank(snapshot.phase)
                < startup_phase_rank(StartupPhase::MainBuildTaskEntered)
            {
                mark_startup_guard_failed_for_attempt(
                    &app,
                    Some(startup_attempt_id),
                    Some(watchdog_generation),
                    StartupFailureKind::MainThreadTaskStalled,
                    "主界面启动任务没有进入主线程，请重试。",
                    &format!("{source}:main_thread_task_stalled"),
                    Some("main_thread_task_stalled"),
                );
                return;
            }
        } else {
            return;
        }

        thread::sleep(MAIN_WINDOW_READY_TIMEOUT);
        if let Some(snapshot) = watchdog_snapshot(&app, startup_attempt_id, watchdog_generation) {
            if startup_phase_rank(snapshot.phase)
                < startup_phase_rank(StartupPhase::MainWindowCreated)
            {
                mark_startup_guard_failed_for_attempt(
                    &app,
                    Some(startup_attempt_id),
                    Some(watchdog_generation),
                    StartupFailureKind::MainWebviewBuildHung,
                    "主界面窗口创建超时，请重试或打开日志排查。",
                    &format!("{source}:main_webview_build_hung"),
                    Some("main_webview_build_hung"),
                );
                return;
            }
        } else {
            return;
        }

        thread::sleep(FRONTEND_READY_TIMEOUT);
        if let Some(snapshot) = watchdog_snapshot(&app, startup_attempt_id, watchdog_generation) {
            if startup_phase_rank(snapshot.phase) < startup_phase_rank(StartupPhase::FrontendReady)
            {
                mark_startup_guard_failed_for_attempt(
                    &app,
                    Some(startup_attempt_id),
                    Some(watchdog_generation),
                    StartupFailureKind::FrontendReadyTimeout,
                    "主界面加载超时，请重试或打开日志排查。",
                    &format!("{source}:frontend_ready_timeout"),
                    Some("frontend_ready_timeout"),
                );
            }
        }
    });
}

fn watchdog_snapshot(
    app: &AppHandle,
    startup_attempt_id: u64,
    watchdog_generation: u64,
) -> Option<StartupSnapshot> {
    let lock = shared_navigation_state().lock();
    let Ok(state) = lock else {
        log_manager::append_line(
            app,
            "navigation state mutex poisoned while reading watchdog snapshot",
        );
        return None;
    };

    if state.startup_attempt_id != startup_attempt_id
        || state.main_ready_watchdog_generation != watchdog_generation
        || !state.main_ready_watchdog_armed
        || state.frontend_ready
        || !state.startup_pending
        || state.startup_guard_failed
    {
        return None;
    }

    Some(snapshot_from_state(&state))
}

fn mark_startup_guard_failed(
    app: &AppHandle,
    kind: StartupFailureKind,
    detail: &str,
    source: &str,
    exit_cause: Option<&str>,
) {
    mark_startup_guard_failed_for_attempt(app, None, None, kind, detail, source, exit_cause);
}

fn mark_startup_guard_failed_for_attempt(
    app: &AppHandle,
    expected_attempt_id: Option<u64>,
    expected_watchdog_generation: Option<u64>,
    kind: StartupFailureKind,
    detail: &str,
    source: &str,
    exit_cause: Option<&str>,
) {
    let exit_cause_owned = exit_cause.map(|value| value.to_string());
    let snapshot = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned while setting startup guard failure (source={source})"
                ),
            );
            return;
        };

        if let Some(expected) = expected_attempt_id {
            if state.startup_attempt_id != expected {
                return;
            }
        }
        if let Some(expected) = expected_watchdog_generation {
            if state.main_ready_watchdog_generation != expected {
                return;
            }
        }
        if state.frontend_ready || state.startup_phase == StartupPhase::FrontendReady {
            return;
        }

        state.prefill_completion_pending = true;
        state.startup_pending = false;
        state.main_ready_watchdog_armed = false;
        state.startup_guard_failed = true;
        state.startup_phase = StartupPhase::Failed;
        state.startup_failure_kind = Some(kind);
        state.startup_failure_detail = Some(detail.to_string());
        state.startup_exit_cause = exit_cause_owned.clone();
        snapshot_from_state(&state)
    };

    sync_runtime_startup_snapshot(app, &snapshot);
    record_startup_trace(
        app,
        format!(
            "attempt={} phase=failed:{}:{}",
            snapshot.attempt_id,
            startup_failure_kind_label(kind),
            source
        ),
    );
    log_manager::append_line(
        app,
        format!(
            "startup guard failed (source={source}, kind={}): {detail}",
            startup_failure_kind_label(kind)
        ),
    );

    ensure_failure_fallback_window(app, &format!("{source}:failure_fallback"));
    emit_prefill_status(app, PrefillStatusState::StartupFailed, Some(detail), source);
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn ensure_failure_fallback_window(app: &AppHandle, source: &str) {
    if app.get_webview_window(MAIN_WINDOW_LABEL).is_some() {
        return;
    }

    if let Err(error) = create_main_window_direct(app, source, MainWindowSurface::Prefill) {
        log_manager::append_line(
            app,
            format!("failed to create startup failure fallback window (source={source}): {error}"),
        );
    }
}

fn create_main_window_direct(
    app: &AppHandle,
    source: &str,
    surface: MainWindowSurface,
) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        apply_window_surface(app, &existing, surface, source);
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW_LABEL)
        .cloned()
        .ok_or_else(|| "main window config is missing".to_string())?;

    if surface == MainWindowSurface::Shell {
        advance_startup_phase(app, StartupPhase::MainConfigLoaded, source);
    }

    let app_for_load = app.clone();
    let builder = WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| format!("failed to construct main builder: {error}"))?
        .on_page_load(move |_window, payload| {
            let url = payload.url().to_string();
            if !is_shell_document_url(&url) {
                return;
            }

            match payload.event() {
                PageLoadEvent::Started => {
                    advance_startup_phase(
                        &app_for_load,
                        StartupPhase::MainPageLoadStarted,
                        &format!("main_page_load_started:{url}"),
                    );
                }
                PageLoadEvent::Finished => {
                    advance_startup_phase(
                        &app_for_load,
                        StartupPhase::MainPageLoadFinished,
                        &format!("main_page_load_finished:{url}"),
                    );
                }
            }
        });

    if surface == MainWindowSurface::Shell {
        advance_startup_phase(app, StartupPhase::MainBuilderConstructed, source);
        advance_startup_phase(app, StartupPhase::MainBuildStarted, source);
    }

    let window = builder
        .build()
        .map_err(|error| format!("failed to build main window: {error}"))?;

    apply_window_surface(app, &window, surface, source);

    if surface == MainWindowSurface::Shell {
        advance_startup_phase(app, StartupPhase::MainWindowCreated, source);
        let loading_url = shell_loading_url()?;
        window
            .navigate(loading_url)
            .map_err(|error| format!("failed to navigate shell loading page: {error}"))?;
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }

    log_manager::append_line(
        app,
        format!(
            "main window prepared (source={source}, surface={})",
            main_window_surface_label(surface)
        ),
    );

    Ok(())
}

fn navigate_main_window_to_shell(
    app: &AppHandle,
    source: &str,
    _force_rearm_watchdog: bool,
) -> Result<(), String> {
    advance_startup_phase(app, StartupPhase::MainBuildTaskPosted, source);

    let app_handle = app.clone();
    let source_owned = source.to_string();
    app.run_on_main_thread(move || {
        run_main_shell_navigation_on_main_thread(&app_handle, &source_owned);
    })
    .map_err(|error| format!("failed to schedule main window navigation: {error}"))
}

fn run_main_shell_navigation_on_main_thread(app: &AppHandle, source: &str) {
    advance_startup_phase(app, StartupPhase::MainBuildTaskEntered, source);

    if app.get_webview_window(MAIN_WINDOW_LABEL).is_none() {
        if let Err(error) = create_main_window_direct(app, source, MainWindowSurface::Shell) {
            mark_startup_guard_failed(
                app,
                StartupFailureKind::MainWindowMissing,
                &format!("主界面窗口创建失败：{error}"),
                &format!("{source}:main_window_create_failed"),
                Some("main_window_create_failed"),
            );
        }
        return;
    }

    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        mark_startup_guard_failed(
            app,
            StartupFailureKind::MainWindowMissing,
            "主界面窗口不存在，请重试。",
            &format!("{source}:main_window_missing"),
            Some("main_window_missing"),
        );
        return;
    };

    advance_startup_phase(app, StartupPhase::MainConfigLoaded, source);
    apply_window_surface(app, &window, MainWindowSurface::Shell, source);
    advance_startup_phase(app, StartupPhase::MainBuilderConstructed, source);
    advance_startup_phase(app, StartupPhase::MainBuildStarted, source);

    match shell_loading_url() {
        Ok(url) => {
            if let Err(error) = window.navigate(url) {
                mark_startup_guard_failed(
                    app,
                    StartupFailureKind::MainNavigationFailed,
                    &format!("主界面导航失败：{error}"),
                    &format!("{source}:main_window_navigate_failed"),
                    Some("main_navigation_failed"),
                );
                return;
            }
        }
        Err(error) => {
            mark_startup_guard_failed(
                app,
                StartupFailureKind::MainNavigationFailed,
                &format!("主界面地址解析失败：{error}"),
                &format!("{source}:main_window_url_parse_failed"),
                Some("main_navigation_failed"),
            );
            return;
        }
    }

    advance_startup_phase(app, StartupPhase::MainWindowCreated, source);
    let _ = window.show();
    let _ = window.set_focus();
}

fn apply_window_surface(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    surface: MainWindowSurface,
    source: &str,
) {
    let (width, height, min_width, min_height, decorations) = match surface {
        MainWindowSurface::Prefill => (
            PREFILL_WIDTH,
            PREFILL_HEIGHT,
            PREFILL_MIN_WIDTH,
            PREFILL_MIN_HEIGHT,
            false,
        ),
        MainWindowSurface::Shell => (
            SHELL_WIDTH,
            SHELL_HEIGHT,
            SHELL_MIN_WIDTH,
            SHELL_MIN_HEIGHT,
            false,
        ),
    };

    if let Err(error) = window.set_decorations(decorations) {
        log_manager::append_line(
            app,
            format!(
                "failed to set window decorations (source={source}, surface={}): {error}",
                main_window_surface_label(surface)
            ),
        );
    }
    #[cfg(target_os = "windows")]
    if let Err(error) = window.set_shadow(true) {
        log_manager::append_line(
            app,
            format!(
                "failed to set window shadow (source={source}, surface={}): {error}",
                main_window_surface_label(surface)
            ),
        );
    }
    if let Err(error) =
        window.set_min_size(Some(Size::Logical(LogicalSize::new(min_width, min_height))))
    {
        log_manager::append_line(
            app,
            format!(
                "failed to set window min size (source={source}, surface={}): {error}",
                main_window_surface_label(surface)
            ),
        );
    }
    if let Err(error) = window.set_size(Size::Logical(LogicalSize::new(width, height))) {
        log_manager::append_line(
            app,
            format!(
                "failed to set window size (source={source}, surface={}): {error}",
                main_window_surface_label(surface)
            ),
        );
    }
    let _ = window.center();
}

fn shell_loading_url() -> Result<Url, String> {
    Url::parse("http://tauri.localhost/index.html#/loading")
        .map_err(|error| format!("invalid shell loading url: {error}"))
}

fn snapshot_from_state(state: &NavigationState) -> StartupSnapshot {
    StartupSnapshot {
        attempt_id: state.startup_attempt_id,
        pending: state.startup_pending,
        exit_cause: state.startup_exit_cause.clone(),
        phase: state.startup_phase,
        failure_kind: state.startup_failure_kind,
        failure_detail: state.startup_failure_detail.clone(),
    }
}

fn sync_runtime_startup_snapshot(app: &AppHandle, snapshot: &StartupSnapshot) {
    let snapshot = snapshot.clone();
    with_runtime_state(app, move |runtime| {
        runtime.startup_pending = snapshot.pending;
        runtime.startup_exit_cause = snapshot.exit_cause;
        runtime.startup_attempt_id = snapshot.attempt_id;
        runtime.startup_phase = snapshot.phase;
        runtime.startup_failure_kind = snapshot.failure_kind;
        runtime.startup_failure_detail = snapshot.failure_detail;
    });
}

fn advance_startup_phase(
    app: &AppHandle,
    next_phase: StartupPhase,
    source: &str,
) -> Option<StartupSnapshot> {
    let snapshot = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned while advancing startup phase (source={source})"
                ),
            );
            return None;
        };

        if state.startup_attempt_id == 0
            || state.startup_phase == StartupPhase::Failed
            || startup_phase_rank(next_phase) <= startup_phase_rank(state.startup_phase)
        {
            return None;
        }

        state.startup_phase = next_phase;
        state.startup_failure_kind = None;
        state.startup_failure_detail = None;
        Some(snapshot_from_state(&state))
    }?;

    sync_runtime_startup_snapshot(app, &snapshot);
    record_startup_trace(
        app,
        format!(
            "attempt={} phase={}:{}",
            snapshot.attempt_id,
            startup_phase_label(snapshot.phase),
            source
        ),
    );
    Some(snapshot)
}

fn is_shell_document_url(url: &str) -> bool {
    url.contains("index.html#/loading") || url.contains("index.html")
}

fn startup_phase_rank(phase: StartupPhase) -> u8 {
    match phase {
        StartupPhase::Idle => 0,
        StartupPhase::PrefillSurfaceShown => 1,
        StartupPhase::MainBootRequested => 2,
        StartupPhase::MainBuildTaskPosted => 3,
        StartupPhase::MainBuildTaskEntered => 4,
        StartupPhase::MainConfigLoaded => 5,
        StartupPhase::MainBuilderConstructed => 6,
        StartupPhase::MainBuildStarted => 7,
        StartupPhase::MainWindowCreated => 8,
        StartupPhase::MainPageLoadStarted => 9,
        StartupPhase::MainPageLoadFinished => 10,
        StartupPhase::FrontendReady => 11,
        StartupPhase::Failed => 12,
    }
}

fn startup_phase_label(phase: StartupPhase) -> &'static str {
    match phase {
        StartupPhase::Idle => "idle",
        StartupPhase::PrefillSurfaceShown => "prefill_surface_shown",
        StartupPhase::MainBootRequested => "main_boot_requested",
        StartupPhase::MainBuildTaskPosted => "main_build_task_posted",
        StartupPhase::MainBuildTaskEntered => "main_build_task_entered",
        StartupPhase::MainConfigLoaded => "main_config_loaded",
        StartupPhase::MainBuilderConstructed => "main_builder_constructed",
        StartupPhase::MainBuildStarted => "main_build_started",
        StartupPhase::MainWindowCreated => "main_window_created",
        StartupPhase::MainPageLoadStarted => "main_page_load_started",
        StartupPhase::MainPageLoadFinished => "main_page_load_finished",
        StartupPhase::FrontendReady => "frontend_ready",
        StartupPhase::Failed => "failed",
    }
}

fn startup_failure_kind_label(kind: StartupFailureKind) -> &'static str {
    match kind {
        StartupFailureKind::MainThreadTaskStalled => "main_thread_task_stalled",
        StartupFailureKind::MainWebviewBuildHung => "main_webview_build_hung",
        StartupFailureKind::FrontendReadyTimeout => "frontend_ready_timeout",
        StartupFailureKind::MainNavigationFailed => "main_navigation_failed",
        StartupFailureKind::MainWindowMissing => "main_window_missing",
        StartupFailureKind::MainDestroyedDuringStartup => "main_destroyed_during_startup",
        StartupFailureKind::MainCloseRequestedDuringStartup => {
            "main_close_requested_during_startup"
        }
    }
}

fn main_window_surface_label(surface: MainWindowSurface) -> &'static str {
    match surface {
        MainWindowSurface::Prefill => "prefill",
        MainWindowSurface::Shell => "shell",
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

    if matches!(
        route,
        Some(LocalRoute::Onboarding | LocalRoute::Diagnostics | LocalRoute::ControlCenter)
    ) {
        request_main_window_boot(app, &format!("{source}:route_requires_main"));
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

fn requeue_main_event(app: &AppHandle, event: QueuedMainEvent, source: &str, detail: &str) {
    let lock = shared_navigation_state().lock();
    let Ok(mut state) = lock else {
        log_manager::append_line(
            app,
            format!(
                "navigation state mutex poisoned while re-queueing main event (source={source}, detail={detail})"
            ),
        );
        return;
    };

    state.pending_main_events.push(event);
    log_manager::append_line(
        app,
        format!("main event dispatch failed and was re-queued (source={source}, detail={detail})"),
    );
}

fn flush_pending_main_events(app: &AppHandle, events: Vec<QueuedMainEvent>, source: &str) {
    for event in events {
        let dispatched = match &event {
            QueuedMainEvent::WorkspaceSession {
                event_name,
                payload,
            } => emit_workspace_session_event(app, event_name, payload, source),
            QueuedMainEvent::OpenRequestError(payload) => {
                emit_open_request_error_event(app, payload, source)
            }
        };

        if !dispatched {
            requeue_main_event(app, event, source, "flush_failed_after_frontend_ready");
        }
    }
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

fn emit_workspace_session_event(
    app: &AppHandle,
    event_name: &str,
    payload: &WorkspaceSessionBridgePayload,
    source: &str,
) -> bool {
    match app.emit_to(MAIN_WINDOW_LABEL, event_name, payload) {
        Ok(_) => true,
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "failed to emit workspace event (source={source}, event={event_name}, action={}): {error}",
                    payload.action
                ),
            );
            false
        }
    }
}

fn emit_open_request_error_event(
    app: &AppHandle,
    payload: &OpenRequestErrorPayload,
    source: &str,
) -> bool {
    match app.emit_to(MAIN_WINDOW_LABEL, OPEN_REQUEST_ERROR_EVENT, payload) {
        Ok(_) => true,
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "failed to emit open-request error event (source={source}, stage={}): {error}",
                    payload.stage
                ),
            );
            false
        }
    }
}

fn emit_prefill_status(
    app: &AppHandle,
    state: PrefillStatusState,
    detail: Option<&str>,
    source: &str,
) -> bool {
    let payload = PrefillStatusPayload {
        state,
        detail: detail.map(|value| value.to_string()),
    };

    match app.emit_to(MAIN_WINDOW_LABEL, PREFILL_STATUS_EVENT, payload) {
        Ok(_) => true,
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "failed to emit prefill status event (source={source}, state={}): {error}",
                    prefill_status_label(state)
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

fn with_runtime_state<T>(
    app: &AppHandle,
    f: impl FnOnce(&mut crate::app_state::RuntimeState) -> T,
) -> Option<T> {
    let state = app.state::<AppState>();
    let lock = state.runtime.lock();
    let Ok(mut runtime) = lock else {
        log_manager::append_line(app, "runtime state mutex is poisoned");
        return None;
    };
    Some(f(&mut runtime))
}

fn record_startup_trace(app: &AppHandle, event: String) {
    let trace_event = event.clone();
    with_runtime_state(app, move |runtime| {
        runtime.startup_trace.push(trace_event);
        let overflow = runtime
            .startup_trace
            .len()
            .saturating_sub(STARTUP_TRACE_LIMIT);
        if overflow > 0 {
            runtime.startup_trace.drain(0..overflow);
        }
    });
    log_manager::append_line(app, format!("startup trace -> {event}"));
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
        Some(LocalRoute::Onboarding) => "onboarding",
        Some(LocalRoute::Diagnostics) => "diagnostics",
        Some(LocalRoute::ControlCenter) => "control_center",
        None => "none",
    }
}

fn route_path(route: LocalRoute) -> &'static str {
    match route {
        LocalRoute::Loading => "loading",
        LocalRoute::Onboarding => "onboarding",
        LocalRoute::Diagnostics => "diagnostics",
        LocalRoute::ControlCenter => "control-center",
    }
}

fn prefill_status_label(state: PrefillStatusState) -> &'static str {
    match state {
        PrefillStatusState::Idle => "idle",
        PrefillStatusState::OpeningMain => "opening_main",
        PrefillStatusState::StartupFailed => "startup_failed",
    }
}

fn webview_runtime_kind_label(kind: WebviewRuntimeKind) -> &'static str {
    match kind {
        WebviewRuntimeKind::Evergreen => "evergreen",
        WebviewRuntimeKind::Fixed => "fixed",
        WebviewRuntimeKind::Unknown => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload() -> PrefillChatPayload {
        PrefillChatPayload {
            request_id: "prefill-0000000001".to_string(),
            text: "hello".to_string(),
            auto_send: true,
        }
    }

    #[test]
    fn deferred_main_boot_arms_watchdog_and_sets_startup_pending() {
        let mut state = NavigationState::default();
        state.pending_prefill = Some(sample_payload());

        let decision = plan_main_window_boot_locked(&mut state, false);

        match decision {
            MainWindowBootDecision::Deferred {
                startup_attempt_id,
                arm_watchdog,
                watchdog_generation,
            } => {
                assert_eq!(startup_attempt_id, 1);
                assert!(arm_watchdog);
                assert_eq!(watchdog_generation, 1);
            }
            MainWindowBootDecision::FinalizeNow { .. } => {
                panic!("expected deferred boot");
            }
        }

        assert!(state.prefill_completion_pending);
        assert!(state.startup_pending);
        assert!(state.main_ready_watchdog_armed);
        assert!(!state.startup_guard_failed);
        assert!(state.startup_exit_cause.is_none());
        assert_eq!(state.startup_phase, StartupPhase::MainBootRequested);
        assert_eq!(state.main_window_surface, MainWindowSurface::Shell);
    }

    #[test]
    fn manual_recovery_rearms_watchdog_with_new_generation() {
        let mut state = NavigationState::default();
        state.main_ready_watchdog_armed = true;
        state.main_ready_watchdog_generation = 4;
        state.prefill_completion_pending = true;
        state.startup_pending = true;
        state.startup_guard_failed = true;
        state.startup_attempt_id = 9;
        state.startup_phase = StartupPhase::Failed;
        state.startup_exit_cause = Some("previous_failure".to_string());

        let decision = plan_main_window_boot_locked(&mut state, true);

        match decision {
            MainWindowBootDecision::Deferred {
                startup_attempt_id,
                arm_watchdog,
                watchdog_generation,
            } => {
                assert_eq!(startup_attempt_id, 10);
                assert!(arm_watchdog);
                assert_eq!(watchdog_generation, 5);
            }
            MainWindowBootDecision::FinalizeNow { .. } => {
                panic!("expected deferred boot");
            }
        }

        assert!(state.main_ready_watchdog_armed);
        assert!(state.startup_pending);
        assert!(!state.startup_guard_failed);
        assert!(state.startup_exit_cause.is_none());
        assert_eq!(state.startup_phase, StartupPhase::MainBootRequested);
    }

    #[test]
    fn ready_boot_clears_guard_and_returns_pending_payload() {
        let mut state = NavigationState::default();
        state.frontend_ready = true;
        state.pending_prefill = Some(sample_payload());
        state.prefill_completion_pending = true;
        state.startup_pending = true;
        state.main_ready_watchdog_armed = true;
        state.startup_guard_failed = true;
        state.startup_exit_cause = Some("timeout".to_string());

        let decision = plan_main_window_boot_locked(&mut state, false);

        match decision {
            MainWindowBootDecision::FinalizeNow { pending_prefill } => {
                assert!(pending_prefill.is_some());
            }
            MainWindowBootDecision::Deferred { .. } => {
                panic!("expected immediate finalization");
            }
        }

        assert!(!state.prefill_completion_pending);
        assert!(!state.startup_pending);
        assert!(!state.main_ready_watchdog_armed);
        assert!(!state.startup_guard_failed);
        assert!(state.startup_exit_cause.is_none());
        assert_eq!(state.startup_phase, StartupPhase::FrontendReady);
    }

    #[test]
    fn clear_boot_guard_resets_startup_state() {
        let mut state = NavigationState::default();
        state.prefill_completion_pending = true;
        state.startup_pending = true;
        state.main_ready_watchdog_armed = true;
        state.startup_guard_failed = true;
        state.startup_phase = StartupPhase::Failed;
        state.startup_failure_kind = Some(StartupFailureKind::FrontendReadyTimeout);
        state.startup_failure_detail = Some("timeout".to_string());
        state.startup_exit_cause = Some("close_requested".to_string());

        clear_boot_guard_locked(&mut state);

        assert!(!state.prefill_completion_pending);
        assert!(!state.startup_pending);
        assert!(!state.main_ready_watchdog_armed);
        assert!(!state.startup_guard_failed);
        assert!(state.startup_exit_cause.is_none());
        assert_eq!(state.startup_phase, StartupPhase::FrontendReady);
        assert!(state.startup_failure_kind.is_none());
        assert!(state.startup_failure_detail.is_none());
    }

    #[test]
    fn closing_prefill_surface_is_not_handled_as_enter_shell() {
        let mut state = NavigationState::default();
        state.main_window_surface = MainWindowSurface::Prefill;

        let action = if state.main_window_surface == MainWindowSurface::Prefill {
            1_u8
        } else if state.startup_pending && !state.allow_process_exit {
            2_u8
        } else {
            0_u8
        };

        assert_eq!(action, 1);
    }
}
