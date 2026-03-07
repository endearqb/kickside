use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

use chrono::Local;
use rand::Rng;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use url::Url;

use crate::{
    app_state::AppState, backend_manager, log_manager, settings_store,
    types::OpenRequestErrorPayload, window_manager, workspace_session,
};

const OPEN_FILES_DEBOUNCE_MS: u64 = 350;
const OPEN_REQUEST_DEDUPE_TTL_MS: u64 = 1_500;
const WORKSPACE_STEM_MAX_LEN: usize = 40;
const WORKSPACE_ATTEMPTS: usize = 24;
const CLI_LOG_ARG_MAX_CHARS: usize = 480;

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

#[derive(Default)]
struct RecentOpenRequestCache {
    seen_at: HashMap<String, Instant>,
}

static OPEN_FILES_BATCH: OnceLock<Mutex<OpenFilesBatch>> = OnceLock::new();
static RECENT_OPEN_REQUESTS: OnceLock<Mutex<RecentOpenRequestCache>> = OnceLock::new();

pub fn apply_startup_cli_request(app: &AppHandle) {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        return;
    }

    let current_dir = std::env::current_dir().ok();
    let parsed = parse_open_request(&args, current_dir.as_deref());
    log_open_request_parse(app, "startup", &args, current_dir.as_deref(), &parsed);
    let args_summary = Some(format_args_for_log(&args));

    match parsed {
        Ok(Some(request)) => {
            if is_duplicate_open_request(app, &request, "startup") {
                window_manager::show_and_focus(app);
                return;
            }
            mark_startup_open_request(app);
            if let Err(error) = apply_open_request(app, request) {
                log_manager::append_line(
                    app,
                    format!("failed to apply startup open request: {error}"),
                );
                emit_open_request_error(
                    app,
                    "startup",
                    "apply_open_request",
                    &error,
                    args_summary.clone(),
                );
            }
        }
        Ok(None) => {
            log_non_matching_args(app, "startup", &args);
        }
        Err(error) => {
            log_manager::append_line(app, format!("invalid startup arguments: {error}"));
            emit_open_request_error(app, "startup", "parse_open_request", &error, args_summary);
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
    log_open_request_parse(&app, "forwarded", &args, cwd_path.as_deref(), &parsed);
    let args_summary = Some(format_args_for_log(&args));
    match parsed {
        Ok(Some(OpenRequest::OpenDir(path))) => {
            let request = OpenRequest::OpenDir(path);
            if is_duplicate_open_request(&app, &request, "forwarded") {
                window_manager::show_and_focus(&app);
                return;
            }
            let app_for_thread = app.clone();
            let summary_for_thread = args_summary.clone();
            thread::spawn(move || {
                if let Err(error) = apply_open_request(&app_for_thread, request) {
                    log_manager::append_line(
                        &app_for_thread,
                        format!("failed to apply forwarded directory request: {error}"),
                    );
                    emit_open_request_error(
                        &app_for_thread,
                        "forwarded",
                        "apply_open_request",
                        &error,
                        summary_for_thread,
                    );
                }
            });
        }
        Ok(Some(OpenRequest::OpenFiles(files))) => {
            let request = OpenRequest::OpenFiles(files.clone());
            if is_duplicate_open_request(&app, &request, "forwarded") {
                window_manager::show_and_focus(&app);
                return;
            }
            enqueue_open_files_request(app, files, "forwarded", args_summary);
        }
        Ok(None) => {
            log_non_matching_args(&app, "forwarded", &args);
            window_manager::show_and_focus(&app);
        }
        Err(error) => {
            log_manager::append_line(&app, format!("invalid forwarded arguments: {error}"));
            emit_open_request_error(
                &app,
                "forwarded",
                "parse_open_request",
                &error,
                args_summary,
            );
            window_manager::show_and_focus(&app);
        }
    }
}

fn enqueue_open_files_request(
    app: AppHandle,
    files: Vec<PathBuf>,
    source: &str,
    args_summary: Option<String>,
) {
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
                emit_open_request_error(
                    &app,
                    source,
                    "enqueue_batch_lock",
                    "open-files batch lock poisoned; dropping request",
                    args_summary,
                );
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

    let source = source.to_string();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(OPEN_FILES_DEBOUNCE_MS));
        let maybe_files = {
            let batch_state =
                OPEN_FILES_BATCH.get_or_init(|| Mutex::new(OpenFilesBatch::default()));
            let mut batch = match batch_state.lock() {
                Ok(lock) => lock,
                Err(_) => {
                    log_manager::append_line(&app, "open-files batch lock poisoned during flush");
                    emit_open_request_error(
                        &app,
                        &source,
                        "flush_batch_lock",
                        "open-files batch lock poisoned during flush",
                        args_summary.clone(),
                    );
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
            let files_for_summary = files.clone();
            if let Err(error) = apply_open_request(&app, OpenRequest::OpenFiles(files)) {
                let summary = args_summary
                    .clone()
                    .or_else(|| Some(format_paths_for_log(&files_for_summary)));
                log_manager::append_line(
                    &app,
                    format!("failed to process open-files request: {error}"),
                );
                emit_open_request_error(&app, &source, "apply_open_request", &error, summary);
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
    workspace_session::clear_active_session_runtime(app, "open_dir_request");
    workspace_session::queue_workspace_bootstrap(
        app,
        &directory,
        "open_dir_request",
        false,
        false,
    );
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

    let first_file = files
        .first()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "<none>".to_string());
    let workspace_root = resolve_workspace_root(app).map_err(|error| {
        format!(
            "open-files stage=resolve_workspace_root failed (file_count={}, first_file={}): {error}",
            files.len(),
            first_file
        )
    })?;
    let workspace_dir = create_workspace_dir(&workspace_root, &files).map_err(|error| {
        format!(
            "open-files stage=create_workspace_dir failed (workspace_root={}): {error}",
            workspace_root.display()
        )
    })?;
    copy_files_to_workspace(&files, &workspace_dir).map_err(|error| {
        format!(
            "open-files stage=copy_files failed (workspace_root={}, workspace_dir={}, first_file={}): {error}",
            workspace_root.display(),
            workspace_dir.display(),
            first_file
        )
    })?;
    write_sources_manifest(&files, &workspace_dir).map_err(|error| {
        format!(
            "open-files stage=write_sources_manifest failed (workspace_dir={}): {error}",
            workspace_dir.display()
        )
    })?;

    backend_manager::set_session_work_dir(app, Some(workspace_dir.clone())).map_err(|error| {
        format!(
            "open-files stage=set_session_work_dir failed (workspace_dir={}): {error}",
            workspace_dir.display()
        )
    })?;
    workspace_session::clear_active_session_runtime(app, "open_files_request");
    workspace_session::queue_workspace_bootstrap(
        app,
        &workspace_dir,
        "open_files_request",
        false,
        false,
    );

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

#[derive(Debug, Clone)]
struct CandidatePath {
    raw: String,
    resolved: PathBuf,
}

#[derive(Debug, Default)]
struct CandidateClassification {
    files: Vec<PathBuf>,
    directories: Vec<PathBuf>,
    missing: Vec<CandidatePath>,
    other_fs_entries: Vec<CandidatePath>,
}

fn parse_open_request(args: &[String], cwd: Option<&Path>) -> Result<Option<OpenRequest>, String> {
    if args.is_empty() {
        return Ok(None);
    }

    let args = normalize_cli_args(args, cwd);
    if args.is_empty() {
        return Ok(None);
    }

    if let Some(index) = args.iter().position(|value| value == "--open-dir") {
        return parse_open_dir_flag(&args, index, cwd);
    }

    if let Some(index) = args.iter().position(|value| value == "--open-files") {
        return parse_open_files_flag(&args, index, cwd);
    }

    parse_implicit_candidates(&args, cwd)
}

fn normalize_cli_args(args: &[String], cwd: Option<&Path>) -> Vec<String> {
    strip_executable_arg(args, cwd)
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .filter(|value| !is_shell_noise_arg(value))
        .map(|value| value.to_string())
        .collect()
}

fn parse_open_dir_flag(
    args: &[String],
    index: usize,
    cwd: Option<&Path>,
) -> Result<Option<OpenRequest>, String> {
    let remainder = args.get(index + 1..).unwrap_or_default();
    if remainder.is_empty() {
        return Err("`--open-dir` requires a path argument".to_string());
    }

    let raw_path = if remainder[0] == "--" {
        let Some(path) = remainder.get(1) else {
            return Err("`--open-dir --` requires a path argument".to_string());
        };
        path
    } else {
        if is_option_token(&remainder[0]) {
            return Err(format!(
                "`--open-dir` received option `{}` as path argument",
                remainder[0]
            ));
        }
        &remainder[0]
    };

    Ok(Some(OpenRequest::OpenDir(resolve_path(raw_path, cwd))))
}

fn parse_open_files_flag(
    args: &[String],
    index: usize,
    cwd: Option<&Path>,
) -> Result<Option<OpenRequest>, String> {
    let remainder = args.get(index + 1..).unwrap_or_default();
    if remainder.is_empty() {
        return Err("`--open-files` requires at least one file path".to_string());
    }

    let literal_mode = remainder.first().is_some_and(|value| value == "--");
    let file_tokens = if literal_mode {
        &remainder[1..]
    } else {
        remainder
    };
    if file_tokens.is_empty() {
        return Err("`--open-files --` requires at least one file path".to_string());
    }

    let candidates = collect_candidate_paths(file_tokens, cwd, literal_mode);
    if candidates.is_empty() {
        return Err(
            "`--open-files` did not contain any usable paths after filtering options".to_string(),
        );
    }

    let classification = classify_candidate_paths(candidates);
    if !classification.files.is_empty() {
        return Ok(Some(OpenRequest::OpenFiles(dedupe_paths(
            classification.files,
        ))));
    }
    if classification.directories.len() == 1
        && classification.missing.is_empty()
        && classification.other_fs_entries.is_empty()
    {
        return Ok(Some(OpenRequest::OpenDir(
            classification.directories[0].clone(),
        )));
    }

    Err(build_open_files_parse_error(&classification, literal_mode))
}

fn parse_implicit_candidates(
    args: &[String],
    cwd: Option<&Path>,
) -> Result<Option<OpenRequest>, String> {
    let candidates = filter_self_launch_candidates(collect_candidate_paths(args, cwd, false));
    if candidates.is_empty() {
        return Ok(None);
    }

    let classification = classify_candidate_paths(candidates);
    if !classification.files.is_empty() {
        return Ok(Some(OpenRequest::OpenFiles(dedupe_paths(
            classification.files,
        ))));
    }
    if let Some(directory) = classification.directories.into_iter().next() {
        return Ok(Some(OpenRequest::OpenDir(directory)));
    }
    if let Some(path) = classification.missing.into_iter().next() {
        return Err(format!("path does not exist: {}", path.resolved.display()));
    }
    if let Some(path) = classification.other_fs_entries.into_iter().next() {
        return Err(format!(
            "path is neither file nor directory: {}",
            path.resolved.display()
        ));
    }

    Ok(None)
}

fn collect_candidate_paths(
    tokens: &[String],
    cwd: Option<&Path>,
    literal_mode: bool,
) -> Vec<CandidatePath> {
    let mut candidates = Vec::new();
    for token in tokens {
        let value = token.trim();
        if value.is_empty() || is_shell_noise_arg(value) {
            continue;
        }

        let resolved = resolve_path(value, cwd);
        if !literal_mode && is_option_token(value) && !resolved.exists() {
            continue;
        }

        candidates.push(CandidatePath {
            raw: value.to_string(),
            resolved,
        });
    }
    candidates
}

fn filter_self_launch_candidates(candidates: Vec<CandidatePath>) -> Vec<CandidatePath> {
    let Some(current_executable) = current_executable_path() else {
        return candidates;
    };

    candidates
        .into_iter()
        .filter(|candidate| !paths_match(&candidate.resolved, &current_executable))
        .collect()
}

fn classify_candidate_paths(candidates: Vec<CandidatePath>) -> CandidateClassification {
    let mut classification = CandidateClassification::default();
    for candidate in candidates {
        match fs::metadata(&candidate.resolved) {
            Ok(metadata) if metadata.is_file() => classification.files.push(candidate.resolved),
            Ok(metadata) if metadata.is_dir() => {
                classification.directories.push(candidate.resolved)
            }
            Ok(_) => classification.other_fs_entries.push(candidate),
            Err(_) => classification.missing.push(candidate),
        }
    }

    classification
}

fn build_open_files_parse_error(
    classification: &CandidateClassification,
    literal_mode: bool,
) -> String {
    let first_invalid = classification
        .missing
        .first()
        .or_else(|| classification.other_fs_entries.first());
    let invalid_token = first_invalid
        .map(|entry| entry.raw.as_str())
        .unwrap_or("<none>");
    let invalid_resolved = first_invalid
        .map(|entry| entry.resolved.display().to_string())
        .unwrap_or_else(|| "<none>".to_string());

    format!(
        "open-files parse failed: reason=no_valid_files; literal_mode={literal_mode}; first_invalid_token={invalid_token}; first_invalid_resolved={invalid_resolved}; files_detected={}; directories_detected={}; missing_detected={}; other_detected={}",
        classification.files.len(),
        classification.directories.len(),
        classification.missing.len(),
        classification.other_fs_entries.len()
    )
}

fn strip_executable_arg<'a>(args: &'a [String], cwd: Option<&Path>) -> &'a [String] {
    if args.is_empty() {
        return args;
    }

    let first = &args[0];
    if is_self_launch_artifact(first, cwd) {
        return &args[1..];
    }

    if args.len() < 2 {
        return args;
    }

    let second = &args[1];
    let looks_like_exe = first.ends_with(".exe") || first.ends_with(".app");
    if looks_like_exe && second.starts_with("--") {
        return &args[1..];
    }
    args
}

fn is_self_launch_artifact(value: &str, cwd: Option<&Path>) -> bool {
    let Some(current_executable) = current_executable_path() else {
        return false;
    };
    let resolved = resolve_path(value, cwd);
    paths_match(&resolved, &current_executable)
}

fn current_executable_path() -> Option<PathBuf> {
    let current = std::env::current_exe().ok()?;
    canonicalize_path(&current).or(Some(current))
}

fn canonicalize_path(path: &Path) -> Option<PathBuf> {
    fs::canonicalize(path).ok()
}

fn paths_match(left: &Path, right: &Path) -> bool {
    if path_text_matches(left, right) {
        return true;
    }

    match (canonicalize_path(left), canonicalize_path(right)) {
        (Some(left), Some(right)) => path_text_matches(&left, &right),
        _ => false,
    }
}

fn path_text_matches(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
    }

    #[cfg(not(windows))]
    {
        left == right
    }
}

fn resolve_path(raw: &str, cwd: Option<&Path>) -> PathBuf {
    if let Some(path) = parse_file_uri(raw) {
        return path;
    }

    let path = PathBuf::from(raw.trim());
    if path.is_absolute() {
        return path;
    }
    if let Some(cwd) = cwd {
        return cwd.join(path);
    }
    path
}

fn parse_file_uri(raw: &str) -> Option<PathBuf> {
    if !raw.trim().to_ascii_lowercase().starts_with("file://") {
        return None;
    }
    let url = Url::parse(raw.trim()).ok()?;
    if url.scheme() != "file" {
        return None;
    }
    url.to_file_path().ok()
}

fn is_shell_noise_arg(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    lower == "/embedding" || lower.starts_with("/prefetch:")
}

fn is_option_token(value: &str) -> bool {
    value.starts_with("--")
}

fn log_open_request_parse(
    app: &AppHandle,
    scope: &str,
    args: &[String],
    cwd: Option<&Path>,
    parsed: &Result<Option<OpenRequest>, String>,
) {
    let cwd_display = cwd
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "<none>".to_string());
    let args_display = format_args_for_log(args);
    let parsed_display = match parsed {
        Ok(Some(OpenRequest::OpenDir(path))) => format!("open_dir:{}", path.display()),
        Ok(Some(OpenRequest::OpenFiles(files))) => {
            let first = files
                .first()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| "<none>".to_string());
            format!("open_files:{} (first={first})", files.len())
        }
        Ok(None) => "none".to_string(),
        Err(error) => format!("error:{error}"),
    };

    log_manager::append_line(
        app,
        format!(
            "open-request parse (scope={scope}, cwd={cwd_display}, args={args_display}, result={parsed_display})"
        ),
    );
}

fn format_args_for_log(args: &[String]) -> String {
    let mut joined = args
        .iter()
        .map(|value| format!("\"{}\"", value.replace('"', "\\\"")))
        .collect::<Vec<String>>()
        .join(" ");
    if joined.len() > CLI_LOG_ARG_MAX_CHARS {
        joined.truncate(CLI_LOG_ARG_MAX_CHARS);
        joined.push_str("...");
    }
    joined
}

fn format_paths_for_log(paths: &[PathBuf]) -> String {
    let as_args = paths
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<String>>();
    format_args_for_log(&as_args)
}

fn build_open_request_error_payload(
    source: &str,
    stage: &str,
    message: &str,
    args_summary: Option<String>,
) -> OpenRequestErrorPayload {
    OpenRequestErrorPayload {
        source: source.trim().to_string(),
        stage: stage.trim().to_string(),
        message: message.trim().to_string(),
        args_summary: args_summary
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    }
}

fn emit_open_request_error(
    app: &AppHandle,
    source: &str,
    stage: &str,
    message: &str,
    args_summary: Option<String>,
) {
    let payload = build_open_request_error_payload(source, stage, message, args_summary);
    let args_display = payload.args_summary.as_deref().unwrap_or("<none>");
    log_manager::append_line(
        app,
        format!(
            "open-request error (source={}, stage={}, message={}, args={})",
            payload.source, payload.stage, payload.message, args_display
        ),
    );
    window_manager::publish_open_request_error(app, &payload, source);
}

fn log_non_matching_args(app: &AppHandle, scope: &str, args: &[String]) {
    if args.is_empty() {
        return;
    }

    let first = args
        .first()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("<empty>");
    log_manager::append_line(
        app,
        format!(
            "open-request parse produced no actionable request (scope={scope}, first_token={first}, args={})",
            format_args_for_log(args)
        ),
    );
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

fn is_duplicate_open_request(app: &AppHandle, request: &OpenRequest, scope: &str) -> bool {
    let fingerprint = open_request_fingerprint(request);
    let cache = RECENT_OPEN_REQUESTS.get_or_init(|| Mutex::new(RecentOpenRequestCache::default()));
    let Ok(mut recent) = cache.lock() else {
        log_manager::append_line(
            app,
            format!(
                "open-request dedupe cache mutex poisoned; allowing request (scope={scope}, fingerprint={fingerprint})"
            ),
        );
        return false;
    };

    let now = Instant::now();
    let ttl = Duration::from_millis(OPEN_REQUEST_DEDUPE_TTL_MS);
    recent
        .seen_at
        .retain(|_, seen_at| now.saturating_duration_since(*seen_at) <= ttl);

    if let Some(previous) = recent.seen_at.get(&fingerprint) {
        let age_ms = now.saturating_duration_since(*previous).as_millis();
        log_manager::append_line(
            app,
            format!(
                "ignored duplicate open-request (scope={scope}, age_ms={age_ms}, fingerprint={fingerprint})"
            ),
        );
        return true;
    }

    recent.seen_at.insert(fingerprint, now);
    false
}

fn open_request_fingerprint(request: &OpenRequest) -> String {
    match request {
        OpenRequest::OpenDir(path) => format!("dir:{}", path_fingerprint(path)),
        OpenRequest::OpenFiles(files) => {
            let mut normalized = files.iter().map(|path| path_fingerprint(path)).collect::<Vec<_>>();
            normalized.sort_unstable();
            format!("files:{}", normalized.join("|"))
        }
    }
}

fn path_fingerprint(path: &Path) -> String {
    let normalized = canonicalize_path(path).unwrap_or_else(|| path.to_path_buf());
    #[cfg(windows)]
    {
        normalized.to_string_lossy().to_lowercase()
    }

    #[cfg(not(windows))]
    {
        normalized.to_string_lossy().to_string()
    }
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
    use std::fs;
    use std::path::Path;

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(prefix: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "kimi-shell-open-request-{prefix}-{}",
                random_code()
            ));
            fs::create_dir_all(&path).expect("failed to create temp dir");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

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
    fn parse_open_files_supports_file_uri() {
        let temp = TempDirGuard::new("file-uri");
        let file_path = temp.path().join("a.txt");
        fs::write(&file_path, b"ok").expect("failed to write file");

        let file_uri = Url::from_file_path(&file_path)
            .expect("failed to build file uri")
            .to_string();
        let args = vec!["--open-files".to_string(), file_uri];
        let request = parse_open_request(&args, None).expect("parse should succeed");
        assert_eq!(request, Some(OpenRequest::OpenFiles(vec![file_path])));
    }

    #[test]
    fn parse_open_files_literal_separator_keeps_dash_prefixed_file() {
        let temp = TempDirGuard::new("literal");
        let file_path = temp.path().join("--draft.md");
        fs::write(&file_path, b"hello").expect("failed to write file");

        let args = vec![
            "--open-files".to_string(),
            "--".to_string(),
            "--draft.md".to_string(),
        ];
        let request = parse_open_request(&args, Some(temp.path())).expect("parse should succeed");
        assert_eq!(request, Some(OpenRequest::OpenFiles(vec![file_path])));
    }

    #[test]
    fn parse_open_files_without_literal_still_accepts_existing_dash_prefixed_file() {
        let temp = TempDirGuard::new("literal-optional");
        let file_path = temp.path().join("--draft.md");
        fs::write(&file_path, b"hello").expect("failed to write file");

        let args = vec!["--open-files".to_string(), "--draft.md".to_string()];
        let request = parse_open_request(&args, Some(temp.path())).expect("parse should succeed");
        assert_eq!(request, Some(OpenRequest::OpenFiles(vec![file_path])));
    }

    #[test]
    fn parse_open_files_filters_shell_noise_args() {
        let temp = TempDirGuard::new("shell-noise");
        let file_path = temp.path().join("note.md");
        fs::write(&file_path, b"hello").expect("failed to write file");

        let args = vec![
            "/prefetch:7".to_string(),
            "/embedding".to_string(),
            "--open-files".to_string(),
            "note.md".to_string(),
        ];
        let request = parse_open_request(&args, Some(temp.path())).expect("parse should succeed");
        assert_eq!(request, Some(OpenRequest::OpenFiles(vec![file_path])));
    }

    #[test]
    fn parse_open_files_falls_back_to_single_directory() {
        let temp = TempDirGuard::new("fallback-dir");
        let dir_path = temp.path().join("workspace");
        fs::create_dir_all(&dir_path).expect("failed to create directory");

        let args = vec!["--open-files".to_string(), "workspace".to_string()];
        let request = parse_open_request(&args, Some(temp.path())).expect("parse should succeed");
        assert_eq!(request, Some(OpenRequest::OpenDir(dir_path)));
    }

    #[test]
    fn parse_open_files_error_contains_first_invalid_token() {
        let temp = TempDirGuard::new("invalid-token");
        let args = vec!["--open-files".to_string(), "missing.md".to_string()];
        let error = parse_open_request(&args, Some(temp.path())).expect_err("should fail");
        assert!(error.contains("first_invalid_token=missing.md"));
        assert!(error.contains("reason=no_valid_files"));
    }

    #[test]
    fn parse_implicit_current_executable_is_ignored() {
        let current_exe = std::env::current_exe().expect("current exe should exist");
        let args = vec![current_exe.to_string_lossy().to_string()];

        let request = parse_open_request(&args, None).expect("parse should succeed");

        assert_eq!(request, None);
    }

    #[test]
    fn parse_implicit_ignores_current_executable_and_keeps_real_file() {
        let temp = TempDirGuard::new("self-exe-plus-file");
        let file_path = temp.path().join("note.md");
        fs::write(&file_path, b"hello").expect("failed to write file");
        let current_exe = std::env::current_exe().expect("current exe should exist");
        let args = vec![
            current_exe.to_string_lossy().to_string(),
            "note.md".to_string(),
        ];

        let request = parse_open_request(&args, Some(temp.path())).expect("parse should succeed");

        assert_eq!(request, Some(OpenRequest::OpenFiles(vec![file_path])));
    }

    #[test]
    fn parse_implicit_filters_current_executable_after_shell_noise() {
        let current_exe = std::env::current_exe().expect("current exe should exist");
        let args = vec![
            "/embedding".to_string(),
            current_exe.to_string_lossy().to_string(),
        ];

        let request = parse_open_request(&args, None).expect("parse should succeed");

        assert_eq!(request, None);
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

    #[test]
    fn build_open_request_error_payload_uses_camel_case_fields() {
        let payload = build_open_request_error_payload(
            "forwarded",
            "apply_open_request",
            "copy failed",
            Some("  \"a.md\"  ".to_string()),
        );
        assert_eq!(payload.source, "forwarded");
        assert_eq!(payload.stage, "apply_open_request");
        assert_eq!(payload.message, "copy failed");
        assert_eq!(payload.args_summary.as_deref(), Some("\"a.md\""));
    }

    #[test]
    fn format_paths_for_log_truncates_long_list() {
        let paths = vec![
            PathBuf::from("D:/workspace/alpha.md"),
            PathBuf::from("D:/workspace/beta.md"),
            PathBuf::from("D:/workspace/gamma.md"),
        ];
        let value = format_paths_for_log(&paths);
        assert!(value.contains("alpha.md"));
        assert!(value.contains("beta.md"));
    }
}
