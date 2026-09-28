#!/bin/bash
# Redémarre le service Pomodoro (après une mise à jour du code).
launchctl kickstart -k "gui/$(id -u)/com.yohgaz.pomodoro" && echo "✅ Pomodoro relancé : http://localhost:3210/"
