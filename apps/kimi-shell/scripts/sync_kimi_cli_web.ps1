param(
  [string]$Commit = "",
  [string]$Branch = "main",
  [string]$Repository = "https://github.com/MoonshotAI/kimi-cli.git"
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$vendorRoot = Join-Path $repoRoot "third_party\kimi-cli-web"
$sourceRoot = Join-Path $vendorRoot "upstream-web"
$patchRoot = Join-Path $repoRoot "patches\kimi-web"
$maintainerDocPath = Join-Path $repoRoot "docs\kimi-web-maintenance.md"
$thirdPartyNoticesPath = Join-Path $repoRoot "docs\third-party-notices.md"
$manifestPath = Join-Path $repoRoot "public\enhanced-kimi-web\manifest.json"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("kimi-cli-web-" + [System.Guid]::NewGuid().ToString("N"))
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8NoBomFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  [System.IO.File]::WriteAllText($Path, $Value, $utf8NoBom)
}

Write-Host "Repository: $Repository"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required to sync kimi-cli/web"
}

if ([string]::IsNullOrWhiteSpace($Commit)) {
  $ref = "refs/heads/$Branch"
  $lsRemote = git ls-remote $Repository $ref
  if ([string]::IsNullOrWhiteSpace($lsRemote)) {
    throw "Unable to resolve upstream ref $ref from $Repository"
  }
  $Commit = ($lsRemote -split "\s+")[0].Trim()
  if ([string]::IsNullOrWhiteSpace($Commit)) {
    throw "Resolved upstream ref $ref but did not get a commit SHA"
  }
  Write-Host "Resolved $ref to $Commit"
}

Write-Host "Syncing MoonshotAI/kimi-cli web at $Commit"

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

  $sourceMd = @'
# MoonshotAI/kimi-cli Web Source

- Repository: {0}
- Upstream path: `web/`
- Commit: `{1}`
- License: Apache-2.0
- Source strategy: upstream snapshot plus local patch/overlay
- Synced at: {2}

This directory stores the upstream Web source snapshot used by the KickSide local enhanced Web experience. The current runtime still uses workspace-proxy same-origin injection; this synced snapshot exists to support future source-level i18n and patch review. Local changes should live in `patches/kimi-web/` or in explicit overlay files, not directly inside the upstream snapshot.
'@ -f $Repository, $Commit, (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
  Write-Utf8NoBomFile -Path (Join-Path $vendorRoot "SOURCE.md") -Value $sourceMd

  if (-not (Test-Path (Join-Path $vendorRoot "CHANGES.md"))) {
    Write-Utf8NoBomFile -Path (Join-Path $vendorRoot "CHANGES.md") -Value @"
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

if (Test-Path $manifestPath) {
  $manifest = Get-Content -Path $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $manifest.upstreamRepository = "https://github.com/MoonshotAI/kimi-cli"
  $manifest.upstreamPath = "web/"
  $manifest.upstreamCommit = $Commit
  $manifest.license = "Apache-2.0"
  Write-Utf8NoBomFile -Path $manifestPath -Value ($manifest | ConvertTo-Json -Depth 8)
}

if (Test-Path $thirdPartyNoticesPath) {
  $notices = Get-Content -Path $thirdPartyNoticesPath -Raw -Encoding UTF8
  $commitLine = '- 当前记录 commit：`' + $Commit + '`'
  $updatedNotices = $notices -replace '(?m)^- 当前记录 commit：`[^`]+`$', $commitLine
  Write-Utf8NoBomFile -Path $thirdPartyNoticesPath -Value (($updatedNotices.TrimEnd("`r", "`n")) + "`r`n")
}

if (Test-Path $maintainerDocPath) {
  $maintenanceDoc = Get-Content -Path $maintainerDocPath -Raw -Encoding UTF8
  $commitLine = '- 当前同步基线 commit：`' + $Commit + '`'
  $updatedMaintenanceDoc = $maintenanceDoc -replace '(?m)^- 当前同步基线 commit：`[^`]+`$', $commitLine
  Write-Utf8NoBomFile -Path $maintainerDocPath -Value (($updatedMaintenanceDoc.TrimEnd("`r", "`n")) + "`r`n")
}

Write-Host "Sync complete."
