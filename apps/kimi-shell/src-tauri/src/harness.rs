use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use anyhow::{anyhow, bail, Context};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::types::{SkillFileContent, SkillFileEntry};
use crate::workspaces::{
    self, AgentRuntime, WorkspaceRecord, WorkspaceRegisterInput, WorkspaceSource,
};

const SUPPORTED_SCHEMA_VERSION: u32 = 1;
const TEXT_EXTS: &[&str] = &[
    "md",
    "json",
    "jsonc",
    "yaml",
    "yml",
    "toml",
    "txt",
    "example",
    "env",
    "gitignore",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HarnessVarType {
    String,
    Path,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessVariable {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub var_type: HarnessVarType,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub secret: bool,
    #[serde(default)]
    pub placeholder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HarnessSkill {
    pub id: String,
    pub source: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessPostCreate {
    #[serde(default)]
    pub open_with: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub summary: String,
    #[serde(default)]
    pub agent_runtime: AgentRuntime,
    pub version: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub skills: Vec<HarnessSkill>,
    #[serde(default)]
    pub variables: Vec<HarnessVariable>,
    #[serde(default = "default_template")]
    pub template: String,
    #[serde(default)]
    pub post_create: HarnessPostCreate,
    #[serde(skip)]
    root_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedFile {
    pub rel_path: String,
    pub is_dir: bool,
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessDryRunResult {
    pub files: Vec<PlannedFile>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedWorkspace {
    pub workspace: WorkspaceRecord,
    pub file_count: usize,
}

fn default_template() -> String {
    "./template".to_string()
}

pub fn list_manifests(app: &AppHandle) -> anyhow::Result<Vec<HarnessManifest>> {
    let root = harnesses_dir(app)?;
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut manifests = Vec::new();
    for entry in
        fs::read_dir(&root).with_context(|| format!("failed to read {}", root.display()))?
    {
        let entry = entry?;
        if entry.file_type()?.is_dir() && entry.path().join("harness.json").is_file() {
            manifests.push(load_manifest(&entry.path())?);
        }
    }
    manifests.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(manifests)
}

fn find_manifest(app: &AppHandle, harness_id: &str) -> anyhow::Result<HarnessManifest> {
    list_manifests(app)?
        .into_iter()
        .find(|manifest| manifest.id == harness_id)
        .ok_or_else(|| anyhow!("harness not found: {harness_id}"))
}

fn load_manifest(harness_dir: &Path) -> anyhow::Result<HarnessManifest> {
    let path = harness_dir.join("harness.json");
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("failed to read harness manifest: {}", path.display()))?;
    let mut manifest: HarnessManifest = serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse harness manifest: {}", path.display()))?;
    if manifest.schema_version != SUPPORTED_SCHEMA_VERSION {
        bail!(
            "unsupported harness schemaVersion {} in {}",
            manifest.schema_version,
            path.display()
        );
    }
    manifest.root_dir = harness_dir.to_path_buf();
    Ok(manifest)
}

fn harnesses_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("harnesses");
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("harnesses"))
}

fn template_dir(manifest: &HarnessManifest) -> PathBuf {
    manifest
        .root_dir
        .join(manifest.template.trim_start_matches("./"))
}

pub fn dry_run(
    app: &AppHandle,
    harness_id: &str,
    values: &HashMap<String, String>,
) -> anyhow::Result<HarnessDryRunResult> {
    let manifest = find_manifest(app, harness_id)?;
    let warnings = validate_values(&manifest, values, false)?;
    let template_dir = template_dir(&manifest);
    if !template_dir.exists() {
        bail!(
            "template directory does not exist: {}",
            template_dir.display()
        );
    }

    let map = interpolation_map(&manifest, values);
    let mut entries = Vec::new();
    collect_entries(&template_dir, &template_dir, &mut entries)?;
    entries.sort_by(|left, right| left.0.cmp(&right.0));

    let mut files = Vec::new();
    for (rel, is_dir) in entries {
        let rel_path = rel_to_string(&rel, is_dir);
        let preview = if is_dir {
            None
        } else {
            let source = template_dir.join(&rel);
            if is_text_file(&source) {
                let content = fs::read_to_string(&source).unwrap_or_default();
                Some(interpolate(&content, &map).chars().take(800).collect())
            } else {
                None
            }
        };
        files.push(PlannedFile {
            rel_path,
            is_dir,
            preview,
        });
    }

    Ok(HarnessDryRunResult { files, warnings })
}

pub fn create(
    app: &AppHandle,
    harness_id: &str,
    values: &HashMap<String, String>,
) -> anyhow::Result<CreatedWorkspace> {
    let manifest = find_manifest(app, harness_id)?;
    validate_values(&manifest, values, true)?;
    let template_dir = template_dir(&manifest);
    if !template_dir.exists() {
        bail!(
            "template directory does not exist: {}",
            template_dir.display()
        );
    }

    let work_dir = values
        .get("workDir")
        .map(String::as_str)
        .ok_or_else(|| anyhow!("workDir is required"))?;
    let dest = PathBuf::from(work_dir.trim());
    if dest.exists()
        && fs::read_dir(&dest)
            .map(|mut iter| iter.next().is_some())
            .unwrap_or(false)
    {
        bail!(
            "target directory exists and is not empty: {}",
            dest.display()
        );
    }

    let map = interpolation_map(&manifest, values);
    let mut entries = Vec::new();
    collect_entries(&template_dir, &template_dir, &mut entries)?;
    entries.sort_by(|left, right| left.0.cmp(&right.0));

    fs::create_dir_all(&dest).with_context(|| format!("failed to create {}", dest.display()))?;
    let mut file_count = 0usize;
    for (rel, is_dir) in entries {
        let target = dest.join(&rel);
        if is_dir {
            fs::create_dir_all(&target)
                .with_context(|| format!("failed to create {}", target.display()))?;
            continue;
        }

        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        let source = template_dir.join(&rel);
        if is_text_file(&source) {
            let content = fs::read_to_string(&source)
                .with_context(|| format!("failed to read {}", source.display()))?;
            fs::write(&target, interpolate(&content, &map))
                .with_context(|| format!("failed to write {}", target.display()))?;
        } else {
            fs::copy(&source, &target)
                .with_context(|| format!("failed to copy {}", source.display()))?;
        }
        file_count += 1;
    }

    let workspace = workspaces::register(
        app,
        WorkspaceRegisterInput {
            name: values
                .get("workspaceName")
                .cloned()
                .or_else(|| Some(manifest.name.clone())),
            cwd: dest.to_string_lossy().to_string(),
            harness_id: Some(manifest.id),
            harness_version: Some(manifest.version),
            agent_runtime: manifest.agent_runtime,
            source: WorkspaceSource::Harness,
            tags: manifest.tags,
        },
    )?;

    Ok(CreatedWorkspace {
        workspace,
        file_count,
    })
}

pub fn list_file_entries(app: &AppHandle, harness_id: &str) -> anyhow::Result<Vec<SkillFileEntry>> {
    let manifest = find_manifest(app, harness_id)?;
    crate::skill_center::list_safe_file_entries(&template_dir(&manifest))
}

pub fn read_file(
    app: &AppHandle,
    harness_id: &str,
    rel_path: &str,
) -> anyhow::Result<SkillFileContent> {
    let manifest = find_manifest(app, harness_id)?;
    crate::skill_center::read_safe_file(&template_dir(&manifest), rel_path)
}

fn validate_values(
    manifest: &HarnessManifest,
    values: &HashMap<String, String>,
    strict_unknowns: bool,
) -> anyhow::Result<Vec<String>> {
    let declared: HashSet<&str> = manifest
        .variables
        .iter()
        .map(|variable| variable.key.as_str())
        .collect();
    let mut warnings = Vec::new();

    for variable in &manifest.variables {
        let value = values
            .get(&variable.key)
            .map(String::as_str)
            .unwrap_or("")
            .trim();
        if variable.required && value.is_empty() {
            bail!("missing required value: {}", variable.label);
        }
        if variable.var_type == HarnessVarType::Path && !value.is_empty() {
            let path = PathBuf::from(value);
            if path.as_os_str().is_empty() {
                bail!("invalid path value: {}", variable.label);
            }
        }
    }

    for key in values.keys() {
        if !declared.contains(key.as_str()) {
            let warning = format!("undeclared harness value ignored: {key}");
            if strict_unknowns {
                bail!("{warning}");
            }
            warnings.push(warning);
        }
    }

    Ok(warnings)
}

fn interpolation_map(
    manifest: &HarnessManifest,
    values: &HashMap<String, String>,
) -> HashMap<String, String> {
    let secret_keys: HashSet<&str> = manifest
        .variables
        .iter()
        .filter(|variable| variable.secret)
        .map(|variable| variable.key.as_str())
        .collect();
    values
        .iter()
        .filter(|(key, _)| !secret_keys.contains(key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn interpolate(input: &str, values: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find("{{") {
        let (before, after_start) = rest.split_at(start);
        out.push_str(before);
        let after_start = &after_start[2..];
        let Some(end) = after_start.find("}}") else {
            out.push_str("{{");
            out.push_str(after_start);
            return out;
        };
        let raw_key = after_start[..end].trim().trim_start_matches("var.").trim();
        if let Some(value) = values.get(raw_key) {
            out.push_str(value);
        } else {
            out.push_str("{{");
            out.push_str(&after_start[..end]);
            out.push_str("}}");
        }
        rest = &after_start[end + 2..];
    }
    out.push_str(rest);
    out
}

fn collect_entries(dir: &Path, base: &Path, out: &mut Vec<(PathBuf, bool)>) -> anyhow::Result<()> {
    for entry in fs::read_dir(dir).with_context(|| format!("failed to read {}", dir.display()))? {
        let entry = entry?;
        let path = entry.path();
        let is_dir = entry.file_type()?.is_dir();
        let rel = path
            .strip_prefix(base)
            .context("failed to compute relative template path")?
            .to_path_buf();
        out.push((rel, is_dir));
        if is_dir {
            collect_entries(&path, base, out)?;
        }
    }
    Ok(())
}

fn rel_to_string(rel: &Path, is_dir: bool) -> String {
    let mut value = rel
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/");
    if is_dir {
        value.push('/');
    }
    value
}

fn is_text_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|ext| TEXT_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(true)
}

#[tauri::command]
pub fn harness_list(app: AppHandle) -> Result<Vec<HarnessManifest>, String> {
    list_manifests(&app).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn harness_get(app: AppHandle, harness_id: String) -> Result<HarnessManifest, String> {
    find_manifest(&app, &harness_id).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn harness_dry_run(
    app: AppHandle,
    harness_id: String,
    values: HashMap<String, String>,
) -> Result<HarnessDryRunResult, String> {
    dry_run(&app, &harness_id, &values).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn list_harness_file_entries(
    app: AppHandle,
    harness_id: String,
) -> Result<Vec<SkillFileEntry>, String> {
    list_file_entries(&app, &harness_id).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn read_harness_file(
    app: AppHandle,
    harness_id: String,
    rel_path: String,
) -> Result<SkillFileContent, String> {
    read_file(&app, &harness_id, &rel_path).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn harness_create(
    app: AppHandle,
    harness_id: String,
    values: HashMap<String, String>,
) -> Result<CreatedWorkspace, String> {
    create(&app, &harness_id, &values).map_err(|error| format!("{error:#}"))
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
            let path = std::env::temp_dir().join(format!("kimi-harness-{name}-{unique}"));
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
    fn interpolate_supports_var_prefix_and_keeps_unknowns() {
        let values = HashMap::from([("workspaceName".to_string(), "Demo".to_string())]);
        assert_eq!(interpolate("{{ var.workspaceName }}", &values), "Demo");
        assert_eq!(interpolate("{{missing}}", &values), "{{missing}}");
    }

    #[test]
    fn secret_values_are_not_interpolated() {
        let manifest = HarnessManifest {
            schema_version: 1,
            id: "x".into(),
            name: "x".into(),
            summary: "x".into(),
            agent_runtime: AgentRuntime::KimiCode,
            version: "1.0.0".into(),
            tags: vec![],
            skills: vec![],
            variables: vec![HarnessVariable {
                key: "secret".into(),
                label: "Secret".into(),
                var_type: HarnessVarType::String,
                required: false,
                secret: true,
                placeholder: None,
            }],
            template: "./template".into(),
            post_create: HarnessPostCreate::default(),
            root_dir: PathBuf::new(),
        };
        let map = interpolation_map(
            &manifest,
            &HashMap::from([("secret".into(), "value".into())]),
        );
        assert!(!map.contains_key("secret"));
    }

    #[test]
    fn harness_template_preview_lists_and_reads_readme() {
        let temp = TempDir::new("preview-readme");
        let template = temp.path.join("template");
        fs::create_dir_all(&template).expect("template dir");
        fs::write(template.join("README.md"), "# Harness").expect("readme");

        let entries = crate::skill_center::list_safe_file_entries(&template).expect("entries");
        assert_eq!(entries[0].rel_path, "README.md");

        let content = crate::skill_center::read_safe_file(&template, "README.md").expect("read");
        assert_eq!(content.text.as_deref(), Some("# Harness"));
    }

    #[test]
    fn harness_template_preview_rejects_traversal() {
        let temp = TempDir::new("preview-traversal");
        let template = temp.path.join("template");
        fs::create_dir_all(&template).expect("template dir");
        fs::write(temp.path.join("secret.txt"), "secret").expect("outside file");

        let error =
            crate::skill_center::read_safe_file(&template, "../secret.txt").expect_err("rejected");
        assert!(error.to_string().contains("within the skill root"));
    }
}
