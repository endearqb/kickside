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
    log_manager, skill_center_store, skill_projection,
    types::{
        BackendState, InstalledSkill, SessionSkillState, SkillApplyResult, SkillApplyScope,
        SkillDetail, SkillProjectionMethod, SkillProjectionRecord, SkillSourceType,
        WorkspaceSkillProfile,
    },
};

const BUNDLED_SKILLS_DIR_NAME: &str = "skills";

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
        remove_skill_from_global_state(app, skill_id)?;
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
        SkillApplyScope::UserGlobalKimi => remove_skill_from_global_state(app, skill_id)?,
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
    let key = workspace_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(skill_center_store::normalize_workspace_key)
        .or_else(|| {
            effective_work_dir(app).map(|path| skill_center_store::normalize_workspace_key(&path))
        });
    let Some(key) = key else {
        return Ok(None);
    };
    Ok(resolve_workspace_skill_profile(
        skill_center_store::load_workspace_profiles(app)?,
        &key,
    ))
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
                &manifest.description.unwrap_or_default(),
                &normalized_projection_name,
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
        description: manifest.description.unwrap_or_default(),
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

    let refreshed = existing.clone();
    skill_center_store::save_registry(app, registry)?;
    resync_bundled_copy_projections(app, &refreshed)?;
    Ok(refreshed)
}

fn sync_bundled_skills(app: &AppHandle) -> anyhow::Result<()> {
    let bundled_dir = resolve_bundled_skills_dir(app)?;
    for entry in fs::read_dir(&bundled_dir).with_context(|| {
        format!(
            "failed to read bundled skills dir: {}",
            bundled_dir.display()
        )
    })? {
        let entry = entry.with_context(|| {
            format!(
                "failed to read bundled skill entry under {}",
                bundled_dir.display()
            )
        })?;
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
        };
        if let Err(error) =
            install_skill_from_source(app, &path, metadata, ExistingSkillAction::RefreshBundled)
        {
            log_manager::append_line(
                app,
                format!(
                    "bundled skill sync failed (path={}): {error:#}",
                    path.display()
                ),
            );
        }
    }
    Ok(())
}

fn resolve_bundled_skills_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let mut checked = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join(BUNDLED_SKILLS_DIR_NAME);
        if candidate.is_dir() {
            return Ok(candidate);
        }
        checked.push(candidate);
    }

    let development_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join(BUNDLED_SKILLS_DIR_NAME);
    if development_dir.is_dir() {
        return Ok(development_dir);
    }
    checked.push(development_dir);

    let checked_paths = checked
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<String>>()
        .join(", ");
    Err(anyhow::anyhow!(
        "bundled skills directory not found; checked {checked_paths}"
    ))
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
    let target_path = target_root.join(&skill.projection_name);
    let mut projections = skill_center_store::load_global_projections(app)?;
    if projections.iter().any(|projection| {
        projection.skill_id == skill.id && projection.target_path == target_path.to_string_lossy()
    }) {
        return Ok(());
    }
    if target_path.exists() {
        return Err(anyhow::anyhow!(
            "名称冲突：用户全局目录中已存在 {}",
            target_path.display()
        ));
    }
    let method = skill_projection::materialize_skill(Path::new(&skill.local_path), &target_path)?;
    projections.push(SkillProjectionRecord {
        skill_id: skill.id.clone(),
        scope: SkillApplyScope::UserGlobalKimi,
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

fn remove_skill_from_global_state(app: &AppHandle, skill_id: &str) -> anyhow::Result<()> {
    let mut projections = skill_center_store::load_global_projections(app)?;
    let mut removed = Vec::new();
    projections.retain(|projection| {
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
        .find(|projection| projection.skill_id == skill_id))
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

fn resolve_workspace_skill_profile(
    profiles: Vec<WorkspaceSkillProfile>,
    workspace_key: &str,
) -> Option<WorkspaceSkillProfile> {
    profiles
        .into_iter()
        .find(|profile| profile.workspace_id == workspace_key.trim())
}

fn user_global_skills_dir() -> anyhow::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .or_else(|| {
            let drive = std::env::var_os("HOMEDRIVE")?;
            let path = std::env::var_os("HOMEPATH")?;
            Some(PathBuf::from(drive).join(path).into_os_string())
        })
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("failed to resolve user home directory"))?;
    let target = home.join(".config").join("agents").join("skills");
    fs::create_dir_all(&target).with_context(|| {
        format!(
            "failed to create user global skills dir: {}",
            target.display()
        )
    })?;
    Ok(target)
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

    #[test]
    fn user_global_dir_is_under_config_agents_skills() {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .expect("home");
        let dir = user_global_skills_dir().expect("global dir");
        assert!(dir.starts_with(home));
        assert!(dir.to_string_lossy().contains(".config"));
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
}
