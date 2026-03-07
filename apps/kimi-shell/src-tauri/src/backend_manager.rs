use std::{
    collections::HashSet,
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
use toml_edit::{value, Array, DocumentMut, Item, Table, Value};
use url::Url;

use crate::{
    app_state::{unix_time_millis, AppState},
    cli_contract, command_utils, kimi_locator, log_manager, port_manager, settings_store,
    types::{
        AppSettings, BackendState, EnvOverrideStatus, InstallCommandCatalog, InstallCommandEntry,
        InstallProbeStatus, KeyValueEntry, KimiCliApiConfigInput, KimiCliApiConfigView,
        KimiCliConfigCenterInput, KimiCliConfigCenterView, LoopControlEntry, McpServerEntry,
        ModelEntry, ProviderEntry, ServiceEntry, TypedFieldEntry, TypedFieldType,
    },
    window_manager, workspace_session,
};

const SHUTDOWN_TIMEOUT_SECS: u64 = 4;
const KIMI_HOST: &str = "127.0.0.1";
const THEME_BRIDGE_SOURCE: &str = "kimi-shell-theme-bridge";
const SHELL_THEME_SYNC_SOURCE: &str = "kimi-shell-theme-sync";
const PREFILL_BRIDGE_SOURCE: &str = "kimi-shell-prefill-bridge";
const SHELL_PREFILL_SYNC_SOURCE: &str = "kimi-shell-prefill-sync";
const EXTERNAL_LINK_BRIDGE_SOURCE: &str = "kimi-shell-external-link-bridge";
const SHELL_SESSION_SYNC_SOURCE: &str = "kimi-shell-session-sync";
const SESSION_BRIDGE_SOURCE: &str = "kimi-shell-session-bridge";
const MAX_UPSTREAM_HEADER_BYTES: usize = 64 * 1024;
const ENV_VALUE_VISIBLE_EDGE: usize = 2;

struct EnvOverrideDefinition {
    key: &'static str,
    overrides: &'static [&'static str],
    priority: &'static str,
}

const ENV_OVERRIDE_DEFINITIONS: &[EnvOverrideDefinition] = &[
    EnvOverrideDefinition {
        key: "KIMI_PROVIDER",
        overrides: &["provider"],
        priority: "Environment overrides config.toml values.",
    },
    EnvOverrideDefinition {
        key: "KIMI_MODEL",
        overrides: &["model", "default_model"],
        priority: "Environment overrides config.toml values.",
    },
    EnvOverrideDefinition {
        key: "KIMI_DEFAULT_SERVICE",
        overrides: &["default_service"],
        priority: "Environment overrides config.toml values.",
    },
    EnvOverrideDefinition {
        key: "KIMI_DEFAULT_EDITOR",
        overrides: &["default_editor"],
        priority: "Environment overrides config.toml values.",
    },
    EnvOverrideDefinition {
        key: "KIMI_DEFAULT_YOLO_MODE",
        overrides: &["default_yolo_mode", "default_yolo"],
        priority: "Environment overrides config.toml values.",
    },
    EnvOverrideDefinition {
        key: "KIMI_DEFAULT_THINKING_MODE",
        overrides: &["default_thinking_mode", "default_thinking"],
        priority: "Environment overrides config.toml values.",
    },
    EnvOverrideDefinition {
        key: "KIMI_API_KEY",
        overrides: &["providers.<active>.api_key"],
        priority: "Environment overrides provider credentials from config.toml.",
    },
    EnvOverrideDefinition {
        key: "MOONSHOT_API_KEY",
        overrides: &["providers.moonshot.api_key"],
        priority: "Environment overrides provider credentials from config.toml.",
    },
    EnvOverrideDefinition {
        key: "OPENAI_API_KEY",
        overrides: &["providers.openai.api_key"],
        priority: "Environment overrides provider credentials from config.toml.",
    },
    EnvOverrideDefinition {
        key: "OPENAI_BASE_URL",
        overrides: &["providers.openai.base_url"],
        priority: "Environment overrides provider endpoint from config.toml.",
    },
    EnvOverrideDefinition {
        key: "ANTHROPIC_API_KEY",
        overrides: &["providers.anthropic.api_key"],
        priority: "Environment overrides provider credentials from config.toml.",
    },
    EnvOverrideDefinition {
        key: "AZURE_OPENAI_API_KEY",
        overrides: &["providers.azure.api_key"],
        priority: "Environment overrides provider credentials from config.toml.",
    },
    EnvOverrideDefinition {
        key: "AZURE_OPENAI_ENDPOINT",
        overrides: &["providers.azure.base_url", "providers.azure.deployment"],
        priority: "Environment overrides provider endpoint from config.toml.",
    },
    EnvOverrideDefinition {
        key: "KIMI_SHARE_DIR",
        overrides: &["CLI data location"],
        priority: "Environment overrides default data directory location.",
    },
    EnvOverrideDefinition {
        key: "KIMI_CLI_DATA_DIR",
        overrides: &["CLI data location"],
        priority: "Environment overrides default data directory location.",
    },
];

const POWERSHELL_INSTALL_DEPS_OFFICIAL_LAUNCH: &str = r#"
$ErrorActionPreference='Stop'
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw '鏈娴嬪埌 winget锛岃鍏堝畨瑁?App Installer 鍚庨噸璇曘€?
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
}
$uvCmd = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvCmd) {
  try {
    winget install --id astral-sh.uv -e --source winget --accept-source-agreements --accept-package-agreements
  } catch {
    Write-Host 'winget 瀹夎 uv 澶辫触锛岀户缁皾璇曞畼鏂瑰畨瑁呰剼鏈€?
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
  throw 'uv 瀹夎澶辫触锛岃鎵嬪姩鎵ц锛歸inget install --id astral-sh.uv -e'
}
$gitVer = git --version
$uvVer = uv --version
Write-Output "宸插惎鍔ㄤ緷璧栧畨瑁呫€?gitVer | $uvVer"
"#;

const POWERSHELL_INSTALL_DEPS_MIRROR_LAUNCH: &str = r#"
$ErrorActionPreference='Stop'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  $latestReleaseUrl = 'https://mirrors.tuna.tsinghua.edu.cn/github-release/git-for-windows/git/LatestRelease/'
  $baseUri = [System.Uri]$latestReleaseUrl
  $latestReleasePage = Invoke-WebRequest -Uri $latestReleaseUrl -TimeoutSec 45 -ErrorAction Stop
  $latestLinks = @($latestReleasePage.Links | Where-Object { $_.href })
  $installerHref = $latestLinks | ForEach-Object { $_.href } | Where-Object { $_ -match '(?i)Git-[^/]*-64-bit\.exe$' } | Select-Object -First 1
  $versionDirHref = $latestLinks | ForEach-Object { $_.href } | Where-Object { $_ -match '(?i)Git%20for%20Windows%20v[^/]+/?$' } | Select-Object -First 1
  if ((-not $installerHref) -and $versionDirHref) {
    $versionDirUrl = [System.Uri]::new($baseUri, $versionDirHref).AbsoluteUri
    $versionPage = Invoke-WebRequest -Uri $versionDirUrl -TimeoutSec 45 -ErrorAction Stop
    $versionLinks = @($versionPage.Links | Where-Object { $_.href })
    $installerHref = $versionLinks | ForEach-Object { $_.href } | Where-Object { $_ -match '(?i)Git-[^/]*-64-bit\.exe$' } | Select-Object -First 1
    if ($installerHref) { $baseUri = [System.Uri]$versionDirUrl }
  }
  if (-not $installerHref) { throw '娓呭崕闀滃儚椤垫湭鎵惧埌 Git 瀹夎鍖呫€? }
  $gitInstallerUrl = [System.Uri]::new($baseUri, $installerHref).AbsoluteUri
  $gitInstallerPath = Join-Path $env:TEMP 'kimi-shell-git-installer.exe'
  Invoke-WebRequest -Uri $gitInstallerUrl -OutFile $gitInstallerPath -TimeoutSec 180 -MaximumRedirection 8 -ErrorAction Stop
  Start-Process -FilePath $gitInstallerPath -Wait
}

$uvCmd = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvCmd) {
  $releaseUrls = @(
    'https://mirrors.tuna.tsinghua.edu.cn/github-release/astral-sh/uv/LatestRelease/',
    'https://mirrors.aliyun.com/github-release/astral-sh/uv/LatestRelease/'
  )
  $assetPattern = '(?i)uv-x86_64-pc-windows-msvc\.zip$'
  $uvInstallDir = Join-Path $HOME '.local\bin'
  $uvZipPath = Join-Path $env:TEMP 'kimi-shell-uv.zip'
  $uvExtractDir = Join-Path $env:TEMP 'kimi-shell-uv'
  New-Item -ItemType Directory -Force -Path $uvInstallDir | Out-Null
  $uvInstalled = $false

  foreach ($releaseUrl in $releaseUrls) {
    try {
      $baseUri = [System.Uri]$releaseUrl
      $releasePage = Invoke-WebRequest -Uri $releaseUrl -TimeoutSec 45 -ErrorAction Stop
      $releaseLinks = @($releasePage.Links | Where-Object { $_.href })
      $assetHref = $releaseLinks | ForEach-Object { $_.href } | Where-Object { $_ -match $assetPattern } | Select-Object -First 1
      if (-not $assetHref) { throw 'release page missing uv windows zip' }
      $assetUrl = [System.Uri]::new($baseUri, $assetHref).AbsoluteUri

      if (Test-Path $uvZipPath) { Remove-Item $uvZipPath -Force -ErrorAction SilentlyContinue }
      if (Test-Path $uvExtractDir) { Remove-Item $uvExtractDir -Recurse -Force -ErrorAction SilentlyContinue }

      Invoke-WebRequest -Uri $assetUrl -OutFile $uvZipPath -TimeoutSec 180 -MaximumRedirection 8 -ErrorAction Stop
      Expand-Archive -Path $uvZipPath -DestinationPath $uvExtractDir -Force
      $uvExe = Get-ChildItem -Path $uvExtractDir -Recurse -Filter 'uv.exe' | Select-Object -First 1
      if (-not $uvExe) { throw 'expanded archive does not contain uv.exe' }

      Copy-Item -Path $uvExe.FullName -Destination (Join-Path $uvInstallDir 'uv.exe') -Force
      $uvInstalled = $true
      break
    } catch {
      Write-Host ('uv 闀滃儚瀹夎澶辫触锛岀户缁皾璇曚笅涓€涓簮锛? + $releaseUrl)
    }
  }

  foreach ($dir in @((Join-Path $HOME '.local\bin'), (Join-Path $HOME '.cargo\bin'))) {
    if ((Test-Path $dir) -and ($env:Path -notlike "*$dir*")) {
      $env:Path = "$dir;$env:Path"
    }
  }

  if ((-not $uvInstalled) -or (-not (Get-Command uv -ErrorAction SilentlyContinue))) {
    throw 'uv 闀滃儚瀹夎澶辫触锛岃妫€鏌ョ綉缁滃悗閲嶈瘯銆?
  }
}

$gitVer = git --version
$uvVer = uv --version
Write-Output "宸插惎鍔ㄩ暅鍍忎緷璧栧畨瑁呫€?gitVer | $uvVer"
"#;

const POWERSHELL_INSTALL_KIMI_OFFICIAL_LAUNCH: &str = r#"
$ErrorActionPreference='Stop'
$uvCandidateDirs = @((Join-Path $HOME '.local\bin'), (Join-Path $HOME '.cargo\bin'))
foreach ($dir in $uvCandidateDirs) {
  if ((Test-Path $dir) -and ($env:Path -notlike "*$dir*")) {
    $env:Path = "$dir;$env:Path"
  }
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw '鏈娴嬪埌 uv锛岃鍏堟墽琛屸€滃畨瑁呬緷璧栵紙Git / uv锛夆€濄€?
}
uv python install 3.13
uv tool install kimi-cli --python 3.13 --upgrade
$kimiVer = kimi -v
Write-Output "Kimi 瀹夎瀹屾垚銆?kimiVer"
"#;

const POWERSHELL_INSTALL_KIMI_MIRROR_LAUNCH: &str = r#"
$ErrorActionPreference='Stop'
$uvCandidateDirs = @((Join-Path $HOME '.local\bin'), (Join-Path $HOME '.cargo\bin'))
foreach ($dir in $uvCandidateDirs) {
  if ((Test-Path $dir) -and ($env:Path -notlike "*$dir*")) {
    $env:Path = "$dir;$env:Path"
  }
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw '鏈娴嬪埌 uv锛岃鍏堟墽琛屸€滃畨瑁呬緷璧栵紙Git / uv锛夆€濄€?
}

$pythonReady = $false
$pythonUserExe = Join-Path $env:LocalAppData 'Programs\Python\Python313\python.exe'
if ((Test-Path $pythonUserExe)) {
  & $pythonUserExe --version
  if ($LASTEXITCODE -eq 0) { $pythonReady = $true }
}
if (-not $pythonReady) {
  $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($pyLauncher) {
    & py -3.13 --version
    if ($LASTEXITCODE -eq 0) { $pythonReady = $true }
  }
}

if (-not $pythonReady) {
  $pythonMirrors = @(
    'https://mirrors.tuna.tsinghua.edu.cn/python/3.13.12/python-3.13.12-amd64.exe',
    'https://mirrors.aliyun.com/python-release/windows/python-3.13.12-amd64.exe'
  )
  $pythonInstallerPath = Join-Path $env:TEMP 'kimi-shell-python-3.13.12-amd64.exe'
  $pythonInstalled = $false
  foreach ($mirrorUrl in $pythonMirrors) {
    try {
      if (Test-Path $pythonInstallerPath) { Remove-Item $pythonInstallerPath -Force -ErrorAction SilentlyContinue }
      Invoke-WebRequest -Uri $mirrorUrl -OutFile $pythonInstallerPath -TimeoutSec 180 -MaximumRedirection 8 -ErrorAction Stop
      $proc = Start-Process -FilePath $pythonInstallerPath -ArgumentList @('/quiet','InstallAllUsers=0','PrependPath=1','Include_pip=1','Include_test=0') -Wait -PassThru
      if ($null -eq $proc) { throw 'python installer process unavailable' }
      if ($proc.ExitCode -ne 0) { throw ('python installer exit_code=' + $proc.ExitCode) }
      if ((Test-Path $pythonUserExe)) {
        & $pythonUserExe --version
        if ($LASTEXITCODE -eq 0) {
          $pythonInstalled = $true
          break
        }
      }
      $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
      if ($pyLauncher) {
        & py -3.13 --version
        if ($LASTEXITCODE -eq 0) {
          $pythonInstalled = $true
          break
        }
      }
    } catch {
      Write-Host ('Python 闀滃儚瀹夎澶辫触锛岀户缁皾璇曚笅涓€涓簮锛? + $mirrorUrl)
    }
  }

  if (-not $pythonInstalled) {
    throw 'Python 3.13 闀滃儚瀹夎澶辫触锛岃妫€鏌ョ綉缁滃悗閲嶈瘯銆?
  }
}

$pythonSpec = if (Test-Path $pythonUserExe) { $pythonUserExe } else { '3.13' }
$indexes = @(
  'https://pypi.tuna.tsinghua.edu.cn/simple/',
  'https://mirrors.aliyun.com/pypi/simple/'
)
$installed = $false
foreach ($index in $indexes) {
  try {
    uv tool install kimi-cli --python "$pythonSpec" --upgrade -i $index
    $installed = $true
    break
  } catch {
    Write-Host ('Kimi 闀滃儚瀹夎澶辫触锛岀户缁皾璇曚笅涓€涓储寮曪細' + $index)
  }
}
if (-not $installed) {
  throw 'Kimi CLI 闀滃儚瀹夎澶辫触锛岃妫€鏌ョ綉缁滃悗閲嶈瘯銆?
}
$kimiVer = kimi -v
Write-Output "Kimi 闀滃儚瀹夎瀹屾垚銆?kimiVer"
"#;

const POWERSHELL_UPGRADE_KIMI_OFFICIAL_LAUNCH: &str = r#"
$ErrorActionPreference='Stop'
$uvCandidateDirs = @((Join-Path $HOME '.local\bin'), (Join-Path $HOME '.cargo\bin'))
foreach ($dir in $uvCandidateDirs) {
  if ((Test-Path $dir) -and ($env:Path -notlike "*$dir*")) {
    $env:Path = "$dir;$env:Path"
  }
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw '鏈娴嬪埌 uv锛岃鍏堝畨瑁呬緷璧栥€?
}
uv tool install kimi-cli --python 3.13 --upgrade
$kimiVer = kimi -v
Write-Output "Kimi 鍗囩骇瀹屾垚銆?kimiVer"
"#;

const POWERSHELL_UPGRADE_KIMI_MIRROR_LAUNCH: &str = r#"
$ErrorActionPreference='Stop'
$uvCandidateDirs = @((Join-Path $HOME '.local\bin'), (Join-Path $HOME '.cargo\bin'))
foreach ($dir in $uvCandidateDirs) {
  if ((Test-Path $dir) -and ($env:Path -notlike "*$dir*")) {
    $env:Path = "$dir;$env:Path"
  }
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw '鏈娴嬪埌 uv锛岃鍏堝畨瑁呬緷璧栥€?
}
$pythonUserExe = Join-Path $env:LocalAppData 'Programs\Python\Python313\python.exe'
$pythonSpec = if (Test-Path $pythonUserExe) { $pythonUserExe } else { '3.13' }
$indexes = @(
  'https://pypi.tuna.tsinghua.edu.cn/simple/',
  'https://mirrors.aliyun.com/pypi/simple/'
)
$upgraded = $false
foreach ($index in $indexes) {
  try {
    uv tool install kimi-cli --python "$pythonSpec" --upgrade -i $index
    $upgraded = $true
    break
  } catch {
    Write-Host ('Kimi 闀滃儚鍗囩骇澶辫触锛岀户缁皾璇曚笅涓€涓储寮曪細' + $index)
  }
}
if (-not $upgraded) {
  throw 'Kimi CLI 闀滃儚鍗囩骇澶辫触锛岃妫€鏌ョ綉缁滃悗閲嶈瘯銆?
}
$kimiVer = kimi -v
Write-Output "Kimi 闀滃儚鍗囩骇瀹屾垚銆?kimiVer"
"#;

const POWERSHELL_INSTALL_NODEJS_OFFICIAL_LAUNCH: &str = r#"
$ErrorActionPreference='Stop'
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw '鏈娴嬪埌 winget锛岃鍏堝畨瑁?App Installer 鍚庨噸璇曘€?
}
winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
$nodeVer = node -v
Write-Output "Node.js 瀹夎瀹屾垚銆?nodeVer"
"#;

const POWERSHELL_VERIFY_COMMANDS_LAUNCH: &str = r#"
git --version
uv --version
py -3.13 --version
kimi -v
node -v
npm -v
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
    runtime.start_requested_at_ms = None;
    runtime.loading_reported_at_ms = None;
    runtime.loading_reported_cycle_id = None;
    runtime.backend_ready_at_ms = None;
    runtime.last_exit_reason = termination_reason.clone();
    runtime.active_session_id = None;
    runtime.active_session_work_dir = None;
    runtime.session_source = Some("cleared:stop_backend".to_string());
    drop(runtime);

    workspace_session::clear_active_session_runtime(app, "stop_backend");

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

pub fn open_logs_folder(app: &AppHandle) -> Result<(), String> {
    let logs_dir = log_manager::ensure_logs_dir(app).map_err(|error| error.to_string())?;
    open_with_system_file_manager(&logs_dir).map_err(|error| error.to_string())
}

pub fn open_external_url(app: &AppHandle, url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("url cannot be empty".to_string());
    }

    let parsed = Url::parse(trimmed).map_err(|error| format!("invalid url: {error}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("unsupported url scheme: {scheme}"));
    }

    log_manager::append_line(
        app,
        format!("external-link bridge open url={}", parsed.as_str()),
    );
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

pub fn load_kimi_cli_config_center() -> Result<KimiCliConfigCenterView, String> {
    let config_dir = resolve_kimi_config_dir()?;
    let config_path = resolve_kimi_config_path()?;
    let (data_dir, data_dir_env_source) = resolve_kimi_data_dir()?;

    let mut view = KimiCliConfigCenterView {
        config_path: config_path.to_string_lossy().to_string(),
        config_dir: config_dir.to_string_lossy().to_string(),
        data_dir,
        data_dir_env_source,
        ..Default::default()
    };

    if config_path.exists() {
        let raw = fs::read_to_string(&config_path).map_err(|error| {
            format!(
                "failed to read config file {}: {error}",
                config_path.display()
            )
        })?;
        let doc = parse_kimi_config_document(&raw, &config_path)?;
        let root = doc.as_table();

        view.default_provider = table_string(root, "provider");
        view.model = table_string(root, "model");
        view.default_model = table_string(root, "default_model");
        view.default_service = table_string(root, "default_service");
        view.default_editor = table_string(root, "default_editor");
        view.default_yolo = table_bool(root, "default_yolo");
        view.default_yolo_mode = table_string(root, "default_yolo_mode");
        view.default_thinking = table_bool(root, "default_thinking");
        view.default_thinking_mode = table_string(root, "default_thinking_mode");
        view.local_model_disable_auto_pull = table_bool(root, "local_model_disable_auto_pull");
        view.providers = parse_provider_entries(root);
        view.models = parse_model_entries(root);
        view.services = parse_service_entries(root);
        view.loop_control = parse_loop_control_entry(root);
        view.mcp_servers = parse_mcp_server_entries(root);
    }

    view.env_overrides = collect_env_override_statuses();
    view.warnings = collect_config_center_warnings(&view);
    Ok(view)
}

pub fn save_kimi_cli_config_center(
    app: &AppHandle,
    input: KimiCliConfigCenterInput,
) -> Result<(), String> {
    validate_config_center_input(&input)?;

    let config_dir = resolve_kimi_config_dir()?;
    fs::create_dir_all(&config_dir).map_err(|error| {
        format!(
            "failed to create kimi config directory {}: {error}",
            config_dir.display()
        )
    })?;

    let config_path = config_dir.join("config.toml");
    let mut doc = read_or_init_kimi_config(&config_path)?;
    apply_config_center_input(&mut doc, &input)?;

    fs::write(&config_path, doc.to_string()).map_err(|error| {
        format!(
            "failed to write config file {}: {error}",
            config_path.display()
        )
    })?;

    let mut settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    settings.onboarding_step_acks.api_config_ack = true;
    settings_store::save(app, &settings).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn install_kimi_dependencies(source: &str) -> Result<String, String> {
    let source = parse_install_source(source)?;
    let (action, script) = match source {
        InstallSource::Official => (
            "install-dependencies-official",
            POWERSHELL_INSTALL_DEPS_OFFICIAL_LAUNCH,
        ),
        InstallSource::Mirror => (
            "install-dependencies-mirror",
            POWERSHELL_INSTALL_DEPS_MIRROR_LAUNCH,
        ),
    };
    launch_windows_powershell_install(
        action,
        script,
        true,
        "External PowerShell launched: install dependencies (Git / uv).",
    )
}

pub fn install_kimi_cli(source: &str) -> Result<String, String> {
    let source = parse_install_source(source)?;
    let (action, script) = match source {
        InstallSource::Official => (
            "install-kimi-official",
            POWERSHELL_INSTALL_KIMI_OFFICIAL_LAUNCH,
        ),
        InstallSource::Mirror => ("install-kimi-mirror", POWERSHELL_INSTALL_KIMI_MIRROR_LAUNCH),
    };
    launch_windows_powershell_install(
        action,
        script,
        false,
        "External PowerShell launched: install Kimi.",
    )
}

pub fn upgrade_kimi_cli(source: &str) -> Result<String, String> {
    let source = parse_install_source(source)?;
    let (action, script) = match source {
        InstallSource::Official => (
            "upgrade-kimi-official",
            POWERSHELL_UPGRADE_KIMI_OFFICIAL_LAUNCH,
        ),
        InstallSource::Mirror => ("upgrade-kimi-mirror", POWERSHELL_UPGRADE_KIMI_MIRROR_LAUNCH),
    };
    launch_windows_powershell_install(
        action,
        script,
        false,
        "External PowerShell launched: upgrade Kimi.",
    )
}

pub fn install_nodejs() -> Result<String, String> {
    launch_windows_powershell_install(
        "install-nodejs",
        POWERSHELL_INSTALL_NODEJS_OFFICIAL_LAUNCH,
        true,
        "External PowerShell launched: install Node.js.",
    )
}

pub fn get_install_probe_status(app: &AppHandle) -> InstallProbeStatus {
    InstallProbeStatus {
        git_ready: git_ready(),
        uv_ready: uv_ready(),
        python313_ready: python313_ready(),
        kimi_ready: kimi_ready(app),
        node_ready: node_ready(),
    }
}

pub fn get_install_command_catalog() -> InstallCommandCatalog {
    InstallCommandCatalog {
        entries: vec![
            build_install_command_entry(
                "install_deps_official",
                "Install dependencies (official)",
                "Install Git and uv via official channels. Requires elevation.",
                true,
                POWERSHELL_INSTALL_DEPS_OFFICIAL_LAUNCH,
            ),
            build_install_command_entry(
                "install_deps_mirror",
                "Install dependencies (mirror)",
                "Install Git and uv via mirror fallback chain. Requires elevation.",
                true,
                POWERSHELL_INSTALL_DEPS_MIRROR_LAUNCH,
            ),
            build_install_command_entry(
                "install_kimi_official",
                "Install Kimi (official)",
                "Install Python 3.13 and kimi-cli from official source.",
                false,
                POWERSHELL_INSTALL_KIMI_OFFICIAL_LAUNCH,
            ),
            build_install_command_entry(
                "install_kimi_mirror",
                "Install Kimi (mirror)",
                "Install Python 3.13 and kimi-cli via mirror fallback chain.",
                false,
                POWERSHELL_INSTALL_KIMI_MIRROR_LAUNCH,
            ),
            build_install_command_entry(
                "upgrade_kimi_official",
                "Upgrade Kimi (official)",
                "Upgrade kimi-cli from official source only.",
                false,
                POWERSHELL_UPGRADE_KIMI_OFFICIAL_LAUNCH,
            ),
            build_install_command_entry(
                "upgrade_kimi_mirror",
                "Upgrade Kimi (mirror)",
                "Upgrade kimi-cli via mirror indexes only.",
                false,
                POWERSHELL_UPGRADE_KIMI_MIRROR_LAUNCH,
            ),
            build_install_command_entry(
                "install_nodejs",
                "Install Node.js",
                "Install Node.js via winget. Requires elevation.",
                true,
                POWERSHELL_INSTALL_NODEJS_OFFICIAL_LAUNCH,
            ),
            build_install_command_entry(
                "verify_commands",
                "Verify commands",
                "Verify Git, uv, Python 3.13, Kimi, and Node.js in PowerShell.",
                false,
                POWERSHELL_VERIFY_COMMANDS_LAUNCH,
            ),
        ],
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

fn build_install_command_entry(
    id: &str,
    title: &str,
    description: &str,
    requires_elevation: bool,
    command: &str,
) -> InstallCommandEntry {
    InstallCommandEntry {
        id: id.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        requires_elevation,
        command: normalize_install_catalog_command(command),
    }
}

fn normalize_install_catalog_command(command: &str) -> String {
    command.trim().replace("\r\n", "\n")
}

fn launch_windows_powershell_install(
    action: &str,
    script: &str,
    requires_elevation: bool,
    success_message: &str,
) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = action;
        let _ = script;
        let _ = requires_elevation;
        let _ = success_message;
        return Err("This install action is only supported on Windows.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let script_path = write_windows_powershell_script(action, script)?;
        launch_windows_powershell_wrapper(&script_path, requires_elevation)?;
        Ok(success_message.to_string())
    }
}

#[cfg(target_os = "windows")]
fn write_windows_powershell_script(action: &str, script: &str) -> Result<PathBuf, String> {
    let sanitized_action: String = action
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let script_dir = std::env::temp_dir().join("kimi-shell-installer");
    fs::create_dir_all(&script_dir)
        .map_err(|error| format!("failed to create temp install directory: {error}"))?;
    let script_path = script_dir.join(format!("{sanitized_action}-{}.ps1", unix_time_millis()));
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&script_path)
        .map_err(|error| format!("failed to create temp install script: {error}"))?;
    file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|error| format!("failed to write script bom: {error}"))?;
    file.write_all(script.trim().as_bytes())
        .map_err(|error| format!("failed to write temp install script: {error}"))?;
    file.write_all(b"\r\n")
        .map_err(|error| format!("failed to finalize temp install script: {error}"))?;
    Ok(script_path)
}

#[cfg(target_os = "windows")]
fn powershell_single_quote(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn launch_windows_powershell_wrapper(
    script_path: &Path,
    requires_elevation: bool,
) -> Result<(), String> {
    let escaped_path = powershell_single_quote(&script_path.to_string_lossy());
    let argument_list =
        format!("@('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File','{escaped_path}')");
    let command = if requires_elevation {
        format!(
            "Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList {argument_list}"
        )
    } else {
        format!("Start-Process -FilePath 'powershell.exe' -ArgumentList {argument_list}")
    };

    let status = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
        ])
        .arg(command)
        .status()
        .map_err(|error| format!("failed to launch powershell wrapper: {error}"))?;

    if !status.success() {
        return Err(format!(
            "failed to launch external install terminal (exit status: {status})"
        ));
    }
    Ok(())
}

fn command_success(command: &str, args: &[&str]) -> bool {
    let mut process = Command::new(command);
    command_utils::configure_system_command(&mut process);
    process
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn command_success_kimi(command: &str, args: &[&str]) -> bool {
    let mut process = Command::new(command);
    command_utils::configure_kimi_query_command(&mut process);
    process
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn command_success_path(path: &Path, args: &[&str], configure_kimi: bool) -> bool {
    if !path.exists() {
        return false;
    }
    let mut process = Command::new(path);
    if configure_kimi {
        command_utils::configure_kimi_query_command(&mut process);
    } else {
        command_utils::configure_system_command(&mut process);
    }
    process
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn git_ready() -> bool {
    command_success("git", &["--version"])
        || git_candidate_paths()
            .iter()
            .any(|path| command_success_path(path, &["--version"], false))
}

fn uv_ready() -> bool {
    command_success("uv", &["--version"])
        || uv_candidate_paths()
            .iter()
            .any(|path| command_success_path(path, &["--version"], false))
}

fn node_ready() -> bool {
    command_success("node", &["-v"])
        || node_candidate_paths()
            .iter()
            .any(|path| command_success_path(path, &["-v"], false))
}

fn kimi_ready(app: &AppHandle) -> bool {
    let settings = settings_store::load_or_default(app).unwrap_or_default();
    if let Ok(path) = kimi_locator::locate(&settings) {
        if command_success_path(&path, &["-v"], true)
            || command_success_path(&path, &["--version"], true)
        {
            return true;
        }
    }

    if command_success_kimi("kimi", &["-v"]) || command_success_kimi("kimi", &["--version"]) {
        return true;
    }

    kimi_candidate_paths().iter().any(|path| {
        command_success_path(path, &["-v"], true)
            || command_success_path(path, &["--version"], true)
    })
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
        if python_candidate_paths()
            .iter()
            .any(|path| command_success_path(path, &["--version"], false))
        {
            return true;
        }
        if command_success("uv", &["python", "find", "3.13"]) {
            return true;
        }
        if uv_candidate_paths()
            .iter()
            .any(|path| command_success_path(path, &["python", "find", "3.13"], false))
        {
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

#[cfg(target_os = "windows")]
fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(PathBuf::from)
}

#[cfg(target_os = "windows")]
fn local_app_data_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

#[cfg(target_os = "windows")]
fn program_files_dirs() -> Vec<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|key| std::env::var_os(key).map(PathBuf::from))
        .collect()
}

#[cfg(target_os = "windows")]
fn git_candidate_paths() -> Vec<PathBuf> {
    program_files_dirs()
        .into_iter()
        .map(|base| base.join("Git").join("cmd").join("git.exe"))
        .collect()
}

#[cfg(not(target_os = "windows"))]
fn git_candidate_paths() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(target_os = "windows")]
fn uv_candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home_dir) = user_home_dir() {
        candidates.push(home_dir.join(".local").join("bin").join("uv.exe"));
        candidates.push(home_dir.join(".cargo").join("bin").join("uv.exe"));
    }
    candidates
}

#[cfg(not(target_os = "windows"))]
fn uv_candidate_paths() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(target_os = "windows")]
fn node_candidate_paths() -> Vec<PathBuf> {
    program_files_dirs()
        .into_iter()
        .map(|base| base.join("nodejs").join("node.exe"))
        .collect()
}

#[cfg(not(target_os = "windows"))]
fn node_candidate_paths() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(target_os = "windows")]
fn python_candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(local_app_data) = local_app_data_dir() {
        candidates.push(
            local_app_data
                .join("Programs")
                .join("Python")
                .join("Python313")
                .join("python.exe"),
        );
    }
    candidates
}

#[cfg(not(target_os = "windows"))]
fn python_candidate_paths() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(target_os = "windows")]
fn kimi_candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home_dir) = user_home_dir() {
        candidates.push(home_dir.join(".local").join("bin").join("kimi.exe"));
        candidates.push(home_dir.join(".cargo").join("bin").join("kimi.exe"));
    }
    candidates
}

#[cfg(not(target_os = "windows"))]
fn kimi_candidate_paths() -> Vec<PathBuf> {
    Vec::new()
}

fn collect_config_center_warnings(view: &KimiCliConfigCenterView) -> Vec<String> {
    let mut warnings = Vec::new();

    if let Some(default_model) = normalize_optional_string(&view.default_model) {
        let model_exists = view
            .models
            .iter()
            .any(|entry| entry.key.trim() == default_model);
        if !model_exists {
            warnings.push(format!(
                "default_model `{default_model}` not found in models table (allowed but may be overridden)."
            ));
        }
    }

    let active_provider = normalize_optional_string(&view.default_provider).or_else(|| {
        view.providers
            .first()
            .map(|entry| entry.key.trim().to_string())
            .filter(|value| !value.is_empty())
    });

    if let Some(provider_key) = active_provider {
        let provider_entry = view
            .providers
            .iter()
            .find(|entry| entry.key.trim() == provider_key);
        if let Some(provider) = provider_entry {
            let has_key_in_config = normalize_optional_string(&provider.api_key).is_some();
            let has_key_in_env = [
                "KIMI_API_KEY",
                "MOONSHOT_API_KEY",
                "OPENAI_API_KEY",
                "ANTHROPIC_API_KEY",
                "AZURE_OPENAI_API_KEY",
            ]
            .iter()
            .any(|key| env_var_trimmed(key).is_some());

            if !has_key_in_config && !has_key_in_env {
                warnings.push(format!(
                    "provider `{provider_key}` has no API key in config or env overrides."
                ));
            }
        }
    }

    warnings
}

fn collect_env_override_statuses() -> Vec<EnvOverrideStatus> {
    ENV_OVERRIDE_DEFINITIONS
        .iter()
        .map(|definition| {
            let value = env_var_trimmed(definition.key);
            EnvOverrideStatus {
                key: definition.key.to_string(),
                is_set: value.is_some(),
                masked_value: value.as_deref().map(mask_env_value),
                overrides: definition
                    .overrides
                    .iter()
                    .map(|item| item.to_string())
                    .collect(),
                priority: definition.priority.to_string(),
            }
        })
        .collect()
}

fn mask_env_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "***".to_string();
    }

    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= ENV_VALUE_VISIBLE_EDGE * 2 {
        return "*".repeat(chars.len());
    }

    let prefix: String = chars[..ENV_VALUE_VISIBLE_EDGE].iter().collect();
    let suffix: String = chars[chars.len() - ENV_VALUE_VISIBLE_EDGE..]
        .iter()
        .collect();
    format!("{prefix}***{suffix}")
}

fn resolve_kimi_data_dir() -> Result<(String, Option<String>), String> {
    if let Some(path) = env_var_trimmed("KIMI_SHARE_DIR") {
        return Ok((path, Some("KIMI_SHARE_DIR".to_string())));
    }
    if let Some(path) = env_var_trimmed("KIMI_CLI_DATA_DIR") {
        return Ok((path, Some("KIMI_CLI_DATA_DIR".to_string())));
    }

    let fallback = resolve_kimi_config_dir()?;
    Ok((fallback.to_string_lossy().to_string(), None))
}

fn env_var_trimmed(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn parse_provider_entries(root: &Table) -> Vec<ProviderEntry> {
    let mut entries = Vec::new();
    let Some(providers) = root.get("providers").and_then(Item::as_table) else {
        return entries;
    };

    for (key, item) in providers.iter() {
        let Some(table) = item.as_table() else {
            continue;
        };

        let mut entry = ProviderEntry {
            key: key.to_string(),
            provider_type: table_string(table, "type"),
            api_key: table_string(table, "api_key"),
            base_url: table_string(table, "base_url"),
            auth_token: table_string(table, "auth_token"),
            app_id: table_string(table, "app_id"),
            access_key_id: table_string(table, "access_key_id"),
            secret_access_key: table_string(table, "secret_access_key"),
            region: table_string(table, "region"),
            api_version: table_string(table, "api_version"),
            deployment: table_string(table, "deployment"),
            model_name: table_string(table, "model_name"),
            env: table_to_key_value_entries(table, "env"),
            custom_headers: table_to_key_value_entries(table, "custom_headers"),
            extra_fields: collect_extra_fields(
                table,
                &[
                    "name",
                    "type",
                    "api_key",
                    "base_url",
                    "auth_token",
                    "app_id",
                    "access_key_id",
                    "secret_access_key",
                    "region",
                    "api_version",
                    "deployment",
                    "model_name",
                    "env",
                    "custom_headers",
                ],
            ),
        };

        if entry.provider_type.is_none() {
            entry.provider_type = table_string(table, "name");
        }

        entries.push(entry);
    }

    entries.sort_by(|left, right| left.key.cmp(&right.key));
    entries
}

fn parse_model_entries(root: &Table) -> Vec<ModelEntry> {
    let mut entries = Vec::new();
    let Some(models) = root.get("models").and_then(Item::as_table) else {
        return entries;
    };

    for (key, item) in models.iter() {
        let Some(table) = item.as_table() else {
            continue;
        };

        entries.push(ModelEntry {
            key: key.to_string(),
            provider: table_string(table, "provider"),
            model: table_string(table, "model"),
            max_context_size: table_i64(table, "max_context_size"),
            capabilities: table_string_array(table, "capabilities"),
            extra_fields: collect_extra_fields(
                table,
                &["provider", "model", "max_context_size", "capabilities"],
            ),
        });
    }

    entries.sort_by(|left, right| left.key.cmp(&right.key));
    entries
}

fn parse_service_entries(root: &Table) -> Vec<ServiceEntry> {
    let mut entries = Vec::new();
    let Some(services) = root.get("services").and_then(Item::as_table) else {
        return entries;
    };

    for (key, item) in services.iter() {
        let Some(table) = item.as_table() else {
            continue;
        };

        entries.push(ServiceEntry {
            key: key.to_string(),
            provider: table_string(table, "provider"),
            model: table_string(table, "model"),
            endpoint: table_string(table, "endpoint"),
            api_key: table_string(table, "api_key"),
            timeout_ms: table_i64(table, "timeout_ms"),
            max_retries: table_i64(table, "max_retries"),
            extra_fields: collect_extra_fields(
                table,
                &[
                    "provider",
                    "model",
                    "endpoint",
                    "api_key",
                    "timeout_ms",
                    "max_retries",
                ],
            ),
        });
    }

    entries.sort_by(|left, right| left.key.cmp(&right.key));
    entries
}

fn parse_loop_control_entry(root: &Table) -> LoopControlEntry {
    let Some(loop_control) = root.get("loop_control").and_then(Item::as_table) else {
        return LoopControlEntry::default();
    };

    LoopControlEntry {
        enabled: table_bool(loop_control, "enabled"),
        max_steps: table_i64(loop_control, "max_steps"),
        max_retries: table_i64(loop_control, "max_retries"),
        timeout_ms: table_i64(loop_control, "timeout_ms"),
        extra_fields: collect_extra_fields(
            loop_control,
            &["enabled", "max_steps", "max_retries", "timeout_ms"],
        ),
    }
}

fn parse_mcp_server_entries(root: &Table) -> Vec<McpServerEntry> {
    let mut entries = Vec::new();
    let Some(mcp_servers) = root.get("mcp_servers").and_then(Item::as_table) else {
        return entries;
    };

    for (key, item) in mcp_servers.iter() {
        let Some(table) = item.as_table() else {
            continue;
        };

        entries.push(McpServerEntry {
            key: key.to_string(),
            command: table_string(table, "command"),
            args: table_string_array(table, "args"),
            env: table_to_key_value_entries(table, "env"),
            enabled: table_bool(table, "enabled"),
            working_directory: table_string(table, "working_directory"),
            timeout_ms: table_i64(table, "timeout_ms"),
            extra_fields: collect_extra_fields(
                table,
                &[
                    "command",
                    "args",
                    "env",
                    "enabled",
                    "working_directory",
                    "timeout_ms",
                ],
            ),
        });
    }

    entries.sort_by(|left, right| left.key.cmp(&right.key));
    entries
}

fn table_to_key_value_entries(table: &Table, key: &str) -> Vec<KeyValueEntry> {
    let mut entries = Vec::new();
    let Some(child) = table.get(key).and_then(Item::as_table) else {
        return entries;
    };

    for (child_key, child_item) in child.iter() {
        let Some(value_item) = child_item.as_value() else {
            continue;
        };
        entries.push(KeyValueEntry {
            key: child_key.to_string(),
            value: toml_value_to_string(value_item),
        });
    }

    entries.sort_by(|left, right| left.key.cmp(&right.key));
    entries
}

fn collect_extra_fields(table: &Table, known_keys: &[&str]) -> Vec<TypedFieldEntry> {
    let known: HashSet<&str> = known_keys.iter().copied().collect();
    let mut fields = Vec::new();

    for (key, item) in table.iter() {
        if known.contains(key) {
            continue;
        }
        if let Some(field) = typed_field_from_item(key, item) {
            fields.push(field);
        }
    }

    fields.sort_by(|left, right| left.key.cmp(&right.key));
    fields
}

fn typed_field_from_item(key: &str, item: &Item) -> Option<TypedFieldEntry> {
    let value_item = item.as_value()?;

    if let Some(value) = value_item.as_str() {
        return Some(TypedFieldEntry {
            key: key.to_string(),
            value_type: TypedFieldType::String,
            value: value.to_string(),
        });
    }
    if let Some(value) = value_item.as_integer() {
        return Some(TypedFieldEntry {
            key: key.to_string(),
            value_type: TypedFieldType::Integer,
            value: value.to_string(),
        });
    }
    if let Some(value) = value_item.as_float() {
        return Some(TypedFieldEntry {
            key: key.to_string(),
            value_type: TypedFieldType::Float,
            value: value.to_string(),
        });
    }
    if let Some(value) = value_item.as_bool() {
        return Some(TypedFieldEntry {
            key: key.to_string(),
            value_type: TypedFieldType::Boolean,
            value: value.to_string(),
        });
    }
    if let Some(value) = value_item.as_array() {
        if value.iter().all(|entry| entry.as_str().is_some()) {
            let joined = value
                .iter()
                .filter_map(|entry| entry.as_str())
                .map(|entry| entry.to_string())
                .collect::<Vec<String>>()
                .join("\n");
            return Some(TypedFieldEntry {
                key: key.to_string(),
                value_type: TypedFieldType::StringArray,
                value: joined,
            });
        }
        return Some(TypedFieldEntry {
            key: key.to_string(),
            value_type: TypedFieldType::String,
            value: value.to_string(),
        });
    }
    if let Some(value) = value_item.as_datetime() {
        return Some(TypedFieldEntry {
            key: key.to_string(),
            value_type: TypedFieldType::String,
            value: value.to_string(),
        });
    }
    None
}

fn validate_config_center_input(input: &KimiCliConfigCenterInput) -> Result<(), String> {
    let provider_keys = validate_named_keys(&input.providers, "providers", |entry| &entry.key)?;
    let _ = validate_named_keys(&input.models, "models", |entry| &entry.key)?;
    let _ = validate_named_keys(&input.services, "services", |entry| &entry.key)?;
    let _ = validate_named_keys(&input.mcp_servers, "mcp_servers", |entry| &entry.key)?;

    for provider in &input.providers {
        validate_key_value_entries(
            &provider.env,
            &format!("providers.{}.env", provider.key.trim()),
        )?;
        validate_key_value_entries(
            &provider.custom_headers,
            &format!("providers.{}.custom_headers", provider.key.trim()),
        )?;
        validate_typed_fields(
            &provider.extra_fields,
            &format!("providers.{}.extra_fields", provider.key.trim()),
        )?;
    }

    for model in &input.models {
        if let Some(provider) = normalize_optional_string(&model.provider) {
            if !provider_keys.contains(&provider) {
                return Err(format!(
                    "models.{} references unknown provider `{provider}`",
                    model.key.trim()
                ));
            }
        }
        validate_typed_fields(
            &model.extra_fields,
            &format!("models.{}.extra_fields", model.key.trim()),
        )?;
    }

    for service in &input.services {
        if let Some(provider) = normalize_optional_string(&service.provider) {
            if !provider_keys.contains(&provider) {
                return Err(format!(
                    "services.{} references unknown provider `{provider}`",
                    service.key.trim()
                ));
            }
        }
        validate_typed_fields(
            &service.extra_fields,
            &format!("services.{}.extra_fields", service.key.trim()),
        )?;
    }

    validate_typed_fields(
        &input.loop_control.extra_fields,
        "loop_control.extra_fields",
    )?;

    for server in &input.mcp_servers {
        validate_key_value_entries(
            &server.env,
            &format!("mcp_servers.{}.env", server.key.trim()),
        )?;
        validate_typed_fields(
            &server.extra_fields,
            &format!("mcp_servers.{}.extra_fields", server.key.trim()),
        )?;
    }

    Ok(())
}

fn validate_named_keys<T>(
    entries: &[T],
    label: &str,
    key_selector: impl Fn(&T) -> &str,
) -> Result<HashSet<String>, String> {
    let mut seen = HashSet::new();
    for entry in entries {
        let key = key_selector(entry).trim();
        if key.is_empty() {
            return Err(format!("{label} contains an empty key"));
        }
        if !seen.insert(key.to_string()) {
            return Err(format!("{label} contains duplicate key `{key}`"));
        }
    }
    Ok(seen)
}

fn validate_key_value_entries(entries: &[KeyValueEntry], label: &str) -> Result<(), String> {
    let mut seen = HashSet::new();
    for entry in entries {
        let key = entry.key.trim();
        if key.is_empty() {
            return Err(format!("{label} contains an empty key"));
        }
        if !seen.insert(key.to_string()) {
            return Err(format!("{label} contains duplicate key `{key}`"));
        }
    }
    Ok(())
}

fn validate_typed_fields(entries: &[TypedFieldEntry], label: &str) -> Result<(), String> {
    let mut seen = HashSet::new();
    for entry in entries {
        let key = entry.key.trim();
        if key.is_empty() {
            return Err(format!("{label} contains an empty key"));
        }
        if !seen.insert(key.to_string()) {
            return Err(format!("{label} contains duplicate key `{key}`"));
        }

        match entry.value_type {
            TypedFieldType::String => {}
            TypedFieldType::Integer => {
                let value = entry.value.trim();
                if value.parse::<i64>().is_err() {
                    return Err(format!("{label}.{key} must be a valid integer"));
                }
            }
            TypedFieldType::Float => {
                let value = entry.value.trim();
                if value.parse::<f64>().is_err() {
                    return Err(format!("{label}.{key} must be a valid float"));
                }
            }
            TypedFieldType::Boolean => {
                let value = entry.value.trim();
                if parse_bool_text(value).is_none() {
                    return Err(format!("{label}.{key} must be true/false"));
                }
            }
            TypedFieldType::StringArray => {}
        }
    }
    Ok(())
}

fn apply_config_center_input(
    doc: &mut DocumentMut,
    input: &KimiCliConfigCenterInput,
) -> Result<(), String> {
    set_or_remove_string_key(
        doc,
        "provider",
        normalize_optional_string(&input.default_provider),
    );
    set_or_remove_string_key(doc, "model", normalize_optional_string(&input.model));
    set_or_remove_string_key(
        doc,
        "default_model",
        normalize_optional_string(&input.default_model),
    );
    set_or_remove_string_key(
        doc,
        "default_service",
        normalize_optional_string(&input.default_service),
    );
    set_or_remove_string_key(
        doc,
        "default_editor",
        normalize_optional_string(&input.default_editor),
    );
    set_or_remove_bool_key(doc, "default_yolo", input.default_yolo);
    set_or_remove_string_key(
        doc,
        "default_yolo_mode",
        normalize_optional_string(&input.default_yolo_mode),
    );
    set_or_remove_bool_key(doc, "default_thinking", input.default_thinking);
    set_or_remove_string_key(
        doc,
        "default_thinking_mode",
        normalize_optional_string(&input.default_thinking_mode),
    );
    set_or_remove_bool_key(
        doc,
        "local_model_disable_auto_pull",
        input.local_model_disable_auto_pull,
    );

    set_or_remove_table_key(doc, "providers", build_providers_table(&input.providers)?);
    set_or_remove_table_key(doc, "models", build_models_table(&input.models)?);
    set_or_remove_table_key(doc, "services", build_services_table(&input.services)?);
    set_or_remove_table_key(
        doc,
        "loop_control",
        build_loop_control_table(&input.loop_control)?,
    );
    set_or_remove_table_key(
        doc,
        "mcp_servers",
        build_mcp_servers_table(&input.mcp_servers)?,
    );
    Ok(())
}

fn set_or_remove_string_key(doc: &mut DocumentMut, key: &str, next_value: Option<String>) {
    if let Some(next_value) = next_value {
        doc[key] = value(next_value);
        return;
    }
    let _ = doc.as_table_mut().remove(key);
}

fn set_or_remove_bool_key(doc: &mut DocumentMut, key: &str, next_value: Option<bool>) {
    if let Some(next_value) = next_value {
        doc[key] = value(next_value);
        return;
    }
    let _ = doc.as_table_mut().remove(key);
}

fn set_or_remove_table_key(doc: &mut DocumentMut, key: &str, table: Option<Table>) {
    if let Some(table) = table {
        doc[key] = Item::Table(table);
        return;
    }
    let _ = doc.as_table_mut().remove(key);
}

fn build_providers_table(entries: &[ProviderEntry]) -> Result<Option<Table>, String> {
    if entries.is_empty() {
        return Ok(None);
    }

    let mut providers = Table::new();
    let mut sorted = entries.to_vec();
    sorted.sort_by(|left, right| left.key.trim().cmp(right.key.trim()));

    for entry in sorted {
        let key = entry.key.trim();
        if key.is_empty() {
            return Err("providers contains an empty key".to_string());
        }

        let mut provider = Table::new();
        provider["name"] = value(key);
        set_if_string(&mut provider, "type", &entry.provider_type);
        set_if_string(&mut provider, "api_key", &entry.api_key);
        set_if_string(&mut provider, "base_url", &entry.base_url);
        set_if_string(&mut provider, "auth_token", &entry.auth_token);
        set_if_string(&mut provider, "app_id", &entry.app_id);
        set_if_string(&mut provider, "access_key_id", &entry.access_key_id);
        set_if_string(&mut provider, "secret_access_key", &entry.secret_access_key);
        set_if_string(&mut provider, "region", &entry.region);
        set_if_string(&mut provider, "api_version", &entry.api_version);
        set_if_string(&mut provider, "deployment", &entry.deployment);
        set_if_string(&mut provider, "model_name", &entry.model_name);

        if let Some(env) = build_key_value_table(&entry.env)? {
            provider["env"] = Item::Table(env);
        }
        if let Some(headers) = build_key_value_table(&entry.custom_headers)? {
            provider["custom_headers"] = Item::Table(headers);
        }
        apply_typed_fields(&mut provider, &entry.extra_fields)?;

        providers.insert(key, Item::Table(provider));
    }

    Ok(Some(providers))
}

fn build_models_table(entries: &[ModelEntry]) -> Result<Option<Table>, String> {
    if entries.is_empty() {
        return Ok(None);
    }

    let mut models = Table::new();
    let mut sorted = entries.to_vec();
    sorted.sort_by(|left, right| left.key.trim().cmp(right.key.trim()));

    for entry in sorted {
        let key = entry.key.trim();
        if key.is_empty() {
            return Err("models contains an empty key".to_string());
        }

        let mut model = Table::new();
        set_if_string(&mut model, "provider", &entry.provider);
        set_if_string(&mut model, "model", &entry.model);
        if let Some(max_context_size) = entry.max_context_size {
            model["max_context_size"] = value(max_context_size);
        }
        set_if_string_array(&mut model, "capabilities", &entry.capabilities);
        apply_typed_fields(&mut model, &entry.extra_fields)?;
        models.insert(key, Item::Table(model));
    }

    Ok(Some(models))
}

fn build_services_table(entries: &[ServiceEntry]) -> Result<Option<Table>, String> {
    if entries.is_empty() {
        return Ok(None);
    }

    let mut services = Table::new();
    let mut sorted = entries.to_vec();
    sorted.sort_by(|left, right| left.key.trim().cmp(right.key.trim()));

    for entry in sorted {
        let key = entry.key.trim();
        if key.is_empty() {
            return Err("services contains an empty key".to_string());
        }

        let mut service = Table::new();
        set_if_string(&mut service, "provider", &entry.provider);
        set_if_string(&mut service, "model", &entry.model);
        set_if_string(&mut service, "endpoint", &entry.endpoint);
        set_if_string(&mut service, "api_key", &entry.api_key);
        if let Some(timeout_ms) = entry.timeout_ms {
            service["timeout_ms"] = value(timeout_ms);
        }
        if let Some(max_retries) = entry.max_retries {
            service["max_retries"] = value(max_retries);
        }
        apply_typed_fields(&mut service, &entry.extra_fields)?;
        services.insert(key, Item::Table(service));
    }

    Ok(Some(services))
}

fn build_loop_control_table(entry: &LoopControlEntry) -> Result<Option<Table>, String> {
    let mut loop_control = Table::new();
    if let Some(enabled) = entry.enabled {
        loop_control["enabled"] = value(enabled);
    }
    if let Some(max_steps) = entry.max_steps {
        loop_control["max_steps"] = value(max_steps);
    }
    if let Some(max_retries) = entry.max_retries {
        loop_control["max_retries"] = value(max_retries);
    }
    if let Some(timeout_ms) = entry.timeout_ms {
        loop_control["timeout_ms"] = value(timeout_ms);
    }
    apply_typed_fields(&mut loop_control, &entry.extra_fields)?;

    if loop_control.is_empty() {
        return Ok(None);
    }
    Ok(Some(loop_control))
}

fn build_mcp_servers_table(entries: &[McpServerEntry]) -> Result<Option<Table>, String> {
    if entries.is_empty() {
        return Ok(None);
    }

    let mut servers = Table::new();
    let mut sorted = entries.to_vec();
    sorted.sort_by(|left, right| left.key.trim().cmp(right.key.trim()));

    for entry in sorted {
        let key = entry.key.trim();
        if key.is_empty() {
            return Err("mcp_servers contains an empty key".to_string());
        }

        let mut server = Table::new();
        set_if_string(&mut server, "command", &entry.command);
        set_if_string_array(&mut server, "args", &entry.args);
        if let Some(env) = build_key_value_table(&entry.env)? {
            server["env"] = Item::Table(env);
        }
        if let Some(enabled) = entry.enabled {
            server["enabled"] = value(enabled);
        }
        set_if_string(&mut server, "working_directory", &entry.working_directory);
        if let Some(timeout_ms) = entry.timeout_ms {
            server["timeout_ms"] = value(timeout_ms);
        }
        apply_typed_fields(&mut server, &entry.extra_fields)?;
        servers.insert(key, Item::Table(server));
    }

    Ok(Some(servers))
}

fn build_key_value_table(entries: &[KeyValueEntry]) -> Result<Option<Table>, String> {
    if entries.is_empty() {
        return Ok(None);
    }

    let mut table = Table::new();
    let mut seen = HashSet::new();
    for entry in entries {
        let key = entry.key.trim();
        if key.is_empty() {
            return Err("key/value table contains empty key".to_string());
        }
        if !seen.insert(key.to_string()) {
            return Err(format!("key/value table contains duplicate key `{key}`"));
        }
        table.insert(key, value(entry.value.trim().to_string()));
    }

    if table.is_empty() {
        return Ok(None);
    }
    Ok(Some(table))
}

fn set_if_string(table: &mut Table, key: &str, raw_value: &Option<String>) {
    if let Some(next_value) = normalize_optional_string(raw_value) {
        table[key] = value(next_value);
    }
}

fn set_if_string_array(table: &mut Table, key: &str, values: &[String]) {
    let filtered = values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .collect::<Vec<String>>();

    if filtered.is_empty() {
        return;
    }

    let mut array = Array::new();
    for value in filtered {
        array.push(value);
    }
    table[key] = Item::Value(Value::Array(array));
}

fn apply_typed_fields(table: &mut Table, fields: &[TypedFieldEntry]) -> Result<(), String> {
    for field in fields {
        let key = field.key.trim();
        if key.is_empty() {
            return Err("extra field key cannot be empty".to_string());
        }

        match field.value_type {
            TypedFieldType::String => {
                table.insert(key, value(field.value.clone()));
            }
            TypedFieldType::Integer => {
                let parsed = field
                    .value
                    .trim()
                    .parse::<i64>()
                    .map_err(|_| format!("extra field `{key}` must be a valid integer"))?;
                table.insert(key, value(parsed));
            }
            TypedFieldType::Float => {
                let parsed = field
                    .value
                    .trim()
                    .parse::<f64>()
                    .map_err(|_| format!("extra field `{key}` must be a valid float"))?;
                table.insert(key, value(parsed));
            }
            TypedFieldType::Boolean => {
                let parsed = parse_bool_text(field.value.trim())
                    .ok_or_else(|| format!("extra field `{key}` must be true/false"))?;
                table.insert(key, value(parsed));
            }
            TypedFieldType::StringArray => {
                let mut array = Array::new();
                for line in field
                    .value
                    .lines()
                    .map(|line| line.trim())
                    .filter(|line| !line.is_empty())
                {
                    array.push(line);
                }
                table[key] = Item::Value(Value::Array(array));
            }
        }
    }
    Ok(())
}

fn parse_bool_text(value: &str) -> Option<bool> {
    let normalized = value.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "true" | "1" | "yes" => Some(true),
        "false" | "0" | "no" => Some(false),
        _ => None,
    }
}

fn normalize_optional_string(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn toml_value_to_string(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    if let Some(number) = value.as_integer() {
        return number.to_string();
    }
    if let Some(number) = value.as_float() {
        return number.to_string();
    }
    if let Some(flag) = value.as_bool() {
        return flag.to_string();
    }
    if let Some(datetime) = value.as_datetime() {
        return datetime.to_string();
    }
    if let Some(array) = value.as_array() {
        return array.to_string();
    }
    value.to_string()
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
            workspace_session::clear_active_session_runtime(&app, "monitor_crash");
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
        if let Some(session_id) = extract_session_id_from_stream_path(request.url()) {
            workspace_session::note_session_stream_activity(
                app,
                &session_id,
                "workspace_proxy_ws_upgrade",
            );
        }
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

fn extract_session_id_from_stream_path(raw_url: &str) -> Option<String> {
    const PREFIX: &str = "/api/sessions/";
    const SUFFIX: &str = "/stream";

    let path = raw_url.split('?').next().unwrap_or(raw_url).trim();
    if !path.starts_with(PREFIX) || !path.ends_with(SUFFIX) {
        return None;
    }

    let body = &path[PREFIX.len()..path.len() - SUFFIX.len()];
    if body.is_empty() || body.contains('/') {
        return None;
    }
    Some(body.to_string())
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
  const PREFILL_SOURCE = "{shell_prefill_source}";
  const PREFILL_ACK_SOURCE = "{prefill_bridge_source}";
  const EXTERNAL_LINK_SOURCE = "{external_link_bridge_source}";
  const SESSION_SYNC_SOURCE = "{shell_session_sync_source}";
  const SESSION_BRIDGE_SOURCE = "{session_bridge_source}";
  const QUERY = "(prefers-color-scheme: dark)";
  const UPSTREAM_WS_ORIGIN = "{upstream_ws_origin}";
  const UPSTREAM_WS_HOST = (function () {{
    try {{
      return new URL(UPSTREAM_WS_ORIGIN).host;
    }} catch (_) {{
      return "";
    }}
  }})();
  let observedSessionId = "";
  let observedLocationTemplate = "";

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

  function postPrefillAck(payload) {{
    try {{
      if (window.parent && window.parent !== window) {{
        window.parent.postMessage(
          {{
            source: PREFILL_ACK_SOURCE,
            requestId: payload.requestId,
            applied: !!payload.applied,
            reason: payload.reason || ""
          }},
          "*"
        );
      }}
    }} catch (_) {{
      // ignore
    }}
  }}

  function postExternalLink(url, reason) {{
    try {{
      if (!window.parent || window.parent === window) {{
        return;
      }}
      window.parent.postMessage(
        {{
          source: EXTERNAL_LINK_SOURCE,
          url: url,
          reason: reason || "unknown"
        }},
        "*"
      );
    }} catch (_) {{
      // ignore
    }}
  }}

  function postSessionBridge(payload) {{
    try {{
      if (!window.parent || window.parent === window) {{
        return;
      }}
      window.parent.postMessage(
        {{
          source: SESSION_BRIDGE_SOURCE,
          action: payload.action || "",
          requestId: payload.requestId || "",
          sessionId: payload.sessionId || "",
          routeTemplate: payload.routeTemplate || "",
          applied: !!payload.applied,
          reason: payload.reason || ""
        }},
        "*"
      );
    }} catch (_) {{
      // ignore
    }}
  }}

  function extractSessionIdFromPath(pathname) {{
    if (typeof pathname !== "string") {{
      return "";
    }}
    const match = pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
    return match && match[1] ? decodeURIComponent(match[1]) : "";
  }}

  function observeSessionRouteTemplate(resolvedUrl) {{
    const sessionId = extractSessionIdFromPath(resolvedUrl.pathname);
    if (!sessionId) {{
      return;
    }}

    observedSessionId = sessionId;
    if (!observedLocationTemplate && window.location.href.indexOf(sessionId) >= 0) {{
      observedLocationTemplate = window.location.href.split(sessionId).join("{{session_id}}");
    }}

    postSessionBridge({{
      action: "route_template_observed",
      sessionId: sessionId,
      routeTemplate: observedLocationTemplate || "",
      applied: true,
      reason: observedLocationTemplate ? "location_template" : "session_seen_without_location_template"
    }});
  }}

  function buildQuerySessionFallback(sessionId) {{
    try {{
      const parsed = new URL(window.location.href);
      parsed.pathname = "/";
      parsed.search = "?session=" + encodeURIComponent(sessionId);
      parsed.hash = "";
      return parsed.toString();
    }} catch (_) {{
      return "/?session=" + encodeURIComponent(sessionId);
    }}
  }}

  function tryBuildNavigateTarget(sessionId, routeTemplate) {{
    if (!sessionId) {{
      return "";
    }}

    const template = typeof routeTemplate === "string" && routeTemplate.indexOf("{{session_id}}") >= 0
      ? routeTemplate
      : observedLocationTemplate;
    if (template) {{
      return template.split("{{session_id}}").join(encodeURIComponent(sessionId));
    }}

    const href = String(window.location.href || "");
    if (observedSessionId && href.indexOf(observedSessionId) >= 0) {{
      return href.split(observedSessionId).join(encodeURIComponent(sessionId));
    }}
    return buildQuerySessionFallback(sessionId);
  }}

  function navigateToSession(data) {{
    const requestId = typeof data.requestId === "string" ? data.requestId : "";
    const sessionId = typeof data.sessionId === "string" ? data.sessionId.trim() : "";
    const routeTemplate = typeof data.routeTemplate === "string" ? data.routeTemplate : "";
    const hasTemplate =
      typeof routeTemplate === "string" &&
      routeTemplate.indexOf("{{session_id}}") >= 0;
    const usedObservedTemplate = !hasTemplate && !!observedLocationTemplate;

    if (!sessionId) {{
      postSessionBridge({{
        action: "navigate_session_ack",
        requestId,
        sessionId,
        applied: false,
        reason: "missing_session_id"
      }});
      return;
    }}

    const target = tryBuildNavigateTarget(sessionId, routeTemplate);
    if (!target) {{
      postSessionBridge({{
        action: "navigate_session_ack",
        requestId,
        sessionId,
        applied: false,
        reason: "missing_or_unusable_route_template"
      }});
      return;
    }}

    try {{
      window.location.assign(target);
      postSessionBridge({{
        action: "navigate_session_ack",
        requestId,
        sessionId,
        routeTemplate: routeTemplate || observedLocationTemplate || "/?session={{session_id}}",
        applied: true,
        reason: hasTemplate
          ? "navigated_with_route_template"
          : usedObservedTemplate
            ? "navigated_with_observed_template"
            : "navigated_with_query_fallback"
      }});
    }} catch (_) {{
      postSessionBridge({{
        action: "navigate_session_ack",
        requestId,
        sessionId,
        applied: false,
        reason: "navigate_exception"
      }});
    }}
  }}

  function shouldOpenExternally(url) {{
    if (!url) {{
      return false;
    }}
    try {{
      const parsed = new URL(url, window.location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {{
        return false;
      }}
      return parsed.origin !== window.location.origin;
    }} catch (_) {{
      return false;
    }}
  }}

  function isVisible(element) {{
    if (!element || !element.isConnected) {{
      return false;
    }}
    const style = window.getComputedStyle(element);
    if (!style || style.display === "none" || style.visibility === "hidden") {{
      return false;
    }}
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }}

  function findComposerElement() {{
    const selectors = [
      "textarea[placeholder*='鍙戦€?]",
      "textarea[placeholder*='Send']",
      "textarea[aria-label*='鍙戦€?]",
      "textarea[aria-label*='Send']",
      "textarea",
      "[contenteditable='true'][role='textbox']",
      "[contenteditable='true'][data-lexical-editor='true']",
      "[contenteditable='true']"
    ];

    for (const selector of selectors) {{
      const nodes = Array.from(document.querySelectorAll(selector));
      const target = nodes.find((node) => {{
        if (!(node instanceof HTMLElement)) {{
          return false;
        }}
        if (!isVisible(node)) {{
          return false;
        }}
        if ("disabled" in node && node.disabled) {{
          return false;
        }}
        if (node.getAttribute("aria-disabled") === "true") {{
          return false;
        }}
        return true;
      }});
      if (target) {{
        return target;
      }}
    }}

    return null;
  }}

  function writeComposerValue(target, text) {{
    if (!target) {{
      return false;
    }}

    try {{
      target.focus();
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {{
        target.value = text;
        target.dispatchEvent(new Event("input", {{ bubbles: true }}));
        target.dispatchEvent(new Event("change", {{ bubbles: true }}));
        return true;
      }}

      if (target instanceof HTMLElement && target.isContentEditable) {{
        target.textContent = text;
        try {{
          target.dispatchEvent(
            new InputEvent("input", {{
              bubbles: true,
              data: text,
              inputType: "insertText"
            }})
          );
        }} catch (_) {{
          target.dispatchEvent(new Event("input", {{ bubbles: true }}));
        }}
        return true;
      }}
    }} catch (_) {{
      return false;
    }}

    return false;
  }}

  function findSendButton() {{
    const selectors = [
      "button[type='submit']",
      "button[aria-label*='鍙戦€?]",
      "button[aria-label*='Send']",
      "button[data-testid*='send']",
      "button[data-icon*='send']"
    ];

    for (const selector of selectors) {{
      const nodes = Array.from(document.querySelectorAll(selector));
      const button = nodes.find((node) => {{
        if (!(node instanceof HTMLButtonElement)) {{
          return false;
        }}
        if (!isVisible(node)) {{
          return false;
        }}
        if (node.disabled || node.getAttribute("aria-disabled") === "true") {{
          return false;
        }}
        return true;
      }});
      if (button) {{
        return button;
      }}
    }}
    return null;
  }}

  function triggerSend(target) {{
    const sendButton = findSendButton();
    if (sendButton) {{
      sendButton.click();
      return true;
    }}

    const keyboardEventInit = {{
      key: "Enter",
      code: "Enter",
      which: 13,
      keyCode: 13,
      bubbles: true,
      cancelable: true
    }};

    try {{
      target.dispatchEvent(new KeyboardEvent("keydown", keyboardEventInit));
      target.dispatchEvent(new KeyboardEvent("keypress", keyboardEventInit));
      target.dispatchEvent(new KeyboardEvent("keyup", keyboardEventInit));
      return true;
    }} catch (_) {{
      return false;
    }}
  }}

  function applyPrefillFromShell(data) {{
    const requestId = typeof data.requestId === "string" ? data.requestId : "";
    const text = typeof data.text === "string" ? data.text : "";
    const autoSend = data.autoSend !== false;

    if (!requestId) {{
      postPrefillAck({{ requestId: "", applied: false, reason: "missing_request_id" }});
      return;
    }}

    if (!text.trim()) {{
      postPrefillAck({{ requestId, applied: false, reason: "empty_text" }});
      return;
    }}

    const target = findComposerElement();
    if (!target) {{
      postPrefillAck({{ requestId, applied: false, reason: "composer_not_found" }});
      return;
    }}

    if (!writeComposerValue(target, text)) {{
      postPrefillAck({{ requestId, applied: false, reason: "composer_write_failed" }});
      return;
    }}

    if (!autoSend) {{
      postPrefillAck({{ requestId, applied: true, reason: "filled_only" }});
      return;
    }}

    setTimeout(function () {{
      const sent = triggerSend(target);
      postPrefillAck({{
        requestId,
        applied: sent,
        reason: sent ? "sent" : "send_failed"
      }});
    }}, 50);
  }}

  function maybeRewriteWebSocketUrl(rawUrl) {{
    if (!UPSTREAM_WS_HOST) {{
      return rawUrl;
    }}
    try {{
      const resolved = new URL(String(rawUrl), window.location.href);
      const isSameProxyHost = resolved.host === window.location.host;
      const isSessionStream = /^\/api\/sessions\/[^/]+\/stream$/.test(resolved.pathname);
      if (isSessionStream) {{
        observeSessionRouteTemplate(resolved);
      }}
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
    document.addEventListener(
      "click",
      function(event) {{
        const target = event && event.target;
        if (!(target instanceof Element)) {{
          return;
        }}
        const anchor = target.closest("a[href]");
        if (!(anchor instanceof HTMLAnchorElement)) {{
          return;
        }}
        const href = anchor.getAttribute("href") || "";
        if (!shouldOpenExternally(href)) {{
          return;
        }}
        event.preventDefault();
        event.stopPropagation();
        postExternalLink(new URL(href, window.location.href).toString(), "anchor_click");
      }},
      true
    );
  }} catch (_) {{
    // ignore
  }}

  try {{
    const nativeWindowOpen = window.open;
    if (typeof nativeWindowOpen === "function") {{
      window.open = function(url, target, features) {{
        const resolvedUrl = typeof url === "string" ? url : String(url || "");
        if (shouldOpenExternally(resolvedUrl)) {{
          postExternalLink(new URL(resolvedUrl, window.location.href).toString(), "window_open");
          return null;
        }}
        return nativeWindowOpen.call(window, url, target, features);
      }};
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
    if (!data || !data.source) {{
      return;
    }}
    if (data.source === SHELL_SOURCE) {{
      applyThemeFromShell(data.theme);
      return;
    }}
    if (data.source === PREFILL_SOURCE) {{
      applyPrefillFromShell(data);
      return;
    }}
    if (data.source === SESSION_SYNC_SOURCE) {{
      const action = typeof data.action === "string" ? data.action : "";
      if (action === "navigate_session") {{
        navigateToSession(data);
      }}
    }}
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
        prefill_bridge_source = PREFILL_BRIDGE_SOURCE,
        shell_prefill_source = SHELL_PREFILL_SYNC_SOURCE,
        external_link_bridge_source = EXTERNAL_LINK_BRIDGE_SOURCE,
        shell_session_sync_source = SHELL_SESSION_SYNC_SOURCE,
        session_bridge_source = SESSION_BRIDGE_SOURCE,
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

fn table_bool(table: &Table, key: &str) -> Option<bool> {
    table.get(key).and_then(Item::as_value).and_then(|value| {
        value
            .as_bool()
            .or_else(|| value.as_str().and_then(parse_bool_text))
    })
}

fn table_i64(table: &Table, key: &str) -> Option<i64> {
    table.get(key).and_then(Item::as_value).and_then(|value| {
        value.as_integer().or_else(|| {
            value
                .as_str()
                .and_then(|raw| raw.trim().parse::<i64>().ok())
        })
    })
}

fn table_string_array(table: &Table, key: &str) -> Vec<String> {
    table
        .get(key)
        .and_then(Item::as_value)
        .and_then(Value::as_array)
        .map(|array| {
            array
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<Vec<String>>()
        })
        .unwrap_or_default()
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
        runtime.last_exit_reason = Some("missing_kimi".to_string());
        runtime.active_session_id = None;
        runtime.active_session_work_dir = None;
        runtime.session_source = Some("cleared:missing_kimi".to_string());
    }

    workspace_session::clear_active_session_runtime(app, "missing_kimi");
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
        runtime.active_session_id = None;
        runtime.active_session_work_dir = None;
        runtime.session_source = Some("cleared:crashed".to_string());
    }

    workspace_session::clear_active_session_runtime(app, "crashed");
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
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

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

    #[test]
    fn extract_session_id_from_stream_path_handles_query_string() {
        let value = extract_session_id_from_stream_path(
            "/api/sessions/abc-123/stream?encoding=text&version=1",
        );
        assert_eq!(value.as_deref(), Some("abc-123"));
    }

    #[test]
    fn extract_session_id_from_stream_path_rejects_invalid_paths() {
        assert!(extract_session_id_from_stream_path("/api/sessions//stream").is_none());
        assert!(extract_session_id_from_stream_path("/api/sessions/abc/stream/extra").is_none());
        assert!(extract_session_id_from_stream_path("/api/other/abc/stream").is_none());
    }

    #[test]
    fn theme_bridge_script_contains_session_route_template_and_query_fallback() {
        let script = theme_bridge_script_tag(57999);
        assert!(
            script.contains(r#"routeTemplate.indexOf("{{session_id}}")"#)
                || script.contains(r#"routeTemplate.indexOf("{session_id}")"#)
        );
        assert!(script.contains("return buildQuerySessionFallback(sessionId);"));
        assert!(
            script.contains(
                r#"routeTemplate || observedLocationTemplate || "/?session={{session_id}}""#
            ) || script.contains(
                r#"routeTemplate || observedLocationTemplate || "/?session={session_id}""#
            )
        );
    }

    #[test]
    fn config_center_validation_rejects_unknown_provider_reference() {
        let input = KimiCliConfigCenterInput {
            providers: vec![ProviderEntry {
                key: "moonshot".to_string(),
                ..Default::default()
            }],
            models: vec![ModelEntry {
                key: "kimi-k2".to_string(),
                provider: Some("unknown".to_string()),
                ..Default::default()
            }],
            services: vec![],
            default_provider: None,
            model: None,
            default_model: None,
            default_service: None,
            default_editor: None,
            default_yolo: None,
            default_yolo_mode: None,
            default_thinking: None,
            default_thinking_mode: None,
            local_model_disable_auto_pull: None,
            loop_control: LoopControlEntry::default(),
            mcp_servers: vec![],
        };

        let result = validate_config_center_input(&input);
        assert!(result.is_err());
        let error = result.err().unwrap_or_default();
        assert!(error.contains("unknown provider"));
    }

    #[test]
    fn config_center_apply_rewrites_managed_sections() {
        let mut doc = r#"
provider = "legacy"
[providers.legacy]
api_key = "legacy-key"
"#
        .parse::<DocumentMut>()
        .expect("valid toml document");

        let input = KimiCliConfigCenterInput {
            providers: vec![ProviderEntry {
                key: "moonshot".to_string(),
                provider_type: Some("moonshot".to_string()),
                api_key: Some("new-key".to_string()),
                base_url: Some("https://api.moonshot.cn/v1".to_string()),
                auth_token: None,
                app_id: None,
                access_key_id: None,
                secret_access_key: None,
                region: None,
                api_version: None,
                deployment: None,
                model_name: None,
                env: vec![KeyValueEntry {
                    key: "MOONSHOT_API_KEY".to_string(),
                    value: "${MOONSHOT_API_KEY}".to_string(),
                }],
                custom_headers: vec![],
                extra_fields: vec![],
            }],
            models: vec![ModelEntry {
                key: "kimi-k2".to_string(),
                provider: Some("moonshot".to_string()),
                model: Some("kimi-k2-turbo-preview".to_string()),
                max_context_size: Some(128000),
                capabilities: vec!["chat".to_string(), "vision".to_string()],
                extra_fields: vec![],
            }],
            services: vec![ServiceEntry {
                key: "default".to_string(),
                provider: Some("moonshot".to_string()),
                model: Some("kimi-k2".to_string()),
                endpoint: Some("https://api.moonshot.cn/v1".to_string()),
                api_key: None,
                timeout_ms: Some(60000),
                max_retries: Some(3),
                extra_fields: vec![],
            }],
            default_provider: Some("moonshot".to_string()),
            model: Some("kimi-k2".to_string()),
            default_model: Some("kimi-k2".to_string()),
            default_service: Some("default".to_string()),
            default_editor: Some("vim".to_string()),
            default_yolo: Some(false),
            default_yolo_mode: Some("safe".to_string()),
            default_thinking: Some(true),
            default_thinking_mode: Some("balanced".to_string()),
            local_model_disable_auto_pull: Some(true),
            loop_control: LoopControlEntry {
                enabled: Some(true),
                max_steps: Some(4),
                max_retries: Some(2),
                timeout_ms: Some(120000),
                extra_fields: vec![],
            },
            mcp_servers: vec![McpServerEntry {
                key: "filesystem".to_string(),
                command: Some("npx".to_string()),
                args: vec![
                    "-y".to_string(),
                    "@modelcontextprotocol/server-filesystem".to_string(),
                ],
                env: vec![],
                enabled: Some(true),
                working_directory: Some("D:/Projects".to_string()),
                timeout_ms: Some(45000),
                extra_fields: vec![],
            }],
        };

        apply_config_center_input(&mut doc, &input).expect("apply config center input");
        let root = doc.as_table();

        assert_eq!(table_string(root, "provider").as_deref(), Some("moonshot"));
        assert_eq!(
            table_string(root, "default_model").as_deref(),
            Some("kimi-k2")
        );
        assert!(provider_table(root, "legacy").is_none());
        assert!(provider_table(root, "moonshot").is_some());
        assert!(root
            .get("models")
            .and_then(Item::as_table)
            .and_then(|table| table.get("kimi-k2"))
            .is_some());
        assert!(root
            .get("services")
            .and_then(Item::as_table)
            .and_then(|table| table.get("default"))
            .is_some());
        assert!(root
            .get("mcp_servers")
            .and_then(Item::as_table)
            .and_then(|table| table.get("filesystem"))
            .is_some());
    }

    #[test]
    fn env_override_status_masks_sensitive_values() {
        let _guard = env_lock().lock().expect("env lock should not be poisoned");

        std::env::set_var("KIMI_API_KEY", "sk-test-secret");
        let statuses = collect_env_override_statuses();
        std::env::remove_var("KIMI_API_KEY");

        let record = statuses
            .iter()
            .find(|status| status.key == "KIMI_API_KEY")
            .expect("KIMI_API_KEY status should exist");
        assert!(record.is_set);
        let masked = record.masked_value.clone().unwrap_or_default();
        assert!(masked.contains("***"));
        assert_ne!(masked, "sk-test-secret");
    }
}

