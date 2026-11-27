# Hunt 01: Findings

Append-only. Write through .claude/skills/bug-catch/finding.mjs.

### EXP-01 · Using the Export tab freezes the app
- Severity: S1 freeze
- Domain: export
- Where: apps/desktop/src/left/panels/export.ts (not yet located)
- Repro: owner's report, macOS build: open the Export panel (the seventh) and use it; the app stops answering. Which choice or which file triggers it is not yet known
- Expected: the panel answers; an export saves through the save dialog and the window keeps working
- Actual: the app freezes
- Evidence: the owner's report, 2026-11-27; not yet reproduced
- Confidence: low
- Found by: owner, 2026-11-27

### NAV-01 · Go does not work on the search page
- Severity: S2 broken feature
- Domain: navigation
- Where: apps/desktop/src/line/scopes.ts, apps/desktop/src/palette/view.ts, apps/desktop/src/left/panels/search.ts (not yet located)
- Repro: owner's report, macOS build: on the search page, Go does nothing. Which "Go" (the Line's default scope, "Go to a file or heading", or a Go control on the search page or panel) and which "search page" (the left Search panel, the workspace search `#`, find `/`) are not yet known
- Expected: Go takes the reader to the file, heading or result chosen
- Actual: nothing happens
- Evidence: the owner's report, 2026-11-27; not yet reproduced
- Confidence: low
- Found by: owner, 2026-11-27

### NAV-02 · The Find and Replace fields read "Find Find" and "Replace Replace"
- Severity: S3 cosmetic
- Domain: navigation
- Where: apps/desktop/src/find/ (not yet located)
- Repro: owner's report, macOS build: open Find/Replace; each field's label and its default (placeholder) text say the same word side by side, so the reader sees "Find Find" and "Replace Replace"
- Expected: the word once per field: a label or a placeholder, not both
- Actual: the word twice
- Evidence: the owner's report, 2026-11-27; not yet reproduced
- Confidence: low
- Found by: owner, 2026-11-27

### NAV-03 · The app freezes in search mode
- Severity: S1 freeze
- Domain: navigation
- Where: apps/desktop/src/left/panels/search.ts, apps/desktop/src/find/, apps/desktop/src/line/scopes.ts (not yet located)
- Repro: owner's report, macOS build: in search mode the app stops answering. Which search (the left Search panel, the Line's `#` workspace search, find `/`) and what query or folder are not yet known
- Expected: search answers while it runs and its results can be opened
- Actual: the app freezes
- Evidence: the owner's report, 2026-11-27; not yet reproduced. May be the same fault as NAV-01 (Go does nothing on the search page) if the page is frozen when Go is pressed
- Confidence: low
- Found by: owner, 2026-11-27

### SHL-01 · On a Mac, a [[command]] program or external editor installed by Homebrew or mise is "not a program on the PATH"
- Severity: S2 wrong result
- Domain: SHL
- Where: apps/desktop/src-tauri/src/commands/run.rs:180-190 (spawn by bare name), apps/desktop/src-tauri/src/commands/os.rs:255-270 (`spawn_detached`), apps/desktop/src-tauri/src/main.rs (no PATH set-up at startup)
- Repro: macOS only, real window launched from Finder, Dock or Spotlight; config.toml `[[command]] name="fmt" run=["prettier","--stdin-filepath","x.md"]` (or `external_editor = "code -g {file}:{line}"`); run it from Transform or "Open in external editor"
- Expected: the program the reader's Terminal finds (`/opt/homebrew/bin`, mise shims, `~/.local/bin`) runs, as docs/using-marxy.md:369,398,419 promise ("run on the selection or file through the shell")
- Actual: a GUI app started by launchd inherits only `/usr/bin:/bin:/usr/sbin:/sbin`; `Command::new("prettier")` fails NotFound and the sheet says "prettier is not a program on the PATH". Nothing in src-tauri reads the login shell's PATH, sets `PATH`, or the bundle's LSEnvironment (grep for set_var/PATH finds only a test)
- Evidence: code reading alone (grep of src-tauri/src for `set_var`, `SHELL`, `PATH` finds no augmentation; the only `Command::new(program)` sites are run.rs and os.rs). Works when launched from a terminal (`open` does not help) which hides it in development
- Confidence: medium
- Found by: catcher SHL, 2026-11-27

### SHL-02 · On a Mac, an image or link whose folder or file name differs from the disk only in letter case is refused (broken image)
- Severity: S2 wrong result
- Domain: SHL
- Where: apps/desktop/src-tauri/src/file_scheme.rs:38-70 (`spelling` folds case only under `cfg!(windows)`), :191-200 (`may_hold` judges by spelling before the disk is asked), :255-266 (`resolve`)
- Repro: macOS only (default case-insensitive APFS), real window; open fixtures/demo markdown that holds `![x](Images/a.png)` while the folder on disk is `images/`; or any `read_file`/`marxy-file://` of a path spelled `/Users/me/notes/Docs/a.md` under a folder opened as `/Users/me/notes/docs`
- Expected: one file is one file on a volume that treats the two spellings as one name (the browser build's memory shell does: shell/memory.ts `fold` with `caseInsensitive`, "APFS by default is case-insensitive")
- Actual: `may_hold` compares the raw spelling with the opened folder's spellings case-sensitively on macOS, so `resolve` returns `Refusal::Outside` and `marxy-file://` answers 403 (`readRange`/images/fonts) and `read_file` refuses, though the disk would have opened it. The case-insensitive twin hides this in the browser build
- Evidence: code reading alone: `spelling()` `fold` is `if cfg!(windows) { s.to_lowercase() } else { s.to_owned() }`; the only case-insensitive test (file_scheme.rs:1212) uses upper-cased paths and is a Windows behaviour. Not driven in the real window
- Confidence: medium
- Found by: catcher SHL, 2026-11-27

### NAV-04 · A regular expression typed into the Search panel's Find field freezes the window
- Severity: S1 freeze
- Domain: navigation (left Search panel)
- Where: apps/desktop/src/left/panels/search.ts:259 (`matchLines(text, c.re)` in `ensure`), apps/desktop/src/left/search-model.ts:96-111 (`matchLine`, `matchLines`)
- Repro: open a text file whose line is 36 letters `a` then `!`; Mod+K, type `#/(a+)+$/`, Tab (keeps it in the Search panel, regex on). Any regex that backtracks badly on a long line does it, for example `(\w+\s?)+$`
- Expected: the window keeps answering; a search that cannot finish is cut off or yielded
- Actual: the page stops answering; a probe's `page.evaluate` times out after 10 s
- Evidence: probes/NAV/freeze.mjs (output probes/NAV/freeze.out): mode `panel` prints "FAIL alive after STALL >10000ms". The same query in the Line's `#` and `/` scopes did not stall in that probe. Cause by reading: `ensure` runs `matchLines` over every file in one synchronous loop on the main thread, with no step limit, no yield between files or lines, and the user's regex used as typed; only the settle delay (SETTLE_MS) precedes it, so each keystroke of a half-typed pattern can start one. Supersedes NAV-03 (this is the freeze I could reproduce); on a big workspace the same loop also has no yield between files (not driven).
- Confidence: high
- Found by: catcher NAV, 2026-11-27

### SHL-03 · A document opened by a link under another spelling of its path (letter case, or a symlinked folder) never live-reloads and is not noticed as deleted
- Severity: S3 wrong result
- Domain: SHL
- Where: apps/desktop/src-tauri/src/watch/mod.rs:352 and :402-405 (`RootWatch::open` canonicalises the root and names events from `fs::read_dir`, so every event path is the disk's spelling); packages/core/src/position/watch-events.ts:21-23 and packages/core/src/index-model/paths.ts:42-71 (`fileKey`/`sameFilePath` fold case only for Windows paths, resolve no link); apps/desktop/src/shell/tauri.ts:620-627 (events handed on unchanged)
- Repro: macOS (case-insensitive APFS), real window; open fixtures/demo/plans/pg16-upgrade-plan.md, add a link `[x](PG16-Upgrade-Plan.md)`-style variant of another file's name in a sibling document (or a link through a symlinked folder), follow it, then edit the target in another program
- Expected: the open document follows the file as the doc promises for any open file (docs/using-marxy.md live reload)
- Actual: the watch is on `dirname(path)`, Rust reports `.../plans/pg16-upgrade-plan.md` (disk case) or the canonical path; `effectForOpenDocument` compares with the spelling the page opened, finds no match and answers `ignore`; no reload, no "removed" notice. Launch, picker and drop paths are canonicalised (main.rs:49-84, :316) which is why the usual routes work; a lexically-resolved link does not go through that
- Evidence: code reading alone (comparison functions quoted above; Rust unit test `the_comparison_does_not_resolve_a_link` at watch/mod.rs:1111 states that an event must name the open path itself). Not driven in the real window
- Confidence: medium
- Found by: catcher SHL, 2026-11-27

### SHL-04 · Saving a file locked in Finder fails with "Operation not permitted" on a hidden temp name, and leaves an undeletable hidden file behind
- Severity: S2 wrong result
- Domain: SHL
- Where: apps/desktop/src-tauri/src/atomic_write.rs:1066-1086 (`refuse_surprising_destination` tests only `permissions().readonly()`), :1494-1500 (`stage` copies the destination onto the temp with `fs::copy`), :1507-1511 (opens the temp for writing), :148-150 (`remove_file(&tmp)` on failure, result ignored)
- Repro: macOS only, real window; in Finder tick "Locked" on a document (or `chflags uchg doc.md`), open it, edit, save
- Expected: the same refusal a read-only file gets: "is read-only; marxy will not overwrite it" (docs/desktop-shell.md writing section), and no stray file
- Actual: `readonly()` is false for a user-immutable file, so the save goes on; `fs::copy` (fcopyfile, COPYFILE_ALL) carries the immutable flag onto the new hidden temp file, the next open for write fails PermissionDenied, the reader sees an io error naming `.doc.md.marxy-tmp-<pid>-<n>-<nanos>`; the cleanup `remove_file` also fails (immutable), so a hidden file stays beside the document, and the leftover sweep (`leftover::remove`) cannot remove it either, so one accumulates per attempt
- Evidence: probe probes/SHL/uchg-copy.rs (output in probes/SHL/uchg-copy.out) does exactly the stage sequence on this Mac: `readonly(): false`, `fs::copy` Ok, open-for-write of the copy fails with PermissionDenied; `os.remove` of an uchg file fails with Errno 1 (checked in a shell). The leftover file itself was not produced through the app
- Confidence: high
- Found by: catcher SHL, 2026-11-27

### NAV-05 · The Search panel's Find and Replace fields show their label and their placeholder as the same word
- Severity: S3 cosmetic
- Domain: navigation (left Search panel)
- Where: apps/desktop/src/left/panels/search.ts:605-619 (`lb: 'Find'` with `placeholder: 'Find'`, `lb: 'Replace'` with `placeholder: 'Replace'`), apps/desktop/src/left/ui.ts:107-118 (`fld` draws both the label span and the placeholder)
- Repro: open any file, Search panel (fourth rail icon); clear the Replace field: it reads "Replace Replace"; an empty Find reads "Find Find"
- Expected: one word per field
- Actual: the label and the greyed placeholder repeat each other
- Evidence: screenshot probes/NAV/search-fields-find-find.png (from probes/NAV/go2.mjs) shows "Replace  Replace" in the empty Replace row. Supersedes NAV-02. The Find field in the page (find/view.ts:647) has only an aria-label, so it is the panel only.
- Confidence: high
- Found by: catcher NAV, 2026-11-27

### NAV-06 · Go on the search page could not be made to fail; a Cmd+Enter in the Search panel is ignored on a Mac
- Severity: S3 wrong but with workaround
- Domain: navigation (left Search panel, Line)
- Where: apps/desktop/src/left/frame.ts:537 (`if (e.defaultPrevented || e.ctrlKey || e.metaKey ...) return;` before the row keys), apps/desktop/src/left/panels/search.ts:709-720 (hit row `enter: replace` when Replace holds text)
- Repro: macOS: Mod+K, `#postgres`, Tab (panel); Down, J to a hit; press Cmd+Enter or Cmd+O for "beside"
- Expected: the panel's Go verbs accept the Mod chord the Line's hints name (`Mod+Enter`, beside)
- Actual: the panel returns early on any metaKey, so only the click with Cmd and Shift+O open beside; nothing happens on Cmd+Enter. Also: with text in Replace, Enter on a hit row runs "replace on this line" instead of going there, so Enter looks like it does nothing (in my probe the page did not move and the heading stayed unchanged)
- Evidence: Supersedes NAV-01 as far as I could take it. Reproduced in probes/NAV/go.mjs and go2.mjs (browser build, platform MacIntel): Line `#postgres` then Enter opens the hit's file; panel `o` jumps the page to the hit (shot a-o); a click on a hit works; Line Go with a search result active works. Not reproduced: "Go does nothing". The Enter-with-Replace and Cmd+Enter paths are code reading plus one probe step, not driven on a real Mac window.
- Confidence: low
- Found by: catcher NAV, 2026-11-27

### VWR-01 · Exporting a slow SQLite view as CSV writes a partial file and says nothing
- Severity: S2 wrong output
- Domain: viewers (sqlite)
- Where: apps/desktop/src/viewers/sqlite.ts:640, apps/desktop/src/viewers/table-cards.ts:109, apps/desktop/src-tauri/src/tables/sqlite.rs:818
- Repro: open a .sqlite whose view needs more than 2 s to produce its rows (e.g. a view over a recursive CTE); Export panel; "<view> as CSV"
- Expected: every row, or a visible note that the file stops where the query was cut off (the page itself says "The query was stopped after 2 s: these are the rows it gave before then")
- Actual: the export loop returns on `got.stopped` and `csvExport` only adds a note for the byte cap (`cut`); the preview and the saved CSV carry no sign the rows are incomplete, so a reader takes a truncated table for the whole one
- Evidence: code reading alone. sqlite.ts:640 `if (got.rows.length < EXPORT_PAGE || got.stopped) return;` discards `got.stopped`; table-cards.ts:109 builds `note` from `cut` only; Rust sets `stopped` at sqlite.rs:818. Not driven (memory shell has no SQLite engine to time out).
- Confidence: medium
- Found by: catcher VWR, 2026-11-27

### EDT-01 · "Save and close" on staged files no pane shows fails without a word
- Severity: S2 wrong output
- Domain: EDT
- Where: apps/desktop/src/close.ts:166-176 (the `save()` of the held-files `DirtyDocument`), apps/desktop/src/close.ts:424-430 (the prompt's Save click)
- Repro: Search panel, replace in a file that is not open ("Stage N places") so it is held outside any pane; change that file on disk with another program; quit (Mod+Q or close box); on the notice "<name> has changes that are not saved, and no pane shows it." press "Save and close"
- Expected: the window stays, and a notice says why the write was refused (file changed on disk), as a pane's save says "Could not save ..." (save.ts showSaveFailedNotice)
- Actual: the notice disappears, the window stays open, nothing says why; the staged edits are still unsaved and the reader is left guessing. A second quit asks again with the same silent result
- Evidence: probe probes/EDT/h.mjs (output probes/EDT/h.out): stage via held.storeToStage, plant other bytes on disk, emitCloseRequested, click "Save and close": notices [] afterwards, disk unchanged, held store still dirty, no confirmClose. Cause by reading: unseen stores are saved with `s.save()` directly (close.ts:169), which returns `{result:'failed'}` without the notice that save.ts shows; `held.ts` has `saveHeld` that notifies, but close.ts does not use it. Browser build (memory shell) only; the Rust guard gives the same `changed` refusal
- Confidence: high
- Found by: catcher EDT, 2026-11-27

### EXP-02 · Exporting a long Markdown file as a web page (or a bundle with web pages, or a joined page) freezes the window for minutes
- Severity: S1 freeze
- Domain: export
- Where: apps/desktop/src/export/page.ts:60-90 (partHtml), apps/desktop/src/selection/copy-text.ts:17-40 (cloneRangeInert), apps/desktop/src/left/panels/export.ts:290-296,333
- Repro: plant or open a Markdown file of about 600 sections (~90 KB, ~2400 blocks); Export panel; What: This file; As: A web page; Save the page. Same for the "A web page of each" bundle option and "One page" of ticked files that are open.
- Expected: the file is saved in about a second, the window keeps answering
- Actual: the main thread is blocked 10 s at 600 sections (16.7 s wall in the Export click), 1.4 s at 300, 0.24 s at 150; growth is worse than quadratic, so a 3000-section file never returns inside a 10 s race and every later evaluate stalls too
- Evidence: probes/EXP/prof.mjs (output prof.out): partHtml alone 242 ms / 1411 ms / 10431 ms for 150 / 300 / 600 sections, contentComplete 0 ms. probes/EXP/prof2.mjs: one htmlFromRange of the first block costs 0.8 ms at 600 blocks and 6.8 ms at 2400 blocks, because `r.selectNode(el)` makes the range's common ancestor the article, and cloneRangeInert walks every child of the article calling `range.intersectsNode` on each, for every top block: N blocks x N siblings. probes/EXP/scale.mjs: raw, text and pdf answer in ~100 ms on the same file, only html stalls (16.7 s at 600). partHtml is synchronous, so nothing paints or answers meanwhile. Supersedes EXP-01 (this is the cause I can reproduce for "Export freezes the app"; macOS WKWebView will be slower than this Chromium run). Print (PDF) did not freeze in the browser, see EXP-03.
- Confidence: high
- Found by: catcher export, 2026-11-27

### VWR-02 · Opening a mail whose text is one very long unbroken line freezes the window
- Severity: S1 freeze
- Domain: viewers (mail)
- Where: apps/desktop/src/viewers/mail.ts:348-366, apps/desktop/src/viewers/mail.css:30
- Repro: plant /h/a.eml = "From: a\r\n\r\n" + 5,000,000 x "x" (no spaces, no newlines; a base64 or minified blob in a text/plain part does the same); open it. Browser build, headless Chrome; the real webview not driven
- Expected: the message opens, or the line is cut with a "shown in part" note, as other viewers cap work on input the reader did not write
- Actual: `window.marxy.handle.open` does not settle and `page.evaluate(() => 1)` times out after 10 s more (the page is blocked; both waits expired at 15 s). 200 KB in the same shape takes 2.9 s to open (probe 2); the same 5 MB as spaced words opens in 1.6 s and 5 MB as plain .txt in 1.8 s, so the cost is this viewer's one `<p>` with `white-space: pre-wrap; overflow-wrap: anywhere`
- Evidence: probes/VWR/eml.mjs (output probes/VWR/eml.out: TIMEOUT TIMEOUT; probes/VWR/eml2.out: 200KB 2932 ms, 5MB words 1632 ms, txt 1770 ms, 800k short lines 9382 ms). Core is not the cause: probes/VWR/longline.mjs shows parseMessage and textLines take under 1 ms at 400 KB. The text viewer's own path (virtualised) is fine. Also seen: 800,000 short lines build 800,000 `<p>` and take 9.4 s, so `textBody` has no cap on lines either. Related to P12 only in kind, not a listed row.
- Confidence: high
- Found by: catcher VWR, 2026-11-27

### EXP-04 · The selection, as Markdown as written, exports the wrong lines from a file with bare CR line ends
- Severity: S2 wrong output
- Domain: export
- Where: apps/desktop/src/export/model.ts:134-144 (linesBytes counts only 0x0a), apps/desktop/src/left/panels/export.ts:305-308 and 80-90 (partOf takes its line numbers from lineSpan, which also counts a lone CR)
- Repro: open a text file whose lines end with a lone CR (`one\rtwo\rthree\rfour\r`); select the page's "two" line as a part; Export, What: The selection, As: Markdown/the file as written; Save
- Expected: a file holding `two\r`, named lines-2-2
- Actual: the panel says "line 2", the saved file is empty (for a later line it would hold the rest of the file or nothing), because linesBytes never sees line 2 start
- Evidence: probe probes/EXP/linesbytes.mjs (output linesbytes.out): lineSpan gives 2..2, linesBytes(bytes, 2, 2) returns "". Not driven through the panel, which needs a cursor selection.
- Confidence: medium
- Found by: catcher export, 2026-11-27

### EXP-03 · Print to PDF takes its page choices away after one second, before a macOS print sheet has drawn the page
- Severity: S2 wrong output
- Domain: export
- Where: apps/desktop/src/export/page.ts:150-160 (printPane: `window.print(); setTimeout(done, 1000)`), apps/desktop/src/left/panels/export.ts:237-240
- Repro: macOS real window only: any file, Export, As: A PDF, choose Letter, Folded sections open, a part selected; Print to a PDF
- Expected: the sheet previews and saves the page with the chosen paper, range, folds and colours
- Actual: by code reading, printPane adds the @page / range / fold rules and `data-marxy-print`, calls `window.print()`, then unconditionally runs `done` after 1000 ms, which deletes the rules and the attribute. Chromium's print blocks until the dialog closes so the browser build never shows this; WKWebView's print sheet returns at once and renders later, so the preview and the saved PDF would show the whole page in the app's colours, A4, folds and range gone
- Evidence: code reading plus probes/EXP/scale.mjs (window.print stubbed: panel answers in ~100 ms, no freeze in the browser build). Could not reproduce in the browser build; the real window is needed because print behaviour differs by engine. There is no Rust print command (grep -i print in src-tauri finds none), so macOS relies on WKWebView's own `window.print()`, which I could not run. Supersedes EXP-01 for the PDF path only (the freeze I reproduced is EXP-02).
- Confidence: medium
- Found by: catcher export, 2026-11-27

### RDR-01 · X-ray "As written" hides a file's byte order mark
- Severity: S3 wrong output
- Domain: RDR
- Where: apps/desktop/src/depths/xray-lines.ts:21, apps/desktop/src/depths/xray-lines.ts:62
- Repro: plant a Markdown file starting with EF BB BF then `# T`; open it; press x (X-ray) on the first heading
- Expected: line 1 of the "As written, line 1" box shows the file's bytes as stored, so the BOM is visible or marked (the file is otherwise shown with CR, tabs and trailing spaces marked)
- Actual: line 1 reads `# T`; nothing marks the three bytes. `new TextDecoder()` strips a leading BOM by default
- Evidence: probe probes/RDR/xray.mts (output probes/RDR/xray.out): `xrayLines` on `EF BB BF "# T\r\n..."` returns first text `# T`. Only the first line is affected; a range not starting at byte 0 shows no difference. Code reading plus a unit-level probe, not driven in the window
- Confidence: high
- Found by: catcher RDR, 2026-11-27

### RDR-02 · Closing a pane leaves its resize watcher behind in margin notes
- Severity: S3 leak
- Domain: RDR
- Where: apps/desktop/src/notes/margin.ts:238-247 (watch), :244 (observe), :237 (unobserve)
- Repro: open two panes with notes, close one (pane set changes), inspect the ResizeObserver's targets
- Expected: the observer stops watching a closed pane
- Actual: `watch()` calls `resized.observe(pane.host)` for each new pane but, for a pane that has gone, calls `resized.unobserve(article)`: the article was never observed, so the host stays observed (and referenced) until the whole installer is torn down; every resize of that detached host still fires the callback that schedules a redraw of all panes
- Evidence: code reading alone (observe on `pane.host`, unobserve on `article`, margin.ts); not driven
- Confidence: medium
- Found by: catcher RDR, 2026-11-27

### RDR-03 · A wide table in a right-to-left page runs off the pane and cannot be scrolled to
- Severity: S2 wrong output
- Domain: RDR
- Where: apps/desktop/src/render/wide-tables.ts:73-90 (columnsOf origin and ends measured from the left edge), :117-127 (cut width set from them)
- Repro: plant a Markdown file whose first paragraph is Arabic and which holds a 40-column table (header `عمود0..39`, two rows); open it in Read (probe probes/RDR/rtl-table.mjs, run with `--browser chromium`)
- Expected: the table is boxed to the column, fades on the side with more, says "N more columns", and scrolls sideways; column 0 (the rightmost, first in reading order) is visible
- Actual: the table is 3052 px wide in a 793 px column with scrollLeft 0 and scrollWidth equal to clientWidth, so it does not scroll; the page shows columns 39 to 29 running off the pane's right edge and the first columns are never reachable. `--marxy-table-cut` is set to `-2180px` (a negative width), the note says "39 more columns →", `data-marxy-more="end"`. The measuring code assumes left-to-right: column ends are `cell.right - boxLeft`, which in a direction:rtl table are the wrong edges
- Evidence: probe output probes/RDR/rtl-table.out and screenshot probes/RDR/out/rtl-table.png (Chromium, memory shell). Cause by code reading. Not tried in WebKit or the real window
- Confidence: high
- Found by: catcher RDR, 2026-11-27

### EXP-05 · Pressing Save twice in the Export panel opens two save dialogs and two builds, and a build that cannot run says nothing
- Severity: S3 wrong but with a workaround
- Domain: export
- Where: apps/desktop/src/left/panels/export.ts:277-282 (`go` calls `run` with no busy flag), 285-290 and 301-303 (`build` returns null with no notice when there is no article or snapshot), apps/desktop/src/export/write.ts:15-17
- Repro: macOS real window: Export, As: A web page on a long file, double-click "Save the page…" (or press Enter twice); the build is slow (see EXP-02) so the second click lands while the first is still building
- Expected: one build and one dialog; a refusal that says why
- Actual: each click starts its own `run`, so after the slow build two native save sheets queue (`save_dialog` spawns a blocking picker per call, main.rs:290-305) and two files can be written; and when `build` returns null (As html/text with no rendered article, jsonl with no snapshot) `run` returns without any notice, so the button appears to do nothing
- Evidence: code reading alone; the memory shell consumes its one queued save path on the first call and answers null to the second, so the browser build hides the second dialog. Not driven.
- Confidence: low
- Found by: catcher export, 2026-11-27

### VWR-03 · A Word, RTF or deck file with about 120,000 blocks will not open: "Maximum call stack size exceeded"
- Severity: S2 wrong output
- Domain: viewers (office)
- Where: apps/desktop/src/viewers/office.ts:348, packages/core/src/office/markdown.ts:234 and :256
- Repro: plant /h/w2.docx, a valid .docx whose word/document.xml holds 150,000 one-word paragraphs (probes/VWR/hostile.mjs builds it); open it. Browser build, headless Chrome
- Expected: the document opens (core reads it, the budget allows it), or is cut with a said note
- Actual: the page says "THIS FILE COULD NOT BE OPENED ... The system said: Maximum call stack size exceeded"
- Evidence: probe probes/VWR/hostile4.mjs, output probes/VWR/hostile4.out (w2.docx line). Core reads the same bytes fine: probes/VWR/docx-stack.mjs reads 20k to 400k paragraphs without error (docx-stack.out). The throw is `article.append(...holder.childNodes)` (office.ts:348), an argument spread past the engine's argument limit; the same pattern is `Math.max(0, ...rows.map(...))` for a table of that many rows (markdown.ts:256) and `Math.max(0, ...matches)` for a code block with that many backtick runs (markdown.ts:234), which feed Export as Markdown. Exact threshold not measured (V8's is near 120k arguments; WebKit's is lower, so the real window may fail earlier: not driven).
- Confidence: high
- Found by: catcher VWR, 2026-11-27
