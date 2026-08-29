mod acp;
mod agent_room_event_pump;
#[allow(dead_code)]
mod api_v1_client;
mod app_state;
mod auth_state;
mod backend_manager;
mod bridge_host_control;
mod bridge_http_client;
mod bridge_manager;
mod bridge_settings_store;
mod command_utils;
mod commands;
mod context_menu;
mod dsh_manager;
mod enhanced_web;
mod feishu_onboarding;
mod harness;
mod install_manager;
mod kimi_access;
mod kimi_locator;
mod lan_access;
mod log_manager;
mod menu_manager;
mod native_file_drop;
mod nodejs_locator;
mod onboarding_http;
mod open_request;
mod platform;
mod port_manager;
mod runtime_locator;
mod scheduler;
mod settings_store;
mod shortcut_manager;
mod skill_center;
mod skill_center_store;
mod skill_projection;
mod token_resolver;
mod tray_manager;
mod types;
mod weixin_onboarding;
mod window_manager;
mod workspace_import;
#[allow(dead_code)]
mod workspace_session;
mod workspaces;

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Instant;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_global_shortcut::ShortcutState;
use url::Url;

use app_state::{unix_time_millis, AppState};
use types::{
    AppSettings, AppStatus, BackendState, DiagnosticsInfo, FrontendReadyAck,
    KimiCodeAccessConfigInput, KimiCodeAccessConfigTestInput, KimiCodeAccessConfigTestResult,
    KimiCodeAccessConfigView, KimiCodeAuthResult, KimiDoctorResult, KimiLoginHealthSource,
    KimiLoginHealthState, MainWindowCloseBehavior, MainWindowCloseDecisionInput, OnboardingStatus,
    OnboardingStep, ShutdownProgressPayload, StartupMonitorReason, StartupMonitorState,
    StartupMonitorStatus, StartupMonitorTargetRoute, SubmitPrefillAck, WebviewRuntimeKind,
    WorkspaceWebSettingsInput, WorkspaceWebSettingsView, CURRENT_ONBOARDING_VERSION,
};

const SHUTDOWN_PROGRESS_EVENT: &str = "shutdown-progress";

#[tauri::command]
fn get_app_status(app: AppHandle) -> Result<AppStatus, String> {
    let settings = settings_store::load_or_default(&app).unwrap_or_default();
    let logs_dir = log_manager::ensure_logs_dir(&app).map_err(|error| error.to_string())?;
    let auth_snapshot =
        auth_state::resolve_auth_mode_snapshot(&app, settings.onboarding_step_acks.login_verified)?;
    auth_state::sync_runtime_auth_snapshot(&app, &auth_snapshot)?;
    let kimi_login_health =
        auth_state::read_runtime_login_health(&app, settings.onboarding_step_acks.login_verified)?;
    let provider_api_health = auth_state::read_runtime_provider_api_health(&app)?;
    let enhanced_web_health = enhanced_web::health(&settings);

    let shared = app.state::<AppState>();
    let instance_id = shared.instance_id.clone();
    let pid = shared.pid;
    let started_at = shared.started_at.clone();
    let is_hotkey_owner = shared.hotkey_owner;

    let (
        state,
        runtime_ownership,
        start_cycle_id,
        active_port,
        workspace_port,
        base_port,
        loading_startup_ms,
        backend_ready_ms,
        loading_sla_met,
        message,
        detected_kimi_path,
        effective_work_dir,
        active_session_id,
        active_session_work_dir,
        session_source,
        runtime_origin,
        server_token_path,
        server_token_redacted,
        workspace_url,
        startup_attempt_id,
        startup_phase,
        startup_failure_kind,
        startup_failure_detail,
        startup_monitor_state,
        startup_monitor_reason,
        startup_monitor_target_route,
        startup_monitor_detail,
    ) = {
        let runtime = shared
            .runtime
            .lock()
            .map_err(|_| "runtime state mutex is poisoned".to_string())?;
        let loading_startup_ms = diff_millis(
            runtime.start_requested_at_ms,
            runtime.loading_reported_at_ms,
        );
        let backend_ready_ms =
            diff_millis(runtime.start_requested_at_ms, runtime.backend_ready_at_ms);
        (
            runtime.state,
            runtime.runtime_ownership,
            runtime.start_cycle_id,
            runtime.active_port,
            runtime.workspace_port,
            runtime.base_port,
            loading_startup_ms,
            backend_ready_ms,
            loading_startup_ms.map(|ms| ms <= 1_000),
            runtime.last_error.clone(),
            runtime
                .detected_kimi_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            runtime
                .effective_work_dir
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            runtime.active_session_id.clone(),
            runtime
                .active_session_work_dir
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            runtime.session_source.clone(),
            runtime.runtime_origin.clone(),
            runtime
                .server_token_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            runtime.server_token_redacted.clone(),
            runtime.workspace_url.clone(),
            runtime.startup_attempt_id,
            runtime.startup_phase,
            runtime.startup_failure_kind,
            runtime.startup_failure_detail.clone(),
            runtime.startup_monitor_state,
            runtime.startup_monitor_reason,
            runtime.startup_monitor_target_route,
            runtime.startup_monitor_detail.clone(),
        )
    };

    let workspace_url_redacted = redact_workspace_url(workspace_url.as_deref());

    Ok(AppStatus {
        instance_id,
        pid,
        started_at,
        is_hotkey_owner,
        start_cycle_id,
        state,
        runtime_ownership,
        active_port,
        workspace_port,
        base_port,
        loading_startup_ms,
        backend_ready_ms,
        loading_sla_met,
        message,
        detected_kimi_path,
        configured_kimi_path: settings.kimi_path,
        configured_work_dir: settings.work_dir,
        effective_work_dir,
        active_session_id,
        active_session_work_dir,
        session_source,
        runtime_origin,
        server_token_path,
        server_token_redacted,
        workspace_url: workspace_url_redacted.clone(),
        workspace_url_redacted,
        startup_attempt_id,
        startup_phase,
        startup_failure_kind,
        startup_failure_detail,
        startup_monitor_state,
        startup_monitor_reason,
        startup_monitor_target_route,
        startup_monitor_detail,
        auth_mode: auth_snapshot.auth_mode,
        provider_api_configured: auth_snapshot.provider_api_configured,
        provider_api_active_provider: auth_snapshot.provider_api_active_provider,
        kimi_login_health,
        provider_api_health,
        workspace_web_mode: settings.workspace_web_mode,
        enhanced_web_source_commit: Some(enhanced_web::SOURCE_COMMIT.to_string()),
        enhanced_web_health,
        enhanced_web_last_fallback_reason: settings.enhanced_web_last_fallback_reason,
        logs_dir: logs_dir.to_string_lossy().to_string(),
        hotkey: settings.hotkey,
    })
}

#[tauri::command]
fn retry_start_backend(app: AppHandle) {
    if let Err(error) = window_manager::prepare_for_backend_restart(&app, "retry_start_backend") {
        log_manager::append_line(
            &app,
            format!("failed to prepare dual-window startup retry: {error}"),
        );
    }
    backend_manager::restart_backend(app);
}

#[tauri::command]
fn restart_backend_runtime_only(app: AppHandle) -> Result<(), String> {
    let settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    let effective_work_dir = {
        let state = app.state::<AppState>();
        let runtime = state
            .runtime
            .lock()
            .map_err(|_| "runtime state mutex is poisoned".to_string())?;
        runtime
            .effective_work_dir
            .as_ref()
            .map(|path| path.display().to_string())
    };
    let configured_work_dir = settings.work_dir.clone();
    let configured_display = configured_work_dir.as_deref().unwrap_or("<default>");
    let effective_display = effective_work_dir.as_deref().unwrap_or("<none>");

    log_manager::append_line(
        &app,
        format!(
            "runtime-only backend restart requested (source=restart_backend_runtime_only, configured_work_dir={configured_display}, effective_work_dir={effective_display})"
        ),
    );

    backend_manager::restart_backend(app);
    Ok(())
}

#[tauri::command]
fn get_workspace_embed_url(app: AppHandle) -> Result<Option<String>, String> {
    let shared = app.state::<AppState>();
    let runtime = shared
        .runtime
        .lock()
        .map_err(|_| "runtime state mutex is poisoned".to_string())?;

    Ok(runtime.workspace_url.clone().or_else(|| {
        runtime
            .workspace_port
            .or(runtime.active_port)
            .map(|port| format!("http://127.0.0.1:{port}"))
    }))
}

#[tauri::command]
fn report_loading_rendered(app: AppHandle, start_cycle_id: Option<u64>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "runtime state mutex is poisoned".to_string())?;

    let cycle_id = start_cycle_id.unwrap_or(runtime.start_cycle_id);
    if cycle_id != runtime.start_cycle_id {
        return Ok(());
    }
    if runtime.loading_reported_at_ms.is_none() {
        runtime.loading_reported_at_ms = Some(unix_time_millis());
        runtime.loading_reported_cycle_id = Some(cycle_id);
    }
    drop(runtime);

    window_manager::complete_pending_prefill_handoff(&app, "report_loading_rendered_invoke");

    Ok(())
}

#[tauri::command]
fn notify_frontend_ready(app: AppHandle) -> Result<FrontendReadyAck, String> {
    let transition = window_manager::mark_frontend_ready(&app, "frontend_ready_invoke");

    let (backend_state, start_cycle_id, workspace_url) = {
        let state = app.state::<AppState>();
        let runtime = state
            .runtime
            .lock()
            .map_err(|_| "runtime state mutex is poisoned".to_string())?;

        let workspace_url = runtime.workspace_url.clone().or_else(|| {
            runtime
                .workspace_port
                .or(runtime.active_port)
                .map(|port| format!("http://127.0.0.1:{port}"))
        });

        (runtime.state, runtime.start_cycle_id, workspace_url)
    };

    Ok(FrontendReadyAck {
        accepted: transition.accepted,
        backend_state,
        workspace_url,
        start_cycle_id,
        pending_prefill: transition.pending_prefill,
    })
}

#[tauri::command]
fn get_startup_monitor_status(app: AppHandle) -> Result<StartupMonitorStatus, String> {
    let settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;

    let status = {
        let state = app.state::<AppState>();
        let runtime = state
            .runtime
            .lock()
            .map_err(|_| "runtime state mutex is poisoned".to_string())?;

        build_startup_monitor_status(
            runtime.state,
            runtime.workspace_port,
            runtime.start_requested_at_ms,
            runtime.startup_open_request_applied,
            settings.onboarding_completed_version,
            unix_time_millis(),
        )
    };

    record_startup_monitor_observation(&app, &status, "get_startup_monitor_status_invoke");
    Ok(status)
}

#[tauri::command]
fn complete_startup_monitor_route(
    app: AppHandle,
    target_route: StartupMonitorTargetRoute,
) -> Result<(), String> {
    window_manager::complete_startup_monitor_route(
        &app,
        target_route,
        "complete_startup_monitor_route_invoke",
    )
}

#[tauri::command]
fn submit_prefill(app: AppHandle, text: String) -> Result<SubmitPrefillAck, String> {
    Ok(window_manager::submit_prefill(
        &app,
        text,
        "submit_prefill_invoke",
    ))
}

#[tauri::command]
fn recover_main_window_boot(app: AppHandle) -> Result<(), String> {
    window_manager::recover_main_window_boot(&app, "recover_main_window_boot_invoke")
}

#[tauri::command]
fn quit_app_gracefully(app: AppHandle) {
    start_graceful_exit(app, "quit_app_gracefully_invoke");
}

#[tauri::command]
fn get_main_window_close_behavior(app: AppHandle) -> Result<MainWindowCloseBehavior, String> {
    let settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    Ok(settings.main_window_close_behavior)
}

#[tauri::command]
fn save_main_window_close_behavior(
    app: AppHandle,
    behavior: MainWindowCloseBehavior,
) -> Result<MainWindowCloseBehavior, String> {
    let mut settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    settings.main_window_close_behavior = behavior;
    settings_store::save(&app, &settings).map_err(|error| error.to_string())?;
    Ok(settings.main_window_close_behavior)
}

#[tauri::command]
fn get_workspace_web_settings(app: AppHandle) -> Result<WorkspaceWebSettingsView, String> {
    enhanced_web::settings_view(&app)
}

#[tauri::command]
fn save_workspace_web_settings(
    app: AppHandle,
    input: WorkspaceWebSettingsInput,
) -> Result<WorkspaceWebSettingsView, String> {
    enhanced_web::save_settings(&app, input)
}

#[tauri::command]
fn fallback_workspace_web_to_official(
    app: AppHandle,
    reason: String,
) -> Result<WorkspaceWebSettingsView, String> {
    enhanced_web::fallback_to_official(&app, &reason)
}

#[tauri::command]
fn mark_enhanced_web_ready(app: AppHandle) -> Result<WorkspaceWebSettingsView, String> {
    enhanced_web::mark_enhanced_ready(&app)
}

#[tauri::command]
fn submit_main_window_close_decision(
    app: AppHandle,
    input: MainWindowCloseDecisionInput,
) -> Result<(), String> {
    let outcome = window_manager::apply_main_window_close_decision(
        &app,
        input,
        "submit_main_window_close_decision_invoke",
    )?;
    if matches!(
        outcome,
        window_manager::MainWindowCloseDecisionOutcome::Exit
    ) {
        start_graceful_exit(app, "main_close_decision_confirmed_exit");
    }
    Ok(())
}

#[tauri::command]
fn save_kimi_path(app: AppHandle, path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("kimi path cannot be empty".to_string());
    }

    let executable = PathBuf::from(trimmed);
    if !executable.exists() {
        return Err(format!(
            "kimi executable path does not exist: {}",
            executable.display()
        ));
    }

    let mut settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    settings.kimi_path = Some(executable.to_string_lossy().to_string());
    settings_store::save(&app, &settings).map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn save_work_dir(app: AppHandle, path: String) -> Result<(), String> {
    let trimmed = path.trim();

    let mut settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    let previous_work_dir = settings.work_dir.clone();
    let next_work_dir = if trimmed.is_empty() {
        None
    } else {
        let work_dir = PathBuf::from(trimmed);
        if !work_dir.exists() {
            return Err(format!(
                "work directory does not exist: {}",
                work_dir.display()
            ));
        }
        if !work_dir.is_dir() {
            return Err(format!(
                "work directory is not a folder: {}",
                work_dir.display()
            ));
        }
        Some(work_dir.to_string_lossy().to_string())
    };

    let _bridge_settings =
        bridge_settings_store::load_or_default(&app).map_err(|error| error.to_string())?;

    settings.work_dir = next_work_dir;

    settings_store::save(&app, &settings).map_err(|error| error.to_string())?;
    bridge_settings_store::sync_default_work_dir_from_app(&app, previous_work_dir)
        .map_err(|error| error.to_string())?;
    backend_manager::set_session_work_dir(&app, None).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    backend_manager::open_logs_folder(&app)
}

#[tauri::command]
fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    backend_manager::open_external_url(&app, &url)
}

#[tauri::command]
fn open_system_terminal() -> Result<(), String> {
    backend_manager::open_system_terminal()
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    backend_manager::open_folder(&path)
}

#[tauri::command]
fn open_kimi_config_dir() -> Result<(), String> {
    backend_manager::open_kimi_config_dir()
}

fn sync_provider_api_snapshot_after_config_change(app: &AppHandle) -> Result<(), String> {
    auth_state::reset_provider_api_health(app)?;
    let settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    let auth_snapshot =
        auth_state::resolve_auth_mode_snapshot(app, settings.onboarding_step_acks.login_verified)?;
    auth_state::sync_runtime_auth_snapshot(app, &auth_snapshot)?;
    Ok(())
}

#[tauri::command]
async fn load_kimi_code_access_config(app: AppHandle) -> Result<KimiCodeAccessConfigView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        backend_manager::load_kimi_code_access_config(&app)
    })
    .await
    .map_err(|error| format!("failed to join access config load task: {error}"))?
}

#[tauri::command]
async fn save_kimi_code_access_config(
    app: AppHandle,
    input: KimiCodeAccessConfigInput,
) -> Result<KimiCodeAccessConfigView, String> {
    let settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    let kimi_path = resolve_kimi_path_for_login(&app, &settings)?;
    tauri::async_runtime::spawn_blocking(move || {
        let view = backend_manager::save_kimi_code_access_config(&app, input, &kimi_path)?;
        sync_provider_api_snapshot_after_config_change(&app)?;
        Ok(view)
    })
    .await
    .map_err(|error| format!("failed to join access config save task: {error}"))?
}

#[tauri::command]
async fn test_kimi_code_access_config(
    app: AppHandle,
    input: KimiCodeAccessConfigTestInput,
) -> Result<KimiCodeAccessConfigTestResult, String> {
    backend_manager::test_kimi_code_access_config(&app, input).await
}

#[tauri::command]
fn get_diagnostics(app: AppHandle) -> Result<DiagnosticsInfo, String> {
    let settings = settings_store::load_or_default(&app).unwrap_or_default();
    let logs_dir = log_manager::ensure_logs_dir(&app).map_err(|error| error.to_string())?;
    let app_log_path = log_manager::app_log_path(&app).map_err(|error| error.to_string())?;
    let backend_log_path =
        log_manager::backend_log_path(&app).map_err(|error| error.to_string())?;
    let auth_snapshot =
        auth_state::resolve_auth_mode_snapshot(&app, settings.onboarding_step_acks.login_verified)?;
    auth_state::sync_runtime_auth_snapshot(&app, &auth_snapshot)?;
    let kimi_login_health =
        auth_state::read_runtime_login_health(&app, settings.onboarding_step_acks.login_verified)?;
    let provider_api_health = auth_state::read_runtime_provider_api_health(&app)?;
    let enhanced_web_health = enhanced_web::health(&settings);
    let shared = app.state::<AppState>();
    let instance_id = shared.instance_id.clone();
    let pid = shared.pid;
    let started_at = shared.started_at.clone();
    let is_hotkey_owner = shared.hotkey_owner;

    let (
        state,
        start_cycle_id,
        active_port,
        workspace_port,
        base_port,
        loading_startup_ms,
        backend_ready_ms,
        loading_sla_met,
        last_error,
        last_exit_reason,
        detected_kimi_path,
        effective_work_dir,
        launch_command,
        runtime_origin,
        server_token_path,
        server_token_redacted,
        workspace_url,
        webview_runtime_kind,
        webview_runtime_version,
        startup_pending,
        startup_exit_cause,
        main_create_mode,
        startup_attempt_id,
        startup_phase,
        startup_failure_kind,
        startup_failure_detail,
        startup_monitor_state,
        startup_monitor_reason,
        startup_monitor_target_route,
        startup_monitor_detail,
        startup_trace,
    ) = {
        let runtime = shared
            .runtime
            .lock()
            .map_err(|_| "runtime state mutex is poisoned".to_string())?;
        let loading_startup_ms = diff_millis(
            runtime.start_requested_at_ms,
            runtime.loading_reported_at_ms,
        );
        let backend_ready_ms =
            diff_millis(runtime.start_requested_at_ms, runtime.backend_ready_at_ms);
        (
            runtime.state,
            runtime.start_cycle_id,
            runtime.active_port,
            runtime.workspace_port,
            runtime.base_port,
            loading_startup_ms,
            backend_ready_ms,
            loading_startup_ms.map(|ms| ms <= 1_000),
            runtime.last_error.clone(),
            runtime.last_exit_reason.clone(),
            runtime
                .detected_kimi_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            runtime
                .effective_work_dir
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            runtime.launch_command.clone(),
            runtime.runtime_origin.clone(),
            runtime
                .server_token_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            runtime.server_token_redacted.clone(),
            runtime.workspace_url.clone(),
            runtime.webview_runtime_kind,
            runtime.webview_runtime_version.clone(),
            runtime.startup_pending,
            runtime.startup_exit_cause.clone(),
            runtime.main_create_mode,
            runtime.startup_attempt_id,
            runtime.startup_phase,
            runtime.startup_failure_kind,
            runtime.startup_failure_detail.clone(),
            runtime.startup_monitor_state,
            runtime.startup_monitor_reason,
            runtime.startup_monitor_target_route,
            runtime.startup_monitor_detail.clone(),
            runtime.startup_trace.clone(),
        )
    };

    let kimi_for_version = settings
        .kimi_path
        .as_ref()
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .or_else(|| detected_kimi_path.clone());

    let (kimi_version, version_error) = match kimi_for_version {
        Some(path) => match query_kimi_version(&path) {
            Ok(version) => (Some(version), None),
            Err(error) => (None, Some(error)),
        },
        None => (
            None,
            Some("No kimi executable path available for version check.".to_string()),
        ),
    };

    let workspace_url_redacted = redact_workspace_url(workspace_url.as_deref());

    Ok(DiagnosticsInfo {
        instance_id,
        pid,
        started_at,
        is_hotkey_owner,
        start_cycle_id,
        state,
        active_port,
        workspace_port,
        base_port,
        loading_startup_ms,
        backend_ready_ms,
        loading_sla_met,
        configured_kimi_path: settings.kimi_path,
        detected_kimi_path,
        configured_work_dir: settings.work_dir,
        effective_work_dir,
        launch_command,
        runtime_origin,
        server_token_path,
        server_token_redacted,
        workspace_url: workspace_url_redacted.clone(),
        workspace_url_redacted,
        kimi_version,
        version_error,
        last_error,
        last_exit_reason,
        webview_runtime_kind,
        webview_runtime_version,
        startup_pending,
        startup_exit_cause,
        main_create_mode,
        startup_attempt_id,
        startup_phase,
        startup_failure_kind,
        startup_failure_detail,
        startup_monitor_state,
        startup_monitor_reason,
        startup_monitor_target_route,
        startup_monitor_detail,
        auth_mode: auth_snapshot.auth_mode,
        provider_api_configured: auth_snapshot.provider_api_configured,
        provider_api_active_provider: auth_snapshot.provider_api_active_provider,
        kimi_login_health,
        provider_api_health,
        workspace_web_mode: settings.workspace_web_mode,
        enhanced_web_source_commit: Some(enhanced_web::SOURCE_COMMIT.to_string()),
        enhanced_web_health,
        enhanced_web_last_fallback_reason: settings.enhanced_web_last_fallback_reason,
        startup_trace,
        app_log_path: app_log_path.to_string_lossy().to_string(),
        backend_log_path: backend_log_path.to_string_lossy().to_string(),
        app_log_tail: backend_manager::redact_backend_lines(log_manager::read_log_tail(
            &app_log_path,
            60,
        )),
        backend_log_tail: backend_manager::redact_backend_lines(log_manager::read_log_tail(
            &backend_log_path,
            60,
        )),
        log_tail: backend_manager::redact_backend_lines(log_manager::read_log_tail(
            &backend_log_path,
            80,
        )),
        logs_dir: logs_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn get_onboarding_status(app: AppHandle) -> Result<OnboardingStatus, String> {
    build_onboarding_status(&app)
}

#[tauri::command]
fn complete_onboarding(app: AppHandle) -> Result<(), String> {
    mark_onboarding_completed(&app)?;
    Ok(())
}

#[tauri::command]
fn skip_onboarding(app: AppHandle) -> Result<(), String> {
    mark_onboarding_completed(&app)?;
    Ok(())
}

#[tauri::command]
fn ack_api_config_step(app: AppHandle, acknowledged: Option<bool>) -> Result<(), String> {
    let mut settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    settings.onboarding_step_acks.api_config_ack = acknowledged.unwrap_or(true);
    settings_store::save(&app, &settings).map_err(|error| error.to_string())
}

#[derive(Debug, Default, Deserialize)]
struct KimiCodeAuthSummary {
    #[serde(default)]
    ready: bool,
    #[serde(default, alias = "managedProvider")]
    managed_provider: Option<KimiCodeManagedProviderAuth>,
}

#[derive(Debug, Default, Deserialize)]
struct KimiCodeManagedProviderAuth {
    #[serde(default)]
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct KimiCodeOAuthFlowStart {
    user_code: String,
    verification_uri_complete: String,
    expires_in: u64,
}

#[tauri::command]
fn start_kimi_code_auth(app: AppHandle) -> Result<KimiCodeAuthResult, String> {
    let client = workspace_session::require_runtime_api_client(&app)?;
    let flow = client
        .post::<_, KimiCodeOAuthFlowStart>("oauth/login", &json!({}))
        .map_err(|error| format!("POST `/api/v1/oauth/login` failed: {error:#}"))?;
    backend_manager::open_external_url(&app, &flow.verification_uri_complete)?;
    let message = kimi_code_login_message(&flow);
    auth_state::update_kimi_login_health(
        &app,
        KimiLoginHealthState::AuthRequired,
        KimiLoginHealthSource::WorkspaceApi,
        message.clone(),
        None,
    )?;

    Ok(KimiCodeAuthResult {
        state: types::KimiCodeAuthState::LoginRequired,
        message,
        kimi_path: current_runtime_kimi_path(&app),
        exit_code: None,
    })
}

#[tauri::command]
fn refresh_kimi_code_auth(app: AppHandle) -> Result<KimiCodeAuthResult, String> {
    load_kimi_code_auth(&app)
}

fn load_kimi_code_auth(app: &AppHandle) -> Result<KimiCodeAuthResult, String> {
    let client = match workspace_session::require_runtime_api_client(app) {
        Ok(client) => client,
        Err(error) => {
            let message = format!("Kimi Code Server 尚未就绪，无法刷新认证状态：{error}");
            auth_state::update_kimi_login_health(
                app,
                KimiLoginHealthState::Unknown,
                KimiLoginHealthSource::WorkspaceApi,
                message.clone(),
                None,
            )?;
            return Ok(KimiCodeAuthResult {
                state: types::KimiCodeAuthState::Unknown,
                message,
                kimi_path: current_runtime_kimi_path(app),
                exit_code: None,
            });
        }
    };

    let summary = match client.get::<KimiCodeAuthSummary>("auth") {
        Ok(summary) => summary,
        Err(error) => {
            let message = format!("Kimi Code Server `/api/v1/auth` 请求失败：{error:#}");
            auth_state::update_kimi_login_health(
                app,
                KimiLoginHealthState::Error,
                KimiLoginHealthSource::WorkspaceApi,
                message.clone(),
                None,
            )?;
            return Ok(KimiCodeAuthResult {
                state: types::KimiCodeAuthState::Unknown,
                message,
                kimi_path: current_runtime_kimi_path(app),
                exit_code: None,
            });
        }
    };

    let health_state = if summary.ready {
        KimiLoginHealthState::Verified
    } else {
        KimiLoginHealthState::AuthRequired
    };
    let message = kimi_code_auth_message(&summary);
    auth_state::update_kimi_login_health(
        app,
        health_state,
        KimiLoginHealthSource::WorkspaceApi,
        message.clone(),
        None,
    )?;

    Ok(KimiCodeAuthResult {
        state: auth_state::kimi_code_auth_state_from_health(health_state),
        message,
        kimi_path: current_runtime_kimi_path(app),
        exit_code: None,
    })
}

fn kimi_code_auth_message(summary: &KimiCodeAuthSummary) -> String {
    let managed_status = summary
        .managed_provider
        .as_ref()
        .and_then(|provider| provider.status.as_deref())
        .map(str::trim)
        .filter(|status| !status.is_empty())
        .unwrap_or("-");

    if summary.ready {
        format!("Kimi Code Server 认证已就绪（managed provider: {managed_status}）。")
    } else {
        format!("Kimi Code Server 认证未就绪（managed provider: {managed_status}）。请在官方 Kimi Code 界面完成登录后刷新。")
    }
}

fn kimi_code_login_message(flow: &KimiCodeOAuthFlowStart) -> String {
    format!(
        "已打开 Kimi Code 登录页面。验证码：{}；有效期约 {} 秒。",
        flow.user_code, flow.expires_in
    )
}

fn current_runtime_kimi_path(app: &AppHandle) -> Option<String> {
    let state = app.state::<AppState>();
    let runtime = state.runtime.lock().ok()?;
    runtime
        .detected_kimi_path
        .as_ref()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn run_kimi_doctor(app: AppHandle) -> Result<KimiDoctorResult, String> {
    let settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    let kimi_path = resolve_kimi_path_for_login(&app, &settings)?;
    let shell_path = kimi_locator::locate_shell_path();

    let mut process = Command::new(&kimi_path);
    command_utils::configure_kimi_query_command(&mut process);
    process
        .arg("doctor")
        .stdin(Stdio::null())
        .env("NO_COLOR", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1");
    if let Some(path) = shell_path.as_ref() {
        process.env("KIMI_SHELL_PATH", path);
    }

    let output = process
        .output()
        .map_err(|error| format!("failed to run `{} doctor`: {}", kimi_path.display(), error))?;
    let secrets = collect_kimi_doctor_redaction_values();
    let stdout = redact_and_limit_doctor_output(&String::from_utf8_lossy(&output.stdout), &secrets);
    let stderr = redact_and_limit_doctor_output(&String::from_utf8_lossy(&output.stderr), &secrets);

    Ok(KimiDoctorResult {
        succeeded: output.status.success(),
        exit_code: output.status.code(),
        command: format!("{} doctor", kimi_path.display()),
        kimi_path: kimi_path.to_string_lossy().to_string(),
        shell_path: shell_path.map(|path| path.to_string_lossy().to_string()),
        stdout,
        stderr,
    })
}

#[tauri::command]
fn logout_kimi_code_auth(app: AppHandle) -> Result<KimiCodeAuthResult, String> {
    let client = workspace_session::require_runtime_api_client(&app)?;
    client
        .post_empty("oauth/logout", &json!({}))
        .map_err(|error| format!("POST `/api/v1/oauth/logout` failed: {error:#}"))?;
    let message = "已通过 Kimi Code Server 注销登录。".to_string();
    auth_state::update_kimi_login_health(
        &app,
        KimiLoginHealthState::AuthRequired,
        KimiLoginHealthSource::WorkspaceApi,
        message.clone(),
        None,
    )?;

    Ok(KimiCodeAuthResult {
        state: types::KimiCodeAuthState::LoginRequired,
        message,
        kimi_path: current_runtime_kimi_path(&app),
        exit_code: None,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shortcut = shortcut_manager::default_shortcut();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            open_request::handle_external_cli_request(app.clone(), args, Some(cwd));
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, active_shortcut, event| {
                    if event.state() == ShortcutState::Pressed && active_shortcut == &shortcut {
                        window_manager::toggle_window(app);
                    }
                })
                .build(),
        )
        .on_menu_event(|app, event| menu_manager::handle_menu_event(app, &event))
        .setup(|app| {
            let shared = AppState::new(app.handle())?;
            let hotkey_owner = shared.hotkey_owner;
            let pid = shared.pid;
            app.manage(shared);
            app.manage(agent_room_event_pump::AgentRoomEventPump::default());
            app.manage(install_manager::InstallManager::default());

            if let Err(error) = bridge_settings_store::ensure_bridge_files(app.handle()) {
                log_manager::append_line(
                    app.handle(),
                    format!("failed to initialize bridge settings files: {error:#}"),
                );
            }
            if let Err(error) = skill_center::initialize(app.handle()) {
                log_manager::append_line(
                    app.handle(),
                    format!("failed to initialize skill center: {error:#}"),
                );
            }
            scheduler::start(app.handle().clone());

            menu_manager::setup_app_menu(app.handle())?;
            tray_manager::setup_tray(app.handle())?;
            if hotkey_owner {
                if let Err(error) = shortcut_manager::register_default_hotkey(app.handle()) {
                    log_manager::append_line(
                        app.handle(),
                        format!("global hotkey unavailable; continuing without it: {error:#}"),
                    );
                }
            }

            if hotkey_owner {
                log_manager::append_line(
                    app.handle(),
                    format!("instance initialized (pid={pid}, hotkey_owner=true)"),
                );
            } else {
                log_manager::append_line(
                    app.handle(),
                    format!("instance initialized (pid={pid}, hotkey_owner=false, skipped hotkey registration)"),
                );
            }

            window_manager::create_prefill_window(app.handle(), "setup_prefill_window")
                .map_err(anyhow::Error::msg)?;
            window_manager::record_prefill_shown(app.handle(), "setup");
            window_manager::create_hidden_main_window(app.handle(), "setup_hidden_main")
                .map_err(anyhow::Error::msg)?;
            initialize_webview_runtime_info(app.handle());
            auto_repair_context_menu(app.handle());

            open_request::apply_startup_cli_request(app.handle());
            window_manager::enter_local_boot(app.handle(), "setup_bootstrap");
            backend_manager::start_backend(app.handle().clone());
            dsh_manager::start_default_workspace_if_enabled(app.handle().clone());

            {
                let app_handle = app.handle().clone();
                thread::spawn(move || {
                    let settings = match bridge_settings_store::load_or_default(&app_handle) {
                        Ok(settings) => settings,
                        Err(error) => {
                            log_manager::append_line(
                                &app_handle,
                                format!("failed to load bridge settings for auto start: {error:#}"),
                            );
                            return;
                        }
                    };

                    let agent_room_enabled = bridge_manager::agent_room_feature_enabled(&app_handle);
                    if (settings.enabled && settings.auto_start) || agent_room_enabled {
                        if let Err(error) = bridge_manager::start_bridge(&app_handle) {
                            log_manager::append_line(
                                &app_handle,
                                format!("bridge auto start failed: {error:#}"),
                            );
                        } else if agent_room_enabled {
                            agent_room_event_pump::ensure_started(&app_handle);
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(commands::invoke_handler())
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent { label, event, .. } => {
            if label == window_manager::MAIN_WINDOW_LABEL {
                #[cfg(target_os = "macos")]
                if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop {
                    paths,
                    position,
                }) = &event
                {
                    if let Err(error) = native_file_drop::publish_drop(app_handle, paths, *position)
                    {
                        log_manager::append_line(
                            app_handle,
                            format!("native file drop rejected: {error}"),
                        );
                    }
                }
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        #[cfg(target_os = "macos")]
                        window_manager::hide_main_window(app_handle, "macos_main_close_requested");
                        #[cfg(not(target_os = "macos"))]
                        {
                            if !window_manager::handle_main_close_requested(
                                app_handle,
                                "main_close_requested",
                            ) {
                                start_graceful_exit(app_handle.clone(), "main_close_requested");
                            }
                        }
                    }
                    tauri::WindowEvent::Destroyed => {
                        window_manager::handle_main_window_destroyed(app_handle, "main_destroyed");
                    }
                    _ => {}
                }
            } else if label == window_manager::PREFILL_WINDOW_LABEL {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        if window_manager::allow_prefill_close_request(
                            app_handle,
                            "prefill_close_requested",
                        ) {
                            return;
                        }
                        api.prevent_close();
                        start_graceful_exit(app_handle.clone(), "prefill_close_requested");
                    }
                    tauri::WindowEvent::Destroyed => {
                        window_manager::handle_prefill_window_destroyed(
                            app_handle,
                            "prefill_destroyed",
                        );
                    }
                    _ => {}
                }
            } else if label == window_manager::WORKSPACE_IMPORT_PICKER_WINDOW_LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    window_manager::handle_workspace_import_picker_close_requested(
                        app_handle,
                        "workspace_import_picker_close_requested",
                    );
                }
            } else if label == window_manager::AGENT_ROOM_WINDOW_LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Err(error) = window_manager::hide_agent_room_window(app_handle) {
                        log_manager::append_line(
                            app_handle,
                            format!("failed to hide Agent Room window on close: {error}"),
                        );
                    }
                }
            }
        }
        RunEvent::ExitRequested { api, .. } => {
            if window_manager::should_prevent_process_exit(app_handle) {
                api.prevent_exit();
                log_manager::append_line(
                    app_handle,
                    "prevented process exit because startup is still pending",
                );
                return;
            }
            agent_room_event_pump::stop(app_handle);
            if let Err(error) = dsh_manager::stop(app_handle) {
                api.prevent_exit();
                log_manager::append_line(
                    app_handle,
                    format!("prevented process exit because DSH stop failed: {error:#}"),
                );
                return;
            }
            if should_attempt_stop_backend(app_handle) {
                if let Err(error) = backend_manager::stop_backend(app_handle) {
                    api.prevent_exit();
                    log_manager::append_line(
                        app_handle,
                        format!("prevented process exit because backend stop failed: {error:#}"),
                    );
                    return;
                }
            }
            if should_attempt_stop_bridge(app_handle) {
                let _ = bridge_manager::stop_bridge(app_handle);
            }
        }
        RunEvent::Exit => {
            agent_room_event_pump::stop(app_handle);
            let _ = dsh_manager::stop(app_handle);
            if should_attempt_stop_backend(app_handle) {
                let _ = backend_manager::stop_backend(app_handle);
            }
            if should_attempt_stop_bridge(app_handle) {
                let _ = bridge_manager::stop_bridge(app_handle);
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            window_manager::show_and_focus(app_handle);
        }
        _ => {}
    });
}

fn build_onboarding_status(app: &AppHandle) -> Result<OnboardingStatus, String> {
    let settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    let context_status = context_menu::status(app);
    let auth_snapshot =
        auth_state::resolve_auth_mode_snapshot(app, settings.onboarding_step_acks.login_verified)?;
    auth_state::sync_runtime_auth_snapshot(app, &auth_snapshot)?;
    let kimi_login_health =
        auth_state::read_runtime_login_health(app, settings.onboarding_step_acks.login_verified)?;
    let provider_api_health = auth_state::read_runtime_provider_api_health(app)?;

    let (runtime_state, startup_open_request_applied, runtime_detected_kimi_path) = {
        let state = app.state::<AppState>();
        let runtime = state
            .runtime
            .lock()
            .map_err(|_| "runtime state mutex is poisoned".to_string())?;
        (
            runtime.state,
            runtime.startup_open_request_applied,
            runtime
                .detected_kimi_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
        )
    };

    let located_kimi_path = kimi_locator::locate(&settings)
        .ok()
        .map(|path| path.to_string_lossy().to_string());
    let kimi_installed = located_kimi_path.is_some();
    let detected_kimi_path = runtime_detected_kimi_path.or(located_kimi_path);

    let kimi_code_auth_state =
        auth_state::kimi_code_auth_state_from_health(kimi_login_health.state);
    let kimi_code_auth_message = if kimi_login_health.message.trim().is_empty() {
        None
    } else {
        Some(kimi_login_health.message.clone())
    };
    let auth_ready = kimi_login_health.state == KimiLoginHealthState::Verified
        || (auth_snapshot.provider_api_configured && !provider_api_health.needs_attention);

    let work_dir = settings
        .work_dir
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let work_dir_configured = work_dir.is_some();
    let api_config_ack = settings.onboarding_step_acks.api_config_ack;

    let should_show_onboarding =
        should_show_onboarding(&settings, startup_open_request_applied, runtime_state);
    let recommended_step = recommend_onboarding_step(
        runtime_state,
        kimi_installed,
        context_status.supported,
        context_status.enabled || !settings.context_menu_desired_enabled,
        auth_ready,
        work_dir_configured,
        api_config_ack,
    );

    Ok(OnboardingStatus {
        current_version: CURRENT_ONBOARDING_VERSION,
        completed_version: settings.onboarding_completed_version,
        should_show_onboarding,
        launch_blocked_by_onboarding: false,
        startup_open_request_applied,
        recommended_step,
        kimi_installed,
        detected_kimi_path,
        context_menu_supported: context_status.supported,
        context_menu_enabled: context_status.enabled,
        context_menu_message: context_status.message,
        auth_mode: auth_snapshot.auth_mode,
        provider_api_configured: auth_snapshot.provider_api_configured,
        provider_api_active_provider: auth_snapshot.provider_api_active_provider,
        kimi_login_health,
        provider_api_health,
        kimi_code_auth_state,
        kimi_code_auth_message,
        work_dir_configured,
        work_dir,
        api_config_ack,
    })
}

fn build_startup_monitor_status(
    backend_state: BackendState,
    workspace_port: Option<u16>,
    start_requested_at_ms: Option<u64>,
    startup_open_request_applied: bool,
    onboarding_completed_version: u32,
    now_ms: u64,
) -> StartupMonitorStatus {
    const STARTUP_MONITOR_TIMEOUT_MS: u64 = 60_000;

    let elapsed_ms = start_requested_at_ms
        .and_then(|start| now_ms.checked_sub(start))
        .unwrap_or(0);
    let onboarding_required =
        onboarding_completed_version < CURRENT_ONBOARDING_VERSION && !startup_open_request_applied;
    let workspace_ready =
        matches!(backend_state, BackendState::Running) && workspace_port.is_some();

    if matches!(backend_state, BackendState::MissingKimi) {
        return StartupMonitorStatus {
            state: StartupMonitorState::RouteControlCenter,
            reason: StartupMonitorReason::MissingKimi,
            elapsed_ms,
            backend_state,
            detail: Some("未检测到 Kimi Code，正在进入引导配置。".to_string()),
            target_route: Some(StartupMonitorTargetRoute::Onboarding),
        };
    }

    if matches!(backend_state, BackendState::Crashed) {
        return StartupMonitorStatus {
            state: StartupMonitorState::RouteControlCenter,
            reason: StartupMonitorReason::BackendCrashed,
            elapsed_ms,
            backend_state,
            detail: Some("后端启动失败，正在进入诊断页。".to_string()),
            target_route: Some(StartupMonitorTargetRoute::Diagnostics),
        };
    }

    if onboarding_required {
        return StartupMonitorStatus {
            state: StartupMonitorState::RouteControlCenter,
            reason: StartupMonitorReason::OnboardingRequired,
            elapsed_ms,
            backend_state,
            detail: Some("检测到首次安装或需要引导，正在进入控制中心。".to_string()),
            target_route: Some(StartupMonitorTargetRoute::Onboarding),
        };
    }

    if workspace_ready {
        return StartupMonitorStatus {
            state: StartupMonitorState::RouteWorkspace,
            reason: StartupMonitorReason::BackendReady,
            elapsed_ms,
            backend_state,
            detail: Some("后端已就绪，正在进入工作区。".to_string()),
            target_route: Some(StartupMonitorTargetRoute::Workspace),
        };
    }

    if elapsed_ms >= STARTUP_MONITOR_TIMEOUT_MS {
        return StartupMonitorStatus {
            state: StartupMonitorState::Failed,
            reason: StartupMonitorReason::StartupTimeout,
            elapsed_ms,
            backend_state,
            detail: Some("后端启动超时，请重试或打开日志排查。".to_string()),
            target_route: None,
        };
    }

    StartupMonitorStatus {
        state: StartupMonitorState::Waiting,
        reason: StartupMonitorReason::Starting,
        elapsed_ms,
        backend_state,
        detail: Some("正在等待后端启动完成。".to_string()),
        target_route: None,
    }
}

fn record_startup_monitor_observation(
    app: &AppHandle,
    status: &StartupMonitorStatus,
    source: &str,
) {
    let log_key = format!(
        "{}:{}:{}:{}",
        startup_monitor_state_label(status.state),
        startup_monitor_reason_label(status.reason),
        status
            .target_route
            .map(startup_monitor_target_route_label)
            .unwrap_or("none"),
        status.detail.as_deref().unwrap_or("")
    );

    let should_log = {
        let state = app.state::<AppState>();
        let Ok(mut runtime) = state.runtime.lock() else {
            log_manager::append_line(
                app,
                format!(
                    "runtime state mutex is poisoned while recording startup monitor status (source={source})"
                ),
            );
            return;
        };

        runtime.startup_monitor_state = Some(status.state);
        runtime.startup_monitor_reason = Some(status.reason);
        runtime.startup_monitor_target_route = status.target_route;
        runtime.startup_monitor_detail = status.detail.clone();

        if runtime.startup_monitor_log_key.as_deref() == Some(log_key.as_str()) {
            false
        } else {
            runtime.startup_monitor_log_key = Some(log_key.clone());
            true
        }
    };

    if !should_log {
        return;
    }

    let log_line = match status.state {
        StartupMonitorState::Waiting => "startup_monitor_waiting".to_string(),
        StartupMonitorState::RouteWorkspace => "startup_monitor_route_workspace".to_string(),
        StartupMonitorState::RouteControlCenter => format!(
            "startup_monitor_route_control_center:{}",
            status
                .target_route
                .map(startup_monitor_target_route_label)
                .unwrap_or("control_center")
        ),
        StartupMonitorState::Failed => format!(
            "startup_monitor_failed:{}",
            startup_monitor_reason_label(status.reason)
        ),
    };

    log_manager::append_line(
        app,
        format!(
            "{log_line} (source={source}, backend_state={}, elapsed_ms={})",
            format_backend_state_label(status.backend_state),
            status.elapsed_ms
        ),
    );
}

fn should_show_onboarding(
    settings: &AppSettings,
    startup_open_request_applied: bool,
    runtime_state: BackendState,
) -> bool {
    if matches!(
        runtime_state,
        BackendState::MissingKimi | BackendState::Crashed
    ) {
        return true;
    }

    settings.onboarding_completed_version < CURRENT_ONBOARDING_VERSION
        && !startup_open_request_applied
}

fn recommend_onboarding_step(
    runtime_state: BackendState,
    kimi_installed: bool,
    context_menu_supported: bool,
    context_menu_enabled: bool,
    auth_ready: bool,
    work_dir_configured: bool,
    api_config_ack: bool,
) -> OnboardingStep {
    if matches!(runtime_state, BackendState::MissingKimi) || !kimi_installed {
        return OnboardingStep::InstallKimi;
    }
    if context_menu_supported && !context_menu_enabled {
        return OnboardingStep::ContextMenu;
    }
    if !auth_ready {
        return OnboardingStep::LoginKimi;
    }
    if !work_dir_configured {
        return OnboardingStep::WorkDir;
    }
    if !api_config_ack {
        return OnboardingStep::ApiConfig;
    }
    OnboardingStep::Done
}

fn format_backend_state_label(state: BackendState) -> &'static str {
    match state {
        BackendState::Stopped => "stopped",
        BackendState::Starting => "starting",
        BackendState::Running => "running",
        BackendState::Crashed => "crashed",
        BackendState::Stopping => "stopping",
        BackendState::MissingKimi => "missing_kimi",
    }
}

fn startup_monitor_state_label(state: StartupMonitorState) -> &'static str {
    match state {
        StartupMonitorState::Waiting => "waiting",
        StartupMonitorState::RouteWorkspace => "route_workspace",
        StartupMonitorState::RouteControlCenter => "route_control_center",
        StartupMonitorState::Failed => "failed",
    }
}

fn startup_monitor_reason_label(reason: StartupMonitorReason) -> &'static str {
    match reason {
        StartupMonitorReason::Starting => "starting",
        StartupMonitorReason::OnboardingRequired => "onboarding_required",
        StartupMonitorReason::MissingKimi => "missing_kimi",
        StartupMonitorReason::BackendCrashed => "backend_crashed",
        StartupMonitorReason::BackendReady => "backend_ready",
        StartupMonitorReason::StartupTimeout => "startup_timeout",
    }
}

fn startup_monitor_target_route_label(route: StartupMonitorTargetRoute) -> &'static str {
    match route {
        StartupMonitorTargetRoute::Workspace => "workspace",
        StartupMonitorTargetRoute::Onboarding => "onboarding",
        StartupMonitorTargetRoute::Diagnostics => "diagnostics",
        StartupMonitorTargetRoute::ControlCenter => "control_center",
    }
}

fn mark_onboarding_completed(app: &AppHandle) -> Result<(), String> {
    let mut settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    settings.onboarding_completed_version = CURRENT_ONBOARDING_VERSION;
    settings_store::save(app, &settings).map_err(|error| error.to_string())
}

fn resolve_kimi_path_for_login(app: &AppHandle, settings: &AppSettings) -> Result<PathBuf, String> {
    if let Some(configured) = settings
        .kimi_path
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(configured);
        if path.exists() {
            return Ok(path);
        }
        return Err(format!(
            "configured kimi path does not exist: {}",
            path.display()
        ));
    }

    {
        let state = app.state::<AppState>();
        let runtime = state
            .runtime
            .lock()
            .map_err(|_| "runtime state mutex is poisoned".to_string())?;
        if let Some(path) = runtime.detected_kimi_path.clone() {
            return Ok(path);
        }
    }

    kimi_locator::locate(settings).map_err(|error| error.to_string())
}

fn collect_kimi_doctor_redaction_values() -> Vec<String> {
    let mut values = Vec::new();
    for key in [
        "KIMI_API_KEY",
        "MOONSHOT_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "AZURE_OPENAI_API_KEY",
    ] {
        if let Ok(value) = std::env::var(key) {
            push_doctor_redaction_value(&mut values, Some(value.as_str()));
        }
    }

    if let Ok(secrets) = backend_manager::collect_kimi_code_access_secret_values() {
        for secret in secrets {
            push_doctor_redaction_value(&mut values, Some(secret.as_str()));
        }
    }

    values.sort_by_key(|value| std::cmp::Reverse(value.len()));
    values.dedup();
    values
}

fn push_doctor_redaction_value(values: &mut Vec<String>, value: Option<&str>) {
    let Some(trimmed) = value.map(str::trim).filter(|value| value.len() >= 4) else {
        return;
    };
    if trimmed.starts_with("${") || trimmed.contains("[REDACTED]") {
        return;
    }
    values.push(trimmed.to_string());
}

fn redact_and_limit_doctor_output(output: &str, secrets: &[String]) -> String {
    let mut redacted = output.trim().to_string();
    for secret in secrets {
        redacted = redacted.replace(secret, "[REDACTED]");
    }
    redacted = backend_manager::redact_backend_text(&redacted);

    let max_chars = 12_000usize;
    if redacted.chars().count() <= max_chars {
        return redacted;
    }

    let truncated: String = redacted.chars().take(max_chars).collect();
    format!("{truncated}\n...[truncated]")
}

fn redact_workspace_url(url: Option<&str>) -> Option<String> {
    let raw = url?.trim();
    if raw.is_empty() {
        return None;
    }

    if let Ok(mut parsed) = Url::parse(raw) {
        if parsed.fragment().is_some() {
            parsed.set_fragment(Some("token=[REDACTED]"));
        }
        return Some(parsed.to_string());
    }

    raw.find('#')
        .map(|index| format!("{}#[REDACTED]", &raw[..index]))
        .or_else(|| Some(raw.to_string()))
}

fn query_kimi_version(kimi_path: &str) -> Result<String, String> {
    let mut process = Command::new(kimi_path);
    command_utils::configure_kimi_query_command(&mut process);
    let output = process
        .arg("--version")
        .output()
        .map_err(|error| format!("failed to run `{} --version`: {}", kimi_path, error))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        if !stdout.is_empty() {
            return Ok(stdout);
        }
        if !stderr.is_empty() {
            return Ok(stderr);
        }
        return Ok("No version output".to_string());
    }

    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "unknown error".to_string()
    };
    Err(format!(
        "`{} --version` failed ({}): {}",
        kimi_path, output.status, detail
    ))
}

fn diff_millis(start_ms: Option<u64>, end_ms: Option<u64>) -> Option<u64> {
    let start = start_ms?;
    let end = end_ms?;
    end.checked_sub(start)
}

fn compiled_webview_runtime_kind() -> WebviewRuntimeKind {
    match option_env!("KIMI_WEBVIEW_RUNTIME_KIND")
        .unwrap_or("evergreen")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "fixed" => WebviewRuntimeKind::Fixed,
        "unknown" => WebviewRuntimeKind::Unknown,
        _ => WebviewRuntimeKind::Evergreen,
    }
}

#[cfg(target_os = "windows")]
fn resolve_webview_runtime_version() -> Option<String> {
    option_env!("KIMI_WEBVIEW_RUNTIME_VERSION")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(query_webview2_runtime_version_from_registry)
}

#[cfg(not(target_os = "windows"))]
fn resolve_webview_runtime_version() -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
fn query_webview2_runtime_version_from_registry() -> Option<String> {
    use winreg::{
        enums::{
            HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
        },
        RegKey,
    };

    const WEBVIEW2_CLIENT_ID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    let key_paths = [
        format!(r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_CLIENT_ID}"),
        format!(r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_CLIENT_ID}"),
    ];
    let hives = [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE];
    let access_modes = [
        KEY_READ,
        KEY_READ | KEY_WOW64_32KEY,
        KEY_READ | KEY_WOW64_64KEY,
    ];

    for hive in hives {
        let root = RegKey::predef(hive);
        for path in &key_paths {
            for access in access_modes {
                if let Ok(key) = root.open_subkey_with_flags(path, access) {
                    if let Ok(version) = key.get_value::<String, _>("pv") {
                        let trimmed = version.trim();
                        if !trimmed.is_empty() {
                            return Some(trimmed.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

fn initialize_webview_runtime_info(app: &AppHandle) {
    let kind = compiled_webview_runtime_kind();
    let version = resolve_webview_runtime_version();
    window_manager::set_webview_runtime_info(app, kind, version, "setup");
}

fn duration_to_u64_ms(value: u128) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

pub(crate) fn start_graceful_exit(app: AppHandle, source: &str) {
    use std::sync::atomic::Ordering;

    if app
        .state::<AppState>()
        .graceful_exit_started
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }

    window_manager::permit_process_exit(&app, source);
    log_manager::append_line(&app, format!("graceful exit requested (source={source})"));
    emit_shutdown_progress(&app, "close_requested", Some("正在关闭后端服务…"), Some(0));

    let source = source.to_string();
    thread::spawn(move || {
        let started = Instant::now();
        emit_shutdown_progress(&app, "stopping_backend", Some("正在关闭后端服务…"), Some(0));
        let dsh_app = app.clone();
        let backend_app = app.clone();
        let dsh_stop = thread::spawn(move || dsh_manager::stop(&dsh_app));
        let backend_stop = thread::spawn(move || backend_manager::stop_backend(&backend_app));
        let dsh_result = join_shutdown_worker("DSH", dsh_stop);
        let backend_result = join_shutdown_worker("Kimi", backend_stop);

        if let Err(error) = &dsh_result {
            log_manager::append_line(
                &app,
                format!("shutdown dsh stop failed (source={source}): {error:#}"),
            );
        }
        if let Err(error) = &backend_result {
            log_manager::append_line(
                &app,
                format!("shutdown stop_backend failed (source={source}): {error:#}"),
            );
        }
        if dsh_result.is_err() || backend_result.is_err() {
            emit_shutdown_progress(
                &app,
                "shutdown_blocked",
                Some("一个或多个后台进程尚未确认关闭；应用将保持运行以便重试。"),
                Some(duration_to_u64_ms(started.elapsed().as_millis())),
            );
            app.state::<AppState>()
                .graceful_exit_started
                .store(false, Ordering::Release);
            window_manager::revoke_process_exit(&app, "shutdown_blocked");
            return;
        }
        emit_shutdown_progress(
            &app,
            "finalizing_exit",
            Some("正在退出应用…"),
            Some(duration_to_u64_ms(started.elapsed().as_millis())),
        );
        app.exit(0);
    });
}

fn join_shutdown_worker(
    label: &str,
    worker: thread::JoinHandle<anyhow::Result<()>>,
) -> anyhow::Result<()> {
    worker
        .join()
        .unwrap_or_else(|_| Err(anyhow::anyhow!("{label} shutdown worker panicked")))
}

fn emit_shutdown_progress(
    app: &AppHandle,
    stage: &str,
    detail: Option<&str>,
    elapsed_ms: Option<u64>,
) {
    let payload = ShutdownProgressPayload {
        stage: stage.to_string(),
        detail: detail.map(|value| value.to_string()),
        elapsed_ms,
    };
    if let Err(error) = app.emit_to(
        window_manager::MAIN_WINDOW_LABEL,
        SHUTDOWN_PROGRESS_EVENT,
        payload.clone(),
    ) {
        log_manager::append_line(
            app,
            format!("failed to emit shutdown progress event to main: {error}"),
        );
    }
    if let Err(error) = app.emit_to(
        window_manager::PREFILL_WINDOW_LABEL,
        SHUTDOWN_PROGRESS_EVENT,
        payload,
    ) {
        log_manager::append_line(
            app,
            format!("failed to emit shutdown progress event to prefill: {error}"),
        );
    }
}

fn should_attempt_stop_backend(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let lock = state.runtime.lock();
    let Ok(runtime) = lock else {
        return true;
    };

    !matches!(runtime.state, BackendState::Stopped)
}

fn should_attempt_stop_bridge(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let lock = state.bridge_runtime.lock();
    let Ok(runtime) = lock else {
        return true;
    };

    !matches!(runtime.state, crate::types::BridgeRuntimeState::Stopped)
}

fn auto_repair_context_menu(app: &AppHandle) {
    let settings = match settings_store::load_or_default(app) {
        Ok(settings) => settings,
        Err(error) => {
            log_manager::append_line(
                app,
                format!("context-menu self-heal skipped: failed to load preference: {error:#}"),
            );
            return;
        }
    };
    let status = context_menu::status(app);
    if !status.supported {
        return;
    }
    if !settings.context_menu_desired_enabled {
        match context_menu::disable(app) {
            Ok(_) => log_manager::append_line(
                app,
                "context-menu self-heal kept disabled and removed stale entries",
            ),
            Err(error) => log_manager::append_line(
                app,
                format!("context-menu disabled-state cleanup failed: {error}"),
            ),
        }
        return;
    }
    if status.enabled {
        log_manager::append_line(app, "context-menu self-heal skipped (already healthy)");
        return;
    }

    let reason = status
        .message
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    log_manager::append_line(
        app,
        format!("context-menu self-heal start (reason={reason})"),
    );
    match context_menu::enable(app) {
        Ok(_) => {
            let after = context_menu::status(app);
            if after.enabled {
                log_manager::append_line(app, "context-menu self-heal success");
            } else {
                let message = after
                    .message
                    .unwrap_or_else(|| "status still disabled".to_string());
                log_manager::append_line(
                    app,
                    format!("context-menu self-heal incomplete: {message}"),
                );
            }
        }
        Err(error) => {
            log_manager::append_line(app, format!("context-menu self-heal failed: {error}"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_worker_join_preserves_success_and_failure() {
        let success = thread::spawn(|| Ok(()));
        assert!(join_shutdown_worker("success", success).is_ok());

        let failure = thread::spawn(|| anyhow::bail!("stop failed"));
        let error = join_shutdown_worker("failure", failure).expect_err("preserve stop failure");
        assert_eq!(error.to_string(), "stop failed");
    }

    #[test]
    fn redact_workspace_url_hides_token_fragment() {
        assert_eq!(
            redact_workspace_url(Some(
                "http://127.0.0.1:55000/?kimi_onboarded=1#token=secret",
            )),
            Some("http://127.0.0.1:55000/?kimi_onboarded=1#token=[REDACTED]".to_string())
        );
        assert_eq!(
            redact_workspace_url(Some("http://127.0.0.1:55000")),
            Some("http://127.0.0.1:55000/".to_string())
        );
    }

    #[test]
    fn onboarding_is_shown_for_missing_kimi_even_if_completed() {
        let settings = AppSettings {
            onboarding_completed_version: CURRENT_ONBOARDING_VERSION,
            ..AppSettings::default()
        };
        assert!(should_show_onboarding(
            &settings,
            false,
            BackendState::MissingKimi
        ));
    }

    #[test]
    fn onboarding_is_hidden_after_completion_for_normal_startup() {
        let settings = AppSettings {
            onboarding_completed_version: CURRENT_ONBOARDING_VERSION,
            ..AppSettings::default()
        };
        assert!(!should_show_onboarding(
            &settings,
            false,
            BackendState::Running
        ));
    }

    #[test]
    fn recommendation_prefers_install_when_kimi_missing() {
        let step = recommend_onboarding_step(
            BackendState::Starting,
            false,
            true,
            false,
            false,
            false,
            false,
        );
        assert!(matches!(step, OnboardingStep::InstallKimi));
    }

    #[test]
    fn startup_monitor_routes_workspace_when_backend_and_proxy_are_ready() {
        let status = build_startup_monitor_status(
            BackendState::Running,
            Some(4000),
            Some(10),
            false,
            CURRENT_ONBOARDING_VERSION,
            1_000,
        );

        assert_eq!(status.state, StartupMonitorState::RouteWorkspace);
        assert_eq!(status.reason, StartupMonitorReason::BackendReady);
        assert_eq!(
            status.target_route,
            Some(StartupMonitorTargetRoute::Workspace)
        );
    }

    #[test]
    fn startup_monitor_routes_onboarding_when_onboarding_is_required() {
        let status = build_startup_monitor_status(
            BackendState::Running,
            Some(4000),
            Some(10),
            false,
            0,
            1_000,
        );

        assert_eq!(status.state, StartupMonitorState::RouteControlCenter);
        assert_eq!(status.reason, StartupMonitorReason::OnboardingRequired);
        assert_eq!(
            status.target_route,
            Some(StartupMonitorTargetRoute::Onboarding)
        );
    }

    #[test]
    fn startup_monitor_routes_onboarding_when_kimi_is_missing() {
        let status = build_startup_monitor_status(
            BackendState::MissingKimi,
            None,
            Some(10),
            false,
            CURRENT_ONBOARDING_VERSION,
            1_000,
        );

        assert_eq!(status.state, StartupMonitorState::RouteControlCenter);
        assert_eq!(status.reason, StartupMonitorReason::MissingKimi);
        assert_eq!(
            status.target_route,
            Some(StartupMonitorTargetRoute::Onboarding)
        );
    }

    #[test]
    fn startup_monitor_routes_diagnostics_when_backend_crashes() {
        let status = build_startup_monitor_status(
            BackendState::Crashed,
            None,
            Some(10),
            false,
            CURRENT_ONBOARDING_VERSION,
            1_000,
        );

        assert_eq!(status.state, StartupMonitorState::RouteControlCenter);
        assert_eq!(status.reason, StartupMonitorReason::BackendCrashed);
        assert_eq!(
            status.target_route,
            Some(StartupMonitorTargetRoute::Diagnostics)
        );
    }

    #[test]
    fn startup_monitor_waits_before_timeout() {
        let status = build_startup_monitor_status(
            BackendState::Starting,
            None,
            Some(10),
            false,
            CURRENT_ONBOARDING_VERSION,
            55_000,
        );

        assert_eq!(status.state, StartupMonitorState::Waiting);
        assert_eq!(status.reason, StartupMonitorReason::Starting);
        assert!(status.target_route.is_none());
    }

    #[test]
    fn startup_monitor_fails_after_timeout() {
        let status = build_startup_monitor_status(
            BackendState::Starting,
            None,
            Some(10),
            false,
            CURRENT_ONBOARDING_VERSION,
            70_500,
        );

        assert_eq!(status.state, StartupMonitorState::Failed);
        assert_eq!(status.reason, StartupMonitorReason::StartupTimeout);
        assert!(status.target_route.is_none());
    }

    #[test]
    fn auth_summary_message_tracks_ready_state() {
        let ready = kimi_code_auth_message(&KimiCodeAuthSummary {
            ready: true,
            managed_provider: Some(KimiCodeManagedProviderAuth {
                status: Some("authenticated".to_string()),
            }),
        });
        let missing = kimi_code_auth_message(&KimiCodeAuthSummary {
            ready: false,
            managed_provider: Some(KimiCodeManagedProviderAuth {
                status: Some("unauthenticated".to_string()),
            }),
        });

        assert!(ready.contains("已就绪"));
        assert!(ready.contains("authenticated"));
        assert!(missing.contains("未就绪"));
        assert!(missing.contains("unauthenticated"));
    }

    #[test]
    fn oauth_login_message_includes_code_and_expiry() {
        let message = kimi_code_login_message(&KimiCodeOAuthFlowStart {
            user_code: "ABCD-EFGH".to_string(),
            verification_uri_complete: "https://kimi.example/login?code=ABCD-EFGH".to_string(),
            expires_in: 600,
        });

        assert!(message.contains("ABCD-EFGH"));
        assert!(message.contains("600"));
    }
}
