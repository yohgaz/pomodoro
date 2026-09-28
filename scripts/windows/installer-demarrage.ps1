# Installe le démarrage automatique de Pomodoro à l'ouverture de session Windows
# et le lance tout de suite. À relancer sans risque (remplace l'existant).
$ErrorActionPreference = 'Stop'
$vbs = Join-Path $PSScriptRoot 'pomodoro-silencieux.vbs'
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Pomodoro.lnk'

$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = 'wscript.exe'
$s.Arguments = '"' + $vbs + '"'
$s.WorkingDirectory = Split-Path (Split-Path $PSScriptRoot)
$s.Description = 'Serveur Pomodoro (notes + liste de tâches du stream)'
$s.Save()
Write-Host "Raccourci de démarrage créé : $lnk"

& (Join-Path $PSScriptRoot 'arreter.ps1') | Out-Null
Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"')
Start-Sleep 3
try {
    $r = Invoke-RestMethod http://localhost:3210/api/state -TimeoutSec 5
    Write-Host "Pomodoro tourne : http://localhost:3210/ (machine « $($r.config.machineName) »)"
} catch { Write-Host "Le serveur démarre… consulte logs\server.log si la page ne s'ouvre pas." }
