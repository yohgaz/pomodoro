# Arrête Pomodoro sur Windows : d'abord le lanceur (sinon il relance le
# serveur), puis la console « cd /d …\Pomodoro && node server.js » et son node.
# Les processus sont reconnus à leur ligne de commande, pas au port :
# Get-NetTCPConnection ne voit pas toujours les serveurs Node sur ce PC.
# Le serveur du stream (autre dossier) n'est jamais touché.
$racine = Split-Path (Split-Path $PSScriptRoot)
$arretes = 0
$procs = Get-CimInstance Win32_Process
foreach ($p in $procs | Where-Object { $_.Name -eq 'wscript.exe' -and $_.CommandLine -like '*pomodoro-silencieux.vbs*' }) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $arretes++
}
$consoles = $procs | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -like "*$racine*" -and $_.CommandLine -like '*node server.js*' }
foreach ($c in $consoles) {
    foreach ($n in $procs | Where-Object { $_.Name -eq 'node.exe' -and $_.ParentProcessId -eq $c.ProcessId }) {
        Stop-Process -Id $n.ProcessId -Force -ErrorAction SilentlyContinue; $arretes++
    }
    Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue
}
if ($arretes) { Write-Host 'Pomodoro arrêté.' } else { Write-Host 'Pomodoro ne tournait pas.' }
