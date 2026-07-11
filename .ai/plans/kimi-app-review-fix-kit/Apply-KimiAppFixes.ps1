[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,

    [ValidateSet("Check", "Patch", "Write")]
    [string]$Mode = "Check",

    [string]$PatchPath,

    [switch]$AllowOtherRevision
)

$ErrorActionPreference = "Stop"

$kitDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$fixer = Join-Path $kitDir "apply_fixes.py"
if (-not (Test-Path -LiteralPath $fixer -PathType Leaf)) {
    throw "apply_fixes.py not found next to this wrapper: $fixer"
}
if (-not (Test-Path -LiteralPath $RepoPath -PathType Container)) {
    throw "Repository directory does not exist: $RepoPath"
}

$resolvedRepo = (Resolve-Path -LiteralPath $RepoPath).Path
$pythonArgs = @()
if (Get-Command py -ErrorAction SilentlyContinue) {
    $python = "py"
    $pythonArgs += "-3"
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $python = "python"
} elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
    $python = "python3"
} else {
    throw "Python 3 was not found. Install Python 3 or run apply_fixes.py with an available interpreter."
}

$pythonArgs += @($fixer, "--repo", $resolvedRepo)
if ($AllowOtherRevision) {
    $pythonArgs += "--allow-other-revision"
}

switch ($Mode) {
    "Check" {
        # Default behavior is check-only.
    }
    "Patch" {
        if ([string]::IsNullOrWhiteSpace($PatchPath)) {
            $repoParent = Split-Path -Parent $resolvedRepo
            $PatchPath = Join-Path $repoParent "kimi-app-review-fixes.patch"
        }
        $resolvedPatchParent = Split-Path -Parent ([System.IO.Path]::GetFullPath($PatchPath))
        if (-not (Test-Path -LiteralPath $resolvedPatchParent -PathType Container)) {
            New-Item -ItemType Directory -Path $resolvedPatchParent -Force | Out-Null
        }
        $resolvedPatch = [System.IO.Path]::GetFullPath($PatchPath)
        $pythonArgs += @("--patch-output", $resolvedPatch)
    }
    "Write" {
        $pythonArgs += "--write"
    }
}

& $python @pythonArgs
if ($LASTEXITCODE -ne 0) {
    throw "Fixer exited with code $LASTEXITCODE. No GitHub operation was attempted."
}

if ($Mode -eq "Patch") {
    & git -C $resolvedRepo apply --check --whitespace=error $resolvedPatch
    if ($LASTEXITCODE -ne 0) {
        throw "Patch was generated but git apply --check failed: $resolvedPatch"
    }
    Write-Host "Patch validation passed: $resolvedPatch"
    Write-Host "The repository was not modified. Apply it explicitly with:"
    Write-Host "git -C `"$resolvedRepo`" apply `"$resolvedPatch`""
}
