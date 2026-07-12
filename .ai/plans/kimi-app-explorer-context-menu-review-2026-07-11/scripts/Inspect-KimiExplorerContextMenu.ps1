[CmdletBinding()]
param(
    [string]$ExpectedExecutable,
    [switch]$AsJson,
    [switch]$NotifyShell
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$base = 'Registry::HKEY_CURRENT_USER\Software\Classes'
$definitions = @(
    @{ Scope='Directory background'; Key='Directory\Background\shell\KimiWebShell'; ExpectedFlag='--open-dir'; Overlap=$false },
    @{ Scope='Directory'; Key='Directory\shell\KimiWebShell'; ExpectedFlag='--open-dir'; Overlap=$false },
    @{ Scope='All files'; Key='*\shell\KimiWebShell'; ExpectedFlag='--open-files'; Overlap=$false },
    @{ Scope='All filesystem objects'; Key='AllFilesystemObjects\shell\KimiWebShell'; ExpectedFlag='--open-files'; Overlap=$true },
    @{ Scope='Directory import parent'; Key='Directory\shell\MoveToWorkspace'; ExpectedFlag=$null; Overlap=$false },
    @{ Scope='File import parent'; Key='*\shell\MoveToWorkspace'; ExpectedFlag=$null; Overlap=$false },
    @{ Scope='All-object import parent'; Key='AllFilesystemObjects\shell\MoveToWorkspace'; ExpectedFlag=$null; Overlap=$true }
)

function Read-DefaultValue([string]$Path) {
    try {
        return (Get-Item -LiteralPath $Path).GetValue('')
    } catch {
        return $null
    }
}

function Normalize-Executable([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
    try { return [IO.Path]::GetFullPath($Path).Trim().ToLowerInvariant() }
    catch { return $Path.Trim().ToLowerInvariant() }
}

$expectedExeNormalized = Normalize-Executable $ExpectedExecutable
$rows = foreach ($definition in $definitions) {
    $path = Join-Path $base $definition.Key
    $commandPath = Join-Path $path 'command'
    $exists = Test-Path -LiteralPath $path
    $properties = if ($exists) { Get-ItemProperty -LiteralPath $path } else { $null }
    $command = if (Test-Path -LiteralPath $commandPath) { [string](Read-DefaultValue $commandPath) } else { $null }
    $commandExe = if ($command -match '^\s*"([^"]+)"') { $Matches[1] } else { $null }
    $commandExeNormalized = Normalize-Executable $commandExe

    $issues = [Collections.Generic.List[string]]::new()
    if (-not $exists) {
        $issues.Add('missing')
    } else {
        if ([string]::IsNullOrWhiteSpace([string]$properties.MUIVerb)) { $issues.Add('missing MUIVerb') }
        if ($definition.ExpectedFlag -and [string]::IsNullOrWhiteSpace($command)) { $issues.Add('missing command') }
        if ($definition.ExpectedFlag -and $command -notlike "*$($definition.ExpectedFlag)*") {
            $issues.Add("command does not contain $($definition.ExpectedFlag)")
        }
        if ($expectedExeNormalized -and $commandExeNormalized -and $commandExeNormalized -ne $expectedExeNormalized) {
            $issues.Add('command points to another executable')
        }
        if ($definition.Overlap) {
            $issues.Add('overlapping generic association; recommend removing')
        }
    }

    [pscustomobject]@{
        Scope = $definition.Scope
        RegistryKey = "HKCU\Software\Classes\$($definition.Key)"
        Exists = $exists
        Label = if ($properties) { [string]$properties.MUIVerb } else { $null }
        MultiSelectModel = if ($properties) { [string]$properties.MultiSelectModel } else { $null }
        Command = $command
        Issues = ($issues -join '; ')
    }
}

if ($NotifyShell) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShellAssociationNotifier {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
}
'@
    [ShellAssociationNotifier]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
}

if ($AsJson) {
    $rows | ConvertTo-Json -Depth 5
} else {
    $rows | Format-Table Scope, Exists, Label, MultiSelectModel, Issues -AutoSize
    ''
    'Commands:'
    $rows | Where-Object Command | Format-List Scope, RegistryKey, Command
}
