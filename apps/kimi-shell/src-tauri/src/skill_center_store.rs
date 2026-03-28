use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Context;
use chrono::Local;
use rand::{distributions::Alphanumeric, Rng};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::types::{
    DiscoveredSkillRecord, InstalledSkill, SessionSkillState, SkillDiscoveryLocation,
    SkillDiscoveryScope, SkillDiscoverySnapshot, SkillProjectionRecord, SkillSourceType,
    WorkspaceDiscoveryRoot, WorkspaceSkillProfile,
};

const SKILL_CENTER_DIR_NAME: &str = "skill-center";
const REGISTRY_FILE_NAME: &str = "registry.json";
const GLOBAL_STATE_FILE_NAME: &str = "global.json";
const WORKSPACE_STATE_FILE_NAME: &str = "workspaces.json";
const WORKSPACE_INDEX_FILE_NAME: &str = "workspace-index.json";
const DISCOVERY_CACHE_FILE_NAME: &str = "discovery-cache.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SkillRegistryFile {
    #[serde(default)]
    installed: Vec<InstalledSkill>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GlobalStateFile {
    #[serde(default)]
    projections: Vec<SkillProjectionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WorkspaceProfilesFile {
    #[serde(default)]
    profiles: Vec<WorkspaceSkillProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WorkspaceIndexFile {
    #[serde(default)]
    workspaces: Vec<WorkspaceDiscoveryRoot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DiscoveryCacheFile {
    scanned_at: Option<String>,
    #[serde(default)]
    workspaces: Vec<WorkspaceDiscoveryRoot>,
    #[serde(default)]
    records: Vec<DiscoveredSkillRecord>,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedSkillManifest {
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct SkillFrontmatter {
    name: Option<String>,
    description: Option<String>,
}

pub fn ensure_layout(app: &AppHandle) -> anyhow::Result<()> {
    let root = skill_center_root(app)?;
    fs::create_dir_all(repos_dir(app)?).with_context(|| {
        format!(
            "failed to create skill center repos dir: {}",
            root.display()
        )
    })?;
    fs::create_dir_all(cache_git_dir(app)?).with_context(|| {
        format!(
            "failed to create skill center cache dir: {}",
            root.display()
        )
    })?;
    fs::create_dir_all(session_states_dir(app)?).with_context(|| {
        format!(
            "failed to create skill center session states dir: {}",
            root.display()
        )
    })?;

    if !registry_path(app)?.exists() {
        write_json(
            &registry_path(app)?,
            &SkillRegistryFile {
                installed: Vec::new(),
            },
        )?;
    }
    if !global_state_path(app)?.exists() {
        write_json(
            &global_state_path(app)?,
            &GlobalStateFile {
                projections: Vec::new(),
            },
        )?;
    }
    if !workspace_profiles_path(app)?.exists() {
        write_json(
            &workspace_profiles_path(app)?,
            &WorkspaceProfilesFile {
                profiles: Vec::new(),
            },
        )?;
    }
    if !workspace_index_path(app)?.exists() {
        write_json(
            &workspace_index_path(app)?,
            &WorkspaceIndexFile {
                workspaces: Vec::new(),
            },
        )?;
    }
    if !discovery_cache_path(app)?.exists() {
        write_json(&discovery_cache_path(app)?, &DiscoveryCacheFile::default())?;
    }
    Ok(())
}

pub fn skill_center_root(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .or_else(|_| app.path().app_config_dir())
        .context("failed to resolve app data directory for skill center")?;
    Ok(base.join(SKILL_CENTER_DIR_NAME))
}

pub fn repos_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(skill_center_root(app)?.join("repos"))
}

pub fn cache_git_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(skill_center_root(app)?.join("cache").join("git"))
}

pub fn state_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(skill_center_root(app)?.join("state"))
}

pub fn session_states_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(state_dir(app)?.join("sessions"))
}

pub fn registry_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(skill_center_root(app)?.join(REGISTRY_FILE_NAME))
}

pub fn global_state_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(state_dir(app)?.join(GLOBAL_STATE_FILE_NAME))
}

pub fn workspace_profiles_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(state_dir(app)?.join(WORKSPACE_STATE_FILE_NAME))
}

pub fn workspace_index_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(state_dir(app)?.join(WORKSPACE_INDEX_FILE_NAME))
}

pub fn discovery_cache_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(state_dir(app)?.join(DISCOVERY_CACHE_FILE_NAME))
}

pub fn session_state_path(app: &AppHandle, session_id: &str) -> anyhow::Result<PathBuf> {
    Ok(session_states_dir(app)?.join(format!("{}.json", sanitize_file_component(session_id))))
}

pub fn load_registry(app: &AppHandle) -> anyhow::Result<Vec<InstalledSkill>> {
    ensure_layout(app)?;
    let mut file: SkillRegistryFile = read_json_or_default(&registry_path(app)?)?;
    let mut dirty = false;
    for skill in &mut file.installed {
        if normalize_legacy_skill(skill) {
            dirty = true;
        }
    }
    if dirty {
        save_registry(app, &file.installed)?;
    }
    Ok(file.installed)
}

pub fn save_registry(app: &AppHandle, installed: &[InstalledSkill]) -> anyhow::Result<()> {
    ensure_layout(app)?;
    write_json(
        &registry_path(app)?,
        &SkillRegistryFile {
            installed: installed.to_vec(),
        },
    )
}

pub fn load_global_projections(app: &AppHandle) -> anyhow::Result<Vec<SkillProjectionRecord>> {
    ensure_layout(app)?;
    let file: GlobalStateFile = read_json_or_default(&global_state_path(app)?)?;
    Ok(file.projections)
}

pub fn save_global_projections(
    app: &AppHandle,
    projections: &[SkillProjectionRecord],
) -> anyhow::Result<()> {
    ensure_layout(app)?;
    write_json(
        &global_state_path(app)?,
        &GlobalStateFile {
            projections: projections.to_vec(),
        },
    )
}

pub fn load_session_state(
    app: &AppHandle,
    session_id: &str,
) -> anyhow::Result<Option<SessionSkillState>> {
    ensure_layout(app)?;
    let path = session_state_path(app, session_id)?;
    if !path.exists() {
        return Ok(None);
    }
    read_json(&path).map(Some)
}

pub fn save_session_state(app: &AppHandle, state: &SessionSkillState) -> anyhow::Result<()> {
    ensure_layout(app)?;
    let Some(session_id) = state.session_id.as_deref() else {
        return Err(anyhow::anyhow!("session state missing session id"));
    };
    write_json(&session_state_path(app, session_id)?, state)
}

pub fn delete_session_state(app: &AppHandle, session_id: &str) -> anyhow::Result<()> {
    ensure_layout(app)?;
    let path = session_state_path(app, session_id)?;
    if path.exists() {
        fs::remove_file(&path)
            .with_context(|| format!("failed to delete session state file: {}", path.display()))?;
    }
    Ok(())
}

pub fn load_all_session_states(app: &AppHandle) -> anyhow::Result<Vec<SessionSkillState>> {
    ensure_layout(app)?;
    let dir = session_states_dir(app)?;
    let mut items = Vec::new();
    for entry in fs::read_dir(&dir)
        .with_context(|| format!("failed to read session states dir: {}", dir.display()))?
    {
        let entry = entry.with_context(|| {
            format!(
                "failed to read skill center session state entry: {}",
                dir.display()
            )
        })?;
        let path = entry.path();
        if path.extension() != Some(OsStr::new("json")) {
            continue;
        }
        if let Ok(state) = read_json::<SessionSkillState>(&path) {
            items.push(state);
        }
    }
    Ok(items)
}

pub fn load_workspace_profiles(app: &AppHandle) -> anyhow::Result<Vec<WorkspaceSkillProfile>> {
    ensure_layout(app)?;
    let file: WorkspaceProfilesFile = read_json_or_default(&workspace_profiles_path(app)?)?;
    Ok(file.profiles)
}

pub fn save_workspace_profiles(
    app: &AppHandle,
    profiles: &[WorkspaceSkillProfile],
) -> anyhow::Result<()> {
    ensure_layout(app)?;
    write_json(
        &workspace_profiles_path(app)?,
        &WorkspaceProfilesFile {
            profiles: profiles.to_vec(),
        },
    )
}

pub fn load_workspace_index(app: &AppHandle) -> anyhow::Result<Vec<WorkspaceDiscoveryRoot>> {
    ensure_layout(app)?;
    let file: WorkspaceIndexFile = read_json_or_default(&workspace_index_path(app)?)?;
    Ok(file
        .workspaces
        .into_iter()
        .map(normalize_workspace_root)
        .collect())
}

pub fn save_workspace_index(
    app: &AppHandle,
    workspaces: &[WorkspaceDiscoveryRoot],
) -> anyhow::Result<()> {
    ensure_layout(app)?;
    write_json(
        &workspace_index_path(app)?,
        &WorkspaceIndexFile {
            workspaces: workspaces
                .iter()
                .cloned()
                .map(normalize_workspace_root)
                .collect(),
        },
    )
}

pub fn load_discovery_cache(app: &AppHandle) -> anyhow::Result<SkillDiscoverySnapshot> {
    ensure_layout(app)?;
    let file: DiscoveryCacheFile = read_json_or_default(&discovery_cache_path(app)?)?;
    Ok(normalize_discovery_snapshot(SkillDiscoverySnapshot {
        scanned_at: file.scanned_at.unwrap_or_default(),
        workspaces: file.workspaces,
        records: file.records,
    }))
}

pub fn save_discovery_cache(
    app: &AppHandle,
    snapshot: &SkillDiscoverySnapshot,
) -> anyhow::Result<()> {
    ensure_layout(app)?;
    let normalized = normalize_discovery_snapshot(snapshot.clone());
    write_json(
        &discovery_cache_path(app)?,
        &DiscoveryCacheFile {
            scanned_at: Some(normalized.scanned_at.clone()),
            workspaces: normalized.workspaces,
            records: normalized.records,
        },
    )
}

pub fn normalize_projection_name(value: &str) -> Option<String> {
    let mut normalized = String::new();
    let mut previous_hyphen = false;
    for ch in value.trim().chars() {
        let next = if ch.is_ascii_alphanumeric() {
            previous_hyphen = false;
            ch.to_ascii_lowercase()
        } else {
            if previous_hyphen {
                continue;
            }
            previous_hyphen = true;
            '-'
        };
        normalized.push(next);
    }
    let trimmed = normalized.trim_matches('-').to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub fn parse_skill_manifest(skill_md_path: &Path) -> anyhow::Result<ParsedSkillManifest> {
    let raw = fs::read_to_string(skill_md_path)
        .with_context(|| format!("failed to read SKILL.md: {}", skill_md_path.display()))?;
    let normalized_raw = raw.replace("\r\n", "\n").replace('\r', "\n");
    let mut remaining = normalized_raw.as_str();
    let mut manifest = ParsedSkillManifest::default();

    if let Some(stripped) = remaining.strip_prefix("---\n") {
        let Some(frontmatter_end) = stripped.find("\n---\n") else {
            return Err(anyhow::anyhow!(
                "invalid SKILL.md frontmatter in {}",
                skill_md_path.display()
            ));
        };
        let yaml = &stripped[..frontmatter_end];
        let parsed: SkillFrontmatter = serde_yaml::from_str(yaml).with_context(|| {
            format!(
                "failed to parse SKILL.md frontmatter yaml: {}",
                skill_md_path.display()
            )
        })?;
        manifest.name = parsed
            .name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        manifest.description = parsed
            .description
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        remaining = &stripped[(frontmatter_end + "\n---\n".len())..];
    }

    if manifest.name.is_none() {
        for line in remaining.lines() {
            let trimmed = line.trim();
            if let Some(name) = trimmed.strip_prefix("# ") {
                let value = name.trim().to_string();
                if !value.is_empty() {
                    manifest.name = Some(value);
                    break;
                }
            }
        }
    }

    if manifest.description.is_none() {
        let mut parts = Vec::new();
        for line in remaining.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                if !parts.is_empty() {
                    break;
                }
                continue;
            }
            if trimmed.starts_with('#') || trimmed.starts_with("```") {
                continue;
            }
            parts.push(trimmed.to_string());
            if parts.len() >= 2 {
                break;
            }
        }
        if !parts.is_empty() {
            manifest.description = Some(parts.join(" "));
        }
    }

    Ok(manifest)
}

pub fn list_relative_paths(root: &Path, limit: usize) -> anyhow::Result<Vec<String>> {
    let mut results = Vec::new();
    visit_relative_paths(root, root, limit, &mut results)?;
    results.sort();
    Ok(results)
}

pub fn create_install_id() -> String {
    let rand_tail: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(8)
        .map(char::from)
        .collect();
    format!("skill-{}-{rand_tail}", Local::now().timestamp_millis())
}

pub fn create_temp_install_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    ensure_layout(app)?;
    let dir = cache_git_dir(app)?.join(create_install_id());
    fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create temp skill install dir: {}", dir.display()))?;
    Ok(dir)
}

pub fn remove_temp_install_dir(path: &Path) {
    let _ = fs::remove_dir_all(path);
}

pub fn replace_skill_source(source_dir: &Path, target_dir: &Path) -> anyhow::Result<()> {
    if target_dir.exists() {
        fs::remove_dir_all(target_dir).with_context(|| {
            format!(
                "failed to clear target skill directory before refresh: {}",
                target_dir.display()
            )
        })?;
    }
    copy_skill_source(source_dir, target_dir)
}

pub fn copy_skill_source(source_dir: &Path, target_dir: &Path) -> anyhow::Result<()> {
    if !source_dir.is_dir() {
        return Err(anyhow::anyhow!(
            "skill source is not a directory: {}",
            source_dir.display()
        ));
    }
    fs::create_dir_all(target_dir).with_context(|| {
        format!(
            "failed to create target skill directory: {}",
            target_dir.display()
        )
    })?;

    for entry in fs::read_dir(source_dir)
        .with_context(|| format!("failed to read skill source dir: {}", source_dir.display()))?
    {
        let entry = entry.with_context(|| {
            format!(
                "failed to read skill source entry: {}",
                source_dir.display()
            )
        })?;
        let name = entry.file_name();
        if name == OsStr::new(".git") {
            continue;
        }
        let source_path = entry.path();
        let target_path = target_dir.join(&name);
        let metadata = entry.metadata().with_context(|| {
            format!(
                "failed to read skill source metadata: {}",
                source_path.display()
            )
        })?;
        if metadata.is_dir() {
            copy_skill_source(&source_path, &target_path)?;
        } else {
            fs::copy(&source_path, &target_path).with_context(|| {
                format!(
                    "failed to copy skill file from {} to {}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }
    }
    Ok(())
}

pub fn now_timestamp() -> String {
    Local::now().to_rfc3339()
}

pub fn has_scripts_dir(root: &Path) -> bool {
    root.join("scripts").is_dir()
}

pub fn canonicalize_source_path(path: &Path) -> anyhow::Result<PathBuf> {
    fs::canonicalize(path)
        .with_context(|| format!("failed to canonicalize source path: {}", path.display()))
}

pub fn normalize_display_path(path: &str) -> String {
    let trimmed = path.trim();
    #[cfg(windows)]
    {
        let without_extended = if let Some(rest) = trimmed.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{}", rest)
        } else if let Some(rest) = trimmed.strip_prefix(r"\\?\") {
            rest.to_string()
        } else {
            trimmed.to_string()
        };
        without_extended.replace('/', "\\")
    }
    #[cfg(not(windows))]
    {
        trimmed.to_string()
    }
}

pub fn path_to_display_string(path: &Path) -> String {
    normalize_display_path(&path.to_string_lossy())
}

pub fn user_home_dir() -> anyhow::Result<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .or_else(|| {
            let drive = std::env::var_os("HOMEDRIVE")?;
            let path = std::env::var_os("HOMEPATH")?;
            Some(PathBuf::from(drive).join(path).into_os_string())
        })
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("failed to resolve user home directory"))
}

pub fn build_git_source_key(repo_url: &str, git_ref: Option<&str>, commit: &str) -> String {
    let git_ref = git_ref
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("head");
    format!("git:{}#{}@{}", repo_url.trim(), git_ref, commit.trim())
}

pub fn build_local_source_key(path: &Path, is_zip: bool) -> anyhow::Result<String> {
    let canonical = canonicalize_source_path(path)?;
    let prefix = if is_zip { "local_zip" } else { "local" };
    Ok(format!("{prefix}:{}", canonical.to_string_lossy()))
}

pub fn build_bundled_source_key(relative_bundle_path: &str) -> String {
    format!(
        "bundled:{}",
        relative_bundle_path
            .trim()
            .replace('\\', "/")
            .trim_matches('/'),
    )
}

pub fn build_discovered_source_key(path: &Path) -> anyhow::Result<String> {
    let canonical = canonicalize_source_path(path)?;
    Ok(format!(
        "discovered:{}",
        canonical.to_string_lossy().replace('\\', "/")
    ))
}

pub fn build_discovery_id(path: &Path) -> anyhow::Result<String> {
    let canonical = canonicalize_source_path(path)?;
    Ok(format!(
        "discovery:{}",
        canonical.to_string_lossy().replace('\\', "/")
    ))
}

pub fn is_zip_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
}

pub fn resolve_skill_root_from_extracted_dir(extracted_dir: &Path) -> anyhow::Result<PathBuf> {
    if extracted_dir.join("SKILL.md").is_file() {
        return Ok(extracted_dir.to_path_buf());
    }

    let entries = fs::read_dir(extracted_dir)
        .with_context(|| {
            format!(
                "failed to inspect extracted zip dir: {}",
                extracted_dir.display()
            )
        })?
        .collect::<Result<Vec<_>, _>>()
        .with_context(|| {
            format!(
                "failed to read extracted zip dir entries: {}",
                extracted_dir.display()
            )
        })?;
    if entries.len() == 1 {
        let only_path = entries[0].path();
        if only_path.is_dir() && only_path.join("SKILL.md").is_file() {
            return Ok(only_path);
        }
    }

    Err(anyhow::anyhow!(
        "zip archive must contain SKILL.md at the root or inside a single top-level directory"
    ))
}

pub fn find_skill<'a>(skills: &'a [InstalledSkill], skill_id: &str) -> Option<&'a InstalledSkill> {
    skills.iter().find(|skill| skill.id == skill_id.trim())
}

pub fn find_skill_mut<'a>(
    skills: &'a mut [InstalledSkill],
    skill_id: &str,
) -> Option<&'a mut InstalledSkill> {
    skills.iter_mut().find(|skill| skill.id == skill_id.trim())
}

pub fn normalize_workspace_key(path: &str) -> String {
    let trimmed = normalize_display_path(path);
    if cfg!(windows) {
        trimmed.trim_end_matches('\\').to_lowercase()
    } else {
        trimmed.trim_end_matches('\\').to_string()
    }
}

fn normalize_workspace_root(root: WorkspaceDiscoveryRoot) -> WorkspaceDiscoveryRoot {
    let path = normalize_display_path(&root.path);
    let label = normalize_display_path(&root.label);
    let id = match root.scope {
        SkillDiscoveryScope::Workspace => normalize_workspace_key(&path),
        SkillDiscoveryScope::UserHome => root.id,
    };
    WorkspaceDiscoveryRoot {
        id,
        scope: root.scope,
        path,
        label,
        last_seen_at: root.last_seen_at,
    }
}

fn normalize_discovery_snapshot(snapshot: SkillDiscoverySnapshot) -> SkillDiscoverySnapshot {
    SkillDiscoverySnapshot {
        scanned_at: snapshot.scanned_at,
        workspaces: snapshot
            .workspaces
            .into_iter()
            .map(normalize_workspace_root)
            .collect(),
        records: snapshot
            .records
            .into_iter()
            .map(|record| DiscoveredSkillRecord {
                canonical_path: normalize_display_path(&record.canonical_path),
                locations: record
                    .locations
                    .into_iter()
                    .map(|location| SkillDiscoveryLocation {
                        container_path: normalize_display_path(&location.container_path),
                        skill_path: normalize_display_path(&location.skill_path),
                        workspace_id: location
                            .workspace_id
                            .map(|value| normalize_workspace_key(&value)),
                        workspace_label: location
                            .workspace_label
                            .map(|value| normalize_display_path(&value)),
                        ..location
                    })
                    .collect(),
                ..record
            })
            .collect(),
    }
}

pub fn dedupe_recent_skill_ids(values: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
            continue;
        }
        result.push(trimmed.to_string());
    }
    result
}

pub fn dedupe_discovery_locations(
    values: &[crate::types::SkillDiscoveryLocation],
) -> Vec<crate::types::SkillDiscoveryLocation> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for value in values {
        let scope = match value.scope {
            crate::types::SkillDiscoveryScope::UserHome => "user_home",
            crate::types::SkillDiscoveryScope::Workspace => "workspace",
        };
        let container_kind = match value.container_kind {
            crate::types::SkillDiscoveryContainerKind::Agents => "agents",
            crate::types::SkillDiscoveryContainerKind::Codex => "codex",
            crate::types::SkillDiscoveryContainerKind::Claude => "claude",
        };
        let key = format!(
            "{}|{}|{}|{}|{}",
            scope,
            container_kind,
            value.container_path,
            value.skill_path,
            value.workspace_id.as_deref().unwrap_or("")
        );
        if !seen.insert(key) {
            continue;
        }
        result.push(value.clone());
    }
    result
}

fn visit_relative_paths(
    root: &Path,
    current: &Path,
    limit: usize,
    output: &mut Vec<String>,
) -> anyhow::Result<()> {
    if output.len() >= limit {
        return Ok(());
    }
    for entry in fs::read_dir(current)
        .with_context(|| format!("failed to read skill directory: {}", current.display()))?
    {
        if output.len() >= limit {
            break;
        }
        let entry = entry.with_context(|| {
            format!(
                "failed to read skill directory entry: {}",
                current.display()
            )
        })?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map(|item| item.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"));
        output.push(relative);
        let metadata = entry
            .metadata()
            .with_context(|| format!("failed to read skill entry metadata: {}", path.display()))?;
        if metadata.is_dir() {
            visit_relative_paths(root, &path, limit, output)?;
        }
    }
    Ok(())
}

fn sanitize_file_component(value: &str) -> String {
    let normalized: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    normalized.trim_matches('-').to_string()
}

fn normalize_legacy_skill(skill: &mut InstalledSkill) -> bool {
    let mut dirty = false;
    if skill.source_label.trim().is_empty() || skill.source_key.trim().is_empty() {
        dirty = true;
        if let Some(repo_url) = skill
            .repo_url
            .clone()
            .filter(|value| !value.trim().is_empty())
        {
            skill.source_type = SkillSourceType::Git;
            skill.source_label = repo_url.clone();
            skill.source_key = build_git_source_key(
                &repo_url,
                skill.git_ref.as_deref(),
                skill.commit.as_deref().unwrap_or(""),
            );
        } else if let Some(source_path) = skill
            .source_path
            .clone()
            .filter(|value| !value.trim().is_empty())
        {
            skill.source_type = SkillSourceType::LocalImport;
            skill.source_label = source_path.clone();
            skill.source_key = if source_path.to_ascii_lowercase().ends_with(".zip") {
                format!("local_zip:{source_path}")
            } else {
                format!("local:{source_path}")
            };
        } else {
            skill.source_label = skill.local_path.clone();
            skill.source_key = format!("legacy:{}", skill.id);
        }
    }
    dirty
}

fn read_json<T: DeserializeOwned>(path: &Path) -> anyhow::Result<T> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("failed to read json file: {}", path.display()))?;
    serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse json file: {}", path.display()))
}

fn read_json_or_default<T>(path: &Path) -> anyhow::Result<T>
where
    T: DeserializeOwned + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }
    read_json(path)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create skill center parent dir: {}",
                parent.display()
            )
        })?;
    }
    let raw = serde_json::to_string_pretty(value).context("failed to serialize json")?;
    fs::write(path, raw).with_context(|| format!("failed to write json file: {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{SkillDiscoveryContainerKind, SkillDiscoveryLocation, SkillDiscoveryScope};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(name: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("kimi-skill-center-{name}-{unique}"));
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
    fn normalize_projection_name_keeps_lowercase_hyphenated_form() {
        assert_eq!(
            normalize_projection_name("Hello Skill v1"),
            Some("hello-skill-v1".to_string())
        );
    }

    #[test]
    fn normalize_projection_name_rejects_empty_result() {
        assert_eq!(normalize_projection_name("%%%"), None);
    }

    #[test]
    fn parse_skill_manifest_reads_frontmatter_and_body() {
        let temp = TempDir::new("manifest");
        let path = temp.path.join("SKILL.md");
        fs::write(
            &path,
            "---\nname: Demo Skill\ndescription: Short desc\n---\n# ignored\nbody",
        )
        .expect("write");

        let parsed = parse_skill_manifest(&path).expect("parse");
        assert_eq!(parsed.name.as_deref(), Some("Demo Skill"));
        assert_eq!(parsed.description.as_deref(), Some("Short desc"));
    }

    #[test]
    fn parse_skill_manifest_supports_crlf_frontmatter() {
        let temp = TempDir::new("manifest-crlf");
        let path = temp.path.join("SKILL.md");
        fs::write(
            &path,
            "---\r\nname: pdf\r\ndescription: PDF skill\r\n---\r\n# PDF Processing Guide\r\nbody",
        )
        .expect("write");

        let parsed = parse_skill_manifest(&path).expect("parse");
        assert_eq!(parsed.name.as_deref(), Some("pdf"));
        assert_eq!(parsed.description.as_deref(), Some("PDF skill"));
    }

    #[test]
    fn normalize_display_path_strips_windows_extended_prefix() {
        if cfg!(windows) {
            assert_eq!(
                normalize_display_path(r"\\?\D:\Temp\mdpad-tests"),
                r"D:\Temp\mdpad-tests"
            );
            assert_eq!(
                normalize_workspace_key(r"\\?\D:\Temp\mdpad-tests"),
                normalize_workspace_key(r"D:\Temp\mdpad-tests")
            );
        } else {
            assert_eq!(normalize_display_path("/tmp/demo"), "/tmp/demo");
        }
    }

    #[test]
    fn copy_skill_source_skips_git_directory() {
        let temp = TempDir::new("copy-src");
        let source = temp.path.join("source");
        let target = temp.path.join("target");
        fs::create_dir_all(source.join(".git")).expect("git dir");
        fs::write(source.join("SKILL.md"), "# Demo").expect("skill");
        fs::write(source.join(".git").join("config"), "x").expect("config");

        copy_skill_source(&source, &target).expect("copy");

        assert!(target.join("SKILL.md").exists());
        assert!(!target.join(".git").exists());
    }

    #[test]
    fn dedupe_discovery_locations_collapses_exact_duplicates() {
        let location = SkillDiscoveryLocation {
            scope: SkillDiscoveryScope::Workspace,
            container_kind: SkillDiscoveryContainerKind::Codex,
            container_path: "D:/repo/.codex/skills".to_string(),
            skill_path: "D:/repo/.codex/skills/demo".to_string(),
            workspace_id: Some("repo".to_string()),
            workspace_label: Some("D:/repo".to_string()),
        };

        let deduped = dedupe_discovery_locations(&[location.clone(), location]);

        assert_eq!(deduped.len(), 1);
    }

    #[test]
    fn build_discovered_source_key_uses_canonical_skill_root() {
        let temp = TempDir::new("discovered-key");
        let source = temp.path.join("source");
        fs::create_dir_all(&source).expect("source dir");
        fs::write(source.join("SKILL.md"), "# Demo").expect("skill");

        let key = build_discovered_source_key(&source).expect("source key");
        let canonical = canonicalize_source_path(&source).expect("canonical");

        assert_eq!(
            key,
            format!(
                "discovered:{}",
                canonical.to_string_lossy().replace('\\', "/")
            )
        );
    }
}
