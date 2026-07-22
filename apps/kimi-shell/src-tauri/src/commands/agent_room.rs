use tauri::AppHandle;

use crate::{
    agent_room_event_pump, bridge_manager,
    types::{
        AgentConnectorBinding, AgentConnectorBindingInput, AgentProfile, AgentProfileInput,
        AgentProfilePatchInput, AgentRoom, AgentRoomCapability, AgentRoomCommandError,
        AgentRoomDetail, AgentRoomDispatchResult, AgentRoomEventPage, AgentRoomInput,
        AgentRoomList, AgentRoomMember, AgentRoomMemberInput, AgentRoomMemberPatchInput,
        AgentRoomMutationResult, AgentRoomObservationPage, AgentRoomObservationPinResult,
        AgentRoomPage, AgentRoomPatchInput, AgentRoomPostMessageInput, AgentRoomTimeline, AgentRun,
        AgentRunRetryInput, BridgeApprovalResolveInput, PaneSessionSyncInput,
        PaneSessionSyncResult, SessionOpenDisposition, WorkspaceSessionBridgePayload,
        WorkspaceSessionDisposition,
    },
    window_manager,
};

fn ensure_agent_room_enabled(app: &AppHandle) -> Result<(), AgentRoomCommandError> {
    if bridge_manager::agent_room_feature_enabled(app) {
        Ok(())
    } else {
        Err(AgentRoomCommandError::local(
            "feature_disabled",
            "Agent Room is disabled",
        ))
    }
}

fn window_error(error: String) -> AgentRoomCommandError {
    AgentRoomCommandError::local("window_unavailable", error)
}

#[tauri::command]
pub(crate) fn agent_room_show_window(
    app: AppHandle,
) -> Result<window_manager::AgentRoomWindowState, AgentRoomCommandError> {
    ensure_agent_room_enabled(&app)?;
    let state = window_manager::show_agent_room_window(&app).map_err(window_error)?;
    agent_room_event_pump::ensure_started(&app);
    Ok(state)
}

#[tauri::command]
pub(crate) fn agent_room_hide_window(
    app: AppHandle,
) -> Result<window_manager::AgentRoomWindowState, AgentRoomCommandError> {
    window_manager::hide_agent_room_window(&app).map_err(window_error)
}

#[tauri::command]
pub(crate) fn agent_room_toggle_window(
    app: AppHandle,
) -> Result<window_manager::AgentRoomWindowState, AgentRoomCommandError> {
    ensure_agent_room_enabled(&app)?;
    let state = window_manager::toggle_agent_room_window(&app).map_err(window_error)?;
    if state.visible {
        agent_room_event_pump::ensure_started(&app);
    }
    Ok(state)
}

#[tauri::command]
pub(crate) fn agent_room_list_agents(
    app: AppHandle,
) -> Result<AgentRoomList<AgentProfile>, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_list_agents()
}

#[tauri::command]
pub(crate) fn agent_room_create_agent(
    app: AppHandle,
    input: AgentProfileInput,
) -> Result<AgentProfile, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_create_agent(&input)
}

#[tauri::command]
pub(crate) fn agent_room_update_agent(
    app: AppHandle,
    agent_id: String,
    input: AgentProfilePatchInput,
) -> Result<AgentProfile, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_update_agent(&agent_id, &input)
}

#[tauri::command]
pub(crate) fn agent_room_delete_agent(
    app: AppHandle,
    agent_id: String,
) -> Result<AgentRoomMutationResult, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_delete_agent(&agent_id)
}

#[tauri::command]
pub(crate) fn agent_room_list_rooms(
    app: AppHandle,
    archived: Option<bool>,
    limit: Option<usize>,
    cursor: Option<String>,
) -> Result<AgentRoomPage<AgentRoom>, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_list_rooms(
        archived,
        limit.unwrap_or(50),
        cursor.as_deref(),
    )
}

#[tauri::command]
pub(crate) fn agent_room_get_room(
    app: AppHandle,
    room_id: String,
) -> Result<AgentRoomDetail, AgentRoomCommandError> {
    let result = bridge_manager::agent_room_client(&app)?.agent_room_get_room(&room_id)?;
    agent_room_event_pump::ensure_started(&app);
    Ok(result)
}

#[tauri::command]
pub(crate) fn agent_room_create_room(
    app: AppHandle,
    input: AgentRoomInput,
) -> Result<AgentRoom, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_create_room(&input)
}

#[tauri::command]
pub(crate) fn agent_room_update_room(
    app: AppHandle,
    room_id: String,
    input: AgentRoomPatchInput,
) -> Result<AgentRoom, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_update_room(&room_id, &input)
}

#[tauri::command]
pub(crate) fn agent_room_delete_room(
    app: AppHandle,
    room_id: String,
) -> Result<AgentRoomMutationResult, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_delete_room(&room_id)
}

#[tauri::command]
pub(crate) fn agent_room_list_members(
    app: AppHandle,
    room_id: String,
) -> Result<AgentRoomList<AgentRoomMember>, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_list_members(&room_id)
}

#[tauri::command]
pub(crate) fn agent_room_add_member(
    app: AppHandle,
    room_id: String,
    input: AgentRoomMemberInput,
) -> Result<AgentRoomMember, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_add_member(&room_id, &input)
}

#[tauri::command]
pub(crate) fn agent_room_update_member(
    app: AppHandle,
    room_id: String,
    member_id: String,
    input: AgentRoomMemberPatchInput,
) -> Result<AgentRoomMember, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_update_member(&room_id, &member_id, &input)
}

#[tauri::command]
pub(crate) fn agent_room_delete_member(
    app: AppHandle,
    room_id: String,
    member_id: String,
) -> Result<AgentRoomMutationResult, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_delete_member(&room_id, &member_id)
}

#[tauri::command]
pub(crate) fn agent_room_get_timeline(
    app: AppHandle,
    room_id: String,
    after_seq: Option<i64>,
    before_seq: Option<i64>,
    limit: Option<usize>,
) -> Result<AgentRoomTimeline, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_get_timeline(
        &room_id,
        after_seq.unwrap_or(0),
        before_seq.unwrap_or(0),
        limit.unwrap_or(100),
    )
}

#[tauri::command]
pub(crate) fn agent_room_get_run(
    app: AppHandle,
    run_id: String,
) -> Result<AgentRun, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_get_run(&run_id)
}

#[tauri::command]
pub(crate) fn agent_room_post_message(
    app: AppHandle,
    room_id: String,
    input: AgentRoomPostMessageInput,
) -> Result<AgentRoomDispatchResult, AgentRoomCommandError> {
    let client = bridge_manager::agent_room_client(&app)?;
    let capabilities = client.agent_room_get_capabilities()?;
    if !capabilities.observer {
        return Err(AgentRoomCommandError::local(
            "observer_not_running",
            "Agent Room dispatch is unavailable until Observer is running",
        ));
    }
    let result = client.agent_room_post_message(&room_id, &input)?;
    agent_room_event_pump::ensure_started(&app);
    Ok(result)
}

#[tauri::command]
pub(crate) fn agent_room_resolve_workflow(
    app: AppHandle,
    room_id: String,
    message_id: String,
    decision: String,
) -> Result<AgentRoomDispatchResult, AgentRoomCommandError> {
    let result = bridge_manager::agent_room_client(&app)?.agent_room_resolve_workflow(
        &room_id,
        &message_id,
        &decision,
    )?;
    agent_room_event_pump::ensure_started(&app);
    Ok(result)
}

#[tauri::command]
pub(crate) fn agent_room_list_connector_bindings(
    app: AppHandle,
) -> Result<AgentRoomList<AgentConnectorBinding>, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_list_connector_bindings()
}

#[tauri::command]
pub(crate) fn agent_room_put_connector_binding(
    app: AppHandle,
    connector_id: String,
    input: AgentConnectorBindingInput,
) -> Result<AgentConnectorBinding, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_put_connector_binding(&connector_id, &input)
}

#[tauri::command]
pub(crate) fn agent_room_delete_connector_binding(
    app: AppHandle,
    connector_id: String,
) -> Result<AgentRoomMutationResult, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_delete_connector_binding(&connector_id)
}

#[tauri::command]
pub(crate) fn agent_room_abort_run(
    app: AppHandle,
    run_id: String,
) -> Result<crate::types::AgentRun, AgentRoomCommandError> {
    let client = bridge_manager::agent_room_client(&app)?;
    let result = client.agent_room_abort_run(&run_id)?;
    agent_room_event_pump::ensure_started(&app);
    Ok(result)
}

#[tauri::command]
pub(crate) fn agent_room_retry_run(
    app: AppHandle,
    run_id: String,
    input: AgentRunRetryInput,
) -> Result<AgentRun, AgentRoomCommandError> {
    let result = bridge_manager::agent_room_client(&app)?.agent_room_retry_run(&run_id, &input)?;
    agent_room_event_pump::ensure_started(&app);
    Ok(result)
}

#[tauri::command]
pub(crate) fn agent_room_resolve_approval(
    app: AppHandle,
    input: BridgeApprovalResolveInput,
) -> Result<(), AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_resolve_approval(&input)?;
    agent_room_event_pump::ensure_started(&app);
    Ok(())
}

#[tauri::command]
pub(crate) fn agent_room_sync_pane_sessions(
    app: AppHandle,
    input: PaneSessionSyncInput,
) -> Result<PaneSessionSyncResult, AgentRoomCommandError> {
    let result = bridge_manager::agent_room_client(&app)?.agent_room_sync_pane_sessions(&input)?;
    agent_room_event_pump::set_pane_refs(&app, result.observed_session_ids.len());
    Ok(result)
}

#[tauri::command]
pub(crate) fn agent_room_get_capabilities(
    app: AppHandle,
) -> Result<AgentRoomCapability, AgentRoomCommandError> {
    bridge_manager::agent_room_client(&app)?.agent_room_get_capabilities()
}

#[tauri::command]
pub(crate) fn agent_room_list_observations(
    app: AppHandle,
) -> Result<AgentRoomObservationPage, AgentRoomCommandError> {
    let result = bridge_manager::agent_room_client(&app)?.agent_room_list_observations()?;
    if !result.pinned_session_ids.is_empty() {
        agent_room_event_pump::ensure_started(&app);
    }
    Ok(result)
}

#[tauri::command]
pub(crate) fn agent_room_set_observation_pin(
    app: AppHandle,
    session_id: String,
    pinned: bool,
) -> Result<AgentRoomObservationPinResult, AgentRoomCommandError> {
    let result = bridge_manager::agent_room_client(&app)?
        .agent_room_set_observation_pin(&session_id, pinned)?;
    if pinned {
        agent_room_event_pump::ensure_started(&app);
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn agent_room_poll_events(
    app: AppHandle,
    after_seq: i64,
    room_id: Option<String>,
    limit: Option<usize>,
    wait_ms: Option<u64>,
) -> Result<AgentRoomEventPage, AgentRoomCommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        bridge_manager::agent_room_client(&app)?.agent_room_poll_events(
            after_seq,
            room_id.as_deref(),
            limit.unwrap_or(100),
            wait_ms.unwrap_or(25_000),
        )
    })
    .await
    .map_err(|_| AgentRoomCommandError::local("bridge_unavailable", "Agent Room poll stopped"))?
}

#[tauri::command]
pub(crate) fn agent_room_open_session(
    app: AppHandle,
    session_id: String,
    work_dir: Option<String>,
    disposition: SessionOpenDisposition,
) -> Result<WorkspaceSessionBridgePayload, AgentRoomCommandError> {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return Err(AgentRoomCommandError::local(
            "session_required",
            "Session ID is required",
        ));
    }
    let session = crate::workspace_session::get_workspace_session_for_grid(&app, session_id)
        .map_err(|_| AgentRoomCommandError::local("session_not_found", "Session was not found"))?;
    let work_dir = work_dir
        .filter(|value| !value.trim().is_empty())
        .or_else(|| session.work_dir.filter(|value| !value.trim().is_empty()));
    let disposition = match disposition {
        SessionOpenDisposition::FocusExisting => WorkspaceSessionDisposition::FocusExisting,
        SessionOpenDisposition::NewPane => WorkspaceSessionDisposition::NewPane,
    };
    let payload = WorkspaceSessionBridgePayload {
        action: "navigate_session".to_string(),
        source: "agent_room".to_string(),
        request_id: None,
        session_id: Some(session_id.to_string()),
        work_dir,
        route_template: Some("/sessions/{sessionId}".to_string()),
        disposition: Some(disposition),
        target_window_label: Some(window_manager::MAIN_WINDOW_LABEL.to_string()),
        applied: None,
        reason: None,
    };
    if window_manager::publish_workspace_session_event(
        &app,
        "workspace-session-bridge",
        &payload,
        "agent_room",
    ) {
        window_manager::show_main_window(&app);
    }
    Ok(payload)
}
