' Lance le serveur Pomodoro sans fenêtre et le relance s'il s'arrête.
' Installé dans le dossier Démarrage de Windows par installer-demarrage.ps1.
' Journal : logs\server.log dans le dossier du projet.
Option Explicit
Dim sh, fso, root, code
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
If Not fso.FolderExists(root & "\logs") Then fso.CreateFolder(root & "\logs")
Do
    code = sh.Run("cmd /c cd /d """ & root & """ && node server.js >> logs\server.log 2>&1", 0, True)
    ' 3 = un serveur Pomodoro tourne déjà : inutile d'insister.
    If code = 3 Then Exit Do
    WScript.Sleep 5000
Loop
