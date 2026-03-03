use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use anyhow::Context;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Response, Server, StatusCode};
use toml_edit::{value, DocumentMut, Item, Table};
use url::Url;

use crate::{
    app_state::{unix_time_millis, AppState},
    cli_contract, kimi_locator, log_manager, port_manager, settings_store,
    types::{
        AppSettings, BackendState, InstallProbeStatus, KimiCliApiConfigInput, KimiCliApiConfigView,
        CURRENT_ONBOARDING_VERSION,
    },
    window_manager,
};

const SHUTDOWN_TIMEOUT_SECS: u64 = 4;
const KIMI_HOST: &str = "127.0.0.1";
const THEME_BRIDGE_SOURCE: &str = "kimi-shell-theme-bridge";
const SHELL_THEME_SYNC_SOURCE: &str = "kimi-shell-theme-sync";
const MAX_UPSTREAM_HEADER_BYTES: usize = 64 * 1024;
const MAX_INSTALL_OUTPUT_CHARS: usize = 1500;

const POWERSHELL_INSTALL_DEPS_OFFICIAL: &str = r#"
$ErrorActionPreference='Stop'
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw '未检测到 winget，请先安装 App Installer（https://aka.ms/getwinget）。'
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
}
$uvCmd = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvCmd) {
  try {
    winget install --id astral-sh.uv -e --source winget --accept-source-agreements --accept-package-agreements
  } catch {
    Write-Host 'winget 安装 uv 失败，继续尝试官方安装脚本。'
  }
}
$uvCmd = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvCmd) {
  Invoke-RestMethod -Uri 'https://astral.sh/uv/install.ps1' | Invoke-Expression
}
$uvCandidateDirs = @((Join-Path $HOME '.local\bin'), (Join-Path $HOME '.cargo\bin'))
foreach ($dir in $uvCandidateDirs) {
  if ((Test-Path $dir) -and ($env:Path -notlike "*$dir*")) {
    $env:Path = "$dir;$env:Path"
  }
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw 'uv 安装失败，请手动执行：winget install --id astral-sh.uv -e'
}
$gitVer = git --version
$uvVer = uv --version
Write-Output "依赖安装完成。$gitVer | $uvVer"
"#;

const POWERSHELL_INSTALL_DEPS_MIRROR: &str = r#"
$ErrorActionPreference='Stop'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  $latestReleaseUrl = 'https://mirrors.tuna.tsinghua.edu.cn/github-release/git-for-windows/git/LatestRelease/'
  $baseUri = [System.Uri]$latestReleaseUrl
  $latestReleasePage = Invoke-WebRequest -Uri $latestReleaseUrl
  $latestLinks = @($latestReleasePage.Links | Where-Object { $_.href })
  $installerHref = $latestLinks | ForEach-Object { $_.href } | Where-Object { $_ -match '(?i)Git-[^/]*-64-bit\.exe$' } | Select-Object -First 1
  $versionDirHref = $latestLinks | ForEach-Object { $_.href } | Where-Object { $_ -match '(?i)Git%20for%20Windows%20v[^/]+/?$' } | Select-Object -First 1
  if ((-not $installerHref) -and $versionDirHref) {
    $versionDirUrl = [System.Uri]::new($baseUri, $versionDirHref).AbsoluteUri
    $versionPage = Invoke-WebRequest -Uri $versionDirUrl
    $versionLinks = @($versionPage.Links | Where-Object { $_.href })
    $installerHref = $versionLinks | ForEach-Object { $_.href } | Where-Object { $_ -match '(?i)Git-[^/]*-64-bit\.exe$' } | Select-Object -First 1
    if ($installerHref) { $baseUri = [System.Uri]$versionDirUrl }
  }
  if (-not $installerHref) { throw '清华源页面未找到 Git for Windows 64-bit 安装包链接。' }
  $tunaUrl = [System.Uri]::new($baseUri, $installerHref).AbsoluteUri
  $installerPath = Join-Path $env:TEMP 'Git-Installer.exe'
  Invoke-WebRequest -Uri $tunaUrl -OutFile $installerPath
  Start-Process -FilePath $installerPath -Wait
}
$uvCmd = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvCmd) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    try {
      winget install --id astral-sh.uv -e --source winget --accept-source-agreements --accept-package-agreements
    } catch {
      Write-Host 'winget 安装 uv 失败，继续尝试官方安装脚本。'
    }
  }
}
$uvCmd = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvCmd) {
  Invoke-RestMethod -Uri 'https://astral.sh/uv/install.ps1' | Invoke-Expression
}
$uvCandidateDirs = @((Join-Path $HOME '.local\bin'), (Join-Path $HOME '.cargo\bin'))
foreach ($dir in $uvCandidateDirs) {
  if ((Test-Path $dir) -and ($env:Path -notlike "*$dir*")) {
    $env:Path = "$dir;$env:Path"
  }
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw 'uv 安装失败，请先手动安装。'
}
$gitVer = git --version
$uvVer = uv --version
Write-Output "镜像依赖安装完成。$gitVer | $uvVer"
"#;

const POWERSHELL_INSTALL_KIMI_OFFICIAL: &str = r#"
$ErrorActionPreference='Stop'
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw '未检测到 uv，请先执行“一键安装依赖”。'
}
uv python install 3.13
uv tool install kimi-cli --python 3.13 --upgrade
$kimiVer = kimi -v
Write-Output "Kimi 安装完成。$kimiVer"
"#;

const POWERSHELL_INSTALL_KIMI_MIRROR: &str = r#"
$ErrorActionPreference='Stop'
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw '未检测到 uv，请先执行“一键安装依赖”。'
}
uv python install 3.13
$indexes = @(
  'https://pypi.tuna.tsinghua.edu.cn/simple/',
  'https://mirrors.aliyun.com/pypi/simple/'
)
$installed = $false
foreach ($index in $indexes) {
  try {
    uv tool install kimi-cli --python 3.13 --upgrade -i $index
    $installed = $true
    break
  } catch {
    Write-Host ("镜像安装失败，继续尝试下一个索引：" + $index)
  }
}
if (-not $installed) {
  throw 'Kimi CLI 镜像安装失败，请检查网络后重试。'
}
$kimiVer = kimi -v
Write-Output "Kimi 镜像安装完成。$kimiVer"
"#;

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
        runtime.workspace_port = None;
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
    runtime.workspace_port = None;
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

pub fn open_external_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("url cannot be empty".to_string());
    }

    let parsed = Url::parse(trimmed).map_err(|error| format!("invalid url: {error}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("unsupported url scheme: {scheme}"));
    }

    open_with_system_browser(parsed.as_str()).map_err(|error| error.to_string())
}

pub fn open_folder(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path cannot be empty".to_string());
    }

    let folder = PathBuf::from(trimmed);
    if !folder.exists() {
        return Err(format!("folder does not exist: {}", folder.display()));
    }
    if !folder.is_dir() {
        return Err(format!("path is not a folder: {}", folder.display()));
    }

    open_with_system_file_manager(&folder).map_err(|error| error.to_string())
}

pub fn open_kimi_config_dir() -> Result<(), String> {
    let config_dir = resolve_kimi_config_dir()?;
    fs::create_dir_all(&config_dir).map_err(|error| {
        format!(
            "failed to create kimi config directory {}: {error}",
            config_dir.display()
        )
    })?;
    open_with_system_file_manager(&config_dir).map_err(|error| error.to_string())
}

pub fn load_kimi_cli_api_config() -> Result<KimiCliApiConfigView, String> {
    let config_path = resolve_kimi_config_path()?;
    let mut provider_id = None;
    let mut model = None;
    let mut base_url = None;
    let mut has_api_key = false;

    if config_path.exists() {
        let raw = fs::read_to_string(&config_path).map_err(|error| {
            format!(
                "failed to read config file {}: {error}",
                config_path.display()
            )
        })?;
        let doc = parse_kimi_config_document(&raw, &config_path)?;
        let root = doc.as_table();

        provider_id = table_string(root, "provider");
        model = table_string(root, "model");
        if let Some(provider) = provider_id.as_deref() {
            if let Some(provider_table) = provider_table(root, provider) {
                base_url = table_string(provider_table, "base_url");
                has_api_key = table_string(provider_table, "api_key").is_some();
            }
        }
    }

    Ok(KimiCliApiConfigView {
        config_path: config_path.to_string_lossy().to_string(),
        provider_id,
        model,
        base_url,
        has_api_key,
    })
}

pub fn save_kimi_cli_api_config(input: KimiCliApiConfigInput) -> Result<(), String> {
    let provider_id = input.provider_id.trim();
    if provider_id.is_empty() {
        return Err("provider cannot be empty".to_string());
    }
    let model = input.model.trim();
    if model.is_empty() {
        return Err("model cannot be empty".to_string());
    }
    let base_url = input.base_url.trim();
    if base_url.is_empty() {
        return Err("base url cannot be empty".to_string());
    }

    let config_dir = resolve_kimi_config_dir()?;
    fs::create_dir_all(&config_dir).map_err(|error| {
        format!(
            "failed to create kimi config directory {}: {error}",
            config_dir.display()
        )
    })?;
    let config_path = config_dir.join("config.toml");
    let mut doc = read_or_init_kimi_config(&config_path)?;

    doc["provider"] = value(provider_id);
    doc["model"] = value(model);

    if !doc["providers"].is_table() {
        doc["providers"] = Item::Table(Table::new());
    }
    let providers = doc["providers"]
        .as_table_mut()
        .ok_or_else(|| "providers must be a table".to_string())?;

    let provider_item = providers
        .entry(provider_id)
        .or_insert(Item::Table(Table::new()));
    if !provider_item.is_table() {
        *provider_item = Item::Table(Table::new());
    }
    let provider_table = provider_item
        .as_table_mut()
        .ok_or_else(|| "provider config must be a table".to_string())?;

    provider_table["name"] = value(provider_id);
    provider_table["base_url"] = value(base_url);

    let requested_api_key = input.api_key.unwrap_or_default();
    let api_key = requested_api_key.trim();
    if api_key.is_empty() {
        if !provider_table.contains_key("api_key")
            || table_string(provider_table, "api_key").is_none()
        {
            return Err("api key cannot be empty when no existing key is present".to_string());
        }
    } else {
        provider_table["api_key"] = value(api_key);
    }

    fs::write(&config_path, doc.to_string()).map_err(|error| {
        format!(
            "failed to write config file {}: {error}",
            config_path.display()
        )
    })?;
    Ok(())
}

pub fn install_kimi_dependencies(source: &str) -> Result<String, String> {
    let source = parse_install_source(source)?;
    let script = match source {
        InstallSource::Official => POWERSHELL_INSTALL_DEPS_OFFICIAL,
        InstallSource::Mirror => POWERSHELL_INSTALL_DEPS_MIRROR,
    };
    run_windows_powershell_install(script)
}

pub fn install_kimi_cli(source: &str) -> Result<String, String> {
    let source = parse_install_source(source)?;
    let script = match source {
        InstallSource::Official => POWERSHELL_INSTALL_KIMI_OFFICIAL,
        InstallSource::Mirror => POWERSHELL_INSTALL_KIMI_MIRROR,
    };
    run_windows_powershell_install(script)
}

pub fn get_install_probe_status() -> InstallProbeStatus {
    InstallProbeStatus {
        git_ready: command_success("git", &["--version"]),
        uv_ready: command_success("uv", &["--version"]),
        python313_ready: python313_ready(),
        kimi_ready: command_success("kimi", &["-v"]),
    }
}

#[derive(Clone, Copy)]
enum InstallSource {
    Official,
    Mirror,
}

fn parse_install_source(source: &str) -> Result<InstallSource, String> {
    let normalized = source.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "official" => Ok(InstallSource::Official),
        "mirror" => Ok(InstallSource::Mirror),
        _ => Err(format!("unsupported install source: {source}")),
    }
}

fn run_windows_powershell_install(script: &str) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = script;
        return Err("该安装动作仅支持 Windows。".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
            .output()
            .map_err(|error| format!("failed to run powershell install command: {error}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if output.status.success() {
            if !stdout.is_empty() {
                return Ok(truncate_install_output(&stdout));
            }
            return Ok("安装命令执行成功。".to_string());
        }

        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("exit status: {}", output.status)
        };
        Err(truncate_install_output(&detail))
    }
}

fn truncate_install_output(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= MAX_INSTALL_OUTPUT_CHARS {
        return trimmed.to_string();
    }
    let shortened: String = trimmed.chars().take(MAX_INSTALL_OUTPUT_CHARS).collect();
    format!("{shortened}…")
}

fn command_success(command: &str, args: &[&str]) -> bool {
    Command::new(command)
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn python313_ready() -> bool {
    #[cfg(target_os = "windows")]
    {
        if command_success("py", &["-3.13", "--version"]) {
            return true;
        }
        if command_success("python3.13", &["--version"]) {
            return true;
        }
        if command_success("uv", &["python", "find", "3.13"]) {
            return true;
        }
        false
    }

    #[cfg(not(target_os = "windows"))]
    {
        if command_success("python3.13", &["--version"]) {
            return true;
        }
        if command_success("uv", &["python", "find", "3.13"]) {
            return true;
        }
        false
    }
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
        runtime.workspace_port = None;
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

    let workspace_port = match start_workspace_proxy(app, generation, active_port) {
        Ok(port) => port,
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "workspace proxy unavailable; fallback to direct backend port {active_port}: {error:#}"
                ),
            );
            active_port
        }
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
        runtime.workspace_port = Some(workspace_port);
        runtime.last_error = None;
        runtime.backend_ready_at_ms = Some(unix_time_millis());
        runtime.last_exit_reason = None;
    }

    log_manager::append_line(
        app,
        format!("backend ready on port {active_port}; workspace proxy on {workspace_port}"),
    );
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
                    runtime.workspace_port = None;
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
                    runtime.workspace_port = None;
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

fn start_workspace_proxy(
    app: &AppHandle,
    generation: u64,
    upstream_port: u16,
) -> anyhow::Result<u16> {
    let listener = TcpListener::bind((KIMI_HOST, 0))
        .context("failed to bind workspace proxy listener on localhost")?;
    let proxy_port = listener
        .local_addr()
        .context("failed to read workspace proxy listener address")?
        .port();
    let server = Server::from_listener(listener, None)
        .map_err(|error| anyhow::anyhow!("failed to initialize workspace proxy server: {error}"))?;
    let app_handle = app.clone();

    thread::spawn(move || {
        run_workspace_proxy_loop(app_handle, generation, upstream_port, proxy_port, server);
    });

    Ok(proxy_port)
}

fn run_workspace_proxy_loop(
    app: AppHandle,
    generation: u64,
    upstream_port: u16,
    proxy_port: u16,
    server: Server,
) {
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            log_manager::append_line(
                &app,
                format!("workspace proxy initialization failed: {error}"),
            );
            return;
        }
    };

    log_manager::append_line(
        &app,
        format!("workspace proxy started on {proxy_port} -> {upstream_port}"),
    );

    loop {
        if !workspace_proxy_should_run(&app, generation) {
            break;
        }

        let request = match server.recv_timeout(Duration::from_millis(250)) {
            Ok(Some(request)) => request,
            Ok(None) => continue,
            Err(error) => {
                log_manager::append_line(
                    &app,
                    format!("workspace proxy receive error on {proxy_port}: {error}"),
                );
                break;
            }
        };

        handle_workspace_proxy_request(&app, &client, upstream_port, request);
    }

    log_manager::append_line(&app, format!("workspace proxy stopped on {proxy_port}"));
}

fn workspace_proxy_should_run(app: &AppHandle, generation: u64) -> bool {
    let state = app.state::<AppState>();
    let runtime = match state.runtime.lock() {
        Ok(runtime) => runtime,
        Err(_) => return false,
    };

    runtime.generation == generation
        && matches!(
            runtime.state,
            BackendState::Starting | BackendState::Running
        )
}

fn handle_workspace_proxy_request(
    app: &AppHandle,
    client: &reqwest::blocking::Client,
    upstream_port: u16,
    request: tiny_http::Request,
) {
    let is_websocket_upgrade = is_websocket_upgrade_request(&request);
    if request.url().contains("/stream") && !is_websocket_upgrade {
        log_manager::append_line(
            app,
            format!(
                "workspace proxy forwarded `{}` as plain HTTP (missing websocket upgrade headers: {})",
                request.url(),
                summarize_request_headers(&request)
            ),
        );
    }

    if is_websocket_upgrade {
        handle_workspace_websocket_upgrade(app, upstream_port, request);
        return;
    }

    handle_workspace_http_proxy(app, client, upstream_port, request);
}

fn handle_workspace_http_proxy(
    app: &AppHandle,
    client: &reqwest::blocking::Client,
    upstream_port: u16,
    mut request: tiny_http::Request,
) {
    let upstream_url = format!("http://{KIMI_HOST}:{upstream_port}{}", request.url());
    let method = match reqwest::Method::from_bytes(request.method().as_str().as_bytes()) {
        Ok(method) => method,
        Err(_) => {
            let _ = request.respond(
                Response::from_string("Unsupported HTTP method").with_status_code(StatusCode(400)),
            );
            return;
        }
    };

    let mut body = Vec::new();
    if request.as_reader().read_to_end(&mut body).is_err() {
        let _ = request.respond(
            Response::from_string("Failed to read request body").with_status_code(StatusCode(400)),
        );
        return;
    }

    let mut upstream_builder = client
        .request(method, &upstream_url)
        .header("Accept-Encoding", "identity");
    for header in request.headers() {
        let name = header.field.to_string();
        if name.eq_ignore_ascii_case("host")
            || name.eq_ignore_ascii_case("content-length")
            || is_hop_by_hop_header(&name)
            || name.eq_ignore_ascii_case("accept-encoding")
        {
            continue;
        }
        upstream_builder = upstream_builder.header(name, header.value.as_str());
    }
    if !body.is_empty() {
        upstream_builder = upstream_builder.body(body);
    }

    let upstream_response = match upstream_builder.send() {
        Ok(response) => response,
        Err(error) => {
            let _ = request.respond(
                Response::from_string(format!("Bad Gateway: {error}"))
                    .with_status_code(StatusCode(502)),
            );
            return;
        }
    };

    let status_code = upstream_response.status().as_u16();
    let content_type = upstream_response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    let is_html = content_type
        .as_ref()
        .map(|value| value.to_ascii_lowercase().contains("text/html"))
        .unwrap_or(false);

    let response_headers =
        collect_forwardable_response_headers(upstream_response.headers(), !is_html);

    if !is_html {
        let mut response = Response::new(
            StatusCode(status_code),
            Vec::new(),
            upstream_response,
            None,
            None,
        );
        add_headers_to_response(&mut response, &response_headers);
        let _ = request.respond(response);
        return;
    }

    let mut response_body = match upstream_response.bytes() {
        Ok(bytes) => bytes.to_vec(),
        Err(error) => {
            log_manager::append_line(
                app,
                format!("workspace proxy html response read failed for `{upstream_url}`: {error}"),
            );
            let _ = request.respond(
                Response::from_string(format!("Bad Gateway (response read failed): {error}"))
                    .with_status_code(StatusCode(502)),
            );
            return;
        }
    };

    if let Ok(html) = std::str::from_utf8(&response_body) {
        response_body = inject_theme_bridge_script(html, upstream_port).into_bytes();
    }

    let mut response = Response::from_data(response_body).with_status_code(StatusCode(status_code));
    add_headers_to_response(&mut response, &response_headers);
    if response_headers
        .iter()
        .all(|(name, _)| !name.eq_ignore_ascii_case("content-type"))
    {
        if let Some(content_type_value) = content_type {
            if let Ok(header) = Header::from_bytes("Content-Type", content_type_value) {
                response.add_header(header);
            }
        }
    }

    let _ = request.respond(response);
}

fn handle_workspace_websocket_upgrade(
    app: &AppHandle,
    upstream_port: u16,
    request: tiny_http::Request,
) {
    let upstream_addr = format!("{KIMI_HOST}:{upstream_port}");
    let request_url = request.url().to_string();

    let mut upstream_stream = match TcpStream::connect((KIMI_HOST, upstream_port)) {
        Ok(stream) => stream,
        Err(error) => {
            log_manager::append_line(
                app,
                format!("workspace proxy websocket connect failed `{request_url}`: {error}"),
            );
            let _ = request.respond(
                Response::from_string(format!("Bad Gateway: {error}"))
                    .with_status_code(StatusCode(502)),
            );
            return;
        }
    };
    let _ = upstream_stream.set_nodelay(true);
    let _ = upstream_stream.set_read_timeout(Some(Duration::from_secs(30)));
    let _ = upstream_stream.set_write_timeout(Some(Duration::from_secs(30)));

    let upstream_request = build_upstream_websocket_request(&request, &upstream_addr);
    if let Err(error) = upstream_stream.write_all(upstream_request.as_bytes()) {
        log_manager::append_line(
            app,
            format!("workspace proxy websocket write handshake failed `{request_url}`: {error}"),
        );
        let _ = request.respond(
            Response::from_string(format!("Bad Gateway: {error}"))
                .with_status_code(StatusCode(502)),
        );
        return;
    }
    if let Err(error) = upstream_stream.flush() {
        log_manager::append_line(
            app,
            format!("workspace proxy websocket flush handshake failed `{request_url}`: {error}"),
        );
        let _ = request.respond(
            Response::from_string(format!("Bad Gateway: {error}"))
                .with_status_code(StatusCode(502)),
        );
        return;
    }

    let (status_code, upstream_headers, mut upstream_prefix) =
        match read_upstream_response_head(&mut upstream_stream) {
            Ok(value) => value,
            Err(error) => {
                log_manager::append_line(
                    app,
                    format!(
                        "workspace proxy websocket read handshake failed `{request_url}`: {error:#}"
                    ),
                );
                let _ = request.respond(
                    Response::from_string("Bad Gateway (invalid upstream handshake)")
                        .with_status_code(StatusCode(502)),
                );
                return;
            }
        };

    if status_code != 101 {
        log_manager::append_line(
            app,
            format!(
                "workspace proxy websocket upstream returned status {status_code} for `{request_url}`"
            ),
        );
        let mut response_body = std::mem::take(&mut upstream_prefix);
        let _ = upstream_stream.read_to_end(&mut response_body);
        let mut response =
            Response::from_data(response_body).with_status_code(StatusCode(status_code));
        let response_headers = collect_websocket_fallback_headers(&upstream_headers);
        add_headers_to_response(&mut response, &response_headers);
        let _ = request.respond(response);
        return;
    }

    let mut upgrade_response = Response::new_empty(StatusCode(101));
    let upgrade_headers = collect_websocket_upgrade_headers(&upstream_headers);
    add_headers_to_response(&mut upgrade_response, &upgrade_headers);

    log_manager::append_line(
        app,
        format!("workspace proxy websocket tunnel opened for `{request_url}`"),
    );

    let mut client_stream = request.upgrade("websocket", upgrade_response);
    if !upstream_prefix.is_empty() {
        let _ = client_stream.write_all(&upstream_prefix);
        let _ = client_stream.flush();
    }

    match tunnel_websocket_streams(client_stream, upstream_stream) {
        Ok(upstream_to_client) => {
            log_manager::append_line(
                app,
                format!(
                    "workspace proxy websocket tunnel closed for `{request_url}` (u2c={upstream_to_client} bytes)"
                ),
            );
        }
        Err(error) => {
            log_manager::append_line(
                app,
                format!("workspace proxy websocket tunnel error for `{request_url}`: {error}"),
            );
        }
    }
}

fn is_websocket_upgrade_request(request: &tiny_http::Request) -> bool {
    if !request.method().as_str().eq_ignore_ascii_case("GET") {
        return false;
    }

    let mut has_upgrade_websocket = false;
    let mut has_connection_upgrade = false;
    let mut has_websocket_key = false;
    for header in request.headers() {
        let name = header.field.to_string();
        let value = header.value.as_str();
        if name.eq_ignore_ascii_case("upgrade")
            && value
                .split(',')
                .any(|segment| segment.trim().eq_ignore_ascii_case("websocket"))
        {
            has_upgrade_websocket = true;
        }
        if name.eq_ignore_ascii_case("connection")
            && value
                .split(',')
                .any(|segment| segment.trim().eq_ignore_ascii_case("upgrade"))
        {
            has_connection_upgrade = true;
        }
        if name.eq_ignore_ascii_case("sec-websocket-key") && !value.trim().is_empty() {
            has_websocket_key = true;
        }
    }

    (has_upgrade_websocket && has_connection_upgrade)
        || (has_upgrade_websocket && has_websocket_key)
        || (has_connection_upgrade && has_websocket_key)
        || has_websocket_key
}

fn build_upstream_websocket_request(request: &tiny_http::Request, upstream_addr: &str) -> String {
    let mut output = format!(
        "{} {} HTTP/1.1\r\nHost: {upstream_addr}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n",
        request.method().as_str(),
        request.url()
    );
    for header in request.headers() {
        let name = header.field.to_string();
        if name.eq_ignore_ascii_case("host")
            || name.eq_ignore_ascii_case("content-length")
            || name.eq_ignore_ascii_case("connection")
            || name.eq_ignore_ascii_case("upgrade")
        {
            continue;
        }
        output.push_str(&name);
        output.push_str(": ");
        output.push_str(header.value.as_str());
        output.push_str("\r\n");
    }
    output.push_str("\r\n");
    output
}

fn read_upstream_response_head(
    stream: &mut TcpStream,
) -> anyhow::Result<(u16, Vec<(String, String)>, Vec<u8>)> {
    let mut buffer = Vec::with_capacity(8 * 1024);
    let mut chunk = [0u8; 4096];

    loop {
        let read = stream
            .read(&mut chunk)
            .context("failed to read upstream response")?;
        if read == 0 {
            return Err(anyhow::anyhow!(
                "upstream closed connection before handshake response completed"
            ));
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_UPSTREAM_HEADER_BYTES {
            return Err(anyhow::anyhow!(
                "upstream response headers exceed limit ({MAX_UPSTREAM_HEADER_BYTES} bytes)"
            ));
        }

        if let Some(header_end) = find_http_header_end(&buffer) {
            let header_text = String::from_utf8_lossy(&buffer[..header_end]);
            let mut lines = header_text.split("\r\n");
            let status_line = lines.next().unwrap_or_default();
            let status_code = status_line
                .split_whitespace()
                .nth(1)
                .and_then(|value| value.parse::<u16>().ok())
                .ok_or_else(|| anyhow::anyhow!("invalid upstream status line: `{status_line}`"))?;

            let mut headers = Vec::new();
            for line in lines {
                if line.trim().is_empty() {
                    continue;
                }
                if let Some((name, value)) = line.split_once(':') {
                    headers.push((name.trim().to_string(), value.trim().to_string()));
                }
            }

            let body_prefix = buffer[(header_end + 4)..].to_vec();
            return Ok((status_code, headers, body_prefix));
        }
    }
}

fn find_http_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn collect_forwardable_response_headers(
    headers: &reqwest::header::HeaderMap,
    include_content_length: bool,
) -> Vec<(String, String)> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            let name = name.as_str();
            if is_hop_by_hop_header(name) {
                return None;
            }
            if !include_content_length && name.eq_ignore_ascii_case("content-length") {
                return None;
            }
            let value = value.to_str().ok()?;
            Some((name.to_string(), value.to_string()))
        })
        .collect()
}

fn collect_websocket_upgrade_headers(headers: &[(String, String)]) -> Vec<(String, String)> {
    let mut output = vec![
        ("Connection".to_string(), "Upgrade".to_string()),
        ("Upgrade".to_string(), "websocket".to_string()),
    ];
    for (name, value) in headers {
        if name.eq_ignore_ascii_case("sec-websocket-accept")
            || name.eq_ignore_ascii_case("sec-websocket-protocol")
            || name.eq_ignore_ascii_case("sec-websocket-extensions")
            || name.eq_ignore_ascii_case("set-cookie")
        {
            output.push((name.clone(), value.clone()));
        }
    }
    output
}

fn collect_websocket_fallback_headers(headers: &[(String, String)]) -> Vec<(String, String)> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            if is_hop_by_hop_header(name) {
                return None;
            }
            if name.eq_ignore_ascii_case("content-length")
                || name.eq_ignore_ascii_case("transfer-encoding")
            {
                return None;
            }
            Some((name.clone(), value.clone()))
        })
        .collect()
}

fn tunnel_websocket_streams(
    client_stream: Box<dyn tiny_http::ReadWrite + Send>,
    upstream_stream: TcpStream,
) -> anyhow::Result<u64> {
    let shared_client: Arc<Mutex<Box<dyn tiny_http::ReadWrite + Send>>> =
        Arc::new(Mutex::new(client_stream));
    let writer_client = Arc::clone(&shared_client);
    let mut upstream_writer = upstream_stream
        .try_clone()
        .context("failed to clone upstream stream for websocket tunnel write")?;

    thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            let read = {
                let mut client = match writer_client.lock() {
                    Ok(lock) => lock,
                    Err(_) => return,
                };
                match client.read(&mut buffer) {
                    Ok(n) => n,
                    Err(_) => return,
                }
            };

            if read == 0 {
                return;
            }

            if upstream_writer.write_all(&buffer[..read]).is_err() {
                return;
            }
            if upstream_writer.flush().is_err() {
                return;
            }
        }
    });

    let mut upstream_reader = upstream_stream;
    let mut upstream_to_client_total = 0u64;
    let mut buffer = [0u8; 8192];
    loop {
        let read = match upstream_reader.read(&mut buffer) {
            Ok(read) => read,
            Err(_) => break,
        };
        if read == 0 {
            break;
        }

        upstream_to_client_total = upstream_to_client_total.saturating_add(read as u64);

        let write_ok = {
            let mut client = match shared_client.lock() {
                Ok(lock) => lock,
                Err(_) => break,
            };
            client.write_all(&buffer[..read]).is_ok() && client.flush().is_ok()
        };
        if !write_ok {
            break;
        }
    }

    Ok(upstream_to_client_total)
}

fn add_headers_to_response<R: Read>(response: &mut Response<R>, headers: &[(String, String)]) {
    for (name, value) in headers {
        if let Ok(header) = Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            response.add_header(header);
        }
    }
}

fn summarize_request_headers(request: &tiny_http::Request) -> String {
    let mut entries = Vec::new();
    for header in request.headers() {
        let value = header.value.as_str();
        let trimmed = if value.len() > 120 {
            format!("{}...", &value[..120])
        } else {
            value.to_string()
        };
        entries.push(format!("{}={}", header.field, trimmed));
    }
    if entries.is_empty() {
        "<none>".to_string()
    } else {
        entries.join("; ")
    }
}

fn is_hop_by_hop_header(name: &str) -> bool {
    name.eq_ignore_ascii_case("connection")
        || name.eq_ignore_ascii_case("keep-alive")
        || name.eq_ignore_ascii_case("proxy-authenticate")
        || name.eq_ignore_ascii_case("proxy-authorization")
        || name.eq_ignore_ascii_case("te")
        || name.eq_ignore_ascii_case("trailer")
        || name.eq_ignore_ascii_case("transfer-encoding")
        || name.eq_ignore_ascii_case("upgrade")
}

fn inject_theme_bridge_script(html: &str, upstream_port: u16) -> String {
    const BRIDGE_MARKER: &str = "data-kimi-shell-theme-bridge";
    if html.contains(BRIDGE_MARKER) {
        return html.to_string();
    }

    let bridge_script = theme_bridge_script_tag(upstream_port);
    if let Some(insert_at) = html.rfind("</head>") {
        let mut output = String::with_capacity(html.len() + bridge_script.len() + 8);
        output.push_str(&html[..insert_at]);
        output.push_str(&bridge_script);
        output.push_str(&html[insert_at..]);
        return output;
    }

    format!("{bridge_script}{html}")
}

fn theme_bridge_script_tag(upstream_port: u16) -> String {
    let upstream_ws_origin = format!("ws://{KIMI_HOST}:{upstream_port}");
    format!(
        r#"<script data-kimi-shell-theme-bridge>
(function () {{
  const THEME_KEY = "kimi-theme";
  const BRIDGE_SOURCE = "{theme_bridge_source}";
  const SHELL_SOURCE = "{shell_theme_source}";
  const QUERY = "(prefers-color-scheme: dark)";
  const UPSTREAM_WS_ORIGIN = "{upstream_ws_origin}";
  const UPSTREAM_WS_HOST = (function () {{
    try {{
      return new URL(UPSTREAM_WS_ORIGIN).host;
    }} catch (_) {{
      return "";
    }}
  }})();

  function normalizeTheme(value) {{
    return value === "light" || value === "dark" ? value : "system";
  }}

  function resolveTheme(mode) {{
    if (mode === "light" || mode === "dark") {{
      return mode;
    }}
    const prefersDark = window.matchMedia && window.matchMedia(QUERY).matches;
    return prefersDark ? "dark" : "light";
  }}

  function notifyParent() {{
    try {{
      if (window.parent && window.parent !== window) {{
        const current = normalizeTheme(localStorage.getItem(THEME_KEY));
        window.parent.postMessage({{ source: BRIDGE_SOURCE, theme: current }}, "*");
      }}
    }} catch (_) {{
      // ignore
    }}
  }}

  function applyDomTheme(mode) {{
    try {{
      const resolved = resolveTheme(mode);
      const root = document.documentElement;
      root.classList.toggle("dark", resolved === "dark");
      root.style.colorScheme = resolved;
    }} catch (_) {{
      // ignore
    }}
  }}

  function applyThemeFromShell(mode) {{
    const normalized = normalizeTheme(mode);
    try {{
      if (normalized === "system") {{
        localStorage.removeItem(THEME_KEY);
      }} else {{
        localStorage.setItem(THEME_KEY, normalized);
      }}
    }} catch (_) {{
      // ignore
    }}
    applyDomTheme(normalized);
    notifyParent();
  }}

  function maybeRewriteWebSocketUrl(rawUrl) {{
    if (!UPSTREAM_WS_HOST) {{
      return rawUrl;
    }}
    try {{
      const resolved = new URL(String(rawUrl), window.location.href);
      const isSameProxyHost = resolved.host === window.location.host;
      const isSessionStream = /^\/api\/sessions\/[^/]+\/stream$/.test(resolved.pathname);
      if (!isSameProxyHost || !isSessionStream) {{
        return rawUrl;
      }}
      resolved.protocol = "ws:";
      resolved.host = UPSTREAM_WS_HOST;
      return resolved.toString();
    }} catch (_) {{
      return rawUrl;
    }}
  }}

  try {{
    const NativeWebSocket = window.WebSocket;
    if (typeof NativeWebSocket === "function") {{
      const PatchedWebSocket = function(url, protocols) {{
        const rewritten = maybeRewriteWebSocketUrl(url);
        if (typeof protocols === "undefined") {{
          return new NativeWebSocket(rewritten);
        }}
        return new NativeWebSocket(rewritten, protocols);
      }};
      PatchedWebSocket.prototype = NativeWebSocket.prototype;
      Object.setPrototypeOf(PatchedWebSocket, NativeWebSocket);
      PatchedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
      PatchedWebSocket.OPEN = NativeWebSocket.OPEN;
      PatchedWebSocket.CLOSING = NativeWebSocket.CLOSING;
      PatchedWebSocket.CLOSED = NativeWebSocket.CLOSED;
      window.WebSocket = PatchedWebSocket;
    }}
  }} catch (_) {{
    // ignore
  }}

  try {{
    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {{
      const result = originalSetItem(key, value);
      if (key === THEME_KEY) {{
        notifyParent();
      }}
      return result;
    }};

    const originalRemoveItem = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = function (key) {{
      const result = originalRemoveItem(key);
      if (key === THEME_KEY) {{
        notifyParent();
      }}
      return result;
    }};
  }} catch (_) {{
    // ignore
  }}

  window.addEventListener("message", function (event) {{
    const data = event && event.data;
    if (!data || data.source !== SHELL_SOURCE) {{
      return;
    }}
    applyThemeFromShell(data.theme);
  }});

  if (document.readyState === "loading") {{
    document.addEventListener("DOMContentLoaded", function () {{
      notifyParent();
      applyDomTheme(normalizeTheme(localStorage.getItem(THEME_KEY)));
    }}, {{ once: true }});
  }} else {{
    notifyParent();
    applyDomTheme(normalizeTheme(localStorage.getItem(THEME_KEY)));
  }}

  setTimeout(notifyParent, 0);
}})();
</script>"#,
        theme_bridge_source = THEME_BRIDGE_SOURCE,
        shell_theme_source = SHELL_THEME_SYNC_SOURCE,
        upstream_ws_origin = upstream_ws_origin
    )
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
    home_directory().or_else(|| std::env::current_dir().ok())
}

fn home_directory() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

fn resolve_kimi_config_dir() -> Result<PathBuf, String> {
    let home = home_directory()
        .ok_or_else(|| "failed to determine home directory for kimi config".to_string())?;
    Ok(home.join(".kimi"))
}

fn resolve_kimi_config_path() -> Result<PathBuf, String> {
    Ok(resolve_kimi_config_dir()?.join("config.toml"))
}

fn parse_kimi_config_document(raw: &str, path: &Path) -> Result<DocumentMut, String> {
    raw.parse::<DocumentMut>()
        .map_err(|error| format!("failed to parse TOML config {}: {error}", path.display()))
}

fn read_or_init_kimi_config(path: &Path) -> Result<DocumentMut, String> {
    if !path.exists() {
        return Ok(DocumentMut::new());
    }

    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read config file {}: {error}", path.display()))?;
    parse_kimi_config_document(&raw, path)
}

fn table_string(table: &Table, key: &str) -> Option<String> {
    table
        .get(key)
        .and_then(Item::as_value)
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn provider_table<'a>(root: &'a Table, provider: &str) -> Option<&'a Table> {
    root.get("providers")
        .and_then(Item::as_table)
        .and_then(|providers| providers.get(provider))
        .and_then(Item::as_table)
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
        runtime.workspace_port = None;
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
    let state = app.state::<AppState>();
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("runtime state mutex is poisoned"))?;
    runtime.pending_remote_port = None;

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

fn open_with_system_file_manager(path: &Path) -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .context("failed to open folder with explorer")?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .context("failed to open folder with open")?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .context("failed to open folder with xdg-open")?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err(anyhow::anyhow!("unsupported platform for opening folder"))
}

fn open_with_system_browser(url: &str) -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(url)
            .spawn()
            .context("failed to open url with explorer")?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .spawn()
            .context("failed to open url with open")?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(url)
            .spawn()
            .context("failed to open url with xdg-open")?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err(anyhow::anyhow!(
        "unsupported platform for opening external url"
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
