# Ingest every test paper JSON in this folder into the running research engine.
# Requires the Go backend to be listening on :8080.
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8080'
$dir = $PSScriptRoot

$papers = @()
Get-ChildItem -Path $dir -Filter '*.json' | Where-Object { $_.Name -notmatch '^_' } | ForEach-Object {
    $papers += (Get-Content $_.FullName -Raw | ConvertFrom-Json)
}

if ($papers.Count -eq 0) {
    Write-Host 'No paper JSON files found in this folder.'
    exit 0
}

$body = @{ papers = @($papers) } | ConvertTo-Json -Depth 12
$response = Invoke-WebRequest -Uri "$base/api/research/ingest" -Method Post -Body $body -ContentType 'application/json' -UseBasicParsing
$result = $response.Content | ConvertFrom-Json
Write-Host "Ingested $($papers.Count) paper(s) -> HTTP $($response.StatusCode)"
Write-Host "Extracted $($result.claims.Count) claim(s)."
