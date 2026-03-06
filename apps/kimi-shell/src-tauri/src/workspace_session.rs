use std::{
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

use chrono::{DateTime, Utc};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    app_state::{unix_time_millis, AppState},
    log_manager,
    types::{BackendState, WorkspaceSessionBridgePayload},
    window_manager,
};

const WORKSPACE_SESSION_BOOTSTRAP_EVENT: &str = "workspace-session-bootstrap";
const WORKSPACE_SESSION_BRIDGE_EVENT: &str = "workspace-session-bridge";
const WORKSPACE_SESSION_POLL_INTERVAL_MS: u64 = 1_200;
const SESSION_LIST_FETCH_LIMIT: usize = 500;
const BOOTSTRAP_ROUTE_TEMPLATE: &str = "/?session={{session_id}}";

#[derive(Debug, Clone, Deserialize)]
struct ApiSession {
    session_id: String,
    #[serde(default)]
    work_dir: Option<String>,
    #[serde(default)]
    is_running: bool,
    #[serde(default)]
    last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct CreateSessionRequest {
    work_dir: String,
    create_dir: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SessionSnapshot {
    session_id: String,
    work_dir: Option<String>,
}

pub fn queue_workspace_bootstrap(app: &AppHandle, work_dir: &Path, source: &str) {
    let normalized = normalize_path(work_dir);
    let state = app.state::<AppState>();
    let lock = state.runtime.lock();
    let Ok(mut runtime) = lock else {
        log_manager::append_line(
            app,
            format!(
                "failed to queue workspace bootstrap: runtime mutex poisoned (source={source})"
            ),
        );
        return;
    };

    runtime.pending_workspace_bootstrap = Some(normalized.clone());
    log_manager::append_line(
        app,
        format!(
            "queued workspace bootstrap (source={source}, work_dir={})",
            normalized.display()
        ),
    );
}

pub fn clear_active_session_runtime(app: &AppHandle, source: &str) {
    let state = app.state::<AppState>();
    let lock = state.runtime.lock();
    let Ok(mut runtime) = lock else {
        return;
    };

    runtime.active_session_id = None;
    runtime.active_session_work_dir = None;
    runtime.session_source = Some(format!("cleared:{source}"));
}

pub fn handle_backend_ready(app: &AppHandle, generation: u64, workspace_port: u16) {
    start_session_poller(app.clone(), generation, workspace_port);

    let bootstrap_target = {
        let state = app.state::<AppState>();
        let lock = state.runtime.lock();
        let Ok(mut runtime) = lock else {
            return;
        };

        runtime
            .pending_workspace_bootstrap
            .take()
            .or_else(|| runtime.effective_work_dir.clone())
    };

    if let Some(work_dir) = bootstrap_target {
        spawn_bootstrap_session(
            app.clone(),
            generation,
            workspace_port,
            work_dir,
            "backend_ready_bootstrap",
        );
    }
}

pub fn note_session_stream_activity(app: &AppHandle, session_id: &str, source: &str) {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return;
    }

    let (generation, workspace_port) = {
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
        (runtime.generation, runtime.workspace_port)
    };

    let Some(workspace_port) = workspace_port else {
        return;
    };

    let source = source.to_string();
    let session_id = session_id.to_string();
    let app = app.clone();
    thread::spawn(move || {
        if !should_poll(&app, generation) {
            return;
        }

        match fetch_session_by_id(workspace_port, &session_id) {
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

fn start_session_poller(app: AppHandle, generation: u64, workspace_port: u16) {
    thread::spawn(move || {
        let mut last_error: Option<String> = None;
        loop {
            if !should_poll(&app, generation) {
                return;
            }

            match fetch_active_session(workspace_port) {
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

fn spawn_bootstrap_session(
    app: AppHandle,
    generation: u64,
    workspace_port: u16,
    work_dir: PathBuf,
    source: &str,
) {
    let source = source.to_string();
    thread::spawn(move || {
        let existing_session = match fetch_sessions(workspace_port) {
            Ok(sessions) => select_latest_session_for_work_dir(&sessions, &work_dir),
            Err(error) => {
                log_manager::append_line(
                    &app,
                    format!(
                        "workspace bootstrap failed to list sessions; fallback to create (source={source}, work_dir={}): {error}",
                        work_dir.display()
                    ),
                );
                None
            }
        };

        let (session, snapshot_source) = if let Some(snapshot) = existing_session {
            log_manager::append_line(
                &app,
                format!(
                    "bootstrap_resume_existing source={source} work_dir={} session_id={}",
                    work_dir.display(),
                    snapshot.session_id
                ),
            );
            (snapshot, "bootstrap_resume_existing")
        } else {
            let response = create_session_for_work_dir(workspace_port, &work_dir);
            let created = match response {
                Ok(session) => session,
                Err(error) => {
                    log_manager::append_line(
                        &app,
                        format!(
                            "workspace bootstrap session creation failed (source={source}, work_dir={}): {error}",
                            work_dir.display()
                        ),
                    );
                    return;
                }
            };
            log_manager::append_line(
                &app,
                format!(
                    "bootstrap_create_new source={source} work_dir={} session_id={}",
                    work_dir.display(),
                    created.session_id
                ),
            );
            (session_snapshot_from_api(&created), "bootstrap_create_new")
        };

        if !is_generation_alive(&app, generation) {
            return;
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
        apply_active_session_snapshot(&app, Some(snapshot), snapshot_source);

        let request_id = format!("ws-bootstrap-{}", unix_time_millis());
        let payload = WorkspaceSessionBridgePayload {
            action: "navigate_session".to_string(),
            source: source.clone(),
            request_id: Some(request_id),
            session_id: Some(session_id.clone()),
            work_dir: work_dir_value,
            route_template: Some(BOOTSTRAP_ROUTE_TEMPLATE.to_string()),
            applied: None,
            reason: None,
        };

        emit_workspace_session_event(&app, WORKSPACE_SESSION_BOOTSTRAP_EVENT, &payload);
        emit_workspace_session_event(&app, WORKSPACE_SESSION_BRIDGE_EVENT, &payload);

        log_manager::append_line(
            &app,
            format!(
                "workspace bootstrap session ready (source={source}, work_dir={}, session_id={}, route_template={BOOTSTRAP_ROUTE_TEMPLATE})",
                work_dir.display(),
                session_id
            ),
        );
    });
}

fn fetch_active_session(workspace_port: u16) -> Result<Option<SessionSnapshot>, String> {
    let sessions = fetch_sessions(workspace_port)?;
    Ok(select_active_session(&sessions))
}

fn fetch_session_by_id(
    workspace_port: u16,
    session_id: &str,
) -> Result<Option<SessionSnapshot>, String> {
    let sessions = fetch_sessions(workspace_port)?;
    Ok(select_session_by_id(&sessions, session_id))
}

fn fetch_sessions(workspace_port: u16) -> Result<Vec<ApiSession>, String> {
    let url = format!(
        "http://127.0.0.1:{workspace_port}/api/sessions/?limit={SESSION_LIST_FETCH_LIMIT}&offset=0"
    );
    let client = Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|error| format!("failed to build session poll client: {error}"))?;

    let response = client
        .get(&url)
        .send()
        .map_err(|error| format!("GET `{url}` failed: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .unwrap_or_else(|_| "<failed to read body>".to_string());
        return Err(format!(
            "GET `{url}` returned {status}; body={}",
            truncate_for_log(&body, 220)
        ));
    }

    let sessions: Vec<ApiSession> = response
        .json()
        .map_err(|error| format!("failed to decode sessions response: {error}"))?;
    Ok(sessions)
}

fn create_session_for_work_dir(workspace_port: u16, work_dir: &Path) -> Result<ApiSession, String> {
    let url = format!("http://127.0.0.1:{workspace_port}/api/sessions/");
    let body = CreateSessionRequest {
        work_dir: work_dir.to_string_lossy().to_string(),
        create_dir: true,
    };

    let client = Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| format!("failed to build bootstrap session client: {error}"))?;
    let response = client
        .post(&url)
        .json(&body)
        .send()
        .map_err(|error| format!("POST `{url}` failed: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .unwrap_or_else(|_| "<failed to read body>".to_string());
        return Err(format!(
            "POST `{url}` returned {status}; body={}",
            truncate_for_log(&body, 220)
        ));
    }

    response
        .json::<ApiSession>()
        .map_err(|error| format!("failed to decode create session response: {error}"))
}

fn apply_active_session_snapshot(app: &AppHandle, snapshot: Option<SessionSnapshot>, source: &str) {
    let mut changed = false;
    {
        let state = app.state::<AppState>();
        let lock = state.runtime.lock();
        let Ok(mut runtime) = lock else {
            return;
        };

        let next_id = snapshot.as_ref().map(|item| item.session_id.clone());
        let next_work_dir = snapshot
            .as_ref()
            .and_then(|item| item.work_dir.as_ref())
            .map(PathBuf::from);

        if runtime.active_session_id != next_id || runtime.active_session_work_dir != next_work_dir
        {
            changed = true;
            runtime.active_session_id = next_id.clone();
            runtime.active_session_work_dir = next_work_dir.clone();
            runtime.session_source = Some(source.to_string());
        }
    }

    if !changed {
        return;
    }

    let payload = WorkspaceSessionBridgePayload {
        action: "active_session_updated".to_string(),
        source: source.to_string(),
        request_id: None,
        session_id: snapshot.as_ref().map(|item| item.session_id.clone()),
        work_dir: snapshot.and_then(|item| item.work_dir),
        route_template: None,
        applied: None,
        reason: None,
    };
    emit_workspace_session_event(app, WORKSPACE_SESSION_BRIDGE_EVENT, &payload);
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

fn select_session_by_id(sessions: &[ApiSession], session_id: &str) -> Option<SessionSnapshot> {
    let target = session_id.trim();
    if target.is_empty() {
        return None;
    }
    sessions
        .iter()
        .find(|item| item.session_id == target)
        .map(session_snapshot_from_api)
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
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
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

fn truncate_for_log(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let short: String = value.chars().take(max_chars).collect();
    format!("{short}...")
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
        }
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
    fn select_session_by_id_returns_matching_session_snapshot() {
        let sessions = vec![
            session("first", false, Some("2026-03-05T08:20:00Z"), Some("D:/a")),
            session("target", true, Some("2026-03-05T12:20:00Z"), Some("D:/b")),
        ];

        let selected = select_session_by_id(&sessions, "target").expect("must select target");
        assert_eq!(selected.session_id, "target");
        assert_eq!(selected.work_dir.as_deref(), Some("D:/b"));
    }

    #[test]
    fn select_session_by_id_returns_none_when_missing() {
        let sessions = vec![session(
            "only",
            false,
            Some("2026-03-05T08:20:00Z"),
            Some("D:/a"),
        )];

        assert!(select_session_by_id(&sessions, "missing").is_none());
        assert!(select_session_by_id(&sessions, " ").is_none());
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
}
