# install_kimi

本文沉淀 ExecLink 当前使用的安装链路，覆盖以下内容：

- winget 检测与安装
- Git for Windows（官方源 / 清华源）
- Kimi Code（官方源 / 镜像源）

适用环境：Windows PowerShell。

## PowerShell 受限环境说明

- 应用内安装任务会先做 PowerShell 预检，收集：
  - `Get-ExecutionPolicy -List`
  - `$ExecutionContext.SessionState.LanguageMode`
  - 与正式安装同参数的 `powershell.exe -ExecutionPolicy Bypass -File ...` smoke test
- 如果只是当前会话 `.ps1` 执行受限，应用会先尝试回退到内联命令模式，不会默认修改系统策略。
- 只有明确识别为 execution policy 拦截时，才建议用户手动执行：

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

- 如果预检结果显示 `MachinePolicy` / `UserPolicy`、AppLocker、WDAC 或 `ConstrainedLanguage`，通常需要按企业设备策略处理，`Set-ExecutionPolicy` 未必生效。

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

### 1.3 Git Bash / KIMI_SHELL_PATH

Shell 会自动探测以下路径，并在启动 `kimi server run` 时写入 `KIMI_SHELL_PATH`：

```powershell
$gitBash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
if (-not (Test-Path $gitBash)) { throw 'Git Bash not found' }
$env:KIMI_SHELL_PATH = $gitBash
& $env:KIMI_SHELL_PATH --version
```

## 2. Kimi 官方源完整流程

说明：

- Windows 主路径使用 Kimi Code 官方安装脚本。
- 官方脚本默认安装到 `%USERPROFILE%\.kimi-code\bin\kimi.exe`，并更新用户 PATH。
- 旧版 `uv` / Python `kimi-cli` 只作为历史兼容，不再是主安装依赖。

### 2.1 安装 Kimi Code

```powershell
$ErrorActionPreference='Stop'
Invoke-RestMethod -Uri 'https://code.kimi.com/kimi-code/install.ps1' | Invoke-Expression
$kimiBin = Join-Path $HOME '.kimi-code\bin\kimi.exe'
if (Test-Path $kimiBin) {
  & $kimiBin --version
} else {
  kimi --version
}
```

### 2.2 升级 Kimi Code

```powershell
kimi upgrade
kimi --version
```

### 2.3 验证与登录

```powershell
kimi --version
kimi login
```

## 3. Kimi 镜像源与 npm 备选

官方 Windows 安装脚本是主路径。若需要通过 npm 包管理器安装或企业网络只允许 npm registry，可使用 npm 备选：

```powershell
npm install -g @moonshot-ai/kimi-code@latest
kimi --version
```

使用 npm 镜像源时：

```powershell
npm install -g @moonshot-ai/kimi-code@latest --registry https://registry.npmmirror.com
```

应用内“镜像源”设置仍保留 Git 与历史 uv/Python 字段，用于旧安装链路的手动修复；Kimi Code 主安装不再读取 PyPI 镜像。

## 4. 卸载 Kimi Code

```powershell
npm uninstall -g @moonshot-ai/kimi-code
$kimiBin = Join-Path $HOME '.kimi-code\bin\kimi.exe'
if (Test-Path $kimiBin) { Remove-Item $kimiBin -Force }
```

## 5. 最终验证清单

```powershell
winget --version
git --version
$env:KIMI_SHELL_PATH
kimi --version
```

npm 仅用于 npm 备选安装或卸载：

```powershell
node -v
npm -v
```
