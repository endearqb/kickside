use tauri::{AppHandle, Manager};

use crate::{
    agent_room_event_pump,
    app_state::AppState,
    bridge_manager, bridge_settings_store, feishu_onboarding, settings_store,
    types::{
        BindingRecord, BridgeApprovalRecord, BridgeApprovalResolveInput, BridgeChannelState,
        BridgeChannelStatus, BridgeConnectorSecretsInput, BridgeOnboardingConfigInput,
        BridgeRuntimeState, BridgeSecretsMaskView, BridgeSessionImportInput, BridgeSessionRecord,
        BridgeSessionSource, BridgeSettings, BridgeStatus, FeishuConnectorOnboardingSession,
        StartFeishuConnectorOnboardingInput, StartWeixinConnectorOnboardingInput,
        WeixinConnectorOnboardingSession,
    },
    weixin_onboarding, window_manager, workspace_session,
};

#[tauri::command]
pub(crate) fn get_bridge_settings(app: AppHandle) -> Result<BridgeSettings, String> {
    bridge_settings_store::load_or_default(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn save_bridge_settings(
    app: AppHandle,
    input: BridgeSettings,
) -> Result<BridgeSettings, String> {
    let saved = bridge_settings_store::save(&app, &input).map_err(|error| error.to_string())?;
    sync_idle_bridge_runtime(&app, &saved)?;
    Ok(saved)
}

#[tauri::command]
pub(crate) fn delete_bridge_connector(
    app: AppHandle,
    connector_id: String,
) -> Result<BridgeSettings, String> {
    let saved = bridge_settings_store::delete_connector(&app, &connector_id)
        .map_err(|error| error.to_string())?;
    sync_idle_bridge_runtime(&app, &saved)?;
    Ok(saved)
}

#[tauri::command]
pub(crate) fn save_bridge_onboarding_config(
    app: AppHandle,
    input: BridgeOnboardingConfigInput,
) -> Result<BridgeSettings, String> {
    let saved = bridge_settings_store::save_onboarding_config(&app, &input)
        .map_err(|error| error.to_string())?;
    sync_idle_bridge_runtime(&app, &saved)?;
    Ok(saved)
}

#[tauri::command]
pub(crate) fn get_bridge_status(app: AppHandle) -> Result<BridgeStatus, String> {
    bridge_manager::get_bridge_status(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn start_bridge(app: AppHandle) -> Result<BridgeStatus, String> {
    let pump_app = app.clone();
    let status = tauri::async_runtime::spawn_blocking(move || {
        bridge_manager::start_bridge(&app).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("failed to join start bridge task: {error}"))??;
    if bridge_manager::agent_room_feature_enabled(&pump_app) {
        agent_room_event_pump::ensure_started(&pump_app);
    }
    Ok(status)
}

#[tauri::command]
pub(crate) async fn stop_bridge(app: AppHandle) -> Result<BridgeStatus, String> {
    agent_room_event_pump::stop(&app);
    tauri::async_runtime::spawn_blocking(move || {
        bridge_manager::stop_bridge(&app).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("failed to join stop bridge task: {error}"))?
}

#[tauri::command]
pub(crate) async fn restart_bridge(app: AppHandle) -> Result<BridgeStatus, String> {
    agent_room_event_pump::stop(&app);
    let pump_app = app.clone();
    let status = tauri::async_runtime::spawn_blocking(move || {
        bridge_manager::restart_bridge(&app).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("failed to join restart bridge task: {error}"))??;
    if bridge_manager::agent_room_feature_enabled(&pump_app) {
        agent_room_event_pump::ensure_started(&pump_app);
    }
    Ok(status)
}

#[tauri::command]
pub(crate) async fn set_agent_room_enabled(
    app: AppHandle,
    enabled: bool,
) -> Result<BridgeStatus, String> {
    let current_status =
        bridge_manager::get_bridge_status(&app).map_err(|error| error.to_string())?;
    let mut settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    if settings.agent_room_enabled == enabled {
        return Ok(current_status);
    }

    settings.agent_room_enabled = enabled;
    settings_store::save(&app, &settings).map_err(|error| error.to_string())?;
    agent_room_event_pump::stop(&app);
    if !enabled {
        let _ = window_manager::hide_agent_room_window(&app);
    }

    if matches!(
        current_status.state,
        BridgeRuntimeState::Running | BridgeRuntimeState::Degraded
    ) {
        let pump_app = app.clone();
        let status = tauri::async_runtime::spawn_blocking(move || {
            bridge_manager::restart_bridge(&app).map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| format!("failed to join Agent Room bridge restart task: {error}"))??;
        if enabled {
            agent_room_event_pump::ensure_started(&pump_app);
        }
        Ok(status)
    } else {
        bridge_manager::get_bridge_status(&app).map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub(crate) fn list_bridge_bindings(app: AppHandle) -> Result<Vec<BindingRecord>, String> {
    bridge_manager::list_bridge_bindings(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_bridge_sessions(app: AppHandle) -> Result<Vec<BridgeSessionRecord>, String> {
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
pub(crate) fn clear_bridge_binding(app: AppHandle, binding_id: String) -> Result<(), String> {
    bridge_manager::clear_bridge_binding(&app, &binding_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn reset_bridge_binding_session(
    app: AppHandle,
    binding_id: String,
) -> Result<(), String> {
    bridge_manager::reset_bridge_binding_session(&app, &binding_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn reset_bridge_binding_to_default_work_dir(
    app: AppHandle,
    binding_id: String,
) -> Result<(), String> {
    bridge_manager::reset_bridge_binding_to_default_work_dir(&app, &binding_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_bridge_approvals(
    app: AppHandle,
    status: Option<String>,
) -> Result<Vec<BridgeApprovalRecord>, String> {
    bridge_manager::list_bridge_approvals(&app, status.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn resolve_bridge_approval(
    app: AppHandle,
    input: BridgeApprovalResolveInput,
) -> Result<(), String> {
    bridge_manager::resolve_bridge_approval(&app, &input).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn import_bridge_session(
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
pub(crate) fn get_bridge_log_tail(
    app: AppHandle,
    max_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    bridge_manager::get_bridge_log_tail(&app, max_lines).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_bridge_secrets_mask_view(
    app: AppHandle,
) -> Result<BridgeSecretsMaskView, String> {
    bridge_manager::get_bridge_secrets_mask_view(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn save_bridge_connector_secrets(
    app: AppHandle,
    input: BridgeConnectorSecretsInput,
) -> Result<BridgeSecretsMaskView, String> {
    bridge_settings_store::save_connector_secrets(&app, &input)
        .map_err(|error| error.to_string())?;
    bridge_manager::get_bridge_secrets_mask_view(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn start_feishu_connector_onboarding(
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
pub(crate) async fn get_feishu_connector_onboarding_status(
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
pub(crate) fn cancel_feishu_connector_onboarding(
    app: AppHandle,
    session_id: String,
) -> Result<FeishuConnectorOnboardingSession, String> {
    feishu_onboarding::cancel(&app, &session_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn start_weixin_connector_onboarding(
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
pub(crate) async fn get_weixin_connector_onboarding_status(
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
pub(crate) fn cancel_weixin_connector_onboarding(
    app: AppHandle,
    session_id: String,
) -> Result<WeixinConnectorOnboardingSession, String> {
    weixin_onboarding::cancel(&app, &session_id).map_err(|error| error.to_string())
}

fn sync_idle_bridge_runtime(app: &AppHandle, saved: &BridgeSettings) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut runtime = state
        .bridge_runtime
        .lock()
        .map_err(|_| "bridge runtime mutex is poisoned".to_string())?;
    if !matches!(
        runtime.state,
        BridgeRuntimeState::Running | BridgeRuntimeState::Starting | BridgeRuntimeState::Degraded
    ) {
        runtime.admin_port = saved.admin_port;
        runtime.channels = saved
            .connectors
            .iter()
            .map(|connector| BridgeChannelStatus {
                connector_id: connector.id.clone(),
                connector_label: connector.label.clone(),
                platform: connector.platform,
                enabled: connector.enabled,
                state: BridgeChannelState::Idle,
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
