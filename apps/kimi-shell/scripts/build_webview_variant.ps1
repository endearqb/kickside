param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("evergreen", "fixed")]
  [string]$Variant,

  [string]$Bundles = "nsis"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$tauriDir = Join-Path $projectRoot "src-tauri"
$configPath = if ($Variant -eq "fixed") {
  Join-Path $tauriDir "tauri.webview.fixed-runtime.conf.json"
} else {
  Join-Path $tauriDir "tauri.webview.evergreen.conf.json"
}

if ($Variant -eq "fixed") {
  $fixedRuntimeDir = Join-Path $tauriDir "webview2-fixed-runtime"
  if (-not (Test-Path $fixedRuntimeDir)) {
    throw "Fixed Runtime variant requires extracted runtime at: $fixedRuntimeDir"
  }
}

$packageJson = Get-Content (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$version = [string]$packageJson.version
$artifactDir = Join-Path $projectRoot ("release-artifacts\webview-runtime\{0}\{1}" -f $version, $Variant)

$env:KIMI_WEBVIEW_RUNTIME_KIND = $Variant
if ($Variant -eq "fixed" -and -not $env:KIMI_WEBVIEW_RUNTIME_VERSION) {
  $env:KIMI_WEBVIEW_RUNTIME_VERSION = ""
}

Push-Location $projectRoot
try {
  pnpm sync:version
  pnpm exec tauri build --bundles $Bundles --config $configPath

  New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
  Copy-Item (Join-Path $tauriDir "target\release\bundle\*") -Destination $artifactDir -Recurse -Force
  Write-Host "webview variant build archived to $artifactDir"
}
finally {
  Pop-Location
}
