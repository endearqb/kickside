param(
  [string[]]$ArtifactPaths,
  [string]$WorkspaceRoot
)

$ErrorActionPreference = "Stop"

if (-not $WorkspaceRoot) {
  $projectRoot = Split-Path -Parent $PSScriptRoot
  $WorkspaceRoot = Split-Path -Parent (Split-Path -Parent $projectRoot)
}
$WorkspaceRoot = (Resolve-Path $WorkspaceRoot).Path

if (-not $ArtifactPaths -or $ArtifactPaths.Count -eq 0) {
  $projectRoot = Split-Path -Parent $PSScriptRoot
  $tauriDir = Join-Path $projectRoot "src-tauri"
  $ArtifactPaths = @(
    (Join-Path $tauriDir "binaries\kimi-im-bridge.exe"),
    (Join-Path $tauriDir "target\release\bundle")
  )
}

$workspacePatterns = @(
  $WorkspaceRoot,
  ($WorkspaceRoot -replace "\\", "/")
) | Select-Object -Unique

$forbiddenExtensions = @(".pdb", ".lib", ".d")
$failures = New-Object System.Collections.Generic.List[string]

function Test-ContainsPattern {
  param(
    [string]$Text,
    [string]$Pattern
  )

  return $Text.IndexOf($Pattern, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Test-FileContainsWorkspaceRoot {
  param(
    [string]$Path,
    [string[]]$Patterns
  )

  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -eq 0) {
    return $false
  }
  $text = [System.Text.Encoding]::GetEncoding(28591).GetString($bytes)
  foreach ($pattern in $Patterns) {
    if ([string]::IsNullOrWhiteSpace($pattern)) {
      continue
    }
    if (Test-ContainsPattern -Text $text -Pattern $pattern) {
      return $true
    }
  }
  return $false
}

$filesToScan = New-Object System.Collections.Generic.List[string]
foreach ($artifactPath in $ArtifactPaths) {
  if (-not (Test-Path -LiteralPath $artifactPath)) {
    $failures.Add("missing artifact path: $artifactPath")
    continue
  }

  $item = Get-Item -LiteralPath $artifactPath
  if ($item.PSIsContainer) {
    foreach ($file in Get-ChildItem -LiteralPath $item.FullName -Recurse -File) {
      $filesToScan.Add($file.FullName)
    }
  } else {
    $filesToScan.Add($item.FullName)
  }
}

foreach ($file in $filesToScan) {
  $extension = [System.IO.Path]::GetExtension($file)
  if ($forbiddenExtensions -contains $extension) {
    $failures.Add("forbidden public artifact extension: $file")
    continue
  }
  if ($file -match "[\\/]\.fingerprint([\\/]|$)" -or $file -match "[\\/]debug([\\/]|$)") {
    $failures.Add("forbidden debug artifact path: $file")
    continue
  }
  if (Test-FileContainsWorkspaceRoot -Path $file -Patterns $workspacePatterns) {
    $failures.Add("workspace root leaked into public artifact: $file")
  }
}

if ($failures.Count -gt 0) {
  $message = ($failures | ForEach-Object { "- $_" }) -join [Environment]::NewLine
  throw "public artifact verification failed:`n$message"
}

Write-Host "public artifact verification passed"
