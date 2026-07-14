use super::config::resolve_working_directory;
use super::*;
use serde::Deserialize;
use std::io::BufRead;

const EXTERNAL_HEALTH_TIMEOUT: Duration = Duration::from_millis(800);
const EXTERNAL_MONITOR_INTERVAL: Duration = Duration::from_secs(2);
const EXTERNAL_MONITOR_FAILURE_LIMIT: u8 = 3;

#[derive(Debug, Clone, Deserialize)]
struct ExistingServerLock {
    pid: u32,
    host: String,
    port: u64,
    #[serde(default)]
    host_version: Option<String>,
}

enum ReuseAttempt {
    Ready {
        lock: ExistingServerLock,
        origin: String,
        token: token_resolver::ServerToken,
    },
    Stale,
    Blocked {
        message: String,
        target_port: u64,
    },
}

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
        runtime.runtime_ownership = RuntimeOwnership::Unavailable;
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
        runtime.runtime_ownership = RuntimeOwnership::Unavailable;
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
    runtime.runtime_ownership = RuntimeOwnership::Unavailable;
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
    let startup_started = Instant::now();
    let settings = settings_store::load_or_default(app).context("failed to load settings")?;
    let session_work_dir = {
        let state = app.state::<AppState>();
        let runtime = state
            .runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
        runtime.session_work_dir.clone()
    };
    let workdir_started = Instant::now();
    let work_dir = resolve_working_directory(&settings, session_work_dir.as_ref())
        .context("failed to resolve working directory")?;
    log_manager::append_line(
        app,
        format!(
            "startup_timing resolve_workdir_ms={}",
            workdir_started.elapsed().as_millis()
        ),
    );

    let rotate_started = Instant::now();
    log_manager::rotate_backend_log_if_needed(app)
        .context("failed to rotate backend log before startup")?;
    let log_path = log_manager::backend_log_path(app)?;
    super::redaction::redact_existing_log(&log_path)
        .context("failed to redact existing backend log before startup")?;
    log_manager::append_line(
        app,
        format!(
            "startup_timing rotate_backend_log_ms={}",
            rotate_started.elapsed().as_millis()
        ),
    );

    match try_reuse_existing_server(app) {
        ReuseAttempt::Ready {
            lock,
            origin,
            token,
        } => {
            append_backend_start_boundary(&log_path, generation, lock.port);
            log_manager::append_line(
                app,
                format!(
                    "reusing existing kimi-code server (pid={}, port={}, version={})",
                    lock.pid,
                    lock.port,
                    lock.host_version.as_deref().unwrap_or("unknown")
                ),
            );
            {
                let state = app.state::<AppState>();
                let mut runtime = state
                    .runtime
                    .lock()
                    .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
                if runtime.generation != generation {
                    return Ok(());
                }
                runtime.effective_work_dir = Some(work_dir.clone());
                runtime.launch_command = None;
            }
            let _ = skill_center::track_workspace_root(app, &work_dir);
            finish_ready(
                app,
                generation,
                lock.port as u16,
                origin,
                token,
                RuntimeOwnership::ReusedExternal,
                startup_started,
                0,
                0,
            )?;
            return Ok(());
        }
        ReuseAttempt::Blocked {
            message,
            target_port,
        } => {
            append_backend_start_boundary(&log_path, generation, target_port);
            set_crashed(app, generation, message);
            return Ok(());
        }
        ReuseAttempt::Stale => {}
    }

    let locate_started = Instant::now();
    let kimi_path = match kimi_locator::locate(&settings) {
        Ok(path) => path,
        Err(message) => {
            log_manager::append_line(
                app,
                format!(
                    "startup_timing locate_kimi_ms={} total_ms={}",
                    locate_started.elapsed().as_millis(),
                    startup_started.elapsed().as_millis()
                ),
            );
            set_missing_kimi(app, generation, message);
            return Ok(());
        }
    };
    log_manager::append_line(
        app,
        format!(
            "startup_timing locate_kimi_ms={}",
            locate_started.elapsed().as_millis()
        ),
    );
    log_manager::append_line(app, "startup_timing contract_check_ms=0 skipped=true");

    let base_port = match port_manager::choose_start_port() {
        Ok(port) => port,
        Err(error) => {
            set_crashed(
                app,
                generation,
                format!("No available kimi-code port: {error:#}"),
            );
            return Ok(());
        }
    };
    append_backend_start_boundary(&log_path, generation, u64::from(base_port));
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
    log_manager::append_line(app, "KIMI_CODE_NO_AUTO_UPDATE=1");

    let spawn_started = Instant::now();
    let mut child = match spawn_backend_process(
        &kimi_path,
        &work_dir,
        &command_args,
        &log_path,
        kimi_shell_path.as_ref(),
        agent_swarm_max_concurrency,
    ) {
        Ok(child) => child,
        Err(error) => {
            let probe = probe_kimi_server_contract(&kimi_path, kimi_shell_path.as_ref());
            set_crashed(
                app,
                generation,
                startup_failure_message(&error, probe, kimi_shell_path.is_none()),
            );
            return Ok(());
        }
    };
    log_manager::append_line(
        app,
        format!(
            "startup_timing spawn_ms={}",
            spawn_started.elapsed().as_millis()
        ),
    );

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

        runtime.child = None;
        runtime.state = BackendState::Starting;
        runtime.runtime_ownership = RuntimeOwnership::OwnedByShell;
        runtime.base_port = Some(base_port);
        runtime.active_port = None;
        runtime.workspace_port = None;
        runtime.last_error = None;
        runtime.detected_kimi_path = Some(kimi_path.clone());
        runtime.effective_work_dir = Some(work_dir.clone());
        runtime.launch_command = Some(launch_command);
    }
    let _ = skill_center::track_workspace_root(app, &work_dir);

    let health_started = Instant::now();
    let active_port = match port_manager::wait_for_ready_port(base_port, &mut child) {
        Ok(port) => port,
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "startup_timing health_wait_ms={} total_ms={}",
                    health_started.elapsed().as_millis(),
                    startup_started.elapsed().as_millis()
                ),
            );
            terminate_child_if_running(&mut child);
            match try_reuse_existing_server(app) {
                ReuseAttempt::Ready {
                    lock,
                    origin,
                    token,
                } => {
                    log_manager::append_line(
                        app,
                        format!(
                            "reusing kimi-code server after startup race (pid={}, port={})",
                            lock.pid, lock.port
                        ),
                    );
                    finish_ready(
                        app,
                        generation,
                        lock.port as u16,
                        origin,
                        token,
                        RuntimeOwnership::ReusedExternal,
                        startup_started,
                        health_started.elapsed().as_millis(),
                        0,
                    )?;
                    return Ok(());
                }
                ReuseAttempt::Blocked { message, .. } => {
                    set_crashed(app, generation, message);
                    return Ok(());
                }
                ReuseAttempt::Stale => {}
            }
            let probe = probe_kimi_server_contract(&kimi_path, kimi_shell_path.as_ref());
            set_crashed(
                app,
                generation,
                startup_failure_message(&error, probe, kimi_shell_path.is_none()),
            );
            return Ok(());
        }
    };
    let health_wait_ms = health_started.elapsed().as_millis();
    log_manager::append_line(
        app,
        format!("startup_timing health_wait_ms={health_wait_ms}"),
    );
    {
        let state = app.state::<AppState>();
        let mut runtime = state
            .runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
        if runtime.generation != generation {
            terminate_child(&mut child);
            return Ok(());
        }
        runtime.child = Some(child);
    }

    let token_started = Instant::now();
    let token = match token_resolver::resolve_server_token_with_retry() {
        Ok(token) => token,
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "startup_timing token_wait_ms={} total_ms={}",
                    token_started.elapsed().as_millis(),
                    startup_started.elapsed().as_millis()
                ),
            );
            stop_child_for_generation(app, generation);
            set_crashed(
                app,
                generation,
                format!("kimi-code server token unavailable after startup: {error:#}"),
            );
            return Ok(());
        }
    };
    let token_wait_ms = token_started.elapsed().as_millis();
    log_manager::append_line(app, format!("startup_timing token_wait_ms={token_wait_ms}"));
    let origin = format!("http://127.0.0.1:{active_port}");
    finish_ready(
        app,
        generation,
        active_port,
        origin,
        token,
        RuntimeOwnership::OwnedByShell,
        startup_started,
        health_wait_ms,
        token_wait_ms,
    )?;

    Ok(())
}

fn try_reuse_existing_server(app: &AppHandle) -> ReuseAttempt {
    let home = match token_resolver::resolve_kimi_code_home() {
        Ok(home) => home,
        Err(_) => return ReuseAttempt::Stale,
    };
    let lock_path = home.join("server").join("lock");
    let raw = match fs::read_to_string(&lock_path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return ReuseAttempt::Stale,
        Err(error) => {
            log_manager::append_line(app, format!("failed to read kimi server lock: {error}"));
            return ReuseAttempt::Stale;
        }
    };
    let lock = match parse_existing_server_lock(&raw) {
        Ok(lock) => lock,
        Err(error) => {
            log_manager::append_line(app, format!("ignored invalid kimi server lock: {error}"));
            return ReuseAttempt::Stale;
        }
    };
    let origin = match local_server_origin(&lock.host, lock.port) {
        Ok(origin) => origin,
        Err(error) => {
            return ReuseAttempt::Blocked {
                message: format!(
                    "检测到 Kimi Server lock（PID {}，端口 {}），但无法安全复用：{error}",
                    lock.pid, lock.port
                ),
                target_port: lock.port,
            };
        }
    };
    match probe_liveness(&origin) {
        Ok(()) => {}
        Err(error) if is_stale_liveness_error(&error) => {
            log_manager::append_line(
                app,
                format!(
                    "ignored stale kimi server lock (pid={}, port={}): {}",
                    lock.pid,
                    lock.port,
                    super::redaction::redact_backend_text(&error.to_string())
                ),
            );
            return ReuseAttempt::Stale;
        }
        Err(error) => {
            return ReuseAttempt::Blocked {
                message: format!(
                    "检测到 Kimi Server（PID {}，端口 {}），但健康检查失败：{}",
                    lock.pid,
                    lock.port,
                    super::redaction::redact_backend_text(&error.to_string())
                ),
                target_port: lock.port,
            };
        }
    }
    let token = match token_resolver::read_server_token_at(&home.join("server.token")) {
        Ok(token) => token,
        Err(error) => {
            return ReuseAttempt::Blocked {
                message: format!(
                    "检测到 Kimi Server lock（PID {}，端口 {}），但 server.token 不可用：{error:#}",
                    lock.pid, lock.port
                ),
                target_port: lock.port,
            };
        }
    };

    match probe_bearer_auth(&origin, &token.value) {
        Ok(()) => ReuseAttempt::Ready {
            lock,
            origin,
            token,
        },
        Err(error) => ReuseAttempt::Blocked {
            message: format!(
                "检测到 Kimi Server（PID {}，端口 {}），但 Bearer 健康验证失败：{}",
                lock.pid,
                lock.port,
                super::redaction::redact_backend_text(&error.to_string())
            ),
            target_port: lock.port,
        },
    }
}

fn parse_existing_server_lock(raw: &str) -> anyhow::Result<ExistingServerLock> {
    let lock: ExistingServerLock = serde_json::from_str(raw).context("lock JSON is invalid")?;
    if lock.pid == 0 {
        anyhow::bail!("lock PID is invalid");
    }
    Ok(lock)
}

fn local_server_origin(host: &str, port: u64) -> anyhow::Result<String> {
    let port = u16::try_from(port)
        .ok()
        .filter(|port| *port != 0)
        .context("端口无效")?;
    let host = match host
        .trim()
        .trim_matches(['[', ']'])
        .to_ascii_lowercase()
        .as_str()
    {
        "127.0.0.1" | "localhost" | "0.0.0.0" => "127.0.0.1",
        "::1" | "::" => "[::1]",
        _ => anyhow::bail!("host 不是本机回环地址"),
    };
    Ok(format!("http://{host}:{port}"))
}

fn probe_liveness(origin: &str) -> Result<(), reqwest::Error> {
    let client = reqwest::blocking::Client::builder()
        .timeout(EXTERNAL_HEALTH_TIMEOUT)
        .build()?;
    let origin = origin.trim_end_matches('/');
    client
        .get(format!("{origin}/api/v1/healthz"))
        .send()?
        .error_for_status()?;
    Ok(())
}

fn is_stale_liveness_error(error: &reqwest::Error) -> bool {
    error.is_connect() || (!error.is_timeout() && error.status().is_none())
}

fn probe_bearer_auth(origin: &str, token: &str) -> Result<(), reqwest::Error> {
    let client = reqwest::blocking::Client::builder()
        .timeout(EXTERNAL_HEALTH_TIMEOUT)
        .build()?;
    client
        .get(format!("{}/api/v1/auth", origin.trim_end_matches('/')))
        .bearer_auth(token)
        .send()?
        .error_for_status()?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn finish_ready(
    app: &AppHandle,
    generation: u64,
    port: u16,
    origin: String,
    token: token_resolver::ServerToken,
    ownership: RuntimeOwnership,
    startup_started: Instant,
    health_wait_ms: u128,
    token_wait_ms: u128,
) -> anyhow::Result<()> {
    let workspace_url = token_resolver::build_workspace_url(&origin, Some(&token.value));
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
        runtime.runtime_ownership = ownership;
        runtime.base_port = Some(port);
        runtime.active_port = Some(port);
        runtime.workspace_port = Some(port);
        runtime.runtime_origin = Some(origin.clone());
        runtime.server_token_path = Some(token.path.clone());
        runtime.server_token_redacted = Some(token.redacted.clone());
        runtime.workspace_url = Some(workspace_url);
        runtime.last_error = None;
        runtime.backend_ready_at_ms = Some(unix_time_millis());
        runtime.last_exit_reason = None;
    }
    write_runtime_locator_ready(
        app,
        &origin,
        &token.path,
        &token.redacted,
        generation,
        ownership,
    );
    log_manager::append_line(
        app,
        format!(
            "kimi-code DirectServer ready on {origin}; ownership={ownership:?}; token_path={}; token={}",
            token.path.display(),
            token.redacted
        ),
    );
    log_manager::append_line(
        app,
        format!(
            "startup_timing total_ms={} health_wait_ms={health_wait_ms} token_wait_ms={token_wait_ms}",
            startup_started.elapsed().as_millis()
        ),
    );
    window_manager::mark_backend_ready(app, "backend_ready");
    workspace_session::handle_backend_ready(app, generation, port);
    if ownership == RuntimeOwnership::OwnedByShell {
        spawn_monitor(app.clone(), generation);
    } else {
        spawn_external_monitor(app.clone(), generation, origin, token.value);
    }
    Ok(())
}

fn spawn_external_monitor(app: AppHandle, generation: u64, origin: String, token: String) {
    thread::spawn(move || {
        let mut failures = 0u8;
        loop {
            thread::sleep(EXTERNAL_MONITOR_INTERVAL);
            let should_continue = app
                .state::<AppState>()
                .runtime
                .lock()
                .map(|runtime| {
                    runtime.generation == generation
                        && runtime.state == BackendState::Running
                        && runtime.runtime_ownership == RuntimeOwnership::ReusedExternal
                })
                .unwrap_or(false);
            if !should_continue {
                return;
            }
            if probe_liveness(&origin).is_ok() && probe_bearer_auth(&origin, &token).is_ok() {
                failures = 0;
                continue;
            }
            failures = failures.saturating_add(1);
            if failures < EXTERNAL_MONITOR_FAILURE_LIMIT {
                continue;
            }
            set_crashed(
                &app,
                generation,
                format!("复用的 Kimi Server 已连续 {failures} 次未通过健康检查：{origin}"),
            );
            return;
        }
    });
}

fn append_backend_start_boundary(log_path: &Path, generation: u64, target_port: u64) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S %:z");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(
            file,
            "\n===== [{timestamp}] start cycle={generation} target_port={target_port} ====="
        );
    }
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
                    runtime.runtime_ownership = RuntimeOwnership::Unavailable;
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
                    runtime.runtime_ownership = RuntimeOwnership::Unavailable;
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
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .with_context(|| format!("failed to open backend log file: {}", log_path.display()))?;

    let mut command = Command::new(kimi_path);
    command_utils::configure_kimi_background_command(&mut command);
    command
        .args(args)
        // Force UTF-8 stdio so Python banner output does not crash on GBK consoles.
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .env("KIMI_CODE_NO_AUTO_UPDATE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(shell_path) = kimi_shell_path {
        command.env("KIMI_SHELL_PATH", shell_path);
    }
    if let Some(value) = agent_swarm_max_concurrency {
        command.env("KIMI_CODE_AGENT_SWARM_MAX_CONCURRENCY", value.to_string());
    }

    command.current_dir(work_dir);

    let mut child = command
        .spawn()
        .context("failed to spawn kimi-code server command")?;
    let redactor = Arc::new(super::redaction::SecretRedactor::from_system());
    let stdout = child
        .stdout
        .take()
        .context("kimi-code stdout pipe was unavailable")?;
    let stderr = child
        .stderr
        .take()
        .context("kimi-code stderr pipe was unavailable")?;
    spawn_backend_log_reader(stdout, log_path.clone(), redactor.clone());
    spawn_backend_log_reader(stderr, log_path.clone(), redactor);
    Ok(child)
}

fn spawn_backend_log_reader(
    stream: impl Read + Send + 'static,
    log_path: PathBuf,
    redactor: Arc<super::redaction::SecretRedactor>,
) {
    thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stream);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            let Ok(read) = reader.read_until(b'\n', &mut buffer) else {
                return;
            };
            if read == 0 {
                return;
            }
            let output = redactor.redact(&String::from_utf8_lossy(&buffer));
            // ponytail: open per line avoids retaining a Windows handle across log rotation;
            // use a joined writer thread if backend log volume becomes material.
            if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
                let _ = file.write_all(output.as_bytes());
            }
        }
    });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContractProbe {
    Supported,
    Incompatible,
    Unavailable,
    TimedOut,
}

fn probe_kimi_server_contract(
    kimi_path: &Path,
    kimi_shell_path: Option<&PathBuf>,
) -> ContractProbe {
    let mut command = Command::new(kimi_path);
    command_utils::configure_kimi_query_command(&mut command);
    command
        .args(["server", "run", "--help"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(shell_path) = kimi_shell_path {
        command.env("KIMI_SHELL_PATH", shell_path);
    }

    let Ok(mut child) = command.spawn() else {
        return ContractProbe::Unavailable;
    };
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    ContractProbe::Supported
                } else {
                    ContractProbe::Incompatible
                };
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(_) => return ContractProbe::Unavailable,
        }
    }
    force_terminate(child.id());
    let _ = child.wait();
    ContractProbe::TimedOut
}

fn startup_failure_message(
    error: &anyhow::Error,
    probe: ContractProbe,
    shell_missing: bool,
) -> String {
    let reason = error.to_string().chars().take(240).collect::<String>();
    let guidance = match probe {
        ContractProbe::Supported => {
            "已确认当前 Kimi 支持 `server run`；请查看脱敏后的 backend.log 获取具体原因。"
        }
        ContractProbe::Incompatible => {
            "当前可执行文件不支持 `server run`；请配置最新版 Kimi Code 的可执行文件。"
        }
        ContractProbe::Unavailable => "无法检查当前可执行文件；请确认 Kimi Code 路径。",
        ContractProbe::TimedOut => "Kimi 命令检查超时；请查看脱敏后的 backend.log。",
    };
    let shell_guidance = if cfg!(windows) && shell_missing {
        " Windows 还需要 Git Bash；请安装 Git for Windows 或配置 KIMI_SHELL_PATH。"
    } else {
        ""
    };
    format!("后端启动失败：{reason}。{guidance}{shell_guidance}")
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
        runtime.runtime_ownership = RuntimeOwnership::Unavailable;
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
    let message = super::redaction::redact_backend_text(&message);
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
        runtime.runtime_ownership = RuntimeOwnership::Unavailable;
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
    ownership: RuntimeOwnership,
) {
    let path = app.state::<AppState>().runtime_locator_path.clone();
    if let Err(error) = runtime_locator::write_ready(
        &path,
        origin,
        token_path,
        token_redacted,
        generation,
        ownership,
    ) {
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

fn terminate_child_if_running(child: &mut Child) {
    if child.try_wait().ok().flatten().is_none() {
        terminate_child(child);
    }
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
    use std::net::TcpListener;

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

    #[test]
    fn startup_failure_guidance_distinguishes_contract_results() {
        let error = anyhow::anyhow!("backend exited");
        let supported = startup_failure_message(&error, ContractProbe::Supported, false);
        let incompatible = startup_failure_message(&error, ContractProbe::Incompatible, false);
        let unavailable = startup_failure_message(&error, ContractProbe::Unavailable, false);
        let timed_out = startup_failure_message(&error, ContractProbe::TimedOut, false);

        assert!(supported.contains("支持 `server run`"));
        assert!(incompatible.contains("不支持 `server run`"));
        assert!(unavailable.contains("无法检查"));
        assert!(timed_out.contains("检查超时"));
        assert!(supported.len() < 400);
    }

    #[test]
    fn server_lock_parser_is_version_tolerant_and_rejects_damage() {
        let lock = parse_existing_server_lock(
            r#"{"pid":13288,"host":"localhost","port":55695,"host_version":"0.23.6","future":true}"#,
        )
        .expect("valid lock");

        assert_eq!(lock.pid, 13288);
        assert_eq!(lock.host_version.as_deref(), Some("0.23.6"));
        assert_eq!(
            local_server_origin(&lock.host, lock.port).unwrap(),
            "http://127.0.0.1:55695"
        );
        assert!(parse_existing_server_lock("not-json").is_err());
        assert!(
            parse_existing_server_lock(r#"{"pid":0,"host":"localhost","port":55695}"#).is_err()
        );
        assert_eq!(
            local_server_origin("0.0.0.0", 55695).unwrap(),
            "http://127.0.0.1:55695"
        );
        assert_eq!(
            local_server_origin("::", 55695).unwrap(),
            "http://[::1]:55695"
        );
        assert!(local_server_origin("127.0.0.1", 0).is_err());
        assert!(local_server_origin("127.0.0.1", 70_000).is_err());
    }

    #[test]
    fn bearer_health_probe_sends_token_and_rejects_unauthorized() {
        let server = Server::http("127.0.0.1:0").expect("server");
        let origin = format!("http://{}", server.server_addr());
        let (sender, receiver) = std::sync::mpsc::channel();
        thread::spawn(move || {
            for _ in 0..2 {
                let request = server.recv().expect("request");
                let authorized = request.headers().iter().any(|header| {
                    header.field.equiv("Authorization")
                        && header.value.as_str() == "Bearer expected"
                });
                sender
                    .send((request.url().to_string(), authorized))
                    .expect("capture");
                request.respond(Response::empty(200)).expect("response");
            }
        });
        probe_liveness(&origin).expect("healthy server");
        probe_bearer_auth(&origin, "expected").expect("authenticated server");
        let requests = [receiver.recv().unwrap(), receiver.recv().unwrap()];
        assert_eq!(requests[0].0, "/api/v1/healthz");
        assert_eq!(requests[1].0, "/api/v1/auth");
        assert!(!requests[0].1);
        assert!(requests[1].1);

        let server = Server::http("127.0.0.1:0").expect("server");
        let origin = format!("http://{}", server.server_addr());
        thread::spawn(move || {
            let request = server.recv().expect("request");
            let authorized = request.headers().iter().any(|header| {
                header.field.equiv("Authorization") && header.value.as_str() == "Bearer expected"
            });
            request
                .respond(Response::empty(if authorized { 200 } else { 401 }))
                .expect("response");
        });
        assert!(probe_bearer_auth(&origin, "wrong").is_err());

        let listener = TcpListener::bind("127.0.0.1:0").expect("port");
        let stale_origin = format!("http://{}", listener.local_addr().expect("address"));
        drop(listener);
        let error = probe_liveness(&stale_origin).expect_err("stale server must fail");
        assert!(is_stale_liveness_error(&error));

        let server = Server::http("127.0.0.1:0").expect("server");
        let origin = format!("http://{}", server.server_addr());
        thread::spawn(move || {
            server
                .recv()
                .expect("request")
                .respond(Response::empty(503))
                .expect("response");
        });
        let error = probe_liveness(&origin).expect_err("unhealthy server must fail");
        assert!(!is_stale_liveness_error(&error));
    }
}
