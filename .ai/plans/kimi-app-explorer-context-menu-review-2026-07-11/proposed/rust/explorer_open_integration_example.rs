//! Integration sketch for `open_request.rs` + `workspace_session.rs`.
//!
//! This file is intentionally isolated from the crate so the review package
//! does not pretend it was compiled against a local checkout. The functions
//! and types below map directly to existing kimi-app APIs at commit c2aaa14.

use std::{path::PathBuf, thread};
use tauri::AppHandle;

use crate::{
    log_manager,
    types::{WorkspaceSessionBridgePayload, WorkspaceSessionDisposition},
    window_manager, workspace_session,
};

/// Running-app path: create a session through the existing runtime API. Do not
/// mutate the global backend cwd and do not restart the backend.
pub fn open_workspace_in_new_pane(
    app: AppHandle,
    work_dir: PathBuf,
    source: String,
    request_id: String,
) {
    thread::spawn(move || {
        match workspace_session::create_workspace_session_for_grid(&app, &work_dir) {
            Ok(session) => {
                let payload = WorkspaceSessionBridgePayload {
                    action: "navigate_session".to_string(),
                    source: source.clone(),
                    request_id: Some(request_id),
                    session_id: Some(session.session_id),
                    work_dir: session.work_dir,
                    route_template: None,
                    disposition: Some(WorkspaceSessionDisposition::NewPane),
                    target_window_label: Some(window_manager::MAIN_WINDOW_LABEL.to_string()),
                    applied: None,
                    reason: None,
                };

                // Publish one canonical event. If compatibility requires both
                // legacy event names, the frontend must dedupe by request_id.
                window_manager::publish_workspace_session_navigation(
                    &app,
                    &payload,
                    "explorer_open",
                );
                window_manager::show_and_focus(&app);
            }
            Err(error) => {
                let message = format!(
                    "failed to create Explorer workspace session (source={source}, work_dir={}): {error:#}",
                    work_dir.display()
                );
                log_manager::append_line(&app, &message);
                window_manager::publish_open_request_error_message(
                    &app,
                    &source,
                    "create_workspace_session_for_grid",
                    &message,
                );
            }
        }
    });
}
