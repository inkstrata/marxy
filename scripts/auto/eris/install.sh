#!/bin/bash
# Installs the hourly device check as a launchd agent on this Mac. Safe to run again.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
label=com.inkstrata.marxy-auto
dest="$HOME/Library/LaunchAgents/$label.plist"

mkdir -p "$HOME/.local/state/fleet/marxy/logs" "$HOME/Library/LaunchAgents"
cp "$here/marxy-auto.plist" "$dest"
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$dest"

echo "installed $label (hourly); log: ~/.local/state/fleet/marxy/logs/device.log"
echo "run once now:  node ~/Dev/marxy/scripts/auto/auto.mjs device --force"
echo "remove:        launchctl bootout gui/$(id -u)/$label; rm $dest"
