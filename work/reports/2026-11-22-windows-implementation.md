---
title: Marxy on Windows, where it lives and what is left
short_title: Marxy on Windows
subtitle: A map of every Windows-specific piece of Marxy on master 5b6103c5, what a walk of the installed build showed, and the Windows work still open or held.
kind: Report
date: 2026-11-22
status: Master 5b6103c5
status_color: info
crumb: Reader / Marxy / Windows
related:
  - {label: Rounds 7-8 final review, href: next-wave-2026-11-19/marxy-rounds-7-8-final-review.html}
  - {label: Next-wave plan, href: marxy-next-wave-plan.html}
---

## In short

Windows is Marxy's primary platform: it is built, signed, installed and driven in a real window on this machine, and every round since round 2 has added Windows behaviour. There is no separate "Windows port". The Windows code is a set of `#[cfg(windows)]` branches and a handful of Windows-only modules inside the one Tauri shell, `apps/desktop/src-tauri`, plus the installer config and the signing script. The page code (`apps/desktop/src`, `packages/*`) is platform-neutral except for path handling.

What is left is mostly **verification against real files and an installed build**, not missing code. The genuine product gaps are: no menu bar, no custom jump list, a few held reach items (read-aloud, legacy Office, more archives), and a small set of tests that still skip on Windows.

All paths below are relative to `C:\Dev\reader\app` unless absolute. The repo's own reference for this is `docs/desktop-shell.md` (sections on file associations, dependencies, the save guard, clipboard and OS verbs) and `docs/development.md` (Signing, Windows notes).

# Where it is

## Windows-only modules

| File | What it does |
| --- | --- |
| `apps/desktop/src-tauri/src/drop_windows.rs` | File drops. Tauri's drop event is off on Windows (`dragDropEnabled: false`); the page posts a WebView2 message (`listenForFileDrops` in `src/shell/tauri.ts`) and this module reads it. Only regular files are taken. |
| `apps/desktop/src-tauri/src/pasteboard/win32.rs` | Typed clipboard read and write through Win32: size probe before copy, 3 s timeout on an owner that does not answer, a format cap. |
| `apps/desktop/src-tauri/src/pasteboard/win_types.rs` | Maps Marxy's (macOS-named) pasteboard types to Windows formats: `CF_UNICODETEXT`, CF_HTML, RTF, the clipboard-history and cloud-clipboard exclusion formats. |
| `apps/desktop/src-tauri/src/decode/wic.rs` | HEIC drawn by the Windows Imaging Component decoder, COM on its own worker thread, only when a probe decode (`decode/probe.heic`) finds the codec. 20 s per decode, size judged from `ispe` before WIC sees it. |
| `apps/desktop/src-tauri/src/commands/recent.rs` | `note_recent`: `SHAddToRecentDocs` for opened files (feeds Explorer Recent and the taskbar jump list's Recent category), and `set_app_user_model_id`, called at start in `main.rs`. |

## Windows branches inside shared files

Counted by `cfg(windows)` occurrences; the heaviest first.

| File | Windows behaviour |
| --- | --- |
| `src-tauri/src/atomic_write.rs` | The save guard: handle held through the rename without delete sharing, identity by volume serial and file index, ACL, creation time and hidden/system attributes carried over, about one second of retry on a locked file. |
| `src-tauri/src/commands/os.rs` | Open with the system (`ShellExecuteW`), refusing dangerous types (`AssocIsDangerous`, an extension list, any MZ head), reveal in Explorer, Open in editor falling back to `notepad.exe` (the Edit verb can succeed and start nothing). |
| `src-tauri/src/file_scheme.rs` | `marxy-file://` served in the Windows URL form; `\\?\` prefixes stripped. |
| `src-tauri/src/main.rs` | `windows_subsystem = "windows"` in release, AppUserModelID at start, the drop listener on the main window. |
| `src-tauri/src/commands/run.rs` | Running a page's command: a job object that kills the process tree, the opened folder kept out of the child's program search, `.cmd` shims found by bare name. |
| `src-tauri/src/watch/mod.rs`, `watch/spawn_notify.rs` | Watch events keyed so a save by rename is seen as one change; case-folded paths. |
| `src-tauri/src/pasteboard/mod.rs` | Picks the Win32 backend. |
| `src-tauri/src/decode/mod.rs` | Routes HEIC to WIC on Windows, refuses it elsewhere. |
| `src-tauri/src/scope.rs`, `scope_tests.rs` | Path scope compares paths with one separator, no `\\?\`, and in one case. |
| `src-tauri/src/facts/tests.rs` | Windows-specific fact expectations. |

Crates that exist only for Windows (`Cargo.toml`): `webview2-com` and `windows-core` (file drops), `windows` (clipboard, Shell, WIC).

## Paths in the page code

The front end has no platform switch beyond `platformOf()`; Windows shows up as path handling:

- `packages/core/src/index-model/paths.ts`: `isWindowsPath`, slash normalisation, drive and UNC handling, case folding only for letters whose case pair goes both ways, `.` and `..` folded on Windows.
- `apps/desktop/src/selection/link-target.ts`: relative links on drive paths, refusal of decoded backslashes and a colon past the drive, no stat of UNC targets (NTLM leak).
- `apps/desktop/src/document/fork.ts`, `src/line/refs.ts`, `packages/core/src/index-model/{checkout,collection}.ts`: either separator, any case.
- One store per file whatever the case of a Windows path (`fileKey`).

## File kinds that are Windows-shaped

All platform-neutral code, but they exist because the reader is on Windows (`docs/file-kinds.md`):

- Shortcuts: `.lnk` card, `.url` and `.inf` read as INI.
- Outlook `.msg` (`src-tauri/src/outlook/`, bounded CFB walk).
- Program card for `.exe .dll .sys .ocx .scr` and MZ-headed files: says what the file claims, never runs or verifies it.
- Logs Windows writes (CBS, DISM, WindowsUpdate, IIS) recognised by shape.
- Code page numbers mapped to encodings (`encoding/`, `of_code_page`).
- RTF read as text (WordPad is gone from 24H2).

## Installer, associations and signing

| Piece | Where |
| --- | --- |
| Window and bundle overrides | `apps/desktop/src-tauri/tauri.windows.conf.json` (drops off, `signCommand`, Markdown as the one default association) |
| Open with for every other kind | `apps/desktop/src-tauri/installer-hooks.nsh`: HKCU only, `OpenWithProgids`, `Marxy.File`, `Applications\marxy.exe\SupportedTypes`; never takes a default. Extension list held equal to the kind registry by `packages/core/src/kind/registry.test.ts`. |
| Installer output | NSIS per-user, `target/release/bundle/nsis/Marxy_<version>_x64-setup.exe` |
| Signing | `apps/desktop/scripts/sign-windows.mjs`, mode by `MARXY_SIGN` (unset, `self`, `azure`); `sign:self-cert` makes the certificate |
| Build, sign and install locally | the `marxy-exe` skill, worktree `C:\Dev\reader\worktrees\exe`, installs to `%LOCALAPPDATA%\Marxy`, installers kept in `C:\Dev\reader\builds` |

## Testing on Windows

- `pnpm --filter @marxy/desktop check:tauri` drives the built app's real WebView2 window over CDP on port 9333 (one run per machine, takes a lock). Last run: 98 of 98 at round 8.
- Link and fidelity tests fall back to junctions when symlinks are refused, so they run without Developer Mode.
- `VAR=value` package scripts do not set the variable under pnpm's `cmd.exe`; set it in PowerShell first.

# What is left

## Walked in the installed build, 2026-11-22 {#walk}

Master `5b6103c5`, self-signed (Valid), installed per-user with `marxy-exe`, each file started the way Explorer starts it (`marxy.exe "<file>"`) and read over WebView2's debugging port. Samples and screenshots: `C:\Dev\reader\walk-2026-11-22\` (`shots\`).

| Item | Result |
| --- | --- |
| "Open with" entries after install | {ok: verified} 565 types; Windows' own handler list (`SHAssocEnumHandlers`) offers Marxy for `.pdf .png .docx .cs .txt`, not for `.exe`; no extension default written |
| "Open with" entries after uninstall | {ok: verified} no `Marxy.File` value left on any of the 565 types, `Marxy.File` and `Applications\marxy.exe` gone; VS Code, Zed, Chrome and Store app entries untouched |
| PDF opened from Explorer | {ok: verified} drawn by pdf.js, its folder in the path bar; pictures show "n of m in" their folder |
| Typing focus after Mod+E | {ok: verified} focus moves from BODY into the editor (`cm-content`) |
| Recent list | {ok: verified} every opened document added, the two programs not; a jump list file rewritten at the same moment (the taskbar menu itself not looked at) |
| HEIC with the codec | {ok: verified} `decode/probe.heic` drawn at 64 x 32 through WIC (HEIF 1.2.65, HEVC 2.4.149) |
| Program card | {ok: verified} a copy of `notepad.exe` shows Microsoft's product and version as the file's own claims |
| Signed installer opened in Marxy | {ok: verified} program card, "Signature present, not verified", never run |
| PSD, DDS, Word, Outlook `.msg` | {ok: verified} drawn or read (fixture files, not files from the wild) |
| The demo `IMG_0417.heic` | {ok: fixed} 2 KB, a real header and filler after it; the card said "This system could not draw it" on a machine with both extensions. Since master `acd4d48d` a format the system draws that still fails says the file may be damaged or cut short (heading "An image that would not draw"). Browser test covers a cut PNG; not yet seen in an installed build. |

## Still not verified {#unverified}

| Item | Status |
| --- | --- |
| HEIC from a real iPhone | {warn: unverified} needs a real photo; none on this machine |
| HEIC **without** the codec (the card should name the two Store extensions) | {warn: unverified} this machine has both extensions installed |
| Real PSD, DDS, WMA, AC3, AMR files from the wild | {warn: unverified} fixtures only |
| The taskbar jump list as drawn | {warn: unverified} Recent entries and the jump list file are written; the menu was not opened |
| Round 6 carry-over of 8 real-window items | {warn: unknown} the status logs do not name them; see `next-wave-2026-11-19\round6\` |
| command-scope's 13 flows | {warn: unverified} the widest change to what the app may touch |

## Open defects and measurements

- **Start-time marks**: 2 of 5 launches recorded no first-text mark; the median moved from 666 to 725 ms. The number is only as good as its marks.
- **Place restore**: once, under full-verify load, a file did not reopen at its place after relaunch (94 of 95); not reproduced since.
- **Timing tests under load**: core timing tests (notebook, long paragraph, 10 MB notebook) fail under heavy parallel load even best of 3. Windows' 15.6 ms timer tick needs slack on budgets under 100 ms.
- **Typesetter trade**: setting a whole 1 MB page takes 89 s; export after a resize waits about two minutes. Not Windows-specific, but felt first here.

## Product gaps on Windows {#gaps}

| Gap | Note |
| --- | --- |
| "Open with" for most kinds | {ok: fixed} on master `5b6103c5`: the installer offered Marxy for 59 text and code types only; it now offers every type Marxy has a page for (565), never as the default. Installs from before 19 Nov wrote no "Open with" entries at all. |
| No menu bar | The native menu is macOS only (`app_menu::MENU`); Windows and Linux have none. Commands are reachable from keys and the palette. A Windows menu bar was surveyed and not taken. |
| No custom jump list | The taskbar jump list shows only Windows' Recent category; no tasks or pinned items are built. |
| No tray icon / stay running | Removed with `resident`; it would have needed a tray icon to quit. |
| Split (multi-volume) zip | Not read. |
| `.msi`, `.evtx` | Surveyed, not built. |
| Read-aloud through a local Windows voice | {info: held} in the next-wave plan |
| Legacy Office (`.doc`, `.xls`, `.ppt`), more archives, calendar and contact invites | {info: held} |
| Signing for distribution | Builds are unsigned or self-signed; a self-signed build is trusted only where its `.cer` is imported. Azure Artifact Signing is wired in; there is no record of a build signed that way. |

## Tests that still skip on Windows

| Test | Why |
| --- | --- |
| `apps/desktop/scripts/smoke-verdict.test.mjs` "a killed launch takes the processes it started with it" | process groups and SIGTERM |
| `apps/desktop/src/theme/measure-face.test.mjs` optical-size case | Playwright's Windows WebKit does not size the `opsz` axis |
| `packages/core/src/index-model/walk.test.ts` backslash-in-name case | a backslash cannot be in a Windows file name; correct to skip |
| A few link tests that need a real symlink | junctions cover the rest; Developer Mode would run them |
| `#[cfg(not(windows))]` Rust tests in `atomic_write.rs`, `scope.rs`, `facts/tests.rs`, `watch/mod.rs` | Unix permissions and inode cases; each has a Windows counterpart |

## Housekeeping

- `agent/find-in-buffer` (one commit, `924a09a6`, from round 6) is the only unmerged branch.
- `agent/round9` exists at master with a builder-rules file in `next-wave-2026-11-19\round9\` and no commits; nothing is scheduled.
- 45+ merged worktrees and branches await your word to remove. `batch7`'s test edit is saved as `next-wave-2026-11-19\saved-patches\batch7.patch`.

- `worktrees\open-with` holds **uncommitted work by someone else**: more extensions in `registry.ts` and `aliases.ts` (`.apng`, `.cbz`, `.msix`, `.gpkg`, `.plist` and others), with the hook list and `file-kinds.md` following. It is not on master.

## Suggested order

1. Try a real iPhone HEIC, then remove the HEIF extension and try again.
2. Find the missing start-time marks.
3. Decide on a Windows menu bar and a custom jump list, the two visible gaps against other Windows readers.
4. Answer the held rows (read-aloud, legacy Office, more archives).
