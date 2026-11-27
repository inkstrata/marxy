# Marxy todo

Open work. A row leaves this file in the pull request that lands its branch on `main`, or when the work is dropped;
`pnpm work todo --check` names the rows whose branch has landed. Ids are for `work/` only: they never go in code,
comments, tests, commit subjects or `docs/`. The layout and rules for this folder are in `README.md`.

Carried over on 2026-11-23 from `..\marxy-todo.md` when round 9 landed (master `ee56607d`). Ids are kept, so the gaps are
the rows that landed: F1 to F4, F7, W1 to W4, P1, P2 and S1 to S7; round 10 (master `47513544`) landed F8 to F11 and S8; round 13 (master `64589ba8`) landed S16 and F18 to F20; round 14 (master `7779ec46`) landed F21, F22 and P8; round 15 (master `17cfe661`) landed P9, P10 and F23.

Moved into the repository on 2026-11-26 with the reader architecture. Until then this tracker lived beside a Windows
checkout with no remote; the branch names in it (`budgets-4`, `geometry-table` and the rest) are branches of that
checkout, and none is on GitHub yet (row M1).

Rows B1 to B16 came from the first bug hunt (2026-11-27). Their ids such as `EXP-02` are findings in
`runs/2026-11-27-hunt-01/findings.md` and `verification.md`, and their probe paths are under that folder.

## Carry over

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| M1 | Push the Windows checkout's unlanded branches to GitHub as `agent/<name>`: round 16's integration (`1f141eb1`: `budgets-4`, `budgets-5`, `teardown-2`), wave 5's (`0a9eeb68`: `geometry-table`, `near-typeset`), `web-shell` and `open-with`; rebase each on `main` | That work exists on one disk only; `main` here is wave 4 | S | |
| M2 | Run the app on macOS by hand, on the release dry-run DMG: the checklist in `reports/2026-11-26-release-readiness/README.md`, step 5 (opening from Finder and the Dock, the demo tour, Cmd keys, quits with an unsaved edit, light and dark, full screen, a tagged and an iCloud file) | The import built and passed its checks on macOS, but no person has used the Mac build | S | |
| M3 | First Linux build and run (Linux CI runner and a desktop) | Never built on Linux; `cfg(unix)` paths such as the save sweep have run nowhere | M | |
| M4 | 14 browser test files fail on macOS WebKit, alone as well as in the suite (2026-11-26): capability (`frame-fonts`, `frame-media`, `frame-viewers`: macOS WebKit draws or plays what Windows WebKit could not), layout and metrics (`page-states`, `splice-all`, `source-fold-stale`, `source-structure`, `paste-source`, `leave-split`, `demo-tour`), timing (`large-open-panel`, `markdown-lines`, `tail-follow`, `frame-pdf`). Logs in `runs/2026-11-26-import/` | The suite has only ever been green on Windows; CI runs it there until these pass, then adds `browser` to the macOS job | M | |
| M5 | 14 browser test files fail on a hosted Windows runner (GitHub's `windows-latest`, 2026-11-26), all green on the Windows desktop: timing budgets (`archive-page`, `data-tree-budget` ×2, `left-search-big`, `paragraph-restyle`, `large-open-panel`, `progressive-large`, `frame-pdf`, `tail-follow`), layout or environment (`demo-tour`, `frame-viewers`, `source-place`, `reading-rows`: a ResizeObserver warning, `operations-copy`: a drag fetched two grammar chunks, `pane-close-guard`). Five overlap M4 (`demo-tour`, `frame-viewers`, `frame-pdf`, `large-open-panel`, `tail-follow`). The suite took 103 minutes there. Logs in `runs/2026-11-26-import/logs/verify-ci-windows-*` | CI runs no browser suite until these pass on a hosted runner (or the budgets scale with the machine); a person runs it on a Windows desktop | M | |

## Release

The first tag of the reader architecture: v0.2.0, a macOS pre-release. The plan, its order and gates, and the
investigation behind these rows are in `reports/2026-11-26-release-readiness/`. M1, M2 and round 16 (P11, P12, F24)
are part of it; R10 and R11 block the tag only if they turn out real. R1 (macOS CI) landed with #774.

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| R3 | A Dock Quit, a logout or an Apple-event quit on macOS exits at once, without the unsaved-changes prompt: the run closure in `src-tauri/src/main.rs` has no `ExitRequested` arm, so only the menu's Quit and the close box ask | A reader can lose an edit; `docs/using-marxy.md` promises otherwise | S | |
| R4 | macOS file associations: the "Source and text" group claims Default rank for about 60 extensions (json, html, xml, css among them); Markdown has no UTI; PDFs, images, archives and documents are not offered in Open With at all | Marxy should be offered for what it reads, not take double-click from other apps | S | |
| R9 | Dry run of `release.yml` by `workflow_dispatch` on the version branch: size, seal and notices of the artifact, then install from a download on a clean account | The workflow has not run since v0.1.0 | S | |
| R10 | Leaving Split loses the reading place on macOS WebKit (`leave-split`: offset 2021 became 0): a real loss or a test that reads too early? | A reader would lose their place | S | |
| R11 | After a fold or a paste in Source, the page differs from a fresh render on macOS WebKit (hanging-punctuation spans in one and not the other; `source-fold-stale`, `paste-source`): real or compared too early? | It could be a stale page | S | |
| R12 | The macOS pasteboard test has never run: `cargo test -- --ignored pasteboard_live` | Copy as HTML, RTF and text to other apps is unproved on a Mac | S | |
| R13 | A 1 MB Markdown file takes about 78 s to open (Windows: the progressive mount lays out per chunk); never measured on macOS | Long files are a stated use | M | |

## Next

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| S17 | Spike: a shell over the File System Access API, booted by a web build, reading and saving a real folder in Chrome; report in `work\reach` | Measures what a browser host keeps and loses before any reader moves to wasm | M | `web-shell` |
| P11 | Budgets, slice 4 (lines of text): paste classify patterns O(n^2) on a line of spaces or `[` (`paste/classify.ts`); `carriesMarkdown` O(L^2) per line, lines uncounted below 5 MB (`reading/index.ts`); JSON Lines records parsed whole, no per-line cap (`reading/rows.ts`); `diff/words.ts` tokenises every line before `MAX_TOKENS` | A hostile file or paste can hang a reading | M | `budgets-4` |
| P12 | Budgets, slice 5 (containers): `archiveSums` joins every path prefix (`viewer/archive.ts`); office `find` BFS with `shift()` (`office/xml.ts`); book `TOC_DEPTH` bypassed by link-less headings; mime `delimiters` rescans each level; cert `checkTree` no node cap | Same: unbounded work on bytes the reader did not write | M | `budgets-5` |
| E22 | Geometry table: one record per top-level block (element, byte range, top, height, measured or estimated), kept current by size notifications; position, spine, holdPlace and Source return stop reading the whole page | The DOM stops being asked block by block; near-typeset builds on it | L | `geometry-table` |
| E23 | Near-typeset: bound the idle typesetting queue to what is near the reader; `done` means nothing near is unset; `setAll()` for export, print and the rag gate; the page held still by keepPlace during scroll (cut from `geometry-table`) | A long page is at rest about as fast as a short one | M | `near-typeset` |
| F24 | Teardown, what is still left: an open emitted live by Rust while no boot is subscribed (after the first take) is dropped; `createDocumentSignal` keeps its pane subscriptions after destroy until the panes go; if a boot's open callback throws, the held batches after it are lost | In-page reboots only, so latent | S | `teardown-2` |
| B1 | Exporting a long open file as a web page freezes the window: 1.2 s at 300 sections, over 10 s at 600 | S1 freeze; `export/page.ts` `partHtml`: each top block's range has the whole article as its common ancestor, so every clone walks every sibling (N×N); the owner's report; hunt-01 EXP-02 (EXP-01), probe `probes/EXP/a-panel.verify.mjs` | S | |
| B2 | A backtracking regular expression in the Search panel's Find field, such as `(a+)+$`, freezes the window | S1 freeze; `left/panels/search.ts:259` runs `matchLines` on every file on the main thread with no time budget (the Line's `#` and `/` are guarded); the owner's report; hunt-01 NAV-04 (NAV-03), probe `probes/NAV/panel-freeze.verify.mjs` | M | |
| B3 | A file with one very long unbroken run freezes on open: a mail line (7.8 s at 400 KB), an RTF run (22.8 s at 400 KB), a Markdown line (about 23 s at 3 MB) | S1 freeze; browser layout with kerning on in the reading face: a 100 KB paragraph lays out in 1372 ms, in 3 ms with `font-kerning: none`; drawn at `viewers/mail.ts:332`, `viewers/office.ts:280`; related to R13 and P11 but not their cause; hunt-01 VWR-02, VWR-04, probes `probes/VWR/a-sizes.verify.mjs`, `a-css.verify.mjs` | M | |
| B4 | Opened from Finder or the Dock on a Mac, a `[[command]]` program or the external editor installed by Homebrew or mise is "not a program on the PATH" | S2, macOS; nothing in `src-tauri` sets `PATH`, and launchd's default holds neither `/opt/homebrew/bin` nor mise's shims; hunt-01 SHL-01, probe `probes/SHL/shl-01-02.verify.rs` | S | |
| B5 | Saving a file locked in Finder fails with "Operation not permitted" on a hidden temp name, and leaves that hidden file behind, undeletable | S2, macOS; the atomic write's staged copy carries the `uchg` flag, so writing, cleaning up and renaming all fail; the target is unchanged; hunt-01 SHL-04, probe `probes/SHL/uchg-save.verify.rs` | S | |
| B6 | "Save and close" on a staged file that no pane shows says nothing when the write is refused: the window stays open and the edit stays unsaved | S2; `close.ts:148-154` calls `s.save()` rather than `saveHeld` (`left/held.ts:130`), which notifies; hunt-01 EDT-01, probe `probes/EDT/edt01.verify.mjs` | S | |
| B7 | Exporting a selection "as the file as written" from a file with bare CR line ends saves an empty file and says "Exported" | S2; `export/model.ts:134` `linesBytes` counts LF only while `lineSpan` counts a lone CR; `lineOfIn` (`left/panels/export.ts:243`) also counts LF only; hunt-01 EXP-04, probe `probes/EXP/b-cr-panel.verify.mjs` | S | |
| B8 | A wide table on a right-to-left page cannot be scrolled: its first columns are out of reach | S2; `render/wide-tables.ts` measures column edges from the left and sets a negative cut (-2180px); the article itself stays left-to-right, so the page's direction may be wrong more widely; hunt-01 RDR-03, probe `probes/RDR/rtl-table.verify.mjs` | S | |
| B9 | A Word document of about 62,000 paragraphs or more does not open ("Maximum call stack size exceeded") | S2; every child node spread into one `append` (`viewers/office.ts:348`), the same pattern in `viewers/book.ts:304`, `source/format-ops.ts:261` (`Math.max(0, ...)`) and two export paths in `render/markdown.ts`; WebKit's limit is likely lower; hunt-01 VWR-03, probe `probes/VWR/b-docx-threshold.verify.mjs` | S | |
| B10 | The Search panel's Find and Replace fields read "Find Find" and "Replace Replace" | S3, the owner's report; `left/panels/search.ts:605-619` sets both a label and a placeholder of the same word; hunt-01 NAV-05 (NAV-02) | S | |

## To try in a real window

| # | What | Branch |
| --- | --- | --- |
| W5 | Round 6 by eye: line icons, the room changes, top-edge wake and left-edge peek with a real pointer, Notepad writing during a 20 MB save, an SMB share | Ian |
| W6 | Real files: an iPhone HEIC, real PSD and DDS files, WMA/AC3/AMR, a signed installer opened through the UI, and real `.doc`, `.ppt`, `.deb`, `.cab`, `.iso`, `.rar` | Ian |
| W7 | Install round 9's build here: `builds\20261123-0631-ee56607d` | Ian's word |
| W8 | A frames-only launch: no start-time run hit it, so the 2 s stall fix has not been seen in the real app | |
| W9 | A file on a mapped network drive, a `subst` drive and a OneDrive placeholder still opens: the head read now compares the opened handle's final path | |
| B11 | Go on the search page does nothing (the owner's report). Not reproduced in the browser build: `o`, `Shift+o`, a click on a hit and the Line's `#` all go; Enter with Replace filled replaces, as meant. Which key or click, in the Mac window? hunt-01 NAV-01, NAV-06 | Ian |
| B12 | Print to PDF on macOS: `printPane` (`export/page.ts:131`) removes its print rules 1 s after `window.print()`; does the sheet still have them when it draws? hunt-01 EXP-03 | |

## Waiting on Ian

| # | What | Where |
| --- | --- | --- |
| R2 | Disable the `nightly` workflow: deleted from `main` by the import, it is still scheduled from an old commit and fails every day (`gh workflow disable nightly -R inkstrata/marxy`) | GitHub, Actions |
| R14 | Decide the release: v0.2.0, a pre-release, round 16 before the tag, wave 5 after it, the file-association set, ad-hoc signing for now | `reports/2026-11-26-release-readiness/README.md`, "Decisions for the owner" |
| B13 | Pasting HTML into Source of a file that is not Markdown converts it to Markdown, as `docs/using-marxy.md` promises: fences in a `.py` file, escaped and invalid JSON, a pipe table in a `.csv`, `**bold**` in a `.txt`. Should such a paste go in as plain text? (hunt-01 EDT-03, judged by design) | `docs/using-marxy.md:263-266` |

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
| R15 | iCloud Drive placeholder ("dataless") files are not recognised: a read, the index walk or a save may stall while the file downloads | Unverified; try it in M2 | S |
| B14 | A SQLite view stopped at the 2 s cap exports to CSV with no word that rows are missing | S2, kept out of Next to hold it near fifteen rows; `viewers/sqlite.ts:640` drops `got.stopped`, which the Rust side sets (`sqlite.rs:818`); code reading, the browser build has no SQLite engine; hunt-01 VWR-01 | S |
| B15 | Save in the Export panel can be pressed twice and opens two save dialogs | S3; no busy guard while an export runs; hunt-01 EXP-05, probe `probes/EXP/b-double-save.verify.mjs` | S |
| B16 | X-ray "As written" drops a leading BOM | S3; `new TextDecoder()` strips it; hunt-01 RDR-01, probe `probes/RDR/xray-bom.verify.mjs` | S |
| R16 | Every save on macOS gives the file a new creation date (the replace is a new inode) | Finder's "Created" resets | S |
| R17 | Browser files on macOS overran their waits by minutes (`frame-media`, `frame-viewers`, `frame-pdf`); the runs coincided with the laptop sleeping, so re-run them held awake (`caffeinate -i`) before calling any of it a hang | Settles whether the browser suite can join the macOS CI job (M4) | S |
| R18 | Round 16's review residue: the held-open queues are unbounded while no boot listens, a live open can land before older held batches, pastes over 4 MB paste as text, a file of only over-long records is no longer JSON Lines (`runs/2026-11-24-round-16/README.md`) | After round 16 lands | S |
| R19 | Waves 1 to 4 residue: the warm store is lost after a same-tab link and Back and after a cross-file replace; `typeset-view`'s block-list patch applies in about half the cases (`STATE.md`, "Risks") | Speed, not correctness | S |
| R20 | The mail and HTML viewers log two console errors each ("Blocked script execution in 'about:srcdoc'") | Noise that hides real errors | S |
| R21 | macOS startup has never been measured (Windows: 774 ms median to first text) | For the release notes, not a gate | S |

## Housekeeping

About the machines' workspaces, not this repository: H4 and H5 the Windows machine, H6 the Mac.

| # | What | State |
| --- | --- | --- |
| H4 | `worktrees\furniture` and `worktrees\shortcuts` could not be deleted (a file in each held open) | Retry after a restart |
| H5 | `worktrees\exe` holds another session's uncommitted `hex.ts` and `frame.css` edits on `a6032b26`, so the installer script refuses it | That session's to clear |
| H6 | About 570 worktrees beside the Mac checkout are from the earlier architecture, 93 with uncommitted edits, and its main checkout holds 345 untracked files under `orchestration/` | After the tag: a patch per dirty worktree, then remove; every branch is tagged `archive/branch/<name>`; never `git clean` the checkout |
