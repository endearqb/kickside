use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{anyhow, Context};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::skill_center;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentRuntime {
    KimiCode,
    Hermes,
    Other,
}

impl Default for AgentRuntime {
    fn default() -> Self {
        Self::KimiCode
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceSource {
    Harness,
    Manual,
    GridMigration,
}

impl Default for WorkspaceSource {
    fn default() -> Self {
        Self::Manual
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub name: String,
    pub cwd: String,
    #[serde(default)]
    pub harness_id: Option<String>,
    #[serde(default)]
    pub harness_version: Option<String>,
    #[serde(default)]
    pub agent_runtime: AgentRuntime,
    #[serde(default)]
    pub source: WorkspaceSource,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRegisterInput {
    pub name: Option<String>,
    pub cwd: String,
    #[serde(default)]
    pub harness_id: Option<String>,
    #[serde(default)]
    pub harness_version: Option<String>,
    #[serde(default)]
    pub agent_runtime: AgentRuntime,
    #[serde(default)]
    pub source: WorkspaceSource,
    #[serde(default)]
    pub tags: Vec<String>,
}

pub fn list(app: &AppHandle) -> anyhow::Result<Vec<WorkspaceRecord>> {
    let path = store_file(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&path)
        .with_context(|| format!("failed to read workspace registry: {}", path.display()))?;
    let mut records: Vec<WorkspaceRecord> = serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse workspace registry: {}", path.display()))?;
    records.sort_by(|left, right| {
        right
            .last_opened_at
            .cmp(&left.last_opened_at)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(records)
}

pub fn register(app: &AppHandle, input: WorkspaceRegisterInput) -> anyhow::Result<WorkspaceRecord> {
    let cwd = normalize_cwd(&input.cwd)?;
    let now = Utc::now().to_rfc3339();
    let mut records = list(app)?;
    let key = workspace_key(&cwd);
    let display_name = input
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| fallback_workspace_name(&cwd));

    let record = if let Some(existing) = records
        .iter_mut()
        .find(|record| workspace_key(&record.cwd) == key)
    {
        existing.name = display_name;
        existing.cwd = cwd.clone();
        existing.harness_id = input.harness_id;
        existing.harness_version = input.harness_version;
        existing.agent_runtime = input.agent_runtime;
        existing.source = input.source;
        existing.tags = input.tags;
        existing.updated_at = now;
        existing.clone()
    } else {
        let record = WorkspaceRecord {
            id: format!("ws_{}", Utc::now().timestamp_millis()),
            name: display_name,
            cwd: cwd.clone(),
            harness_id: input.harness_id,
            harness_version: input.harness_version,
            agent_runtime: input.agent_runtime,
            source: input.source,
            tags: input.tags,
            created_at: now.clone(),
            updated_at: now,
            last_opened_at: None,
        };
        records.push(record.clone());
        record
    };

    save(app, &records)?;
    let _ = skill_center::track_workspace_root(app, Path::new(&record.cwd));
    Ok(record)
}

pub fn find(app: &AppHandle, id: &str) -> anyhow::Result<WorkspaceRecord> {
    list(app)?
        .into_iter()
        .find(|record| record.id == id)
        .ok_or_else(|| anyhow!("workspace not found: {id}"))
}

fn mark_opened_inner(app: &AppHandle, id: &str) -> anyhow::Result<WorkspaceRecord> {
    let mut records = list(app)?;
    let now = Utc::now().to_rfc3339();
    let record = records
        .iter_mut()
        .find(|record| record.id == id)
        .ok_or_else(|| anyhow!("workspace not found: {id}"))?;
    record.last_opened_at = Some(now.clone());
    record.updated_at = now;
    let out = record.clone();
    save(app, &records)?;
    let _ = skill_center::track_workspace_root(app, Path::new(&out.cwd));
    Ok(out)
}

fn remove_inner(app: &AppHandle, id: &str, remove_files: bool) -> anyhow::Result<()> {
    let mut records = list(app)?;
    let Some(index) = records.iter().position(|record| record.id == id) else {
        return Ok(());
    };
    let record = records.remove(index);
    save(app, &records)?;

    if remove_files {
        let path = PathBuf::from(&record.cwd);
        if path.exists() {
            fs::remove_dir_all(&path)
                .with_context(|| format!("failed to remove workspace files: {}", path.display()))?;
        }
    }
    Ok(())
}

fn save(app: &AppHandle, records: &[WorkspaceRecord]) -> anyhow::Result<()> {
    let path = store_file(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create workspace registry dir: {}",
                parent.display()
            )
        })?;
    }
    fs::write(&path, serde_json::to_string_pretty(records)?)
        .with_context(|| format!("failed to write workspace registry: {}", path.display()))
}

fn store_file(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .context("failed to resolve app data dir")?
        .join("workspaces")
        .join("workspaces.json"))
}

fn normalize_cwd(raw: &str) -> anyhow::Result<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("workspace cwd is required"));
    }
    let path = PathBuf::from(trimmed);
    let normalized = fs::canonicalize(&path).unwrap_or(path);
    Ok(normalized.to_string_lossy().replace('\\', "/"))
}

fn workspace_key(cwd: &str) -> String {
    let normalized = cwd.trim().replace('\\', "/");
    if cfg!(windows) {
        normalized.to_ascii_lowercase()
    } else {
        normalized
    }
}

fn fallback_workspace_name(cwd: &str) -> String {
    Path::new(cwd)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("未命名工作区")
        .to_string()
}

#[tauri::command]
pub fn workspace_list(app: AppHandle) -> Result<Vec<WorkspaceRecord>, String> {
    list(&app).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn workspace_register(
    app: AppHandle,
    input: WorkspaceRegisterInput,
) -> Result<WorkspaceRecord, String> {
    register(&app, input).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn workspace_register_many(
    app: AppHandle,
    inputs: Vec<WorkspaceRegisterInput>,
) -> Result<Vec<WorkspaceRecord>, String> {
    inputs
        .into_iter()
        .map(|input| register(&app, input).map_err(|error| format!("{error:#}")))
        .collect()
}

#[tauri::command]
pub fn workspace_mark_opened(app: AppHandle, id: String) -> Result<WorkspaceRecord, String> {
    mark_opened_inner(&app, &id).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn workspace_remove(
    app: AppHandle,
    id: String,
    remove_files: Option<bool>,
) -> Result<(), String> {
    remove_inner(&app, &id, remove_files.unwrap_or(false)).map_err(|error| format!("{error:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_key_is_case_insensitive_on_windows() {
        let left = workspace_key("D:\\Repo");
        let right = workspace_key("D:/repo");
        if cfg!(windows) {
            assert_eq!(left, right);
        } else {
            assert_ne!(left, right);
        }
    }

    #[test]
    fn fallback_name_uses_last_path_segment() {
        assert_eq!(fallback_workspace_name("D:/workspaces/demo"), "demo");
    }
}
