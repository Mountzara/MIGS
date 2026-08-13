#!/usr/bin/env bash
# =====================================================================
# install_bridge_launchd.sh — run the AI bridge automatically, forever
# =====================================================================
# WHY
# The bridge is what completes queued AI work: triage decisions, message
# drafts, after-visit summaries, enrolment document reads. If nobody
# starts it, that work sits in the queue and a patient who finished a
# nineteen-section intake cannot book an appointment.
#
# "Remember to run a script" is not an operating model for a solo
# practice. This installs it as a launchd agent so it starts at login,
# restarts if it dies, and needs no thought afterwards.
#
# USAGE
#   AI_BRIDGE_TOKEN='...' ./scripts/install_bridge_launchd.sh
#   ./scripts/install_bridge_launchd.sh --uninstall
#
# CHECK IT IS RUNNING
#   launchctl list | grep mountzara
#   tail -f ~/Library/Logs/mountzara-bridge.log
# =====================================================================
set -euo pipefail

LABEL="com.mountzara.aibridge"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$HOME/Library/Logs/mountzara-bridge.log"

if [ "${1:-}" = "--uninstall" ]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Uninstalled. The bridge will no longer start automatically."
    exit 0
fi

if [ -z "${AI_BRIDGE_TOKEN:-}" ]; then
    echo "ERROR: AI_BRIDGE_TOKEN is not set." >&2
    echo "  AI_BRIDGE_TOKEN='...' $0" >&2
    exit 1
fi
command -v claude >/dev/null || { echo "ERROR: the 'claude' CLI is not on PATH." >&2; exit 1; }
command -v jq     >/dev/null || { echo "ERROR: jq is required (brew install jq)." >&2; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"

# KeepAlive restarts it if it exits for any reason; RunAtLoad starts it at
# login. PATH is set explicitly because launchd agents do not inherit a
# login shell's PATH, which is the usual reason a working script fails
# only under launchd.
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${REPO}/scripts/claude_bridge.sh</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>AI_BRIDGE_TOKEN</key><string>${AI_BRIDGE_TOKEN}</string>
        <key>MZ_BRIDGE_ID</key><string>$(hostname -s)</string>
        <key>MZ_BRIDGE_POLL</key><string>30</string>
        <key>PATH</key><string>$(dirname "$(command -v claude)"):$(dirname "$(command -v jq)"):/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ThrottleInterval</key><integer>30</integer>
    <key>StandardOutPath</key><string>${LOG}</string>
    <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
PLIST_EOF

chmod 600 "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Installed. The bridge now starts at login and restarts if it dies."
echo "  status : launchctl list | grep mountzara"
echo "  log    : tail -f $LOG"
echo "  remove : $0 --uninstall"
