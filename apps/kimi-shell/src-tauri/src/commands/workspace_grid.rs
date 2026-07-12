use std::path::PathBuf;

use tauri::AppHandle;

use crate::workspace_session;

#[tauri::command]
pub(crate) fn grid_list_sessions(
    app: AppHandle,
) -> Result<Vec<workspace_session::WorkspaceSessionRecord>, String> {
    workspace_session::list_workspace_sessions_for_grid(&app)
}

#[tauri::command]
pub(crate) fn grid_get_session(
    app: AppHandle,
    session_id: String,
) -> Result<workspace_session::WorkspaceSessionRecord, String> {
    workspace_session::get_workspace_session_for_grid(&app, &session_id)
}

#[tauri::command]
pub(crate) fn grid_create_session(
    app: AppHandle,
    workspace_root: String,
) -> Result<workspace_session::WorkspaceSessionRecord, String> {
    let trimmed = workspace_root.trim();
    if trimmed.is_empty() {
        return Err("workspace root is required".to_string());
    }
    workspace_session::create_workspace_session_for_grid(&app, &PathBuf::from(trimmed))
}
