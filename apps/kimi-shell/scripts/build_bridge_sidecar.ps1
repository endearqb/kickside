$ErrorActionPreference = "Stop"

$shellRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $shellRoot)
$bridgeRoot = Join-Path $repoRoot "apps\kimi-im-bridge"
$outputDir = Join-Path $shellRoot "src-tauri\binaries"
$outputPath = Join-Path $outputDir "kimi-im-bridge.exe"

$goCommand = Get-Command go -ErrorAction SilentlyContinue
if (-not $goCommand) {
  throw "Go toolchain not found on PATH. Expected `go` to build apps/kimi-im-bridge."
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

Push-Location $bridgeRoot
try {
  & $goCommand.Source build -trimpath -o $outputPath ./cmd/kimi-im-bridge
}
finally {
  Pop-Location
}

Write-Host "bridge sidecar built to $outputPath"
