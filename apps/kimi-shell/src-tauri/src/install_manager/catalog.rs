use crate::types::{
    InstallFlowCatalog, InstallSource, InstallTaskDefinition, InstallTaskGroup, InstallTaskId,
    InstallTaskStep,
};

use super::{ps_quote, ResolvedMirrorConfig, KIMI_CODE_NPM_PACKAGE};

pub(super) fn build_install_flow_catalog_with_mirror_config(
    mirror_config: &ResolvedMirrorConfig,
) -> InstallFlowCatalog {
    InstallFlowCatalog {
        tasks: vec![
            task(
                InstallTaskId::QuickInstallCore,
                "Quick Core Install",
                "Install Kimi Code with npm after prerequisite checks.",
                InstallTaskGroup::Core,
                true,
                false,
                false,
                vec![step_kimi_official()],
                vec![step_kimi_mirror(mirror_config)],
                None,
            ),
            task(
                InstallTaskId::InstallUv,
                "Install uv (legacy)",
                "Legacy repair task for old Python-based Kimi Code installs.",
                InstallTaskGroup::Optional,
                false,
                false,
                false,
                vec![step_uv_official()],
                vec![step_uv_mirror(mirror_config)],
                None,
            ),
            task(
                InstallTaskId::InstallPython313,
                "Install Python 3.13 (legacy)",
                "Legacy repair task for old Python-based Kimi Code installs.",
                InstallTaskGroup::Optional,
                false,
                false,
                false,
                vec![step_python_official()],
                vec![step_python_mirror(mirror_config)],
                None,
            ),
            task(
                InstallTaskId::InstallKimi,
                "Install Kimi Code",
                "Install Kimi Code.",
                InstallTaskGroup::Core,
                false,
                false,
                false,
                vec![step_kimi_official()],
                vec![step_kimi_mirror(mirror_config)],
                None,
            ),
            task(
                InstallTaskId::UpgradeKimi,
                "Upgrade Kimi Code",
                "Upgrade the installed Kimi Code to the latest version.",
                InstallTaskGroup::Upgrade,
                false,
                false,
                false,
                vec![step_upgrade_official()],
                vec![step_upgrade_mirror(mirror_config)],
                None,
            ),
            task(
                InstallTaskId::UninstallKimi,
                "Uninstall Kimi Code",
                "Remove only the installed Kimi Code.",
                InstallTaskGroup::Core,
                false,
                false,
                false,
                vec![step_uninstall_kimi()],
                vec![step_uninstall_kimi()],
                None,
            ),
            task(
                InstallTaskId::InstallGit,
                "Install Git for Windows",
                "Optional enhancement for broader development workflows.",
                InstallTaskGroup::Optional,
                false,
                true,
                true,
                vec![step_git_official()],
                vec![step_git_mirror(mirror_config)],
                Some("Git for Windows uses an external elevated installer.".to_string()),
            ),
            task(
                InstallTaskId::InstallNodejs,
                "Install Node.js",
                "Optional enhancement for Node-based tooling.",
                InstallTaskGroup::Optional,
                false,
                true,
                true,
                vec![step_node()],
                vec![step_node()],
                Some("Node.js uses an external elevated installer.".to_string()),
            ),
        ],
    }
}

#[allow(clippy::too_many_arguments)]
fn task(
    id: InstallTaskId,
    title: &str,
    description: &str,
    group: InstallTaskGroup,
    recommended: bool,
    requires_elevation: bool,
    optional: bool,
    official_steps: Vec<InstallTaskStep>,
    mirror_steps: Vec<InstallTaskStep>,
    fallback_reason: Option<String>,
) -> InstallTaskDefinition {
    InstallTaskDefinition {
        id,
        title: title.to_string(),
        description: description.to_string(),
        group,
        recommended,
        runs_in_app: !requires_elevation,
        requires_elevation,
        optional,
        fallback_reason,
        official_steps,
        mirror_steps,
    }
}

pub(super) fn step(id: &str, title: &str, description: &str, command: &str) -> InstallTaskStep {
    InstallTaskStep {
        id: id.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        command: command.trim().to_string(),
    }
}

fn ps_array(values: &[String]) -> String {
    format!(
        "@({})",
        values
            .iter()
            .map(|value| ps_quote(value))
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn step_uv_official() -> InstallTaskStep {
    step(
        "install_uv",
        "Install uv",
        "Prefer winget and fall back to the official installer script.",
        r#"
$uvCmd = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvCmd) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'winget is required to install uv.' }
  try { winget install --id astral-sh.uv -e --source winget --accept-source-agreements --accept-package-agreements } catch { Write-Host 'winget install uv failed, falling back to official script.' }
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { Invoke-RestMethod -Uri 'https://astral.sh/uv/install.ps1' | Invoke-Expression }
Invoke-KimiShellVersionCheck 'uv' @((Join-Path $HOME '.local\bin\uv.exe'),(Join-Path $HOME '.cargo\bin\uv.exe')) @('--version')
"#,
    )
}

fn step_uv_mirror(config: &ResolvedMirrorConfig) -> InstallTaskStep {
    let command = r#"
$releaseUrls = __RELEASE_URLS__
$assetPattern = '(?i)uv-x86_64-pc-windows-msvc\.zip$'
$uvInstallDir = Join-Path $HOME '.local\bin'
$uvZipPath = Join-Path $env:TEMP 'kimi-shell-uv.zip'
$uvExtractDir = Join-Path $env:TEMP 'kimi-shell-uv'
New-Item -ItemType Directory -Force -Path $uvInstallDir | Out-Null
$installedUv = Join-Path $uvInstallDir 'uv.exe'
foreach ($releaseUrl in $releaseUrls) {
  try {
    $releasePage = Invoke-WebRequest -Uri $releaseUrl -TimeoutSec 45 -ErrorAction Stop
    $assetHref = @($releasePage.Links | Where-Object { $_.href } | ForEach-Object { $_.href } | Where-Object { $_ -match $assetPattern } | Select-Object -First 1)[0]
    if (-not $assetHref) { throw 'missing uv asset' }
    if (Test-Path $uvZipPath) { Remove-Item $uvZipPath -Force -ErrorAction SilentlyContinue }
    if (Test-Path $uvExtractDir) { Remove-Item $uvExtractDir -Recurse -Force -ErrorAction SilentlyContinue }
    Invoke-WebRequest -Uri ([System.Uri]::new([System.Uri]$releaseUrl, $assetHref).AbsoluteUri) -OutFile $uvZipPath -TimeoutSec 180 -MaximumRedirection 8 -ErrorAction Stop
    Expand-Archive -Path $uvZipPath -DestinationPath $uvExtractDir -Force
    $uvExe = Get-ChildItem -Path $uvExtractDir -Recurse -Filter 'uv.exe' | Select-Object -First 1
    if (-not $uvExe) { throw 'expanded archive does not contain uv.exe' }
    Copy-Item -Path $uvExe.FullName -Destination $installedUv -Force
    if (-not (Test-Path $installedUv)) { throw 'uv.exe was not copied into the install directory' }
    break
  } catch {
    Write-Host ('uv mirror install failed, trying next source: ' + $releaseUrl)
  }
}
Invoke-KimiShellVersionCheck 'uv' @((Join-Path $HOME '.local\bin\uv.exe'),(Join-Path $HOME '.cargo\bin\uv.exe')) @('--version')
"#
    .replace("__RELEASE_URLS__", &ps_array(&config.uv_release_pages));
    step(
        "install_uv",
        "Install uv",
        "Download the uv archive from mirror release pages.",
        &command,
    )
}

fn step_python_official() -> InstallTaskStep {
    step(
        "install_python313",
        "Install Python 3.13",
        "Install and verify Python 3.13 through uv.",
        &python_install_command(),
    )
}

fn step_python_mirror(config: &ResolvedMirrorConfig) -> InstallTaskStep {
    let command = r#"
try { Invoke-KimiShellPython313Check; exit 0 } catch {}
Ensure-KimiShellPath
if (Get-Command uv -ErrorAction SilentlyContinue) {
  try { uv python install 3.13; Invoke-KimiShellPython313Check; exit 0 } catch { Write-Host 'uv-managed Python unavailable, trying installer mirror.' }
}
$pythonMirrors = __PYTHON_MIRRORS__
$pythonInstallerPath = Join-Path $env:TEMP 'kimi-shell-python-3.13.12-amd64.exe'
foreach ($mirrorUrl in $pythonMirrors) {
  try {
    Invoke-WebRequest -Uri $mirrorUrl -OutFile $pythonInstallerPath -TimeoutSec 180 -MaximumRedirection 8 -ErrorAction Stop
    $proc = Start-Process -FilePath $pythonInstallerPath -ArgumentList @('/quiet','InstallAllUsers=0','PrependPath=1','Include_pip=1','Include_test=0') -Wait -PassThru
    if ($null -eq $proc -or $proc.ExitCode -ne 0) { throw 'python installer failed' }
    Invoke-KimiShellPython313Check
    exit 0
  } catch {
    Write-Host ('python mirror install failed, trying next source: ' + $mirrorUrl)
  }
}
throw 'Python 3.13 mirror install failed.'
"#
    .replace("__PYTHON_MIRRORS__", &ps_array(&config.python_installer_urls));
    step(
        "install_python313",
        "Install Python 3.13",
        "Try uv first, then use a mirrored Python installer.",
        &command,
    )
}

pub(super) fn python_install_command() -> String {
    r#"
Ensure-KimiShellPath
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'uv is required before installing Python 3.13.' }
uv python install 3.13
Invoke-KimiShellPython313Check
"#
    .to_string()
}

fn step_kimi_official() -> InstallTaskStep {
    step(
        "install_kimi",
        "Install Kimi Code",
        "Install Kimi Code with npm.",
        &kimi_install_command(None),
    )
}

fn step_kimi_mirror(_config: &ResolvedMirrorConfig) -> InstallTaskStep {
    step(
        "install_kimi",
        "Install Kimi Code",
        "Install Kimi Code. Mirror source does not change the npm package.",
        &kimi_install_command(None),
    )
}

fn step_upgrade_official() -> InstallTaskStep {
    step(
        "upgrade_kimi",
        "Upgrade Kimi Code",
        "Upgrade Kimi Code with npm.",
        &kimi_upgrade_command(None),
    )
}

fn step_upgrade_mirror(config: &ResolvedMirrorConfig) -> InstallTaskStep {
    step(
        "upgrade_kimi",
        "Upgrade Kimi Code",
        "Upgrade Kimi Code. Mirror source does not change the npm package.",
        &kimi_upgrade_command(Some(&ps_array(&config.pypi_index_urls))),
    )
}

fn step_uninstall_kimi() -> InstallTaskStep {
    step(
        "uninstall_kimi",
        "Uninstall Kimi Code",
        "Remove only the managed Kimi Code binary/package.",
        &kimi_uninstall_command(),
    )
}

pub(super) fn kimi_install_command(indexes_expr: Option<&str>) -> String {
    let _ = indexes_expr;
    r#"
Ensure-KimiShellPath
Invoke-KimiShellNodePrerequisites
& $script:KimiShellNpm install -g __KIMI_CODE_NPM_PACKAGE__
if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
$npmPrefix = (& $script:KimiShellNpm prefix -g).Trim()
if ($LASTEXITCODE -ne 0 -or -not $npmPrefix) { throw "npm global prefix lookup failed." }
$npmKimiCmd = Join-Path $npmPrefix 'kimi.cmd'
if (-not (Test-Path $npmKimiCmd)) { throw "npm did not create the Kimi command: $npmKimiCmd" }
Write-Host "Verifying installed npm Kimi command: $npmKimiCmd"
& $npmKimiCmd --version
if ($LASTEXITCODE -ne 0) { throw "installed npm kimi version check failed with exit code $LASTEXITCODE." }
"#
    .replace("__KIMI_CODE_NPM_PACKAGE__", KIMI_CODE_NPM_PACKAGE)
}

pub(super) fn kimi_upgrade_command(indexes_expr: Option<&str>) -> String {
    let _ = indexes_expr;
    r#"
$currentKimiCommand = Get-Command kimi -ErrorAction SilentlyContinue
if (-not $currentKimiCommand -or -not $currentKimiCommand.Source) {
  throw 'The active Kimi command could not be resolved from PATH.'
}
$currentKimi = $currentKimiCommand.Source
$currentPnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
Ensure-KimiShellPath
Invoke-KimiShellNodePrerequisites
Write-Host "Current Kimi command: $currentKimi"
& $currentKimi --version
if ($LASTEXITCODE -ne 0) { throw "kimi version check failed with exit code $LASTEXITCODE." }

$currentKimiDir = [IO.Path]::GetFullPath((Split-Path -Parent $currentKimi)).TrimEnd('\')
$npmPrefix = (& $script:KimiShellNpm prefix -g).Trim()
if ($LASTEXITCODE -ne 0 -or -not $npmPrefix) { throw "npm global prefix lookup failed." }
$npmBin = [IO.Path]::GetFullPath($npmPrefix).TrimEnd('\')
$pnpm = if ($currentPnpmCommand -and $currentPnpmCommand.Source) { $currentPnpmCommand.Source } else { $null }
$pnpmBin = $null
if ($pnpm) {
  $pnpmBin = (& $pnpm bin --global).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $pnpmBin) { throw "pnpm global bin lookup failed." }
  $pnpmBin = [IO.Path]::GetFullPath($pnpmBin).TrimEnd('\')
}
$isNpmInstall = $currentKimiDir -eq $npmBin
$isPnpmInstall = $pnpmBin -and $currentKimiDir -eq $pnpmBin

if ($isNpmInstall -and $isPnpmInstall) {
  throw "The active Kimi command matches both npm and pnpm global bins: $currentKimi"
} elseif ($isPnpmInstall) {
  Write-Host "Upgrading the active pnpm installation: $currentKimi"
  & $pnpm add --global __KIMI_CODE_NPM_PACKAGE__@latest
  if ($LASTEXITCODE -ne 0) { throw "pnpm upgrade failed with exit code $LASTEXITCODE." }
  $verifiedKimi = Join-Path $pnpmBin 'kimi.cmd'
} elseif ($isNpmInstall) {
  Write-Host "Upgrading the active npm installation: $currentKimi"
  & $script:KimiShellNpm install -g __KIMI_CODE_NPM_PACKAGE__@latest
  if ($LASTEXITCODE -ne 0) { throw "npm upgrade failed with exit code $LASTEXITCODE." }
  $verifiedKimi = Join-Path $npmPrefix 'kimi.cmd'
} else {
  throw "The active Kimi command is not managed by npm or pnpm: $currentKimi"
}

if (-not (Test-Path $verifiedKimi)) { throw "Kimi command was not created after upgrade: $verifiedKimi" }
Write-Host "Verifying upgraded Kimi command: $verifiedKimi"
& $verifiedKimi --version
if ($LASTEXITCODE -ne 0) { throw "upgraded kimi version check failed with exit code $LASTEXITCODE." }
"#
    .replace("__KIMI_CODE_NPM_PACKAGE__", KIMI_CODE_NPM_PACKAGE)
}

fn kimi_uninstall_command() -> String {
    r#"
Ensure-KimiShellPath
$managed = __KIMI_CANDIDATE_PATHS__
$removed = $false
if (Get-Command npm -ErrorAction SilentlyContinue) {
  npm uninstall -g __KIMI_CODE_NPM_PACKAGE__
  if ($LASTEXITCODE -eq 0) { $removed = $true }
}
$binary = Join-Path $HOME '.kimi-code\bin\kimi.exe'
if (Test-Path $binary) {
  Remove-Item $binary -Force
  $removed = $true
}
foreach ($candidate in $managed | Where-Object { $_ }) {
  if (Test-Path $candidate) { throw "managed kimi command is still present after uninstall: $candidate" }
}
if (-not $removed) { Write-Host 'No managed Kimi Code install was found.' }
"#
    .replace("__KIMI_CANDIDATE_PATHS__", &kimi_ps_candidate_paths())
    .replace("__KIMI_CODE_NPM_PACKAGE__", KIMI_CODE_NPM_PACKAGE)
}

fn kimi_ps_candidate_paths() -> String {
    "@((Join-Path $HOME '.kimi-code\\bin\\kimi.exe'),(Join-Path $env:APPDATA 'npm\\kimi.cmd'),(Join-Path $HOME '.local\\bin\\kimi.exe'),(Join-Path $HOME '.cargo\\bin\\kimi.exe'))".to_string()
}

fn step_git_official() -> InstallTaskStep {
    step(
        "install_git",
        "Install Git for Windows",
        "Install Git through winget.",
        r#"
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'winget is required to install Git.' }
winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
Invoke-KimiShellVersionCheck 'git' @((Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),(Join-Path ${env:ProgramFiles(x86)} 'Git\cmd\git.exe')) @('--version')
"#,
    )
}

fn step_git_mirror(config: &ResolvedMirrorConfig) -> InstallTaskStep {
    let command = r#"
$releasePages = __RELEASE_PAGES__
$installerPath = Join-Path $env:TEMP 'kimi-shell-git-installer.exe'
foreach ($latestReleaseUrl in $releasePages) {
  try {
    $baseUri = [System.Uri]$latestReleaseUrl
    $page = Invoke-WebRequest -Uri $latestReleaseUrl -TimeoutSec 45 -ErrorAction Stop
    $installerHref = @($page.Links | Where-Object { $_.href } | ForEach-Object { $_.href } | Where-Object { $_ -match '(?i)Git-[^/]*-64-bit\.exe$' } | Select-Object -First 1)[0]
    if (-not $installerHref) { throw 'Mirror page does not contain a Git installer.' }
    Invoke-WebRequest -Uri ([System.Uri]::new($baseUri, $installerHref).AbsoluteUri) -OutFile $installerPath -TimeoutSec 180 -MaximumRedirection 8 -ErrorAction Stop
    Start-Process -FilePath $installerPath -Wait
    Invoke-KimiShellVersionCheck 'git' @((Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),(Join-Path ${env:ProgramFiles(x86)} 'Git\cmd\git.exe')) @('--version')
    exit 0
  } catch {
    Write-Host ('Git mirror install failed, trying next source: ' + $latestReleaseUrl)
  }
}
throw 'Git mirror install failed.'
"#
    .replace("__RELEASE_PAGES__", &ps_array(&config.git_release_pages));
    step(
        "install_git",
        "Install Git for Windows",
        "Download the Git installer from a mirror.",
        &command,
    )
}

fn step_node() -> InstallTaskStep {
    step(
        "install_nodejs",
        "Install Node.js",
        "Install Node.js through winget.",
        r#"
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'winget is required to install Node.js.' }
winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
Invoke-KimiShellVersionCheck 'node' @((Join-Path $env:ProgramFiles 'nodejs\node.exe'),(Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')) @('-v')
"#,
    )
}

pub(super) fn steps_for_source(
    task: &InstallTaskDefinition,
    source: InstallSource,
) -> Vec<InstallTaskStep> {
    match source {
        InstallSource::Official => {
            if task.official_steps.is_empty() {
                task.mirror_steps.clone()
            } else {
                task.official_steps.clone()
            }
        }
        InstallSource::Mirror => {
            if task.mirror_steps.is_empty() {
                task.official_steps.clone()
            } else {
                task.mirror_steps.clone()
            }
        }
    }
}

pub(super) fn join_commands(steps: &[InstallTaskStep]) -> String {
    steps
        .iter()
        .enumerate()
        .map(|(index, step)| {
            format!(
                "# {}. {}\n# {}\n{}\n",
                index + 1,
                step.title,
                step.description,
                step.command.trim()
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}
