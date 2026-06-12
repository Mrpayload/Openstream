$ErrorActionPreference = "Stop"

$handlerPath = Join-Path $PSScriptRoot "vlc-protocol-handler.ps1"
if (-not (Test-Path -LiteralPath $handlerPath)) {
  throw "Missing VLC protocol handler: $handlerPath"
}

$baseKey = "HKCU:\Software\Classes\vlc"
$commandKey = Join-Path $baseKey "shell\open\command"
$defaultIconKey = Join-Path $baseKey "DefaultIcon"

New-Item -Path $baseKey -Force | Out-Null
Set-Item -Path $baseKey -Value "URL:VLC Protocol"
New-ItemProperty -Path $baseKey -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null

New-Item -Path $defaultIconKey -Force | Out-Null
Set-Item -Path $defaultIconKey -Value "C:\Program Files\VideoLAN\VLC\vlc.exe,0"

New-Item -Path $commandKey -Force | Out-Null
$command = "`"powershell.exe`" -NoProfile -ExecutionPolicy Bypass -File `"$handlerPath`" `"%1`""
Set-Item -Path $commandKey -Value $command

Write-Host "Registered vlc:// protocol handler for current user."
