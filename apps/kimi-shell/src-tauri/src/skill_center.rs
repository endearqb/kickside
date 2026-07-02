use std::collections::HashSet;
use std::env;
use std::fs;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::Context;
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

use crate::{
    app_state::AppState,
    log_manager, skill_center_store, skill_projection, token_resolver,
    types::{
        BackendState, DiscoveredSkillDetail, DiscoveredSkillRecord, InstalledSkill,
        SessionSkillState, SkillApplyResult, SkillApplyScope, SkillDetail,
        SkillDiscoveryContainerKind, SkillDiscoveryLocation, SkillDiscoveryScope,
        SkillDiscoverySnapshot, SkillManifestMetadata, SkillProjectionMethod,
        SkillProjectionRecord, SkillRecommendation, SkillSourceType, SkillUpdateStatusKind,
        SkillUpdateStatusView, WorkspaceDiscoveryRoot, WorkspaceManagedSkillRecord,
        WorkspaceSkillContainerInventory, WorkspaceSkillInventory, WorkspaceSkillProfile,
        WorkspaceSkillTarget, WorkspaceSkillTargetContainerRoot,
    },
};

const BUNDLED_SKILLS_DIR_NAME: &str = "skills";
const LEGACY_BUNDLED_SKILLS_DIR_SEGMENTS: [&str; 4] = ["_up_", "_up_", "_up_", "skills"];
const DEV_WORKSPACE_FALLBACK_ENV: &str = "KIMI_DEV_ALLOW_WORKSPACE_FALLBACK";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExistingSkillAction {
    Error,
    RefreshBundled,
}

#[derive(Debug, Clone)]
struct InstallSourceMetadata {
    source_type: SkillSourceType,
    source_label: String,
    source_key: String,
    source_path: Option<String>,
    repo_url: Option<String>,
    git_ref: Option<String>,
    commit: Option<String>,
    default_trusted: bool,
    discovery_locations: Vec<SkillDiscoveryLocation>,
}

pub fn initialize(app: &AppHandle) -> anyhow::Result<()> {
    skill_center_store::ensure_layout(app)?;
    sync_bundled_skills(app)?;
    cleanup_stale_session_projections(app)
}

pub fn install_skill_from_git(
    app: &AppHandle,
    repo_url: &str,
    git_ref: Option<&str>,
) -> anyhow::Result<InstalledSkill> {
    skill_center_store::ensure_layout(app)?;
    let repo_url = repo_url.trim();
    if repo_url.is_empty() {
        return Err(anyhow::anyhow!("repo url cannot be empty"));
    }

    let temp_dir = skill_center_store::create_temp_install_dir(app)?;
    let git_ref = git_ref.map(str::trim).filter(|value| !value.is_empty());

    let clone_result = (|| -> anyhow::Result<InstalledSkill> {
        run_git(
            &["clone", "--quiet", repo_url, &temp_dir.to_string_lossy()],
            None,
        )?;
        if let Some(value) = git_ref {
            run_git(&["checkout", "--quiet", "--detach", value], Some(&temp_dir))?;
        }

        let commit = run_git_capture(&["rev-parse", "HEAD"], Some(&temp_dir))?;
        let commit = commit.trim().to_string();
        let metadata = InstallSourceMetadata {
            source_type: SkillSourceType::Git,
            source_label: repo_url.to_string(),
            source_key: skill_center_store::build_git_source_key(repo_url, git_ref, &commit),
            source_path: None,
            repo_url: Some(repo_url.to_string()),
            git_ref: git_ref.map(str::to_string),
            commit: Some(commit),
            default_trusted: false,
            discovery_locations: Vec::new(),
        };
        install_skill_from_source(app, &temp_dir, metadata, ExistingSkillAction::Error)
    })();

    skill_center_store::remove_temp_install_dir(&temp_dir);
    clone_result
}

pub fn import_skill_from_path(app: &AppHandle, path: &str) -> anyhow::Result<InstalledSkill> {
    skill_center_store::ensure_layout(app)?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(anyhow::anyhow!("import path cannot be empty"));
    }
    let selected_path = PathBuf::from(trimmed);
    if !selected_path.exists() {
        return Err(anyhow::anyhow!(
            "import path does not exist: {}",
            selected_path.display()
        ));
    }

    let canonical = skill_center_store::canonicalize_source_path(&selected_path)?;
    let temp_dir = skill_center_store::create_temp_install_dir(app)?;
    let import_result = (|| -> anyhow::Result<InstalledSkill> {
        let (skill_root, source_key) = if canonical.is_dir() {
            (
                canonical.clone(),
                skill_center_store::build_local_source_key(&canonical, false)?,
            )
        } else if skill_center_store::is_zip_path(&canonical) && canonical.is_file() {
            extract_zip_archive(&canonical, &temp_dir)?;
            (
                skill_center_store::resolve_skill_root_from_extracted_dir(&temp_dir)?,
                skill_center_store::build_local_source_key(&canonical, true)?,
            )
        } else {
            return Err(anyhow::anyhow!(
                "manual import supports only directories and .zip files: {}",
                canonical.display()
            ));
        };

        let metadata = InstallSourceMetadata {
            source_type: SkillSourceType::LocalImport,
            source_label: canonical.to_string_lossy().to_string(),
            source_key,
            source_path: Some(canonical.to_string_lossy().to_string()),
            repo_url: None,
            git_ref: None,
            commit: None,
            default_trusted: false,
            discovery_locations: Vec::new(),
        };
        install_skill_from_source(app, &skill_root, metadata, ExistingSkillAction::Error)
    })();

    skill_center_store::remove_temp_install_dir(&temp_dir);
    import_result
}

pub fn list_installed_skills(app: &AppHandle) -> anyhow::Result<Vec<InstalledSkill>> {
    let mut skills = skill_center_store::load_registry(app)?;
    skills.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(skills)
}

pub fn get_skill_detail(app: &AppHandle, skill_id: &str) -> anyhow::Result<SkillDetail> {
    let registry = skill_center_store::load_registry(app)?;
    let skill = skill_center_store::find_skill(&registry, skill_id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("skill not found: {}", skill_id.trim()))?;
    let relative_paths = skill_center_store::list_relative_paths(Path::new(&skill.local_path), 256)
        .unwrap_or_default();
    let global_applied = load_global_projection_for_skill(app, &skill.id)?.is_some();
    let session_applied = current_active_session_state(app)?
        .projections
        .iter()
        .any(|projection| projection.skill_id == skill.id);

    Ok(SkillDetail {
        skill,
        relative_paths,
        user_global_applied: global_applied,
        current_session_applied: session_applied,
    })
}

pub fn set_skill_trust(app: &AppHandle, skill_id: &str, trusted: bool) -> anyhow::Result<()> {
    let mut registry = skill_center_store::load_registry(app)?;
    let skill = skill_center_store::find_skill_mut(&mut registry, skill_id)
        .ok_or_else(|| anyhow::anyhow!("skill not found: {}", skill_id.trim()))?;
    if skill.trusted == trusted {
        return Ok(());
    }
    skill.trusted = trusted;
    skill.updated_at = skill_center_store::now_timestamp();
    skill_center_store::save_registry(app, &registry)?;

    if !trusted {
        remove_skill_from_global_state(app, skill_id, None)?;
        for session_state in skill_center_store::load_all_session_states(app)? {
            if let Some(session_id) = session_state.session_id.as_deref() {
                remove_skill_from_session_state(app, session_id, skill_id)?;
            }
        }
    }
    Ok(())
}

pub fn apply_skill(
    app: &AppHandle,
    skill_id: &str,
    scope: SkillApplyScope,
) -> anyhow::Result<SkillApplyResult> {
    let registry = skill_center_store::load_registry(app)?;
    let skill = skill_center_store::find_skill(&registry, skill_id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("skill not found: {}", skill_id.trim()))?;
    if !skill.trusted {
        return Err(anyhow::anyhow!("skill must be trusted before applying"));
    }

    match scope {
        SkillApplyScope::UserGlobalKimi => apply_skill_to_user_global(app, &skill)?,
        SkillApplyScope::KimiCodeHome => apply_skill_to_kimi_code_home(app, &skill)?,
        SkillApplyScope::SessionKimi => apply_skill_to_active_session(app, &skill)?,
    }

    record_recent_skill(
        app,
        &skill.id,
        matches!(scope, SkillApplyScope::SessionKimi),
    )?;
    build_apply_result(app, scope)
}

pub fn remove_skill(
    app: &AppHandle,
    skill_id: &str,
    scope: SkillApplyScope,
) -> anyhow::Result<SkillApplyResult> {
    match scope {
        SkillApplyScope::UserGlobalKimi => {
            remove_skill_from_global_state(app, skill_id, Some(SkillApplyScope::UserGlobalKimi))?
        }
        SkillApplyScope::KimiCodeHome => {
            remove_skill_from_global_state(app, skill_id, Some(SkillApplyScope::KimiCodeHome))?
        }
        SkillApplyScope::SessionKimi => {
            let session_id = active_session_id(app)?
                .ok_or_else(|| anyhow::anyhow!("no active session available"))?;
            remove_skill_from_session_state(app, &session_id, skill_id)?;
        }
    }
    build_apply_result(app, scope)
}

pub fn list_global_skills(app: &AppHandle) -> anyhow::Result<Vec<SkillProjectionRecord>> {
    let mut projections = skill_center_store::load_global_projections(app)?;
    projections.sort_by(|left, right| right.applied_at.cmp(&left.applied_at));
    Ok(projections)
}

pub fn list_active_session_skills(app: &AppHandle) -> anyhow::Result<SessionSkillState> {
    current_active_session_state(app)
}

pub fn list_workspace_recent_skills(
    app: &AppHandle,
    workspace_key: Option<&str>,
) -> anyhow::Result<Vec<String>> {
    let key = workspace_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(skill_center_store::normalize_workspace_key)
        .or_else(|| {
            effective_work_dir(app).map(|path| skill_center_store::normalize_workspace_key(&path))
        });
    let Some(key) = key else {
        return Ok(Vec::new());
    };
    let profiles = skill_center_store::load_workspace_profiles(app)?;
    Ok(profiles
        .into_iter()
        .find(|profile| profile.workspace_id == key)
        .map(|profile| profile.recent_skill_ids)
        .unwrap_or_default())
}

pub fn get_workspace_skill_profile(
    app: &AppHandle,
    workspace_key: Option<&str>,
) -> anyhow::Result<Option<WorkspaceSkillProfile>> {
    let key = resolve_workspace_key(app, workspace_key);
    let Some(key) = key else {
        return Ok(None);
    };
    Ok(resolve_workspace_skill_profile(
        skill_center_store::load_workspace_profiles(app)?,
        &key,
    ))
}

pub fn set_workspace_skill_pin(
    app: &AppHandle,
    skill_id: &str,
    pinned: bool,
    workspace_key: Option<&str>,
) -> anyhow::Result<WorkspaceSkillProfile> {
    let skill_id = skill_id.trim();
    if skill_id.is_empty() {
        return Err(anyhow::anyhow!("skill id cannot be empty"));
    }
    let registry = skill_center_store::load_registry(app)?;
    if skill_center_store::find_skill(&registry, skill_id).is_none() {
        return Err(anyhow::anyhow!("skill not found: {}", skill_id));
    }

    let workspace_id = resolve_workspace_key(app, workspace_key)
        .ok_or_else(|| anyhow::anyhow!("workspace unavailable"))?;
    let mut profiles = skill_center_store::load_workspace_profiles(app)?;
    let mut updated_profile = None;

    for profile in &mut profiles {
        if profile.workspace_id != workspace_id {
            continue;
        }
        if pinned {
            let mut next = vec![skill_id.to_string()];
            next.extend(profile.pinned_skill_ids.clone());
            profile.pinned_skill_ids = skill_center_store::dedupe_recent_skill_ids(&next);
        } else {
            profile.pinned_skill_ids.retain(|value| value != skill_id);
        }
        updated_profile = Some(profile.clone());
        break;
    }

    if updated_profile.is_none() {
        let profile = WorkspaceSkillProfile {
            workspace_id,
            recent_skill_ids: Vec::new(),
            pinned_skill_ids: if pinned {
                vec![skill_id.to_string()]
            } else {
                Vec::new()
            },
            last_session_skill_ids: Vec::new(),
        };
        profiles.push(profile.clone());
        updated_profile = Some(profile);
    }

    skill_center_store::save_workspace_profiles(app, &profiles)?;
    updated_profile.ok_or_else(|| anyhow::anyhow!("failed to update workspace skill profile"))
}

pub fn get_workspace_skill_recommendations(
    app: &AppHandle,
    workspace_key: Option<&str>,
) -> anyhow::Result<Vec<SkillRecommendation>> {
    let Some(workspace_id) = resolve_workspace_key(app, workspace_key) else {
        return Ok(Vec::new());
    };

    let profile = resolve_workspace_skill_profile(
        skill_center_store::load_workspace_profiles(app)?,
        &workspace_id,
    )
    .unwrap_or(WorkspaceSkillProfile {
        workspace_id,
        recent_skill_ids: Vec::new(),
        pinned_skill_ids: Vec::new(),
        last_session_skill_ids: Vec::new(),
    });
    let globally_applied = skill_center_store::load_global_projections(app)?
        .into_iter()
        .map(|projection| projection.skill_id)
        .collect::<HashSet<_>>();
    let session_applied = current_active_session_state(app)?
        .applied_skill_ids
        .into_iter()
        .collect::<HashSet<_>>();

    let mut recommendations = Vec::new();
    for skill in skill_center_store::load_registry(app)? {
        if !skill.trusted
            || globally_applied.contains(&skill.id)
            || session_applied.contains(&skill.id)
        {
            continue;
        }

        let mut score = 0;
        let mut reasons = Vec::new();
        let mut matched_signals = Vec::new();

        if profile
            .pinned_skill_ids
            .iter()
            .any(|value| value == &skill.id)
        {
            score += 120;
            reasons.push("已固定到当前工作区".to_string());
            matched_signals.push("pinned".to_string());
        }
        if profile
            .last_session_skill_ids
            .iter()
            .any(|value| value == &skill.id)
        {
            score += 80;
            reasons.push("最近在此工作区会话中使用过".to_string());
            matched_signals.push("last_session".to_string());
        }
        if profile
            .recent_skill_ids
            .iter()
            .any(|value| value == &skill.id)
        {
            score += 40;
            reasons.push("最近在此工作区使用过".to_string());
            matched_signals.push("recent".to_string());
        }
        if score <= 0 {
            continue;
        }

        let recommended_scope = default_recommended_scope(&skill);
        recommendations.push(SkillRecommendation {
            skill_id: skill.id,
            score,
            reasons,
            matched_signals,
            recommended_scope,
        });
    }

    recommendations.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.skill_id.cmp(&right.skill_id))
    });
    Ok(recommendations)
}

pub fn update_skill(app: &AppHandle, skill_id: &str) -> anyhow::Result<InstalledSkill> {
    let skill_id = skill_id.trim();
    if skill_id.is_empty() {
        return Err(anyhow::anyhow!("skill id cannot be empty"));
    }

    let registry = skill_center_store::load_registry(app)?;
    let existing = skill_center_store::find_skill(&registry, skill_id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("skill not found: {}", skill_id))?;
    let temp_dir = skill_center_store::create_temp_install_dir(app)?;

    let refresh_result = (|| -> anyhow::Result<InstalledSkill> {
        let (source_root, metadata) = match existing.source_type {
            SkillSourceType::Git => {
                let repo_url = existing
                    .repo_url
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("git skill missing repo url"))?;
                run_git(
                    &["clone", "--quiet", repo_url, &temp_dir.to_string_lossy()],
                    None,
                )?;
                if let Some(git_ref) = existing.git_ref.as_deref() {
                    let git_ref = git_ref.trim();
                    if !git_ref.is_empty() {
                        run_git(
                            &["checkout", "--quiet", "--detach", git_ref],
                            Some(&temp_dir),
                        )?;
                    }
                }
                let commit = run_git_capture(&["rev-parse", "HEAD"], Some(&temp_dir))?;
                (
                    temp_dir.clone(),
                    InstallSourceMetadata {
                        source_type: SkillSourceType::Git,
                        source_label: repo_url.to_string(),
                        source_key: skill_center_store::build_git_source_key(
                            repo_url,
                            existing.git_ref.as_deref(),
                            &commit,
                        ),
                        source_path: None,
                        repo_url: Some(repo_url.to_string()),
                        git_ref: existing.git_ref.clone(),
                        commit: Some(commit),
                        default_trusted: existing.trusted,
                        discovery_locations: existing.discovery_locations.clone(),
                    },
                )
            }
            SkillSourceType::LocalImport => {
                let source_path = existing
                    .source_path
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("local skill missing source path"))?;
                let canonical =
                    skill_center_store::canonicalize_source_path(Path::new(source_path))?;
                if canonical.is_dir() {
                    (
                        canonical.clone(),
                        InstallSourceMetadata {
                            source_type: SkillSourceType::LocalImport,
                            source_label: canonical.to_string_lossy().to_string(),
                            source_key: skill_center_store::build_local_source_key(
                                &canonical, false,
                            )?,
                            source_path: Some(canonical.to_string_lossy().to_string()),
                            repo_url: None,
                            git_ref: None,
                            commit: None,
                            default_trusted: existing.trusted,
                            discovery_locations: existing.discovery_locations.clone(),
                        },
                    )
                } else if canonical.is_file() && skill_center_store::is_zip_path(&canonical) {
                    extract_zip_archive(&canonical, &temp_dir)?;
                    (
                        skill_center_store::resolve_skill_root_from_extracted_dir(&temp_dir)?,
                        InstallSourceMetadata {
                            source_type: SkillSourceType::LocalImport,
                            source_label: canonical.to_string_lossy().to_string(),
                            source_key: skill_center_store::build_local_source_key(
                                &canonical, true,
                            )?,
                            source_path: Some(canonical.to_string_lossy().to_string()),
                            repo_url: None,
                            git_ref: None,
                            commit: None,
                            default_trusted: existing.trusted,
                            discovery_locations: existing.discovery_locations.clone(),
                        },
                    )
                } else {
                    return Err(anyhow::anyhow!(
                        "manual import supports only directories and .zip files: {}",
                        canonical.display()
                    ));
                }
            }
            SkillSourceType::Bundled => {
                let relative_path = existing
                    .source_path
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("bundled skill missing source path"))?;
                (
                    resolve_bundled_skill_source(app, relative_path)?,
                    InstallSourceMetadata {
                        source_type: SkillSourceType::Bundled,
                        source_label: "内置 Skill".to_string(),
                        source_key: skill_center_store::build_bundled_source_key(relative_path),
                        source_path: Some(relative_path.to_string()),
                        repo_url: None,
                        git_ref: None,
                        commit: None,
                        default_trusted: existing.trusted,
                        discovery_locations: existing.discovery_locations.clone(),
                    },
                )
            }
            SkillSourceType::DiscoveredImport => {
                let source_path = existing
                    .source_path
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("discovered skill missing source path"))?;
                let canonical =
                    match skill_center_store::canonicalize_source_path(Path::new(source_path)) {
                        Ok(path) => path,
                        Err(_) => {
                            return mark_skill_source_missing(
                                app,
                                skill_id,
                                format!("外部来源不可用：{}", source_path),
                            );
                        }
                    };
                if !canonical.join("SKILL.md").is_file() {
                    return mark_skill_source_missing(
                        app,
                        skill_id,
                        format!("外部来源缺少 SKILL.md：{}", canonical.display()),
                    );
                }
                (
                    canonical.clone(),
                    InstallSourceMetadata {
                        source_type: SkillSourceType::DiscoveredImport,
                        source_label: canonical.to_string_lossy().to_string(),
                        source_key: skill_center_store::build_discovered_source_key(&canonical)?,
                        source_path: Some(canonical.to_string_lossy().to_string()),
                        repo_url: None,
                        git_ref: None,
                        commit: None,
                        default_trusted: existing.trusted,
                        discovery_locations: existing.discovery_locations.clone(),
                    },
                )
            }
        };

        refresh_installed_skill_from_source(app, skill_id, &source_root, &metadata)
    })();

    skill_center_store::remove_temp_install_dir(&temp_dir);
    refresh_result
}

pub fn uninstall_skill(app: &AppHandle, skill_id: &str) -> anyhow::Result<()> {
    let skill_id = skill_id.trim();
    if skill_id.is_empty() {
        return Err(anyhow::anyhow!("skill id cannot be empty"));
    }

    let mut registry = skill_center_store::load_registry(app)?;
    let existing = skill_center_store::find_skill(&registry, skill_id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("skill not found: {}", skill_id))?;
    if existing.source_type == SkillSourceType::Bundled {
        return Err(anyhow::anyhow!("bundled skills cannot be uninstalled"));
    }

    remove_skill_from_global_state(app, skill_id, None)?;
    for session_state in skill_center_store::load_all_session_states(app)? {
        if let Some(session_id) = session_state.session_id.as_deref() {
            remove_skill_from_session_state(app, session_id, skill_id)?;
        }
    }

    registry.retain(|skill| skill.id != skill_id);
    skill_center_store::save_registry(app, &registry)?;

    let local_path = PathBuf::from(&existing.local_path);
    if local_path.exists() {
        fs::remove_dir_all(&local_path).with_context(|| {
            format!(
                "failed to remove installed skill directory: {}",
                local_path.display()
            )
        })?;
    }

    let mut profiles = skill_center_store::load_workspace_profiles(app)?;
    for profile in &mut profiles {
        profile.recent_skill_ids.retain(|value| value != skill_id);
        profile.pinned_skill_ids.retain(|value| value != skill_id);
        profile
            .last_session_skill_ids
            .retain(|value| value != skill_id);
    }
    skill_center_store::save_workspace_profiles(app, &profiles)
}

pub fn cleanup_session_skill_projections(app: &AppHandle, session_id: &str) -> anyhow::Result<()> {
    let Some(state) = skill_center_store::load_session_state(app, session_id)? else {
        return Ok(());
    };
    for projection in &state.projections {
        skill_projection::remove_projection_target(Path::new(&projection.target_path))?;
    }
    skill_center_store::delete_session_state(app, session_id)?;
    Ok(())
}

pub fn cleanup_stale_session_projections(app: &AppHandle) -> anyhow::Result<()> {
    let active = active_session_id(app)?;
    for session_state in skill_center_store::load_all_session_states(app)? {
        let Some(session_id) = session_state.session_id.as_deref() else {
            continue;
        };
        if active.as_deref() == Some(session_id) {
            continue;
        }
        if let Err(error) = cleanup_session_skill_projections(app, session_id) {
            log_manager::append_line(
                app,
                format!(
                    "skill center stale session cleanup failed (session_id={}): {error:#}",
                    session_id
                ),
            );
        }
    }
    Ok(())
}

pub fn track_workspace_root(app: &AppHandle, path: &Path) -> anyhow::Result<()> {
    if !path.is_dir() {
        return Ok(());
    }
    let canonical = match skill_center_store::canonicalize_source_path(path) {
        Ok(value) => value,
        Err(_) => return Ok(()),
    };
    let canonical_display = skill_center_store::path_to_display_string(&canonical);
    let workspace_id = skill_center_store::normalize_workspace_key(&canonical_display);
    let mut workspaces = skill_center_store::load_workspace_index(app)?;
    let mut found = false;
    for workspace in &mut workspaces {
        if workspace.id != workspace_id {
            continue;
        }
        workspace.path = canonical_display.clone();
        workspace.label = canonical_display.clone();
        workspace.last_seen_at = skill_center_store::now_timestamp();
        found = true;
        break;
    }
    if !found {
        workspaces.push(WorkspaceDiscoveryRoot {
            id: workspace_id,
            scope: SkillDiscoveryScope::Workspace,
            path: canonical_display.clone(),
            label: canonical_display,
            last_seen_at: skill_center_store::now_timestamp(),
        });
    }
    workspaces.sort_by(|left, right| left.path.cmp(&right.path));
    skill_center_store::save_workspace_index(app, &workspaces)
}

pub fn list_skill_discovery_workspaces(
    app: &AppHandle,
) -> anyhow::Result<Vec<WorkspaceDiscoveryRoot>> {
    discovery_roots(app)
}

pub fn list_workspace_skill_targets(app: &AppHandle) -> anyhow::Result<Vec<WorkspaceSkillTarget>> {
    let current_workspace_path = active_session_work_dir(app)?.or_else(|| effective_work_dir(app));
    if let Some(path) = current_workspace_path.as_deref() {
        let _ = track_workspace_root(app, Path::new(path));
    }

    let mut targets = Vec::new();
    let current_workspace_key = current_workspace_path
        .as_deref()
        .map(skill_center_store::normalize_workspace_key);

    if let Some(path) = current_workspace_path {
        let root_path = match skill_center_store::canonicalize_source_path(Path::new(&path)) {
            Ok(value) => value,
            Err(_) => PathBuf::from(&path),
        };
        targets.push(build_workspace_skill_target(
            "current_workspace".to_string(),
            SkillDiscoveryScope::Workspace,
            "当前工作区".to_string(),
            &root_path,
            false,
            true,
        ));
    }

    for root in discovery_roots(app)? {
        if root.scope != SkillDiscoveryScope::Workspace {
            continue;
        }
        if current_workspace_key.as_deref() == Some(&root.id) {
            continue;
        }
        let root_path = PathBuf::from(&root.path);
        targets.push(build_workspace_skill_target(
            format!("workspace:{}", root.id),
            SkillDiscoveryScope::Workspace,
            display_workspace_label(&root_path, &root.label),
            &root_path,
            false,
            false,
        ));
    }

    let home_dir = skill_center_store::user_home_dir()?;
    targets.push(build_workspace_skill_target(
        "user_home".to_string(),
        SkillDiscoveryScope::UserHome,
        "主目录".to_string(),
        &home_dir,
        true,
        false,
    ));

    Ok(targets)
}

pub fn get_workspace_skill_inventory(
    app: &AppHandle,
    target_id: &str,
) -> anyhow::Result<WorkspaceSkillInventory> {
    let target = resolve_workspace_skill_target(app, target_id)?;
    let registry = skill_center_store::load_registry(app)?;
    let containers = target
        .container_roots
        .iter()
        .map(|container_root| {
            build_workspace_skill_container_inventory(
                app,
                &registry,
                &target,
                container_root.container_kind,
                Path::new(&container_root.container_path),
            )
        })
        .collect::<anyhow::Result<Vec<_>>>()?;

    Ok(WorkspaceSkillInventory {
        target,
        scanned_at: skill_center_store::now_timestamp(),
        containers,
    })
}

pub fn add_installed_skill_to_workspace_target(
    app: &AppHandle,
    target_id: &str,
    container_kind: SkillDiscoveryContainerKind,
    skill_id: &str,
) -> anyhow::Result<WorkspaceSkillInventory> {
    let target = resolve_workspace_skill_target(app, target_id)?;
    if target.read_only {
        return Err(anyhow::anyhow!("当前目标为只读，不能导入 Skill"));
    }

    let registry = skill_center_store::load_registry(app)?;
    let skill = skill_center_store::find_skill(&registry, skill_id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("skill not found: {}", skill_id.trim()))?;
    if !skill.trusted {
        return Err(anyhow::anyhow!("skill must be trusted before applying"));
    }
    let container_root = resolve_workspace_target_container_path(&target, container_kind)?;
    let target_path = container_root.join(&skill.projection_name);
    if target_path.exists() {
        return Err(anyhow::anyhow!(
            "目标容器中已存在同名 Skill: {}",
            target_path.display()
        ));
    }

    skill_projection::copy_skill_directory(Path::new(&skill.local_path), &target_path)?;
    get_workspace_skill_inventory(app, target_id)
}

pub fn remove_workspace_target_skill(
    app: &AppHandle,
    target_id: &str,
    container_kind: SkillDiscoveryContainerKind,
    skill_path_or_key: &str,
) -> anyhow::Result<WorkspaceSkillInventory> {
    let target = resolve_workspace_skill_target(app, target_id)?;
    if target.read_only {
        return Err(anyhow::anyhow!("当前目标为只读，不能删除 Skill"));
    }

    let container_root = resolve_workspace_target_container_path(&target, container_kind)?;
    let skill_path = PathBuf::from(skill_path_or_key.trim());
    if !skill_path.exists() {
        return Err(anyhow::anyhow!(
            "workspace skill path does not exist: {}",
            skill_path.display()
        ));
    }
    let parent = skill_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("workspace skill path missing parent"))?;
    if skill_center_store::normalize_workspace_key(&parent.to_string_lossy())
        != skill_center_store::normalize_workspace_key(&container_root.to_string_lossy())
    {
        return Err(anyhow::anyhow!(
            "workspace skill is outside target container: {}",
            skill_path.display()
        ));
    }
    if !skill_path.join("SKILL.md").is_file() {
        return Err(anyhow::anyhow!(
            "target path is not a managed skill directory: {}",
            skill_path.display()
        ));
    }

    skill_projection::remove_projection_target(&skill_path)?;
    get_workspace_skill_inventory(app, target_id)
}

pub fn scan_discoverable_skills(app: &AppHandle) -> anyhow::Result<SkillDiscoverySnapshot> {
    if let Some(path) = effective_work_dir(app) {
        let _ = track_workspace_root(app, Path::new(&path));
    }
    if let Some(path) = active_session_work_dir(app)? {
        let _ = track_workspace_root(app, Path::new(&path));
    }

    let scanned_at = skill_center_store::now_timestamp();
    let workspaces = discovery_roots(app)?;
    let registry = skill_center_store::load_registry(app)?;
    let mut records = Vec::<DiscoveredSkillRecord>::new();

    for root in &workspaces {
        let root_path = PathBuf::from(&root.path);
        for (container_kind, container_path) in discovery_container_paths(root, &root_path) {
            for record in scan_discovery_container_records_inner(
                &registry,
                root,
                container_kind,
                &container_path,
                &scanned_at,
                |skill_path, error| {
                    log_manager::append_line(
                        app,
                        format!(
                            "skill center skipped invalid discovered skill `{}`: {error:#}",
                            skill_center_store::path_to_display_string(skill_path),
                        ),
                    );
                },
            )? {
                let location = record.locations[0].clone();
                let imported_skill_id = record.imported_skill_id.clone();
                if let Some(existing) = records
                    .iter_mut()
                    .find(|item| item.discovery_id == record.discovery_id)
                {
                    existing.locations.push(location);
                    existing.locations =
                        skill_center_store::dedupe_discovery_locations(&existing.locations);
                    if existing.imported_skill_id.is_none() {
                        existing.imported_skill_id = imported_skill_id;
                    }
                    existing.last_scanned_at = scanned_at.clone();
                    continue;
                }

                records.push(record);
            }
        }
    }

    records.sort_by(|left, right| left.name.cmp(&right.name));
    let snapshot = SkillDiscoverySnapshot {
        scanned_at,
        workspaces,
        records,
    };
    skill_center_store::save_discovery_cache(app, &snapshot)?;
    Ok(snapshot)
}

fn scan_discovery_container_records_inner<F>(
    registry: &[InstalledSkill],
    root: &WorkspaceDiscoveryRoot,
    container_kind: SkillDiscoveryContainerKind,
    container_path: &Path,
    scanned_at: &str,
    mut on_error: F,
) -> anyhow::Result<Vec<DiscoveredSkillRecord>>
where
    F: FnMut(&Path, &anyhow::Error),
{
    if !container_path.is_dir() {
        return Ok(Vec::new());
    }

    let container_path_str = skill_center_store::path_to_display_string(container_path);
    let mut records = Vec::new();
    for entry in fs::read_dir(container_path).with_context(|| {
        format!(
            "failed to read discovery container directory: {}",
            container_path.display()
        )
    })? {
        let entry = entry.with_context(|| {
            format!(
                "failed to inspect discovery entry under {}",
                container_path.display()
            )
        })?;
        let skill_path = entry.path();
        if !skill_path.is_dir() || !skill_path.join("SKILL.md").is_file() {
            continue;
        }
        match build_discovered_skill_record(
            registry,
            root,
            container_kind,
            &container_path_str,
            &skill_path,
            scanned_at,
        ) {
            Ok(record) => records.push(record),
            Err(error) => on_error(&skill_path, &error),
        }
    }
    Ok(records)
}

fn build_discovered_skill_record(
    registry: &[InstalledSkill],
    root: &WorkspaceDiscoveryRoot,
    container_kind: SkillDiscoveryContainerKind,
    container_path_str: &str,
    skill_path: &Path,
    scanned_at: &str,
) -> anyhow::Result<DiscoveredSkillRecord> {
    let canonical = skill_center_store::canonicalize_source_path(skill_path)?;
    let discovery_id = skill_center_store::build_discovery_id(&canonical)?;
    let manifest = skill_center_store::parse_skill_manifest(&canonical.join("SKILL.md"))?;
    let raw_name = manifest
        .name
        .clone()
        .or_else(|| {
            canonical
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "skill".to_string());
    let projection_name = skill_center_store::normalize_projection_name(&raw_name)
        .unwrap_or_else(|| "skill".to_string());
    let canonical_str = skill_center_store::path_to_display_string(&canonical);
    let imported_skill = registry.iter().find(|skill| {
        skill
            .source_path
            .as_deref()
            .map(|value| {
                skill_center_store::normalize_workspace_key(value)
                    == skill_center_store::normalize_workspace_key(&canonical_str)
            })
            .unwrap_or(false)
    });
    let location = SkillDiscoveryLocation {
        scope: root.scope,
        container_kind,
        container_path: container_path_str.to_string(),
        skill_path: canonical_str.clone(),
        workspace_id: match root.scope {
            SkillDiscoveryScope::Workspace => Some(root.id.clone()),
            SkillDiscoveryScope::UserHome => None,
        },
        workspace_label: Some(root.label.clone()),
    };

    Ok(DiscoveredSkillRecord {
        discovery_id,
        name: raw_name,
        description: manifest.description.unwrap_or_default(),
        canonical_path: canonical_str,
        projection_name,
        has_scripts: skill_center_store::has_scripts_dir(&canonical),
        locations: vec![location],
        imported_skill_id: imported_skill.map(|skill| skill.id.clone()),
        last_scanned_at: scanned_at.to_string(),
    })
}

pub fn get_discovered_skill_detail(
    app: &AppHandle,
    discovery_id: &str,
) -> anyhow::Result<DiscoveredSkillDetail> {
    let snapshot = skill_center_store::load_discovery_cache(app)?;
    let record = snapshot
        .records
        .into_iter()
        .find(|item| item.discovery_id == discovery_id.trim())
        .ok_or_else(|| anyhow::anyhow!("discovered skill not found: {}", discovery_id.trim()))?;
    let relative_paths =
        skill_center_store::list_relative_paths(Path::new(&record.canonical_path), 256)
            .unwrap_or_default();
    Ok(DiscoveredSkillDetail {
        record,
        relative_paths,
    })
}

pub fn import_discovered_skill(
    app: &AppHandle,
    discovery_id: &str,
) -> anyhow::Result<InstalledSkill> {
    let snapshot = skill_center_store::load_discovery_cache(app)?;
    let record = snapshot
        .records
        .into_iter()
        .find(|item| item.discovery_id == discovery_id.trim())
        .ok_or_else(|| anyhow::anyhow!("discovered skill not found: {}", discovery_id.trim()))?;
    let canonical_path = PathBuf::from(&record.canonical_path);
    let source_key = skill_center_store::build_discovered_source_key(&canonical_path)?;
    let registry = skill_center_store::load_registry(app)?;
    if let Some(existing) = registry
        .into_iter()
        .find(|skill| skill.source_key == source_key)
    {
        return Ok(existing);
    }
    if !canonical_path.join("SKILL.md").is_file() {
        return Err(anyhow::anyhow!(
            "discovered skill source is missing SKILL.md: {}",
            canonical_path.display()
        ));
    }
    let metadata = InstallSourceMetadata {
        source_type: SkillSourceType::DiscoveredImport,
        source_label: record.canonical_path.clone(),
        source_key,
        source_path: Some(record.canonical_path.clone()),
        repo_url: None,
        git_ref: None,
        commit: None,
        default_trusted: false,
        discovery_locations: record.locations,
    };
    install_skill_from_source(app, &canonical_path, metadata, ExistingSkillAction::Error)
}

fn metadata_from_manifest(
    manifest: &skill_center_store::ParsedSkillManifest,
) -> SkillManifestMetadata {
    SkillManifestMetadata {
        triggers: manifest.triggers.clone(),
        ..SkillManifestMetadata::default()
    }
}

fn install_skill_from_source(
    app: &AppHandle,
    source_dir: &Path,
    metadata: InstallSourceMetadata,
    existing_action: ExistingSkillAction,
) -> anyhow::Result<InstalledSkill> {
    let skill_md = source_dir.join("SKILL.md");
    if !skill_md.is_file() {
        return Err(anyhow::anyhow!(
            "skill root must contain SKILL.md: {}",
            source_dir.display()
        ));
    }

    let manifest = skill_center_store::parse_skill_manifest(&skill_md)?;
    let raw_name = manifest
        .name
        .clone()
        .or_else(|| {
            source_dir
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "skill".to_string());
    let normalized_projection_name = skill_center_store::normalize_projection_name(&raw_name)
        .ok_or_else(|| {
            anyhow::anyhow!("invalid skill name; expected lowercase letters, digits or hyphens")
        })?;
    let description = manifest.description.clone().unwrap_or_default();
    let manifest_metadata = metadata_from_manifest(&manifest);

    let mut registry = skill_center_store::load_registry(app)?;
    if let Some(existing_index) = registry
        .iter()
        .position(|skill| skill.source_key == metadata.source_key)
    {
        return match existing_action {
            ExistingSkillAction::Error => Err(anyhow::anyhow!("skill already installed")),
            ExistingSkillAction::RefreshBundled => refresh_existing_bundled_skill(
                app,
                &mut registry,
                existing_index,
                source_dir,
                &raw_name,
                &description,
                &normalized_projection_name,
                manifest_metadata,
                &metadata,
            ),
        };
    }

    let install_id = skill_center_store::create_install_id();
    let target_dir = skill_center_store::repos_dir(app)?.join(&install_id);
    skill_center_store::copy_skill_source(source_dir, &target_dir)?;
    let timestamp = skill_center_store::now_timestamp();
    let installed = InstalledSkill {
        id: install_id,
        name: raw_name,
        description,
        source_type: metadata.source_type,
        source_label: metadata.source_label,
        source_key: metadata.source_key,
        source_path: metadata.source_path,
        repo_url: metadata.repo_url,
        git_ref: metadata.git_ref,
        commit: metadata.commit,
        local_path: target_dir.to_string_lossy().to_string(),
        projection_name: normalized_projection_name,
        trusted: metadata.default_trusted,
        installed_at: timestamp.clone(),
        updated_at: timestamp,
        has_scripts: skill_center_store::has_scripts_dir(&target_dir),
        metadata: manifest_metadata,
        update_status: SkillUpdateStatusView::default(),
        discovery_locations: metadata.discovery_locations.clone(),
    };
    registry.push(installed.clone());
    skill_center_store::save_registry(app, &registry)?;
    Ok(installed)
}

fn refresh_existing_bundled_skill(
    app: &AppHandle,
    registry: &mut [InstalledSkill],
    existing_index: usize,
    source_dir: &Path,
    raw_name: &str,
    description: &str,
    normalized_projection_name: &str,
    manifest_metadata: SkillManifestMetadata,
    metadata: &InstallSourceMetadata,
) -> anyhow::Result<InstalledSkill> {
    let existing = registry
        .get_mut(existing_index)
        .ok_or_else(|| anyhow::anyhow!("bundled skill index out of bounds"))?;
    let target_dir = PathBuf::from(&existing.local_path);
    skill_center_store::replace_skill_source(source_dir, &target_dir)?;

    existing.name = raw_name.to_string();
    existing.description = description.to_string();
    existing.source_type = metadata.source_type;
    existing.source_label = metadata.source_label.clone();
    existing.source_key = metadata.source_key.clone();
    existing.source_path = metadata.source_path.clone();
    existing.repo_url = metadata.repo_url.clone();
    existing.git_ref = metadata.git_ref.clone();
    existing.commit = metadata.commit.clone();
    if existing.projection_name.trim().is_empty() {
        existing.projection_name = normalized_projection_name.to_string();
    }
    existing.updated_at = skill_center_store::now_timestamp();
    existing.has_scripts = skill_center_store::has_scripts_dir(&target_dir);
    existing.metadata = manifest_metadata;
    existing.update_status = build_update_status(SkillUpdateStatusKind::UpToDate, None);
    existing.discovery_locations = metadata.discovery_locations.clone();

    let refreshed = existing.clone();
    skill_center_store::save_registry(app, registry)?;
    resync_bundled_copy_projections(app, &refreshed)?;
    Ok(refreshed)
}

fn refresh_installed_skill_from_source(
    app: &AppHandle,
    skill_id: &str,
    source_dir: &Path,
    metadata: &InstallSourceMetadata,
) -> anyhow::Result<InstalledSkill> {
    let skill_md = source_dir.join("SKILL.md");
    if !skill_md.is_file() {
        return Err(anyhow::anyhow!(
            "skill root must contain SKILL.md: {}",
            source_dir.display()
        ));
    }

    let manifest = skill_center_store::parse_skill_manifest(&skill_md)?;
    let raw_name = manifest
        .name
        .clone()
        .or_else(|| {
            source_dir
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "skill".to_string());
    let normalized_projection_name = skill_center_store::normalize_projection_name(&raw_name)
        .ok_or_else(|| {
            anyhow::anyhow!("invalid skill name; expected lowercase letters, digits or hyphens")
        })?;
    let description = manifest.description.clone().unwrap_or_default();
    let manifest_metadata = metadata_from_manifest(&manifest);

    let mut registry = skill_center_store::load_registry(app)?;
    let existing = skill_center_store::find_skill_mut(&mut registry, skill_id)
        .ok_or_else(|| anyhow::anyhow!("skill not found: {}", skill_id.trim()))?;
    let target_dir = PathBuf::from(&existing.local_path);
    skill_center_store::replace_skill_source(source_dir, &target_dir)?;

    existing.name = raw_name;
    existing.description = description;
    existing.source_type = metadata.source_type;
    existing.source_label = metadata.source_label.clone();
    existing.source_key = metadata.source_key.clone();
    existing.source_path = metadata.source_path.clone();
    existing.repo_url = metadata.repo_url.clone();
    existing.git_ref = metadata.git_ref.clone();
    existing.commit = metadata.commit.clone();
    if existing.projection_name.trim().is_empty() {
        existing.projection_name = normalized_projection_name;
    }
    existing.updated_at = skill_center_store::now_timestamp();
    existing.has_scripts = skill_center_store::has_scripts_dir(&target_dir);
    existing.metadata = manifest_metadata;
    existing.update_status = build_update_status(
        SkillUpdateStatusKind::UpToDate,
        Some("技能已从来源重新同步".to_string()),
    );
    existing.discovery_locations = metadata.discovery_locations.clone();

    let refreshed = existing.clone();
    skill_center_store::save_registry(app, &registry)?;
    resync_bundled_copy_projections(app, &refreshed)?;
    Ok(refreshed)
}

fn sync_bundled_skills(app: &AppHandle) -> anyhow::Result<()> {
    let bundled_dir = resolve_bundled_skills_dir(app)?;
    for entry in fs::read_dir(&bundled_dir).context("failed to read bundled skills directory")? {
        let entry = entry.context("failed to read bundled skill entry")?;
        let path = entry.path();
        if !path.is_dir() || !path.join("SKILL.md").is_file() {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().to_string();
        let relative_path = format!("{BUNDLED_SKILLS_DIR_NAME}/{dir_name}");
        let metadata = InstallSourceMetadata {
            source_type: SkillSourceType::Bundled,
            source_label: "内置 Skill".to_string(),
            source_key: skill_center_store::build_bundled_source_key(&relative_path),
            source_path: Some(relative_path),
            repo_url: None,
            git_ref: None,
            commit: None,
            default_trusted: true,
            discovery_locations: Vec::new(),
        };
        if let Err(error) =
            install_skill_from_source(app, &path, metadata, ExistingSkillAction::RefreshBundled)
        {
            log_manager::append_line(
                app,
                format!("bundled skill sync failed (entry={dir_name}): {error:#}"),
            );
        }
    }
    Ok(())
}

fn resolve_bundled_skills_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let development_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join(BUNDLED_SKILLS_DIR_NAME);
    resolve_bundled_skills_dir_from_sources(
        app.path().resource_dir().ok(),
        development_dir,
        dev_workspace_fallback_enabled(),
    )
}

fn bundled_skills_resource_candidates(resource_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::with_capacity(2);
    candidates.push(resource_dir.join(BUNDLED_SKILLS_DIR_NAME));

    let legacy_dir = LEGACY_BUNDLED_SKILLS_DIR_SEGMENTS
        .iter()
        .fold(resource_dir.to_path_buf(), |path, segment| {
            path.join(segment)
        });
    if legacy_dir != candidates[0] {
        candidates.push(legacy_dir);
    }

    candidates
}

fn resync_bundled_copy_projections(app: &AppHandle, skill: &InstalledSkill) -> anyhow::Result<()> {
    let source_dir = Path::new(&skill.local_path);
    let mut global_projections = skill_center_store::load_global_projections(app)?;
    let mut global_changed = false;
    for projection in &mut global_projections {
        if projection.skill_id != skill.id || projection.method != SkillProjectionMethod::Copy {
            continue;
        }
        rematerialize_projection(source_dir, projection)?;
        global_changed = true;
    }
    if global_changed {
        skill_center_store::save_global_projections(app, &global_projections)?;
    }

    for mut session_state in skill_center_store::load_all_session_states(app)? {
        let mut changed = false;
        for projection in &mut session_state.projections {
            if projection.skill_id != skill.id || projection.method != SkillProjectionMethod::Copy {
                continue;
            }
            rematerialize_projection(source_dir, projection)?;
            changed = true;
        }
        if changed {
            skill_center_store::save_session_state(app, &session_state)?;
        }
    }
    Ok(())
}

fn resolve_bundled_skills_dir_from_sources(
    resource_dir: Option<PathBuf>,
    development_dir: PathBuf,
    allow_workspace_fallback: bool,
) -> anyhow::Result<PathBuf> {
    let mut checked = Vec::new();
    if let Some(resource_dir) = resource_dir {
        for (index, candidate) in bundled_skills_resource_candidates(&resource_dir)
            .into_iter()
            .enumerate()
        {
            let source = if index == 0 {
                "resource_bundle:root"
            } else {
                "resource_bundle:legacy_up_path"
            };
            if candidate.is_dir() {
                return Ok(candidate);
            }
            checked.push(format!("{source}:missing"));
        }
    } else {
        checked.push("resource_bundle:unavailable".to_string());
    }

    if allow_workspace_fallback {
        if development_dir.is_dir() {
            return Ok(development_dir);
        }
        checked.push("workspace_fallback:missing".to_string());
    } else {
        checked.push("workspace_fallback:disabled".to_string());
    }

    Err(anyhow::anyhow!(
        "bundled skills directory not found; checked_sources={}",
        checked.join(", ")
    ))
}

fn rematerialize_projection(
    source_dir: &Path,
    projection: &mut SkillProjectionRecord,
) -> anyhow::Result<()> {
    let target_path = PathBuf::from(&projection.target_path);
    skill_projection::remove_projection_target(&target_path)?;
    projection.method = skill_projection::materialize_skill(source_dir, &target_path)?;
    Ok(())
}

fn apply_skill_to_user_global(app: &AppHandle, skill: &InstalledSkill) -> anyhow::Result<()> {
    let target_root = user_global_skills_dir()?;
    apply_skill_to_global_root(app, skill, SkillApplyScope::UserGlobalKimi, &target_root)
}

fn apply_skill_to_kimi_code_home(app: &AppHandle, skill: &InstalledSkill) -> anyhow::Result<()> {
    let target_root = kimi_code_home_skills_dir()?;
    apply_skill_to_global_root(app, skill, SkillApplyScope::KimiCodeHome, &target_root)
}

fn apply_skill_to_global_root(
    app: &AppHandle,
    skill: &InstalledSkill,
    scope: SkillApplyScope,
    target_root: &Path,
) -> anyhow::Result<()> {
    let target_path = target_root.join(&skill.projection_name);
    let mut projections = skill_center_store::load_global_projections(app)?;
    if projections.iter().any(|projection| {
        projection.skill_id == skill.id && projection.target_path == target_path.to_string_lossy()
    }) {
        return Ok(());
    }
    if target_path.exists() {
        return Err(anyhow::anyhow!(
            "名称冲突：目标目录中已存在 {}",
            target_path.display()
        ));
    }
    let method = skill_projection::materialize_skill(Path::new(&skill.local_path), &target_path)?;
    projections.push(SkillProjectionRecord {
        skill_id: skill.id.clone(),
        scope,
        target_path: target_path.to_string_lossy().to_string(),
        projection_name: skill.projection_name.clone(),
        applied_at: skill_center_store::now_timestamp(),
        method,
    });
    skill_center_store::save_global_projections(app, &projections)
}

fn apply_skill_to_active_session(app: &AppHandle, skill: &InstalledSkill) -> anyhow::Result<()> {
    ensure_session_scope_available(app)?;
    let (session_id, session_work_dir) = active_session_identity(app)?.ok_or_else(|| {
        anyhow::anyhow!("当前没有可用的 active session 或 session work directory")
    })?;
    let work_dir_path = PathBuf::from(&session_work_dir);
    if !work_dir_path.is_dir() {
        return Err(anyhow::anyhow!(
            "active session work directory does not exist: {}",
            work_dir_path.display()
        ));
    }

    let target_root = skill_projection::session_skills_dir(&work_dir_path);
    let target_path = target_root.join(&skill.projection_name);
    let mut state = skill_center_store::load_session_state(app, &session_id)?.unwrap_or_default();
    state.session_id = Some(session_id.clone());
    state.session_work_dir = Some(session_work_dir.clone());
    if state.projections.iter().any(|projection| {
        projection.skill_id == skill.id && projection.target_path == target_path.to_string_lossy()
    }) {
        return Ok(());
    }
    if target_path.exists() {
        return Err(anyhow::anyhow!(
            "当前 Session 工作目录已有同名 Skill: {}",
            target_path.display()
        ));
    }

    let method = skill_projection::materialize_skill(Path::new(&skill.local_path), &target_path)?;
    state.projections.push(SkillProjectionRecord {
        skill_id: skill.id.clone(),
        scope: SkillApplyScope::SessionKimi,
        target_path: target_path.to_string_lossy().to_string(),
        projection_name: skill.projection_name.clone(),
        applied_at: skill_center_store::now_timestamp(),
        method,
    });
    state.applied_skill_ids = state
        .projections
        .iter()
        .map(|projection| projection.skill_id.clone())
        .collect();
    skill_center_store::save_session_state(app, &state)
}

fn remove_skill_from_global_state(
    app: &AppHandle,
    skill_id: &str,
    scope: Option<SkillApplyScope>,
) -> anyhow::Result<()> {
    let mut projections = skill_center_store::load_global_projections(app)?;
    let mut removed = Vec::new();
    projections.retain(|projection| {
        if projection.skill_id == skill_id.trim()
            && scope.map(|value| projection.scope == value).unwrap_or(true)
        {
            removed.push(projection.clone());
            false
        } else {
            true
        }
    });
    for projection in removed {
        skill_projection::remove_projection_target(Path::new(&projection.target_path))?;
    }
    skill_center_store::save_global_projections(app, &projections)
}

fn remove_skill_from_session_state(
    app: &AppHandle,
    session_id: &str,
    skill_id: &str,
) -> anyhow::Result<()> {
    let Some(mut state) = skill_center_store::load_session_state(app, session_id)? else {
        return Ok(());
    };
    let mut removed = Vec::new();
    state.projections.retain(|projection| {
        if projection.skill_id == skill_id.trim() {
            removed.push(projection.clone());
            false
        } else {
            true
        }
    });
    for projection in removed {
        skill_projection::remove_projection_target(Path::new(&projection.target_path))?;
    }
    state.applied_skill_ids = state
        .projections
        .iter()
        .map(|projection| projection.skill_id.clone())
        .collect();
    if state.projections.is_empty() {
        skill_center_store::delete_session_state(app, session_id)?;
    } else {
        skill_center_store::save_session_state(app, &state)?;
    }
    Ok(())
}

fn load_global_projection_for_skill(
    app: &AppHandle,
    skill_id: &str,
) -> anyhow::Result<Option<SkillProjectionRecord>> {
    Ok(skill_center_store::load_global_projections(app)?
        .into_iter()
        .find(|projection| {
            projection.skill_id == skill_id && projection.scope == SkillApplyScope::UserGlobalKimi
        }))
}

fn current_active_session_state(app: &AppHandle) -> anyhow::Result<SessionSkillState> {
    let Some(session_id) = active_session_id(app)? else {
        return Ok(SessionSkillState::default());
    };
    Ok(
        skill_center_store::load_session_state(app, &session_id)?.unwrap_or(SessionSkillState {
            session_id: Some(session_id),
            session_work_dir: active_session_work_dir(app)?,
            applied_skill_ids: Vec::new(),
            projections: Vec::new(),
        }),
    )
}

fn build_apply_result(app: &AppHandle, scope: SkillApplyScope) -> anyhow::Result<SkillApplyResult> {
    Ok(SkillApplyResult {
        scope,
        global_skills: list_global_skills(app)?,
        active_session: current_active_session_state(app)?,
    })
}

fn active_session_identity(app: &AppHandle) -> anyhow::Result<Option<(String, String)>> {
    let Some(session_id) = active_session_id(app)? else {
        return Ok(None);
    };
    let Some(work_dir) = active_session_work_dir(app)? else {
        return Ok(None);
    };
    Ok(Some((session_id, work_dir)))
}

fn active_session_id(app: &AppHandle) -> anyhow::Result<Option<String>> {
    let state = app.state::<AppState>();
    let runtime = state
        .runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
    Ok(runtime.active_session_id.clone())
}

fn ensure_session_scope_available(app: &AppHandle) -> anyhow::Result<()> {
    let state = app.state::<AppState>();
    let runtime = state
        .runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
    if !matches!(
        runtime.state,
        BackendState::Starting | BackendState::Running
    ) {
        return Err(anyhow::anyhow!(
            "session skills require backend to be running or starting"
        ));
    }
    if runtime.active_session_id.is_none() {
        return Err(anyhow::anyhow!("no active session available"));
    }
    if runtime.active_session_work_dir.is_none() {
        return Err(anyhow::anyhow!(
            "active session work directory is unavailable"
        ));
    }
    Ok(())
}

fn active_session_work_dir(app: &AppHandle) -> anyhow::Result<Option<String>> {
    let state = app.state::<AppState>();
    let runtime = state
        .runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
    Ok(runtime
        .active_session_work_dir
        .as_ref()
        .map(|path| path.to_string_lossy().to_string()))
}

fn effective_work_dir(app: &AppHandle) -> Option<String> {
    let state = app.state::<AppState>();
    let Ok(runtime) = state.runtime.lock() else {
        return None;
    };
    runtime
        .effective_work_dir
        .as_ref()
        .map(|path| path.to_string_lossy().to_string())
}

fn resolve_workspace_key(app: &AppHandle, workspace_key: Option<&str>) -> Option<String> {
    workspace_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(skill_center_store::normalize_workspace_key)
        .or_else(|| {
            effective_work_dir(app).map(|path| skill_center_store::normalize_workspace_key(&path))
        })
}

fn record_recent_skill(app: &AppHandle, skill_id: &str, session_scope: bool) -> anyhow::Result<()> {
    let Some(workspace_key) =
        effective_work_dir(app).map(|value| skill_center_store::normalize_workspace_key(&value))
    else {
        return Ok(());
    };

    let mut profiles = skill_center_store::load_workspace_profiles(app)?;
    let mut found = false;
    for profile in &mut profiles {
        if profile.workspace_id != workspace_key {
            continue;
        }
        found = true;
        let mut recent = vec![skill_id.trim().to_string()];
        recent.extend(profile.recent_skill_ids.clone());
        profile.recent_skill_ids = skill_center_store::dedupe_recent_skill_ids(&recent)
            .into_iter()
            .take(12)
            .collect();
        if session_scope {
            let mut last_session = vec![skill_id.trim().to_string()];
            last_session.extend(profile.last_session_skill_ids.clone());
            profile.last_session_skill_ids =
                skill_center_store::dedupe_recent_skill_ids(&last_session)
                    .into_iter()
                    .take(12)
                    .collect();
        }
        break;
    }
    if !found {
        profiles.push(WorkspaceSkillProfile {
            workspace_id: workspace_key,
            recent_skill_ids: vec![skill_id.trim().to_string()],
            pinned_skill_ids: Vec::new(),
            last_session_skill_ids: if session_scope {
                vec![skill_id.trim().to_string()]
            } else {
                Vec::new()
            },
        });
    }
    skill_center_store::save_workspace_profiles(app, &profiles)
}

fn discovery_roots(app: &AppHandle) -> anyhow::Result<Vec<WorkspaceDiscoveryRoot>> {
    let mut roots = skill_center_store::load_workspace_index(app)?;
    let home_dir = skill_center_store::user_home_dir()?;
    let home_path = skill_center_store::path_to_display_string(&home_dir);
    roots.push(WorkspaceDiscoveryRoot {
        id: "user-home".to_string(),
        scope: SkillDiscoveryScope::UserHome,
        path: home_path.clone(),
        label: home_path,
        last_seen_at: skill_center_store::now_timestamp(),
    });
    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        let key = format!(
            "{:?}|{}",
            root.scope,
            skill_center_store::normalize_workspace_key(&root.path)
        );
        if !seen.insert(key) {
            continue;
        }
        deduped.push(root);
    }
    deduped.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(deduped)
}

fn project_skill_container_paths(root: &Path) -> Vec<(SkillDiscoveryContainerKind, PathBuf)> {
    vec![
        (
            SkillDiscoveryContainerKind::Agents,
            root.join(".agents").join("skills"),
        ),
        (
            SkillDiscoveryContainerKind::KimiCode,
            root.join(".kimi-code").join("skills"),
        ),
    ]
}

fn user_home_discovery_container_paths(root: &Path) -> Vec<(SkillDiscoveryContainerKind, PathBuf)> {
    let mut paths = project_skill_container_paths(root);
    paths.push((
        SkillDiscoveryContainerKind::LegacyAgents,
        root.join(".config").join("agents").join("skills"),
    ));
    paths
}

fn discovery_container_paths(
    root: &WorkspaceDiscoveryRoot,
    root_path: &Path,
) -> Vec<(SkillDiscoveryContainerKind, PathBuf)> {
    match root.scope {
        SkillDiscoveryScope::UserHome => user_home_discovery_container_paths(root_path),
        SkillDiscoveryScope::Workspace => project_skill_container_paths(root_path),
    }
}

fn build_workspace_skill_target(
    id: String,
    scope: SkillDiscoveryScope,
    label: String,
    root_path: &Path,
    read_only: bool,
    is_current: bool,
) -> WorkspaceSkillTarget {
    WorkspaceSkillTarget {
        id,
        scope,
        label,
        root_path: skill_center_store::path_to_display_string(root_path),
        read_only,
        is_current,
        container_roots: match scope {
            SkillDiscoveryScope::UserHome => user_home_discovery_container_paths(root_path),
            SkillDiscoveryScope::Workspace => project_skill_container_paths(root_path),
        }
        .into_iter()
        .map(
            |(container_kind, container_path)| WorkspaceSkillTargetContainerRoot {
                container_kind,
                container_path: skill_center_store::path_to_display_string(&container_path),
            },
        )
        .collect(),
    }
}

fn display_workspace_label(root_path: &Path, fallback: &str) -> String {
    root_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| skill_center_store::normalize_display_path(fallback))
}

fn resolve_workspace_skill_target(
    app: &AppHandle,
    target_id: &str,
) -> anyhow::Result<WorkspaceSkillTarget> {
    let target_id = target_id.trim();
    if target_id.is_empty() {
        return Err(anyhow::anyhow!("target id cannot be empty"));
    }
    list_workspace_skill_targets(app)?
        .into_iter()
        .find(|target| target.id == target_id)
        .ok_or_else(|| anyhow::anyhow!("workspace skill target not found: {}", target_id))
}

fn resolve_workspace_target_container_path(
    target: &WorkspaceSkillTarget,
    container_kind: SkillDiscoveryContainerKind,
) -> anyhow::Result<PathBuf> {
    target
        .container_roots
        .iter()
        .find(|root| root.container_kind == container_kind)
        .map(|root| PathBuf::from(&root.container_path))
        .ok_or_else(|| anyhow::anyhow!("workspace skill container not found"))
}

fn build_workspace_skill_container_inventory(
    app: &AppHandle,
    registry: &[InstalledSkill],
    target: &WorkspaceSkillTarget,
    container_kind: SkillDiscoveryContainerKind,
    container_path: &Path,
) -> anyhow::Result<WorkspaceSkillContainerInventory> {
    let skills = scan_workspace_container_skills(app, registry, container_kind, container_path)?;
    Ok(WorkspaceSkillContainerInventory {
        container_kind,
        container_path: skill_center_store::path_to_display_string(container_path),
        read_only: target.read_only,
        skills,
    })
}

fn scan_workspace_container_skills(
    app: &AppHandle,
    registry: &[InstalledSkill],
    container_kind: SkillDiscoveryContainerKind,
    container_path: &Path,
) -> anyhow::Result<Vec<WorkspaceManagedSkillRecord>> {
    scan_workspace_container_skills_inner(
        registry,
        container_kind,
        container_path,
        |skill_path, error| {
            log_manager::append_line(
                app,
                format!(
                    "skill center skipped invalid workspace skill `{}`: {error:#}",
                    skill_center_store::path_to_display_string(skill_path),
                ),
            );
        },
    )
}

fn scan_workspace_container_skills_inner<F>(
    registry: &[InstalledSkill],
    container_kind: SkillDiscoveryContainerKind,
    container_path: &Path,
    mut on_error: F,
) -> anyhow::Result<Vec<WorkspaceManagedSkillRecord>>
where
    F: FnMut(&Path, &anyhow::Error),
{
    if !container_path.is_dir() {
        return Ok(Vec::new());
    }

    let mut skills = Vec::new();
    for entry in fs::read_dir(container_path).with_context(|| {
        format!(
            "failed to read workspace skill container directory: {}",
            container_path.display()
        )
    })? {
        let entry = entry.with_context(|| {
            format!(
                "failed to inspect workspace skill entry under {}",
                container_path.display()
            )
        })?;
        let skill_path = entry.path();
        if !skill_path.is_dir() || !skill_path.join("SKILL.md").is_file() {
            continue;
        }
        match build_workspace_skill_record(registry, container_kind, &skill_path) {
            Ok(skill) => skills.push(skill),
            Err(error) => on_error(&skill_path, &error),
        }
    }
    skills.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(skills)
}

fn build_workspace_skill_record(
    registry: &[InstalledSkill],
    container_kind: SkillDiscoveryContainerKind,
    skill_path: &Path,
) -> anyhow::Result<WorkspaceManagedSkillRecord> {
    let manifest = skill_center_store::parse_skill_manifest(&skill_path.join("SKILL.md"))?;
    let raw_name = manifest
        .name
        .clone()
        .or_else(|| {
            skill_path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "skill".to_string());
    let projection_name = skill_center_store::normalize_projection_name(&raw_name)
        .unwrap_or_else(|| "skill".to_string());
    let canonical_path = skill_center_store::canonicalize_source_path(skill_path).ok();
    let matched_installed_skill_id = registry
        .iter()
        .find(|skill| {
            canonical_path
                .as_ref()
                .map(|path| {
                    skill_center_store::normalize_workspace_key(&skill.local_path)
                        == skill_center_store::normalize_workspace_key(
                            &skill_center_store::path_to_display_string(path),
                        )
                })
                .unwrap_or(false)
                || skill.projection_name == projection_name
        })
        .map(|skill| skill.id.clone());
    let skill_display_path = skill_center_store::path_to_display_string(skill_path);
    Ok(WorkspaceManagedSkillRecord {
        skill_key: skill_display_path.clone(),
        name: raw_name,
        description: manifest.description.unwrap_or_default(),
        projection_name,
        has_scripts: skill_center_store::has_scripts_dir(skill_path),
        skill_path: skill_display_path,
        container_kind,
        matched_installed_skill_id,
    })
}

fn mark_skill_source_missing(
    app: &AppHandle,
    skill_id: &str,
    detail: String,
) -> anyhow::Result<InstalledSkill> {
    let mut registry = skill_center_store::load_registry(app)?;
    let existing = skill_center_store::find_skill_mut(&mut registry, skill_id)
        .ok_or_else(|| anyhow::anyhow!("skill not found: {}", skill_id.trim()))?;
    existing.updated_at = skill_center_store::now_timestamp();
    existing.update_status =
        build_update_status(SkillUpdateStatusKind::SourceMissing, Some(detail));
    let updated = existing.clone();
    skill_center_store::save_registry(app, &registry)?;
    Ok(updated)
}

fn resolve_bundled_skill_source(app: &AppHandle, relative_path: &str) -> anyhow::Result<PathBuf> {
    let bundled_dir = resolve_bundled_skills_dir(app)?;
    let normalized = relative_path
        .trim()
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    let relative = normalized
        .strip_prefix(&format!("{BUNDLED_SKILLS_DIR_NAME}/"))
        .unwrap_or(&normalized);
    let source_dir = relative
        .split('/')
        .filter(|part| !part.trim().is_empty())
        .fold(bundled_dir, |path, part| path.join(part));
    if !source_dir.join("SKILL.md").is_file() {
        return Err(anyhow::anyhow!(
            "bundled skill source is missing for relative path: {}",
            normalized
        ));
    }
    Ok(source_dir)
}

fn dev_workspace_fallback_enabled() -> bool {
    env_flag_enabled(env::var(DEV_WORKSPACE_FALLBACK_ENV).ok().as_deref())
}

fn env_flag_enabled(value: Option<&str>) -> bool {
    value
        .map(str::trim)
        .map(|value| value.to_ascii_lowercase())
        .map(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

fn default_recommended_scope(skill: &InstalledSkill) -> SkillApplyScope {
    skill
        .metadata
        .recommended_scopes
        .first()
        .copied()
        .unwrap_or(SkillApplyScope::SessionKimi)
}

fn build_update_status(
    kind: SkillUpdateStatusKind,
    detail: Option<String>,
) -> SkillUpdateStatusView {
    SkillUpdateStatusView {
        kind,
        detail,
        checked_at: Some(skill_center_store::now_timestamp()),
    }
}

fn resolve_workspace_skill_profile(
    profiles: Vec<WorkspaceSkillProfile>,
    workspace_key: &str,
) -> Option<WorkspaceSkillProfile> {
    profiles
        .into_iter()
        .find(|profile| profile.workspace_id == workspace_key.trim())
}

fn user_global_skills_dir() -> anyhow::Result<PathBuf> {
    let target = user_home_dir()?.join(".agents").join("skills");
    fs::create_dir_all(&target).with_context(|| {
        format!(
            "failed to create user global skills dir: {}",
            target.display()
        )
    })?;
    Ok(target)
}

fn kimi_code_home_skills_dir() -> anyhow::Result<PathBuf> {
    let target = token_resolver::resolve_kimi_code_home()?.join("skills");
    fs::create_dir_all(&target).with_context(|| {
        format!(
            "failed to create Kimi Code home skills dir: {}",
            target.display()
        )
    })?;
    Ok(target)
}

fn user_home_dir() -> anyhow::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .or_else(|| {
            let drive = std::env::var_os("HOMEDRIVE")?;
            let path = std::env::var_os("HOMEPATH")?;
            Some(PathBuf::from(drive).join(path).into_os_string())
        })
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("failed to resolve user home directory"))?;
    Ok(home)
}

fn run_git(args: &[&str], cwd: Option<&Path>) -> anyhow::Result<()> {
    let mut command = Command::new("git");
    command.args(args);
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    let output = command.output().context("failed to invoke git")?;
    if output.status.success() {
        return Ok(());
    }
    Err(anyhow::anyhow!(
        "git {} failed: {}",
        args.join(" "),
        summarize_output(&output.stdout, &output.stderr)
    ))
}

fn run_git_capture(args: &[&str], cwd: Option<&Path>) -> anyhow::Result<String> {
    let mut command = Command::new("git");
    command.args(args);
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    let output = command.output().context("failed to invoke git")?;
    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "git {} failed: {}",
            args.join(" "),
            summarize_output(&output.stdout, &output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn summarize_output(stdout: &[u8], stderr: &[u8]) -> String {
    let stdout = String::from_utf8_lossy(stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "unknown git error".to_string()
    }
}

fn extract_zip_archive(zip_path: &Path, target_dir: &Path) -> anyhow::Result<()> {
    let file = File::open(zip_path)
        .with_context(|| format!("failed to open zip archive: {}", zip_path.display()))?;
    let mut archive = ZipArchive::new(file)
        .with_context(|| format!("failed to read zip archive: {}", zip_path.display()))?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).with_context(|| {
            format!(
                "failed to read zip archive entry #{index}: {}",
                zip_path.display()
            )
        })?;
        let Some(relative_path) = entry.enclosed_name().map(PathBuf::from) else {
            continue;
        };
        let output_path = target_dir.join(relative_path);
        if entry.is_dir() {
            fs::create_dir_all(&output_path).with_context(|| {
                format!(
                    "failed to create extracted directory from zip: {}",
                    output_path.display()
                )
            })?;
            continue;
        }
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!(
                    "failed to create extracted zip parent dir: {}",
                    parent.display()
                )
            })?;
        }
        let mut output = File::create(&output_path).with_context(|| {
            format!(
                "failed to create extracted zip file: {}",
                output_path.display()
            )
        })?;
        io::copy(&mut entry, &mut output)
            .with_context(|| format!("failed to extract zip entry to {}", output_path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(name: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("kimi-skill-center-scan-{name}-{unique}"));
            fs::create_dir_all(&path).expect("temp dir");
            Self { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn user_global_dir_is_under_home_agents_skills() {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .expect("home");
        let dir = user_global_skills_dir().expect("global dir");
        assert!(dir.starts_with(home));
        assert!(dir.ends_with(Path::new(".agents").join("skills")));
        assert!(!dir.to_string_lossy().contains(".config"));
    }

    #[test]
    fn project_container_paths_include_agents_and_kimi_code() {
        let root = Path::new("D:/repo");
        let paths = project_skill_container_paths(root);

        assert_eq!(
            paths,
            vec![
                (
                    SkillDiscoveryContainerKind::Agents,
                    root.join(".agents").join("skills")
                ),
                (
                    SkillDiscoveryContainerKind::KimiCode,
                    root.join(".kimi-code").join("skills")
                ),
            ]
        );
    }

    #[test]
    fn user_home_discovery_keeps_config_agents_as_legacy_only() {
        let root = Path::new("D:/home");
        let paths = user_home_discovery_container_paths(root);

        assert!(paths.contains(&(
            SkillDiscoveryContainerKind::LegacyAgents,
            root.join(".config").join("agents").join("skills")
        )));
        assert!(!project_skill_container_paths(root)
            .iter()
            .any(|(_, path)| path
                .components()
                .any(|part| part.as_os_str() == std::ffi::OsStr::new(".config"))));
    }

    #[test]
    fn resolve_workspace_skill_profile_returns_matching_profile() {
        let profile = resolve_workspace_skill_profile(
            vec![WorkspaceSkillProfile {
                workspace_id: "d:\\repo".to_string(),
                recent_skill_ids: vec!["skill-a".to_string()],
                pinned_skill_ids: vec![],
                last_session_skill_ids: vec!["skill-b".to_string()],
            }],
            "d:\\repo",
        )
        .expect("profile should exist");

        assert_eq!(profile.workspace_id, "d:\\repo");
        assert_eq!(profile.recent_skill_ids, vec!["skill-a".to_string()]);
        assert_eq!(profile.last_session_skill_ids, vec!["skill-b".to_string()]);
    }

    #[test]
    fn resolve_workspace_skill_profile_returns_none_when_missing() {
        let profile = resolve_workspace_skill_profile(
            vec![WorkspaceSkillProfile {
                workspace_id: "d:\\repo".to_string(),
                recent_skill_ids: vec!["skill-a".to_string()],
                pinned_skill_ids: vec![],
                last_session_skill_ids: vec![],
            }],
            "d:\\other",
        );

        assert!(profile.is_none());
    }

    #[test]
    fn scan_workspace_container_skills_inner_skips_invalid_skill_manifest() {
        let temp = TempDir::new("workspace-scan");
        let container = temp.path.join(".codex").join("skills");
        let valid = container.join("valid-skill");
        let invalid = container.join("broken-skill");
        fs::create_dir_all(&valid).expect("valid dir");
        fs::create_dir_all(&invalid).expect("invalid dir");
        fs::write(valid.join("SKILL.md"), "# Valid Skill\nbody").expect("valid skill");
        fs::write(invalid.join("SKILL.md"), "---\nname: Broken\nbody").expect("invalid skill");

        let mut skipped = Vec::new();
        let skills = scan_workspace_container_skills_inner(
            &[],
            SkillDiscoveryContainerKind::Codex,
            &container,
            |skill_path, _| {
                skipped.push(
                    skill_path
                        .file_name()
                        .expect("skill dir name")
                        .to_string_lossy()
                        .to_string(),
                );
            },
        )
        .expect("workspace scan");

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "Valid Skill");
        assert_eq!(skipped, vec!["broken-skill".to_string()]);
    }

    #[test]
    fn scan_discovery_container_records_inner_skips_invalid_skill_manifest() {
        let temp = TempDir::new("discovery-scan");
        let container = temp.path.join(".agents").join("skills");
        let valid = container.join("valid-skill");
        let invalid = container.join("broken-skill");
        fs::create_dir_all(&valid).expect("valid dir");
        fs::create_dir_all(&invalid).expect("invalid dir");
        fs::write(valid.join("SKILL.md"), "# Valid Skill\nbody").expect("valid skill");
        fs::write(invalid.join("SKILL.md"), "---\nname: Broken\nbody").expect("invalid skill");

        let root = WorkspaceDiscoveryRoot {
            id: skill_center_store::normalize_workspace_key(&temp.path.to_string_lossy()),
            scope: SkillDiscoveryScope::Workspace,
            path: skill_center_store::path_to_display_string(&temp.path),
            label: skill_center_store::path_to_display_string(&temp.path),
            last_seen_at: "2026-03-26T00:00:00+08:00".to_string(),
        };

        let mut skipped = Vec::new();
        let records = scan_discovery_container_records_inner(
            &[],
            &root,
            SkillDiscoveryContainerKind::Agents,
            &container,
            "2026-03-26T00:00:00+08:00",
            |skill_path, _| {
                skipped.push(
                    skill_path
                        .file_name()
                        .expect("skill dir name")
                        .to_string_lossy()
                        .to_string(),
                );
            },
        )
        .expect("discovery scan");

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].name, "Valid Skill");
        assert_eq!(
            records[0].canonical_path,
            skill_center_store::path_to_display_string(&valid)
        );
        assert_eq!(skipped, vec!["broken-skill".to_string()]);
    }

    #[test]
    fn bundled_skills_resource_candidates_include_root_and_legacy_up_path() {
        let resource_dir = Path::new("C:\\Users\\endea\\AppData\\Local\\Kimi Sidekick");
        let candidates = bundled_skills_resource_candidates(resource_dir);

        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0], resource_dir.join("skills"));
        assert_eq!(
            candidates[1],
            resource_dir
                .join("_up_")
                .join("_up_")
                .join("_up_")
                .join("skills")
        );
    }

    #[test]
    fn resolve_bundled_skills_dir_disables_workspace_fallback_by_default() {
        let err = resolve_bundled_skills_dir_from_sources(
            None,
            PathBuf::from("D:\\MyProject\\kimi-app\\skills"),
            false,
        )
        .expect_err("workspace fallback should be disabled by default");

        let message = err.to_string();
        assert!(message.contains("workspace_fallback:disabled"));
        assert!(!message.contains("D:\\MyProject\\kimi-app"));
    }

    #[test]
    fn resolve_bundled_skills_dir_allows_workspace_fallback_when_explicitly_enabled() {
        let temp = TempDir::new("bundled-skills-workspace-fallback");
        let development_dir = temp.path.join("skills");
        let bundled_skill = development_dir.join("demo-bundled-skill");
        fs::create_dir_all(&bundled_skill).expect("bundled skill dir");
        fs::write(bundled_skill.join("SKILL.md"), "# Bundled Skill\nbody").expect("skill file");

        let resolved = resolve_bundled_skills_dir_from_sources(None, development_dir.clone(), true)
            .expect("workspace fallback should resolve when explicitly enabled");

        assert_eq!(resolved, development_dir);
    }
}
