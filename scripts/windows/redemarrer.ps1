# Redémarre Pomodoro (après une mise à jour du code, par exemple), sans
# fenêtre et SANS dépendre du programme qui lance ce script : le lanceur passe
# par une tâche TEMPORAIRE du Planificateur de tâches (supprimée aussitôt), ce
# qui donne au serveur le même parent qu'au démarrage du PC. Un simple
# Start-Process depuis un terminal en ferait un enfant de ce terminal, arrêté
# avec lui.
$ErrorActionPreference = 'Stop'
$vbs = Join-Path $PSScriptRoot 'pomodoro-silencieux.vbs'
$nomTache = 'RelancePomodoroTemp'

function Test-Pomodoro {
    try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri 'http://localhost:3210/api/state').StatusCode -eq 200 } catch { return $false }
}

& (Join-Path $PSScriptRoot 'arreter.ps1')
Start-Sleep -Seconds 2
if (Test-Pomodoro) { Write-Host ' !! Pomodoro répond encore sur le port 3210 : arrêt impossible.'; exit 1 }

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}"' -f $vbs)
$reglages = New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $nomTache -Action $action -Settings $reglages -Force | Out-Null
try {
    Start-ScheduledTask -TaskName $nomTache
    $ok = $false
    for ($i = 0; $i -lt 30 -and -not $ok; $i++) { Start-Sleep -Seconds 1; $ok = Test-Pomodoro }
} finally {
    Unregister-ScheduledTask -TaskName $nomTache -Confirm:$false -ErrorAction SilentlyContinue
}
if ($ok) { Write-Host 'Pomodoro relancé : http://localhost:3210/' } else { Write-Host ' !! Pomodoro ne répond pas après 30 s : regarder logs\server.log'; exit 1 }
