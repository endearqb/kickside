use std::{
    env,
    ffi::OsString,
    path::{Path, PathBuf},
};

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
    locate_shell_path_from(
        env::var_os("KIMI_SHELL_PATH"),
        which::which("bash").ok(),
        which::which("git").ok(),
        shell_candidate_paths(),
    )
}

fn configured_shell_path(value: Option<OsString>) -> Option<PathBuf> {
    value.map(PathBuf::from).filter(|path| path.exists())
}

fn locate_shell_path_from(
    configured: Option<OsString>,
    path_bash: Option<PathBuf>,
    git_path: Option<PathBuf>,
    candidates: Vec<PathBuf>,
) -> Option<PathBuf> {
    configured_shell_path(configured)
        .or_else(|| path_bash.filter(|path| path.exists() && !is_windows_system_bash(path)))
        .or_else(|| {
            git_path.and_then(|path| {
                shell_paths_from_git(&path)
                    .into_iter()
                    .find(|candidate| candidate.exists())
            })
        })
        .or_else(|| candidates.into_iter().find(|path| path.exists()))
}

fn is_windows_system_bash(path: &Path) -> bool {
    let Some(windows_dir) = env::var_os("WINDIR") else {
        return false;
    };
    let root = windows_dir
        .to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .to_lowercase();
    let value = path.to_string_lossy().to_lowercase();
    value == root
        || value.starts_with(&format!("{root}\\"))
        || value.starts_with(&format!("{root}/"))
}

fn shell_paths_from_git(git_path: &Path) -> Vec<PathBuf> {
    let Some(bin_dir) = git_path.parent() else {
        return Vec::new();
    };
    let Some(root) = bin_dir.parent() else {
        return Vec::new();
    };
    vec![
        root.join("bin").join("bash.exe"),
        root.join("usr").join("bin").join("bash.exe"),
    ]
}

fn shell_candidate_paths() -> Vec<PathBuf> {
    let mut roots = ["ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|key| env::var_os(key).map(PathBuf::from))
        .map(|base| base.join("Git"))
        .collect::<Vec<_>>();
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(local_app_data).join("Programs").join("Git"));
    }
    roots
        .into_iter()
        .flat_map(|root| {
            [
                root.join("bin").join("bash.exe"),
                root.join("usr").join("bin").join("bash.exe"),
            ]
        })
        .collect()
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

    #[test]
    fn locate_shell_path_falls_back_from_missing_explicit_path() {
        let temp = env::temp_dir().join(format!("kimi-shell-bash-fallback-{}", std::process::id()));
        fs::create_dir_all(&temp).expect("test directory should be created");
        let bash = temp.join("bash.exe");
        fs::write(&bash, b"bash").expect("test shell path should be written");

        assert_eq!(
            locate_shell_path_from(
                Some(temp.join("missing.exe").into_os_string()),
                Some(bash.clone()),
                None,
                Vec::new(),
            ),
            Some(bash.clone()),
        );

        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn locate_shell_path_derives_bash_from_git_install_root() {
        let temp = env::temp_dir().join(format!("kimi-shell-git-root-{}", std::process::id()));
        let git = temp.join("cmd").join("git.exe");
        let bash = temp.join("bin").join("bash.exe");
        fs::create_dir_all(git.parent().unwrap()).expect("git directory should be created");
        fs::create_dir_all(bash.parent().unwrap()).expect("bash directory should be created");
        fs::write(&git, b"git").expect("test git path should be written");
        fs::write(&bash, b"bash").expect("test bash path should be written");

        assert_eq!(
            locate_shell_path_from(None, None, Some(git), Vec::new()),
            Some(bash.clone()),
        );

        let _ = fs::remove_dir_all(temp);
    }
}
