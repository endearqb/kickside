use super::config::resolve_working_directory;
use super::instance_registry::{self, ServerInstance};
use super::*;
use crate::app_state::RuntimeState;
use serde::Deserialize;
use std::{collections::HashSet, io::BufRead};

const EXTERNAL_HEALTH_TIMEOUT: Duration = Duration::from_millis(800);
const EXTERNAL_MONITOR_INTERVAL: Duration = Duration::from_secs(2);
const EXTERNAL_MONITOR_FAILURE_LIMIT: u8 = 3;
const OWNED_REGISTRY_TIMEOUT: Duration = Duration::from_secs(15);
const OWNED_FAST_POLL_WINDOW: Duration = Duration::from_secs(2);
const OWNED_FAST_POLL_INTERVAL: Duration = Duration::from_millis(100);
const OWNED_SLOW_POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Deserialize)]
struct ExistingServerLock {
    pid: u32,
    host: String,
    port: u64,
    #[serde(default)]
    host_version: Option<String>,
}

#[derive(Debug, Clone, Copy)]
enum DiscoverySource {
    InstanceRegistry,
    LegacyLock,
}

#[derive(Debug, Clone)]
struct DiscoveredServer {
    server_id: Option<String>,
    pid: u32,
    port: u16,
    host_version: Option<String>,
    source: DiscoverySource,
}

struct OwnedRuntimeReady {
    port: u16,
    origin: String,
    token: token_resolver::ServerToken,
    instance: ServerInstance,
}

struct OwnedBackendProcess {
    child: Child,
    process_group_id: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TerminationOutcome {
    reason: &'static str,
    confirmed: bool,
}

enum ReuseAttempt {
    Ready {
        server: DiscoveredServer,
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
    let state = app.state::<AppState>();
    let Ok(_operation) = state.backend_lifecycle_operation.lock() else {
        return;
    };
    start_backend_locked(app.clone());
}

fn start_backend_locked(app: AppHandle) {
    let (generation, stale_process) = {
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

        let stale_process = take_owned_process(&mut runtime);
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
        (runtime.generation, stale_process)
    };

    workspace_session::clear_active_session_runtime(&app, "start_backend");
    write_runtime_locator_unavailable(&app, generation, "start_backend");

    if let Some(mut stale_process) = stale_process {
        let outcome = terminate_owned_process(&mut stale_process);
        log_manager::append_line(
            &app,
            format!(
                "terminated stale backend process before start ({}; confirmed={})",
                outcome.reason, outcome.confirmed
            ),
        );
        if !outcome.confirmed {
            let _ = restore_unconfirmed_owned_process(&app, generation, stale_process);
            write_runtime_locator_unavailable(&app, generation, "stale_process_shutdown_failed");
            return;
        }
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
    let state = app.state::<AppState>();
    let Ok(_operation) = state.backend_lifecycle_operation.lock() else {
        return;
    };
    if let Err(error) = stop_backend_locked(&app) {
        log_manager::append_line(
            &app,
            format!("failed to stop backend during restart: {error:#}"),
        );
        return;
    }
    start_backend_locked(app.clone());
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
    let state = app.state::<AppState>();
    let _operation = state
        .backend_lifecycle_operation
        .lock()
        .map_err(|_| anyhow::anyhow!("backend lifecycle operation mutex is poisoned"))?;
    stop_backend_locked(app)
}

fn stop_backend_locked(app: &AppHandle) -> anyhow::Result<()> {
    let stop_started = Instant::now();
    log_manager::append_line(app, "shutdown stage=stop_backend_begin");

    let owned_process = {
        let state = app.state::<AppState>();
        let mut runtime = state
            .runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;

        runtime.generation = runtime.generation.saturating_add(1);
        let owned_process = take_owned_process(&mut runtime);
        runtime.state = BackendState::Stopping;
        runtime.runtime_ownership = RuntimeOwnership::Unavailable;
        runtime.active_port = None;
        runtime.workspace_port = None;
        runtime.base_port = None;
        runtime.last_error = None;
        runtime.effective_work_dir = None;
        runtime.launch_command = None;
        runtime.backend_ready_at_ms = None;
        owned_process
    };

    let mut termination_reason = None;
    if let Some(mut owned_process) = owned_process {
        let outcome = terminate_owned_process(&mut owned_process);
        termination_reason = Some(outcome.reason.to_string());
        if !outcome.confirmed {
            let state = app.state::<AppState>();
            let mut runtime = state
                .runtime
                .lock()
                .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
            runtime.child = Some(owned_process.child);
            runtime.owned_process_group_id = owned_process.process_group_id;
            runtime.runtime_ownership = RuntimeOwnership::OwnedByShell;
            runtime.state = BackendState::Crashed;
            runtime.last_error =
                Some("owned Kimi process tree did not confirm shutdown".to_string());
            let stop_generation = runtime.generation;
            drop(runtime);
            write_runtime_locator_unavailable(app, stop_generation, "stop_unconfirmed");
            anyhow::bail!("owned Kimi process tree did not confirm shutdown");
        }
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
    runtime.owned_process_group_id = None;
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
            server,
            origin,
            token,
        } => {
            append_backend_start_boundary(&log_path, generation, u64::from(server.port));
            log_manager::append_line(
                app,
                format!(
                    "reusing existing kimi-code server (source={:?}, server_id={}, pid={}, port={}, version={})",
                    server.source,
                    server.server_id.as_deref().unwrap_or("legacy-lock"),
                    server.pid,
                    server.port,
                    server.host_version.as_deref().unwrap_or("unknown")
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
                server.port,
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
    let kimi_home = match token_resolver::resolve_kimi_code_home() {
        Ok(home) => home,
        Err(error) => {
            set_crashed(
                app,
                generation,
                format!("Could not resolve Kimi Code home before launch: {error:#}"),
            );
            return Ok(());
        }
    };
    append_backend_start_boundary(&log_path, generation, u64::from(base_port));
    let command_args = build_kimi_web_args(base_port);
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
    let launch_time_ms = unix_time_millis();
    let child_pid = {
        let state = app.state::<AppState>();
        let mut runtime = state
            .runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
        if runtime.generation != generation || runtime.state != BackendState::Starting {
            return Ok(());
        }

        let child = match spawn_backend_process(
            &kimi_path,
            &work_dir,
            &command_args,
            &log_path,
            kimi_shell_path.as_ref(),
            agent_swarm_max_concurrency,
        ) {
            Ok(child) => child,
            Err(error) => {
                drop(runtime);
                let probe = probe_kimi_web_contract(&kimi_path, kimi_shell_path.as_ref());
                set_crashed(
                    app,
                    generation,
                    startup_failure_message(&error, probe, kimi_shell_path.is_none()),
                );
                return Ok(());
            }
        };
        let child_pid = child.id();
        runtime.child = Some(child);
        runtime.owned_process_group_id = owned_process_group_id(child_pid);
        runtime.state = BackendState::Starting;
        runtime.runtime_ownership = RuntimeOwnership::OwnedByShell;
        runtime.base_port = Some(base_port);
        runtime.active_port = None;
        runtime.workspace_port = None;
        runtime.last_error = None;
        runtime.detected_kimi_path = Some(kimi_path.clone());
        runtime.effective_work_dir = Some(work_dir.clone());
        runtime.launch_command = Some(launch_command);
        child_pid
    };
    log_manager::append_line(
        app,
        format!(
            "startup_timing spawn_ms={}",
            spawn_started.elapsed().as_millis()
        ),
    );

    let _ = skill_center::track_workspace_root(app, &work_dir);

    let health_started = Instant::now();
    let ready = match wait_for_owned_runtime(
        app,
        generation,
        &kimi_home,
        base_port,
        child_pid,
        launch_time_ms,
    ) {
        Ok(ready) => ready,
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "startup_timing health_wait_ms={} total_ms={}",
                    health_started.elapsed().as_millis(),
                    startup_started.elapsed().as_millis()
                ),
            );
            let state = app.state::<AppState>();
            let _operation = state
                .backend_lifecycle_operation
                .lock()
                .map_err(|_| anyhow::anyhow!("backend lifecycle operation mutex is poisoned"))?;
            if !owned_start_is_current(app, generation) {
                return Ok(());
            }
            let Some(mut owned_process) = take_owned_process_for_generation(app, generation)?
            else {
                set_crashed(
                    app,
                    generation,
                    "owned Kimi process handle disappeared during startup failure cleanup"
                        .to_string(),
                );
                return Ok(());
            };
            let outcome = terminate_owned_process(&mut owned_process);
            if !outcome.confirmed {
                restore_unconfirmed_owned_process(app, generation, owned_process)?;
                return Ok(());
            }
            match try_reuse_existing_server(app) {
                ReuseAttempt::Ready {
                    server,
                    origin,
                    token,
                } => {
                    log_manager::append_line(
                        app,
                        format!(
                            "reusing kimi-code server after startup race (pid={}, port={})",
                            server.pid, server.port
                        ),
                    );
                    finish_ready(
                        app,
                        generation,
                        server.port,
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
            let probe = probe_kimi_web_contract(&kimi_path, kimi_shell_path.as_ref());
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
    log_manager::append_line(
        app,
        format!(
            "matched owned kimi-code registry instance (server_id={}, pid={}, child_pid={}, port={}, version={})",
            ready.instance.server_id,
            ready.instance.pid,
            child_pid,
            ready.instance.port,
            ready.instance.host_version.as_deref().unwrap_or("unknown")
        ),
    );

    let token_wait_ms = 0;
    log_manager::append_line(app, format!("startup_timing token_wait_ms={token_wait_ms}"));
    finish_ready(
        app,
        generation,
        ready.port,
        ready.origin,
        ready.token,
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
    let token_path = home.join("server.token");
    let registry = instance_registry::read_live_instances(&home);
    log_registry_warnings(app, &registry.warnings);
    for instance in registry.instances {
        let Some(origin) = instance.origin() else {
            continue;
        };
        let token = match token_resolver::read_server_token_at(&token_path) {
            Ok(token) => token,
            Err(error) => {
                log_manager::append_line(
                    app,
                    format!(
                        "could not authenticate registry instance server_id={} pid={} port={}: {}",
                        instance.server_id,
                        instance.pid,
                        instance.port,
                        super::redaction::redact_backend_text(&error.to_string())
                    ),
                );
                continue;
            }
        };
        match probe_liveness(&origin).and_then(|_| probe_bearer_auth(&origin, &token.value)) {
            Ok(()) => {
                return ReuseAttempt::Ready {
                    server: DiscoveredServer {
                        server_id: Some(instance.server_id),
                        pid: instance.pid,
                        port: instance.port,
                        host_version: instance.host_version,
                        source: DiscoverySource::InstanceRegistry,
                    },
                    origin,
                    token,
                };
            }
            Err(error) => {
                log_manager::append_line(
                    app,
                    format!(
                        "registry instance failed health/auth validation (server_id={}, pid={}, port={}): {}",
                        instance.server_id,
                        instance.pid,
                        instance.port,
                        super::redaction::redact_backend_text(&error.to_string())
                    ),
                );
            }
        }
    }

    try_reuse_legacy_lock(app, &home)
}

fn try_reuse_legacy_lock(app: &AppHandle, home: &Path) -> ReuseAttempt {
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
    if !instance_registry::pid_alive(lock.pid) {
        log_manager::append_line(
            app,
            format!("ignored legacy kimi server lock with dead pid={}", lock.pid),
        );
        return ReuseAttempt::Stale;
    }
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
            server: DiscoveredServer {
                server_id: None,
                pid: lock.pid,
                port: lock.port as u16,
                host_version: lock.host_version,
                source: DiscoverySource::LegacyLock,
            },
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

fn log_registry_warnings(app: &AppHandle, warnings: &[String]) {
    for warning in warnings {
        log_manager::append_line(app, super::redaction::redact_backend_text(warning));
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
        .no_proxy()
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
    error.status().is_none()
}

fn probe_bearer_auth(origin: &str, token: &str) -> Result<(), reqwest::Error> {
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(EXTERNAL_HEALTH_TIMEOUT)
        .build()?;
    client
        .get(format!("{}/api/v1/auth", origin.trim_end_matches('/')))
        .bearer_auth(token)
        .send()?
        .error_for_status()?;
    Ok(())
}

fn wait_for_owned_runtime(
    app: &AppHandle,
    generation: u64,
    kimi_home: &Path,
    base_port: u16,
    child_pid: u32,
    launch_time_ms: u64,
) -> anyhow::Result<OwnedRuntimeReady> {
    let started = Instant::now();
    let deadline = started + OWNED_REGISTRY_TIMEOUT;
    let token_path = kimi_home.join("server.token");
    let mut logged_warnings = HashSet::new();

    while Instant::now() < deadline {
        let child_status = {
            let state = app.state::<AppState>();
            let mut runtime = state
                .runtime
                .lock()
                .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
            if runtime.generation != generation
                || runtime.state != BackendState::Starting
                || runtime.runtime_ownership != RuntimeOwnership::OwnedByShell
            {
                anyhow::bail!("owned kimi-code startup was cancelled");
            }
            let child = runtime
                .child
                .as_mut()
                .context("owned kimi-code process handle was unavailable during startup")?;
            child
                .try_wait()
                .context("failed to inspect kimi-code process during registry discovery")?
        };
        if let Some(status) = child_status {
            anyhow::bail!("kimi-code exited before instance registration completed: {status}");
        }

        let registry = instance_registry::read_live_instances(kimi_home);
        for warning in registry.warnings {
            if logged_warnings.insert(warning.clone()) {
                log_manager::append_line(app, super::redaction::redact_backend_text(&warning));
            }
        }
        if let Ok(token) = token_resolver::read_server_token_at(&token_path) {
            for instance in
                instance_registry::owned_candidates(&registry.instances, child_pid, launch_time_ms)
            {
                let Some(origin) = instance.origin() else {
                    continue;
                };
                if probe_liveness(&origin).is_ok()
                    && probe_bearer_auth(&origin, &token.value).is_ok()
                {
                    return Ok(OwnedRuntimeReady {
                        port: instance.port,
                        origin,
                        token,
                        instance,
                    });
                }
            }
        }

        let interval = if started.elapsed() < OWNED_FAST_POLL_WINDOW {
            OWNED_FAST_POLL_INTERVAL
        } else {
            OWNED_SLOW_POLL_INTERVAL
        };
        thread::sleep(interval);
    }

    anyhow::bail!(
        "no authenticated kimi-code registry instance appeared for child pid={} near base port={} within {} seconds",
        child_pid,
        base_port,
        OWNED_REGISTRY_TIMEOUT.as_secs()
    )
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
        if ownership == RuntimeOwnership::OwnedByShell && runtime.child.is_none() {
            anyhow::bail!("owned kimi-code process handle was unavailable before ready commit");
        }
        if ownership == RuntimeOwnership::ReusedExternal {
            runtime.child = None;
            runtime.owned_process_group_id = None;
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
        window_manager::mark_backend_ready(app, "backend_ready");
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
    workspace_session::handle_backend_ready(app, generation, port);
    if ownership == RuntimeOwnership::OwnedByShell {
        spawn_monitor(app.clone(), generation);
    } else {
        spawn_external_monitor(app.clone(), generation, origin, token.path, token.value);
    }
    Ok(())
}

fn spawn_external_monitor(
    app: AppHandle,
    generation: u64,
    origin: String,
    token_path: PathBuf,
    initial_token: String,
) {
    thread::spawn(move || {
        let mut failures = 0u8;
        let mut token = initial_token;
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
            let healthy = probe_liveness(&origin).is_ok()
                && (probe_bearer_auth(&origin, &token).is_ok()
                    || token_resolver::read_server_token_at(&token_path)
                        .ok()
                        .filter(|refreshed| probe_bearer_auth(&origin, &refreshed.value).is_ok())
                        .map(|refreshed| {
                            token = refreshed.value;
                        })
                        .is_some());
            if healthy {
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

        let exit_detail = {
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
                Ok(Some(status)) => Some((
                    format!("kimi-code server exited unexpectedly: {status}"),
                    format!("process_exit:{status}"),
                )),
                Ok(None) => None,
                Err(error) => Some((
                    format!("failed to monitor kimi process: {error}"),
                    "monitor_error".to_string(),
                )),
            }
        };

        let Some((message, exit_reason)) = exit_detail else {
            continue;
        };

        let state = app.state::<AppState>();
        let Ok(_operation) = state.backend_lifecycle_operation.lock() else {
            return;
        };
        let mut owned_process = {
            let mut runtime = match state.runtime.lock() {
                Ok(lock) => lock,
                Err(_) => return,
            };
            if runtime.generation != generation
                || runtime.runtime_ownership != RuntimeOwnership::OwnedByShell
            {
                return;
            }
            let Some(process) = take_owned_process(&mut runtime) else {
                return;
            };
            process
        };
        let outcome = terminate_owned_process(&mut owned_process);
        {
            let mut runtime = match state.runtime.lock() {
                Ok(lock) => lock,
                Err(_) => return,
            };
            if runtime.generation != generation {
                return;
            }
            runtime.active_port = None;
            runtime.workspace_port = None;
            runtime.runtime_origin = None;
            runtime.server_token_path = None;
            runtime.server_token_redacted = None;
            runtime.workspace_url = None;
            runtime.last_exit_reason = Some(exit_reason);
            runtime.state = BackendState::Crashed;
            if outcome.confirmed {
                runtime.runtime_ownership = RuntimeOwnership::Unavailable;
                runtime.last_error = Some(message.clone());
            } else {
                runtime.child = Some(owned_process.child);
                runtime.owned_process_group_id = owned_process.process_group_id;
                runtime.runtime_ownership = RuntimeOwnership::OwnedByShell;
                runtime.last_error = Some(format!(
                    "{message}; owned process tree did not confirm shutdown"
                ));
            }
        }
        workspace_session::clear_active_session_runtime(&app, "monitor_crash");
        write_runtime_locator_unavailable(&app, generation, "monitor_crash");
        log_manager::append_line(&app, &message);
        window_manager::show_control_center(&app, "monitor_crash");
        return;
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
    #[cfg(unix)]
    {
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

    let mut child = command
        .spawn()
        .context("failed to spawn kimi-code server command")?;
    let redactor = Arc::new(super::redaction::SecretRedactor::from_system());
    let Some(stdout) = child.stdout.take() else {
        let mut process = OwnedBackendProcess {
            process_group_id: owned_process_group_id(child.id()),
            child,
        };
        let _ = terminate_owned_process(&mut process);
        anyhow::bail!("kimi-code stdout pipe was unavailable");
    };
    let Some(stderr) = child.stderr.take() else {
        let mut process = OwnedBackendProcess {
            process_group_id: owned_process_group_id(child.id()),
            child,
        };
        let _ = terminate_owned_process(&mut process);
        anyhow::bail!("kimi-code stderr pipe was unavailable");
    };
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

fn probe_kimi_web_contract(kimi_path: &Path, kimi_shell_path: Option<&PathBuf>) -> ContractProbe {
    let mut command = Command::new(kimi_path);
    command_utils::configure_kimi_query_command(&mut command);
    command
        .args(["web", "--help"])
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
    let _ = child.kill();
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
            "已确认当前 Kimi 支持 `web`；请查看脱敏后的 backend.log 获取具体原因。"
        }
        ContractProbe::Incompatible => {
            "当前可执行文件不支持 `web`；请配置最新版 Kimi Code 的可执行文件。"
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

fn build_kimi_web_args(base_port: u16) -> Vec<String> {
    vec![
        "web".to_string(),
        "--no-open".to_string(),
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
        runtime.owned_process_group_id = None;
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
        window_manager::show_missing_kimi(app, "missing_kimi");
    }

    workspace_session::clear_active_session_runtime(app, "missing_kimi");
    write_runtime_locator_unavailable(app, generation, "missing_kimi");
    log_manager::append_line(app, &message);
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

        let preserve_owned_process =
            runtime.runtime_ownership == RuntimeOwnership::OwnedByShell && runtime.child.is_some();
        if !preserve_owned_process {
            runtime.child = None;
            runtime.owned_process_group_id = None;
            runtime.runtime_ownership = RuntimeOwnership::Unavailable;
        }
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
        window_manager::show_control_center(app, "backend_crashed");
    }

    workspace_session::clear_active_session_runtime(app, "crashed");
    write_runtime_locator_unavailable(app, generation, "crashed");
    log_manager::append_line(app, &message);
}

fn write_runtime_locator_ready(
    app: &AppHandle,
    origin: &str,
    token_path: &Path,
    token_redacted: &str,
    generation: u64,
    ownership: RuntimeOwnership,
) {
    let state = app.state::<AppState>();
    let Ok(_write) = state.runtime_locator_write.lock() else {
        return;
    };
    let is_current = state
        .runtime
        .lock()
        .map(|runtime| {
            runtime.generation == generation
                && runtime.state == BackendState::Running
                && runtime.runtime_ownership == ownership
                && runtime.runtime_origin.as_deref() == Some(origin)
        })
        .unwrap_or(false);
    if !is_current {
        return;
    }
    let path = state.runtime_locator_path.clone();
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
    let state = app.state::<AppState>();
    let Ok(_write) = state.runtime_locator_write.lock() else {
        return;
    };
    let is_current = state
        .runtime
        .lock()
        .map(|runtime| runtime.generation == generation && runtime.state != BackendState::Running)
        .unwrap_or(false);
    if !is_current {
        return;
    }
    let path = state.runtime_locator_path.clone();
    if let Err(error) = runtime_locator::write_unavailable(&path, generation) {
        log_manager::append_line(
            app,
            format!("failed to write kimi runtime locator unavailable snapshot (source={source}): {error:#}"),
        );
    }
}

fn take_owned_process(runtime: &mut RuntimeState) -> Option<OwnedBackendProcess> {
    if runtime.runtime_ownership != RuntimeOwnership::OwnedByShell {
        runtime.child = None;
        runtime.owned_process_group_id = None;
        return None;
    }
    runtime.child.take().map(|child| OwnedBackendProcess {
        child,
        process_group_id: runtime.owned_process_group_id.take(),
    })
}

fn take_owned_process_for_generation(
    app: &AppHandle,
    generation: u64,
) -> anyhow::Result<Option<OwnedBackendProcess>> {
    let state = app.state::<AppState>();
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
    if runtime.generation != generation {
        return Ok(None);
    }
    Ok(take_owned_process(&mut runtime))
}

fn owned_start_is_current(app: &AppHandle, generation: u64) -> bool {
    app.state::<AppState>()
        .runtime
        .lock()
        .map(|runtime| {
            runtime.generation == generation
                && runtime.state == BackendState::Starting
                && runtime.runtime_ownership == RuntimeOwnership::OwnedByShell
        })
        .unwrap_or(false)
}

fn restore_unconfirmed_owned_process(
    app: &AppHandle,
    generation: u64,
    process: OwnedBackendProcess,
) -> anyhow::Result<()> {
    let state = app.state::<AppState>();
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
    if runtime.child.is_some() {
        anyhow::bail!("cannot restore an unconfirmed owned process over an existing handle");
    }
    runtime.child = Some(process.child);
    runtime.owned_process_group_id = process.process_group_id;
    runtime.runtime_ownership = RuntimeOwnership::OwnedByShell;
    runtime.state = BackendState::Crashed;
    runtime.active_port = None;
    runtime.workspace_port = None;
    runtime.runtime_origin = None;
    runtime.server_token_path = None;
    runtime.server_token_redacted = None;
    runtime.workspace_url = None;
    runtime.last_error = Some(format!(
        "owned Kimi process tree from generation {generation} did not confirm shutdown"
    ));
    drop(runtime);
    write_runtime_locator_unavailable(app, generation, "owned_shutdown_unconfirmed");
    Ok(())
}

fn terminate_owned_process(process: &mut OwnedBackendProcess) -> TerminationOutcome {
    terminate_owned_process_with_timeout(process, Duration::from_secs(SHUTDOWN_TIMEOUT_SECS))
}

fn terminate_owned_process_with_timeout(
    process: &mut OwnedBackendProcess,
    timeout: Duration,
) -> TerminationOutcome {
    let pid = process.child.id();
    soft_terminate(pid, process.process_group_id);

    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let leader_exited = match process.child.try_wait() {
            Ok(Some(_)) => true,
            Ok(None) => false,
            Err(_) => break,
        };
        if leader_exited && !owned_process_group_alive(process.process_group_id) {
            return TerminationOutcome {
                reason: "graceful_exit",
                confirmed: true,
            };
        }
        thread::sleep(Duration::from_millis(50));
    }

    let force_confirmed = force_terminate(pid, process.process_group_id);
    let leader_reaped = process.child.wait().is_ok();
    let force_deadline = Instant::now() + Duration::from_millis(500);
    while owned_process_group_alive(process.process_group_id) && Instant::now() < force_deadline {
        thread::sleep(Duration::from_millis(25));
    }
    let group_gone = !owned_process_group_alive(process.process_group_id);
    let leader_gone = !instance_registry::pid_alive(pid);
    TerminationOutcome {
        reason: "force_kill",
        confirmed: leader_reaped && group_gone && (force_confirmed || leader_gone),
    }
}

#[cfg(unix)]
fn owned_process_group_id(pid: u32) -> Option<i32> {
    i32::try_from(pid).ok().filter(|group| *group > 0)
}

#[cfg(not(unix))]
fn owned_process_group_id(_pid: u32) -> Option<i32> {
    None
}

#[cfg(unix)]
fn owned_process_group_alive(process_group_id: Option<i32>) -> bool {
    use nix::{errno::Errno, sys::signal, unistd::Pid};
    let Some(group) = process_group_id else {
        return false;
    };
    match signal::killpg(Pid::from_raw(group), None) {
        Ok(()) | Err(Errno::EPERM) => true,
        Err(Errno::ESRCH) => false,
        Err(_) => true,
    }
}

#[cfg(not(unix))]
fn owned_process_group_alive(_process_group_id: Option<i32>) -> bool {
    false
}

#[cfg(unix)]
fn soft_terminate(pid: u32, process_group_id: Option<i32>) {
    use nix::{sys::signal, unistd::Pid};
    if let Some(group) = process_group_id {
        let _ = signal::killpg(Pid::from_raw(group), signal::Signal::SIGTERM);
    } else if let Ok(pid) = i32::try_from(pid) {
        let _ = signal::kill(Pid::from_raw(pid), signal::Signal::SIGTERM);
    }
}

#[cfg(unix)]
fn force_terminate(pid: u32, process_group_id: Option<i32>) -> bool {
    use nix::{errno::Errno, sys::signal, unistd::Pid};
    if let Some(group) = process_group_id {
        matches!(
            signal::killpg(Pid::from_raw(group), signal::Signal::SIGKILL),
            Ok(()) | Err(Errno::ESRCH)
        )
    } else if let Ok(pid) = i32::try_from(pid) {
        matches!(
            signal::kill(Pid::from_raw(pid), signal::Signal::SIGKILL),
            Ok(()) | Err(Errno::ESRCH)
        )
    } else {
        false
    }
}

#[cfg(windows)]
fn soft_terminate(pid: u32, _process_group_id: Option<i32>) {
    let mut command = Command::new("taskkill");
    command_utils::configure_system_command(&mut command);
    let _ = command.args(["/PID", &pid.to_string(), "/T"]).status();
}

#[cfg(windows)]
fn force_terminate(pid: u32, _process_group_id: Option<i32>) -> bool {
    let mut command = Command::new("taskkill");
    command_utils::configure_system_command(&mut command);
    command
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(not(any(unix, windows)))]
fn soft_terminate(_pid: u32, _process_group_id: Option<i32>) {}

#[cfg(not(any(unix, windows)))]
fn force_terminate(_pid: u32, _process_group_id: Option<i32>) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[cfg(unix)]
    fn spawn_test_backend(name: &str, script: &[u8]) -> (PathBuf, OwnedBackendProcess) {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "kimi-backend-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let executable = root.join("kimi");
        let log_path = root.join("backend.log");
        fs::write(&executable, script).unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();

        let child = spawn_backend_process(
            &executable,
            &root,
            &build_kimi_web_args(58627),
            &log_path,
            None,
            None,
        )
        .unwrap();
        let process = OwnedBackendProcess {
            process_group_id: owned_process_group_id(child.id()),
            child,
        };
        (root, process)
    }

    #[test]
    fn launch_args_enforce_local_only_mode() {
        assert_eq!(
            build_kimi_web_args(57999),
            vec!["web", "--no-open", "--port", "57999"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn backend_spawn_uses_dedicated_process_group_and_terminates_it() {
        let (root, mut process) =
            spawn_test_backend("process-group", b"#!/bin/sh\nexec /bin/sleep 30\n");
        let pid = nix::unistd::Pid::from_raw(process.child.id() as i32);
        assert_eq!(nix::unistd::getpgid(Some(pid)).unwrap(), pid);
        assert_ne!(nix::unistd::getpgrp(), pid);
        assert_eq!(
            terminate_owned_process(&mut process).reason,
            "graceful_exit"
        );
        assert!(process.child.try_wait().unwrap().is_some());

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn stop_during_starting_terminates_owned_process_group() {
        let (root, process) =
            spawn_test_backend("stop-starting", b"#!/bin/sh\nexec /bin/sleep 30\n");
        let process_group_id = process.process_group_id;
        let mut runtime = RuntimeState {
            state: BackendState::Starting,
            runtime_ownership: RuntimeOwnership::OwnedByShell,
            generation: 7,
            child: Some(process.child),
            owned_process_group_id: process_group_id,
            ..RuntimeState::default()
        };

        runtime.generation += 1;
        runtime.state = BackendState::Stopping;
        let mut owned = take_owned_process(&mut runtime).expect("owned starting process");
        terminate_owned_process_with_timeout(&mut owned, Duration::from_millis(250));

        assert!(runtime.child.is_none());
        assert!(!owned_process_group_alive(process_group_id));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn quit_during_starting_leaves_no_child() {
        let script = b"#!/bin/sh\ntrap 'exit 0' TERM\n(trap '' TERM; while :; do /bin/sleep 1; done) &\necho $! > descendant.pid\nwait\n";
        let (root, mut process) = spawn_test_backend("quit-starting", script);
        let descendant_path = root.join("descendant.pid");
        let deadline = Instant::now() + Duration::from_secs(2);
        while !descendant_path.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(descendant_path.exists());
        let descendant_pid = fs::read_to_string(&descendant_path)
            .unwrap()
            .trim()
            .parse::<u32>()
            .unwrap();

        assert_eq!(
            terminate_owned_process_with_timeout(&mut process, Duration::from_millis(250)).reason,
            "force_kill"
        );
        let status = Command::new("ps")
            .args(["-o", "stat=", "-p", &descendant_pid.to_string()])
            .output()
            .unwrap();
        let state = String::from_utf8_lossy(&status.stdout).trim().to_string();
        assert!(state.is_empty() || state.starts_with('Z'), "state={state}");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn restart_during_starting_does_not_leave_old_generation() {
        let (old_root, old_process) =
            spawn_test_backend("restart-old", b"#!/bin/sh\nexec /bin/sleep 30\n");
        let old_group = old_process.process_group_id;
        let mut runtime = RuntimeState {
            state: BackendState::Starting,
            runtime_ownership: RuntimeOwnership::OwnedByShell,
            generation: 11,
            child: Some(old_process.child),
            owned_process_group_id: old_group,
            ..RuntimeState::default()
        };
        runtime.generation += 1;
        let mut old_owned = take_owned_process(&mut runtime).expect("old owned process");
        terminate_owned_process_with_timeout(&mut old_owned, Duration::from_millis(250));

        let (new_root, mut new_process) =
            spawn_test_backend("restart-new", b"#!/bin/sh\nexec /bin/sleep 30\n");
        runtime.generation += 1;
        runtime.state = BackendState::Starting;
        runtime.runtime_ownership = RuntimeOwnership::OwnedByShell;
        runtime.owned_process_group_id = new_process.process_group_id;
        runtime.child = Some(new_process.child);

        assert!(!owned_process_group_alive(old_group));
        assert!(runtime
            .child
            .as_mut()
            .unwrap()
            .try_wait()
            .unwrap()
            .is_none());
        new_process = take_owned_process(&mut runtime).expect("new owned process");
        terminate_owned_process_with_timeout(&mut new_process, Duration::from_millis(250));
        let _ = fs::remove_dir_all(old_root);
        let _ = fs::remove_dir_all(new_root);
    }

    #[cfg(unix)]
    #[test]
    fn external_reused_instance_is_never_killed_on_quit() {
        let mut external = Command::new("/bin/sleep").arg("30").spawn().unwrap();
        let mut runtime = RuntimeState {
            state: BackendState::Running,
            runtime_ownership: RuntimeOwnership::ReusedExternal,
            generation: 21,
            ..RuntimeState::default()
        };

        runtime.generation += 1;
        assert!(take_owned_process(&mut runtime).is_none());
        assert!(external.try_wait().unwrap().is_none());

        external.kill().unwrap();
        external.wait().unwrap();
    }

    #[test]
    fn startup_failure_guidance_distinguishes_contract_results() {
        let error = anyhow::anyhow!("backend exited");
        let supported = startup_failure_message(&error, ContractProbe::Supported, false);
        let incompatible = startup_failure_message(&error, ContractProbe::Incompatible, false);
        let unavailable = startup_failure_message(&error, ContractProbe::Unavailable, false);
        let timed_out = startup_failure_message(&error, ContractProbe::TimedOut, false);

        assert!(supported.contains("支持 `web`"));
        assert!(incompatible.contains("不支持 `web`"));
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

        let listener = TcpListener::bind("127.0.0.1:0").expect("port");
        let stalled_origin = format!("http://{}", listener.local_addr().expect("address"));
        thread::spawn(move || {
            let _connection = listener.accept().expect("connection");
            thread::sleep(EXTERNAL_HEALTH_TIMEOUT + Duration::from_millis(100));
        });
        let error = probe_liveness(&stalled_origin).expect_err("stalled server must time out");
        assert!(error.is_timeout());
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
