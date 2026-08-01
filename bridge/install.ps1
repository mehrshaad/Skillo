<#
.SYNOPSIS
    Registers the Skillo native messaging host so the Chrome extension can talk
    to your local Claude Code install.

.DESCRIPTION
    Copies host.mjs into %LOCALAPPDATA%\Skillo, writes a launcher that runs it
    with the Node currently on your PATH, writes the native messaging host
    manifest, and points Chrome at it via HKCU.

.PARAMETER ExtensionId
    The unpacked extension's id. Defaults to Skillo's pinned id; only change it
    if chrome://extensions shows something different.

.PARAMETER Uninstall
    Remove everything this script installed.

.EXAMPLE
    .\install.ps1
    .\install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [string]$ExtensionId = 'hfbincjmdcgfhffnpanjdfcccpejdkei',
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$HostName    = 'com.skillo.bridge'
$InstallDir  = Join-Path $env:LOCALAPPDATA 'Skillo'
$ManifestPath = Join-Path $InstallDir "$HostName.json"
$LauncherPath = Join-Path $InstallDir 'skillo-bridge.bat'
$RegistryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"

if ($Uninstall) {
    if (Test-Path $RegistryPath) {
        Remove-Item -Path $RegistryPath -Recurse -Force
        Write-Host "Removed registry key $RegistryPath"
    }
    if (Test-Path $InstallDir) {
        Remove-Item -Path $InstallDir -Recurse -Force
        Write-Host "Removed $InstallDir"
    }
    Write-Host 'Skillo bridge uninstalled.'
    return
}

# --- Node is required to run the host ---------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw 'Node.js was not found on your PATH. Install Node 18 or newer, then run this script again.'
}
Write-Host "Using Node at $($node.Source)"

# --- Claude Code is what the bridge actually calls ---------------------------
$claude = Get-Command claude -ErrorAction SilentlyContinue
if ($claude) {
    Write-Host "Found claude at $($claude.Source)"
} else {
    Write-Warning 'The claude command was not found on your PATH. The bridge will install, but Skillo cannot use it until Claude Code is installed.'
}

# --- Copy the host ----------------------------------------------------------
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}
Copy-Item -Path (Join-Path $PSScriptRoot 'host.mjs') -Destination $InstallDir -Force
Write-Host "Installed host.mjs to $InstallDir"

# --- Launcher: Chrome needs an executable, not a .mjs ------------------------
@"
@echo off
"$($node.Source)" "%~dp0host.mjs" %*
"@ | Set-Content -Path $LauncherPath -Encoding ASCII
Write-Host "Wrote launcher $LauncherPath"

# --- Native messaging host manifest -----------------------------------------
$manifest = [ordered]@{
    name            = $HostName
    description     = 'Skillo bridge to the local Claude Code CLI'
    path            = $LauncherPath
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifest | ConvertTo-Json -Depth 3 | Set-Content -Path $ManifestPath -Encoding UTF8
Write-Host "Wrote manifest $ManifestPath"

# --- Point Chrome at it -----------------------------------------------------
New-Item -Path $RegistryPath -Force | Out-Null
Set-ItemProperty -Path $RegistryPath -Name '(Default)' -Value $ManifestPath
Write-Host "Registered $RegistryPath"

Write-Host ''
Write-Host 'Skillo bridge installed.' -ForegroundColor Green
Write-Host "Allowed extension: $ExtensionId"
Write-Host 'Next: open Skillo, go to Settings, pick Claude Code, and press Connect.'
Write-Host 'If Chrome was already running, restart it first.'
