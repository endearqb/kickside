param(
  [string]$AppExePath = ".\src-tauri\target\debug\appskimi-shell.exe",
  [int]$Iterations = 5,
  [int]$TimeoutSeconds = 40,
  [int]$BasePortStart = 57700
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-HealthzPort {
  param([int]$Port)
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 1
    return $resp.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Wait-ReadyPort {
  param([int]$StartPort, [int]$Seconds)
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    for ($offset = 0; $offset -lt 10; $offset++) {
      $port = $StartPort + $offset
      if (Test-HealthzPort -Port $port) {
        return $port
      }
    }
    Start-Sleep -Milliseconds 250
  }
  return $null
}

function Assert-PortRangeClosed {
  param([int]$StartPort)
  for ($offset = 0; $offset -lt 10; $offset++) {
    $port = $StartPort + $offset
    if (Test-HealthzPort -Port $port) {
      throw "Port $port still responds after app shutdown."
    }
  }
}

$resolvedExe = (Resolve-Path $AppExePath).Path
if (-not (Test-Path $resolvedExe)) {
  throw "App executable not found: $AppExePath"
}

$oldBasePort = $env:KIMI_SHELL_BASE_PORT

try {
  for ($i = 0; $i -lt $Iterations; $i++) {
    $basePort = $BasePortStart + ($i * 10)
    $env:KIMI_SHELL_BASE_PORT = "$basePort"

    $proc = Start-Process -FilePath $resolvedExe -PassThru
    $readyPort = Wait-ReadyPort -StartPort $basePort -Seconds $TimeoutSeconds
    if ($null -eq $readyPort) {
      throw "Iteration $($i + 1): backend did not become ready in $basePort-$($basePort + 9)."
    }

    $closed = $proc.CloseMainWindow()
    if (-not $proc.WaitForExit(7000)) {
      Stop-Process -Id $proc.Id -Force
    }

    Start-Sleep -Milliseconds 700
    Assert-PortRangeClosed -StartPort $basePort
    Write-Host "Iteration $($i + 1)/$Iterations passed (ready=$readyPort)."
  }
} finally {
  if ($null -eq $oldBasePort) {
    Remove-Item Env:\KIMI_SHELL_BASE_PORT -ErrorAction SilentlyContinue
  } else {
    $env:KIMI_SHELL_BASE_PORT = $oldBasePort
  }
}

Write-Host "Reliability check passed for $Iterations iterations."
