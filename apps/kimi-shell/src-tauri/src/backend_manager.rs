use std::{
    fs::OpenOptions,
    path::PathBuf,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use anyhow::Context;
use tauri::{AppHandle, Manager};

use crate::{
    app_state::{unix_time_millis, AppState},
    cli_contract, kimi_locator, log_manager, port_manager, settings_store,
    types::{AppSettings, BackendState, CURRENT_ONBOARDING_VERSION},
    window_manager,
};

const SHUTDOWN_TIMEOUT_SECS: u64 = 4;
const KIMI_HOST: &str = "127.0.0.1";

pub fn start_backend(app: AppHandle) {
    let (generation, stale_child) = {
        let state = app.state::<AppState>();
        let mut runtime = match state.runtime.lock() {
            Ok(lock) => lock,
            Err(_) => return,
        };

        if matches!(
            runtime.state,
            BackendState::Starting | BackendState::Running | BackendState::Stopping
        ) {
            return;
        }

        let stale_child = runtime.child.take();
        runtime.state = BackendState::Starting;
        runtime.active_port = None;
        runtime.base_port = None;
        runtime.last_error = None;
        runtime.effective_work_dir = None;
        runtime.launch_command = None;
        runtime.pending_remote_port = None;
        runtime.generation = runtime.generation.saturating_add(1);
        runtime.start_cycle_id = runtime.generation;
        runtime.start_requested_at_ms = Some(unix_time_millis());
        runtime.loading_reported_at_ms = None;
        runtime.loading_reported_cycle_id = None;
        runtime.backend_ready_at_ms = None;
        runtime.cli_contract_ok = None;
        runtime.cli_contract_error = None;
        runtime.last_exit_reason = None;
        (runtime.generation, stale_child)
    };

    if let Some(mut stale_child) = stale_child {
        let reason = terminate_child(&mut stale_child);
        log_manager::append_line(
            &app,
            format!("terminated stale backend process before start ({reason})"),
        );
    }

    window_manager::navigate_loading(&app);
    log_manager::append_line(
        &app,
        format!("starting kimi web backend (cycle={generation})"),
    );

    thread::spawn(move || {
        if let Err(error) = run_start_sequence(&app, generation) {
            let message = format!("backend start failed: {error:#}");
            set_crashed(&app, generation, message);
        }
    });
}

pub fn restart_backend(app: AppHandle) {
    if let Err(error) = stop_backend(&app) {
        log_manager::append_line(
            &app,
            format!("failed to stop backend during restart: {error:#}"),
        );
    }
    start_backend(app);
}

pub fn set_session_work_dir(app: &AppHandle, work_dir: Option<PathBuf>) -> anyhow::Result<()> {
    if let Some(path) = work_dir.as_ref() {
        if !path.exists() {
            return Err(anyhow::anyhow!(
                "session work directory does not exist: {}",
                path.display()
            ));
        }
        if !path.is_dir() {
            return Err(anyhow::anyhow!(
                "session work directory is not a folder: {}",
                path.display()
            ));
        }
    }

    let state = app.state::<AppState>();
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
    runtime.session_work_dir = work_dir;
    Ok(())
}

pub fn stop_backend(app: &AppHandle) -> anyhow::Result<()> {
    let child = {
        let state = app.state::<AppState>();
        let mut runtime = state
            .runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;

        runtime.generation = runtime.generation.saturating_add(1);
        runtime.state = BackendState::Stopping;
        runtime.active_port = None;
        runtime.base_port = None;
        runtime.last_error = None;
        runtime.effective_work_dir = None;
        runtime.launch_command = None;
        runtime.pending_remote_port = None;
        runtime.backend_ready_at_ms = None;
        runtime.child.take()
    };

    let mut termination_reason = None;
    if let Some(mut child) = child {
        termination_reason = Some(terminate_child(&mut child).to_string());
    }

    let state = app.state::<AppState>();
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
    runtime.state = BackendState::Stopped;
    runtime.active_port = None;
    runtime.base_port = None;
    runtime.child = None;
    runtime.last_error = None;
    runtime.effective_work_dir = None;
    runtime.launch_command = None;
    runtime.pending_remote_port = None;
    runtime.start_requested_at_ms = None;
    runtime.loading_reported_at_ms = None;
    runtime.loading_reported_cycle_id = None;
    runtime.backend_ready_at_ms = None;
    runtime.last_exit_reason = termination_reason.clone();

    if let Some(reason) = termination_reason {
        log_manager::append_line(app, format!("backend stopped ({reason})"));
    } else {
        log_manager::append_line(app, "backend stopped");
    }
    Ok(())
}

pub fn open_logs_folder(app: &AppHandle) -> Result<(), String> {
    let logs_dir = log_manager::ensure_logs_dir(app).map_err(|error| error.to_string())?;
    open_with_system_file_manager(&logs_dir).map_err(|error| error.to_string())
}

fn run_start_sequence(app: &AppHandle, generation: u64) -> anyhow::Result<()> {
    let settings = settings_store::load_or_default(app).context("failed to load settings")?;
    let session_work_dir = {
        let state = app.state::<AppState>();
        let runtime = state
            .runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
        runtime.session_work_dir.clone()
    };
    let kimi_path = match kimi_locator::locate(&settings) {
        Ok(path) => path,
        Err(message) => {
            set_missing_kimi(app, generation, message);
            return Ok(());
        }
    };

    if let Err(error) = cli_contract::verify_kimi_web_contract(&kimi_path) {
        {
            let state = app.state::<AppState>();
            let mut runtime = state
                .runtime
                .lock()
                .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
            if runtime.generation == generation {
                runtime.cli_contract_ok = Some(false);
                runtime.cli_contract_error = Some(error.clone());
            }
        }
        set_crashed(
            app,
            generation,
            format!("`kimi web` CLI contract check failed: {error}"),
        );
        return Ok(());
    }

    let work_dir = resolve_working_directory(&settings, session_work_dir.as_ref())
        .context("failed to resolve working directory")?;

    log_manager::rotate_backend_log_if_needed(app)
        .context("failed to rotate backend log before startup")?;

    let base_port = port_manager::choose_start_port();
    let log_path = log_manager::backend_log_path(app)?;
    let command_args = build_kimi_web_args(base_port);
    let launch_command = format!("{} {}", kimi_path.display(), command_args.join(" "));

    let command_description = format!(
        "launch command: {} (cwd: {})",
        launch_command,
        work_dir.display()
    );
    log_manager::append_line(app, command_description);

    let child = spawn_backend_process(&kimi_path, &work_dir, &command_args, &log_path)
        .with_context(|| format!("failed to spawn kimi process from {}", kimi_path.display()))?;

    {
        let state = app.state::<AppState>();
        let mut runtime = state
            .runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
        if runtime.generation != generation {
            let mut stale_child = child;
            terminate_child(&mut stale_child);
            return Ok(());
        }

        runtime.child = Some(child);
        runtime.state = BackendState::Starting;
        runtime.base_port = Some(base_port);
        runtime.active_port = None;
        runtime.last_error = None;
        runtime.detected_kimi_path = Some(kimi_path.clone());
        runtime.effective_work_dir = Some(work_dir.clone());
        runtime.launch_command = Some(launch_command);
        runtime.cli_contract_ok = Some(true);
        runtime.cli_contract_error = None;
    }

    let Some(active_port) = port_manager::wait_for_ready_port(base_port) else {
        stop_child_for_generation(app, generation);
        set_crashed(
            app,
            generation,
            format!(
                "Startup timed out. No /healthz response on ports {}-{} within {} seconds.",
                base_port,
                base_port + (port_manager::PORT_SCAN_COUNT - 1),
                port_manager::STARTUP_TIMEOUT_SECS
            ),
        );
        return Ok(());
    };

    {
        let state = app.state::<AppState>();
        let mut runtime = state
            .runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
        if runtime.generation != generation {
            return Ok(());
        }

        runtime.state = BackendState::Running;
        runtime.active_port = Some(active_port);
        runtime.last_error = None;
        runtime.backend_ready_at_ms = Some(unix_time_millis());
        runtime.last_exit_reason = None;
    }

    log_manager::append_line(app, format!("backend ready on port {active_port}"));
    if should_defer_remote_navigation(app, &settings) {
        {
            let state = app.state::<AppState>();
            let mut runtime = state
                .runtime
                .lock()
                .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
            if runtime.generation == generation {
                runtime.pending_remote_port = Some(active_port);
            }
        }
        log_manager::append_line(
            app,
            "holding remote navigation until onboarding is completed",
        );
        window_manager::navigate_onboarding(app);
    } else {
        {
            let state = app.state::<AppState>();
            let mut runtime = state
                .runtime
                .lock()
                .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
            if runtime.generation == generation {
                runtime.pending_remote_port = None;
            }
        }
        window_manager::navigate_remote(app, active_port);
    }
    spawn_monitor(app.clone(), generation);

    Ok(())
}

fn spawn_monitor(app: AppHandle, generation: u64) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(400));

        let crash_message = {
            let state = app.state::<AppState>();
            let mut runtime = match state.runtime.lock() {
                Ok(lock) => lock,
                Err(_) => return,
            };

            if runtime.generation != generation {
                return;
            }

            let Some(child) = runtime.child.as_mut() else {
                return;
            };

            match child.try_wait() {
                Ok(Some(status)) => {
                    runtime.child = None;
                    runtime.active_port = None;
                    runtime.last_exit_reason = Some(format!("process_exit:{status}"));

                    if matches!(
                        runtime.state,
                        BackendState::Running | BackendState::Starting
                    ) {
                        let message = format!("kimi web exited unexpectedly: {status}");
                        runtime.state = BackendState::Crashed;
                        runtime.last_error = Some(message.clone());
                        Some(message)
                    } else {
                        None
                    }
                }
                Ok(None) => None,
                Err(error) => {
                    runtime.child = None;
                    runtime.active_port = None;
                    runtime.last_exit_reason = Some("monitor_error".to_string());
                    if matches!(
                        runtime.state,
                        BackendState::Running | BackendState::Starting
                    ) {
                        let message = format!("failed to monitor kimi process: {error}");
                        runtime.state = BackendState::Crashed;
                        runtime.last_error = Some(message.clone());
                        Some(message)
                    } else {
                        None
                    }
                }
            }
        };

        if let Some(message) = crash_message {
            log_manager::append_line(&app, &message);
            window_manager::navigate_error(&app);
            return;
        }
    });
}

fn spawn_backend_process(
    kimi_path: &PathBuf,
    work_dir: &PathBuf,
    args: &[String],
    log_path: &PathBuf,
) -> anyhow::Result<Child> {
    let stdout_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .with_context(|| format!("failed to open backend log file: {}", log_path.display()))?;
    let stderr_file = stdout_file
        .try_clone()
        .context("failed to clone log file handle for stderr")?;

    let mut command = Command::new(kimi_path);
    command
        .args(args)
        // Force UTF-8 stdio so Python banner output does not crash on GBK consoles.
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file));

    command.current_dir(work_dir);

    command.spawn().context("failed to spawn kimi web command")
}

fn build_kimi_web_args(base_port: u16) -> Vec<String> {
    vec![
        "web".to_string(),
        "--no-open".to_string(),
        "--host".to_string(),
        KIMI_HOST.to_string(),
        "--port".to_string(),
        base_port.to_string(),
    ]
}

fn resolve_working_directory(
    settings: &AppSettings,
    session_work_dir: Option<&PathBuf>,
) -> anyhow::Result<PathBuf> {
    if let Some(session_dir) = session_work_dir {
        if !session_dir.exists() {
            return Err(anyhow::anyhow!(
                "Session work directory does not exist: {}",
                session_dir.display()
            ));
        }
        if !session_dir.is_dir() {
            return Err(anyhow::anyhow!(
                "Session work directory is not a folder: {}",
                session_dir.display()
            ));
        }
        return Ok(session_dir.clone());
    }

    if let Some(configured) = settings
        .work_dir
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let work_dir = PathBuf::from(configured);
        if !work_dir.exists() {
            return Err(anyhow::anyhow!(
                "Configured work directory does not exist: {}",
                work_dir.display()
            ));
        }
        if !work_dir.is_dir() {
            return Err(anyhow::anyhow!(
                "Configured work directory is not a folder: {}",
                work_dir.display()
            ));
        }

        return Ok(work_dir);
    }

    default_working_directory()
        .ok_or_else(|| anyhow::anyhow!("failed to determine default work directory"))
}

fn default_working_directory() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| std::env::current_dir().ok())
}

fn set_missing_kimi(app: &AppHandle, generation: u64, message: String) {
    {
        let state = app.state::<AppState>();
        let mut runtime = match state.runtime.lock() {
            Ok(lock) => lock,
            Err(_) => return,
        };

        if runtime.generation != generation {
            return;
        }

        runtime.child = None;
        runtime.base_port = None;
        runtime.active_port = None;
        runtime.state = BackendState::MissingKimi;
        runtime.last_error = Some(message.clone());
        runtime.detected_kimi_path = None;
        runtime.effective_work_dir = None;
        runtime.launch_command = None;
        runtime.backend_ready_at_ms = None;
        runtime.pending_remote_port = None;
        runtime.last_exit_reason = Some("missing_kimi".to_string());
    }

    log_manager::append_line(app, &message);
    window_manager::navigate_missing_kimi(app);
}

fn set_crashed(app: &AppHandle, generation: u64, message: String) {
    {
        let state = app.state::<AppState>();
        let mut runtime = match state.runtime.lock() {
            Ok(lock) => lock,
            Err(_) => return,
        };

        if runtime.generation != generation {
            return;
        }

        runtime.child = None;
        runtime.base_port = None;
        runtime.active_port = None;
        runtime.state = BackendState::Crashed;
        runtime.last_error = Some(message.clone());
        runtime.backend_ready_at_ms = None;
        runtime.pending_remote_port = None;
        runtime.last_exit_reason = Some("startup_failed".to_string());
    }

    log_manager::append_line(app, &message);
    window_manager::navigate_error(app);
}

fn stop_child_for_generation(app: &AppHandle, generation: u64) {
    let child = {
        let state = app.state::<AppState>();
        let mut runtime = match state.runtime.lock() {
            Ok(lock) => lock,
            Err(_) => return,
        };

        if runtime.generation != generation {
            return;
        }

        runtime.child.take()
    };

    if let Some(mut child) = child {
        let reason = terminate_child(&mut child).to_string();
        let state = app.state::<AppState>();
        let lock_result = state.runtime.lock();
        if let Ok(mut runtime) = lock_result {
            if runtime.generation == generation {
                runtime.last_exit_reason = Some(format!("stop_child_for_generation:{reason}"));
            }
        }
    }
}

pub fn release_pending_remote_navigation(app: &AppHandle) -> anyhow::Result<()> {
    let target_port = {
        let state = app.state::<AppState>();
        let mut runtime = state
            .runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
        runtime.pending_remote_port.take().or(runtime.active_port)
    };

    if let Some(port) = target_port {
        window_manager::navigate_remote(app, port);
    }

    Ok(())
}

fn should_defer_remote_navigation(app: &AppHandle, settings: &AppSettings) -> bool {
    if settings.onboarding_completed_version >= CURRENT_ONBOARDING_VERSION {
        return false;
    }

    let state = app.state::<AppState>();
    if let Ok(runtime) = state.runtime.lock() {
        if runtime.startup_open_request_applied {
            return false;
        }
    }

    true
}

fn terminate_child(child: &mut Child) -> &'static str {
    let pid = child.id();
    soft_terminate(pid);

    let deadline = Instant::now() + Duration::from_secs(SHUTDOWN_TIMEOUT_SECS);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return "graceful_exit",
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(_) => break,
        }
    }

    force_terminate(pid);
    let _ = child.wait();
    "force_kill"
}

#[cfg(unix)]
fn soft_terminate(pid: u32) {
    use nix::{sys::signal, unistd::Pid};
    let _ = signal::kill(Pid::from_raw(pid as i32), signal::Signal::SIGTERM);
}

#[cfg(unix)]
fn force_terminate(pid: u32) {
    use nix::{sys::signal, unistd::Pid};
    let _ = signal::kill(Pid::from_raw(pid as i32), signal::Signal::SIGKILL);
}

#[cfg(windows)]
fn soft_terminate(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T"])
        .status();
}

#[cfg(windows)]
fn force_terminate(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status();
}

#[cfg(not(any(unix, windows)))]
fn soft_terminate(_pid: u32) {}

#[cfg(not(any(unix, windows)))]
fn force_terminate(_pid: u32) {}

fn open_with_system_file_manager(path: &PathBuf) -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .context("failed to open logs folder with explorer")?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .context("failed to open logs folder with open")?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .context("failed to open logs folder with xdg-open")?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err(anyhow::anyhow!(
        "unsupported platform for opening logs folder"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_args_enforce_local_only_mode() {
        let args = build_kimi_web_args(57999);
        let args_joined = args.join(" ");
        assert!(args_joined.contains("web"));
        assert!(args_joined.contains("--no-open"));
        assert!(args_joined.contains("--host 127.0.0.1"));
        assert!(args_joined.contains("--port 57999"));
        assert!(!args_joined.contains("--network"));
        assert!(!args_joined.contains("--public"));
    }
}
