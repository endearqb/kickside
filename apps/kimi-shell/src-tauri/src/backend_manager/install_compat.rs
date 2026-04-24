#![allow(dead_code)]

use super::*;

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
const POWERSHELL_INSTALL_NODEJS_OFFICIAL_LAUNCH: &str = r#"
$ErrorActionPreference='Stop'
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw '鏈娴嬪埌 winget锛岃鍏堝畨瑁?App Installer 鍚庨噸璇曘€?
}
winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
$nodeVer = node -v
Write-Output "Node.js 瀹夎瀹屾垚銆?nodeVer"
"#;

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
    let winget_ready = Command::new("winget")
        .args(["--version"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    let git_ready = git_ready();
    let uv_ready = uv_ready();
    let python313_ready = python313_ready();
    let kimi_ready = kimi_ready(app);
    let node_ready = node_ready();

    InstallProbeStatus {
        winget_ready,
        git_ready,
        uv_ready,
        python313_ready,
        kimi_ready,
        node_ready,
        core_ready: uv_ready && python313_ready && kimi_ready,
    }
}

pub fn get_install_command_catalog() -> InstallCommandCatalog {
    InstallCommandCatalog {
        entries: vec![
            build_install_command_entry(
                "install_deps_official",
                "安装依赖（官方源）",
                "按顺序安装 Git 与 uv。建议使用管理员 PowerShell。",
                "official",
                true,
                vec![
                    build_install_command_step(
                        "install_git_official",
                        "安装 Git",
                        "通过 winget 安装 Git for Windows。",
                        r#"
winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
"#,
                    ),
                    build_install_command_step(
                        "install_uv_official",
                        "安装 uv",
                        "通过 winget 安装 uv。",
                        r#"
winget install --id astral-sh.uv -e --source winget --accept-source-agreements --accept-package-agreements
"#,
                    ),
                    build_install_command_step(
                        "verify_uv_official",
                        "确认 uv 可用",
                        "输出版本号即表示安装成功。",
                        r#"
uv --version
"#,
                    ),
                ],
            ),
            build_install_command_entry(
                "install_deps_mirror",
                "安装依赖（镜像源）",
                "按顺序通过镜像安装 Git 与 uv。建议使用管理员 PowerShell。",
                "mirror",
                true,
                vec![
                    build_install_command_step(
                        "install_git_mirror",
                        "安装 Git",
                        "优先从清华镜像获取 Git 安装包，找不到时自动回退版本目录。",
                        r#"
$ErrorActionPreference='Stop'
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
if (-not $installerHref) { throw '清华镜像未找到 Git 安装包。' }
$gitInstallerUrl = [System.Uri]::new($baseUri, $installerHref).AbsoluteUri
$gitInstallerPath = Join-Path $env:TEMP 'kimi-shell-git-installer.exe'
Invoke-WebRequest -Uri $gitInstallerUrl -OutFile $gitInstallerPath -TimeoutSec 180 -MaximumRedirection 8 -ErrorAction Stop
Start-Process -FilePath $gitInstallerPath -Wait
"#,
                    ),
                    build_install_command_step(
                        "install_uv_mirror",
                        "安装 uv",
                        "依次尝试清华和阿里镜像，下载 zip 后解压到用户目录。",
                        r#"
$ErrorActionPreference='Stop'
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
Write-Host ('uv 镜像安装失败，继续尝试下一个源：' + $releaseUrl)
  }
}

foreach ($dir in @((Join-Path $HOME '.local\bin'), (Join-Path $HOME '.cargo\bin'))) {
  if ((Test-Path $dir) -and ($env:Path -notlike "*$dir*")) {
$env:Path = "$dir;$env:Path"
  }
}

if ((-not $uvInstalled) -or (-not (Get-Command uv -ErrorAction SilentlyContinue))) {
  throw 'uv 镜像安装失败，请检查网络后重试。'
}
"#,
                    ),
                    build_install_command_step(
                        "verify_deps_mirror",
                        "验证依赖",
                        "确认 Git 与 uv 已可在当前 PowerShell 中调用。",
                        r#"
git --version
uv --version
"#,
                    ),
                ],
            ),
            build_install_command_entry(
                "install_kimi_official",
                "安装 Kimi（官方源）",
                "先安装 Python 3.13，再安装 kimi-cli。",
                "official",
                false,
                vec![
                    build_install_command_step(
                        "install_python_official",
                        "安装 Python 3.13",
                        "通过 uv 安装 Python 3.13 运行时。",
                        r#"
uv python install 3.13
"#,
                    ),
                    build_install_command_step(
                        "install_kimi_cli_official",
                        "安装 kimi-cli",
                        "使用 Python 3.13 安装或升级 kimi-cli。",
                        r#"
uv tool install kimi-cli --python 3.13 --upgrade
"#,
                    ),
                    build_install_command_step(
                        "verify_kimi_official",
                        "验证 Kimi",
                        "输出版本号即表示安装成功。",
                        r#"
kimi -v
"#,
                    ),
                ],
            ),
            build_install_command_entry(
                "install_kimi_mirror",
                "安装 Kimi（镜像源）",
                "按顺序安装 Python 3.13 与 kimi-cli 镜像源版本。",
                "mirror",
                false,
                vec![
                    build_install_command_step(
                        "install_python_mirror",
                        "安装 Python 3.13",
                        "依次尝试清华和阿里镜像，静默安装 Python 3.13。",
                        r#"
$ErrorActionPreference='Stop'
$pythonMirrors = @(
  'https://mirrors.tuna.tsinghua.edu.cn/python/3.13.12/python-3.13.12-amd64.exe',
  'https://mirrors.aliyun.com/python-release/windows/python-3.13.12-amd64.exe'
)
$pythonInstallerPath = Join-Path $env:TEMP 'kimi-shell-python-3.13.12-amd64.exe'
$pythonInstalled = $false
$pythonUserExe = Join-Path $env:LocalAppData 'Programs\Python\Python313\python.exe'

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
Write-Host ('Python 镜像安装失败，继续尝试下一个源：' + $mirrorUrl)
  }
}

if (-not $pythonInstalled) {
  throw 'Python 3.13 镜像安装失败，请检查网络后重试。'
}
"#,
                    ),
                    build_install_command_step(
                        "install_kimi_cli_mirror",
                        "安装 kimi-cli",
                        "依次尝试清华和阿里 PyPI 镜像安装 kimi-cli。",
                        r#"
$ErrorActionPreference='Stop'
$pythonUserExe = Join-Path $env:LocalAppData 'Programs\Python\Python313\python.exe'
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
Write-Host ('Kimi CLI 镜像安装失败，继续尝试下一个索引：' + $index)
  }
}

if (-not $installed) {
  throw 'Kimi CLI 镜像安装失败，请检查网络后重试。'
}
"#,
                    ),
                    build_install_command_step(
                        "verify_kimi_mirror",
                        "验证 Kimi",
                        "确认 Python 3.13 与 kimi-cli 都可正常调用。",
                        r#"
py -3.13 --version
kimi -v
"#,
                    ),
                ],
            ),
            build_install_command_entry(
                "upgrade_kimi_official",
                "升级 Kimi（官方源）",
                "通过官方源升级现有 kimi-cli。",
                "official",
                false,
                vec![
                    build_install_command_step(
                        "upgrade_kimi_cli_official",
                        "升级 kimi-cli",
                        "使用 Python 3.13 执行升级。",
                        r#"
uv tool install kimi-cli --python 3.13 --upgrade
"#,
                    ),
                    build_install_command_step(
                        "verify_upgrade_kimi_official",
                        "验证版本",
                        "输出版本号确认升级结果。",
                        r#"
kimi -v
"#,
                    ),
                ],
            ),
            build_install_command_entry(
                "upgrade_kimi_mirror",
                "升级 Kimi（镜像源）",
                "通过镜像索引升级现有 kimi-cli。",
                "mirror",
                false,
                vec![
                    build_install_command_step(
                        "upgrade_kimi_cli_mirror",
                        "升级 kimi-cli",
                        "依次尝试清华和阿里 PyPI 镜像升级 kimi-cli。",
                        r#"
$ErrorActionPreference='Stop'
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
Write-Host ('Kimi CLI 镜像升级失败，继续尝试下一个索引：' + $index)
  }
}

if (-not $upgraded) {
  throw 'Kimi CLI 镜像升级失败，请检查网络后重试。'
}
"#,
                    ),
                    build_install_command_step(
                        "verify_upgrade_kimi_mirror",
                        "验证版本",
                        "输出版本号确认升级结果。",
                        r#"
kimi -v
"#,
                    ),
                ],
            ),
            build_install_command_entry(
                "install_nodejs",
                "安装 Node.js",
                "通过 winget 安装 Node.js，并确认 `node` 与 `npm` 可用。",
                "shared",
                true,
                vec![
                    build_install_command_step(
                        "install_nodejs_official",
                        "安装 Node.js",
                        "通过 winget 安装 Node.js。",
                        r#"
winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
"#,
                    ),
                    build_install_command_step(
                        "verify_nodejs",
                        "验证 node",
                        "输出 Node.js 版本号。",
                        r#"
node -v
"#,
                    ),
                    build_install_command_step(
                        "verify_npm",
                        "验证 npm",
                        "输出 npm 版本号。",
                        r#"
npm -v
"#,
                    ),
                ],
            ),
            build_install_command_entry(
                "verify_commands",
                "验证环境",
                "按顺序检查 Git、uv、Python 3.13、Kimi 与 Node.js 是否已可用。",
                "shared",
                false,
                vec![
                    build_install_command_step(
                        "verify_git",
                        "验证 Git",
                        "输出 Git 版本号。",
                        r#"
git --version
"#,
                    ),
                    build_install_command_step(
                        "verify_uv",
                        "验证 uv",
                        "输出 uv 版本号。",
                        r#"
uv --version
"#,
                    ),
                    build_install_command_step(
                        "verify_python313",
                        "验证 Python 3.13",
                        "输出 Python 3.13 版本号。",
                        r#"
py -3.13 --version
"#,
                    ),
                    build_install_command_step(
                        "verify_kimi",
                        "验证 Kimi",
                        "输出 kimi-cli 版本号。",
                        r#"
kimi -v
"#,
                    ),
                    build_install_command_step(
                        "verify_node",
                        "验证 Node.js",
                        "输出 Node.js 版本号。",
                        r#"
node -v
"#,
                    ),
                    build_install_command_step(
                        "verify_npm_shared",
                        "验证 npm",
                        "输出 npm 版本号。",
                        r#"
npm -v
"#,
                    ),
                ],
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
    source: &str,
    requires_elevation: bool,
    steps: Vec<InstallCommandStep>,
) -> InstallCommandEntry {
    InstallCommandEntry {
        id: id.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        source: source.to_string(),
        requires_elevation,
        steps,
    }
}

fn build_install_command_step(
    id: &str,
    title: &str,
    description: &str,
    command: &str,
) -> InstallCommandStep {
    InstallCommandStep {
        id: id.to_string(),
        title: title.to_string(),
        description: description.to_string(),
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
