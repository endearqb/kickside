[CmdletBinding()]
param(
    [Parameter(Position = 0, Mandatory = $true)]
    [ValidateSet('status', 'list-sessions', 'switch-session', 'restart')]
    [string]$Action,

    [Parameter()]
    [Alias('auth-file')]
    [string]$AuthFile,

    [Parameter()]
    [string]$Platform,

    [Parameter()]
    [Alias('chat-id')]
    [string]$ChatId,

    [Parameter()]
    [Alias('thread-id')]
    [string]$ThreadId,

    [Parameter()]
    [string]$Target
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-JsonResult {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Payload,
        [int]$ExitCode = 0
    )

    $Payload.action = $Action
    $Payload | ConvertTo-Json -Depth 8 -Compress:$false
    exit $ExitCode
}

function Normalize-Text {
    param([string]$Value)
    if ($null -eq $Value) {
        return ''
    }
    return $Value.Trim()
}

function Get-OptionalTextProperty {
    param(
        [Parameter(Mandatory = $true)]
        $InputObject,

        [Parameter(Mandatory = $true)]
        [string]$PropertyName
    )

    if ($null -eq $InputObject) {
        return ''
    }

    $property = $InputObject.PSObject.Properties.Match($PropertyName) | Select-Object -First 1
    if ($null -eq $property) {
        return ''
    }

    return Normalize-Text ([string]$property.Value)
}

function Get-DefaultBridgeAuthCandidates {
    $candidates = New-Object System.Collections.Generic.List[string]
    foreach ($base in @($env:APPDATA, $env:LOCALAPPDATA)) {
        $root = Normalize-Text $base
        if ([string]::IsNullOrWhiteSpace($root)) {
            continue
        }
        $candidates.Add((Join-Path $root 'com.kimi.shell\bridge_skill_auth.json'))
    }
    return @($candidates | Select-Object -Unique)
}

function Resolve-BridgeAuthPath {
    $explicitPath = Normalize-Text $AuthFile
    if (-not [string]::IsNullOrWhiteSpace($explicitPath)) {
        if (-not (Test-Path -LiteralPath $explicitPath)) {
            throw "Bridge auth file does not exist: $explicitPath"
        }
        return $explicitPath
    }

    $envPath = Normalize-Text $env:KIMI_BRIDGE_AUTH_FILE
    if (-not [string]::IsNullOrWhiteSpace($envPath) -and (Test-Path -LiteralPath $envPath)) {
        return $envPath
    }

    foreach ($candidate in Get-DefaultBridgeAuthCandidates) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    $checked = @()
    if (-not [string]::IsNullOrWhiteSpace($envPath)) {
        $checked += $envPath
    }
    $checked += @(Get-DefaultBridgeAuthCandidates)
    $checked = @($checked | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    if ($checked.Count -gt 0) {
        throw ('Bridge auth file was not found. Provide --auth-file, set KIMI_BRIDGE_AUTH_FILE, or ensure one of these paths exists: {0}' -f ($checked -join ', '))
    }
    throw 'Bridge auth file was not found. Provide --auth-file or set KIMI_BRIDGE_AUTH_FILE.'
}

function Read-BridgeAuth {
    $authPath = Resolve-BridgeAuthPath
    if (-not (Test-Path -LiteralPath $authPath)) {
        throw "Bridge auth file does not exist: $authPath"
    }

    $raw = Get-Content -LiteralPath $authPath -Raw
    $auth = $raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace((Normalize-Text $auth.admin_base_url))) {
        throw 'Bridge auth file is missing admin_base_url.'
    }
    if ([string]::IsNullOrWhiteSpace((Normalize-Text $auth.admin_token))) {
        throw 'Bridge auth file is missing admin_token.'
    }
    return $auth
}

function Invoke-BridgeAdmin {
    param(
        [Parameter(Mandatory = $true)]
        $Auth,

        [Parameter(Mandatory = $true)]
        [string]$Method,

        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter()]
        $Body
    )

    $headers = @{
        'X-Bridge-Admin-Token' = (Normalize-Text $Auth.admin_token)
    }
    $params = @{
        Method      = $Method
        Uri         = ('{0}{1}' -f (Normalize-Text $Auth.admin_base_url).TrimEnd('/'), $Path)
        Headers     = $headers
        ContentType = 'application/json'
    }
    if ($PSBoundParameters.ContainsKey('Body') -and $null -ne $Body) {
        $params.Body = ($Body | ConvertTo-Json -Depth 8)
    }

    return Invoke-RestMethod @params
}

function Invoke-BridgeRestart {
    param(
        [Parameter(Mandatory = $true)]
        $Auth
    )

    $hostUrl = Normalize-Text $Auth.host_control_url
    $hostToken = Normalize-Text $Auth.host_control_token
    if ([string]::IsNullOrWhiteSpace($hostUrl) -or [string]::IsNullOrWhiteSpace($hostToken)) {
        throw 'Bridge host control is not available in the auth file.'
    }

    Invoke-RestMethod -Method Post -Uri ($hostUrl.TrimEnd('/') + '/api/v1/bridge/restart') -Headers @{
        'X-Bridge-Host-Token' = $hostToken
    } | Out-Null
}

function Find-Binding {
    param(
        [Parameter(Mandatory = $true)]
        [array]$Bindings,

        [Parameter(Mandatory = $true)]
        [string]$Platform,

        [Parameter(Mandatory = $true)]
        [string]$ChatId,

        [Parameter()]
        [string]$ThreadId
    )

    $normalizedThreadId = Normalize-Text $ThreadId
    return $Bindings | Where-Object {
        (Normalize-Text $_.platform) -eq (Normalize-Text $Platform) -and
        (Normalize-Text $_.chatId) -eq (Normalize-Text $ChatId) -and
        (Normalize-Text $_.threadId) -eq $normalizedThreadId
    } | Select-Object -First 1
}

function Find-SessionCandidates {
    param(
        [Parameter(Mandatory = $true)]
        [array]$Sessions,

        [Parameter(Mandatory = $true)]
        [string]$Target
    )

    $needle = Normalize-Text $Target
    if ([string]::IsNullOrWhiteSpace($needle)) {
        return @()
    }

    $exact = @($Sessions | Where-Object {
        (Normalize-Text $_.kimiSessionId) -eq $needle
    })
    if ($exact.Count -gt 0) {
        return $exact
    }

    $lowerNeedle = $needle.ToLowerInvariant()
    return @($Sessions | Where-Object {
        $sessionId = (Normalize-Text $_.kimiSessionId).ToLowerInvariant()
        $summary = (Get-OptionalTextProperty -InputObject $_ -PropertyName 'summary').ToLowerInvariant()
        $workDir = (Get-OptionalTextProperty -InputObject $_ -PropertyName 'workDir').ToLowerInvariant()
        $sessionId.StartsWith($lowerNeedle) -or
        $summary.Contains($lowerNeedle) -or
        $workDir.Contains($lowerNeedle)
    })
}

try {
    $auth = Read-BridgeAuth
    $status = Invoke-BridgeAdmin -Auth $auth -Method Get -Path '/api/v1/status'
    $sessionsResponse = Invoke-BridgeAdmin -Auth $auth -Method Get -Path '/api/v1/sessions'
    $sessions = @($sessionsResponse.items)

    switch ($Action) {
        'status' {
            $bindings = @()
            $binding = $null
            $currentSession = $null
            if (-not [string]::IsNullOrWhiteSpace((Normalize-Text $Platform)) -and -not [string]::IsNullOrWhiteSpace((Normalize-Text $ChatId))) {
                $bindingsResponse = Invoke-BridgeAdmin -Auth $auth -Method Get -Path '/api/v1/bindings'
                $bindings = @($bindingsResponse.items)
                $binding = Find-Binding -Bindings $bindings -Platform $Platform -ChatId $ChatId -ThreadId $ThreadId
                if ($null -ne $binding) {
                    $currentSession = $sessions | Where-Object {
                        (Normalize-Text $_.kimiSessionId) -eq (Normalize-Text $binding.kimiSessionId)
                    } | Select-Object -First 1
                }
            }

            Write-JsonResult @{
                ok = $true
                message = 'bridge status loaded'
                bridge_state = $status.state
                bridge_started_at = $status.startedAt
                binding = $binding
                session = $currentSession
                channels = @($status.channels)
                bindings = $status.bindings
                pending_approvals = $status.pendingApprovals
            }
        }
        'list-sessions' {
            $bindings = @()
            $currentBinding = $null
            $currentSessionId = ''
            if (-not [string]::IsNullOrWhiteSpace((Normalize-Text $Platform)) -and -not [string]::IsNullOrWhiteSpace((Normalize-Text $ChatId))) {
                $bindingsResponse = Invoke-BridgeAdmin -Auth $auth -Method Get -Path '/api/v1/bindings'
                $bindings = @($bindingsResponse.items)
                $currentBinding = Find-Binding -Bindings $bindings -Platform $Platform -ChatId $ChatId -ThreadId $ThreadId
                if ($null -ne $currentBinding) {
                    $currentSessionId = Normalize-Text $currentBinding.kimiSessionId
                }
            }

            $items = @($sessions | ForEach-Object {
                @{
                    kimi_session_id = $_.kimiSessionId
                    summary = Get-OptionalTextProperty -InputObject $_ -PropertyName 'summary'
                    work_dir = Get-OptionalTextProperty -InputObject $_ -PropertyName 'workDir'
                    session_state = Get-OptionalTextProperty -InputObject $_ -PropertyName 'sessionState'
                    current = ((Normalize-Text $_.kimiSessionId) -eq $currentSessionId)
                }
            })

            Write-JsonResult @{
                ok = $true
                message = 'bridge sessions loaded'
                current_session_id = $currentSessionId
                items = $items
            }
        }
        'switch-session' {
            $platformValue = Normalize-Text $Platform
            $chatValue = Normalize-Text $ChatId
            if ([string]::IsNullOrWhiteSpace($platformValue) -or [string]::IsNullOrWhiteSpace($chatValue)) {
                throw 'switch-session requires --platform and --chat-id.'
            }
            $bindingsResponse = Invoke-BridgeAdmin -Auth $auth -Method Get -Path '/api/v1/bindings'
            $bindings = @($bindingsResponse.items)
            $binding = Find-Binding -Bindings $bindings -Platform $platformValue -ChatId $chatValue -ThreadId $ThreadId
            if ($null -eq $binding) {
                throw 'No binding matched the provided platform/chat/thread.'
            }

            $candidates = Find-SessionCandidates -Sessions $sessions -Target $Target
            if ($candidates.Count -eq 0) {
                Write-JsonResult @{
                    ok = $false
                    code = 'session_not_found'
                    message = 'No matching session was found.'
                } 1
            }
            if ($candidates.Count -gt 1) {
                Write-JsonResult @{
                    ok = $false
                    code = 'session_ambiguous'
                    message = 'Multiple sessions matched the target.'
                    candidates = @($candidates | ForEach-Object {
                        @{
                            kimi_session_id = $_.kimiSessionId
                            summary = Get-OptionalTextProperty -InputObject $_ -PropertyName 'summary'
                            work_dir = Get-OptionalTextProperty -InputObject $_ -PropertyName 'workDir'
                        }
                    })
                } 1
            }

            $targetSession = $candidates[0]
            $workDir = Normalize-Text $binding.workDir
            if ([string]::IsNullOrWhiteSpace($workDir)) {
                $workDir = Get-OptionalTextProperty -InputObject $targetSession -PropertyName 'workDir'
            }
            $body = @{
                kimiSessionId = $targetSession.kimiSessionId
            }
            if (-not [string]::IsNullOrWhiteSpace($workDir)) {
                $body.workDir = $workDir
            }
            Invoke-BridgeAdmin -Auth $auth -Method Patch -Path ('/api/v1/bindings/' + $binding.bindingId) -Body $body | Out-Null

            Write-JsonResult @{
                ok = $true
                message = 'binding session switched'
                binding_id = $binding.bindingId
                previous_session_id = $binding.kimiSessionId
                current_session_id = $targetSession.kimiSessionId
                work_dir = $workDir
            }
        }
        'restart' {
            Invoke-BridgeRestart -Auth $auth
            Write-JsonResult @{
                ok = $true
                message = 'bridge restart requested'
                next_state = 'restarting'
            }
        }
    }
}
catch {
    Write-JsonResult @{
        ok = $false
        message = $_.Exception.Message
    } 1
}
