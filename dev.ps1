# Quick-launch the Sandrone AI Agent desktop dev build from source.
# Usage: double-click dev.cmd (or run  pwsh -File dev.ps1)
# NOTE: keep this file ASCII-only - Windows PowerShell 5.1 reads it as the
# system ANSI codepage and non-ASCII bytes break string parsing.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $here 'sandrone-harness')

# This environment (the agent harness) runs under Electron-as-Node; never let
# that leak into the app under test.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# Isolated user data passed as --user-data-dir: on Windows Electron resolves
# userData through the shell known-folders (not the APPDATA env var), and the
# single-instance lock is keyed by userData. This lets the dev build run
# alongside the installed app without touching the real profile.
$devData = Join-Path $here 'sandrone-harness\runtime\dev-data'
New-Item -ItemType Directory -Force -Path $devData | Out-Null

Write-Host 'Starting Sandrone AI Agent (dev)... Ctrl+R rebuilds and reloads inside the app'
& pnpm run build:ui
& .\node_modules\electron\dist\electron.exe .\apps\desktop\main.cjs "--user-data-dir=$devData"
