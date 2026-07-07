use tauri::AppHandle;

use crate::{
    types::{
        WorkspaceImportRequestPayload, WorkspaceImportResult, WorkspaceImportTarget,
        WorkspaceImportTargetInput,
    },
    workspace_import as workspace_import_manager,
};

#[tauri::command]
pub(crate) fn list_workspace_import_targets(
    app: AppHandle,
) -> Result<Vec<WorkspaceImportTarget>, String> {
    workspace_import_manager::list_workspace_import_targets(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_active_workspace_import_request() -> Option<WorkspaceImportRequestPayload> {
    workspace_import_manager::get_active_workspace_import_request()
}

#[tauri::command]
pub(crate) fn complete_workspace_import_request(
    app: AppHandle,
    request_id: String,
    input: WorkspaceImportTargetInput,
) -> Result<WorkspaceImportResult, String> {
    workspace_import_manager::complete_workspace_import_request(&app, &request_id, &input)
}

#[tauri::command]
pub(crate) fn cancel_workspace_import_request(
    app: AppHandle,
    request_id: String,
) -> Result<(), String> {
    workspace_import_manager::cancel_workspace_import_request(&app, &request_id)
}
