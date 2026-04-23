param(
  [string]$WorkspaceRoot
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $projectRoot)
if (-not $WorkspaceRoot) {
  $WorkspaceRoot = (Resolve-Path $repoRoot).Path
} else {
  $WorkspaceRoot = (Resolve-Path $WorkspaceRoot).Path
}

$patterns = @(
  $WorkspaceRoot,
  ($WorkspaceRoot -replace "\\", "/")
) | Select-Object -Unique

Push-Location $repoRoot
try {
  $trackedFiles = @(
    git -c core.quotepath=false ls-files -- 'docs/*.md' 'docs/**/*.md' 'tasks/*.md' 'tasks/**/*.md'
  )
}
finally {
  Pop-Location
}

$trackedFiles = $trackedFiles | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
$failures = New-Object System.Collections.Generic.List[string]

foreach ($relativePath in $trackedFiles) {
  $fullPath = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $fullPath)) {
    continue
  }
  $content = Get-Content -LiteralPath $fullPath -Raw
  foreach ($pattern in $patterns) {
    if ([string]::IsNullOrWhiteSpace($pattern)) {
      continue
    }
    if ($content.IndexOf($pattern, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
      $failures.Add($relativePath)
      break
    }
  }
}

if ($failures.Count -gt 0) {
  $message = ($failures | Sort-Object -Unique | ForEach-Object { "- $_" }) -join [Environment]::NewLine
  throw "tracked markdown contains workspace absolute paths:`n$message"
}

Write-Host "tracked markdown verification passed"
