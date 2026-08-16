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
use tauri::{ipc::Channel, AppHandle, Manager};

use crate::{
    app_state::{unix_time_millis, AppState},
    backend_manager, command_utils, nodejs_locator, settings_store,
    types::DshSettings,
};

pub const DSH_PINNED_VERSION: &str = "0.1.0-rc.6";
const DSH_PACKAGE: &str = "@deepseek-ai/dsh";
const DSH_ENTRY_RELATIVE: &str = "node_modules/@deepseek-ai/dsh/lib/bin.js";
const DSH_NODE_REQUIREMENT: &str = "22.19+ 的 22.x，或 24+";
const DSH_NODE_FEATURE_PROBE: &str =
    "const {parseEnv}=require('node:util');if(typeof parseEnv!=='function')process.exit(1);parseEnv('DSH=1')";
const DSH_LOG_MAX_BYTES: u64 = 10 * 1024 * 1024;
const DSH_LOG_LINE_MAX_BYTES: usize = 64 * 1024;
const DSH_HTTP_BODY_MAX_BYTES: u64 = 512 * 1024;
const DSH_BOOT_MARKER: &str = "__DSH_BOOT__";
const DSH_READINESS_TIMEOUT_PREFIX: &str = "E-DSH-004：启动超时，HTTP 状态或 DSH 页面身份未通过";
const STOP_TIMEOUT: Duration = Duration::from_secs(8);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const HEALTH_INTERVAL: Duration = Duration::from_secs(5);
const HEALTH_FAILURE_THRESHOLD: u8 = 3;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DshRuntimeState {
    Stopped,
    Starting,
    Running,
    Degraded,
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
    /// Compatibility projection retained for existing callers. Equivalent to
    /// `runtime_ready` and deliberately independent from npm availability.
    pub ready: bool,
    pub runtime_ready: bool,
    pub install_ready: bool,
    pub node_supported: bool,
    pub npm_available: bool,
    pub install_valid: bool,
    pub node_path: Option<String>,
    pub node_version: Option<String>,
    pub install_node_path: Option<String>,
    pub install_node_version: Option<String>,
    pub npm_path: Option<String>,
    pub installed_version: Option<String>,
    pub pinned_version: String,
    pub install_path: String,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DshInstallStage {
    Preflight,
    Prepare,
    Install,
    Verify,
    Activate,
    Start,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DshInstallStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DshInstallEvent {
    Stage {
        stage: DshInstallStage,
        message: String,
    },
    Output {
        stream: DshInstallStream,
        line: String,
    },
    Completed {
        version: String,
    },
    Failed {
        code: String,
        message: String,
    },
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
    let view = settings_view(&settings.agent_backends.dsh);
    if input.enabled {
        if let Err(error) = start_default_workspace(&app) {
            append_log(&app, format!("DSH 默认工作区启动失败：{error:#}"));
        }
    }
    Ok(view)
}

#[tauri::command]
pub(crate) fn dsh_get_preflight(app: AppHandle) -> Result<DshPreflight, String> {
    preflight(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn dsh_install(
    app: AppHandle,
    progress: Channel<DshInstallEvent>,
) -> Result<DshPreflight, String> {
    send_install_stage(
        Some(&progress),
        DshInstallStage::Preflight,
        "正在检测 Node.js 与 npm",
    );
    let install_app = app.clone();
    let install_progress = progress.clone();
    let report = tauri::async_runtime::spawn_blocking(move || {
        install(&install_app, Some(&install_progress))
    })
    .await
    .map_err(|error| format!("DSH 安装任务异常结束：{error}"))?
    .map_err(|error| error.to_string());
    let report = match report {
        Ok(report) => report,
        Err(message) => {
            let _ = progress.send(DshInstallEvent::Failed {
                code: dsh_error_code(&message).to_string(),
                message: message.clone(),
            });
            return Err(message);
        }
    };
    if report.runtime_ready {
        send_install_stage(
            Some(&progress),
            DshInstallStage::Start,
            "正在启动默认工作区",
        );
        if let Err(error) = start_default_workspace(&app) {
            append_log(&app, format!("DSH 安装后自动启动失败：{error:#}"));
        }
    }
    let _ = progress.send(DshInstallEvent::Completed {
        version: DSH_PINNED_VERSION.to_string(),
    });
    Ok(report)
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
    let count = max_lines.unwrap_or(80).clamp(1, 500);
    read_log_tail(&app, count).map_err(|error| error.to_string())
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

pub(crate) fn start_default_workspace_if_enabled(app: AppHandle) {
    thread::spawn(move || {
        if let Err(error) = start_default_workspace(&app) {
            append_log(&app, format!("DSH 默认工作区自动启动失败：{error:#}"));
        }
    });
}

fn start_default_workspace(app: &AppHandle) -> anyhow::Result<()> {
    let settings = settings_store::load_or_default(app)?;
    if !settings.agent_backends.dsh.enabled {
        return Ok(());
    }
    let workspace = backend_manager::resolve_working_directory(&settings, None)?;
    start(app, workspace.to_string_lossy().as_ref())?;
    Ok(())
}

fn install_dir(app: &AppHandle) -> PathBuf {
    app.state::<AppState>().dsh_root_dir.join("current")
}

fn verified_file_within(prefix: &Path, relative: &str) -> anyhow::Result<PathBuf> {
    let root = fs::canonicalize(prefix)
        .with_context(|| format!("DSH 私有安装目录无效：{}", prefix.display()))?;
    let candidate = prefix.join(relative);
    let file = fs::canonicalize(&candidate)
        .with_context(|| format!("DSH 安装文件不存在：{}", candidate.display()))?;
    if !file.is_file() || !file.starts_with(&root) {
        bail!("DSH 安装文件越出私有目录：{}", candidate.display());
    }
    Ok(file)
}

fn verified_entry_at(prefix: &Path) -> anyhow::Result<PathBuf> {
    verified_file_within(prefix, DSH_ENTRY_RELATIVE)
}

fn installed_version_at(prefix: &Path) -> Option<String> {
    let package_json =
        verified_file_within(prefix, "node_modules/@deepseek-ai/dsh/package.json").ok()?;
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

fn parse_node_version(raw: &str) -> Option<(u32, u32, u32)> {
    let normalized = raw.trim().strip_prefix('v').unwrap_or(raw.trim());
    if normalized.contains(['-', '+']) {
        return None;
    }
    let mut parts = normalized.split('.');
    let version = (
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    );
    parts.next().is_none().then_some(version)
}

fn node_version_supported(raw: &str) -> bool {
    matches!(
        parse_node_version(raw),
        Some((22, minor, _)) if minor >= 19
    ) || matches!(parse_node_version(raw), Some((major, _, _)) if major >= 24)
}

fn node_supports_required_features(path: &Path) -> bool {
    let mut command = Command::new(path);
    command_utils::configure_system_command(&mut command);
    command
        .args(["-e", DSH_NODE_FEATURE_PROBE])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn select_node_for_runtime() -> Option<(nodejs_locator::NodejsToolchain, String, bool)> {
    let mut fallback = None;
    for runtime in nodejs_locator::candidates() {
        let Some(version) = command_version(&runtime.node_path) else {
            continue;
        };
        let supported =
            node_version_supported(&version) && node_supports_required_features(&runtime.node_path);
        if supported {
            return Some((runtime, version, true));
        }
        fallback.get_or_insert((runtime, version, false));
    }
    fallback
}

fn select_node_toolchain_for_install(
) -> Option<(nodejs_locator::NodejsToolchain, String, NpmLauncher)> {
    for runtime in nodejs_locator::candidates() {
        let Some(version) = command_version(&runtime.node_path) else {
            continue;
        };
        if !node_version_supported(&version) || !node_supports_required_features(&runtime.node_path)
        {
            continue;
        }
        let Some(npm_path) = runtime.npm_path.as_deref() else {
            continue;
        };
        let Ok(launcher) = resolve_npm_launcher(
            &runtime.node_path,
            npm_path,
            cfg!(windows),
            validated_windows_command_processor().ok(),
        ) else {
            continue;
        };
        return Some((runtime, version, launcher));
    }
    None
}

fn preflight(app: &AppHandle) -> anyhow::Result<DshPreflight> {
    let runtime = select_node_for_runtime();
    let node_supported = runtime
        .as_ref()
        .map(|(_, _, supported)| *supported)
        .unwrap_or(false);
    let node = runtime
        .as_ref()
        .map(|(runtime, _, _)| runtime.node_path.clone());
    let node_version = runtime.as_ref().map(|(_, version, _)| version.clone());
    let install_toolchain = select_node_toolchain_for_install();
    let npm = install_toolchain
        .as_ref()
        .and_then(|(runtime, _, _)| runtime.npm_path.clone());
    let install_node = install_toolchain
        .as_ref()
        .map(|(runtime, _, _)| runtime.node_path.clone());
    let install_node_version = install_toolchain
        .as_ref()
        .map(|(_, version, _)| version.clone());
    let prefix = install_dir(app);
    let installed_version = installed_version_at(&prefix);
    let install_valid = verify_install(&prefix).is_ok();
    let mut issues = Vec::new();
    if node.is_none() {
        issues.push(
            "E-DSH-001：未找到 Node.js；请从 nodejs.org 或 Homebrew 安装 Node.js LTS 后重试。"
                .to_string(),
        );
    } else if !node_supported {
        issues.push(format!(
            "E-DSH-001：DSH {DSH_PINNED_VERSION} 支持 Node.js {DSH_NODE_REQUIREMENT}，并要求 parseEnv 运行时能力；当前为 {}。请升级 Node.js LTS。",
            node_version.as_deref().unwrap_or("未知版本")
        ));
    }
    if npm.is_none() {
        issues.push(
            "未找到与受支持 Node.js 同工具链且可启动的 npm；安装或升级 DSH 前需要完整 Node.js LTS。"
                .to_string(),
        );
    }
    if !install_valid {
        issues.push(format!("尚未安装受支持的 DSH {DSH_PINNED_VERSION}。"));
    }
    let runtime_ready = node_supported && install_valid;
    let install_ready = install_toolchain.is_some();
    Ok(DshPreflight {
        ready: runtime_ready,
        runtime_ready,
        install_ready,
        node_supported,
        npm_available: install_toolchain.is_some(),
        install_valid,
        node_version,
        node_path: node.map(|path| path.to_string_lossy().into_owned()),
        install_node_path: install_node.map(|path| path.to_string_lossy().into_owned()),
        install_node_version,
        npm_path: npm.map(|path| path.to_string_lossy().into_owned()),
        installed_version,
        pinned_version: DSH_PINNED_VERSION.to_string(),
        install_path: prefix.to_string_lossy().into_owned(),
        issues,
    })
}

fn install(
    app: &AppHandle,
    progress: Option<&Channel<DshInstallEvent>>,
) -> anyhow::Result<DshPreflight> {
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
    let (runtime, _node_version, launcher) = select_node_toolchain_for_install().with_context(|| {
        format!(
            "E-DSH-001：未找到 Node.js {DSH_NODE_REQUIREMENT} 与同工具链 npm；请安装完整的 Node.js LTS"
        )
    })?;
    let mut command = launcher.command();
    command_utils::configure_background_command(&mut command);
    let state = app.state::<AppState>();
    send_install_stage(progress, DshInstallStage::Prepare, "正在准备私有安装目录");
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
    send_install_stage(
        progress,
        DshInstallStage::Install,
        "正在连接 npm registry 并安装固定版本",
    );

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    retain_safe_environment(&mut command, Some(&runtime.node_path));
    launcher.configure_install(&mut command, &temporary);
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
            append_log(app, format!("npm 安装进程启动失败：{error}"));
            return Err(error).context(
                "E-DSH-002：无法启动 Node/npm 安装进程；请修复 Node.js/npm 安装或检查执行权限，并查看 DSH 日志",
            );
        }
    };
    let install_group = owned_process_group_id(child.id());
    if let Err(error) = pipe_install_logs(app, &mut child, progress.cloned()) {
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
        bail!("E-DSH-002：DSH 安装超过 10 分钟；请检查 npm registry 与网络/代理设置，安装进程树已终止");
    };
    if !result.success() {
        let _ = fs::remove_dir_all(&temporary);
        bail!(
            "E-DSH-002：npm 安装 DSH 失败（exit={:?}），请检查 registry、网络/代理并查看 DSH 日志",
            result.code()
        );
    }
    send_install_stage(
        progress,
        DshInstallStage::Verify,
        "正在校验固定版本与私有入口",
    );
    if let Err(error) = verify_install(&temporary) {
        let _ = fs::remove_dir_all(&temporary);
        return Err(error);
    }

    send_install_stage(progress, DshInstallStage::Activate, "正在启用已校验的安装");
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

#[derive(Debug, Clone, PartialEq, Eq)]
enum NpmLauncher {
    Direct(PathBuf),
    NodeCli {
        node: PathBuf,
        npm_cli: PathBuf,
    },
    CommandScript {
        command_processor: PathBuf,
        npm_script: PathBuf,
    },
}

impl NpmLauncher {
    fn command(&self) -> Command {
        match self {
            Self::Direct(path) => Command::new(path),
            Self::NodeCli { node, .. } => Command::new(node),
            Self::CommandScript {
                command_processor, ..
            } => {
                let mut command = Command::new(command_processor);
                if let Self::CommandScript { npm_script, .. } = self {
                    if let Some(directory) = npm_script.parent() {
                        command.current_dir(directory);
                    }
                }
                command
            }
        }
    }

    fn configure_install(&self, command: &mut Command, prefix: &Path) {
        match self {
            Self::Direct(_) => {
                append_direct_npm_install_args(command, prefix);
            }
            Self::NodeCli { npm_cli, .. } => {
                command.arg(npm_cli);
                append_direct_npm_install_args(command, prefix);
            }
            Self::CommandScript { .. } => {
                // The command string is entirely fixed. The validated shim is
                // resolved through the native working directory and the
                // dynamic install prefix travels only through npm's environment
                // config. Delayed expansion and cmd AutoRun hooks stay disabled.
                let command_line = format!(
                    "npm.cmd install --no-audit --no-fund {DSH_PACKAGE}@{DSH_PINNED_VERSION}"
                );
                command
                    .args(["/D", "/S", "/V:OFF", "/C"])
                    .arg(command_line)
                    .env("npm_config_prefix", prefix);
            }
        }
    }
}

fn append_direct_npm_install_args(command: &mut Command, prefix: &Path) {
    command
        .args(["install", "--no-audit", "--no-fund", "--prefix"])
        .arg(prefix)
        .arg(format!("{DSH_PACKAGE}@{DSH_PINNED_VERSION}"));
}

fn resolve_npm_launcher(
    node_path: &Path,
    npm_path: &Path,
    windows: bool,
    command_processor: Option<PathBuf>,
) -> anyhow::Result<NpmLauncher> {
    if windows && is_windows_command_script(npm_path) {
        if let Some(npm_cli) = npm_cli_candidates(node_path, npm_path)
            .into_iter()
            .find(|path| path.is_file())
        {
            return Ok(NpmLauncher::NodeCli {
                node: node_path.to_path_buf(),
                npm_cli,
            });
        }
        let command_processor = command_processor.with_context(|| {
            format!(
                "E-DSH-001：检测到 npm shim {}，但真实 npm-cli.js 与受信任的 Windows 命令处理器均不可用",
                npm_path.display()
            )
        })?;
        let shim_name = npm_path
            .file_name()
            .and_then(|name| name.to_str())
            .context("Windows npm shim 文件名无效")?;
        if !shim_name.eq_ignore_ascii_case("npm.cmd") {
            bail!("E-DSH-001：Windows shell fallback 只允许同工具链 npm.cmd");
        }
        return Ok(NpmLauncher::CommandScript {
            command_processor,
            npm_script: npm_path.to_path_buf(),
        });
    }
    Ok(NpmLauncher::Direct(npm_path.to_path_buf()))
}

#[cfg(windows)]
fn validated_windows_command_processor() -> anyhow::Result<PathBuf> {
    let system_root = std::env::var_os("SystemRoot")
        .or_else(|| std::env::var_os("SYSTEMROOT"))
        .context("Windows SystemRoot 未定义")?;
    let expected = fs::canonicalize(PathBuf::from(system_root).join("System32/cmd.exe"))
        .context("Windows 系统 cmd.exe 不可用")?;
    if !expected.is_file() {
        bail!("Windows 系统 cmd.exe 不是普通文件");
    }
    if let Some(comspec) = std::env::var_os("COMSPEC") {
        let actual = fs::canonicalize(comspec).context("COMSPEC 指向无效路径")?;
        if actual != expected {
            bail!("COMSPEC 未指向 Windows 系统 cmd.exe");
        }
    }
    Ok(expected)
}

#[cfg(not(windows))]
fn validated_windows_command_processor() -> anyhow::Result<PathBuf> {
    bail!("Windows 命令处理器只在 Windows 上可用")
}

fn is_windows_command_script(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
        })
        .unwrap_or(false)
}

fn npm_cli_candidates(node_path: &Path, npm_path: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for directory in [npm_path.parent(), node_path.parent()]
        .into_iter()
        .flatten()
    {
        let candidate = directory.join("node_modules/npm/bin/npm-cli.js");
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
    candidates
}

fn verify_install(prefix: &Path) -> anyhow::Result<()> {
    let version = installed_version_at(prefix).context("DSH package.json 缺失或无效")?;
    if version != DSH_PINNED_VERSION {
        bail!("DSH 安装版本不匹配：期望 {DSH_PINNED_VERSION}，实际 {version}");
    }
    verified_entry_at(prefix).context("DSH 固定入口无效")?;
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
            if runtime.workspace_dir.as_deref() == Some(workspace.as_path()) {
                drop(runtime);
                return status(app);
            }
            bail!("已有 DSH 实例正在运行；P0 仅支持单实例");
        }
    }
    let port = allocate_port(settings.agent_backends.dsh.port_range)?;
    prepare_log(app)?;
    let node = PathBuf::from(report.node_path.context("Node.js 路径缺失")?);
    let entry = verified_entry_at(&install_dir(app)).context("DSH 固定入口无效")?;
    let mut command = Command::new(&node);
    command_utils::configure_background_command(&mut command);
    let args = dsh_web_args(port);
    command
        .arg(entry)
        .args(args)
        .current_dir(&workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    retain_safe_environment(&mut command, Some(&node));
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

fn retain_safe_environment(command: &mut Command, node_path: Option<&Path>) {
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
        .filter(|name| **name != "PATH")
        .filter_map(|name| std::env::var_os(name).map(|value| (*name, value)))
        .collect::<Vec<_>>();
    let mut path_entries = node_path
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .into_iter()
        .collect::<Vec<_>>();
    if let Some(path) = std::env::var_os("PATH") {
        path_entries.extend(std::env::split_paths(&path));
    }
    command.env_clear();
    command.envs(values);
    if let Ok(path) = std::env::join_paths(path_entries) {
        command.env("PATH", path);
    }
}

fn spawn_monitor(app: AppHandle, generation: u64, url: String, timeout_sec: u64) {
    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(timeout_sec);
        let mut health_failures = 0_u8;
        let mut ready = false;
        loop {
            thread::sleep(if ready {
                HEALTH_INTERVAL
            } else {
                Duration::from_millis(250)
            });
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
            let http_up = if ready {
                health_up(&url)
            } else {
                readiness_up(&url)
            };
            if http_up {
                health_failures = 0;
                if let Ok(mut runtime) = app.state::<AppState>().dsh_runtime.lock() {
                    if runtime.generation == generation && !ready {
                        runtime.state = DshRuntimeState::Running;
                        runtime.last_error = None;
                        append_log(&app, format!("DSH 已就绪 {url}"));
                    } else if runtime.generation == generation
                        && runtime.state == DshRuntimeState::Degraded
                    {
                        runtime.state = DshRuntimeState::Running;
                        runtime.last_error = None;
                        append_log(&app, format!("DSH HTTP 健康检查已恢复 {url}"));
                    }
                }
                ready = true;
                continue;
            }
            if !ready && Instant::now() >= deadline {
                let tail = read_log_tail(&app, 20).unwrap_or_default();
                let detail = if tail.is_empty() {
                    String::new()
                } else {
                    format!("\n最近日志：\n{}", tail.join("\n"))
                };
                if let Ok(mut runtime) = app.state::<AppState>().dsh_runtime.lock() {
                    if runtime.generation == generation {
                        runtime.last_error =
                            Some(format!("{DSH_READINESS_TIMEOUT_PREFIX}{detail}"));
                    }
                }
                let _ = stop_monitored_generation(&app, generation);
                return;
            }
            if ready {
                health_failures = health_failures.saturating_add(1);
                if health_failures >= HEALTH_FAILURE_THRESHOLD {
                    if let Ok(mut runtime) = app.state::<AppState>().dsh_runtime.lock() {
                        if runtime.generation == generation
                            && runtime.state == DshRuntimeState::Running
                        {
                            runtime.state = DshRuntimeState::Degraded;
                            runtime.last_error = Some(
                                "DSH 进程仍在运行，但 HTTP 健康检查连续 3 次失败；可等待自动恢复或重试后端。"
                                    .to_string(),
                            );
                            append_log(&app, format!("DSH HTTP 健康检查降级 {url}"));
                        }
                    }
                }
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

fn readiness_up(url: &str) -> bool {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(1))
        .redirect(reqwest::redirect::Policy::none())
        .build();
    client
        .and_then(|client| client.get(url).send())
        .map(|response| {
            (response.status().is_success() || response.status().is_redirection())
                && body_contains_dsh_boot_marker(response)
        })
        .unwrap_or(false)
}

fn body_contains_dsh_boot_marker(reader: impl Read) -> bool {
    let marker = DSH_BOOT_MARKER.as_bytes();
    let mut body = Vec::new();
    reader
        .take(DSH_HTTP_BODY_MAX_BYTES)
        .read_to_end(&mut body)
        .map(|_| body.windows(marker.len()).any(|window| window == marker))
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
    let crash_message = if runtime.state == DshRuntimeState::Stopping {
        runtime.state = DshRuntimeState::Stopped;
        None
    } else {
        runtime.state = DshRuntimeState::Crashed;
        let message = format!("E-DSH-005：DSH 异常退出（exit={:?}）", exit.code());
        runtime.last_error = Some(message.clone());
        Some(message)
    };
    drop(runtime);
    if let Some(message) = crash_message {
        append_log(app, message);
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

fn send_install_stage(
    progress: Option<&Channel<DshInstallEvent>>,
    stage: DshInstallStage,
    message: &str,
) {
    if let Some(progress) = progress {
        let _ = progress.send(DshInstallEvent::Stage {
            stage,
            message: message.to_string(),
        });
    }
}

fn dsh_error_code(message: &str) -> &str {
    [
        "E-DSH-001",
        "E-DSH-002",
        "E-DSH-003",
        "E-DSH-004",
        "E-DSH-005",
    ]
    .into_iter()
    .find(|code| message.contains(code))
    .unwrap_or("E-DSH-002")
}

fn pipe_child_logs(app: &AppHandle, child: &mut Child) -> anyhow::Result<()> {
    let stdout = child.stdout.take().context("DSH stdout pipe 不可用")?;
    let stderr = child.stderr.take().context("DSH stderr pipe 不可用")?;
    spawn_log_reader(stdout, app.clone());
    spawn_log_reader(stderr, app.clone());
    Ok(())
}

fn pipe_install_logs(
    app: &AppHandle,
    child: &mut Child,
    progress: Option<Channel<DshInstallEvent>>,
) -> anyhow::Result<()> {
    let stdout = child.stdout.take().context("DSH stdout pipe 不可用")?;
    let stderr = child.stderr.take().context("DSH stderr pipe 不可用")?;
    spawn_install_log_reader(
        stdout,
        app.clone(),
        progress.clone(),
        DshInstallStream::Stdout,
    );
    spawn_install_log_reader(stderr, app.clone(), progress, DshInstallStream::Stderr);
    Ok(())
}

fn spawn_install_log_reader(
    stream: impl Read + Send + 'static,
    app: AppHandle,
    progress: Option<Channel<DshInstallEvent>>,
    stream_kind: DshInstallStream,
) {
    thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            let safe = bounded_redacted_output_line(&line);
            append_log_line(&app, &safe, false);
            if let Some(progress) = &progress {
                let _ = progress.send(DshInstallEvent::Output {
                    stream: stream_kind,
                    line: safe,
                });
            }
        }
    });
}

fn spawn_log_reader(stream: impl Read + Send + 'static, app: AppHandle) {
    thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            append_log_line(&app, &line, false);
        }
    });
}

fn append_log(app: &AppHandle, message: impl AsRef<str>) {
    append_log_line(app, message.as_ref(), true);
}

fn prepare_log(app: &AppHandle) -> anyhow::Result<()> {
    let shared = app.state::<AppState>();
    let _operation = shared
        .dsh_log_operation
        .lock()
        .map_err(|_| anyhow::anyhow!("DSH 日志锁已损坏"))?;
    rotate_log_for_write(&shared.dsh_log_path, 0)
}

fn append_log_line(app: &AppHandle, message: &str, timestamped: bool) {
    let shared = app.state::<AppState>();
    let Ok(_operation) = shared.dsh_log_operation.lock() else {
        return;
    };
    let safe = backend_manager::redact_backend_text(message);
    let line = bounded_log_line(&safe, timestamped);
    if rotate_log_for_write(&shared.dsh_log_path, line.len() as u64).is_err() {
        return;
    }
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&shared.dsh_log_path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

fn bounded_redacted_output_line(message: &str) -> String {
    const TRUNCATED_MARKER: &str = " …[line truncated]";
    let mut safe = backend_manager::redact_backend_text(message);
    let content_budget = DSH_LOG_LINE_MAX_BYTES.saturating_sub(TRUNCATED_MARKER.len());
    if safe.len() > DSH_LOG_LINE_MAX_BYTES {
        truncate_utf8(&mut safe, content_budget);
        safe.push_str(TRUNCATED_MARKER);
    }
    safe
}

fn bounded_log_line(message: &str, timestamped: bool) -> String {
    const TRUNCATED_MARKER: &str = " …[line truncated]";
    let prefix = if timestamped {
        format!("{} ", unix_time_millis())
    } else {
        String::new()
    };
    let content_budget = DSH_LOG_LINE_MAX_BYTES.saturating_sub(prefix.len() + 1);
    let mut content = message.to_string();
    if content.len() > content_budget {
        let truncated_budget = content_budget.saturating_sub(TRUNCATED_MARKER.len());
        truncate_utf8(&mut content, truncated_budget);
        content.push_str(TRUNCATED_MARKER);
    }
    format!("{prefix}{content}\n")
}

fn truncate_utf8(value: &mut String, max_bytes: usize) {
    if value.len() <= max_bytes {
        return;
    }
    let mut boundary = max_bytes.min(value.len());
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
}

fn read_log_tail(app: &AppHandle, count: usize) -> anyhow::Result<Vec<String>> {
    let state = app.state::<AppState>();
    let raw = match fs::read_to_string(&state.dsh_log_path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error).context("读取 DSH 日志失败"),
    };
    let lines = raw.lines().rev().take(count).collect::<Vec<_>>();
    Ok(lines
        .into_iter()
        .rev()
        .map(backend_manager::redact_backend_text)
        .collect())
}

fn rotate_log_for_write(path: &Path, incoming_bytes: u64) -> anyhow::Result<()> {
    if path
        .metadata()
        .map(|meta| meta.len().saturating_add(incoming_bytes) > DSH_LOG_MAX_BYTES)
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
    fn node_support_matrix_rejects_unverified_release_lines() {
        assert!(!node_version_supported("v20.12.0"));
        assert!(!node_version_supported("22.18.9"));
        assert!(node_version_supported("v22.19.0"));
        assert!(node_version_supported("22.99.1"));
        assert!(!node_version_supported("v23.11.0"));
        assert!(node_version_supported("v24.0.0"));
        assert!(node_version_supported("v25.1.0"));
        assert!(!node_version_supported("v24.0.0-nightly"));
        assert!(!node_version_supported("not-node"));
    }

    #[test]
    fn windows_npm_cmd_maps_to_the_node_owned_cli_without_a_shell() {
        let root = std::env::temp_dir().join(format!(
            "kickside-npm-launcher-{}-{}",
            std::process::id(),
            unix_time_millis()
        ));
        let node = root.join("node.exe");
        let npm = root.join("npm.CMD");
        let npm_cli = root.join("node_modules/npm/bin/npm-cli.js");
        fs::create_dir_all(npm_cli.parent().expect("npm cli parent")).expect("create npm tree");
        fs::write(&node, "node").expect("write node");
        fs::write(&npm, "npm wrapper").expect("write npm wrapper");
        fs::write(&npm_cli, "npm cli").expect("write npm cli");

        assert!(is_windows_command_script(&npm));
        assert_eq!(
            resolve_npm_launcher(&node, &npm, true, None).expect("resolve Windows npm wrapper"),
            NpmLauncher::NodeCli {
                node: node.clone(),
                npm_cli: npm_cli.clone()
            }
        );
        let native_npm = root.join("npm.exe");
        assert_eq!(
            resolve_npm_launcher(&node, &native_npm, true, None).expect("resolve native npm"),
            NpmLauncher::Direct(native_npm)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn windows_npm_shim_falls_back_to_a_validated_command_processor() {
        let root = std::env::temp_dir().join(format!(
            "kickside-npm-shim-{}-{}",
            std::process::id(),
            unix_time_millis()
        ));
        fs::create_dir_all(&root).expect("create root");
        let node = root.join("node.exe");
        let npm = root.join("npm.cmd");
        let cmd = root.join("cmd.exe");
        fs::write(&node, "node").expect("write node");
        fs::write(&npm, "npm shim").expect("write npm shim");
        fs::write(&cmd, "cmd").expect("write cmd");

        assert_eq!(
            resolve_npm_launcher(&node, &npm, true, Some(cmd.clone()))
                .expect("resolve shim fallback"),
            NpmLauncher::CommandScript {
                command_processor: cmd,
                npm_script: npm,
            }
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn windows_npm_shim_fails_closed_without_cli_or_command_processor() {
        let root = std::env::temp_dir().join(format!(
            "kickside-npm-shim-closed-{}-{}",
            std::process::id(),
            unix_time_millis()
        ));
        fs::create_dir_all(&root).expect("create root");
        let node = root.join("node.exe");
        let npm = root.join("npm.cmd");
        fs::write(&node, "node").expect("write node");
        fs::write(&npm, "npm shim").expect("write npm shim");

        let error = resolve_npm_launcher(&node, &npm, true, None)
            .expect_err("missing trusted processor must fail closed");
        assert!(error.to_string().contains("受信任"));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn windows_npm_shim_preserves_fixed_argv_in_special_character_paths() {
        let root = std::env::temp_dir().join(format!(
            "KickSide DSH 中文 & percent%-{}-{}",
            std::process::id(),
            unix_time_millis()
        ));
        fs::create_dir_all(&root).expect("create special root");
        let node = root.join("node.exe");
        let npm = root.join("npm.cmd");
        let prefix = root.join("install prefix & 100%");
        let args_file = std::env::temp_dir().join(format!(
            "kickside-dsh-received-args-{}-{}.txt",
            std::process::id(),
            unix_time_millis()
        ));
        fs::write(&node, "node").expect("write node placeholder");
        fs::write(
            &npm,
            concat!(
                "@echo off\r\n",
                "(\r\n",
                "echo %~1\r\n",
                "echo %~2\r\n",
                "echo %~3\r\n",
                "echo %~4\r\n",
                ") > \"%KICKSIDE_DSH_TEST_ARGS%\"\r\n",
                "exit /b 0\r\n"
            ),
        )
        .expect("write npm shim");
        let launcher = resolve_npm_launcher(
            &node,
            &npm,
            true,
            Some(validated_windows_command_processor().expect("trusted cmd")),
        )
        .expect("resolve command shim");
        let mut command = launcher.command();
        launcher.configure_install(&mut command, &prefix);
        let configured_prefix = command
            .get_envs()
            .find_map(|(name, value)| {
                name.eq_ignore_ascii_case("npm_config_prefix")
                    .then_some(value)
                    .flatten()
            })
            .expect("npm prefix env");
        assert_eq!(configured_prefix, prefix.as_os_str());
        let status = command
            .env("KICKSIDE_DSH_TEST_ARGS", &args_file)
            .status()
            .expect("run npm shim");
        assert!(status.success());
        let expected_package = format!("{DSH_PACKAGE}@{DSH_PINNED_VERSION}");
        assert_eq!(
            fs::read_to_string(&args_file)
                .expect("read argv")
                .lines()
                .collect::<Vec<_>>(),
            [
                "install",
                "--no-audit",
                "--no-fund",
                expected_package.as_str(),
            ]
        );
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_file(args_file);
    }

    #[test]
    fn readiness_requires_the_bounded_dsh_boot_marker() {
        let valid = format!("<html><script>window.{DSH_BOOT_MARKER}={{}}</script></html>");
        assert!(body_contains_dsh_boot_marker(valid.as_bytes()));
        assert!(!body_contains_dsh_boot_marker(
            b"<html><title>unrelated service</title></html>".as_slice()
        ));

        let marker_after_limit = format!(
            "{}{}",
            "x".repeat(DSH_HTTP_BODY_MAX_BYTES as usize),
            DSH_BOOT_MARKER
        );
        assert!(!body_contains_dsh_boot_marker(
            marker_after_limit.as_bytes()
        ));
        assert!(DSH_READINESS_TIMEOUT_PREFIX.contains("页面身份"));
    }

    #[test]
    fn reports_the_structured_error_when_the_port_range_is_full() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("occupy loopback port");
        let port = listener.local_addr().expect("local address").port();
        let error = allocate_port([port, port]).expect_err("port range must be exhausted");
        assert!(error.to_string().contains("E-DSH-003"));
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

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;

            let outside_package_json = root.with_extension("outside-package.json");
            fs::write(
                &outside_package_json,
                format!(r#"{{"version":"{DSH_PINNED_VERSION}"}}"#),
            )
            .expect("outside package json");
            fs::remove_file(package.join("package.json")).expect("remove private package json");
            symlink(&outside_package_json, package.join("package.json"))
                .expect("symlink outside package json");
            let error = verify_install(&root).expect_err("package symlink escape must fail closed");
            assert!(error.to_string().contains("package.json"));
            fs::remove_file(package.join("package.json")).expect("remove package json symlink");
            fs::write(
                package.join("package.json"),
                format!(r#"{{"version":"{DSH_PINNED_VERSION}"}}"#),
            )
            .expect("restore package json");
            let outside_entry = root.with_extension("outside-entry.js");
            fs::write(&outside_entry, "#!/usr/bin/env node").expect("outside entry");
            fs::remove_file(package.join("lib/bin.js")).expect("remove private entry");
            symlink(&outside_entry, package.join("lib/bin.js")).expect("symlink outside entry");
            let error = verify_install(&root).expect_err("symlink escape must fail closed");
            assert!(error.to_string().contains("固定入口无效"));
            let _ = fs::remove_file(outside_package_json);
            let _ = fs::remove_file(outside_entry);
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn truncates_log_lines_on_utf8_boundaries() {
        let value = format!("{}tail", "鲸".repeat(30_000));
        let line = bounded_log_line(&value, true);
        assert!(line.len() <= DSH_LOG_LINE_MAX_BYTES);
        assert!(line.ends_with(" …[line truncated]\n"));
        assert!(line.is_char_boundary(line.len()));
    }

    #[test]
    fn rotates_before_a_write_would_exceed_the_cap() {
        let root = std::env::temp_dir().join(format!(
            "dsh-log-{}-{}",
            std::process::id(),
            unix_time_millis()
        ));
        fs::create_dir_all(&root).expect("mkdir");
        let path = root.join("dsh.log");
        let file = File::create(&path).expect("log");
        file.set_len(DSH_LOG_MAX_BYTES - 1).expect("size log");
        rotate_log_for_write(&path, 2).expect("rotate");
        assert_eq!(fs::metadata(&path).expect("new log").len(), 0);
        assert_eq!(
            fs::metadata(path.with_extension("log.1"))
                .expect("rotated log")
                .len(),
            DSH_LOG_MAX_BYTES - 1
        );
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

    #[cfg(windows)]
    #[test]
    fn terminates_owned_windows_process_tree_with_descendant() {
        let root = std::env::temp_dir().join(format!(
            "dsh-windows-tree-{}-{}",
            std::process::id(),
            unix_time_millis()
        ));
        fs::create_dir_all(&root).expect("mkdir");
        let child_pid_path = root.join("child.pid");
        let script = "$child = Start-Process -FilePath $env:ComSpec -ArgumentList '/C','ping -n 30 127.0.0.1 >NUL' -PassThru; [IO.File]::WriteAllText($env:KICKSIDE_DSH_TEST_CHILD_PID, [string]$child.Id); Wait-Process -Id $child.Id";
        let mut command = Command::new("powershell.exe");
        command
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ])
            .env("KICKSIDE_DSH_TEST_CHILD_PID", &child_pid_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = command.spawn().expect("spawn process tree");
        let deadline = Instant::now() + Duration::from_secs(15);
        while !child_pid_path.is_file() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(25));
        }
        let descendant_pid_text = fs::read_to_string(&child_pid_path);
        if descendant_pid_text.is_err() {
            let _ = terminate_process_tree(&mut child, None, Duration::from_millis(500));
        }
        let descendant_pid = descendant_pid_text
            .expect("descendant pid file")
            .trim()
            .parse::<u32>()
            .expect("descendant pid");

        assert!(terminate_process_tree(
            &mut child,
            None,
            Duration::from_millis(500)
        ));
        let output = Command::new("tasklist")
            .args([
                "/FI",
                &format!("PID eq {descendant_pid}"),
                "/FO",
                "CSV",
                "/NH",
            ])
            .output()
            .expect("query descendant");
        let listing = String::from_utf8_lossy(&output.stdout);
        assert!(
            !listing.contains(&format!("\"{descendant_pid}\"")),
            "descendant process still exists: {listing}"
        );
        let _ = fs::remove_dir_all(root);
    }
}
