use std::{
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    bridge_manager, log_manager,
    types::{AgentRoomCommandError, AgentRoomEvent, AgentRoomEventPage},
    window_manager,
};

const EVENT_NAME: &str = "agent-room-events";
const STATUS_EVENT_NAME: &str = "agent-room-pump-status";
const EVENT_TARGETS: [&str; 2] = [
    window_manager::MAIN_WINDOW_LABEL,
    window_manager::AGENT_ROOM_WINDOW_LABEL,
];
const IDLE_GRACE: Duration = Duration::from_secs(30);
const BACKOFFS: [Duration; 5] = [
    Duration::from_millis(250),
    Duration::from_millis(500),
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(5),
];

#[derive(Default)]
pub struct AgentRoomEventPump {
    runtime: Mutex<PumpRuntime>,
}

#[derive(Default)]
struct PumpRuntime {
    generation: u64,
    cursor: i64,
    running: bool,
    pane_refs: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventBatch {
    generation: u64,
    items: Vec<AgentRoomEvent>,
    next_seq: i64,
    has_more: bool,
    server_time: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PumpStatus {
    state: &'static str,
    generation: u64,
    cursor: i64,
    retry_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_message: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct DeliverySummary {
    existing: usize,
    delivered: usize,
    failed: usize,
}

impl DeliverySummary {
    fn delivered_any(self) -> bool {
        self.delivered > 0
    }
}

pub fn ensure_started(app: &AppHandle) {
    let pump = app.state::<AgentRoomEventPump>();
    let (generation, cursor) = {
        let Ok(mut runtime) = pump.runtime.lock() else {
            return;
        };
        if runtime.running {
            return;
        }
        runtime.generation = runtime.generation.saturating_add(1);
        runtime.running = true;
        (runtime.generation, runtime.cursor)
    };
    let app = app.clone();
    thread::spawn(move || run_worker(app, generation, cursor));
}

pub fn set_pane_refs(app: &AppHandle, pane_refs: usize) {
    let pump = app.state::<AgentRoomEventPump>();
    if let Ok(mut runtime) = pump.runtime.lock() {
        runtime.pane_refs = pane_refs;
    }
    if pane_refs > 0 {
        ensure_started(app);
    }
}

pub fn stop(app: &AppHandle) {
    let pump = app.state::<AgentRoomEventPump>();
    if let Ok(mut runtime) = pump.runtime.lock() {
        runtime.generation = runtime.generation.saturating_add(1);
        runtime.running = false;
    };
}

fn run_worker(app: AppHandle, generation: u64, mut cursor: i64) {
    emit_status(&app, "connecting", generation, cursor, 0, None);
    let mut retry_count = 0usize;
    let mut idle_since = None;
    loop {
        if !is_current(&app, generation) {
            return;
        }
        let client = match bridge_manager::agent_room_client(&app) {
            Ok(client) => client,
            Err(error) => {
                if !handle_error(&app, generation, cursor, retry_count, &error) {
                    return;
                }
                wait_backoff(&app, generation, retry_count);
                retry_count = retry_count.saturating_add(1);
                continue;
            }
        };

        match client.agent_room_poll_events(cursor, None, 200, 25_000) {
            Ok(page) => {
                retry_count = 0;
                if !emit_page(&app, generation, &page) {
                    emit_status(
                        &app,
                        "degraded",
                        generation,
                        cursor,
                        0,
                        Some(("event_emit_failed", "Agent Room event delivery failed")),
                    );
                    wait_backoff(&app, generation, 0);
                    continue;
                }
                cursor = cursor_after_emit(cursor, page.next_seq, true);
                if !save_cursor(&app, generation, cursor) {
                    return;
                }
                emit_status(&app, "ready", generation, cursor, 0, None);
                if page.has_more {
                    idle_since = None;
                    continue;
                }
                let has_demand = current_pane_refs(&app) > 0
                    || window_manager::is_agent_room_window_visible(&app)
                    || client
                        .get_status()
                        .map(|status| status.agent_room.active_runs > 0)
                        .unwrap_or(true)
                    || client
                        .agent_room_list_observations()
                        .map(|page| !page.pinned_session_ids.is_empty())
                        .unwrap_or(true);
                if has_demand {
                    idle_since = None;
                } else {
                    let since = idle_since.get_or_insert_with(Instant::now);
                    if since.elapsed() >= IDLE_GRACE {
                        finish(&app, generation, cursor);
                        return;
                    }
                }
            }
            Err(error) => {
                if !handle_error(&app, generation, cursor, retry_count, &error) {
                    return;
                }
                wait_backoff(&app, generation, retry_count);
                retry_count = retry_count.saturating_add(1);
            }
        }
    }
}

fn emit_page(app: &AppHandle, generation: u64, page: &AgentRoomEventPage) -> bool {
    emit_agent_room_targets(
        app,
        EVENT_NAME,
        &EventBatch {
            generation,
            items: page.items.clone(),
            next_seq: page.next_seq,
            has_more: page.has_more,
            server_time: page.server_time.clone(),
        },
    )
    .delivered_any()
}

fn handle_error(
    app: &AppHandle,
    generation: u64,
    cursor: i64,
    retry_count: usize,
    error: &AgentRoomCommandError,
) -> bool {
    let resync = error.code == "cursor_too_old";
    emit_status(
        app,
        if resync {
            "resync_required"
        } else {
            "degraded"
        },
        generation,
        cursor,
        retry_count.saturating_add(1),
        Some((&error.code, &error.message)),
    );
    if resync {
        mark_not_running(app, generation);
    }
    !resync && is_current(app, generation)
}

fn emit_status(
    app: &AppHandle,
    state: &'static str,
    generation: u64,
    cursor: i64,
    retry_count: usize,
    error: Option<(&str, &str)>,
) {
    emit_agent_room_targets(
        app,
        STATUS_EVENT_NAME,
        &PumpStatus {
            state,
            generation,
            cursor,
            retry_count,
            error_code: error.map(|(code, _)| code.to_string()),
            error_message: error.map(|(_, message)| message.to_string()),
        },
    );
}

fn emit_agent_room_targets<T: Clone + Serialize>(
    app: &AppHandle,
    event: &str,
    payload: &T,
) -> DeliverySummary {
    let mut summary = DeliverySummary::default();
    for label in EVENT_TARGETS {
        if app.get_webview_window(label).is_none() {
            continue;
        }
        summary.existing += 1;
        match app.emit_to(label, event, payload.clone()) {
            Ok(()) => summary.delivered += 1,
            Err(error) => {
                summary.failed += 1;
                log_manager::append_line(
                    app,
                    format!("failed to emit {event} to {label}: {error}"),
                );
            }
        }
    }
    summary
}

fn wait_backoff(app: &AppHandle, generation: u64, retry_count: usize) {
    let duration = BACKOFFS[retry_count.min(BACKOFFS.len() - 1)];
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        if !is_current(app, generation) {
            return;
        }
        thread::sleep(
            Duration::from_millis(50).min(deadline.saturating_duration_since(Instant::now())),
        );
    }
}

fn current_pane_refs(app: &AppHandle) -> usize {
    app.state::<AgentRoomEventPump>()
        .runtime
        .lock()
        .map(|runtime| runtime.pane_refs)
        .unwrap_or_default()
}

fn is_current(app: &AppHandle, generation: u64) -> bool {
    app.state::<AgentRoomEventPump>()
        .runtime
        .lock()
        .map(|runtime| runtime.running && runtime.generation == generation)
        .unwrap_or(false)
}

fn save_cursor(app: &AppHandle, generation: u64, cursor: i64) -> bool {
    let pump = app.state::<AgentRoomEventPump>();
    let Ok(mut runtime) = pump.runtime.lock() else {
        return false;
    };
    if !runtime.running || runtime.generation != generation {
        return false;
    }
    runtime.cursor = runtime.cursor.max(cursor);
    true
}

fn cursor_after_emit(current: i64, next: i64, emitted: bool) -> i64 {
    if emitted {
        current.max(next)
    } else {
        current
    }
}

fn finish(app: &AppHandle, generation: u64, cursor: i64) {
    mark_not_running(app, generation);
    emit_status(app, "idle", generation, cursor, 0, None);
}

fn mark_not_running(app: &AppHandle, generation: u64) {
    let pump = app.state::<AgentRoomEventPump>();
    if let Ok(mut runtime) = pump.runtime.lock() {
        if runtime.generation == generation {
            runtime.running = false;
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_backoff_is_bounded() {
        assert_eq!(BACKOFFS[0], Duration::from_millis(250));
        assert_eq!(BACKOFFS[BACKOFFS.len() - 1], Duration::from_secs(5));
    }

    #[test]
    fn event_and_status_names_are_stable() {
        assert_eq!(EVENT_NAME, "agent-room-events");
        assert_eq!(STATUS_EVENT_NAME, "agent-room-pump-status");
        assert_eq!(EVENT_TARGETS, ["main", "agent-room"]);
    }

    #[test]
    fn cursor_advances_only_after_successful_emit_and_never_regresses() {
        assert_eq!(cursor_after_emit(7, 9, true), 9);
        assert_eq!(cursor_after_emit(9, 7, true), 9);
        assert_eq!(cursor_after_emit(7, 9, false), 7);
    }

    #[test]
    fn partial_delivery_advances_but_missing_or_failed_targets_do_not() {
        assert!(DeliverySummary {
            existing: 2,
            delivered: 1,
            failed: 1,
        }
        .delivered_any());
        assert!(!DeliverySummary::default().delivered_any());
        assert!(!DeliverySummary {
            existing: 2,
            delivered: 0,
            failed: 2,
        }
        .delivered_any());
    }
}
