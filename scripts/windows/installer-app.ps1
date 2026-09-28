# Compile l'app Windows native (dossier windows\Pomodoro.Desktop) dans
# app-windows\Pomodoro.exe et crée les raccourcis Menu Démarrer + Bureau.
# À relancer après une mise à jour du code (git pull). Nécessite le SDK .NET 8.
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot)
$out = Join-Path $root 'app-windows'

# L'exe est verrouillé tant que l'app tourne : on la ferme d'abord.
Get-Process Pomodoro -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

dotnet publish (Join-Path $root 'windows\Pomodoro.Desktop') -c Release -r win-x64 --self-contained false `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=none -p:GenerateDocumentationFile=false `
    -o $out -nologo -v q
if ($LASTEXITCODE -ne 0) { throw 'La compilation a échoué.' }
Get-ChildItem $out -Include *.xml, *.pdb -Recurse | Remove-Item -Force

$exe = Join-Path $out 'Pomodoro.exe'
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
    $s = $shell.CreateShortcut((Join-Path $dir 'Pomodoro.lnk'))
    $s.TargetPath = $exe
    $s.WorkingDirectory = $out
    $s.IconLocation = "$exe,0"
    $s.Description = 'Pomodoro — notes IPARA et tâches du stream'
    $s.Save()
}
Write-Host "App installée : $exe"
Write-Host 'Raccourcis créés dans le Menu Démarrer et sur le Bureau.'
Start-Process $exe
