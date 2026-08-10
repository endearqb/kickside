use std::{
    collections::HashSet,
    env,
    ffi::OsString,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use crate::{command_utils, types::AppSettings};

const KIMI_PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const LOGIN_SHELL_OUTPUT_LIMIT: u64 = 64 * 1024;
const KIMI_HELP_OUTPUT_LIMIT: u64 = 64 * 1024;

pub fn locate(settings: &AppSettings) -> Result<PathBuf, String> {
    if let Some(configured) = settings
        .kimi_path
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(configured);
        return validate_kimi_candidate(&path).map_err(|error| {
            format!(
                "Configured kimi path is not a usable Kimi Code executable ({}): {error}",
                path.display()
            )
        });
    }

    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    let user_home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from);
    if let Some(home) = user_home.as_ref() {
        push_candidate(
            &mut candidates,
            &mut seen,
            home.join(".kimi-code").join("bin").join(kimi_binary_name()),
        );
    }
    if let Some(kimi_home) = env::var_os("KIMI_CODE_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        push_candidate(
            &mut candidates,
            &mut seen,
            kimi_home.join("bin").join(kimi_binary_name()),
        );
    }
    for path in known_unix_candidates(user_home.as_deref()) {
        push_candidate(&mut candidates, &mut seen, path);
    }
    if let Ok(path) = which::which("kimi") {
        push_candidate(&mut candidates, &mut seen, path);
    }

    let mut failures = Vec::new();
    for candidate in candidates {
        match validate_kimi_candidate(&candidate) {
            Ok(path) => return Ok(path),
            Err(error) if candidate.exists() => {
                failures.push(format!("{}: {error}", candidate.display()));
            }
            Err(_) => {}
        }
    }

    if let Some(candidate) = locate_from_login_shell() {
        match validate_kimi_candidate(&candidate) {
            Ok(path) => return Ok(path),
            Err(error) => failures.push(format!("{}: {error}", candidate.display())),
        }
    }

    let detail = if failures.is_empty() {
        String::new()
    } else {
        format!(" Checked candidates: {}.", failures.join("; "))
    };
    Err(format!(
        "Could not find a compatible Kimi Code executable. Install Kimi Code or configure the executable path.{detail}"
    ))
}

fn push_candidate(candidates: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>, path: PathBuf) {
    if seen.insert(path.clone()) {
        candidates.push(path);
    }
}

#[cfg(windows)]
fn kimi_binary_name() -> &'static str {
    "kimi.exe"
}

#[cfg(not(windows))]
fn kimi_binary_name() -> &'static str {
    "kimi"
}

fn known_unix_candidates(user_home: Option<&Path>) -> Vec<PathBuf> {
    #[cfg(unix)]
    {
        let mut candidates = vec![
            PathBuf::from("/opt/homebrew/bin/kimi"),
            PathBuf::from("/usr/local/bin/kimi"),
        ];
        if let Some(home) = user_home {
            candidates.push(home.join(".local").join("bin").join("kimi"));
        }
        candidates
    }
    #[cfg(not(unix))]
    {
        let _ = user_home;
        Vec::new()
    }
}

fn validate_kimi_candidate(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("cannot resolve executable: {error}"))?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("cannot read executable metadata: {error}"))?;
    if !metadata.is_file() {
        return Err("path is not a regular file".to_string());
    }
    if !is_executable(&metadata) {
        return Err("file does not have an executable permission bit".to_string());
    }
    if !supports_kimi_web(&canonical) {
        return Err("`web --help` did not confirm the Kimi Code command family".to_string());
    }
    Ok(canonical)
}

#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    true
}

fn supports_kimi_web(path: &Path) -> bool {
    let mut command = Command::new(path);
    command_utils::configure_kimi_query_command(&mut command);
    command
        .args(["web", "--help"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_isolated_probe(&mut command);
    let Some(output) = command_output_successfully(command, KIMI_PROBE_TIMEOUT) else {
        return false;
    };
    let help = String::from_utf8_lossy(&output);
    help.contains("--no-open") && help.contains("--allowed-host") && help.contains("rotate-token")
}

fn command_output_successfully(mut command: Command, timeout: Duration) -> Option<Vec<u8>> {
    let Ok(mut child) = command.spawn() else {
        return None;
    };
    let stdout = child.stdout.take()?;
    let stderr = child.stderr.take()?;
    let (sender, receiver) = std::sync::mpsc::channel();
    for stream in [Box::new(stdout) as Box<dyn Read + Send>, Box::new(stderr)] {
        let sender = sender.clone();
        thread::spawn(move || {
            let mut output = Vec::new();
            let _ = stream
                .take(KIMI_HELP_OUTPUT_LIMIT + 1)
                .read_to_end(&mut output);
            let _ = sender.send(output);
        });
    }
    drop(sender);
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => {
                let mut output = Vec::new();
                for _ in 0..2 {
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    output.extend(receiver.recv_timeout(remaining).ok()?);
                }
                return ((output.len() as u64) <= KIMI_HELP_OUTPUT_LIMIT).then_some(output);
            }
            Ok(Some(_)) => return None,
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(_) => {
                terminate_isolated_probe(&mut child);
                let _ = child.wait();
                return None;
            }
        }
    }
    terminate_isolated_probe(&mut child);
    let _ = child.wait();
    None
}

#[cfg(unix)]
fn locate_from_login_shell() -> Option<PathBuf> {
    let shell = env::var_os("SHELL").map(PathBuf::from)?;
    if !allowed_login_shell(&shell) {
        return None;
    }

    let mut command = Command::new(&shell);
    command_utils::configure_kimi_query_command(&mut command);
    command
        .args(["-l", "-c", "command -v kimi"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_isolated_probe(&mut command);
    let mut child = command.spawn().ok()?;
    let stdout = child.stdout.take()?;
    let (sender, receiver) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let mut output = Vec::new();
        let _ = stdout
            .take(LOGIN_SHELL_OUTPUT_LIMIT + 1)
            .read_to_end(&mut output);
        let _ = sender.send(output);
    });

    let deadline = Instant::now() + KIMI_PROBE_TIMEOUT;
    let successful = loop {
        if Instant::now() >= deadline {
            terminate_isolated_probe(&mut child);
            let _ = child.wait();
            break false;
        }
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(_) => {
                terminate_isolated_probe(&mut child);
                break false;
            }
        }
    };
    let output = receiver
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .ok();
    terminate_isolated_probe(&mut child);
    let output = output?;
    if !successful || output.len() as u64 > LOGIN_SHELL_OUTPUT_LIMIT {
        return None;
    }
    parse_login_shell_output(&output)
}

#[cfg(not(unix))]
fn locate_from_login_shell() -> Option<PathBuf> {
    None
}

#[cfg(unix)]
fn configure_isolated_probe(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    // SAFETY: setsid is async-signal-safe and the closure performs no allocation or locking.
    unsafe {
        command.pre_exec(|| {
            nix::unistd::setsid()
                .map(|_| ())
                .map_err(|error| std::io::Error::from_raw_os_error(error as i32))
        });
    }
}

#[cfg(not(unix))]
fn configure_isolated_probe(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_isolated_probe(child: &mut std::process::Child) {
    use nix::{sys::signal, unistd::Pid};

    if let Ok(group) = i32::try_from(child.id()) {
        let _ = signal::killpg(Pid::from_raw(group), signal::Signal::SIGKILL);
    }
}

#[cfg(not(unix))]
fn terminate_isolated_probe(child: &mut std::process::Child) {
    let _ = child.kill();
}

#[cfg(unix)]
fn allowed_login_shell(shell: &Path) -> bool {
    if !shell.is_absolute() || !shell.is_file() {
        return false;
    }
    if matches!(shell.to_str(), Some("/bin/zsh" | "/bin/bash")) {
        return true;
    }
    fs::read_to_string("/etc/shells").ok().is_some_and(|raw| {
        raw.lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .any(|line| Path::new(line) == shell)
    })
}

fn parse_login_shell_output(output: &[u8]) -> Option<PathBuf> {
    String::from_utf8_lossy(output)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .rfind(|path| path.is_absolute())
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

    #[test]
    fn login_shell_parser_uses_last_absolute_path_and_ignores_noise() {
        let output = b"welcome\nrelative/kimi\n/first/kimi\nplugin output\n/final/kimi\n";
        assert_eq!(
            parse_login_shell_output(output),
            Some(PathBuf::from("/final/kimi"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn candidate_requires_executable_bit_and_kimi_web_contract() {
        use std::os::unix::fs::PermissionsExt;

        let root = env::temp_dir().join(format!(
            "kimi-locator-contract-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("kimi");
        fs::write(
            &path,
            b"#!/bin/sh\nif [ \"$1 $2\" = \"web --help\" ]; then echo '--no-open --allowed-host rotate-token'; exit 0; fi\nexit 1\n",
        )
        .unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(validate_kimi_candidate(&path).is_err());

        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            validate_kimi_candidate(&path).unwrap(),
            path.canonicalize().unwrap()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn legacy_semver_does_not_override_missing_web_command_family() {
        use std::os::unix::fs::PermissionsExt;

        let root = env::temp_dir().join(format!(
            "kimi-locator-legacy-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("kimi");
        fs::write(
            &path,
            b"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 1.99.0; exit 0; fi\nif [ \"$1 $2\" = \"web --help\" ]; then echo '--no-open --port'; exit 0; fi\nexit 1\n",
        )
        .unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();

        let error = validate_kimi_candidate(&path).unwrap_err();
        assert!(error.contains("web --help"));
        let _ = fs::remove_dir_all(root);
    }

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
