# Marxy todo

Open work. A row leaves this file in the pull request that lands its branch on `main`, or when the work is dropped;
`pnpm work todo --check` names the rows whose branch has landed. Ids are for `work/` only: they never go in code,
comments, tests, commit subjects or `docs/`. The layout and rules for this folder are in `README.md`.

Carried over on 2026-11-23 from `..\marxy-todo.md` when round 9 landed (master `ee56607d`). Ids are kept, so the gaps are
the rows that landed: F1 to F4, F7, W1 to W4, P1, P2 and S1 to S7; round 10 (master `47513544`) landed F8 to F11 and S8; round 13 (master `64589ba8`) landed S16 and F18 to F20; round 14 (master `7779ec46`) landed F21, F22 and P8; round 15 (master `17cfe661`) landed P9, P10 and F23.

Moved into the repository on 2026-11-26 with the reader architecture. Until then this tracker lived beside a Windows
checkout with no remote; the branch names in it (`budgets-4`, `geometry-table` and the rest) are branches of that
checkout, and none is on GitHub yet (row M1).

## Carry over

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| M1 | Push the Windows checkout's unlanded branches to GitHub as `agent/<name>`: round 16's integration (`1f141eb1`: `budgets-4`, `budgets-5`, `teardown-2`), wave 5's (`0a9eeb68`: `geometry-table`, `near-typeset`), `web-shell` and `open-with`; rebase each on `main` | That work exists on one disk only; `main` here is wave 4 | S | |
| M2 | Run the app on macOS by hand: open the demo files, Read and Source, save, the window and the menu | The import built and passed its checks on macOS, but no person has used the Mac build | S | |
| M3 | First Linux build and run (Linux CI runner and a desktop) | Never built on Linux; `cfg(unix)` paths such as the save sweep have run nowhere | M | |
| M4 | 14 browser test files fail on macOS WebKit, alone as well as in the suite (2026-11-26): capability (`frame-fonts`, `frame-media`, `frame-viewers`: macOS WebKit draws or plays what Windows WebKit could not), layout and metrics (`page-states`, `splice-all`, `source-fold-stale`, `source-structure`, `paste-source`, `leave-split`, `demo-tour`), timing (`large-open-panel`, `markdown-lines`, `tail-follow`, `frame-pdf`). Logs in `runs/2026-11-26-import/` | The suite has only ever been green on Windows; CI runs it there until these pass, then adds `browser` to the macOS job | M | |

## Next

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| S17 | Spike: a shell over the File System Access API, booted by a web build, reading and saving a real folder in Chrome; report in `work\reach` | Measures what a browser host keeps and loses before any reader moves to wasm | M | `web-shell` |
| P11 | Budgets, slice 4 (lines of text): paste classify patterns O(n^2) on a line of spaces or `[` (`paste/classify.ts`); `carriesMarkdown` O(L^2) per line, lines uncounted below 5 MB (`reading/index.ts`); JSON Lines records parsed whole, no per-line cap (`reading/rows.ts`); `diff/words.ts` tokenises every line before `MAX_TOKENS` | A hostile file or paste can hang a reading | M | `budgets-4` |
| P12 | Budgets, slice 5 (containers): `archiveSums` joins every path prefix (`viewer/archive.ts`); office `find` BFS with `shift()` (`office/xml.ts`); book `TOC_DEPTH` bypassed by link-less headings; mime `delimiters` rescans each level; cert `checkTree` no node cap | Same: unbounded work on bytes the reader did not write | M | `budgets-5` |
| E22 | Geometry table: one record per top-level block (element, byte range, top, height, measured or estimated), kept current by size notifications; position, spine, holdPlace and Source return stop reading the whole page | The DOM stops being asked block by block; near-typeset builds on it | L | `geometry-table` |
| E23 | Near-typeset: bound the idle typesetting queue to what is near the reader; `done` means nothing near is unset; `setAll()` for export, print and the rag gate; the page held still by keepPlace during scroll (cut from `geometry-table`) | A long page is at rest about as fast as a short one | M | `near-typeset` |
| F24 | Teardown, what is still left: an open emitted live by Rust while no boot is subscribed (after the first take) is dropped; `createDocumentSignal` keeps its pane subscriptions after destroy until the panes go; if a boot's open callback throws, the held batches after it are lost | In-page reboots only, so latent | S | `teardown-2` |

## To try in a real window

| # | What | Branch |
| --- | --- | --- |
| W5 | Round 6 by eye: line icons, the room changes, top-edge wake and left-edge peek with a real pointer, Notepad writing during a 20 MB save, an SMB share | Ian |
| W6 | Real files: an iPhone HEIC, real PSD and DDS files, WMA/AC3/AMR, a signed installer opened through the UI, and real `.doc`, `.ppt`, `.deb`, `.cab`, `.iso`, `.rar` | Ian |
| W7 | Install round 9's build here: `builds\20261123-0631-ee56607d` | Ian's word |
| W8 | A frames-only launch: no start-time run hit it, so the 2 s stall fix has not been seen in the real app | |
| W9 | A file on a mapped network drive, a `subst` drive and a OneDrive placeholder still opens: the head read now compares the opened handle's final path | |

## Waiting on Ian

| # | What | Where |
| --- | --- | --- |

## Later

| # | What | Why | Size |
| --- | --- | --- | --- |
| F5 | Place restore failed once under full-check load (94 of 95), not reproduced in 4 runs | Watch; give it a wait or find the race if it returns | S |
| F6 | Facts readers for wma, ac3, amr | Only if such files turn up | S |
| S10 | Watch: the 2 s flat poll stats symlink targets, SMB included; needs a rule for which links are followed (`src-tauri` watch) | Polling a share costs | M |
| S9 | `createRenderedView` is about 2,600 lines; listeners added far outnumber those removed (`view/rendered-view.ts`) | Goes with P3 and P5 | L |
| P4 | `budgets`: untrusted input gets work budgets everywhere, not branch by branch | Each format found its own gap in review | L, gradual |
| P5 | `one-view`: split the view's main function and route keys once | See S9 | L, gradual |
| P6 | `invites`: `.ics` and `.vcf` as cards; the usable parser is MPL or large | Held | S |
| P7 | `read-aloud`: the page read by a local Windows voice | Held | M |

## Housekeeping

Both rows are about the Windows machine's workspace, not this repository.

| # | What | State |
| --- | --- | --- |
| H4 | `worktrees\furniture` and `worktrees\shortcuts` could not be deleted (a file in each held open) | Retry after a restart |
| H5 | `worktrees\exe` holds another session's uncommitted `hex.ts` and `frame.css` edits on `a6032b26`, so the installer script refuses it | That session's to clear |
