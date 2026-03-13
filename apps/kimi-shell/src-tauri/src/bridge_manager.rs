use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::Context;
use tauri::{AppHandle, Manager};

use crate::{
    app_state::{AppState, BridgeProcessState},
    bridge_http_client::BridgeHttpClient,
    bridge_settings_store::{self, DEFAULT_BRIDGE_ADMIN_PORT},
    log_manager,
    types::{
        BindingRecord, BridgeChannelState, BridgeChannelStatus, BridgeRuntimeState, BridgeSettings,
        BridgeStatus,
    },
};

const BRIDGE_START_TIMEOUT: Duration = Duration::from_secs(3);
const BRIDGE_STOP_TIMEOUT: Duration = Duration::from_secs(2);
const BRIDGE_POLL_INTERVAL: Duration = Duration::from_millis(120);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn get_bridge_status(app: &AppHandle) -> anyhow::Result<BridgeStatus> {
    refresh_child_state(app)?;
    let settings = bridge_settings_store::load_or_default(app)?;
    let (admin_port, admin_token, runtime_state) = {
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        (
            runtime.admin_port,
            runtime.admin_token.clone(),
            runtime.state,
        )
    };

    if matches!(
        runtime_state,
        BridgeRuntimeState::Starting | BridgeRuntimeState::Running | BridgeRuntimeState::Degraded
    ) {
        let client = BridgeHttpClient::for_local_admin_port(admin_port, admin_token)?;
        match client.get_status() {
            Ok(status) => {
                apply_status_snapshot(app, &status)?;
                return Ok(status);
            }
            Err(error) => {
                if let Ok(mut runtime) = app.state::<AppState>().bridge_runtime.lock() {
                    runtime.last_error = Some(error.to_string());
                    if runtime.state == BridgeRuntimeState::Running {
                        runtime.state = BridgeRuntimeState::Degraded;
                    }
                }
            }
        }
    }

    build_local_status(app, &settings)
}

pub fn start_bridge(app: &AppHandle) -> anyhow::Result<BridgeStatus> {
    bridge_settings_store::ensure_bridge_files(app)?;
    refresh_child_state(app)?;

    {
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        if matches!(
            runtime.state,
            BridgeRuntimeState::Starting | BridgeRuntimeState::Running
        ) {
            drop(runtime);
            return get_bridge_status(app);
        }
    }

    let settings = bridge_settings_store::load_or_default(app)?;
    let binary_path = resolve_bridge_binary_path(app)?;
    let state = app.state::<AppState>();
    let admin_token = {
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        runtime.admin_token.clone()
    };

    let mut command = build_bridge_command(app, &binary_path, &settings, &admin_token)?;
    let child = command.spawn().with_context(|| {
        format!(
            "failed to spawn bridge sidecar: {}",
            binary_path.to_string_lossy()
        )
    })?;
    let pid = child.id();

    {
        let mut runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        begin_start_transition(&mut runtime, settings.admin_port, binary_path, pid);
        runtime.child = Some(child);
        runtime.channels = settings_channels(&settings, BridgeRuntimeState::Starting);
    }

    log_manager::append_line(
        app,
        format!(
            "bridge start requested (pid={pid}, admin_port={})",
            settings.admin_port
        ),
    );

    let client = BridgeHttpClient::for_local_admin_port(settings.admin_port, admin_token)?;
    if let Err(error) = wait_for_bridge_ready(app, &client) {
        cleanup_failed_start(app, error.to_string())?;
        return Err(error);
    }
    let status = match client.get_status() {
        Ok(status) => status,
        Err(error) => {
            cleanup_failed_start(app, error.to_string())?;
            return Err(error);
        }
    };
    apply_status_snapshot(app, &status)?;
    log_manager::append_line(
        app,
        format!(
            "bridge ready (pid={}, state={:?}, bindings={})",
            status.pid.unwrap_or(pid),
            status.state,
            status.bindings
        ),
    );
    Ok(status)
}

pub fn stop_bridge(app: &AppHandle) -> anyhow::Result<BridgeStatus> {
    let settings = bridge_settings_store::load_or_default(app)?;
    let (runtime_state, admin_port, admin_token, child) = {
        let state = app.state::<AppState>();
        let mut runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        let previous_state = runtime.state;
        runtime.state = BridgeRuntimeState::Stopping;
        (
            previous_state,
            runtime.admin_port,
            runtime.admin_token.clone(),
            runtime.child.take(),
        )
    };

    if let Some(mut child) = child {
        let client = if matches!(
            runtime_state,
            BridgeRuntimeState::Starting
                | BridgeRuntimeState::Running
                | BridgeRuntimeState::Degraded
        ) {
            BridgeHttpClient::for_local_admin_port(admin_port, admin_token).ok()
        } else {
            None
        };
        let reason = stop_child_process(&mut child, client.as_ref(), BRIDGE_STOP_TIMEOUT)?;
        log_manager::append_line(app, format!("bridge stop finished ({reason})"));
    }

    {
        let state = app.state::<AppState>();
        let mut runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        finish_stop_transition(&mut runtime);
        runtime.channels = settings_channels(&settings, BridgeRuntimeState::Stopped);
    }

    build_local_status(app, &settings)
}

pub fn restart_bridge(app: &AppHandle) -> anyhow::Result<BridgeStatus> {
    let _ = stop_bridge(app);
    start_bridge(app)
}

pub fn list_bridge_bindings(app: &AppHandle) -> anyhow::Result<Vec<BindingRecord>> {
    refresh_child_state(app)?;
    let (runtime_state, admin_port, admin_token) = {
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        (
            runtime.state,
            runtime.admin_port,
            runtime.admin_token.clone(),
        )
    };

    if !matches!(
        runtime_state,
        BridgeRuntimeState::Running | BridgeRuntimeState::Degraded
    ) {
        return Ok(Vec::new());
    }

    let client = BridgeHttpClient::for_local_admin_port(admin_port, admin_token)?;
    client.list_bindings()
}

pub fn clear_bridge_binding(app: &AppHandle, binding_id: &str) -> anyhow::Result<()> {
    refresh_child_state(app)?;
    let (runtime_state, admin_port, admin_token) = {
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        (
            runtime.state,
            runtime.admin_port,
            runtime.admin_token.clone(),
        )
    };

    if !matches!(
        runtime_state,
        BridgeRuntimeState::Running | BridgeRuntimeState::Degraded
    ) {
        return Err(anyhow::anyhow!("bridge is not running"));
    }

    let client = BridgeHttpClient::for_local_admin_port(admin_port, admin_token)?;
    client.clear_binding(binding_id)?;
    Ok(())
}

fn build_bridge_command(
    app: &AppHandle,
    binary_path: &Path,
    settings: &BridgeSettings,
    admin_token: &str,
) -> anyhow::Result<Command> {
    let state = app.state::<AppState>();
    let mut command = Command::new(binary_path);
    command
        .arg("--config")
        .arg(&state.bridge_settings_path)
        .arg("--secrets")
        .arg(&state.bridge_secrets_path)
        .arg("--db")
        .arg(&state.bridge_db_path)
        .arg("--log-file")
        .arg(log_manager::bridge_log_path(app)?)
        .arg("--admin-port")
        .arg(settings.admin_port.to_string())
        .arg("--admin-token")
        .arg(admin_token)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    Ok(command)
}

fn resolve_bridge_binary_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let env_override = std::env::var_os("KIMI_IM_BRIDGE_BIN").map(PathBuf::from);
    let dev_path = development_binary_path();
    let resource_dir = app.path().resource_dir().ok();
    resolve_bridge_binary_from_sources(env_override, dev_path, resource_dir)
}

fn resolve_bridge_binary_from_sources(
    env_override: Option<PathBuf>,
    development_path: PathBuf,
    resource_dir: Option<PathBuf>,
) -> anyhow::Result<PathBuf> {
    if let Some(path) = env_override {
        if path.exists() {
            return Ok(path);
        }
        return Err(anyhow::anyhow!(
            "KIMI_IM_BRIDGE_BIN does not exist: {}",
            path.display()
        ));
    }

    if development_path.exists() {
        return Ok(development_path);
    }

    let mut checked = vec![development_path];
    if let Some(resource_dir) = resource_dir {
        let resource_candidates = vec![
            resource_dir.join("binaries").join(binary_name()),
            resource_dir.join(binary_name()),
        ];
        for candidate in resource_candidates {
            if candidate.exists() {
                return Ok(candidate);
            }
            checked.push(candidate);
        }
    }

    let checked_paths = checked
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<String>>()
        .join(", ");
    Err(anyhow::anyhow!(
        "bridge binary not found; checked {checked_paths}"
    ))
}

fn development_binary_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("kimi-im-bridge")
        .join("bin")
        .join(binary_name())
}

fn binary_name() -> OsString {
    #[cfg(windows)]
    {
        return OsString::from("kimi-im-bridge.exe");
    }

    #[cfg(not(windows))]
    {
        OsString::from("kimi-im-bridge")
    }
}

fn wait_for_bridge_ready(app: &AppHandle, client: &BridgeHttpClient) -> anyhow::Result<()> {
    let deadline = Instant::now() + BRIDGE_START_TIMEOUT;
    loop {
        if client.healthz().is_ok() {
            return Ok(());
        }

        refresh_child_state(app)?;
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        if runtime.state == BridgeRuntimeState::Crashed {
            return Err(anyhow::anyhow!(runtime.last_error.clone().unwrap_or_else(
                || "bridge crashed before becoming ready".to_string()
            )));
        }
        drop(runtime);

        if Instant::now() >= deadline {
            let message = "bridge did not become ready within startup timeout".to_string();
            record_failure(app, &message)?;
            return Err(anyhow::anyhow!(message));
        }
        thread::sleep(BRIDGE_POLL_INTERVAL);
    }
}

fn apply_status_snapshot(app: &AppHandle, status: &BridgeStatus) -> anyhow::Result<()> {
    let state = app.state::<AppState>();
    let mut runtime = state
        .bridge_runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
    apply_status_transition(&mut runtime, status);
    Ok(())
}

fn build_local_status(app: &AppHandle, settings: &BridgeSettings) -> anyhow::Result<BridgeStatus> {
    let state = app.state::<AppState>();
    let runtime = state
        .bridge_runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;

    let channels = if runtime.channels.is_empty() {
        settings_channels(settings, runtime.state)
    } else {
        merge_channels(settings, &runtime.channels, runtime.state)
    };

    Ok(BridgeStatus {
        state: runtime.state,
        started_at: runtime.started_at.clone(),
        pid: runtime.pid,
        admin_port: if runtime.admin_port == 0 {
            settings.admin_port
        } else {
            runtime.admin_port
        },
        version: runtime.version.clone(),
        channels,
        pending_approvals: runtime.pending_approvals,
        bindings: runtime.bindings,
        last_error: runtime.last_error.clone(),
    })
}

fn merge_channels(
    settings: &BridgeSettings,
    runtime_channels: &[BridgeChannelStatus],
    runtime_state: BridgeRuntimeState,
) -> Vec<BridgeChannelStatus> {
    settings
        .channels
        .iter()
        .map(|channel| {
            runtime_channels
                .iter()
                .find(|item| item.platform == channel.platform)
                .cloned()
                .unwrap_or_else(|| BridgeChannelStatus {
                    platform: channel.platform,
                    enabled: channel.enabled,
                    state: default_channel_state(channel.enabled, runtime_state),
                    last_inbound_at: None,
                    last_outbound_at: None,
                    last_offset: None,
                    last_error: None,
                })
        })
        .collect()
}

fn settings_channels(
    settings: &BridgeSettings,
    runtime_state: BridgeRuntimeState,
) -> Vec<BridgeChannelStatus> {
    settings
        .channels
        .iter()
        .map(|channel| BridgeChannelStatus {
            platform: channel.platform,
            enabled: channel.enabled,
            state: default_channel_state(channel.enabled, runtime_state),
            last_inbound_at: None,
            last_outbound_at: None,
            last_offset: None,
            last_error: None,
        })
        .collect()
}

fn default_channel_state(enabled: bool, runtime_state: BridgeRuntimeState) -> BridgeChannelState {
    if !enabled {
        return BridgeChannelState::Idle;
    }

    match runtime_state {
        BridgeRuntimeState::Starting => BridgeChannelState::Connecting,
        BridgeRuntimeState::Running => BridgeChannelState::Ready,
        BridgeRuntimeState::Degraded | BridgeRuntimeState::Crashed => BridgeChannelState::Degraded,
        _ => BridgeChannelState::Idle,
    }
}

fn refresh_child_state(app: &AppHandle) -> anyhow::Result<()> {
    let state = app.state::<AppState>();
    let mut runtime = state
        .bridge_runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;

    let mut exit_message = None;
    let mut stopping_exit = false;
    if let Some(child) = runtime.child.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                runtime.child = None;
                runtime.pid = None;
                if runtime.state == BridgeRuntimeState::Stopping {
                    stopping_exit = true;
                } else {
                    exit_message = Some(format!("bridge sidecar exited: {status}"));
                }
            }
            Ok(None) => {}
            Err(error) => {
                exit_message = Some(format!("failed to inspect bridge process: {error}"));
                runtime.child = None;
                runtime.pid = None;
            }
        }
    }

    if stopping_exit {
        finish_stop_transition(&mut runtime);
    } else if let Some(message) = exit_message {
        runtime.state = BridgeRuntimeState::Crashed;
        runtime.last_error = Some(message);
    }

    Ok(())
}

fn record_failure(app: &AppHandle, message: &str) -> anyhow::Result<()> {
    let state = app.state::<AppState>();
    let mut runtime = state
        .bridge_runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
    runtime.state = BridgeRuntimeState::Crashed;
    runtime.child = None;
    runtime.pid = None;
    runtime.last_error = Some(message.to_string());
    Ok(())
}

fn cleanup_failed_start(app: &AppHandle, message: String) -> anyhow::Result<()> {
    let child = {
        let state = app.state::<AppState>();
        let mut runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        runtime.state = BridgeRuntimeState::Crashed;
        runtime.last_error = Some(message.clone());
        runtime.pid = None;
        runtime.child.take()
    };

    if let Some(mut child) = child {
        let _ = terminate_child(&mut child, Duration::from_millis(250));
    }

    log_manager::append_line(app, format!("bridge start failed: {message}"));
    Ok(())
}

fn begin_start_transition(
    runtime: &mut BridgeProcessState,
    admin_port: u16,
    binary_path: PathBuf,
    pid: u32,
) {
    runtime.state = BridgeRuntimeState::Starting;
    runtime.admin_port = if admin_port == 0 {
        DEFAULT_BRIDGE_ADMIN_PORT
    } else {
        admin_port
    };
    runtime.pid = Some(pid);
    runtime.binary_path = Some(binary_path);
    runtime.started_at = Some(now_epoch_string());
    runtime.version = None;
    runtime.last_error = None;
    runtime.bindings = 0;
    runtime.pending_approvals = 0;
}

fn apply_status_transition(runtime: &mut BridgeProcessState, status: &BridgeStatus) {
    runtime.state = status.state;
    runtime.admin_port = status.admin_port;
    runtime.pid = status.pid;
    runtime.started_at = status.started_at.clone();
    runtime.version = status.version.clone();
    runtime.last_error = status.last_error.clone();
    runtime.channels = status.channels.clone();
    runtime.bindings = status.bindings;
    runtime.pending_approvals = status.pending_approvals;
}

fn finish_stop_transition(runtime: &mut BridgeProcessState) {
    runtime.state = BridgeRuntimeState::Stopped;
    runtime.child = None;
    runtime.pid = None;
    runtime.started_at = None;
}

fn terminate_child(child: &mut Child, timeout: Duration) -> anyhow::Result<&'static str> {
    let pid = child.id();
    soft_terminate(pid);
    if wait_for_child_exit(child, timeout)? {
        return Ok("graceful_exit");
    }

    force_terminate(pid);
    let _ = wait_for_child_exit(child, Duration::from_secs(1));
    let _ = child.wait();
    Ok("force_kill")
}

fn stop_child_process(
    child: &mut Child,
    client: Option<&BridgeHttpClient>,
    timeout: Duration,
) -> anyhow::Result<&'static str> {
    if let Some(client) = client {
        match client.stop_runtime() {
            Ok(()) => {
                if wait_for_child_exit(child, timeout)? {
                    return Ok("cooperative_exit");
                }
            }
            Err(error) => {
                let _ = error;
            }
        }
    }

    terminate_child(child, timeout)
}

fn wait_for_child_exit(child: &mut Child, timeout: Duration) -> anyhow::Result<bool> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(true),
            Ok(None) => {
                if Instant::now() >= deadline {
                    return Ok(false);
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => {
                return Err(anyhow::anyhow!(
                    "failed to query bridge child exit status: {error}"
                ));
            }
        }
    }
}

fn now_epoch_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
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
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(windows)]
fn force_terminate(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(any(unix, windows)))]
fn soft_terminate(_pid: u32) {}

#[cfg(not(any(unix, windows)))]
fn force_terminate(_pid: u32) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use crate::types::BridgePlatform;

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(label: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "kimi-shell-bridge-manager-{label}-{}-{unique}",
                std::process::id()
            ));
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
    fn resolve_binary_prefers_env_override_before_other_candidates() {
        let temp = TempDirGuard::new("binary-priority");
        let env_path = temp.path.join("env").join(binary_name());
        let dev_path = temp.path.join("dev").join(binary_name());
        let resource_dir = temp.path.join("resource");

        fs::create_dir_all(env_path.parent().expect("env parent")).expect("env parent");
        fs::create_dir_all(dev_path.parent().expect("dev parent")).expect("dev parent");
        fs::create_dir_all(resource_dir.join("binaries")).expect("resource parent");
        fs::write(&env_path, b"env").expect("env binary");
        fs::write(&dev_path, b"dev").expect("dev binary");
        fs::write(
            resource_dir.join("binaries").join(binary_name()),
            b"resource",
        )
        .expect("resource binary");

        let resolved = resolve_bridge_binary_from_sources(
            Some(env_path.clone()),
            dev_path,
            Some(resource_dir),
        )
        .expect("binary should resolve");

        assert_eq!(resolved, env_path);
    }

    #[test]
    fn lifecycle_transition_helpers_update_bridge_runtime_state() {
        let mut runtime = BridgeProcessState::new("token".to_string());
        begin_start_transition(&mut runtime, 60_110, PathBuf::from("bridge.exe"), 4242);
        assert_eq!(runtime.state, BridgeRuntimeState::Starting);
        assert_eq!(runtime.pid, Some(4242));
        assert!(runtime.last_error.is_none());

        let status = BridgeStatus {
            state: BridgeRuntimeState::Running,
            started_at: Some("123".to_string()),
            pid: Some(4242),
            admin_port: 60_110,
            version: Some("0.1.0".to_string()),
            channels: vec![BridgeChannelStatus {
                platform: BridgePlatform::Telegram,
                enabled: true,
                state: BridgeChannelState::Ready,
                last_inbound_at: None,
                last_outbound_at: None,
                last_offset: None,
                last_error: None,
            }],
            pending_approvals: 1,
            bindings: 2,
            last_error: None,
        };
        apply_status_transition(&mut runtime, &status);
        assert_eq!(runtime.state, BridgeRuntimeState::Running);
        assert_eq!(runtime.version.as_deref(), Some("0.1.0"));
        assert_eq!(runtime.bindings, 2);

        runtime.state = BridgeRuntimeState::Crashed;
        runtime.last_error = Some("boom".to_string());
        finish_stop_transition(&mut runtime);
        assert_eq!(runtime.state, BridgeRuntimeState::Stopped);
        assert_eq!(runtime.pid, None);
    }

    #[test]
    fn wait_for_child_exit_is_bounded() {
        let mut child = spawn_long_running_process();
        let exited = wait_for_child_exit(&mut child, Duration::from_millis(50))
            .expect("wait should succeed");
        assert!(!exited);
        let _ = terminate_child(&mut child, Duration::from_millis(50));
    }

    #[cfg(windows)]
    fn spawn_long_running_process() -> Child {
        Command::new("cmd")
            .args(["/C", "ping -n 6 127.0.0.1 >NUL"])
            .spawn()
            .expect("child process should start")
    }

    #[cfg(not(windows))]
    fn spawn_long_running_process() -> Child {
        Command::new("sh")
            .args(["-c", "sleep 5"])
            .spawn()
            .expect("child process should start")
    }
}
