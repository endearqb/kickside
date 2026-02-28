param(
  [string]$AppExePath = ".\src-tauri\target\debug\appskimi-shell.exe",
  [int]$BasePort = 57639,
  [int]$TimeoutSeconds = 40
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

$resolvedExe = (Resolve-Path $AppExePath).Path
if (-not (Test-Path $resolvedExe)) {
  throw "App executable not found: $AppExePath"
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $BasePort)
$proc = $null
$oldBasePort = $env:KIMI_SHELL_BASE_PORT

try {
  $listener.Start()
  $env:KIMI_SHELL_BASE_PORT = "$BasePort"

  $proc = Start-Process -FilePath $resolvedExe -PassThru
  $readyPort = Wait-ReadyPort -StartPort $BasePort -Seconds $TimeoutSeconds
  if ($null -eq $readyPort) {
    throw "Timed out waiting for backend ready port in range $BasePort-$($BasePort + 9)."
  }
  if ($readyPort -eq $BasePort) {
    throw "Port conflict recovery failed. backend ready on occupied base port $BasePort."
  }

  Write-Host "Port conflict recovery passed. base=$BasePort active=$readyPort"
} finally {
  if ($null -ne $proc -and -not $proc.HasExited) {
    $closed = $proc.CloseMainWindow()
    if (-not $proc.WaitForExit(5000)) {
      Stop-Process -Id $proc.Id -Force
    }
  }
  if ($null -ne $listener) {
    $listener.Stop()
  }

  if ($null -eq $oldBasePort) {
    Remove-Item Env:\KIMI_SHELL_BASE_PORT -ErrorAction SilentlyContinue
  } else {
    $env:KIMI_SHELL_BASE_PORT = $oldBasePort
  }
}
