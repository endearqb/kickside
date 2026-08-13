use std::{
    fmt::Write as _,
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::{
    api_v1_client::ApiV1Client,
    app_state::{unix_time_millis, AppState, PendingWorkspaceBootstrap},
    auth_state, log_manager, settings_store, skill_center, token_resolver,
    types::{
        AuthMode, BackendState, KimiLoginHealthSource, KimiLoginHealthState,
        OpenRequestErrorPayload, ProviderApiHealthSource, ProviderApiHealthState,
        WorkspaceSessionBridgePayload, WorkspaceSessionDisposition,
    },
    window_manager,
};

const WORKSPACE_SESSION_BOOTSTRAP_EVENT: &str = "workspace-session-bootstrap";
const WORKSPACE_SESSION_BRIDGE_EVENT: &str = "workspace-session-bridge";
const WORKSPACE_SESSION_POLL_INTERVAL_MS: u64 = 1_200;
const SESSION_LIST_FETCH_LIMIT: usize = 100;
const MAX_SESSION_ID_LENGTH: usize = 512;
const BOOTSTRAP_ROUTE_TEMPLATE: &str = "/?session={{session_id}}";
const MAX_PENDING_WORKSPACE_BOOTSTRAPS: usize = 64;

#[derive(Debug, Clone, Deserialize)]
struct ApiSession {
    #[serde(alias = "id", alias = "sessionId")]
    session_id: String,
    #[serde(default, alias = "workDir", alias = "cwd", alias = "workspace_root")]
    work_dir: Option<String>,
    #[serde(default)]
    is_running: bool,
    #[serde(default, alias = "updated_at", alias = "updatedAt")]
    last_updated: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSessionRecord {
    pub session_id: String,
    pub work_dir: Option<String>,
    pub is_running: bool,
    pub last_updated: Option<String>,
}

impl ApiSession {
    fn normalized(mut self) -> Self {
        if self
            .work_dir
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
        {
            self.work_dir = self
                .metadata
                .as_ref()
                .and_then(extract_work_dir_from_metadata);
        }

        if !self.is_running {
            self.is_running = self
                .status
                .as_deref()
                .map(is_active_session_status)
                .unwrap_or(false);
        }

        self
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum SessionListData {
    Page { items: Vec<ApiSession> },
    Sessions { sessions: Vec<ApiSession> },
    List(Vec<ApiSession>),
}

impl SessionListData {
    fn into_sessions(self) -> Vec<ApiSession> {
        match self {
            SessionListData::Page { items } => items,
            SessionListData::Sessions { sessions } => sessions,
            SessionListData::List(sessions) => sessions,
        }
        .into_iter()
        .map(ApiSession::normalized)
        .collect()
    }
}

#[derive(Debug, Clone, Deserialize)]
struct ApiWorkspace {
    id: String,
    #[allow(dead_code)]
    root: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SessionSnapshot {
    session_id: String,
    work_dir: Option<String>,
}

pub fn queue_explorer_workspace_open(
    app: &AppHandle,
    work_dir: &Path,
    source: &str,
    request_id: String,
) -> Result<bool, String> {
    let normalized = normalize_path(work_dir);
    let _ = skill_center::track_workspace_root(app, &normalized);
    {
        let state = app.state::<AppState>();
        let mut runtime = state
            .runtime
            .lock()
            .map_err(|_| "runtime mutex poisoned while queuing Explorer open".to_string())?;
        if runtime.pending_workspace_bootstraps.len() >= MAX_PENDING_WORKSPACE_BOOTSTRAPS {
            return Err(format!(
                "Explorer open queue is full ({MAX_PENDING_WORKSPACE_BOOTSTRAPS} requests)"
            ));
        }
        runtime
            .pending_workspace_bootstraps
            .push_back(PendingWorkspaceBootstrap {
                work_dir: normalized,
                force_create_new: true,
                source: source.to_string(),
                request_id: Some(request_id),
                disposition: WorkspaceSessionDisposition::NewPane,
            });
    }
    let ready = runtime_api_ready(app).unwrap_or(false);
    if ready {
        kick_workspace_bootstrap_worker(app);
    }
    Ok(ready)
}

pub fn clear_active_session_runtime(app: &AppHandle, source: &str) {
    let previous_session_id = {
        let state = app.state::<AppState>();
        let lock = state.runtime.lock();
        let Ok(mut runtime) = lock else {
            return;
        };

        let previous = runtime.active_session_id.clone();
        runtime.active_session_id = None;
        runtime.active_session_work_dir = None;
        runtime.session_source = Some(format!("cleared:{source}"));
        previous
    };

    cleanup_replaced_session_skills(app, previous_session_id.as_deref(), None, source);
}

fn cleanup_replaced_session_skills(
    app: &AppHandle,
    previous_session_id: Option<&str>,
    next_session_id: Option<&str>,
    source: &str,
) {
    let Some(previous_session_id) = previous_session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return;
    };
    if Some(previous_session_id) == next_session_id {
        return;
    }
    if let Err(error) = skill_center::cleanup_session_skill_projections(app, previous_session_id) {
        log_manager::append_line(
            app,
            format!(
                "failed to cleanup previous session skills (source={source}, session_id={previous_session_id}): {error:#}"
            ),
        );
    }
}

pub fn handle_backend_ready(app: &AppHandle, generation: u64, workspace_port: u16) {
    {
        let state = app.state::<AppState>();
        let lock = state.runtime.lock();
        let Ok(mut runtime) = lock else {
            return;
        };
        if runtime.generation != generation
            || runtime.state != BackendState::Running
            || runtime.workspace_port != Some(workspace_port)
        {
            return;
        }
        if runtime.pending_workspace_bootstraps.is_empty() {
            if let Some(work_dir) = runtime.effective_work_dir.clone() {
                runtime
                    .pending_workspace_bootstraps
                    .push_back(PendingWorkspaceBootstrap {
                        work_dir,
                        force_create_new: false,
                        source: "backend_ready_bootstrap".to_string(),
                        request_id: None,
                        disposition: WorkspaceSessionDisposition::ReplaceActive,
                    });
            }
        }
    }
    start_session_poller(app.clone(), generation, workspace_port);
    kick_workspace_bootstrap_worker(app);
}

fn kick_workspace_bootstrap_worker(app: &AppHandle) {
    let generation = {
        let state = app.state::<AppState>();
        let Ok(mut runtime) = state.runtime.lock() else {
            return;
        };
        if runtime.workspace_bootstrap_worker_generation.is_some()
            || runtime.pending_workspace_bootstraps.is_empty()
        {
            return;
        }
        let generation = runtime.generation;
        runtime.workspace_bootstrap_worker_generation = Some(generation);
        generation
    };

    let app = app.clone();
    thread::spawn(move || {
        loop {
            let request = {
                let state = app.state::<AppState>();
                let Ok(runtime) = state.runtime.lock() else {
                    // A poisoned runtime cannot safely transfer worker ownership.
                    return;
                };
                if runtime.generation != generation
                    || runtime.workspace_bootstrap_worker_generation != Some(generation)
                {
                    break;
                }
                let Some(request) = runtime.pending_workspace_bootstraps.front().cloned() else {
                    break;
                };
                request
            };

            if !process_bootstrap_session(&app, generation, request) {
                break;
            }

            let state = app.state::<AppState>();
            let Ok(mut runtime) = state.runtime.lock() else {
                return;
            };
            if runtime.workspace_bootstrap_worker_generation != Some(generation) {
                break;
            }
            runtime.pending_workspace_bootstraps.pop_front();
            if runtime.generation != generation {
                break;
            }
        }

        {
            let state = app.state::<AppState>();
            let Ok(mut runtime) = state.runtime.lock() else {
                return;
            };
            clear_workspace_bootstrap_worker_owner(
                &mut runtime.workspace_bootstrap_worker_generation,
                generation,
            );
        }
        if runtime_api_ready(&app).unwrap_or(false) {
            kick_workspace_bootstrap_worker(&app);
        }
    });
}

fn clear_workspace_bootstrap_worker_owner(owner: &mut Option<u64>, generation: u64) {
    if *owner == Some(generation) {
        *owner = None;
    }
}

pub fn note_session_stream_activity(app: &AppHandle, session_id: &str, source: &str) {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return;
    }

    let generation = {
        let state = app.state::<AppState>();
        let lock = state.runtime.lock();
        let Ok(runtime) = lock else {
            return;
        };
        if !matches!(
            runtime.state,
            BackendState::Starting | BackendState::Running
        ) {
            return;
        }
        if runtime.active_session_id.as_deref() == Some(session_id)
            && runtime.active_session_work_dir.is_some()
        {
            return;
        }
        if runtime.runtime_origin.is_none() || runtime.server_token_path.is_none() {
            return;
        }
        runtime.generation
    };

    let source = source.to_string();
    let session_id = session_id.to_string();
    let app = app.clone();
    thread::spawn(move || {
        if !should_poll(&app, generation) {
            return;
        }

        match fetch_session_by_id(&app, &session_id) {
            Ok(Some(snapshot)) => {
                apply_active_session_snapshot(
                    &app,
                    Some(snapshot),
                    &format!("stream_hint:{source}"),
                );
            }
            Ok(None) => {
                log_manager::append_line(
                    &app,
                    format!(
                        "workspace stream hint ignored: session not found (source={source}, session_id={session_id})"
                    ),
                );
            }
            Err(error) => {
                log_manager::append_line(
                    &app,
                    format!(
                        "workspace stream hint fetch failed (source={source}, session_id={session_id}): {error}"
                    ),
                );
            }
        }
    });
}

fn start_session_poller(app: AppHandle, generation: u64, _workspace_port: u16) {
    thread::spawn(move || {
        let mut last_error: Option<String> = None;
        loop {
            if !should_poll(&app, generation) {
                return;
            }

            match fetch_active_session(&app) {
                Ok(snapshot) => {
                    if let Some(error) = last_error.take() {
                        log_manager::append_line(
                            &app,
                            format!(
                                "workspace session poll recovered from previous error: {error}"
                            ),
                        );
                    }
                    apply_active_session_snapshot(&app, snapshot, "poll");
                }
                Err(error) => {
                    if last_error.as_deref() != Some(error.as_str()) {
                        log_manager::append_line(
                            &app,
                            format!("workspace session poll failed: {error}"),
                        );
                        last_error = Some(error);
                    }
                }
            }

            thread::sleep(Duration::from_millis(WORKSPACE_SESSION_POLL_INTERVAL_MS));
        }
    });
}

fn process_bootstrap_session(
    app: &AppHandle,
    generation: u64,
    request: PendingWorkspaceBootstrap,
) -> bool {
    let work_dir = request.work_dir;
    let source = request.source;
    let force_create_new = request.force_create_new;
    let disposition = request.disposition;
    let existing_session = if force_create_new {
        None
    } else {
        match fetch_sessions(app) {
            Ok(sessions) => select_latest_session_for_work_dir(&sessions, &work_dir),
            Err(error) => {
                maybe_capture_workspace_auth_failure(app, &error);
                log_manager::append_line(
                        app,
                        format!(
                            "workspace bootstrap failed to list sessions; fallback to create (source={source}, work_dir={}): {error}",
                            work_dir.display()
                        ),
                    );
                None
            }
        }
    };

    let (session, snapshot_source) = if let Some(snapshot) = existing_session {
        log_manager::append_line(
            app,
            format!(
                "bootstrap_resume_existing source={source} work_dir={} session_id={}",
                work_dir.display(),
                snapshot.session_id
            ),
        );
        (snapshot, "bootstrap_resume_existing")
    } else {
        if !is_generation_alive(app, generation) {
            return false;
        }
        let response = create_session_for_work_dir(app, &work_dir);
        let created = match response {
            Ok(session) => session,
            Err(error) => {
                if !is_generation_alive(app, generation) {
                    return false;
                }
                maybe_capture_workspace_auth_failure(app, &error);
                let error_message = format!(
                        "workspace bootstrap session creation failed (source={source}, work_dir={}): {error}",
                        work_dir.display()
                    );
                log_manager::append_line(app, error_message.clone());
                if force_create_new {
                    emit_bootstrap_open_request_error(
                        app,
                        &source,
                        "create_session_for_work_dir",
                        &error_message,
                    );
                }
                return true;
            }
        };
        log_manager::append_line(
            app,
            format!(
                "bootstrap_create_new source={source} work_dir={} session_id={}",
                work_dir.display(),
                created.session_id
            ),
        );
        (session_snapshot_from_api(&created), "bootstrap_create_new")
    };

    if !is_generation_alive(app, generation) {
        return false;
    }

    let work_dir_value = session
        .work_dir
        .clone()
        .or_else(|| Some(work_dir.to_string_lossy().to_string()));
    let session_id = session.session_id.clone();
    let snapshot = SessionSnapshot {
        session_id: session_id.clone(),
        work_dir: work_dir_value.clone(),
    };
    if disposition == WorkspaceSessionDisposition::ReplaceActive {
        apply_active_session_snapshot(app, Some(snapshot), snapshot_source);
    }

    let request_id = request
        .request_id
        .unwrap_or_else(|| format!("ws-bootstrap-{}", unix_time_millis()));
    let payload = WorkspaceSessionBridgePayload {
        action: "navigate_session".to_string(),
        source: source.clone(),
        request_id: Some(request_id),
        session_id: Some(session_id.clone()),
        work_dir: work_dir_value,
        route_template: Some(BOOTSTRAP_ROUTE_TEMPLATE.to_string()),
        disposition: Some(disposition),
        target_window_label: Some(window_manager::MAIN_WINDOW_LABEL.to_string()),
        applied: None,
        reason: None,
    };

    if disposition == WorkspaceSessionDisposition::ReplaceActive {
        emit_workspace_session_event(app, WORKSPACE_SESSION_BOOTSTRAP_EVENT, &payload);
    }
    emit_workspace_session_event(app, WORKSPACE_SESSION_BRIDGE_EVENT, &payload);
    if disposition == WorkspaceSessionDisposition::NewPane {
        window_manager::show_and_focus(app);
    }

    log_manager::append_line(
            app,
            format!(
                "workspace bootstrap session ready (source={source}, work_dir={}, session_id={}, route_template={BOOTSTRAP_ROUTE_TEMPLATE}, force_create_new={force_create_new})",
                work_dir.display(),
                session_id
            ),
        );
    true
}

fn emit_bootstrap_open_request_error(app: &AppHandle, source: &str, stage: &str, message: &str) {
    let payload = OpenRequestErrorPayload {
        source: source.to_string(),
        stage: stage.to_string(),
        message: message.to_string(),
        args_summary: None,
    };
    window_manager::publish_open_request_error(app, &payload, "workspace_session_bootstrap");
}

fn fetch_active_session(app: &AppHandle) -> Result<Option<SessionSnapshot>, String> {
    let sessions = fetch_sessions(app)?;
    Ok(select_active_session(&sessions))
}

fn fetch_session_by_id(
    app: &AppHandle,
    session_id: &str,
) -> Result<Option<SessionSnapshot>, String> {
    fetch_api_session_by_id(app, session_id)
        .map(|session| Some(session_snapshot_from_api(&session)))
}

pub fn list_workspace_sessions_for_bridge(
    app: &AppHandle,
) -> anyhow::Result<Vec<WorkspaceSessionRecord>> {
    if !runtime_api_ready(app)? {
        return Ok(Vec::new());
    }

    let sessions = fetch_sessions(app).map_err(|error| {
        maybe_capture_workspace_auth_failure(app, &error);
        anyhow::anyhow!("failed to list workspace sessions: {error}")
    })?;
    remember_workspace_paths(app, &sessions);
    Ok(sessions
        .into_iter()
        .map(|session| WorkspaceSessionRecord {
            session_id: session.session_id,
            work_dir: session.work_dir,
            is_running: session.is_running,
            last_updated: session.last_updated,
        })
        .collect())
}

pub fn get_workspace_session_for_bridge(
    app: &AppHandle,
    session_id: &str,
) -> anyhow::Result<Option<WorkspaceSessionRecord>> {
    if !runtime_api_ready(app)? {
        return Ok(None);
    }

    let sessions = fetch_sessions(app).map_err(|error| {
        maybe_capture_workspace_auth_failure(app, &error);
        anyhow::anyhow!("failed to list workspace sessions: {error}")
    })?;
    remember_workspace_paths(app, &sessions);
    Ok(sessions
        .into_iter()
        .find(|session| session.session_id == session_id.trim())
        .map(|session| WorkspaceSessionRecord {
            session_id: session.session_id,
            work_dir: session.work_dir,
            is_running: session.is_running,
            last_updated: session.last_updated,
        }))
}

pub fn list_workspace_sessions_for_grid(
    app: &AppHandle,
) -> Result<Vec<WorkspaceSessionRecord>, String> {
    if !runtime_api_ready(app).map_err(|error| error.to_string())? {
        return Ok(Vec::new());
    }

    let sessions = fetch_sessions(app)?;
    remember_workspace_paths(app, &sessions);
    Ok(sessions
        .into_iter()
        .map(workspace_session_record_from_api)
        .collect())
}

pub fn get_workspace_session_for_grid(
    app: &AppHandle,
    session_id: &str,
) -> Result<WorkspaceSessionRecord, String> {
    let session = fetch_api_session_by_id(app, session_id)?;
    remember_workspace_paths(app, std::slice::from_ref(&session));
    Ok(workspace_session_record_from_api(session))
}

pub fn create_workspace_session_for_grid(
    app: &AppHandle,
    workspace_root: &Path,
) -> Result<WorkspaceSessionRecord, String> {
    let workspace_root = normalize_path(workspace_root);
    if workspace_root.as_os_str().is_empty() {
        return Err("workspace root is required".to_string());
    }

    let session = create_session_for_work_dir(app, &workspace_root)?;
    remember_workspace_paths(app, std::slice::from_ref(&session));
    Ok(workspace_session_record_from_api(session))
}

fn fetch_sessions(app: &AppHandle) -> Result<Vec<ApiSession>, String> {
    let client = require_runtime_api_client(app)?;
    fetch_sessions_with_client(&client)
}

fn fetch_sessions_with_client(client: &ApiV1Client) -> Result<Vec<ApiSession>, String> {
    let path = format!("sessions?page_size={SESSION_LIST_FETCH_LIMIT}");
    let data = client
        .get::<SessionListData>(&path)
        .map_err(|error| format!("GET `/api/v1/{path}` failed: {error:#}"))?;
    Ok(data.into_sessions())
}

fn fetch_api_session_by_id(app: &AppHandle, session_id: &str) -> Result<ApiSession, String> {
    let path = session_api_path(session_id)?;
    let client = require_runtime_api_client(app)?;
    client
        .get::<ApiSession>(&path)
        .map(ApiSession::normalized)
        .map_err(|error| format!("GET `/api/v1/{path}` failed: {error:#}"))
}

fn session_api_path(session_id: &str) -> Result<String, String> {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return Err("session id is required".to_string());
    }
    if session_id.len() > MAX_SESSION_ID_LENGTH {
        return Err(format!("session id exceeds {MAX_SESSION_ID_LENGTH} bytes"));
    }
    let mut encoded = String::with_capacity(session_id.len());
    for byte in session_id.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            write!(&mut encoded, "%{byte:02X}").expect("writing to a string cannot fail");
        }
    }
    Ok(format!("sessions/{encoded}"))
}

fn create_session_for_work_dir(app: &AppHandle, work_dir: &Path) -> Result<ApiSession, String> {
    let client = require_runtime_api_client(app)?;
    let workspace_id = match create_workspace_for_work_dir(&client, work_dir) {
        Ok(workspace) => Some(workspace.id),
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "workspace registration failed before session create; falling back to metadata.cwd (work_dir={}): {error}",
                    work_dir.display()
                ),
            );
            None
        }
    };
    let body = create_session_request_body(work_dir, workspace_id.as_deref());

    client
        .post::<Value, ApiSession>("sessions", &body)
        .map(ApiSession::normalized)
        .map_err(|error| format!("POST `/api/v1/sessions` failed: {error:#}"))
}

fn create_workspace_for_work_dir(
    client: &ApiV1Client,
    work_dir: &Path,
) -> Result<ApiWorkspace, String> {
    let root = api_workspace_root(work_dir);
    let body = json!({ "root": root });
    client
        .post::<Value, ApiWorkspace>("workspaces", &body)
        .map_err(|error| format!("POST `/api/v1/workspaces` failed: {error:#}"))
}

fn create_session_request_body(work_dir: &Path, workspace_id: Option<&str>) -> Value {
    if let Some(workspace_id) = workspace_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return json!({ "workspace_id": workspace_id });
    }

    json!({
        "metadata": {
            "cwd": api_workspace_root(work_dir)
        }
    })
}

fn runtime_api_ready(app: &AppHandle) -> anyhow::Result<bool> {
    let state = app.state::<AppState>();
    let runtime = state
        .runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
    Ok(runtime.runtime_origin.is_some() && runtime.server_token_path.is_some())
}

pub(crate) fn require_runtime_api_client(app: &AppHandle) -> Result<ApiV1Client, String> {
    let (origin, token_path) = {
        let state = app.state::<AppState>();
        let runtime = state
            .runtime
            .lock()
            .map_err(|_| "runtime state mutex is poisoned".to_string())?;
        (
            runtime.runtime_origin.clone(),
            runtime.server_token_path.clone(),
        )
    };

    let origin = origin.ok_or_else(|| "kimi-code runtime origin is unavailable".to_string())?;
    let token_path =
        token_path.ok_or_else(|| "kimi-code server token path is unavailable".to_string())?;
    let token = token_resolver::read_server_token_at(&token_path)
        .map_err(|error| format!("failed to read kimi-code server token: {error:#}"))?;

    ApiV1Client::new(origin, token.value)
        .map_err(|error| format!("failed to build kimi-code /api/v1 client: {error:#}"))
}

fn extract_work_dir_from_metadata(metadata: &Value) -> Option<String> {
    [
        "cwd",
        "work_dir",
        "workDir",
        "workspace_root",
        "workspaceRoot",
        "root",
    ]
    .iter()
    .find_map(|key| {
        metadata
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    })
}

fn is_active_session_status(status: &str) -> bool {
    matches!(
        status.trim(),
        "running" | "awaiting_approval" | "awaiting_question"
    )
}

fn maybe_capture_workspace_auth_failure(app: &AppHandle, error: &str) {
    if !looks_like_workspace_auth_failure(error) {
        return;
    }

    let settings = settings_store::load_or_default(app).unwrap_or_default();
    let auth_snapshot = match auth_state::resolve_auth_mode_snapshot(
        app,
        settings.onboarding_step_acks.login_verified,
    ) {
        Ok(snapshot) => snapshot,
        Err(_) => return,
    };
    let _ = auth_state::sync_runtime_auth_snapshot(app, &auth_snapshot);
    let exit_code = parse_workspace_auth_status_code(error);

    if auth_snapshot.auth_mode == AuthMode::ProviderApi {
        let _ = auth_state::update_provider_api_health(
            app,
            ProviderApiHealthState::AuthRequired,
            ProviderApiHealthSource::WorkspaceApi,
            error.to_string(),
            exit_code,
        );
        return;
    }

    let _ = auth_state::update_kimi_login_health(
        app,
        KimiLoginHealthState::AuthRequired,
        KimiLoginHealthSource::WorkspaceApi,
        error.to_string(),
        exit_code,
    );
}

fn looks_like_workspace_auth_failure(error: &str) -> bool {
    let normalized = error.to_lowercase();
    normalized.contains("returned 401")
        || normalized.contains("returned 403")
        || normalized.contains(" status 401")
        || normalized.contains(" status 403")
        || normalized.contains("unauthorized")
        || normalized.contains("forbidden")
        || normalized.contains("auth required")
        || normalized.contains("authentication")
        || normalized.contains("login required")
        || normalized.contains("not logged in")
}

fn parse_workspace_auth_status_code(error: &str) -> Option<i32> {
    let normalized = error.to_lowercase();
    if normalized.contains("401") || normalized.contains("unauthorized") {
        return Some(401);
    }
    if normalized.contains("403") || normalized.contains("forbidden") {
        return Some(403);
    }
    None
}

fn apply_active_session_snapshot(app: &AppHandle, snapshot: Option<SessionSnapshot>, source: &str) {
    let mut changed = false;
    let mut previous_session_id: Option<String> = None;
    let next_session_id = snapshot.as_ref().map(|item| item.session_id.clone());
    {
        let state = app.state::<AppState>();
        let lock = state.runtime.lock();
        let Ok(mut runtime) = lock else {
            return;
        };

        let next_id = next_session_id.clone();
        let next_work_dir = snapshot
            .as_ref()
            .and_then(|item| item.work_dir.as_ref())
            .map(PathBuf::from);

        if runtime.active_session_id != next_id || runtime.active_session_work_dir != next_work_dir
        {
            changed = true;
            previous_session_id = runtime.active_session_id.clone();
            runtime.active_session_id = next_id.clone();
            runtime.active_session_work_dir = next_work_dir.clone();
            runtime.session_source = Some(source.to_string());
        }
    }

    if !changed {
        return;
    }

    if let Some(work_dir) = snapshot
        .as_ref()
        .and_then(|item| item.work_dir.as_deref())
        .map(PathBuf::from)
    {
        let _ = skill_center::track_workspace_root(app, &work_dir);
    }

    cleanup_replaced_session_skills(
        app,
        previous_session_id.as_deref(),
        next_session_id.as_deref(),
        source,
    );

    let payload = WorkspaceSessionBridgePayload {
        action: "active_session_updated".to_string(),
        source: source.to_string(),
        request_id: None,
        session_id: snapshot.as_ref().map(|item| item.session_id.clone()),
        work_dir: snapshot.and_then(|item| item.work_dir),
        route_template: None,
        disposition: None,
        target_window_label: None,
        applied: None,
        reason: None,
    };
    emit_workspace_session_event(app, WORKSPACE_SESSION_BRIDGE_EVENT, &payload);
}

fn remember_workspace_paths(app: &AppHandle, sessions: &[ApiSession]) {
    for session in sessions {
        let Some(work_dir) = session.work_dir.as_deref() else {
            continue;
        };
        let _ = skill_center::track_workspace_root(app, Path::new(work_dir));
    }
}

fn emit_workspace_session_event(
    app: &AppHandle,
    event_name: &str,
    payload: &WorkspaceSessionBridgePayload,
) {
    window_manager::publish_workspace_session_event(app, event_name, payload, "workspace_session");
}

fn should_poll(app: &AppHandle, generation: u64) -> bool {
    let state = app.state::<AppState>();
    let lock = state.runtime.lock();
    let Ok(runtime) = lock else {
        return false;
    };

    runtime.generation == generation
        && matches!(
            runtime.state,
            BackendState::Starting | BackendState::Running
        )
}

fn is_generation_alive(app: &AppHandle, generation: u64) -> bool {
    let state = app.state::<AppState>();
    let lock = state.runtime.lock();
    let Ok(runtime) = lock else {
        return false;
    };
    runtime.generation == generation && matches!(runtime.state, BackendState::Running)
}

fn select_active_session(sessions: &[ApiSession]) -> Option<SessionSnapshot> {
    if sessions.is_empty() {
        return None;
    }

    let running = sessions
        .iter()
        .filter(|session| session.is_running)
        .max_by_key(|session| parse_last_updated(&session.last_updated));

    let fallback = sessions
        .iter()
        .max_by_key(|session| parse_last_updated(&session.last_updated));

    let selected = running.or(fallback)?;
    Some(session_snapshot_from_api(selected))
}

fn select_latest_session_for_work_dir(
    sessions: &[ApiSession],
    work_dir: &Path,
) -> Option<SessionSnapshot> {
    select_latest_session_for_work_dir_with_case(sessions, work_dir, cfg!(windows))
}

fn select_latest_session_for_work_dir_with_case(
    sessions: &[ApiSession],
    work_dir: &Path,
    case_insensitive: bool,
) -> Option<SessionSnapshot> {
    if sessions.is_empty() {
        return None;
    }

    let normalized_target = normalize_path_for_match_with_case(work_dir, case_insensitive);
    if normalized_target.is_empty() {
        return None;
    }

    sessions
        .iter()
        .filter(|session| {
            let Some(session_work_dir) = session.work_dir.as_ref() else {
                return false;
            };
            let normalized_session =
                normalize_path_for_match_with_case(Path::new(session_work_dir), case_insensitive);
            !normalized_session.is_empty() && normalized_session == normalized_target
        })
        .max_by_key(|session| parse_last_updated(&session.last_updated))
        .map(session_snapshot_from_api)
}

fn session_snapshot_from_api(session: &ApiSession) -> SessionSnapshot {
    SessionSnapshot {
        session_id: session.session_id.clone(),
        work_dir: session.work_dir.clone(),
    }
}

fn workspace_session_record_from_api(session: ApiSession) -> WorkspaceSessionRecord {
    WorkspaceSessionRecord {
        session_id: session.session_id,
        work_dir: session.work_dir,
        is_running: session.is_running,
        last_updated: session.last_updated,
    }
}

fn parse_last_updated(value: &Option<String>) -> i64 {
    let Some(raw) = value
        .as_ref()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
    else {
        return 0;
    };

    DateTime::parse_from_rfc3339(raw)
        .map(|value| value.with_timezone(&Utc).timestamp_millis())
        .unwrap_or(0)
}

fn normalize_path(path: &Path) -> PathBuf {
    let normalized = normalize_windows_urlish_path(path);
    normalized.canonicalize().unwrap_or(normalized)
}

fn normalize_windows_urlish_path(path: &Path) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(stripped) = strip_windows_drive_urlish_prefix(value.as_ref()) {
        return PathBuf::from(stripped);
    }

    path.to_path_buf()
}

fn api_workspace_root(path: &Path) -> String {
    let normalized = normalize_path(path);
    let value = normalized.to_string_lossy();
    let stripped = strip_windows_drive_urlish_prefix(value.as_ref()).unwrap_or(value.as_ref());
    stripped.replace('\\', "/")
}

fn strip_windows_drive_urlish_prefix(value: &str) -> Option<&str> {
    for prefix in ["/?/", "//?/", r"\\?\"] {
        let Some(stripped) = value.strip_prefix(prefix) else {
            continue;
        };

        let bytes = stripped.as_bytes();
        if bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'/' || bytes[2] == b'\\')
        {
            return Some(stripped);
        }
    }

    None
}

fn normalize_path_for_match_with_case(path: &Path, case_insensitive: bool) -> String {
    let normalized_path = normalize_path(path);
    let mut value = normalized_path.to_string_lossy().replace('\\', "/");
    while value.len() > 1 && value.ends_with('/') {
        if value.len() == 3 && value.as_bytes().get(1) == Some(&b':') {
            break;
        }
        value.pop();
    }
    if case_insensitive {
        value = value.to_lowercase();
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn session(
        id: &str,
        is_running: bool,
        last_updated: Option<&str>,
        work_dir: Option<&str>,
    ) -> ApiSession {
        ApiSession {
            session_id: id.to_string(),
            work_dir: work_dir.map(|item| item.to_string()),
            is_running,
            last_updated: last_updated.map(|item| item.to_string()),
            status: None,
            metadata: None,
        }
    }

    #[test]
    fn stale_worker_cannot_clear_new_worker_owner() {
        let mut owner = Some(2);
        clear_workspace_bootstrap_worker_owner(&mut owner, 1);
        assert_eq!(owner, Some(2));

        clear_workspace_bootstrap_worker_owner(&mut owner, 2);
        assert_eq!(owner, None);
    }

    #[test]
    fn select_active_session_prefers_running_sessions() {
        let sessions = vec![
            session(
                "stopped-new",
                false,
                Some("2026-03-05T10:20:00Z"),
                Some("D:/a"),
            ),
            session(
                "running-old",
                true,
                Some("2026-03-05T09:20:00Z"),
                Some("D:/b"),
            ),
            session(
                "running-new",
                true,
                Some("2026-03-05T11:20:00Z"),
                Some("D:/c"),
            ),
        ];

        let selected = select_active_session(&sessions).expect("must select one");
        assert_eq!(selected.session_id, "running-new");
        assert_eq!(selected.work_dir.as_deref(), Some("D:/c"));
    }

    #[test]
    fn select_active_session_falls_back_to_latest_when_none_running() {
        let sessions = vec![
            session("older", false, Some("2026-03-05T08:20:00Z"), Some("D:/a")),
            session("latest", false, Some("2026-03-05T12:20:00Z"), Some("D:/b")),
        ];

        let selected = select_active_session(&sessions).expect("must select one");
        assert_eq!(selected.session_id, "latest");
    }

    #[test]
    fn parse_last_updated_handles_invalid_value() {
        assert_eq!(parse_last_updated(&Some("invalid".to_string())), 0);
        assert_eq!(parse_last_updated(&None), 0);
    }

    #[test]
    fn session_api_path_encodes_untrusted_path_segments() {
        assert_eq!(
            session_api_path("../session id").expect("encoded path"),
            "sessions/%2E%2E%2Fsession%20id"
        );
        assert_eq!(session_api_path(".").expect("dot id"), "sessions/%2E");
        assert_eq!(
            session_api_path("..").expect("dot-dot id"),
            "sessions/%2E%2E"
        );
        assert!(session_api_path(" ").is_err());
        assert!(session_api_path(&"x".repeat(MAX_SESSION_ID_LENGTH + 1)).is_err());
    }

    #[test]
    fn select_latest_session_for_work_dir_prefers_latest_match() {
        let sessions = vec![
            session(
                "older-match",
                false,
                Some("2026-03-05T08:20:00Z"),
                Some("D:/Repo"),
            ),
            session(
                "newer-match",
                false,
                Some("2026-03-05T12:20:00Z"),
                Some("d:\\repo"),
            ),
            session(
                "other-workdir",
                true,
                Some("2026-03-05T14:20:00Z"),
                Some("D:/Other"),
            ),
        ];

        let selected =
            select_latest_session_for_work_dir_with_case(&sessions, Path::new("D:/REPO"), true)
                .expect("must select matching session");
        assert_eq!(selected.session_id, "newer-match");
    }

    #[test]
    fn select_latest_session_for_work_dir_returns_none_when_no_match() {
        let sessions = vec![
            session("first", false, Some("2026-03-05T08:20:00Z"), Some("D:/a")),
            session("second", false, Some("2026-03-05T12:20:00Z"), Some("D:/b")),
        ];

        let selected =
            select_latest_session_for_work_dir_with_case(&sessions, Path::new("D:/missing"), true);
        assert!(selected.is_none());
    }

    #[test]
    fn decode_api_v1_session_page_extracts_metadata_cwd() {
        let data = serde_json::from_str::<SessionListData>(
            r#"{
                "items": [{
                    "id": "sess_1",
                    "updated_at": "2026-06-28T09:00:00Z",
                    "status": "running",
                    "metadata": { "cwd": "D:/repo" }
                }],
                "has_more": false
            }"#,
        )
        .expect("session page");

        let sessions = data.into_sessions();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "sess_1");
        assert_eq!(sessions[0].work_dir.as_deref(), Some("D:/repo"));
        assert!(sessions[0].is_running);
        assert_eq!(
            sessions[0].last_updated.as_deref(),
            Some("2026-06-28T09:00:00Z")
        );
    }

    #[test]
    fn decode_api_v1_session_page_accepts_session_id_alias() {
        let data = serde_json::from_str::<SessionListData>(
            r#"[{
                "session_id": "legacy_1",
                "workDir": "D:/legacy",
                "is_running": true
            }]"#,
        )
        .expect("session list");

        let sessions = data.into_sessions();
        assert_eq!(sessions[0].session_id, "legacy_1");
        assert_eq!(sessions[0].work_dir.as_deref(), Some("D:/legacy"));
        assert!(sessions[0].is_running);
    }

    #[test]
    fn create_session_body_prefers_workspace_id_when_available() {
        let body = create_session_request_body(Path::new("D:/repo"), Some("wd_repo_0123456789ab"));
        assert_eq!(body, json!({ "workspace_id": "wd_repo_0123456789ab" }));
    }

    #[test]
    fn create_session_body_falls_back_to_metadata_cwd() {
        let body = create_session_request_body(Path::new("D:/repo"), None);
        assert_eq!(body, json!({ "metadata": { "cwd": "D:/repo" } }));
    }

    #[test]
    fn api_workspace_root_strips_windows_urlish_drive_prefix() {
        assert_eq!(
            api_workspace_root(Path::new("/?/D:/BaiduSyncdisk/Skill-workspace")),
            "D:/BaiduSyncdisk/Skill-workspace"
        );
        assert_eq!(api_workspace_root(Path::new("D:/repo")), "D:/repo");
    }

    #[test]
    fn create_session_body_strips_windows_urlish_metadata_cwd() {
        let body =
            create_session_request_body(Path::new("/?/D:/BaiduSyncdisk/Skill-workspace"), None);
        assert_eq!(
            body,
            json!({ "metadata": { "cwd": "D:/BaiduSyncdisk/Skill-workspace" } })
        );
    }

    #[test]
    fn normalize_path_strips_windows_urlish_drive_prefix() {
        assert_eq!(
            normalize_windows_urlish_path(Path::new("/?/D:/BaiduSyncdisk/Skill-workspace")),
            PathBuf::from("D:/BaiduSyncdisk/Skill-workspace")
        );
        assert_eq!(
            normalize_path(Path::new("/?/D:/__kimi_missing_workspace_path_for_test__")),
            PathBuf::from("D:/__kimi_missing_workspace_path_for_test__")
        );
        assert_eq!(
            normalize_windows_urlish_path(Path::new("D:/repo")),
            PathBuf::from("D:/repo")
        );
    }
}
