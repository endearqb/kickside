$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $projectRoot)

$targets = @(
  (Join-Path $repoRoot "apps\kimi-im-bridge\bin"),
  (Join-Path $projectRoot "src-tauri\target\debug"),
  (Join-Path $projectRoot "src-tauri\binaries\kimi-im-bridge.exe")
)

foreach ($target in $targets) {
  if (-not (Test-Path -LiteralPath $target)) {
    continue
  }

  Remove-Item -LiteralPath $target -Recurse -Force
  Write-Host "removed $target"
}

Write-Host "public build cleanup complete"
