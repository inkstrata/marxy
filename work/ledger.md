# Landing ledger

One row per landing, oldest first. A landing is a run (or a single branch) reaching `main`. The verify column
is the full verify the landing was taken on, with the log it came from (paths relative to `work/`).

Commits before 2026-11-26 are from the Windows checkout (`master`, no remote) and are not in this repository's
history; see `README.md`.

| Date | Run | Commit or PR | What landed for the reader | Verify |
| --- | --- | --- | --- | --- |
| 2026-11-23 | round 9 | `ee56607d` | `.doc` and `.ppt` open as text; `.zst`, `.tar.zst`, `.deb`, `.cab` and `.iso` open, `.rar` lists; idle typesetting in 24 ms slices; saving after an outside rename works on Windows paths; hostile files cannot panic a decoder | 9/10 on rerun; browser 2460 pass, 4 load reds pass alone (`runs/2026-11-23-round-09/logs/verify-full-2.log`) |
| 2026-11-23 | round 10 | `47513544` | a search result landing while Aa / .* / word is pressed no longer loses the click; head reads cannot be redirected by a swapped junction | 15/17, two reds pass alone (`runs/2026-11-23-round-10/logs/verify-full.log`) |
| 2026-11-23 | round 11 | `3d71ec38` | images, SQLite and its sidecars judged by the opened handle; the PDF find count clears on typing; previews no longer fetch relative images | 15/17, two load reds pass alone (`runs/2026-11-23-round-11/logs/verify-full.log`) |
| 2026-11-23 | round 12 | `04eafecc` | SQLite journal held by handle; leftover save files swept (this run's own only); find shows "N so far" while counting; no unowned listeners | 16/17, a test-timing red, fixed (`runs/2026-11-23-round-12/logs/verify-full.log`) |
| 2026-11-23 | round 13 | `64589ba8` | cursor key on a rendered 6 MB page 1410 to 44 ms; find steps while counting; one shell listener per event | 17/17, browser 2482/0 (`runs/2026-11-23-round-13/logs/verify-full.log`) |
| 2026-11-24 | round 14 | `7779ec46` | Outline windowed (6,500 headings: 46,300 to 356 elements); work budgets for mail, RTF and JSON Lines; shell teardown disposers | 4/4 rerun from browser, browser 2489/0 (`runs/2026-11-24-round-14/logs/verify-full-2.log`) |
| 2026-11-24 | round 15 | `17cfe661` | work budgets for TOML, Outline (first 20,000), title scan, punycode, gzip, ICC, sanitiser; held opens kept for the next boot | 16/17, `progressive-large` load red passes alone (`runs/2026-11-24-round-15/logs/verify-full.log`) |
| 2026-11-24 | wave 1 | `978b8251` | cursor key script 57 to 6.5 ms and first-click handler 188 to 10 ms on the 195 KB page; JS build 8.06 MB smaller (grammars once, dead code out) | 17/18, two load reds pass alone (`runs/2026-11-24-wave-01/logs/wave1-full-verify.log`) |
| 2026-11-25 | wave 2 | `84a815dd` | the typesetter skips unused work; region parse seeded with the file's definitions; 195 KB open layouts 396 to 342 | 17/18, `split-narrow` load red passes alone 16/16 (`runs/2026-11-25-wave-02/logs/wave2-full-verify.log`) |
| 2026-11-25 | wave 3 | `b0d9cb52` | undo, redo and Source commit replace only the changed blocks (195 KB: 2,513 to 3 blocks, 2.8 s to 0.35 s); shared block cache; content search on up to 8 threads (386 to 44 ms) | 17/18, `split-narrow` load (`runs/2026-11-25-wave-03/logs/wave3-full-verify.log`) |
| 2026-11-26 | wave 4 | `663a7f7f` | footnoted and small pages update in place (195 KB reload 3.0 s to 0.48 s); tab back reuses the kept store (598 to 349 ms); the tree watch skips ignored folders | 18/18, browser 2536/0 (`runs/2026-11-26-wave-04/logs/wave4-full-verify-2.log`) |
| 2026-11-26 | import | restructure PR | the reader architecture adopted wholesale at `663a7f7f`, onto `main`; the earlier code archived at `archive/pre-reader-2026-11-26`; first macOS build, with fixes to checks that had only run on Windows | macOS: every step but the browser suite (`runs/2026-11-26-import/README.md`); browser suite on Windows CI |
| 2026-11-27 | hunt 01 | #786 | the app is unchanged; the first bug hunt: 25 findings across six domains, 16 tracker rows (B1 to B16), three of them S1 freezes (export as a web page, a backtracking regex in the Search panel, one long unbroken run) | `pnpm verify --tier changed` 8/8 (check 10/10, browser 59/59) |
| 2026-11-27 | hunt 02 | this pull request | the app is unchanged; a focused hunt on the owner's freeze in the rail and its panels: 9 findings, rows B17 and B18 (S1 freezes: the Transforms panel re-parses per row; Links and Metadata parse the whole file a second time) and B19 | `pnpm verify --tier changed` 8/8 (browser 59/59) |

Not landed: round 16 (integration `1f141eb1`, verified 16/17, waiting on the owner) and wave 5 (integration
`0a9eeb68`, full verify red). Their branches stayed on the Windows checkout; see `STATE.md`, "Open work".
