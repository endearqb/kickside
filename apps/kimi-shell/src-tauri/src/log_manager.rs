use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::Context;
use tauri::{AppHandle, Manager};

use crate::app_state::AppState;

const MAX_LOG_BYTES: u64 = 10 * 1024 * 1024;
const MAX_LOG_FILES: usize = 5;

pub fn ensure_logs_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let state = app.state::<AppState>();
    std::fs::create_dir_all(&state.logs_dir)
        .with_context(|| format!("failed to create logs dir: {}", state.logs_dir.display()))?;
    Ok(state.logs_dir.clone())
}

pub fn app_log_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let logs_dir = ensure_logs_dir(app)?;
    Ok(logs_dir.join("app.log"))
}

pub fn backend_log_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let logs_dir = ensure_logs_dir(app)?;
    Ok(logs_dir.join("backend.log"))
}

pub fn rotate_backend_log_if_needed(app: &AppHandle) -> anyhow::Result<()> {
    let log_path = backend_log_path(app)?;
    rotate_file_if_needed(&log_path, MAX_LOG_BYTES, MAX_LOG_FILES)
}

pub fn append_line(app: &AppHandle, line: impl AsRef<str>) {
    let log_path = match app_log_path(app) {
        Ok(path) => path,
        Err(_) => return,
    };

    if rotate_file_if_needed(&log_path, MAX_LOG_BYTES, MAX_LOG_FILES).is_err() {
        return;
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) else {
        return;
    };

    let instance_id = app
        .try_state::<AppState>()
        .map(|state| state.instance_id.clone())
        .unwrap_or_else(|| "inst-unknown".to_string());

    let _ = writeln!(file, "[{}][{}] {}", timestamp, instance_id, line.as_ref());
}

fn rotate_file_if_needed(path: &PathBuf, max_bytes: u64, max_files: usize) -> anyhow::Result<()> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(());
    };
    if metadata.len() < max_bytes {
        return Ok(());
    }

    if max_files > 1 {
        for index in (1..max_files).rev() {
            let src = rotated_path(path, index);
            let dst = rotated_path(path, index + 1);
            if src.exists() {
                if dst.exists() {
                    fs::remove_file(&dst).ok();
                }
                fs::rename(&src, &dst).with_context(|| {
                    format!(
                        "failed to rotate log from {} to {}",
                        src.display(),
                        dst.display()
                    )
                })?;
            }
        }
    }

    let first_rotated = rotated_path(path, 1);
    if first_rotated.exists() {
        fs::remove_file(&first_rotated).ok();
    }
    fs::rename(path, &first_rotated).with_context(|| {
        format!(
            "failed to rotate active log {} to {}",
            path.display(),
            first_rotated.display()
        )
    })?;

    Ok(())
}

fn rotated_path(path: &PathBuf, index: usize) -> PathBuf {
    PathBuf::from(format!("{}.{}", path.display(), index))
}
