# Quick-launch the Sandrone AI Agent desktop dev build from source.
# Usage: right-click 开发版启动.cmd (or run  .\dev.cmd) — or  pwsh -File dev.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $here 'sandrone-harness')

# This environment (the agent harness) runs under Electron-as-Node; never let
# that leak into the app under test.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

Write-Host 'Starting Sandrone AI Agent (dev)…  Ctrl+R 在应用内重建并刷新界面'
& pnpm run desktop
