# Marxy todo

Open work. A row leaves this file in the pull request that lands its branch on `main`, or when the work is dropped;
`pnpm work todo --check` names the rows whose branch has landed. Ids are for `work/` only: they never go in code,
comments, tests, commit subjects or `docs/`. The layout and rules for this folder are in `README.md`.

Carried over on 2026-11-23 from `..\marxy-todo.md` when round 9 landed (master `ee56607d`). Ids are kept, so the gaps are
the rows that landed: F1 to F4, F7, W1 to W4, P1, P2 and S1 to S7; round 10 (master `47513544`) landed F8 to F11 and S8; round 13 (master `64589ba8`) landed S16 and F18 to F20; round 14 (master `7779ec46`) landed F21, F22 and P8; round 15 (master `17cfe661`) landed P9, P10 and F23.

Moved into the repository on 2026-11-26 with the reader architecture. Until then this tracker lived beside a Windows
checkout with no remote; the branch names in it (`budgets-4`, `geometry-table` and the rest) are branches of that
checkout, and none is on GitHub; on 2026-11-27 the owner chose not to recover them.

Rows B1 to B16 came from the first bug hunt (2026-11-27). Their ids such as `EXP-02` are findings in
`runs/2026-11-27-hunt-01/findings.md` and `verification.md`, and their probe paths are under that folder.

## Carry over

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| M3 | First Linux build and run (Linux CI runner and a desktop) | Never built on Linux; `cfg(unix)` paths such as the save sweep have run nowhere | M | |
| M4 | 14 browser test files fail on macOS WebKit, alone as well as in the suite (2026-11-26): capability (`frame-fonts`, `frame-media`, `frame-viewers`: macOS WebKit draws or plays what Windows WebKit could not), layout and metrics (`page-states`, `splice-all`, `source-structure`, `leave-split`, `demo-tour`), timing (`large-open-panel`, `markdown-lines`, `tail-follow`, `frame-pdf`), and `operations-copy` (two lazy highlight chunks, javascript and css, load when none are expected; fails alone on main too), and `reading-lines` (find, the level filter and a jump to a byte: a 30 s wait times out; fails alone on main too, 2026-11-27). Logs in `runs/2026-11-26-import/` | The suite has only ever been green on Windows; CI runs it there until these pass, then adds `browser` to the macOS job | M | |
| M5 | 14 browser test files fail on a hosted Windows runner (GitHub's `windows-latest`, 2026-11-26), all green on the Windows desktop: timing budgets (`archive-page`, `data-tree-budget` ×2, `left-search-big`, `paragraph-restyle`, `large-open-panel`, `progressive-large`, `frame-pdf`, `tail-follow`), layout or environment (`demo-tour`, `frame-viewers`, `source-place`, `reading-rows`: a ResizeObserver warning, `operations-copy`: a drag fetched two grammar chunks, `pane-close-guard`). Five overlap M4 (`demo-tour`, `frame-viewers`, `frame-pdf`, `large-open-panel`, `tail-follow`). The suite took 103 minutes there. Logs in `runs/2026-11-26-import/logs/verify-ci-windows-*` | CI runs no browser suite until these pass on a hosted runner (or the budgets scale with the machine); a person runs it on a Windows desktop | M | |

## Release

The first tag of the reader architecture: v0.2.0, a macOS pre-release. The plan, its order and gates, and the
investigation behind these rows are in `reports/2026-11-26-release-readiness/`. The hand run on the Mac was done on
2026-11-27 and round 16 (P11, P12, F24) is not waited for; R10 and R11 turned out real; each is fixed on a branch of its own. R1 (macOS CI) landed with #774.

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| R13 | A 1 MB Markdown file shows its text in 1 to 4.4 s on macOS, but the main thread stays busy long after: 22 s in Chrome, 42 s until WebKit has set every paragraph, with 50 to 100 ms frames meanwhile (Windows Edge: 78 s, the progressive mount laying out per chunk). Switching back to its tab costs 27.8 s more in Chrome. Measured 2026-11-27, `reports/2026-11-26-release-readiness/07-macos-one-mb.md`; the real app window not measured. On macOS (hunt-02 CMD-03) a 1 MB file with hard breaks, links, lists and tables keeps tasks over 50 ms coming for 20 s after it opens (36 tasks, 2.4 s), a plain 1 MB file none, and a 3 MB rich file takes over 10 s: content, not size; probe `runs/2026-11-27-hunt-02/probes/CMD/busy.verify.mjs` | Long files are a stated use | M | |

## Next

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| B17 | Opening the Transforms panel (Alt+6) on a Markdown file of about 0.25 MB or more freezes the window: over 10 s at 0.47 MB | S1 freeze; `left/transforms-model.ts:132` `byNodes` parses the whole file again for every transform row, and `workOut` (`left/panels/transforms.ts`) checks its 12 ms budget only between rows, so one row is one task: renumber-list 33 s, table-align 27 s, unwrap 13 s at 0.47 MB in node, growing faster than the file; parse once per version and share it, and cut each row's work into pieces the budget can stop; hunt-02 CMD-01, probes `probes/CMD/tx.verify.page.mjs`, `tx.verify.mjs` | M | |
| B18 | After Links or Metadata has looked at a big Markdown file, the next panel key freezes the window: 6–7 s at 3 MB, over 10 s at 4.5–5 MB, and again whenever a file opens or the index changes | S1 freeze; `left/doc-links.ts:47` calls `pathMentions`, which parses the whole file a second time on the main thread (`packages/core/src/transforms/extract.ts:62`) though the store holds a parse; its cache key (`doc-links.ts:39`) includes `here.size`, so opening any file re-parses; Metadata reaches it through `linkCount`; take the mentions from the kept parse and key them by version alone; hunt-02 NAV-02 and CMD-02, probes `probes/NAV/links-repeat.verify.mjs`, `probes/CMD/metadata.verify.mjs` | S | |
| S17 | Spike: a shell over the File System Access API, booted by a web build, reading and saving a real folder in Chrome; report in `work\reach` | Measures what a browser host keeps and loses before any reader moves to wasm | M | `web-shell` |
| P11 | Budgets, slice 4 (lines of text): paste classify patterns O(n^2) on a line of spaces or `[` (`paste/classify.ts`); `carriesMarkdown` O(L^2) per line, lines uncounted below 5 MB (`reading/index.ts`); JSON Lines records parsed whole, no per-line cap (`reading/rows.ts`); `diff/words.ts` tokenises every line before `MAX_TOKENS` | A hostile file or paste can hang a reading | M | `budgets-4` |
| P12 | Budgets, slice 5 (containers): `archiveSums` joins every path prefix (`viewer/archive.ts`); office `find` BFS with `shift()` (`office/xml.ts`); book `TOC_DEPTH` bypassed by link-less headings; mime `delimiters` rescans each level; cert `checkTree` no node cap | Same: unbounded work on bytes the reader did not write | M | `budgets-5` |
| P13 | In Chromium (the Windows window, and the hunts' measurements), opening a long Markdown file stays busy for a time that grows 3-4x per doubling: every background typesetting slice pays one style recalculation of the whole page, 8-19 ms at 250-500 KB of technical Markdown, and slices then shrink to one paragraph each (`IDLE_SLICE_MS`), so the cost is paragraphs x page | Measured on branch `typeset-batch-reads` (2026-11-27): inserting any element into one paragraph costs a restyle of 8-12 ms at 250 KB and 19 ms at 500 KB in Chromium and about 1 ms in WebKit, while a class or inline style costs 0.1-0.2 ms; with every `:has()` rule in the sheets switched off it falls to 0.5 ms, and any one of the 34 alone brings it back. Close to one batch per paragraph: about 1,950 forced layouts, two a batch, for some 1,200 paragraphs of a 0.5 MB technical file. Either restyle less (fewer or scoped `:has()` rules, checked by a probe like `has-restyle.test.mjs`) or let a slice grow while its cost is the fixed recalculation (a trade against the frame time `IDLE_SLICE_MS` keeps). The hang-advance read that the batch also made is gone on that branch; hunt-03 MEA-01 is this on macOS Chromium | M | |
| E22 | Geometry table: one record per top-level block (element, byte range, top, height, measured or estimated), kept current by size notifications; position, spine, holdPlace and Source return stop reading the whole page | The DOM stops being asked block by block; near-typeset builds on it | L | `geometry-table` |
| E23 | Near-typeset: bound the idle typesetting queue to what is near the reader; `done` means nothing near is unset; `setAll()` for export, print and the rag gate; the page held still by keepPlace during scroll (cut from `geometry-table`) | A long page is at rest about as fast as a short one | M | `near-typeset` |
| F24 | Teardown, what is still left: an open emitted live by Rust while no boot is subscribed (after the first take) is dropped; `createDocumentSignal` keeps its pane subscriptions after destroy until the panes go; if a boot's open callback throws, the held batches after it are lost | In-page reboots only, so latent | S | `teardown-2` |
| B4 | Opened from Finder or the Dock on a Mac, a `[[command]]` program or the external editor installed by Homebrew or mise is "not a program on the PATH" | S2, macOS; nothing in `src-tauri` sets `PATH`, and launchd's default holds neither `/opt/homebrew/bin` nor mise's shims; hunt-01 SHL-01, probe `probes/SHL/shl-01-02.verify.rs` | S | |
| B5 | Saving a file locked in Finder fails with "Operation not permitted" on a hidden temp name, and leaves that hidden file behind, undeletable | S2, macOS; the atomic write's staged copy carries the `uchg` flag, so writing, cleaning up and renaming all fail; the target is unchanged; hunt-01 SHL-04, probe `probes/SHL/uchg-save.verify.rs` | S | |
| B9 | A Word document of about 62,000 paragraphs or more does not open ("Maximum call stack size exceeded") | S2; every child node spread into one `append` (`viewers/office.ts:348`), the same pattern in `viewers/book.ts:304`, `source/format-ops.ts:261` (`Math.max(0, ...)`) and two export paths in `render/markdown.ts`; WebKit's limit is likely lower; hunt-01 VWR-03, probe `probes/VWR/b-docx-threshold.verify.mjs` | S | |

## Structure

From the code-quality review of 2026-11-27 (`main` `b30bf002`): `reports/2026-11-27-code-quality.md`. Q1, Q5 and Q9
touch none of the files M1's branches change and were started that day. Q3, Q4, Q6 and Q7 cut through
`rendered-view.ts`, typeset, the core readers or most import lines, so they wait for M1.

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| Q2 | One key router that knows what owns the keyboard (page, editor, modal, menu, palette, viewer): 53 keydown listeners and about 10 document or window dispatchers ordered by capture phase and `stopPropagation`; whether a modal is open is decided at 16 sites with four or more selectors; `inEditable` twice. Takes P5's "route keys once" | Key bugs such as a menu that stops taking arrows come from that ordering. After the menu-freeze fix lands | L | |
| Q3 | Front-end layering: 38 of the 42 folders are in one value-import cycle; `appHandle()` is called 202 times in 78 files, viewers and document code included. Narrow interfaces passed in instead of the global; a dependency-direction rule in `check-boundaries` with a baseline that only shrinks; `frame/` as a named UI kit, the one-to-three-file folders merged | Nothing can be moved or tested alone. After M1, so the new rule fails no in-flight branch | L, gradual | |
| Q4 | Core's public surface: 489 imports of `@marxy/core/src/...` in 223 files (132 through the package), no `exports` map. Add the map and rewrite the imports; then split core into the Markdown engine, the format readers (about 13k lines: office, book, mail, archive, certificates) and the workspace (index model, paths, layout, position) | The import rewrite is what makes any later move cheap; it touches 223 files, so after M1 | M | |
| Q5 | Browser tests a hosted runner can pass: 466 fixed sleeps in 125 files, 441 launches for about 2,050 tests, timing budgets asserted as pass or fail, one preamble pasted 150 to 237 times. A shared test kit, waits on conditions, one boot per file, budgets recorded rather than failed; first slice: 20 to 30 files on a pull-request smoke job | CI runs no browser test (M4, M5) | L | `browser-test-kit` |
| Q6 | Split the long functions: `createRenderedView` (S9) with one scroll keeper for its five or more hold mechanisms and one place type for the eight or more the app has; typeset `attach()` (about 900 lines) after `split-place` and `fold-typeset`; `createArchiveViewer` 1,372, the table lens 1,091, `createOpenPath` 1,003, `readRtf` about 736 lines | 43 front-end functions are over 200 lines. After M1, with E22 | L, gradual | |
| Q7 | One windowed-row engine for the six or more lists that build their own (side-panel rows, reading rows, reading lines, table lens, hex, archive) | Each has its own scrolling bugs. With E22 | M | |
| Q8 | Shared pieces: the scaffolding every viewer repeats; 12 hand-made caches; `plural` 25 times, 17 of them printing the bare number and the rest grouping it, so one panel says 1234 files and another 1,234; in core four `utf8Length`, four `extensionOf`, 11 line splitters; in Rust a second `ShellError` (`commands/os.rs`), 89 platform `cfg` lines inline in `atomic_write.rs`, and `main.rs` at about 1,700 lines of non-test code with two `#[path]` includes | Copies drift | M, gradual | `shared-pieces` |

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
| P5 | `one-view`: split the view's main function (Q6); routing keys once is Q2 | See S9 | L, gradual |
| P6 | `invites`: `.ics` and `.vcf` as cards; the usable parser is MPL or large | Held | S |
| P7 | `read-aloud`: the page read by a local Windows voice | Held | M |
| R15 | iCloud Drive placeholder ("dataless") files are not recognised: a read, the index walk or a save may stall while the file downloads | Unverified; try it by hand on the Mac | S |
| R16 | Every save on macOS gives the file a new creation date (the replace is a new inode) | Finder's "Created" resets | S |
| R17 | Browser files on macOS overran their waits by minutes (`frame-media`, `frame-viewers`, `frame-pdf`); the runs coincided with the laptop sleeping, so re-run them held awake (`caffeinate -i`) before calling any of it a hang | Settles whether the browser suite can join the macOS CI job (M4) | S |
| R18 | Round 16's review residue: the held-open queues are unbounded while no boot listens, a live open can land before older held batches, pastes over 4 MB paste as text, a file of only over-long records is no longer JSON Lines (`runs/2026-11-24-round-16/README.md`) | After round 16 lands | S |
| R19 | Waves 1 to 4 residue: the warm store is lost after a same-tab link and Back and after a cross-file replace; `typeset-view`'s block-list patch applies in about half the cases (`STATE.md`, "Risks") | Speed, not correctness | S |
| R21 | macOS startup has never been measured (Windows: 774 ms median to first text) | For the release notes, not a gate | S |
| B19 | Opening, folding or hiding the drawer, or changing the window's width, stalls a 1–3 MB page for 0.15–0.45 s each time | S3 slow; a width change relays the page and rebuilds the whole block list, with `getBoundingClientRect` called about 7,000 times at 1 MB and 90,000 at 5 MB; hunt-02 RDR-01 (with NAV-03) and RDR-02, probe `probes/RDR/layout.verify.mjs` | M |

## Housekeeping

About the machines' workspaces, not this repository: H4 and H5 the Windows machine, H6 the Mac.

| # | What | State |
| --- | --- | --- |
| H4 | `worktrees\furniture` and `worktrees\shortcuts` could not be deleted (a file in each held open) | Retry after a restart |
| H5 | `worktrees\exe` holds another session's uncommitted `hex.ts` and `frame.css` edits on `a6032b26`, so the installer script refuses it | That session's to clear |
| H6 | About 570 worktrees beside the Mac checkout are from the earlier architecture, 93 with uncommitted edits, and its main checkout holds 345 untracked files under `orchestration/` | After the tag: a patch per dirty worktree, then remove; every branch is tagged `archive/branch/<name>`; never `git clean` the checkout |
