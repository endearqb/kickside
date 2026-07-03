use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::Context;
use chrono::Local;
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

pub fn bridge_log_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let state = app.state::<AppState>();
    ensure_logs_dir(app)?;
    Ok(state.bridge_log_path.clone())
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

    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S %:z").to_string();

    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) else {
        return;
    };

    let instance_id = app
        .try_state::<AppState>()
        .map(|state| state.instance_id.clone())
        .unwrap_or_else(|| "inst-unknown".to_string());

    let _ = writeln!(file, "[{}][{}] {}", timestamp, instance_id, line.as_ref());
}

pub fn read_log_tail(path: &Path, max_lines: usize) -> Vec<String> {
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };

    let lines: Vec<String> = content.lines().map(|line| line.to_string()).collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].to_vec()
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

fn rotated_path(path: &Path, index: usize) -> PathBuf {
    PathBuf::from(format!("{}.{}", path.display(), index))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(label: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
            let epoch = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let path = std::env::temp_dir()
                .join(format!("kimi-shell-log-manager-{label}-{epoch}-{unique}"));
            fs::create_dir_all(&path).expect("temp dir should be created");
            Self { path }
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn read_log_tail_returns_empty_when_file_missing() {
        let temp = TempDirGuard::new("missing");
        let lines = read_log_tail(&temp.path.join("missing.log"), 10);
        assert!(lines.is_empty());
    }

    #[test]
    fn read_log_tail_returns_all_lines_when_under_limit() {
        let temp = TempDirGuard::new("short");
        let path = temp.path.join("bridge.log");
        fs::write(&path, "one\ntwo\nthree\n").expect("log file should be written");

        let lines = read_log_tail(&path, 5);

        assert_eq!(lines, vec!["one", "two", "three"]);
    }

    #[test]
    fn read_log_tail_trims_to_requested_limit() {
        let temp = TempDirGuard::new("trim");
        let path = temp.path.join("bridge.log");
        fs::write(&path, "1\n2\n3\n4\n5\n").expect("log file should be written");

        let lines = read_log_tail(&path, 2);

        assert_eq!(lines, vec!["4", "5"]);
    }
}
