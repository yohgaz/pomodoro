#!/bin/bash
# Installe Pomodoro comme service utilisateur macOS (LaunchAgent) : démarrage
# automatique à l'ouverture de session et relance en cas de plantage.
# Usage : ./scripts/mac/installer.sh   (à relancer sans risque)
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="com.yohgaz.pomodoro"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node || true)"

if [ -z "$NODE" ]; then
    echo "❌ Node.js introuvable. Installe-le (https://nodejs.org ou « brew install node ») puis relance ce script."
    exit 1
fi
if ! command -v git >/dev/null; then
    echo "❌ git introuvable. Lance « xcode-select --install » puis relance ce script."
    exit 1
fi

cd "$ROOT"
[ -d node_modules/tmi.js ] || npm install --omit=dev
mkdir -p "$ROOT/logs" "$HOME/Library/LaunchAgents"

# Ancien service éventuel (même label) : arrêté proprement avant de réécrire.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE</string>
        <string>$ROOT/server.js</string>
    </array>
    <key>WorkingDirectory</key><string>$ROOT</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key><false/>
    </dict>
    <key>ThrottleInterval</key><integer>10</integer>
    <key>StandardOutPath</key><string>$ROOT/logs/server.log</string>
    <key>StandardErrorPath</key><string>$ROOT/logs/server.log</string>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 3
if curl -s http://localhost:3210/api/state >/dev/null; then
    echo "✅ Pomodoro tourne : http://localhost:3210/"
    open "http://localhost:3210/" 2>/dev/null || true
else
    echo "⏳ Le serveur démarre… si la page ne s'ouvre pas, regarde $ROOT/logs/server.log"
fi
