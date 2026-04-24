param(
  [string]$Commit = "1e45df06da698151d2dc29a700722c37432e86ce",
  [string]$Repository = "https://github.com/MoonshotAI/kimi-cli.git"
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$vendorRoot = Join-Path $repoRoot "third_party\kimi-cli-web"
$sourceRoot = Join-Path $vendorRoot "upstream-web"
$patchRoot = Join-Path $repoRoot "patches\kimi-web"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("kimi-cli-web-" + [System.Guid]::NewGuid().ToString("N"))

Write-Host "Syncing MoonshotAI/kimi-cli web at $Commit"
Write-Host "Repository: $Repository"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required to sync kimi-cli/web"
}

New-Item -ItemType Directory -Force -Path $vendorRoot | Out-Null
New-Item -ItemType Directory -Force -Path $patchRoot | Out-Null

git clone --filter=blob:none --no-checkout $Repository $tempRoot
Push-Location $tempRoot
try {
  git sparse-checkout init --cone
  git sparse-checkout set web LICENSE package.json
  git checkout $Commit

  if (Test-Path $sourceRoot) {
    Remove-Item -LiteralPath $sourceRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $sourceRoot | Out-Null
  Copy-Item -Path (Join-Path $tempRoot "web\*") -Destination $sourceRoot -Recurse -Force
  Copy-Item -Path (Join-Path $tempRoot "LICENSE") -Destination (Join-Path $vendorRoot "LICENSE") -Force

  $sourceMd = @"
# MoonshotAI/kimi-cli Web Source

- Repository: $Repository
- Upstream path: `web/`
- Commit: $Commit
- License: Apache-2.0
- Synced at: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")

This directory stores the upstream Web source snapshot used by the Kimi App local enhanced Web experience. Local changes should live in `patches/kimi-web/` or in explicit overlay files, not directly inside the upstream snapshot.
"@
  Set-Content -Path (Join-Path $vendorRoot "SOURCE.md") -Value $sourceMd -Encoding UTF8

  if (-not (Test-Path (Join-Path $vendorRoot "CHANGES.md"))) {
    Set-Content -Path (Join-Path $vendorRoot "CHANGES.md") -Encoding UTF8 -Value @"
# Local Changes

- Initial productized local enhanced Web wrapper.
- No official authentication, billing, model, or service semantics are changed.
"@
  }

  $patches = @(Get-ChildItem -Path $patchRoot -Filter *.patch -File -ErrorAction SilentlyContinue)
  foreach ($patch in $patches) {
    Write-Host "Patch available for review: $($patch.FullName)"
  }
} finally {
  Pop-Location
  if (Test-Path $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}

Write-Host "Sync complete."
