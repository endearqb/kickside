use std::{
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

use chrono::{DateTime, Utc};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    app_state::{unix_time_millis, AppState},
    log_manager,
    types::{BackendState, WorkspaceSessionBridgePayload},
};

const MAIN_WINDOW_LABEL: &str = "main";
const WORKSPACE_SESSION_BOOTSTRAP_EVENT: &str = "workspace-session-bootstrap";
const WORKSPACE_SESSION_BRIDGE_EVENT: &str = "workspace-session-bridge";
const WORKSPACE_SESSION_POLL_INTERVAL_MS: u64 = 1_200;

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
        let response = create_session_for_work_dir(workspace_port, &work_dir);
        let session = match response {
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

        if !is_generation_alive(&app, generation) {
            return;
        }

        let work_dir_value = session
            .work_dir
            .clone()
            .or_else(|| Some(work_dir.to_string_lossy().to_string()));
        let snapshot = SessionSnapshot {
            session_id: session.session_id.clone(),
            work_dir: work_dir_value.clone(),
        };
        apply_active_session_snapshot(&app, Some(snapshot), "bootstrap");

        let request_id = format!("ws-bootstrap-{}", unix_time_millis());
        let payload = WorkspaceSessionBridgePayload {
            action: "navigate_session".to_string(),
            source: source.clone(),
            request_id: Some(request_id),
            session_id: Some(session.session_id),
            work_dir: work_dir_value,
            route_template: None,
            applied: None,
            reason: None,
        };

        emit_workspace_session_event(&app, WORKSPACE_SESSION_BOOTSTRAP_EVENT, &payload);
        emit_workspace_session_event(&app, WORKSPACE_SESSION_BRIDGE_EVENT, &payload);

        log_manager::append_line(
            &app,
            format!(
                "workspace bootstrap session ready (source={source}, work_dir={})",
                work_dir.display()
            ),
        );
    });
}

fn fetch_active_session(workspace_port: u16) -> Result<Option<SessionSnapshot>, String> {
    let url = format!("http://127.0.0.1:{workspace_port}/api/sessions/?limit=100&offset=0");
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
    Ok(select_active_session(&sessions))
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
    if let Err(error) = app.emit_to(MAIN_WINDOW_LABEL, event_name, payload) {
        log_manager::append_line(app, format!("failed to emit `{event_name}`: {error}"));
    }
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
    Some(SessionSnapshot {
        session_id: selected.session_id.clone(),
        work_dir: selected.work_dir.clone(),
    })
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
}
