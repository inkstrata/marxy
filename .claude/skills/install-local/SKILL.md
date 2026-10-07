---
name: install-local
description: Sync main, rebuild the Marxy macOS DMG from origin/main, install it into /Applications and clear the quarantine flag so macOS opens it. Use when asked to rebuild, reinstall or update the local Marxy app.
---

# install-local

Builds the current `origin/main` into a DMG on this Mac and installs it as `/Applications/Marxy.app`.

Run it from anywhere inside the repo:

```bash
bash .claude/skills/install-local/install.sh
```

A cold build takes several minutes (a Rust release build); run it in the background and wait for
the exit. Pass `--no-open` to skip launching the app afterwards.

## What it does

1. **Syncs main.** `git fetch origin`, then fast-forwards the `main` branch of the main checkout, but
   only when that checkout is on `main` with no tracked changes. A checkout mid-story under another
   session is never touched.
2. **Builds in a dedicated worktree**, `~/Dev/marxy-wt/local-build`, detached at `origin/main`, so no
   other worktree or branch is disturbed. `pnpm install --frozen-lockfile`, then
   `vite build` and `tauri build --bundles dmg -- --locked` (the same steps as
   `.github/workflows/release.yml`).
3. **Checks the bundle** with `codesign --verify --deep --strict` before installing; an unsealed bundle
   is killed by macOS on launch (MARXY-350).
4. **Installs.** Quits a running Marxy, replaces `/Applications/Marxy.app` with `ditto`, re-verifies it.
5. **Lets macOS open it.** The build is ad-hoc signed, not notarised, so it removes the quarantine
   attribute (`xattr -dr com.apple.quarantine`), the one-time step the README's Install section
   gives. Nothing else about Gatekeeper is changed.
6. Opens the app.

## Notes

- Apple silicon only, like the release.
- It never touches a signing secret; there is none. Developer ID signing and notarisation would
  replace step 5 once an Apple Developer account exists.
- To install a published release instead of building: `gh release download <tag> -p '*.dmg'`, then
  steps 3 to 6 apply unchanged.
