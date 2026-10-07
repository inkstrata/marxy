#!/usr/bin/env bash
# Sync main, build the macOS DMG from origin/main, install it, clear quarantine. See SKILL.md.
set -euo pipefail

open_after=1
[ "${1:-}" = "--no-open" ] && open_after=0

root="$(git rev-parse --path-format=absolute --git-common-dir)"
root="$(cd "$root/.." && pwd)"
wt="$HOME/Dev/marxy-wt/local-build"
app="/Applications/Marxy.app"

echo "==> sync main"
git -C "$root" fetch --quiet origin
if [ "$(git -C "$root" branch --show-current)" = main ] \
  && [ -z "$(git -C "$root" status --porcelain --untracked-files=no)" ]; then
  git -C "$root" merge --ff-only --quiet origin/main
  echo "main checkout fast-forwarded to $(git -C "$root" rev-parse --short HEAD)"
else
  echo "main checkout is busy or not on main; left alone"
fi

echo "==> build origin/main in $wt"
if [ -d "$wt" ]; then
  git -C "$wt" checkout --quiet --force --detach origin/main
else
  git -C "$root" worktree add --quiet --detach "$wt" origin/main
fi
cd "$wt"
echo "building $(git rev-parse --short HEAD)"
pnpm install --frozen-lockfile
rm -rf apps/desktop/src-tauri/target/release/bundle/dmg
pnpm --filter @marxy/desktop build:web
pnpm --filter @marxy/desktop exec tauri build --bundles dmg -- --locked

dmg="$(ls apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg | head -n 1)"
echo "==> install $dmg"
mnt="$(mktemp -d)"
trap 'hdiutil detach "$mnt" >/dev/null 2>&1 || true' EXIT
hdiutil attach -nobrowse -readonly -mountpoint "$mnt" "$dmg" >/dev/null
codesign --verify --deep --strict "$mnt/Marxy.app"

osascript -e 'tell application "Marxy" to quit' >/dev/null 2>&1 || true
sleep 1
rm -rf "$app"
ditto "$mnt/Marxy.app" "$app"

echo "==> clear quarantine (ad-hoc signed, not notarised)"
xattr -dr com.apple.quarantine "$app" 2>/dev/null || true
codesign --verify --deep --strict "$app"
echo "installed $app"

[ "$open_after" = 1 ] && open "$app"
exit 0
