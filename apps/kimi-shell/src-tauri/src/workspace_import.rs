use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use tauri::{AppHandle, Manager};

use crate::{
    app_state::AppState,
    log_manager, settings_store, skill_center, skill_center_store,
    types::{
        WorkspaceImportRequestPayload, WorkspaceImportResult, WorkspaceImportTarget,
        WorkspaceImportTargetInput, WorkspaceImportTargetKind,
    },
    window_manager,
};

#[derive(Debug, Clone)]
struct PendingWorkspaceImportRequest {
    request_id: String,
    source: String,
    item_paths: Vec<PathBuf>,
}

fn pending_requests() -> &'static Mutex<VecDeque<PendingWorkspaceImportRequest>> {
    static PENDING: OnceLock<Mutex<VecDeque<PendingWorkspaceImportRequest>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(VecDeque::new()))
}

pub fn get_active_workspace_import_request() -> Option<WorkspaceImportRequestPayload> {
    let lock = pending_requests().lock().ok()?;
    let request = lock.front()?;
    Some(WorkspaceImportRequestPayload {
        request_id: request.request_id.clone(),
        source: request.source.clone(),
        item_count: request.item_paths.len(),
        item_paths: request
            .item_paths
            .iter()
            .map(|path| skill_center_store::path_to_display_string(path))
            .collect(),
    })
}

pub fn list_workspace_import_targets(
    app: &AppHandle,
) -> anyhow::Result<Vec<WorkspaceImportTarget>> {
    let settings = settings_store::load_or_default(app)?;
    let current_path = {
        let state = app.state::<AppState>();
        let runtime = state
            .runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
        runtime
            .active_session_work_dir
            .clone()
            .or_else(|| runtime.effective_work_dir.clone())
    };

    let mut seen = HashMap::<String, usize>::new();
    let mut targets = Vec::<WorkspaceImportTarget>::new();

    if let Some(path) = current_path.as_deref() {
        push_workspace_target(
            &mut targets,
            &mut seen,
            path,
            "当前工作区",
            WorkspaceImportTargetKind::Current,
            true,
            false,
        );
    }

    if let Some(path) = settings
        .work_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        push_workspace_target(
            &mut targets,
            &mut seen,
            &path,
            "默认工作区",
            WorkspaceImportTargetKind::Default,
            false,
            true,
        );
    }

    for root in skill_center::list_skill_discovery_workspaces(app)? {
        let path = PathBuf::from(root.path.trim());
        let label = root.label.trim();
        if label.is_empty() {
            push_workspace_target(
                &mut targets,
                &mut seen,
                &path,
                &skill_center_store::path_to_display_string(&path),
                WorkspaceImportTargetKind::Known,
                false,
                false,
            );
        } else {
            push_workspace_target(
                &mut targets,
                &mut seen,
                &path,
                label,
                WorkspaceImportTargetKind::Known,
                false,
                false,
            );
        }
    }

    Ok(targets)
}

pub fn import_items_to_default_workspace(
    app: &AppHandle,
    items: Vec<PathBuf>,
    source: &str,
) -> Result<WorkspaceImportResult, String> {
    let normalized_items = normalize_import_items(items)?;
    let settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    let target_root = settings
        .work_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "默认工作区未配置，请先在控制中心设置工作目录。".to_string())?;
    ensure_workspace_target_available(&target_root, true)?;

    let request_id = format!(
        "workspace-import-default-{}",
        crate::app_state::unix_time_millis()
    );
    let result = execute_import(
        app,
        &request_id,
        source,
        &normalized_items,
        &target_root,
        "默认工作区",
    )?;
    window_manager::publish_workspace_import_result(app, &result, source);
    Ok(result)
}

pub fn queue_workspace_picker_import_request(
    app: &AppHandle,
    items: Vec<PathBuf>,
    source: &str,
) -> Result<(), String> {
    let normalized_items = normalize_import_items(items)?;
    let request = PendingWorkspaceImportRequest {
        request_id: format!(
            "workspace-import-picker-{}",
            crate::app_state::unix_time_millis()
        ),
        source: source.trim().to_string(),
        item_paths: normalized_items,
    };

    let should_publish = {
        let lock = pending_requests().lock();
        let Ok(mut pending) = lock else {
            return Err("workspace import picker queue mutex is poisoned".to_string());
        };
        let should_publish = pending.is_empty();
        pending.push_back(request.clone());
        should_publish
    };

    log_manager::append_line(
        app,
        format!(
            "queued workspace import picker request (source={}, request_id={}, item_count={})",
            request.source,
            request.request_id,
            request.item_paths.len()
        ),
    );

    if should_publish {
        publish_pending_picker_request(app, source);
    }

    Ok(())
}

pub fn complete_workspace_import_request(
    app: &AppHandle,
    request_id: &str,
    input: &WorkspaceImportTargetInput,
) -> Result<WorkspaceImportResult, String> {
    let request_id = request_id.trim();
    if request_id.is_empty() {
        return Err("workspace import request id is empty".to_string());
    }

    let target_root = PathBuf::from(input.root_path.trim());
    ensure_workspace_target_available(&target_root, false)?;
    let target_label = input
        .label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| input.root_path.trim());

    let request = {
        let lock = pending_requests().lock();
        let Ok(pending) = lock else {
            return Err("workspace import picker queue mutex is poisoned".to_string());
        };
        pending
            .iter()
            .find(|entry| entry.request_id == request_id)
            .cloned()
            .ok_or_else(|| format!("workspace import request not found: {request_id}"))?
    };

    let result = execute_import(
        app,
        request_id,
        &request.source,
        &request.item_paths,
        &target_root,
        target_label,
    )?;

    let next_to_publish = {
        let lock = pending_requests().lock();
        let Ok(mut pending) = lock else {
            return Err("workspace import picker queue mutex is poisoned".to_string());
        };
        let removed_front = pending
            .front()
            .is_some_and(|entry| entry.request_id == request_id);
        if let Some(index) = pending
            .iter()
            .position(|entry| entry.request_id == request_id)
        {
            pending.remove(index);
        }
        if removed_front {
            pending.front().cloned()
        } else {
            None
        }
    };

    window_manager::publish_workspace_import_result(app, &result, &request.source);
    if next_to_publish.is_some() {
        publish_pending_picker_request(app, "workspace_import_complete");
    } else {
        window_manager::hide_workspace_import_picker_window(app, "workspace_import_complete");
    }

    Ok(result)
}

pub fn cancel_workspace_import_request(app: &AppHandle, request_id: &str) -> Result<(), String> {
    let request_id = request_id.trim();
    if request_id.is_empty() {
        return Ok(());
    }

    let next_to_publish = {
        let lock = pending_requests().lock();
        let Ok(mut pending) = lock else {
            return Err("workspace import picker queue mutex is poisoned".to_string());
        };
        let removed_front = pending
            .front()
            .is_some_and(|entry| entry.request_id == request_id);
        if let Some(index) = pending
            .iter()
            .position(|entry| entry.request_id == request_id)
        {
            pending.remove(index);
        }
        if removed_front {
            pending.front().cloned()
        } else {
            None
        }
    };

    log_manager::append_line(
        app,
        format!("canceled workspace import picker request (request_id={request_id})"),
    );

    if next_to_publish.is_some() {
        publish_pending_picker_request(app, "workspace_import_cancel");
    } else {
        window_manager::hide_workspace_import_picker_window(app, "workspace_import_cancel");
    }

    Ok(())
}

pub fn cancel_active_workspace_import_request(app: &AppHandle, source: &str) -> Result<(), String> {
    let active_request_id = {
        let lock = pending_requests().lock();
        let Ok(pending) = lock else {
            return Err("workspace import picker queue mutex is poisoned".to_string());
        };
        pending.front().map(|entry| entry.request_id.clone())
    };

    if let Some(request_id) = active_request_id {
        cancel_workspace_import_request(app, &request_id)
    } else {
        log_manager::append_line(
            app,
            format!(
                "workspace import picker close requested with no active request (source={source})"
            ),
        );
        window_manager::hide_workspace_import_picker_window(app, source);
        Ok(())
    }
}

fn push_workspace_target(
    targets: &mut Vec<WorkspaceImportTarget>,
    seen: &mut HashMap<String, usize>,
    path: &Path,
    label: &str,
    kind: WorkspaceImportTargetKind,
    is_current: bool,
    is_default: bool,
) {
    let Ok(display_path) = normalize_target_root(path) else {
        return;
    };
    if !is_workspace_target_writable(&display_path) {
        return;
    }

    let key = skill_center_store::normalize_workspace_key(&display_path.to_string_lossy());
    if let Some(index) = seen.get(&key).copied() {
        let existing = &mut targets[index];
        existing.is_current |= is_current;
        existing.is_default |= is_default;
        if is_current {
            existing.kind = WorkspaceImportTargetKind::Current;
            existing.label = "当前工作区".to_string();
        } else if is_default && existing.kind != WorkspaceImportTargetKind::Current {
            existing.kind = WorkspaceImportTargetKind::Default;
            existing.label = "默认工作区".to_string();
        }
        return;
    }

    let display = skill_center_store::path_to_display_string(&display_path);
    let next = WorkspaceImportTarget {
        id: match kind {
            WorkspaceImportTargetKind::Current => "current_workspace".to_string(),
            WorkspaceImportTargetKind::Default => "default_workspace".to_string(),
            WorkspaceImportTargetKind::Known => format!("known:{}", key),
        },
        label: label.trim().to_string(),
        root_path: display,
        kind,
        is_current,
        is_default,
    };
    seen.insert(key, targets.len());
    targets.push(next);
}

fn publish_pending_picker_request(app: &AppHandle, source: &str) {
    let Some(payload) = get_active_workspace_import_request() else {
        return;
    };

    window_manager::publish_workspace_import_request(app, &payload, source);
}

fn normalize_import_items(items: Vec<PathBuf>) -> Result<Vec<PathBuf>, String> {
    if items.is_empty() {
        return Err("workspace import received no items".to_string());
    }

    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for path in items {
        let normalized = normalize_existing_import_path(&path)?;
        let key = skill_center_store::normalize_workspace_key(&normalized.to_string_lossy());
        if seen.insert(key) {
            deduped.push(normalized);
        }
    }

    if deduped.is_empty() {
        return Err("workspace import received no usable items".to_string());
    }

    Ok(deduped)
}

fn normalize_existing_import_path(path: &Path) -> Result<PathBuf, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("cannot access import path `{}`: {error}", path.display()))?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(format!(
            "import path is neither file nor directory: {}",
            path.display()
        ));
    }
    normalize_target_root(path).map_err(|error| {
        format!(
            "failed to normalize import path `{}`: {error}",
            path.display()
        )
    })
}

fn normalize_target_root(path: &Path) -> anyhow::Result<PathBuf> {
    skill_center_store::canonicalize_source_path(path).or_else(|_| {
        Ok(PathBuf::from(skill_center_store::normalize_display_path(
            &path.to_string_lossy(),
        )))
    })
}

fn is_workspace_target_writable(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    metadata.is_dir() && !metadata.permissions().readonly()
}

fn ensure_workspace_target_available(path: &Path, is_default: bool) -> Result<PathBuf, String> {
    let normalized = normalize_target_root(path).map_err(|error| error.to_string())?;
    let metadata = fs::metadata(&normalized).map_err(|error| {
        if is_default {
            format!(
                "默认工作区不可用：无法访问 `{}` ({error})，请先在控制中心更新工作目录。",
                normalized.display()
            )
        } else {
            format!("无法访问目标工作区 `{}`: {error}", normalized.display())
        }
    })?;
    if !metadata.is_dir() {
        return Err(if is_default {
            format!(
                "默认工作区不是目录：{}，请先在控制中心修正工作目录。",
                normalized.display()
            )
        } else {
            format!("目标工作区不是目录：{}", normalized.display())
        });
    }
    if metadata.permissions().readonly() {
        return Err(format!("目标工作区不可写：{}", normalized.display()));
    }
    Ok(normalized)
}

fn execute_import(
    app: &AppHandle,
    request_id: &str,
    source: &str,
    items: &[PathBuf],
    target_root: &Path,
    target_label: &str,
) -> Result<WorkspaceImportResult, String> {
    let target_root = ensure_workspace_target_available(target_root, false)?;
    let current_workspace_match = matches_current_workspace(app, &target_root);
    let mut imported_names = Vec::new();

    for item in items {
        let file_name = item
            .file_name()
            .ok_or_else(|| format!("cannot determine item name for `{}`", item.display()))?
            .to_string_lossy()
            .to_string();
        let destination = next_available_destination(&target_root, &file_name)?;
        copy_import_item(item, &destination, &target_root)?;
        imported_names.push(file_name);
    }

    let result = WorkspaceImportResult {
        request_id: request_id.to_string(),
        source: source.trim().to_string(),
        target_path: skill_center_store::path_to_display_string(&target_root),
        target_label: target_label.trim().to_string(),
        imported_count: imported_names.len(),
        imported_names,
        current_workspace_match,
    };

    log_manager::append_line(
        app,
        format!(
            "workspace import completed (source={}, request_id={}, target={}, imported_count={})",
            result.source, result.request_id, result.target_path, result.imported_count
        ),
    );

    Ok(result)
}

fn matches_current_workspace(app: &AppHandle, target_root: &Path) -> bool {
    let state = app.state::<AppState>();
    let Ok(runtime) = state.runtime.lock() else {
        return false;
    };
    let current = runtime
        .active_session_work_dir
        .as_deref()
        .or(runtime.effective_work_dir.as_deref());
    let Some(current) = current else {
        return false;
    };
    let Ok(current) = normalize_target_root(current) else {
        return false;
    };
    skill_center_store::normalize_workspace_key(&current.to_string_lossy())
        == skill_center_store::normalize_workspace_key(&target_root.to_string_lossy())
}

fn next_available_destination(target_root: &Path, name: &str) -> Result<PathBuf, String> {
    let initial = target_root.join(name);
    if !initial.exists() {
        return Ok(initial);
    }

    let (stem, ext) = split_name(name);
    for index in 2..=9_999 {
        let candidate_name = if ext.is_empty() {
            format!("{stem} ({index})")
        } else {
            format!("{stem} ({index}).{ext}")
        };
        let candidate = target_root.join(candidate_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "目标工作区中存在过多同名项目，无法为 `{name}` 生成新名称。"
    ))
}

fn split_name(name: &str) -> (String, String) {
    if let Some(index) = name.rfind('.') {
        if index > 0 && index < name.len() - 1 {
            return (name[..index].to_string(), name[index + 1..].to_string());
        }
    }
    (name.to_string(), String::new())
}

fn copy_import_item(source: &Path, destination: &Path, target_root: &Path) -> Result<(), String> {
    let metadata = fs::metadata(source)
        .map_err(|error| format!("cannot stat import source `{}`: {error}", source.display()))?;
    if metadata.is_file() {
        fs::copy(source, destination).map_err(|error| {
            format!(
                "failed to copy `{}` to `{}`: {error}",
                source.display(),
                destination.display()
            )
        })?;
        return Ok(());
    }

    if !metadata.is_dir() {
        return Err(format!(
            "import source is neither file nor directory: {}",
            source.display()
        ));
    }

    let normalized_source = normalize_target_root(source).map_err(|error| error.to_string())?;
    if target_root.starts_with(&normalized_source) {
        return Err(format!(
            "cannot import folder `{}` into a workspace nested inside that folder",
            source.display()
        ));
    }

    copy_directory_recursive(source, destination)
}

fn copy_directory_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "failed to create destination directory `{}`: {error}",
            destination.display()
        )
    })?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("failed to read directory `{}`: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| {
            format!(
                "failed to read a directory entry from `{}`: {error}",
                source.display()
            )
        })?;
        let next_source = entry.path();
        let next_destination = destination.join(entry.file_name());
        let metadata = entry
            .metadata()
            .map_err(|error| format!("failed to inspect `{}`: {error}", next_source.display()))?;
        if metadata.is_dir() {
            copy_directory_recursive(&next_source, &next_destination)?;
        } else if metadata.is_file() {
            fs::copy(&next_source, &next_destination).map_err(|error| {
                format!(
                    "failed to copy `{}` to `{}`: {error}",
                    next_source.display(),
                    next_destination.display()
                )
            })?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn random_code() -> String {
        format!("{:06x}", rand::random::<u32>() & 0x00ff_ffff)
    }

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(prefix: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "kimi-shell-workspace-import-{prefix}-{}",
                random_code()
            ));
            fs::create_dir_all(&path).expect("failed to create temp dir");
            Self { path }
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn next_available_destination_adds_suffix() {
        let temp = TempDirGuard::new("suffix");
        fs::write(temp.path.join("note.md"), b"hello").expect("seed file");

        let candidate = next_available_destination(&temp.path, "note.md").expect("candidate path");
        assert_eq!(
            candidate.file_name().and_then(|value| value.to_str()),
            Some("note (2).md")
        );
    }

    #[test]
    fn copy_directory_recursive_copies_nested_files() {
        let temp = TempDirGuard::new("copy-dir");
        let source = temp.path.join("source");
        let target = temp.path.join("target");
        fs::create_dir_all(source.join("nested")).expect("create source");
        fs::write(source.join("root.txt"), b"root").expect("root");
        fs::write(source.join("nested").join("child.txt"), b"child").expect("child");

        copy_directory_recursive(&source, &target).expect("copy directory");

        assert!(target.join("root.txt").is_file());
        assert!(target.join("nested").join("child.txt").is_file());
    }

    #[test]
    fn normalize_import_items_dedupes_case_insensitively() {
        let temp = TempDirGuard::new("dedupe");
        let file = temp.path.join("Note.md");
        fs::write(&file, b"hello").expect("file");

        let result = normalize_import_items(vec![
            file.clone(),
            PathBuf::from(file.to_string_lossy().to_string()),
        ])
        .expect("normalize items");
        assert_eq!(result.len(), 1);
    }
}
