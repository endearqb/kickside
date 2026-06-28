use super::config::resolve_working_directory;
use super::*;

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
        runtime.workspace_port = None;
        runtime.base_port = None;
        runtime.last_error = None;
        runtime.effective_work_dir = None;
        runtime.launch_command = None;
        runtime.runtime_origin = None;
        runtime.server_token_path = None;
        runtime.server_token_redacted = None;
        runtime.workspace_url = None;
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

    workspace_session::clear_active_session_runtime(&app, "start_backend");
    write_runtime_locator_unavailable(&app, generation, "start_backend");

    if let Some(mut stale_child) = stale_child {
        let reason = terminate_child(&mut stale_child);
        log_manager::append_line(
            &app,
            format!("terminated stale backend process before start ({reason})"),
        );
    }

    window_manager::enter_local_boot(&app, "backend_start");
    log_manager::append_line(
        &app,
        format!("starting kimi-code DirectServer backend (cycle={generation})"),
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
    let stop_started = Instant::now();
    log_manager::append_line(app, "shutdown stage=stop_backend_begin");

    let child = {
        let state = app.state::<AppState>();
        let mut runtime = state
            .runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;

        runtime.generation = runtime.generation.saturating_add(1);
        runtime.state = BackendState::Stopping;
        runtime.active_port = None;
        runtime.workspace_port = None;
        runtime.base_port = None;
        runtime.last_error = None;
        runtime.effective_work_dir = None;
        runtime.launch_command = None;
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
    runtime.workspace_port = None;
    runtime.base_port = None;
    runtime.child = None;
    runtime.last_error = None;
    runtime.effective_work_dir = None;
    runtime.launch_command = None;
    runtime.runtime_origin = None;
    runtime.server_token_path = None;
    runtime.server_token_redacted = None;
    runtime.workspace_url = None;
    runtime.start_requested_at_ms = None;
    runtime.loading_reported_at_ms = None;
    runtime.loading_reported_cycle_id = None;
    runtime.backend_ready_at_ms = None;
    runtime.last_exit_reason = termination_reason.clone();
    runtime.active_session_id = None;
    runtime.active_session_work_dir = None;
    runtime.session_source = Some("cleared:stop_backend".to_string());
    let stop_generation = runtime.generation;
    drop(runtime);

    workspace_session::clear_active_session_runtime(app, "stop_backend");
    write_runtime_locator_unavailable(app, stop_generation, "stop_backend");

    if let Some(reason) = termination_reason {
        log_manager::append_line(app, format!("backend stopped ({reason})"));
    } else {
        log_manager::append_line(app, "backend stopped");
    }
    log_manager::append_line(
        app,
        format!(
            "shutdown stage=stop_backend_done elapsed_ms={}",
            stop_started.elapsed().as_millis()
        ),
    );
    Ok(())
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

    if let Err(error) = cli_contract::verify_kimi_server_contract(&kimi_path) {
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
            format!("`kimi server run` CLI contract check failed: {error}"),
        );
        return Ok(());
    }

    let work_dir = resolve_working_directory(&settings, session_work_dir.as_ref())
        .context("failed to resolve working directory")?;

    log_manager::rotate_backend_log_if_needed(app)
        .context("failed to rotate backend log before startup")?;

    let base_port = port_manager::choose_start_port();
    let log_path = log_manager::backend_log_path(app)?;
    let command_args = build_kimi_server_args(base_port);
    let launch_command = format!("{} {}", kimi_path.display(), command_args.join(" "));
    let kimi_shell_path = kimi_locator::locate_shell_path();
    let agent_swarm_max_concurrency = settings.kimi_runtime_launch.agent_swarm_max_concurrency;

    let command_description = format!(
        "launch command: {} (cwd: {})",
        launch_command,
        work_dir.display()
    );
    log_manager::append_line(app, command_description);
    if let Some(shell_path) = &kimi_shell_path {
        log_manager::append_line(app, format!("KIMI_SHELL_PATH={}", shell_path.display()));
    }
    if let Some(value) = agent_swarm_max_concurrency {
        log_manager::append_line(
            app,
            format!("KIMI_CODE_AGENT_SWARM_MAX_CONCURRENCY={value}"),
        );
    }

    let child = spawn_backend_process(
        &kimi_path,
        &work_dir,
        &command_args,
        &log_path,
        kimi_shell_path.as_ref(),
        agent_swarm_max_concurrency,
    )
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
        runtime.workspace_port = None;
        runtime.last_error = None;
        runtime.detected_kimi_path = Some(kimi_path.clone());
        runtime.effective_work_dir = Some(work_dir.clone());
        runtime.launch_command = Some(launch_command);
        runtime.cli_contract_ok = Some(true);
        runtime.cli_contract_error = None;
    }
    let _ = skill_center::track_workspace_root(app, &work_dir);

    let Some(active_port) = port_manager::wait_for_ready_port(base_port) else {
        stop_child_for_generation(app, generation);
        set_crashed(
            app,
            generation,
            format!(
                "Startup timed out. No kimi-code health response on ports {}-{} within {} seconds.",
                base_port,
                base_port + (port_manager::PORT_SCAN_COUNT - 1),
                port_manager::STARTUP_TIMEOUT_SECS
            ),
        );
        return Ok(());
    };

    let token = match token_resolver::resolve_server_token_with_retry() {
        Ok(token) => token,
        Err(error) => {
            stop_child_for_generation(app, generation);
            set_crashed(
                app,
                generation,
                format!("kimi-code server token unavailable after startup: {error:#}"),
            );
            return Ok(());
        }
    };
    let origin = format!("http://127.0.0.1:{active_port}");
    let workspace_url = token_resolver::build_workspace_url(&origin, Some(&token.value));
    let workspace_port = active_port;

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
        runtime.workspace_port = Some(workspace_port);
        runtime.runtime_origin = Some(origin.clone());
        runtime.server_token_path = Some(token.path.clone());
        runtime.server_token_redacted = Some(token.redacted.clone());
        runtime.workspace_url = Some(workspace_url);
        runtime.last_error = None;
        runtime.backend_ready_at_ms = Some(unix_time_millis());
        runtime.last_exit_reason = None;
    }
    write_runtime_locator_ready(app, &origin, &token.path, &token.redacted, generation);

    log_manager::append_line(
        app,
        format!(
            "kimi-code DirectServer ready on {origin}; token_path={}; token={}",
            token.path.display(),
            token.redacted
        ),
    );
    window_manager::mark_backend_ready(app, "backend_ready");
    workspace_session::handle_backend_ready(app, generation, workspace_port);
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
                    runtime.workspace_port = None;
                    runtime.runtime_origin = None;
                    runtime.server_token_path = None;
                    runtime.server_token_redacted = None;
                    runtime.workspace_url = None;
                    runtime.last_exit_reason = Some(format!("process_exit:{status}"));

                    if matches!(
                        runtime.state,
                        BackendState::Running | BackendState::Starting
                    ) {
                        let message = format!("kimi-code server exited unexpectedly: {status}");
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
                    runtime.workspace_port = None;
                    runtime.runtime_origin = None;
                    runtime.server_token_path = None;
                    runtime.server_token_redacted = None;
                    runtime.workspace_url = None;
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
            workspace_session::clear_active_session_runtime(&app, "monitor_crash");
            write_runtime_locator_unavailable(&app, generation, "monitor_crash");
            log_manager::append_line(&app, &message);
            window_manager::show_control_center(&app, "monitor_crash");
            return;
        }
    });
}

fn spawn_backend_process(
    kimi_path: &PathBuf,
    work_dir: &PathBuf,
    args: &[String],
    log_path: &PathBuf,
    kimi_shell_path: Option<&PathBuf>,
    agent_swarm_max_concurrency: Option<u32>,
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
    command_utils::configure_kimi_background_command(&mut command);
    command
        .args(args)
        // Force UTF-8 stdio so Python banner output does not crash on GBK consoles.
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file));

    if let Some(shell_path) = kimi_shell_path {
        command.env("KIMI_SHELL_PATH", shell_path);
    }
    if let Some(value) = agent_swarm_max_concurrency {
        command.env("KIMI_CODE_AGENT_SWARM_MAX_CONCURRENCY", value.to_string());
    }

    command.current_dir(work_dir);

    command
        .spawn()
        .context("failed to spawn kimi-code server command")
}

fn build_kimi_server_args(base_port: u16) -> Vec<String> {
    vec![
        "server".to_string(),
        "run".to_string(),
        "--foreground".to_string(),
        "--port".to_string(),
        base_port.to_string(),
    ]
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
        runtime.workspace_port = None;
        runtime.state = BackendState::MissingKimi;
        runtime.last_error = Some(message.clone());
        runtime.detected_kimi_path = None;
        runtime.effective_work_dir = None;
        runtime.launch_command = None;
        runtime.runtime_origin = None;
        runtime.server_token_path = None;
        runtime.server_token_redacted = None;
        runtime.workspace_url = None;
        runtime.backend_ready_at_ms = None;
        runtime.last_exit_reason = Some("missing_kimi".to_string());
        runtime.active_session_id = None;
        runtime.active_session_work_dir = None;
        runtime.session_source = Some("cleared:missing_kimi".to_string());
    }

    workspace_session::clear_active_session_runtime(app, "missing_kimi");
    write_runtime_locator_unavailable(app, generation, "missing_kimi");
    log_manager::append_line(app, &message);
    window_manager::show_missing_kimi(app, "missing_kimi");
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
        runtime.workspace_port = None;
        runtime.state = BackendState::Crashed;
        runtime.last_error = Some(message.clone());
        runtime.backend_ready_at_ms = None;
        runtime.last_exit_reason = Some("startup_failed".to_string());
        runtime.runtime_origin = None;
        runtime.server_token_path = None;
        runtime.server_token_redacted = None;
        runtime.workspace_url = None;
        runtime.active_session_id = None;
        runtime.active_session_work_dir = None;
        runtime.session_source = Some("cleared:crashed".to_string());
    }

    workspace_session::clear_active_session_runtime(app, "crashed");
    write_runtime_locator_unavailable(app, generation, "crashed");
    log_manager::append_line(app, &message);
    window_manager::show_control_center(app, "backend_crashed");
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

fn write_runtime_locator_ready(
    app: &AppHandle,
    origin: &str,
    token_path: &Path,
    token_redacted: &str,
    generation: u64,
) {
    let path = app.state::<AppState>().runtime_locator_path.clone();
    if let Err(error) =
        runtime_locator::write_ready(&path, origin, token_path, token_redacted, generation)
    {
        log_manager::append_line(
            app,
            format!("failed to write kimi runtime locator ready snapshot: {error:#}"),
        );
    }
}

fn write_runtime_locator_unavailable(app: &AppHandle, generation: u64, source: &str) {
    let path = app.state::<AppState>().runtime_locator_path.clone();
    if let Err(error) = runtime_locator::write_unavailable(&path, generation) {
        log_manager::append_line(
            app,
            format!("failed to write kimi runtime locator unavailable snapshot (source={source}): {error:#}"),
        );
    }
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
    let mut command = Command::new("taskkill");
    command_utils::configure_system_command(&mut command);
    let _ = command.args(["/PID", &pid.to_string(), "/T"]).status();
}

#[cfg(windows)]
fn force_terminate(pid: u32) {
    let mut command = Command::new("taskkill");
    command_utils::configure_system_command(&mut command);
    let _ = command
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status();
}

#[cfg(not(any(unix, windows)))]
fn soft_terminate(_pid: u32) {}

#[cfg(not(any(unix, windows)))]
fn force_terminate(_pid: u32) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_args_enforce_local_only_mode() {
        let args = build_kimi_server_args(57999);
        let args_joined = args.join(" ");
        assert!(args_joined.contains("server run"));
        assert!(args_joined.contains("--foreground"));
        assert!(args_joined.contains("--port 57999"));
        assert!(!args_joined.contains("--open"));
        assert!(!args_joined.contains("--network"));
        assert!(!args_joined.contains("--public"));
    }
}
