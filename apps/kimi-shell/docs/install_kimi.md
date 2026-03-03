# install_kimi

本文沉淀 ExecLink 当前使用的安装链路，覆盖以下内容：

- winget 检测与安装
- Git for Windows（官方源 / 清华源）
- Kimi Code（官方源 / 镜像源）

适用环境：Windows PowerShell。

## 0. winget（App Installer）前置

### 0.1 检测

```powershell
winget --version
```

### 0.2 官方源自动安装（管理员 PowerShell）

```powershell
$ErrorActionPreference='Stop'
$wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
if ($wingetCmd) { Write-Host 'winget already installed'; exit 0 }
$wingetBootstrapUrl = 'https://aka.ms/getwinget'
$wingetBundlePath = Join-Path $env:TEMP 'Microsoft.DesktopAppInstaller.msixbundle'
Invoke-WebRequest -Uri $wingetBootstrapUrl -OutFile $wingetBundlePath -TimeoutSec 180 -MaximumRedirection 8 -ErrorAction Stop
if (-not (Test-Path $wingetBundlePath)) { throw 'winget package missing after official download' }
Add-AppxPackage -Path $wingetBundlePath -ErrorAction Stop
$wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
if (-not $wingetCmd) { throw 'winget not found after installation' }
Write-Host 'winget installation finished'
```

### 0.3 推荐兜底：Microsoft Store 手动安装

- App Installer: https://apps.microsoft.com/detail/9NBLGGH4NNS1

## 1. Git for Windows 安装

### 1.1 官方源（推荐）

```powershell
winget install --id Git.Git -e --source winget
```

### 1.2 清华源（LatestRelease + 版本目录回退）

```powershell
$ErrorActionPreference='Stop'
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
Write-Host 'Git 安装程序执行完成。'
```

## 2. Kimi 官方源完整流程

说明：

- Kimi 使用 `uv` 安装。
- 目标 Python 版本为 `3.13`。

### 2.1 检测并安装 uv（winget 优先，官方脚本回退）

```powershell
$__execlink_uv_cmd = Get-Command uv -ErrorAction SilentlyContinue
if (-not $__execlink_uv_cmd) {
  $__execlink_winget_cmd = Get-Command winget -ErrorAction SilentlyContinue
  if ($__execlink_winget_cmd) {
    try {
      winget install --id astral-sh.uv -e --source winget --accept-source-agreements --accept-package-agreements
    } catch {
      Write-Host 'winget install for uv failed; continue with official installer script.'
    }
  }
}
$__execlink_uv_cmd = Get-Command uv -ErrorAction SilentlyContinue
if (-not $__execlink_uv_cmd) {
  try {
    Invoke-RestMethod -Uri 'https://astral.sh/uv/install.ps1' | Invoke-Expression
  } catch {
    Write-Host 'official uv installer script failed.'
  }
}
$__execlink_uv_candidate_dirs = @((Join-Path $HOME '.local\bin'), (Join-Path $HOME '.cargo\bin'))
foreach ($__execlink_uv_bin_dir in $__execlink_uv_candidate_dirs) {
  if ((Test-Path $__execlink_uv_bin_dir) -and ($env:Path -notlike "*$__execlink_uv_bin_dir*")) {
    $env:Path = "$__execlink_uv_bin_dir;$env:Path"
  }
}
$__execlink_uv_cmd = Get-Command uv -ErrorAction SilentlyContinue
if (-not $__execlink_uv_cmd) {
  throw 'uv not found after installation. Run: winget install --id astral-sh.uv -e'
}
uv --version
```

### 2.2 安装 Python 3.13 与 kimi-cli

```powershell
uv python install 3.13
uv tool install kimi-cli --python 3.13
```

### 2.3 验证与登录

```powershell
kimi -v
kimi login
```

## 3. Kimi 镜像源完整流程

镜像策略：

- Python 安装器：清华优先，失败后尝试阿里。
- PyPI 索引：清华优先，失败后尝试阿里。
- 每个镜像先做秒级探测，全部失败立即退出。

### 3.1 镜像地址

- Python 安装器（清华）：`https://mirrors.tuna.tsinghua.edu.cn/python/3.13.12/python-3.13.12-amd64.exe`
- Python 安装器（阿里）：`https://mirrors.aliyun.com/python-release/windows/python-3.13.12-amd64.exe`
- PyPI 索引（清华）：`https://pypi.tuna.tsinghua.edu.cn/simple/`
- PyPI 索引（阿里）：`https://mirrors.aliyun.com/pypi/simple/`

### 3.2 统一探测命令（3s 连接超时，8s 总超时）

```powershell
$url = '<镜像地址>'
$code = & curl.exe -I -L --connect-timeout 3 --max-time 8 -sS -o NUL -w '%{http_code}' "$url"
if ($LASTEXITCODE -ne 0) { throw ('curl_exit_code=' + $LASTEXITCODE) }
if (-not ($code -match '^\d{3}$')) { throw ('http_status=' + $code) }
if ([int]$code -ge 400) { throw ('http_status=' + $code) }
```

### 3.3 Python 3.13 镜像安装流程

对每个可用镜像执行：

```powershell
$__execlink_python_installer = Join-Path $env:TEMP 'execlink-python-3.13.12-amd64.exe'
$__execlink_python_installer_url = '<Python镜像地址>'
Invoke-WebRequest -Uri $__execlink_python_installer_url -OutFile $__execlink_python_installer -TimeoutSec 30 -MaximumRedirection 3 -ErrorAction Stop
if (-not (Test-Path $__execlink_python_installer)) { throw 'python installer file missing after download' }
$__execlink_installer_proc = Start-Process -FilePath $__execlink_python_installer -ArgumentList @('/quiet','InstallAllUsers=0','PrependPath=1','Include_pip=1','Include_test=0') -Wait -PassThru
if ($null -eq $__execlink_installer_proc) { throw 'python installer process unavailable' }
if ($__execlink_installer_proc.ExitCode -ne 0) { throw ('python installer exit_code=' + $__execlink_installer_proc.ExitCode) }
$__execlink_user_python = Join-Path $env:LocalAppData 'Programs\Python\Python313\python.exe'
if (Test-Path $__execlink_user_python) { & $__execlink_user_python --version; if ($LASTEXITCODE -eq 0) { } else { throw 'python 3.13 runtime not found' } }
if (-not (Test-Path $__execlink_user_python)) {
  $__execlink_py_launcher = Get-Command py -ErrorAction SilentlyContinue
  if ($__execlink_py_launcher) { & py -3.13 --version; if ($LASTEXITCODE -ne 0) { throw 'python 3.13 runtime not found' } }
  else { throw 'python 3.13 runtime not found' }
}
if (Test-Path $__execlink_python_installer) { Remove-Item $__execlink_python_installer -Force -ErrorAction SilentlyContinue }
```

### 3.4 kimi-cli 镜像安装流程

对每个可用索引执行：

```powershell
$__execlink_user_python = Join-Path $env:LocalAppData 'Programs\Python\Python313\python.exe'
$__execlink_kimi_python = if (Test-Path $__execlink_user_python) { $__execlink_user_python } else { '3.13' }
uv tool install kimi-cli --python "$__execlink_kimi_python" -i '<PyPI镜像索引>'
```

### 3.5 失败策略

- Python 镜像全部失败：立即报错退出。
- PyPI 索引全部失败：立即报错退出。
- 不进入长时间等待复检。

## 4. 仅保留 Python 环境（卸载 Kimi）

```powershell
uv tool uninstall kimi-cli
```

Python 3.13 复检：

```powershell
py -3.13 --version
```

## 5. 最终验证清单

```powershell
winget --version
git --version
node -v
npm -v
uv --version
py -3.13 --version
kimi -v
```
