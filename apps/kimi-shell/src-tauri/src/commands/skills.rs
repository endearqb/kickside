use tauri::AppHandle;

use crate::{
    skill_center,
    types::{
        DiscoveredSkillDetail, InstalledSkill, SessionSkillState, SkillApplyResult,
        SkillApplyScope, SkillDetail, SkillDiscoveryContainerKind, SkillDiscoverySnapshot,
        SkillFileContent, SkillFileEntry, SkillProjectionRecord, SkillRecommendation,
        SkillUsageStats, WorkspaceDiscoveryRoot, WorkspaceSkillInventory, WorkspaceSkillProfile,
        WorkspaceSkillTarget,
    },
};

#[tauri::command]
pub(crate) fn install_skill_from_git(
    app: AppHandle,
    repo_url: String,
    git_ref: Option<String>,
) -> Result<InstalledSkill, String> {
    skill_center::install_skill_from_git(&app, &repo_url, git_ref.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn import_skill_from_path(
    app: AppHandle,
    path: String,
) -> Result<InstalledSkill, String> {
    skill_center::import_skill_from_path(&app, &path).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn scan_discoverable_skills(app: AppHandle) -> Result<SkillDiscoverySnapshot, String> {
    skill_center::scan_discoverable_skills(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_skill_discovery_workspaces(
    app: AppHandle,
) -> Result<Vec<WorkspaceDiscoveryRoot>, String> {
    skill_center::list_skill_discovery_workspaces(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_workspace_skill_targets(
    app: AppHandle,
) -> Result<Vec<WorkspaceSkillTarget>, String> {
    skill_center::list_workspace_skill_targets(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_workspace_skill_inventory(
    app: AppHandle,
    target_id: String,
) -> Result<WorkspaceSkillInventory, String> {
    skill_center::get_workspace_skill_inventory(&app, &target_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn add_installed_skill_to_workspace_target(
    app: AppHandle,
    target_id: String,
    container_kind: SkillDiscoveryContainerKind,
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
pub(crate) fn remove_workspace_target_skill(
    app: AppHandle,
    target_id: String,
    container_kind: SkillDiscoveryContainerKind,
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
pub(crate) fn get_discovered_skill_detail(
    app: AppHandle,
    discovery_id: String,
) -> Result<DiscoveredSkillDetail, String> {
    skill_center::get_discovered_skill_detail(&app, &discovery_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn import_discovered_skill(
    app: AppHandle,
    discovery_id: String,
) -> Result<InstalledSkill, String> {
    skill_center::import_discovered_skill(&app, &discovery_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_installed_skills(app: AppHandle) -> Result<Vec<InstalledSkill>, String> {
    skill_center::list_installed_skills(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_skill_detail(app: AppHandle, skill_id: String) -> Result<SkillDetail, String> {
    skill_center::get_skill_detail(&app, &skill_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_skill_file_entries(
    app: AppHandle,
    skill_id: String,
) -> Result<Vec<SkillFileEntry>, String> {
    skill_center::list_skill_file_entries(&app, &skill_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn read_skill_file(
    app: AppHandle,
    skill_id: String,
    rel_path: String,
) -> Result<SkillFileContent, String> {
    skill_center::read_skill_file(&app, &skill_id, &rel_path).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_skill_usage_stats(
    app: AppHandle,
    skill_ids: Option<Vec<String>>,
) -> Result<Vec<SkillUsageStats>, String> {
    skill_center::get_skill_usage_stats(&app, skill_ids).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_discovered_skill_file_entries(
    app: AppHandle,
    discovery_id: String,
) -> Result<Vec<SkillFileEntry>, String> {
    skill_center::list_discovered_skill_file_entries(&app, &discovery_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn read_discovered_skill_file(
    app: AppHandle,
    discovery_id: String,
    rel_path: String,
) -> Result<SkillFileContent, String> {
    skill_center::read_discovered_skill_file(&app, &discovery_id, &rel_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn set_skill_trust(
    app: AppHandle,
    skill_id: String,
    trusted: bool,
) -> Result<(), String> {
    skill_center::set_skill_trust(&app, &skill_id, trusted).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn apply_skill(
    app: AppHandle,
    skill_id: String,
    scope: SkillApplyScope,
) -> Result<SkillApplyResult, String> {
    skill_center::apply_skill(&app, &skill_id, scope).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn remove_skill(
    app: AppHandle,
    skill_id: String,
    scope: SkillApplyScope,
) -> Result<SkillApplyResult, String> {
    skill_center::remove_skill(&app, &skill_id, scope).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_active_session_skills(app: AppHandle) -> Result<SessionSkillState, String> {
    skill_center::list_active_session_skills(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_global_skills(app: AppHandle) -> Result<Vec<SkillProjectionRecord>, String> {
    skill_center::list_global_skills(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_workspace_recent_skills(
    app: AppHandle,
    workspace_key: Option<String>,
) -> Result<Vec<String>, String> {
    skill_center::list_workspace_recent_skills(&app, workspace_key.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_workspace_skill_profile(
    app: AppHandle,
    workspace_key: Option<String>,
) -> Result<Option<WorkspaceSkillProfile>, String> {
    skill_center::get_workspace_skill_profile(&app, workspace_key.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn set_workspace_skill_pin(
    app: AppHandle,
    skill_id: String,
    pinned: bool,
    workspace_key: Option<String>,
) -> Result<WorkspaceSkillProfile, String> {
    skill_center::set_workspace_skill_pin(&app, &skill_id, pinned, workspace_key.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_workspace_skill_recommendations(
    app: AppHandle,
    workspace_key: Option<String>,
) -> Result<Vec<SkillRecommendation>, String> {
    skill_center::get_workspace_skill_recommendations(&app, workspace_key.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn update_skill(app: AppHandle, skill_id: String) -> Result<InstalledSkill, String> {
    skill_center::update_skill(&app, &skill_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn uninstall_skill(app: AppHandle, skill_id: String) -> Result<(), String> {
    skill_center::uninstall_skill(&app, &skill_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn cleanup_session_skill_projections(
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    skill_center::cleanup_session_skill_projections(&app, &session_id)
        .map_err(|error| error.to_string())
}
