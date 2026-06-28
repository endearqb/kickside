#[allow(dead_code)]
mod api_v1_client;
mod app_state;
mod auth_state;
mod backend_manager;
mod bridge_host_control;
mod bridge_http_client;
mod bridge_manager;
mod bridge_settings_store;
mod cli_contract;
mod command_utils;
mod context_menu;
mod enhanced_web;
mod feishu_onboarding;
mod install_manager;
mod kimi_locator;
mod log_manager;
mod onboarding_http;
mod open_request;
mod port_manager;
mod runtime_locator;
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

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Instant;

use tauri::{ipc::Channel, AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_global_shortcut::ShortcutState;

use app_state::{unix_time_millis, AppState};
use types::{
    AppSettings, AppStatus, BackendState, BindingRecord, BridgeApprovalRecord,
    BridgeApprovalResolveInput, BridgeConnectorSecretsInput, BridgeOnboardingConfigInput,
    BridgeSecretsMaskView, BridgeSessionImportInput, BridgeSessionRecord, BridgeSessionSource,
    BridgeSettings, BridgeStatus, ContextMenuStatus, DiagnosticsInfo, DiscoveredSkillDetail,
    FeishuConnectorOnboardingSession, FrontendReadyAck, InstallFlowCatalog,
    InstallMirrorHealthReport, InstallProbeStatus, InstallSessionEvent, InstallSessionSnapshot,
    InstallSettingsView, InstallSource, InstallTaskId, InstalledSkill, KimiCliApiConfigInput,
    KimiCliApiConfigView, KimiCliConfigCenterInput, KimiCliConfigCenterView, KimiDoctorResult,
    KimiLoginHealthSource, KimiLoginHealthState, LoginProbeResult, MainWindowCloseBehavior,
    MainWindowCloseDecisionInput, OnboardingStatus, OnboardingStep, PowerShellPreflightSummary,
    SessionSkillState, ShutdownProgressPayload, SkillApplyResult, SkillApplyScope, SkillDetail,
    SkillDiscoverySnapshot, SkillProjectionRecord, SkillRecommendation,
    StartFeishuConnectorOnboardingInput, StartWeixinConnectorOnboardingInput, StartupMonitorReason,
    StartupMonitorState, StartupMonitorStatus, StartupMonitorTargetRoute, SubmitPrefillAck,
    WebviewRuntimeKind, WeixinConnectorOnboardingSession, WorkspaceDiscoveryRoot,
    WorkspaceImportRequestPayload, WorkspaceImportResult, WorkspaceImportTarget,
    WorkspaceImportTargetInput, WorkspaceSkillInventory, WorkspaceSkillProfile,
    WorkspaceSkillTarget, WorkspaceWebSettingsInput, WorkspaceWebSettingsView,
    CURRENT_ONBOARDING_VERSION,
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

    Ok(AppStatus {
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
        workspace_url,
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
fn grid_list_sessions(
    app: AppHandle,
) -> Result<Vec<workspace_session::WorkspaceSessionRecord>, String> {
    workspace_session::list_workspace_sessions_for_grid(&app)
}

#[tauri::command]
fn grid_create_session(
    app: AppHandle,
    workspace_root: String,
) -> Result<workspace_session::WorkspaceSessionRecord, String> {
    let trimmed = workspace_root.trim();
    if trimmed.is_empty() {
        return Err("workspace root is required".to_string());
    }
    workspace_session::create_workspace_session_for_grid(&app, &PathBuf::from(trimmed))
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
fn get_bridge_settings(app: AppHandle) -> Result<BridgeSettings, String> {
    bridge_settings_store::load_or_default(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_bridge_settings(app: AppHandle, input: BridgeSettings) -> Result<BridgeSettings, String> {
    bridge_manager::ensure_bundled_bridge_ops_installed(&app).map_err(|error| error.to_string())?;

    let saved = bridge_settings_store::save(&app, &input).map_err(|error| error.to_string())?;
    sync_idle_bridge_runtime(&app, &saved)?;
    Ok(saved)
}

#[tauri::command]
fn delete_bridge_connector(app: AppHandle, connector_id: String) -> Result<BridgeSettings, String> {
    let saved = bridge_settings_store::delete_connector(&app, &connector_id)
        .map_err(|error| error.to_string())?;
    sync_idle_bridge_runtime(&app, &saved)?;
    Ok(saved)
}

#[tauri::command]
fn save_bridge_onboarding_config(
    app: AppHandle,
    input: BridgeOnboardingConfigInput,
) -> Result<BridgeSettings, String> {
    let saved = bridge_settings_store::save_onboarding_config(&app, &input)
        .map_err(|error| error.to_string())?;
    sync_idle_bridge_runtime(&app, &saved)?;
    Ok(saved)
}

#[tauri::command]
fn get_bridge_status(app: AppHandle) -> Result<BridgeStatus, String> {
    bridge_manager::get_bridge_status(&app).map_err(|error| error.to_string())
}

#[tauri::command]
async fn start_bridge(app: AppHandle) -> Result<BridgeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        bridge_manager::start_bridge(&app).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("failed to join start bridge task: {error}"))?
}

#[tauri::command]
async fn stop_bridge(app: AppHandle) -> Result<BridgeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        bridge_manager::stop_bridge(&app).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("failed to join stop bridge task: {error}"))?
}

#[tauri::command]
async fn restart_bridge(app: AppHandle) -> Result<BridgeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        bridge_manager::restart_bridge(&app).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("failed to join restart bridge task: {error}"))?
}

#[tauri::command]
fn list_bridge_bindings(app: AppHandle) -> Result<Vec<BindingRecord>, String> {
    bridge_manager::list_bridge_bindings(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_bridge_sessions(app: AppHandle) -> Result<Vec<BridgeSessionRecord>, String> {
    let mut sessions =
        bridge_manager::list_bridge_sessions(&app).map_err(|error| error.to_string())?;
    let workspace_sessions = workspace_session::list_workspace_sessions_for_bridge(&app)
        .map_err(|error| error.to_string())?;
    sessions.extend(
        workspace_sessions
            .into_iter()
            .map(|session| BridgeSessionRecord {
                source: BridgeSessionSource::ShellWeb,
                session_id: session.session_id,
                work_dir: session.work_dir,
                last_message_at: session.last_updated.clone(),
                summary: None,
                session_state: Some(if session.is_running {
                    "running".to_string()
                } else {
                    "available".to_string()
                }),
                lease_owner: None,
                lease_expires_at: None,
                auto_approve: false,
                provider_name: Some("kimi-web".to_string()),
                runtime_metadata_json: None,
                created_at: None,
                updated_at: session.last_updated,
                switchable: false,
                importable: true,
            }),
    );
    Ok(sessions)
}

#[tauri::command]
fn clear_bridge_binding(app: AppHandle, binding_id: String) -> Result<(), String> {
    bridge_manager::clear_bridge_binding(&app, &binding_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn reset_bridge_binding_session(app: AppHandle, binding_id: String) -> Result<(), String> {
    bridge_manager::reset_bridge_binding_session(&app, &binding_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn reset_bridge_binding_to_default_work_dir(
    app: AppHandle,
    binding_id: String,
) -> Result<(), String> {
    bridge_manager::reset_bridge_binding_to_default_work_dir(&app, &binding_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_bridge_approvals(
    app: AppHandle,
    status: Option<String>,
) -> Result<Vec<BridgeApprovalRecord>, String> {
    bridge_manager::list_bridge_approvals(&app, status.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn resolve_bridge_approval(
    app: AppHandle,
    input: BridgeApprovalResolveInput,
) -> Result<(), String> {
    bridge_manager::resolve_bridge_approval(&app, &input).map_err(|error| error.to_string())
}

#[tauri::command]
fn import_bridge_session(
    app: AppHandle,
    input: BridgeSessionImportInput,
) -> Result<BridgeSessionRecord, String> {
    let work_dir = if input
        .work_dir
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        let workspace =
            workspace_session::get_workspace_session_for_bridge(&app, &input.source_session_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    format!("workspace session not found: {}", input.source_session_id)
                })?;
        workspace.work_dir.ok_or_else(|| {
            format!(
                "workspace session has no work directory: {}",
                input.source_session_id
            )
        })?
    } else {
        input.work_dir.clone().unwrap_or_default()
    };

    bridge_manager::import_bridge_session(
        &app,
        &BridgeSessionImportInput {
            source: input.source,
            source_session_id: input.source_session_id,
            work_dir: Some(work_dir),
            summary: input.summary,
        },
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_bridge_log_tail(app: AppHandle, max_lines: Option<usize>) -> Result<Vec<String>, String> {
    bridge_manager::get_bridge_log_tail(&app, max_lines).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_bridge_secrets_mask_view(app: AppHandle) -> Result<BridgeSecretsMaskView, String> {
    bridge_manager::get_bridge_secrets_mask_view(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_bridge_connector_secrets(
    app: AppHandle,
    input: BridgeConnectorSecretsInput,
) -> Result<BridgeSecretsMaskView, String> {
    bridge_settings_store::save_connector_secrets(&app, &input)
        .map_err(|error| error.to_string())?;
    bridge_manager::get_bridge_secrets_mask_view(&app).map_err(|error| error.to_string())
}

#[tauri::command]
async fn start_feishu_connector_onboarding(
    app: AppHandle,
    input: StartFeishuConnectorOnboardingInput,
) -> Result<FeishuConnectorOnboardingSession, String> {
    tauri::async_runtime::spawn_blocking(move || {
        feishu_onboarding::start(&app, &input).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("failed to join feishu onboarding start task: {error}"))?
}

#[tauri::command]
async fn get_feishu_connector_onboarding_status(
    app: AppHandle,
    session_id: String,
) -> Result<FeishuConnectorOnboardingSession, String> {
    tauri::async_runtime::spawn_blocking(move || {
        feishu_onboarding::get_status(&app, &session_id).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("failed to join feishu onboarding status task: {error}"))?
}

#[tauri::command]
fn cancel_feishu_connector_onboarding(
    app: AppHandle,
    session_id: String,
) -> Result<FeishuConnectorOnboardingSession, String> {
    feishu_onboarding::cancel(&app, &session_id).map_err(|error| error.to_string())
}

#[tauri::command]
async fn start_weixin_connector_onboarding(
    app: AppHandle,
    input: StartWeixinConnectorOnboardingInput,
) -> Result<WeixinConnectorOnboardingSession, String> {
    tauri::async_runtime::spawn_blocking(move || {
        weixin_onboarding::start(&app, &input).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("failed to join weixin onboarding start task: {error}"))?
}

#[tauri::command]
async fn get_weixin_connector_onboarding_status(
    app: AppHandle,
    session_id: String,
) -> Result<WeixinConnectorOnboardingSession, String> {
    tauri::async_runtime::spawn_blocking(move || {
        weixin_onboarding::get_status(&app, &session_id).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("failed to join weixin onboarding status task: {error}"))?
}

#[tauri::command]
fn cancel_weixin_connector_onboarding(
    app: AppHandle,
    session_id: String,
) -> Result<WeixinConnectorOnboardingSession, String> {
    weixin_onboarding::cancel(&app, &session_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn install_skill_from_git(
    app: AppHandle,
    repo_url: String,
    git_ref: Option<String>,
) -> Result<InstalledSkill, String> {
    skill_center::install_skill_from_git(&app, &repo_url, git_ref.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn import_skill_from_path(app: AppHandle, path: String) -> Result<InstalledSkill, String> {
    skill_center::import_skill_from_path(&app, &path).map_err(|error| error.to_string())
}

#[tauri::command]
fn scan_discoverable_skills(app: AppHandle) -> Result<SkillDiscoverySnapshot, String> {
    skill_center::scan_discoverable_skills(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_skill_discovery_workspaces(app: AppHandle) -> Result<Vec<WorkspaceDiscoveryRoot>, String> {
    skill_center::list_skill_discovery_workspaces(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_workspace_skill_targets(app: AppHandle) -> Result<Vec<WorkspaceSkillTarget>, String> {
    skill_center::list_workspace_skill_targets(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_workspace_skill_inventory(
    app: AppHandle,
    target_id: String,
) -> Result<WorkspaceSkillInventory, String> {
    skill_center::get_workspace_skill_inventory(&app, &target_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn add_installed_skill_to_workspace_target(
    app: AppHandle,
    target_id: String,
    container_kind: types::SkillDiscoveryContainerKind,
    skill_id: String,
) -> Result<WorkspaceSkillInventory, String> {
    skill_center::add_installed_skill_to_workspace_target(
        &app,
        &target_id,
        container_kind,
        &skill_id,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_workspace_target_skill(
    app: AppHandle,
    target_id: String,
    container_kind: types::SkillDiscoveryContainerKind,
    skill_path_or_key: String,
) -> Result<WorkspaceSkillInventory, String> {
    skill_center::remove_workspace_target_skill(
        &app,
        &target_id,
        container_kind,
        &skill_path_or_key,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_discovered_skill_detail(
    app: AppHandle,
    discovery_id: String,
) -> Result<DiscoveredSkillDetail, String> {
    skill_center::get_discovered_skill_detail(&app, &discovery_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn import_discovered_skill(app: AppHandle, discovery_id: String) -> Result<InstalledSkill, String> {
    skill_center::import_discovered_skill(&app, &discovery_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_installed_skills(app: AppHandle) -> Result<Vec<InstalledSkill>, String> {
    skill_center::list_installed_skills(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_skill_detail(app: AppHandle, skill_id: String) -> Result<SkillDetail, String> {
    skill_center::get_skill_detail(&app, &skill_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_skill_trust(app: AppHandle, skill_id: String, trusted: bool) -> Result<(), String> {
    skill_center::set_skill_trust(&app, &skill_id, trusted).map_err(|error| error.to_string())
}

#[tauri::command]
fn apply_skill(
    app: AppHandle,
    skill_id: String,
    scope: SkillApplyScope,
) -> Result<SkillApplyResult, String> {
    skill_center::apply_skill(&app, &skill_id, scope).map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_skill(
    app: AppHandle,
    skill_id: String,
    scope: SkillApplyScope,
) -> Result<SkillApplyResult, String> {
    skill_center::remove_skill(&app, &skill_id, scope).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_active_session_skills(app: AppHandle) -> Result<SessionSkillState, String> {
    skill_center::list_active_session_skills(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_global_skills(app: AppHandle) -> Result<Vec<SkillProjectionRecord>, String> {
    skill_center::list_global_skills(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_workspace_recent_skills(
    app: AppHandle,
    workspace_key: Option<String>,
) -> Result<Vec<String>, String> {
    skill_center::list_workspace_recent_skills(&app, workspace_key.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_workspace_skill_profile(
    app: AppHandle,
    workspace_key: Option<String>,
) -> Result<Option<WorkspaceSkillProfile>, String> {
    skill_center::get_workspace_skill_profile(&app, workspace_key.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_workspace_skill_pin(
    app: AppHandle,
    skill_id: String,
    pinned: bool,
    workspace_key: Option<String>,
) -> Result<WorkspaceSkillProfile, String> {
    skill_center::set_workspace_skill_pin(&app, &skill_id, pinned, workspace_key.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_workspace_skill_recommendations(
    app: AppHandle,
    workspace_key: Option<String>,
) -> Result<Vec<SkillRecommendation>, String> {
    skill_center::get_workspace_skill_recommendations(&app, workspace_key.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_skill(app: AppHandle, skill_id: String) -> Result<InstalledSkill, String> {
    skill_center::update_skill(&app, &skill_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn uninstall_skill(app: AppHandle, skill_id: String) -> Result<(), String> {
    skill_center::uninstall_skill(&app, &skill_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn cleanup_session_skill_projections(app: AppHandle, session_id: String) -> Result<(), String> {
    skill_center::cleanup_session_skill_projections(&app, &session_id)
        .map_err(|error| error.to_string())
}

fn sync_idle_bridge_runtime(app: &AppHandle, saved: &BridgeSettings) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut runtime = state
        .bridge_runtime
        .lock()
        .map_err(|_| "bridge runtime mutex is poisoned".to_string())?;
    if !matches!(
        runtime.state,
        crate::types::BridgeRuntimeState::Running
            | crate::types::BridgeRuntimeState::Starting
            | crate::types::BridgeRuntimeState::Degraded
    ) {
        runtime.admin_port = saved.admin_port;
        runtime.channels = saved
            .connectors
            .iter()
            .map(|connector| crate::types::BridgeChannelStatus {
                connector_id: connector.id.clone(),
                connector_label: connector.label.clone(),
                platform: connector.platform,
                enabled: connector.enabled,
                state: crate::types::BridgeChannelState::Idle,
                last_heartbeat_at: None,
                last_inbound_at: None,
                last_outbound_at: None,
                last_offset: None,
                last_error_code: None,
                last_error: None,
                last_ready_at: None,
                last_failure_at: None,
                last_failure_operation: None,
                last_failure_retryable: None,
                consecutive_failures: None,
                next_retry_at: None,
                last_recovery_at: None,
                recovery_hint: None,
            })
            .collect();
    }
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
fn open_folder(path: String) -> Result<(), String> {
    backend_manager::open_folder(&path)
}

#[tauri::command]
fn open_kimi_config_dir() -> Result<(), String> {
    backend_manager::open_kimi_config_dir()
}

#[tauri::command]
fn load_kimi_cli_api_config() -> Result<KimiCliApiConfigView, String> {
    backend_manager::load_kimi_cli_api_config()
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
fn save_kimi_cli_api_config(app: AppHandle, input: KimiCliApiConfigInput) -> Result<(), String> {
    backend_manager::save_kimi_cli_api_config(&app, input)?;
    sync_provider_api_snapshot_after_config_change(&app)
}

#[tauri::command]
fn set_kimi_cli_api_as_default(app: AppHandle) -> Result<(), String> {
    backend_manager::set_kimi_cli_api_as_default(&app)?;
    sync_provider_api_snapshot_after_config_change(&app)
}

#[tauri::command]
fn set_kimi_login_as_default(app: AppHandle) -> Result<(), String> {
    backend_manager::set_kimi_login_as_default(&app)?;
    sync_provider_api_snapshot_after_config_change(&app)
}

#[tauri::command]
fn load_kimi_cli_config_center() -> Result<KimiCliConfigCenterView, String> {
    backend_manager::load_kimi_cli_config_center()
}

#[tauri::command]
fn save_kimi_cli_config_center(
    app: AppHandle,
    input: KimiCliConfigCenterInput,
) -> Result<(), String> {
    backend_manager::save_kimi_cli_config_center(&app, input)?;
    sync_provider_api_snapshot_after_config_change(&app)
}

#[tauri::command]
fn register_install_session_channel(
    state: State<install_manager::InstallManager>,
    channel: Channel<InstallSessionEvent>,
) -> Result<InstallSessionSnapshot, String> {
    state.register_channel(channel)
}

#[tauri::command]
fn get_install_flow_catalog(app: AppHandle) -> InstallFlowCatalog {
    install_manager::build_install_flow_catalog(&app)
}

#[tauri::command]
fn get_install_session_snapshot(
    state: State<install_manager::InstallManager>,
) -> Result<InstallSessionSnapshot, String> {
    state.snapshot()
}

#[tauri::command]
fn start_install_task(
    app: AppHandle,
    state: State<install_manager::InstallManager>,
    task_id: InstallTaskId,
    source: InstallSource,
) -> Result<InstallSessionSnapshot, String> {
    state.start_task(&app, task_id, source)
}

#[tauri::command]
fn cancel_install_task(
    state: State<install_manager::InstallManager>,
) -> Result<InstallSessionSnapshot, String> {
    state.cancel_task()
}

#[tauri::command]
fn install_kimi_dependencies(
    app: AppHandle,
    state: State<install_manager::InstallManager>,
    source: InstallSource,
) -> Result<String, String> {
    install_manager::start_compat_task(&app, &state, InstallTaskId::QuickInstallCore, source)
}

#[tauri::command]
fn install_kimi_cli(
    app: AppHandle,
    state: State<install_manager::InstallManager>,
    source: InstallSource,
) -> Result<String, String> {
    install_manager::start_compat_task(&app, &state, InstallTaskId::InstallKimi, source)
}

#[tauri::command]
fn upgrade_kimi_cli(
    app: AppHandle,
    state: State<install_manager::InstallManager>,
    source: InstallSource,
) -> Result<String, String> {
    install_manager::start_compat_task(&app, &state, InstallTaskId::UpgradeKimi, source)
}

#[tauri::command]
fn uninstall_kimi_cli(
    app: AppHandle,
    state: State<install_manager::InstallManager>,
    source: InstallSource,
) -> Result<String, String> {
    install_manager::start_compat_task(&app, &state, InstallTaskId::UninstallKimi, source)
}

#[tauri::command]
fn install_nodejs(
    app: AppHandle,
    state: State<install_manager::InstallManager>,
) -> Result<String, String> {
    install_manager::start_compat_task(
        &app,
        &state,
        InstallTaskId::InstallNodejs,
        InstallSource::Official,
    )
}

#[tauri::command]
fn get_install_probe_status(app: AppHandle) -> InstallProbeStatus {
    install_manager::get_install_probe_status(&app)
}

#[tauri::command]
fn get_install_settings(app: AppHandle) -> InstallSettingsView {
    install_manager::get_install_settings(&app)
}

#[tauri::command]
fn save_install_settings(
    app: AppHandle,
    input: InstallSettingsView,
) -> Result<InstallSettingsView, String> {
    install_manager::save_install_settings(&app, input)
}

#[tauri::command]
fn get_install_mirror_health_report(
    input: InstallSettingsView,
) -> Result<InstallMirrorHealthReport, String> {
    install_manager::get_install_mirror_health_report(input)
}

#[tauri::command]
fn get_powershell_preflight() -> PowerShellPreflightSummary {
    install_manager::get_powershell_preflight()
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
        cli_contract_ok,
        cli_contract_error,
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
            runtime.cli_contract_ok,
            runtime.cli_contract_error.clone(),
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
        cli_contract_ok,
        cli_contract_error,
        runtime_origin,
        server_token_path,
        server_token_redacted,
        workspace_url,
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
        app_log_tail: log_manager::read_log_tail(&app_log_path, 60),
        backend_log_tail: log_manager::read_log_tail(&backend_log_path, 60),
        log_tail: log_manager::read_log_tail(&backend_log_path, 80),
        logs_dir: logs_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn get_context_menu_status(app: AppHandle) -> ContextMenuStatus {
    context_menu::status(&app)
}

#[tauri::command]
fn enable_context_menu(app: AppHandle) -> Result<ContextMenuStatus, String> {
    context_menu::enable(&app)?;
    Ok(context_menu::status(&app))
}

#[tauri::command]
fn disable_context_menu(app: AppHandle) -> Result<ContextMenuStatus, String> {
    context_menu::disable(&app)?;
    Ok(context_menu::status(&app))
}

#[tauri::command]
fn list_workspace_import_targets(app: AppHandle) -> Result<Vec<WorkspaceImportTarget>, String> {
    workspace_import::list_workspace_import_targets(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_active_workspace_import_request() -> Option<WorkspaceImportRequestPayload> {
    workspace_import::get_active_workspace_import_request()
}

#[tauri::command]
fn complete_workspace_import_request(
    app: AppHandle,
    request_id: String,
    input: WorkspaceImportTargetInput,
) -> Result<WorkspaceImportResult, String> {
    workspace_import::complete_workspace_import_request(&app, &request_id, &input)
}

#[tauri::command]
fn cancel_workspace_import_request(app: AppHandle, request_id: String) -> Result<(), String> {
    workspace_import::cancel_workspace_import_request(&app, &request_id)
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

#[tauri::command]
fn probe_kimi_login(app: AppHandle) -> Result<LoginProbeResult, String> {
    let settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    let auth_snapshot =
        auth_state::resolve_auth_mode_snapshot(&app, settings.onboarding_step_acks.login_verified)?;
    auth_state::sync_runtime_auth_snapshot(&app, &auth_snapshot)?;
    let kimi_path = match resolve_kimi_path_for_login(&app, &settings) {
        Ok(path) => path,
        Err(error) => {
            auth_state::update_kimi_login_health(
                &app,
                KimiLoginHealthState::Error,
                KimiLoginHealthSource::ManualProbe,
                error.clone(),
                None,
            )?;
            return Err(error);
        }
    };

    let mut process = Command::new(&kimi_path);
    command_utils::configure_kimi_query_command(&mut process);
    let output = process
        .arg("login")
        .arg("--json")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .output()
        .map_err(|error| {
            let detail = format!(
                "failed to run `{} login --json`: {}",
                kimi_path.display(),
                error
            );
            let _ = auth_state::update_kimi_login_health(
                &app,
                KimiLoginHealthState::Error,
                KimiLoginHealthSource::ManualProbe,
                detail.clone(),
                None,
            );
            detail
        })?;

    let message = summarize_command_output(
        &output,
        "Login command completed.",
        "Login command failed. Please run `kimi login` manually and try again.",
    );
    let health_state = if output.status.success() {
        KimiLoginHealthState::Verified
    } else {
        KimiLoginHealthState::AuthRequired
    };

    auth_state::update_kimi_login_health(
        &app,
        health_state,
        KimiLoginHealthSource::ManualProbe,
        message.clone(),
        output.status.code(),
    )?;
    let state = auth_state::login_probe_state_from_health(health_state);

    Ok(LoginProbeResult {
        state,
        message,
        kimi_path: Some(kimi_path.to_string_lossy().to_string()),
        exit_code: output.status.code(),
    })
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
fn logout_kimi_login(app: AppHandle) -> Result<LoginProbeResult, String> {
    let settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    let auth_snapshot =
        auth_state::resolve_auth_mode_snapshot(&app, settings.onboarding_step_acks.login_verified)?;
    auth_state::sync_runtime_auth_snapshot(&app, &auth_snapshot)?;
    let kimi_path = match resolve_kimi_path_for_login(&app, &settings) {
        Ok(path) => path,
        Err(error) => {
            auth_state::update_kimi_login_health(
                &app,
                KimiLoginHealthState::Error,
                KimiLoginHealthSource::ManualProbe,
                error.clone(),
                None,
            )?;
            return Err(error);
        }
    };

    let mut process = Command::new(&kimi_path);
    command_utils::configure_kimi_query_command(&mut process);
    let output = process
        .arg("logout")
        .arg("--json")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .output()
        .map_err(|error| {
            let detail = format!(
                "failed to run `{} logout --json`: {}",
                kimi_path.display(),
                error
            );
            let _ = auth_state::update_kimi_login_health(
                &app,
                KimiLoginHealthState::Error,
                KimiLoginHealthSource::ManualProbe,
                detail.clone(),
                None,
            );
            detail
        })?;

    let message = summarize_command_output(
        &output,
        "Logout command completed.",
        "Logout command finished with a non-zero exit code.",
    );
    auth_state::update_kimi_login_health(
        &app,
        KimiLoginHealthState::AuthRequired,
        KimiLoginHealthSource::ManualProbe,
        message.clone(),
        output.status.code(),
    )?;

    Ok(LoginProbeResult {
        state: types::LoginProbeState::LoginRequired,
        message,
        kimi_path: Some(kimi_path.to_string_lossy().to_string()),
        exit_code: output.status.code(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shortcut = shortcut_manager::default_shortcut();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            window_manager::show_and_focus(&app);
            open_request::handle_external_cli_request(app.clone(), args, Some(cwd));
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, active_shortcut, event| {
                    if event.state() == ShortcutState::Pressed && active_shortcut == &shortcut {
                        window_manager::toggle_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let shared = AppState::new(app.handle())?;
            let hotkey_owner = shared.hotkey_owner;
            let pid = shared.pid;
            app.manage(shared);
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

            tray_manager::setup_tray(app.handle())?;
            if hotkey_owner {
                shortcut_manager::register_default_hotkey(app.handle())?;
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

                    if settings.enabled && settings.auto_start {
                        if let Err(error) = bridge_manager::start_bridge(&app_handle) {
                            log_manager::append_line(
                                &app_handle,
                                format!("bridge auto start failed: {error:#}"),
                            );
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            grid_list_sessions,
            grid_create_session,
            retry_start_backend,
            restart_backend_runtime_only,
            report_loading_rendered,
            notify_frontend_ready,
            get_startup_monitor_status,
            complete_startup_monitor_route,
            submit_prefill,
            recover_main_window_boot,
            quit_app_gracefully,
            get_main_window_close_behavior,
            save_main_window_close_behavior,
            get_workspace_web_settings,
            save_workspace_web_settings,
            fallback_workspace_web_to_official,
            mark_enhanced_web_ready,
            submit_main_window_close_decision,
            save_kimi_path,
            save_work_dir,
            get_bridge_settings,
            save_bridge_settings,
            delete_bridge_connector,
            save_bridge_onboarding_config,
            get_bridge_status,
            start_bridge,
            stop_bridge,
            restart_bridge,
            list_bridge_bindings,
            list_bridge_sessions,
            clear_bridge_binding,
            reset_bridge_binding_session,
            reset_bridge_binding_to_default_work_dir,
            list_bridge_approvals,
            resolve_bridge_approval,
            import_bridge_session,
            get_bridge_log_tail,
            get_bridge_secrets_mask_view,
            save_bridge_connector_secrets,
            start_feishu_connector_onboarding,
            get_feishu_connector_onboarding_status,
            cancel_feishu_connector_onboarding,
            start_weixin_connector_onboarding,
            get_weixin_connector_onboarding_status,
            cancel_weixin_connector_onboarding,
            install_skill_from_git,
            import_skill_from_path,
            scan_discoverable_skills,
            list_skill_discovery_workspaces,
            list_workspace_skill_targets,
            get_workspace_skill_inventory,
            add_installed_skill_to_workspace_target,
            remove_workspace_target_skill,
            get_discovered_skill_detail,
            import_discovered_skill,
            list_installed_skills,
            get_skill_detail,
            set_skill_trust,
            apply_skill,
            remove_skill,
            list_active_session_skills,
            list_global_skills,
            list_workspace_recent_skills,
            get_workspace_skill_profile,
            set_workspace_skill_pin,
            get_workspace_skill_recommendations,
            update_skill,
            uninstall_skill,
            cleanup_session_skill_projections,
            get_diagnostics,
            open_logs_folder,
            open_external_url,
            open_folder,
            open_kimi_config_dir,
            load_kimi_cli_api_config,
            save_kimi_cli_api_config,
            set_kimi_cli_api_as_default,
            set_kimi_login_as_default,
            load_kimi_cli_config_center,
            save_kimi_cli_config_center,
            register_install_session_channel,
            get_install_flow_catalog,
            get_install_session_snapshot,
            start_install_task,
            cancel_install_task,
            install_kimi_dependencies,
            install_kimi_cli,
            upgrade_kimi_cli,
            uninstall_kimi_cli,
            install_nodejs,
            get_install_probe_status,
            get_install_settings,
            save_install_settings,
            get_install_mirror_health_report,
            get_powershell_preflight,
            get_context_menu_status,
            enable_context_menu,
            disable_context_menu,
            list_workspace_import_targets,
            get_active_workspace_import_request,
            complete_workspace_import_request,
            cancel_workspace_import_request,
            get_onboarding_status,
            complete_onboarding,
            skip_onboarding,
            ack_api_config_step,
            probe_kimi_login,
            run_kimi_doctor,
            logout_kimi_login
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent { label, event, .. } => {
            if label == window_manager::MAIN_WINDOW_LABEL {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        if !window_manager::handle_main_close_requested(
                            app_handle,
                            "main_close_requested",
                        ) {
                            start_graceful_exit(app_handle.clone(), "main_close_requested");
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
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        window_manager::handle_workspace_import_picker_close_requested(
                            app_handle,
                            "workspace_import_picker_close_requested",
                        );
                    }
                    _ => {}
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
            if should_attempt_stop_backend(app_handle) {
                let _ = backend_manager::stop_backend(app_handle);
            }
            if should_attempt_stop_bridge(app_handle) {
                let _ = bridge_manager::stop_bridge(app_handle);
            }
        }
        RunEvent::Exit => {
            if should_attempt_stop_backend(app_handle) {
                let _ = backend_manager::stop_backend(app_handle);
            }
            if should_attempt_stop_bridge(app_handle) {
                let _ = bridge_manager::stop_bridge(app_handle);
            }
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

    let login_state = auth_state::login_probe_state_from_health(kimi_login_health.state);
    let login_message = if kimi_login_health.message.trim().is_empty() {
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
        context_status.enabled,
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
        login_state,
        login_message,
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
            detail: Some("未检测到 Kimi CLI，正在进入引导配置。".to_string()),
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

fn summarize_command_output(
    output: &std::process::Output,
    success_fallback: &str,
    failure_fallback: &str,
) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    let merged = if !stdout.is_empty() && !stderr.is_empty() {
        format!("{stdout}\n{stderr}")
    } else if !stdout.is_empty() {
        stdout
    } else if !stderr.is_empty() {
        stderr
    } else if output.status.success() {
        success_fallback.to_string()
    } else {
        failure_fallback.to_string()
    };

    let max_chars = 600usize;
    if merged.chars().count() <= max_chars {
        return merged;
    }

    let truncated: String = merged.chars().take(max_chars).collect();
    format!("{truncated}…")
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

    if let Ok(config) = backend_manager::load_kimi_cli_config_center() {
        for provider in config.providers {
            push_doctor_redaction_value(&mut values, provider.api_key.as_deref());
            push_doctor_redaction_value(&mut values, provider.auth_token.as_deref());
            push_doctor_redaction_value(&mut values, provider.secret_access_key.as_deref());
            for entry in provider.env.iter().chain(provider.custom_headers.iter()) {
                if is_sensitive_key(&entry.key) {
                    push_doctor_redaction_value(&mut values, Some(entry.value.as_str()));
                }
            }
        }
        for service in config.services {
            push_doctor_redaction_value(&mut values, service.api_key.as_deref());
        }
        for server in config.mcp_servers {
            for entry in server.env {
                if is_sensitive_key(&entry.key) {
                    push_doctor_redaction_value(&mut values, Some(entry.value.as_str()));
                }
            }
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

fn is_sensitive_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    lower.contains("key")
        || lower.contains("token")
        || lower.contains("secret")
        || lower.contains("password")
}

fn redact_and_limit_doctor_output(output: &str, secrets: &[String]) -> String {
    let mut redacted = output.trim().to_string();
    for secret in secrets {
        redacted = redacted.replace(secret, "[REDACTED]");
    }

    let max_chars = 12_000usize;
    if redacted.chars().count() <= max_chars {
        return redacted;
    }

    let truncated: String = redacted.chars().take(max_chars).collect();
    format!("{truncated}\n...[truncated]")
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

fn start_graceful_exit(app: AppHandle, source: &str) {
    if is_graceful_exit_in_progress(&app) {
        return;
    }

    window_manager::permit_process_exit(&app, source);
    log_manager::append_line(&app, format!("graceful exit requested (source={source})"));
    emit_shutdown_progress(&app, "close_requested", Some("正在关闭后端服务…"), Some(0));

    let source = source.to_string();
    thread::spawn(move || {
        let started = Instant::now();
        emit_shutdown_progress(&app, "stopping_backend", Some("正在关闭后端服务…"), Some(0));
        if let Err(error) = backend_manager::stop_backend(&app) {
            log_manager::append_line(
                &app,
                format!("shutdown stop_backend failed (source={source}): {error:#}"),
            );
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

fn is_graceful_exit_in_progress(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let lock = state.runtime.lock();
    let Ok(runtime) = lock else {
        return false;
    };
    matches!(runtime.state, BackendState::Stopping)
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
    let status = context_menu::status(app);
    if !status.supported {
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
    fn onboarding_is_shown_for_missing_kimi_even_if_completed() {
        let mut settings = AppSettings::default();
        settings.onboarding_completed_version = CURRENT_ONBOARDING_VERSION;
        assert!(should_show_onboarding(
            &settings,
            false,
            BackendState::MissingKimi
        ));
    }

    #[test]
    fn onboarding_is_hidden_after_completion_for_normal_startup() {
        let mut settings = AppSettings::default();
        settings.onboarding_completed_version = CURRENT_ONBOARDING_VERSION;
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
}
