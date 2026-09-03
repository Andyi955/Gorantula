# scanbench: restart the backend, run one real investigation, report the
# per-phase durations measured by the pipeline progress tracker.
#
# Usage: scripts/scanbench.ps1 [-Prompt "the latest AI news"] [-SkipRestart]
param(
    [string]$Prompt = "the latest AI news",
    [switch]$SkipRestart
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$benchDir = Join-Path $repo '.scanbench'
New-Item -ItemType Directory -Force -Path $benchDir | Out-Null

if (-not $SkipRestart) {
    $conn = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $conn | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
            Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 1
    }
    $goExe = (Get-Command go).Source
    Start-Process -FilePath $goExe `
        -ArgumentList "run", "./cmd/gorantula" `
        -WorkingDirectory $repo `
        -RedirectStandardOutput (Join-Path $benchDir "backend.log") `
        -RedirectStandardError (Join-Path $benchDir "backend.err.log") | Out-Null
}

$deadline = (Get-Date).AddSeconds(60)
$up = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:8080/api/investigations" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $up = $true; break }
    } catch {}
}
if (-not $up) { throw "backend failed to start on :8080" }
Write-Host "backend ready - running scan bench..."

Push-Location (Join-Path $repo "frontend")
try {
    node scripts/scanbench.mjs --prompt $Prompt
} finally {
    Pop-Location
}

$issues = Select-String -Path (Join-Path $benchDir "backend.err.log") `
    -Pattern 'level=WARN|level=ERROR' -ErrorAction SilentlyContinue
Write-Host ("backend WARN/ERROR lines this run: " + $issues.Count)

$trace = Join-Path $repo "pipeline-traces\pipeline-trace.jsonl"
if (Test-Path $trace) {
    Write-Host "--- pipeline trace (latest calls) ---"
    Get-Content $trace -Tail 30 | ForEach-Object {
        $r = $_ | ConvertFrom-Json
        $flag = if ($r.error) { " [error]" } else { "" }
        "{0,8}ms  {1}  {2}{3}" -f $r.durationMs, $r.span, $r.provider, $flag
    }
    Write-Host ("full trace: " + $trace)
}
