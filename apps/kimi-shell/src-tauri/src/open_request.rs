use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    thread,
    time::Duration,
};

use chrono::Local;
use rand::Rng;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::{app_state::AppState, backend_manager, log_manager, settings_store, window_manager};

const OPEN_FILES_DEBOUNCE_MS: u64 = 350;
const WORKSPACE_STEM_MAX_LEN: usize = 40;
const WORKSPACE_ATTEMPTS: usize = 24;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenRequest {
    OpenDir(PathBuf),
    OpenFiles(Vec<PathBuf>),
}

#[derive(Default)]
struct OpenFilesBatch {
    sequence: u64,
    files: Vec<PathBuf>,
}

static OPEN_FILES_BATCH: OnceLock<Mutex<OpenFilesBatch>> = OnceLock::new();

pub fn apply_startup_cli_request(app: &AppHandle) {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        return;
    }

    let current_dir = std::env::current_dir().ok();
    match parse_open_request(&args, current_dir.as_deref()) {
        Ok(Some(request)) => {
            mark_startup_open_request(app);
            if let Err(error) = apply_open_request(app, request) {
                log_manager::append_line(
                    app,
                    format!("failed to apply startup open request: {error}"),
                );
            }
        }
        Ok(None) => {}
        Err(error) => {
            log_manager::append_line(app, format!("invalid startup arguments: {error}"));
        }
    }
}

fn mark_startup_open_request(app: &AppHandle) {
    let state = app.state::<AppState>();
    if let Ok(mut runtime) = state.runtime.lock() {
        runtime.startup_open_request_applied = true;
    };
}

pub fn handle_external_cli_request(app: AppHandle, args: Vec<String>, cwd: Option<String>) {
    let cwd_path = cwd.as_deref().map(PathBuf::from);
    let parsed = parse_open_request(&args, cwd_path.as_deref());
    match parsed {
        Ok(Some(OpenRequest::OpenDir(path))) => {
            thread::spawn(move || {
                if let Err(error) = apply_open_request(&app, OpenRequest::OpenDir(path)) {
                    log_manager::append_line(
                        &app,
                        format!("failed to apply forwarded directory request: {error}"),
                    );
                }
            });
        }
        Ok(Some(OpenRequest::OpenFiles(files))) => {
            enqueue_open_files_request(app, files);
        }
        Ok(None) => {
            window_manager::show_and_focus(&app);
        }
        Err(error) => {
            log_manager::append_line(&app, format!("invalid forwarded arguments: {error}"));
            window_manager::show_and_focus(&app);
        }
    }
}

fn enqueue_open_files_request(app: AppHandle, files: Vec<PathBuf>) {
    let files = dedupe_paths(files);
    if files.is_empty() {
        window_manager::show_and_focus(&app);
        return;
    }

    let sequence = {
        let batch_state = OPEN_FILES_BATCH.get_or_init(|| Mutex::new(OpenFilesBatch::default()));
        let mut batch = match batch_state.lock() {
            Ok(lock) => lock,
            Err(_) => {
                log_manager::append_line(&app, "open-files batch lock poisoned; dropping request");
                return;
            }
        };

        let existing: HashSet<String> = batch
            .files
            .iter()
            .map(|path| path.to_string_lossy().to_lowercase())
            .collect();
        for path in files {
            let key = path.to_string_lossy().to_lowercase();
            if !existing.contains(&key) {
                batch.files.push(path);
            }
        }
        batch.sequence = batch.sequence.saturating_add(1);
        batch.sequence
    };

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(OPEN_FILES_DEBOUNCE_MS));
        let maybe_files = {
            let batch_state =
                OPEN_FILES_BATCH.get_or_init(|| Mutex::new(OpenFilesBatch::default()));
            let mut batch = match batch_state.lock() {
                Ok(lock) => lock,
                Err(_) => {
                    log_manager::append_line(&app, "open-files batch lock poisoned during flush");
                    return;
                }
            };

            if batch.sequence != sequence {
                return;
            }

            if batch.files.is_empty() {
                return;
            }

            let files = std::mem::take(&mut batch.files);
            batch.sequence = batch.sequence.saturating_add(1);
            Some(files)
        };

        if let Some(files) = maybe_files {
            if let Err(error) = apply_open_request(&app, OpenRequest::OpenFiles(files)) {
                log_manager::append_line(
                    &app,
                    format!("failed to process open-files request: {error}"),
                );
            }
        }
    });
}

fn apply_open_request(app: &AppHandle, request: OpenRequest) -> Result<(), String> {
    match request {
        OpenRequest::OpenDir(path) => apply_open_dir_request(app, path),
        OpenRequest::OpenFiles(files) => apply_open_files_request(app, files),
    }
}

fn apply_open_dir_request(app: &AppHandle, directory: PathBuf) -> Result<(), String> {
    let metadata = fs::metadata(&directory)
        .map_err(|error| format!("cannot access directory `{}`: {error}", directory.display()))?;
    if !metadata.is_dir() {
        return Err(format!("path is not a directory: {}", directory.display()));
    }

    backend_manager::set_session_work_dir(app, Some(directory.clone()))
        .map_err(|error| error.to_string())?;
    log_manager::append_line(
        app,
        format!(
            "received open-dir request, switching session work directory to {}",
            directory.display()
        ),
    );
    backend_manager::restart_backend(app.clone());
    window_manager::show_and_focus(app);
    Ok(())
}

fn apply_open_files_request(app: &AppHandle, files: Vec<PathBuf>) -> Result<(), String> {
    let files = dedupe_paths(files);
    if files.is_empty() {
        return Err("no files received for open-files request".to_string());
    }
    for path in &files {
        let metadata = fs::metadata(path)
            .map_err(|error| format!("cannot access file `{}`: {error}", path.display()))?;
        if !metadata.is_file() {
            return Err(format!("path is not a file: {}", path.display()));
        }
    }

    let workspace_root = resolve_workspace_root(app)?;
    let workspace_dir = create_workspace_dir(&workspace_root, &files)?;
    copy_files_to_workspace(&files, &workspace_dir)?;
    write_sources_manifest(&files, &workspace_dir)?;

    backend_manager::set_session_work_dir(app, Some(workspace_dir.clone()))
        .map_err(|error| error.to_string())?;

    log_manager::append_line(
        app,
        format!(
            "received open-files request with {} file(s), workspace: {}",
            files.len(),
            workspace_dir.display()
        ),
    );

    backend_manager::restart_backend(app.clone());
    window_manager::show_and_focus(app);
    Ok(())
}

fn parse_open_request(args: &[String], cwd: Option<&Path>) -> Result<Option<OpenRequest>, String> {
    if args.is_empty() {
        return Ok(None);
    }

    let args = strip_executable_arg(args);
    if args.is_empty() {
        return Ok(None);
    }

    if let Some(index) = args.iter().position(|value| value == "--open-dir") {
        let Some(raw_path) = args.get(index + 1) else {
            return Err("`--open-dir` requires a path argument".to_string());
        };
        let path = resolve_path(raw_path, cwd);
        return Ok(Some(OpenRequest::OpenDir(path)));
    }

    if let Some(index) = args.iter().position(|value| value == "--open-files") {
        let files: Vec<PathBuf> = args
            .iter()
            .skip(index + 1)
            .filter(|value| !value.starts_with("--"))
            .map(|value| resolve_path(value, cwd))
            .collect();
        if files.is_empty() {
            return Err("`--open-files` requires at least one file path".to_string());
        }
        return Ok(Some(OpenRequest::OpenFiles(dedupe_paths(files))));
    }

    let candidates: Vec<PathBuf> = args
        .iter()
        .filter(|value| !value.starts_with("--"))
        .map(|value| resolve_path(value, cwd))
        .collect();
    if candidates.is_empty() {
        return Ok(None);
    }

    let mut files = Vec::new();
    let mut directories = Vec::new();
    let mut missing = Vec::new();

    for path in candidates {
        match fs::metadata(&path) {
            Ok(metadata) if metadata.is_file() => files.push(path),
            Ok(metadata) if metadata.is_dir() => directories.push(path),
            Ok(_) => {}
            Err(_) => missing.push(path),
        }
    }

    if !files.is_empty() {
        return Ok(Some(OpenRequest::OpenFiles(dedupe_paths(files))));
    }
    if let Some(directory) = directories.into_iter().next() {
        return Ok(Some(OpenRequest::OpenDir(directory)));
    }
    if let Some(path) = missing.into_iter().next() {
        return Err(format!("path does not exist: {}", path.display()));
    }

    Ok(None)
}

fn strip_executable_arg(args: &[String]) -> &[String] {
    if args.len() < 2 {
        return args;
    }

    let first = &args[0];
    let second = &args[1];
    let looks_like_exe = first.ends_with(".exe") || first.ends_with(".app");
    if looks_like_exe && second.starts_with("--") {
        return &args[1..];
    }
    args
}

fn resolve_path(raw: &str, cwd: Option<&Path>) -> PathBuf {
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        return path;
    }
    if let Some(cwd) = cwd {
        return cwd.join(path);
    }
    path
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for path in paths {
        let key = path.to_string_lossy().to_lowercase();
        if seen.insert(key) {
            deduped.push(path);
        }
    }
    deduped
}

fn resolve_workspace_root(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    if let Some(configured) = settings
        .work_dir
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(configured);
        if !path.exists() {
            return Err(format!(
                "configured workspace root does not exist: {}",
                path.display()
            ));
        }
        if !path.is_dir() {
            return Err(format!(
                "configured workspace root is not a directory: {}",
                path.display()
            ));
        }
        return Ok(path);
    }

    default_working_directory().ok_or_else(|| "failed to resolve workspace root".to_string())
}

fn default_working_directory() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| std::env::current_dir().ok())
}

fn create_workspace_dir(workspace_root: &Path, files: &[PathBuf]) -> Result<PathBuf, String> {
    use std::io::ErrorKind;

    let date = Local::now().format("%Y%m%d").to_string();
    let stem = workspace_name_stem(files);
    for _ in 0..WORKSPACE_ATTEMPTS {
        let random = random_code();
        let folder_name = format!("{date}-{stem}-{random}");
        let candidate = workspace_root.join(folder_name);
        match fs::create_dir(&candidate) {
            Ok(_) => return Ok(candidate),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(format!(
                    "failed to create workspace directory `{}`: {error}",
                    candidate.display()
                ));
            }
        }
    }

    Err(format!(
        "failed to create workspace in `{}` after {} attempts",
        workspace_root.display(),
        WORKSPACE_ATTEMPTS
    ))
}

fn workspace_name_stem(files: &[PathBuf]) -> String {
    if files.is_empty() {
        return "workspace".to_string();
    }

    let first_stem = files[0]
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("workspace");
    let first_stem = sanitize_name_component(first_stem, WORKSPACE_STEM_MAX_LEN);

    if files.len() == 1 {
        return first_stem;
    }

    sanitize_name_component(
        &format!("{first_stem}_etc{}", files.len().saturating_sub(1)),
        WORKSPACE_STEM_MAX_LEN,
    )
}

fn sanitize_name_component(raw: &str, max_len: usize) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        let sanitized = if ch.is_ascii_control() {
            '_'
        } else if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
            '_'
        } else if ch.is_whitespace() {
            '_'
        } else {
            ch
        };
        out.push(sanitized);
    }

    let out = out
        .trim_matches(|ch: char| ch == '_' || ch == '-' || ch == '.')
        .to_string();
    if out.is_empty() {
        return "workspace".to_string();
    }

    out.chars().take(max_len).collect()
}

fn random_code() -> String {
    let value: u32 = rand::thread_rng().gen_range(0..=0x00FF_FFFF);
    format!("{value:06x}")
}

fn copy_files_to_workspace(files: &[PathBuf], workspace_dir: &Path) -> Result<(), String> {
    for source in files {
        let file_name = source
            .file_name()
            .ok_or_else(|| format!("cannot determine filename for `{}`", source.display()))?
            .to_string_lossy()
            .to_string();

        let mut destination = workspace_dir.join(&file_name);
        if destination.exists() {
            destination = next_available_file_name(workspace_dir, &file_name)?;
        }

        fs::copy(source, &destination).map_err(|error| {
            format!(
                "failed to copy `{}` to `{}`: {error}",
                source.display(),
                destination.display()
            )
        })?;
    }

    Ok(())
}

fn next_available_file_name(workspace_dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    let (stem, ext) = split_file_name(file_name);
    for index in 2..=9_999 {
        let candidate_name = if ext.is_empty() {
            format!("{stem} ({index})")
        } else {
            format!("{stem} ({index}).{ext}")
        };
        let candidate = workspace_dir.join(candidate_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "too many duplicate names in workspace for file `{file_name}`"
    ))
}

fn split_file_name(file_name: &str) -> (String, String) {
    if let Some(index) = file_name.rfind('.') {
        if index > 0 && index < file_name.len() - 1 {
            let stem = file_name[..index].to_string();
            let ext = file_name[index + 1..].to_string();
            return (stem, ext);
        }
    }

    (file_name.to_string(), String::new())
}

fn write_sources_manifest(files: &[PathBuf], workspace_dir: &Path) -> Result<(), String> {
    #[derive(Serialize)]
    struct SourcesManifest {
        created_at: String,
        sources: Vec<SourceItem>,
    }

    #[derive(Serialize)]
    struct SourceItem {
        source_path: String,
    }

    let sources: Vec<SourceItem> = files
        .iter()
        .map(|path| SourceItem {
            source_path: path.to_string_lossy().to_string(),
        })
        .collect();

    let manifest = SourcesManifest {
        created_at: Local::now().to_rfc3339(),
        sources,
    };

    let content = serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("failed to serialize workspace manifest: {error}"))?;
    let manifest_path = workspace_dir.join("sources.json");
    fs::write(&manifest_path, content).map_err(|error| {
        format!(
            "failed to write workspace manifest `{}`: {error}",
            manifest_path.display()
        )
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_explicit_open_dir_flag() {
        let args = vec!["--open-dir".to_string(), "D:\\Repo".to_string()];
        let request = parse_open_request(&args, None).expect("parse should succeed");
        assert_eq!(
            request,
            Some(OpenRequest::OpenDir(PathBuf::from("D:\\Repo")))
        );
    }

    #[test]
    fn parse_explicit_open_files_flag() {
        let args = vec![
            "--open-files".to_string(),
            "D:\\a.txt".to_string(),
            "D:\\b.md".to_string(),
        ];
        let request = parse_open_request(&args, None).expect("parse should succeed");
        assert_eq!(
            request,
            Some(OpenRequest::OpenFiles(vec![
                PathBuf::from("D:\\a.txt"),
                PathBuf::from("D:\\b.md"),
            ]))
        );
    }

    #[test]
    fn sanitize_component_replaces_invalid_chars() {
        let value = sanitize_name_component("My: file*name?.md", 40);
        assert_eq!(value, "My__file_name_.md");
    }

    #[test]
    fn split_file_name_handles_extension() {
        let (stem, ext) = split_file_name("archive.tar.gz");
        assert_eq!(stem, "archive.tar");
        assert_eq!(ext, "gz");
    }
}
