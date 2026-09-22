---
key: MARXY-185
design: []
depends: [MARXY-16]
verify: [pnpm precheck, pnpm done MARXY-185]
---
# MARXY-185 — Document how to put the `marxy` CLI on PATH after installing the app

**Design:** none — README-only · **Depends on:** MARXY-16 (the v0.0.1 release this documents;
`todo` today, no dependency on MARXY-15 per `docs/plan/deltas/2026-09-21-mac-shell-gaps.md`) ·
**Delta:** [2026-09-21-mac-shell-gaps](../deltas/2026-09-21-mac-shell-gaps.md).

**Outcome.** `README.md` gets one section: a no-sudo, one-line step that makes
`marxy file.md` work from a terminal after installing the DMG, verified once against the real
release artifact and pasted into the PR. Nothing in the app changes; this is documentation only.

## Files and signatures
- `README.md` — one new section (placed near the existing install/usage instructions, not the
  top), e.g.:

  ```markdown
  ### Using `marxy` from the terminal

  The installed app's binary is not on `PATH` by default. To run `marxy file.md` from a
  terminal after installing the DMG:

  ```sh
  mkdir -p ~/.local/bin
  ln -s "/Applications/marxy.app/Contents/MacOS/marxy" ~/.local/bin/marxy
  ```

  Make sure `~/.local/bin` is on your `PATH` (most shells already add it; if not, add
  `export PATH="$HOME/.local/bin:$PATH"` to your shell profile).
  ```

  The exact command is a placeholder above — criterion 2 requires verifying it against the real
  MARXY-16 DMG and pasting what actually worked, which may differ (app name capitalization,
  install location if the user moved it, whether `~/.local/bin` needs creating).

## Do this, in order
1. Wait for MARXY-16 to produce a real `v0.0.1` DMG (this story cannot verify against a build
   that does not exist yet — if MARXY-16 is not yet released when this story is picked up, say so
   in the PR and hold rather than guessing the binary path).
2. Install the DMG, confirm the installed binary's exact path
   (`/Applications/marxy.app/Contents/MacOS/marxy` is the expected Tauri layout — confirm, don't
   assume).
3. Run the one-line, no-sudo step by hand; confirm `marxy file.md` opens a file from a fresh
   terminal afterward.
4. Write the README section with the exact command that worked; paste the same command and the
   terminal output of the verification into the PR body (criterion 2).

## Tests → expected
| Check | Expect |
| --- | --- |
| manual: run the documented command against the real DMG | `marxy file.md` opens the file from a new terminal session afterward |
| README | the new section states the command is a manual, one-time, no-sudo step; nothing implies the app runs it automatically |
| diff | `README.md` only |

## Acceptance → check
The three criteria on the CSV row: (1) documented no-sudo one-line step; (2) verified against the
MARXY-16 DMG with the exact command pasted into the PR; (3) nothing added to the app itself that
runs the step automatically.

## Do not
Add an installer script, a post-install hook, or anything that runs unprompted. Write anything
outside `README.md`. Guess the binary path without installing the real DMG and checking.
