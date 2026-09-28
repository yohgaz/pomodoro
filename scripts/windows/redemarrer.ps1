# Redémarre Pomodoro (après une mise à jour du code, par exemple).
& (Join-Path $PSScriptRoot 'arreter.ps1')
Start-Sleep 1
Start-Process wscript.exe -ArgumentList ('"' + (Join-Path $PSScriptRoot 'pomodoro-silencieux.vbs') + '"')
Write-Host 'Pomodoro relancé : http://localhost:3210/'
