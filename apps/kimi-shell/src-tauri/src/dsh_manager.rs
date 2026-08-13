use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::atomic::Ordering,
    thread,
    time::{Duration, Instant},
};

use anyhow::{bail, Context};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    app_state::{unix_time_millis, AppState},
    backend_manager, command_utils, settings_store,
    types::DshSettings,
};

pub const DSH_PINNED_VERSION: &str = "0.1.0-rc.6";
const DSH_PACKAGE: &str = "@deepseek-ai/dsh";
const DSH_ENTRY_RELATIVE: &str = "node_modules/@deepseek-ai/dsh/lib/bin.js";
const DSH_LOG_MAX_BYTES: u64 = 10 * 1024 * 1024;
const STOP_TIMEOUT: Duration = Duration::from_secs(8);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DshRuntimeState {
    Stopped,
    Starting,
    Running,
    Crashed,
    Stopping,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DshStatus {
    pub state: DshRuntimeState,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub url: Option<String>,
    pub workspace_dir: Option<String>,
    pub started_at_ms: Option<u64>,
    pub exit_code: Option<i32>,
    pub last_error: Option<String>,
    pub pinned_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DshPreflight {
    pub ready: bool,
    pub node_path: Option<String>,
    pub node_version: Option<String>,
    pub npm_path: Option<String>,
    pub installed_version: Option<String>,
    pub pinned_version: String,
    pub install_path: String,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DshSettingsView {
    pub enabled: bool,
    pub port_range: [u16; 2],
    pub start_timeout_sec: u64,
    pub pinned_version: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DshSettingsInput {
    pub enabled: bool,
    pub port_range: [u16; 2],
    pub start_timeout_sec: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DshStartInput {
    pub workspace_dir: String,
}

#[tauri::command]
pub(crate) fn dsh_get_settings(app: AppHandle) -> Result<DshSettingsView, String> {
    let settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    Ok(settings_view(&settings.agent_backends.dsh))
}

#[tauri::command]
pub(crate) fn dsh_save_settings(
    app: AppHandle,
    input: DshSettingsInput,
) -> Result<DshSettingsView, String> {
    validate_settings(&input).map_err(|error| error.to_string())?;
    let mut settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    if settings.agent_backends.dsh.enabled && !input.enabled {
        stop(&app).map_err(|error| error.to_string())?;
    }
    settings.agent_backends.dsh = DshSettings {
        enabled: input.enabled,
        port_range: input.port_range,
        start_timeout_sec: input.start_timeout_sec,
    };
    settings_store::save(&app, &settings).map_err(|error| error.to_string())?;
    Ok(settings_view(&settings.agent_backends.dsh))
}

#[tauri::command]
pub(crate) fn dsh_get_preflight(app: AppHandle) -> Result<DshPreflight, String> {
    preflight(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn dsh_install(app: AppHandle) -> Result<DshPreflight, String> {
    tauri::async_runtime::spawn_blocking(move || install(&app))
        .await
        .map_err(|error| format!("DSH 安装任务异常结束：{error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn dsh_start(app: AppHandle, input: DshStartInput) -> Result<DshStatus, String> {
    start(&app, &input.workspace_dir).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn dsh_get_status(app: AppHandle) -> Result<DshStatus, String> {
    refresh_exit_state(&app).map_err(|error| error.to_string())?;
    status(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn dsh_stop(app: AppHandle) -> Result<DshStatus, String> {
    stop(&app).map_err(|error| error.to_string())?;
    status(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn dsh_get_log_tail(
    app: AppHandle,
    max_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    let state = app.state::<AppState>();
    let count = max_lines.unwrap_or(80).clamp(1, 500);
    let raw = match fs::read_to_string(&state.dsh_log_path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("读取 DSH 日志失败：{error}")),
    };
    let lines = raw.lines().rev().take(count).collect::<Vec<_>>();
    Ok(lines
        .into_iter()
        .rev()
        .map(backend_manager::redact_backend_text)
        .collect())
}

fn settings_view(settings: &DshSettings) -> DshSettingsView {
    DshSettingsView {
        enabled: settings.enabled,
        port_range: settings.port_range,
        start_timeout_sec: settings.start_timeout_sec,
        pinned_version: DSH_PINNED_VERSION.to_string(),
    }
}

fn validate_settings(input: &DshSettingsInput) -> anyhow::Result<()> {
    let [start, end] = input.port_range;
    if start == 0 || start > end || end.saturating_sub(start) > 1_000 {
        bail!("DSH 端口范围无效");
    }
    if !(10..=180).contains(&input.start_timeout_sec) {
        bail!("DSH 启动超时必须在 10–180 秒之间");
    }
    Ok(())
}

fn install_dir(app: &AppHandle) -> PathBuf {
    app.state::<AppState>().dsh_root_dir.join("current")
}

fn entry_path(app: &AppHandle) -> PathBuf {
    install_dir(app).join(DSH_ENTRY_RELATIVE)
}

fn installed_version_at(prefix: &Path) -> Option<String> {
    let package_json = prefix.join("node_modules/@deepseek-ai/dsh/package.json");
    let raw = fs::read_to_string(package_json).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    value.get("version")?.as_str().map(str::to_string)
}

fn command_version(path: &Path) -> Option<String> {
    let mut command = Command::new(path);
    command_utils::configure_system_command(&mut command);
    let output = command
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
}

fn preflight(app: &AppHandle) -> anyhow::Result<DshPreflight> {
    let node = which::which("node").ok();
    let npm = which::which(if cfg!(windows) { "npm.cmd" } else { "npm" }).ok();
    let prefix = install_dir(app);
    let installed_version = installed_version_at(&prefix);
    let mut issues = Vec::new();
    if node.is_none() {
        issues.push("未找到 Node.js；请安装 Node.js LTS 后重试。".to_string());
    }
    if npm.is_none() {
        issues.push("未找到 npm；安装或升级 DSH 前需要 npm。".to_string());
    }
    if installed_version.as_deref() != Some(DSH_PINNED_VERSION) || !entry_path(app).is_file() {
        issues.push(format!("尚未安装受支持的 DSH {DSH_PINNED_VERSION}。"));
    }
    Ok(DshPreflight {
        ready: node.is_some()
            && installed_version.as_deref() == Some(DSH_PINNED_VERSION)
            && entry_path(app).is_file(),
        node_version: node.as_deref().and_then(command_version),
        node_path: node.map(|path| path.to_string_lossy().into_owned()),
        npm_path: npm.map(|path| path.to_string_lossy().into_owned()),
        installed_version,
        pinned_version: DSH_PINNED_VERSION.to_string(),
        install_path: prefix.to_string_lossy().into_owned(),
        issues,
    })
}

fn install(app: &AppHandle) -> anyhow::Result<DshPreflight> {
    let shared = app.state::<AppState>();
    let _operation = shared
        .dsh_lifecycle_operation
        .lock()
        .map_err(|_| anyhow::anyhow!("DSH 生命周期锁已损坏"))?;
    let generation = shared
        .dsh_runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("DSH 状态锁已损坏"))?
        .generation;
    stop_generation(app, generation, false).context("安装 DSH 前停止现有实例失败")?;
    shared.dsh_cancel_requested.store(false, Ordering::Release);
    let npm = which::which(if cfg!(windows) { "npm.cmd" } else { "npm" })
        .context("未找到 npm；请先安装 Node.js LTS")?;
    let state = app.state::<AppState>();
    fs::create_dir_all(&state.dsh_root_dir).context("创建 DSH 私有目录失败")?;
    let nonce = unix_time_millis();
    let temporary = state
        .dsh_root_dir
        .join(format!("installing-{}-{nonce}", std::process::id()));
    let active = state.dsh_root_dir.join("current");
    let backup = state
        .dsh_root_dir
        .join(format!("backup-{}-{nonce}", std::process::id()));
    fs::create_dir(&temporary).context("创建 DSH 临时安装目录失败")?;
    append_log(app, format!("开始安装 {DSH_PACKAGE}@{DSH_PINNED_VERSION}"));

    let mut command = Command::new(npm);
    command_utils::configure_background_command(&mut command);
    command
        .args(["install", "--no-audit", "--no-fund", "--prefix"])
        .arg(&temporary)
        .arg(format!("{DSH_PACKAGE}@{DSH_PINNED_VERSION}"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    retain_safe_environment(&mut command);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                nix::unistd::setsid()
                    .map(|_| ())
                    .map_err(|error| std::io::Error::from_raw_os_error(error as i32))
            });
        }
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_dir_all(&temporary);
            return Err(error).context("启动 npm 安装失败");
        }
    };
    let install_group = owned_process_group_id(child.id());
    if let Err(error) = pipe_child_logs(app, &mut child) {
        let _ = terminate_process_tree(&mut child, install_group, Duration::from_millis(250));
        let _ = fs::remove_dir_all(&temporary);
        return Err(error);
    }
    let result = match wait_for_exit(
        &mut child,
        INSTALL_TIMEOUT,
        Some(&shared.dsh_cancel_requested),
    ) {
        Ok(result) => result,
        Err(error) => {
            let _ = terminate_process_tree(&mut child, install_group, Duration::from_secs(2));
            let _ = fs::remove_dir_all(&temporary);
            return Err(error);
        }
    };
    let Some(result) = result else {
        let _ = terminate_process_tree(&mut child, install_group, Duration::from_secs(2));
        let _ = fs::remove_dir_all(&temporary);
        if shared.dsh_cancel_requested.swap(false, Ordering::AcqRel) {
            bail!("DSH 安装已取消");
        }
        bail!("DSH 安装超过 10 分钟，已终止安装进程树");
    };
    if !result.success() {
        let _ = fs::remove_dir_all(&temporary);
        bail!(
            "npm 安装 DSH 失败（exit={:?}），请查看 DSH 日志",
            result.code()
        );
    }
    if let Err(error) = verify_install(&temporary) {
        let _ = fs::remove_dir_all(&temporary);
        return Err(error);
    }

    if active.exists() {
        fs::rename(&active, &backup).context("备份当前 DSH 安装失败")?;
    }
    if let Err(error) = fs::rename(&temporary, &active) {
        if backup.exists() {
            let _ = fs::rename(&backup, &active);
        }
        bail!("启用新 DSH 安装失败：{error}");
    }
    if backup.exists() {
        let _ = fs::remove_dir_all(&backup);
    }
    append_log(app, format!("DSH {DSH_PINNED_VERSION} 安装完成"));
    preflight(app)
}

fn verify_install(prefix: &Path) -> anyhow::Result<()> {
    let version = installed_version_at(prefix).context("DSH package.json 缺失或无效")?;
    if version != DSH_PINNED_VERSION {
        bail!("DSH 安装版本不匹配：期望 {DSH_PINNED_VERSION}，实际 {version}");
    }
    let entry = prefix.join(DSH_ENTRY_RELATIVE);
    if !entry.is_file() {
        bail!("DSH 固定入口不存在：{}", entry.display());
    }
    Ok(())
}

fn start(app: &AppHandle, workspace: &str) -> anyhow::Result<DshStatus> {
    let shared = app.state::<AppState>();
    let _operation = shared
        .dsh_lifecycle_operation
        .lock()
        .map_err(|_| anyhow::anyhow!("DSH 生命周期锁已损坏"))?;
    refresh_exit_state(app)?;
    let settings = settings_store::load_or_default(app)?;
    if !settings.agent_backends.dsh.enabled {
        bail!("DSH 实验功能尚未开启");
    }
    let report = preflight(app)?;
    if !report.ready {
        bail!("DSH 尚未就绪：{}", report.issues.join(" "));
    }
    let workspace = fs::canonicalize(workspace).context("工作目录不存在或不可访问")?;
    if !workspace.is_dir() {
        bail!("工作目录不是文件夹");
    }
    {
        let runtime = shared
            .dsh_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("DSH 状态锁已损坏"))?;
        if runtime.child.is_some() {
            bail!("已有 DSH 实例正在运行；P0 仅支持单实例");
        }
    }
    let port = allocate_port(settings.agent_backends.dsh.port_range)?;
    rotate_log(&shared.dsh_log_path)?;
    let node = PathBuf::from(report.node_path.context("Node.js 路径缺失")?);
    let entry = entry_path(app);
    let mut command = Command::new(node);
    command_utils::configure_background_command(&mut command);
    let args = dsh_web_args(port);
    command
        .arg(entry)
        .args(args)
        .current_dir(&workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    retain_safe_environment(&mut command);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                nix::unistd::setsid()
                    .map(|_| ())
                    .map_err(|error| std::io::Error::from_raw_os_error(error as i32))
            });
        }
    }
    let mut child = command.spawn().context("启动 DSH 失败")?;
    let pid = child.id();
    if let Err(error) = pipe_child_logs(app, &mut child) {
        let mut process = child;
        let group = owned_process_group_id(process.id());
        let _ = terminate_process_tree(&mut process, group, Duration::from_millis(250));
        return Err(error);
    }
    let url = format!("http://127.0.0.1:{port}");
    let generation = {
        let mut runtime = shared
            .dsh_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("DSH 状态锁已损坏"))?;
        runtime.generation = runtime.generation.saturating_add(1);
        runtime.state = DshRuntimeState::Starting;
        runtime.process_group_id = owned_process_group_id(pid);
        runtime.child = Some(child);
        runtime.pid = Some(pid);
        runtime.port = Some(port);
        runtime.url = Some(url.clone());
        runtime.workspace_dir = Some(workspace.clone());
        runtime.started_at_ms = Some(unix_time_millis());
        runtime.exit_code = None;
        runtime.last_error = None;
        runtime.generation
    };
    append_log(
        app,
        format!("DSH 启动中 pid={pid} workspace={}", workspace.display()),
    );
    spawn_monitor(
        app.clone(),
        generation,
        url,
        settings.agent_backends.dsh.start_timeout_sec,
    );
    status(app)
}

fn allocate_port(range: [u16; 2]) -> anyhow::Result<u16> {
    for port in range[0]..=range[1] {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    bail!("E-DSH-003：配置的端口范围内没有空闲端口")
}

fn dsh_web_args(port: u16) -> [String; 3] {
    ["web".to_string(), "--port".to_string(), port.to_string()]
}

fn wait_for_exit(
    child: &mut Child,
    timeout: Duration,
    cancel: Option<&std::sync::atomic::AtomicBool>,
) -> anyhow::Result<Option<std::process::ExitStatus>> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait().context("检查子进程状态失败")? {
            return Ok(Some(status));
        }
        if cancel
            .map(|cancel| cancel.load(Ordering::Acquire))
            .unwrap_or(false)
        {
            return Ok(None);
        }
        if Instant::now() >= deadline {
            return Ok(None);
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn retain_safe_environment(command: &mut Command) {
    const ALLOWED: &[&str] = &[
        "PATH",
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "TEMP",
        "TMP",
        "SystemRoot",
        "SYSTEMROOT",
        "COMSPEC",
        "PATHEXT",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
        "DSH_HOME",
        "XDG_CONFIG_HOME",
        "NPM_CONFIG_REGISTRY",
        "NODE_EXTRA_CA_CERTS",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "LANG",
        "LC_ALL",
        "NO_PROXY",
        "no_proxy",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "http_proxy",
        "https_proxy",
    ];
    let values = ALLOWED
        .iter()
        .filter_map(|name| std::env::var_os(name).map(|value| (*name, value)))
        .collect::<Vec<_>>();
    command.env_clear();
    command.envs(values);
}

fn spawn_monitor(app: AppHandle, generation: u64, url: String, timeout_sec: u64) {
    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(timeout_sec);
        loop {
            thread::sleep(Duration::from_millis(250));
            if refresh_exit_state(&app).is_err() {
                return;
            }
            let current = status(&app).ok();
            if current.as_ref().and_then(|value| value.pid).is_none() {
                return;
            }
            let same_generation = app
                .state::<AppState>()
                .dsh_runtime
                .lock()
                .map(|runtime| runtime.generation == generation)
                .unwrap_or(false);
            if !same_generation {
                return;
            }
            if health_up(&url) {
                if let Ok(mut runtime) = app.state::<AppState>().dsh_runtime.lock() {
                    if runtime.generation == generation
                        && runtime.state == DshRuntimeState::Starting
                    {
                        runtime.state = DshRuntimeState::Running;
                        append_log(&app, format!("DSH 已就绪 {url}"));
                    }
                }
                return;
            }
            if Instant::now() >= deadline {
                if let Ok(mut runtime) = app.state::<AppState>().dsh_runtime.lock() {
                    if runtime.generation == generation {
                        runtime.last_error =
                            Some("E-DSH-004：启动超时，HTTP readiness 未通过".to_string());
                    }
                }
                let _ = stop_monitored_generation(&app, generation);
                return;
            }
        }
    });
}

fn health_up(url: &str) -> bool {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(1))
        .redirect(reqwest::redirect::Policy::none())
        .build();
    client
        .and_then(|client| client.get(url).send())
        .map(|response| response.status().is_success() || response.status().is_redirection())
        .unwrap_or(false)
}

fn refresh_exit_state(app: &AppHandle) -> anyhow::Result<()> {
    let shared = app.state::<AppState>();
    let mut runtime = shared
        .dsh_runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("DSH 状态锁已损坏"))?;
    let Some(child) = runtime.child.as_mut() else {
        return Ok(());
    };
    let Some(exit) = child.try_wait().context("检查 DSH 进程状态失败")? else {
        return Ok(());
    };
    runtime.child = None;
    runtime.process_group_id = None;
    runtime.pid = None;
    runtime.port = None;
    runtime.url = None;
    runtime.exit_code = exit.code();
    if runtime.state == DshRuntimeState::Stopping {
        runtime.state = DshRuntimeState::Stopped;
    } else {
        runtime.state = DshRuntimeState::Crashed;
        runtime.last_error = Some(format!("E-DSH-005：DSH 异常退出（exit={:?}）", exit.code()));
    }
    Ok(())
}

pub(crate) fn stop(app: &AppHandle) -> anyhow::Result<()> {
    let shared = app.state::<AppState>();
    shared.dsh_cancel_requested.store(true, Ordering::Release);
    let _operation = shared
        .dsh_lifecycle_operation
        .lock()
        .map_err(|_| anyhow::anyhow!("DSH 生命周期锁已损坏"))?;
    let generation = shared
        .dsh_runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("DSH 状态锁已损坏"))?
        .generation;
    stop_generation(app, generation, false)
}

fn stop_monitored_generation(app: &AppHandle, generation: u64) -> anyhow::Result<()> {
    let shared = app.state::<AppState>();
    let _operation = shared
        .dsh_lifecycle_operation
        .lock()
        .map_err(|_| anyhow::anyhow!("DSH 生命周期锁已损坏"))?;
    stop_generation(app, generation, true)
}

fn stop_generation(app: &AppHandle, generation: u64, preserve_error: bool) -> anyhow::Result<()> {
    let shared = app.state::<AppState>();
    let (mut child, group) = {
        let mut runtime = shared
            .dsh_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("DSH 状态锁已损坏"))?;
        if runtime.generation != generation {
            return Ok(());
        }
        let Some(child) = runtime.child.take() else {
            if !preserve_error {
                runtime.state = DshRuntimeState::Stopped;
            }
            return Ok(());
        };
        runtime.state = DshRuntimeState::Stopping;
        (child, runtime.process_group_id.take())
    };
    let confirmed = terminate_process_tree(&mut child, group, STOP_TIMEOUT);
    let mut runtime = shared
        .dsh_runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("DSH 状态锁已损坏"))?;
    if !confirmed {
        runtime.child = Some(child);
        runtime.process_group_id = group;
        runtime.state = DshRuntimeState::Crashed;
        runtime.last_error = Some("DSH 进程树未能确认关闭".to_string());
        bail!("DSH 进程树未能确认关闭");
    }
    runtime.state = if preserve_error {
        DshRuntimeState::Crashed
    } else {
        DshRuntimeState::Stopped
    };
    runtime.pid = None;
    runtime.port = None;
    runtime.url = None;
    if !preserve_error {
        runtime.last_error = None;
    }
    append_log(app, "DSH 已停止");
    Ok(())
}

fn status(app: &AppHandle) -> anyhow::Result<DshStatus> {
    let shared = app.state::<AppState>();
    let runtime = shared
        .dsh_runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("DSH 状态锁已损坏"))?;
    Ok(DshStatus {
        state: runtime.state,
        pid: runtime.pid,
        port: runtime.port,
        url: runtime.url.clone(),
        workspace_dir: runtime
            .workspace_dir
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
        started_at_ms: runtime.started_at_ms,
        exit_code: runtime.exit_code,
        last_error: runtime.last_error.clone(),
        pinned_version: DSH_PINNED_VERSION.to_string(),
    })
}

fn pipe_child_logs(app: &AppHandle, child: &mut Child) -> anyhow::Result<()> {
    let stdout = child.stdout.take().context("DSH stdout pipe 不可用")?;
    let stderr = child.stderr.take().context("DSH stderr pipe 不可用")?;
    let path = app.state::<AppState>().dsh_log_path.clone();
    spawn_log_reader(stdout, path.clone());
    spawn_log_reader(stderr, path);
    Ok(())
}

fn spawn_log_reader(stream: impl Read + Send + 'static, path: PathBuf) {
    thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            let safe = backend_manager::redact_backend_text(&line);
            if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
                let _ = writeln!(file, "{safe}");
            }
        }
    });
}

fn append_log(app: &AppHandle, message: impl AsRef<str>) {
    let path = app.state::<AppState>().dsh_log_path.clone();
    let safe = backend_manager::redact_backend_text(message.as_ref());
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{} {safe}", unix_time_millis());
    }
}

fn rotate_log(path: &Path) -> anyhow::Result<()> {
    if path
        .metadata()
        .map(|meta| meta.len() >= DSH_LOG_MAX_BYTES)
        .unwrap_or(false)
    {
        let rotated = path.with_extension("log.1");
        let _ = fs::remove_file(&rotated);
        fs::rename(path, rotated).context("轮转 DSH 日志失败")?;
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    File::options().create(true).append(true).open(path)?;
    Ok(())
}

#[cfg(unix)]
fn owned_process_group_id(pid: u32) -> Option<i32> {
    i32::try_from(pid).ok().filter(|value| *value > 0)
}
#[cfg(not(unix))]
fn owned_process_group_id(_pid: u32) -> Option<i32> {
    None
}

fn terminate_process_tree(child: &mut Child, group: Option<i32>, timeout: Duration) -> bool {
    let pid = child.id();
    soft_terminate(pid, group);
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) && !process_group_alive(group) {
            return true;
        }
        thread::sleep(Duration::from_millis(50));
    }
    let force_sent = force_terminate(pid, group);
    let reaped = child.wait().is_ok();
    let deadline = Instant::now() + Duration::from_millis(500);
    while process_group_alive(group) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(25));
    }
    reaped && !process_group_alive(group) && force_sent
}

#[cfg(unix)]
fn process_group_alive(group: Option<i32>) -> bool {
    use nix::{errno::Errno, sys::signal, unistd::Pid};
    group
        .map(|group| match signal::killpg(Pid::from_raw(group), None) {
            Ok(()) | Err(Errno::EPERM) => true,
            Err(Errno::ESRCH) => false,
            Err(_) => true,
        })
        .unwrap_or(false)
}
#[cfg(not(unix))]
fn process_group_alive(_group: Option<i32>) -> bool {
    false
}

#[cfg(unix)]
fn soft_terminate(pid: u32, group: Option<i32>) {
    use nix::{sys::signal, unistd::Pid};
    if let Some(group) = group {
        let _ = signal::killpg(Pid::from_raw(group), signal::Signal::SIGTERM);
    } else if let Ok(pid) = i32::try_from(pid) {
        let _ = signal::kill(Pid::from_raw(pid), signal::Signal::SIGTERM);
    }
}
#[cfg(windows)]
fn soft_terminate(pid: u32, _group: Option<i32>) {
    let mut command = Command::new("taskkill");
    command_utils::configure_system_command(&mut command);
    let _ = command.args(["/PID", &pid.to_string(), "/T"]).status();
}
#[cfg(not(any(unix, windows)))]
fn soft_terminate(_pid: u32, _group: Option<i32>) {}

#[cfg(unix)]
fn force_terminate(pid: u32, group: Option<i32>) -> bool {
    use nix::{errno::Errno, sys::signal, unistd::Pid};
    if let Some(group) = group {
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
fn force_terminate(pid: u32, _group: Option<i32>) -> bool {
    let mut command = Command::new("taskkill");
    command_utils::configure_system_command(&mut command);
    command
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .map(|value| value.success())
        .unwrap_or(false)
}
#[cfg(not(any(unix, windows)))]
fn force_terminate(_pid: u32, _group: Option<i32>) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_port_and_timeout_bounds() {
        assert!(validate_settings(&DshSettingsInput {
            enabled: true,
            port_range: [3080, 3179],
            start_timeout_sec: 60
        })
        .is_ok());
        assert!(validate_settings(&DshSettingsInput {
            enabled: true,
            port_range: [0, 3179],
            start_timeout_sec: 60
        })
        .is_err());
        assert!(validate_settings(&DshSettingsInput {
            enabled: true,
            port_range: [4000, 3000],
            start_timeout_sec: 60
        })
        .is_err());
        assert!(validate_settings(&DshSettingsInput {
            enabled: true,
            port_range: [3080, 3179],
            start_timeout_sec: 5
        })
        .is_err());
    }

    #[test]
    fn web_args_keep_port_as_a_distinct_argv_element() {
        assert_eq!(dsh_web_args(3_080), ["web", "--port", "3080"]);
    }

    #[test]
    fn verifies_only_exact_pinned_package_and_entry() {
        let root = std::env::temp_dir().join(format!(
            "dsh-verify-{}-{}",
            std::process::id(),
            unix_time_millis()
        ));
        let package = root.join("node_modules/@deepseek-ai/dsh");
        fs::create_dir_all(package.join("lib")).expect("mkdir");
        fs::write(
            package.join("package.json"),
            format!(r#"{{"version":"{DSH_PINNED_VERSION}"}}"#),
        )
        .expect("package json");
        fs::write(package.join("lib/bin.js"), "#!/usr/bin/env node").expect("entry");
        assert!(verify_install(&root).is_ok());
        fs::write(package.join("package.json"), r#"{"version":"0.0.0"}"#).expect("wrong version");
        assert!(verify_install(&root).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn terminates_owned_process_group_with_descendant() {
        use std::os::unix::process::CommandExt;

        let mut command = Command::new("/bin/sh");
        command.args(["-c", "sleep 30 & wait"]);
        unsafe {
            command.pre_exec(|| {
                nix::unistd::setsid()
                    .map(|_| ())
                    .map_err(|error| std::io::Error::from_raw_os_error(error as i32))
            });
        }
        let mut child = command.spawn().expect("spawn process group");
        let group = owned_process_group_id(child.id());
        assert!(group.is_some());
        assert!(terminate_process_tree(
            &mut child,
            group,
            Duration::from_millis(250)
        ));
        assert!(!process_group_alive(group));
    }
}
