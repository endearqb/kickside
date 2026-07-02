use std::{env, ffi::OsString, path::PathBuf};

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
        "Could not find `kimi` in PATH. Install Kimi Code or configure the executable path."
            .to_string()
    })
}

pub fn locate_shell_path() -> Option<PathBuf> {
    configured_shell_path(env::var_os("KIMI_SHELL_PATH"))
}

fn configured_shell_path(value: Option<OsString>) -> Option<PathBuf> {
    value.map(PathBuf::from).filter(|path| path.exists())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn configured_shell_path_returns_existing_explicit_path() {
        let path = env::temp_dir().join(format!(
            "kimi-shell-explicit-bash-{}.exe",
            std::process::id()
        ));
        fs::write(&path, b"bash").expect("test shell path should be written");

        assert_eq!(
            configured_shell_path(Some(path.clone().into_os_string())),
            Some(path.clone())
        );

        let _ = fs::remove_file(path);
    }

    #[test]
    fn configured_shell_path_ignores_missing_explicit_path() {
        let path = env::temp_dir().join(format!(
            "kimi-shell-missing-bash-{}.exe",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        assert_eq!(configured_shell_path(Some(path.into_os_string())), None);
    }

    #[test]
    fn configured_shell_path_ignores_unset_env() {
        assert_eq!(configured_shell_path(None), None);
    }
}
