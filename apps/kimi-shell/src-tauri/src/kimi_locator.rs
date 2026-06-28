use std::{env, path::PathBuf};

use crate::types::AppSettings;

pub fn locate(settings: &AppSettings) -> Result<PathBuf, String> {
    if let Some(configured) = settings
        .kimi_path
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(configured);
        if path.exists() {
            return Ok(path);
        }
        return Err(format!(
            "Configured kimi path does not exist: {}",
            path.display()
        ));
    }

    which::which("kimi").map_err(|_| {
        "Could not find `kimi` in PATH. Install Kimi CLI or configure the executable path."
            .to_string()
    })
}

pub fn locate_shell_path() -> Option<PathBuf> {
    if let Some(configured) = env::var_os("KIMI_SHELL_PATH")
        .map(PathBuf::from)
        .filter(|path| path.exists())
    {
        return Some(configured);
    }

    for candidate in git_bash_candidates() {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    which::which("bash").ok()
}

fn git_bash_candidates() -> Vec<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|key| env::var_os(key).map(PathBuf::from))
        .flat_map(|base| {
            [
                base.join("Git").join("bin").join("bash.exe"),
                base.join("Git").join("usr").join("bin").join("bash.exe"),
            ]
        })
        .collect()
}
