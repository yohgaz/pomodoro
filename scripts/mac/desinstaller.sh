#!/bin/bash
# Retire le démarrage automatique de Pomodoro (les données ne sont pas touchées).
LABEL="com.yohgaz.pomodoro"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Pomodoro ne démarrera plus automatiquement."
