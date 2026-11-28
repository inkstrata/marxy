#!/bin/bash
# Installs the hourly device check as a systemd user timer on Set. Safe to run again.
# The Linux check downloads CI's AppImage, so there is no build and no pnpm install.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
units="$HOME/.config/systemd/user"

if [ ! -d "$HOME/Dev/marxy/.git" ]; then
  mkdir -p "$HOME/Dev"
  git clone https://github.com/inkstrata/marxy.git "$HOME/Dev/marxy"
fi

mkdir -p "$units" "$HOME/.local/state/fleet/marxy/logs"
cp "$here/marxy-auto.service" "$here/marxy-auto.timer" "$units/"
systemctl --user daemon-reload
systemctl --user enable --now marxy-auto.timer

# The service runs under a login shell, so check what that shell can see.
for tool in node gh; do
  if ! /bin/bash -lc "command -v $tool" >/dev/null 2>&1; then
    echo "missing on the login PATH: $tool"
  fi
done
/bin/bash -lc 'gh auth status' >/dev/null 2>&1 || echo "gh is not signed in: run gh auth login"

echo "installed marxy-auto.timer (hourly); logs: journalctl --user -u marxy-auto"
echo "run once now:  node ~/Dev/marxy/scripts/auto/auto.mjs device --force"
echo "remove:        systemctl --user disable --now marxy-auto.timer; rm $units/marxy-auto.service $units/marxy-auto.timer"
