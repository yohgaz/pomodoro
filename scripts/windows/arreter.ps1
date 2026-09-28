# Arrête Pomodoro sur Windows : d'abord le lanceur (sinon il relance le
# serveur), puis le serveur. La dernière synchro n'a pas lieu en cas d'arrêt
# forcé, mais les données sont déjà sur le disque et partiront au prochain
# démarrage.
Get-CimInstance Win32_Process -Filter "Name = 'wscript.exe'" |
    Where-Object { $_.CommandLine -like '*pomodoro-silencieux.vbs*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$conn = Get-NetTCPConnection -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force; Write-Host 'Pomodoro arrêté.' } else { Write-Host 'Pomodoro ne tournait pas.' }
