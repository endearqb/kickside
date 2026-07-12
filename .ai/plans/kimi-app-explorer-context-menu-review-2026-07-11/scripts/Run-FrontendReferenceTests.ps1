[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root 'proposed\frontend'
Push-Location $frontend
try {
    if (Test-Path dist) { Remove-Item -Recurse -Force dist }
    tsc -p tsconfig.json
    node --test workspacePaneShelfCore.test.mjs
} finally {
    Pop-Location
}
