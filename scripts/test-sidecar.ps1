$errLog = "$env:TEMP\vite_sidecar_test.log"
$proc = Start-Process npm -ArgumentList "run","dev" -PassThru -RedirectStandardError $errLog -WindowStyle Hidden
Start-Sleep 6
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:5173/api/sidecar/health" -TimeoutSec 5
    $resp.Content
} catch {
    $_.Exception.Message
}
if ($proc -and -not $proc.HasExited) {
    Stop-Process $proc.Id -Force -ErrorAction SilentlyContinue
}
if (Test-Path $errLog) {
    Get-Content $errLog -ErrorAction SilentlyContinue | Select-Object -First 15
}