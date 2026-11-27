# Hunt 01: Verification

Append-only. Write through .claude/skills/bug-catch/finding.mjs.

### SHL-03 verdict
- Verdict: PLAUSIBLE
- Proof: code reading: `sameFilePath`/`fileKey` (paths.ts:40-71) fold case only for Windows paths and resolve no links, so a disk-case or canonical event path never equals a lexically spelled open path on macOS. Premise rests on the open path keeping the link's spelling, which depends on whether link opening canonicalises (not confirmed; case-insensitive disk verified). Needs the real window to drive: open via a case-variant link, edit target externally.
- Severity: S3 wrong result
- Fix hint: have the shell return the canonical path on open and use it as the document's watch/open key, or compare by file identity.
- Checked by: verifier SHL, 2026-11-27

### SHL-04 verdict
- Verdict: PLAUSIBLE
- Proof: catcher's probes/SHL/uchg-copy.out re-read: readonly() false, fs::copy Ok, open-for-write PermissionDenied on the copy; matches atomic_write.rs stage sequence. I did not re-run it or drive a real save, so the leftover hidden file is unproven. Not in work/todo.md, not documented as by-design.
- Severity: S2 wrong result
- Fix hint: refuse when the destination has UF_IMMUTABLE (stat st_flags), or clear flags on the temp after copy; remove the temp via chflags nouchg first.
- Checked by: verifier SHL, 2026-11-27

### SHL-01 verdict
- Verdict: CONFIRMED
- Proof: probes/SHL/shl-01-02.verify.rs, output shl-01-02.verify.out: with PATH=/usr/bin:/bin:/usr/sbin:/sbin (launchd's default; `launchctl getenv PATH` is empty on this Mac, so a Finder/Dock launch gets that) Command::new("rg"), "node" and "brew" fail NotFound, git (in /usr/bin) runs. grep of src-tauri finds no PATH/SHELL/LSEnvironment set-up (only a Windows test sets PATH at run.rs:676); run.rs:229 and os.rs:257 spawn by bare name. Not driven in the packaged window. docs/using-marxy.md:370 says only "through the shell"; nothing marks this by design.
- Severity: S2 wrong result (Mac, Finder/Dock launch only)
- Fix hint: at startup on macOS resolve the login shell's PATH (`$SHELL -ilc 'echo $PATH'`, with a timeout) and set_var it, or search it when spawning.
- Checked by: verifier SHL, 2026-11-27

### SHL-02 verdict
- Verdict: PLAUSIBLE
- Proof: this Mac is case-insensitive APFS (diskutil says APFS, not case-sensitive); probes/SHL/shl-01-02.verify.out and canon.verify.out. The catcher's first repro does NOT fail: `<root>/Images/a.png` under an opened root `notes` passes `may_hold` (prefix is the root's own spelling) and `fs::canonicalize` returns the disk case (`.../notes/images/a.png`), so `holds` succeeds. Only a path whose opened-root prefix differs in case (`.../NOTES/images/a.png`, root opened as `notes`) fails `may_hold` though the disk opens it. Mirrored spelling()/under() in a standalone program; the real `resolve` was not run (no tree edits).
- Severity: S3 wrong result (rare: roots come from the picker and are canonical, so a differing root case needs a lexical link or typed path)
- Fix hint: on macOS fold case in `spelling`, or fall back to the canonical path before refusing in `may_hold`, as the memory shell does.
- Checked by: verifier SHL, 2026-11-27

### SHL-04 verdict
- Verdict: CONFIRMED
- Proof: Replaces the earlier verdict: my own run of probes/SHL/uchg-save.verify.rs (output uchg-save.verify.out) on a fresh mktemp folder, steps copied from atomic_write.rs stage and failure cleanup. After `chflags uchg doc.md`: readonly() false; create_new temp Ok; fs::copy Ok (the temp gets the uchg flag, ls -laO shows it); open-for-write of the temp fails "<dir>/.doc.md.marxy-tmp-...: Operation not permitted (os error 1)", which is the text the reader would see; cleanup remove_file(tmp) fails with the same error, so the hidden temp stays; rename over the target also fails; target keeps "old". Removal of the leftover by the same remove_file call fails, so the leftover sweep (which also uses a plain remove) would too (not run). The flow through the real app was not driven. Cleanup done: chflags -R nouchg then folder deleted.
- Severity: S2 wrong result
- Fix hint: refuse when the destination has UF_IMMUTABLE (st_flags) with the read-only message, and clear the flag on the staged temp (chflags nouchg) before writing or cleaning up.
- Checked by: verifier SHL, 2026-11-27

### NAV-04 verdict
- Verdict: CONFIRMED
- Proof: probes/NAV/panel-freeze.verify.mjs (output panel-freeze.verify.out) with a different regex, `#/(\w+\s?)+$/` on a 12-word line, then Tab: page.evaluate stalls past 10 s (1 run; the catcher's freeze.mjs also stalls). probes/NAV/matchlines.verify.mjs (output matchlines.verify.out) times `matchLines` alone on `a`*n+`!` with /(a+)+$/g: 67, 200, 860, 3498, 15166 ms for n=20, 24, 26, 28, 30, so it doubles every two letters and 36 letters is minutes. The cause is as named: search.ts:259 calls matchLines synchronously with no guard.
- Severity: S1 (agrees)
- Fix hint: run the per-file matching in a worker or in chunks that yield, with a time budget that gives up with a note ("this pattern is too slow"); a browser test that types a backtracking regex into the panel and then presses a key.
- Checked by: verifier NAV, 2026-11-27

### NAV-05 verdict
- Verdict: CONFIRMED
- Proof: code: left/panels/search.ts:605-619 gives `lb` and an identical `placeholder`, and ui.ts:107-118 draws both; the catcher's screenshot probes/NAV/search-fields-find-find.png shows "Replace  Replace" in the empty Replace row. No doc in docs/ asks for both.
- Severity: S3 (agrees)
- Fix hint: drop the placeholder (keep the aria-label) or the label in the two fields.
- Checked by: verifier NAV, 2026-11-27

### NAV-06 verdict
- Verdict: NOT-REPRODUCED
- Proof: probes/NAV/go.verify.mjs (output go.verify.out) drove `o`, Enter, Meta+Enter, Control+Enter, Meta+o, Shift+o on a hit row, with Replace empty and holding "XYZ", in the browser build (not a real Mac window). `o` and Shift+o went to the hit in both cases (the foot shows the row's `o go`), so "Go does nothing" did not happen. Enter on a hit with Replace text is deliberately "replace on this line" (search.ts:709-720). docs/keys.md:132-136 gives panels `O` for beside and Enter for the verb menu; it does not promise Mod+Enter in a panel, so the ignored Cmd+Enter (frame.ts:537 returns on metaKey) is not a documented break. The probe's per-key state carried over between presses, so its Meta+Enter lines are not reliable evidence either way.
- Severity: S3 (agrees)
- Fix hint: if the owner meant Go with Replace filled, show "Enter replace" in the foot; ask the owner for the exact click or key; try on the real Mac window.
- Checked by: verifier NAV, 2026-11-27

### NAV-01 verdict
- Verdict: DUPLICATE of NAV-06
- Proof: NAV-06 covers Go on the search page; it could not be made to fail (see its verdict), so this one stays unreproduced with it.
- Severity: S2 (was S2; unproven)
- Checked by: verifier NAV, 2026-11-27

### NAV-02 verdict
- Verdict: DUPLICATE of NAV-05
- Proof: the Search panel's Find and Replace fields repeat label and placeholder; NAV-05 is confirmed with a screenshot.
- Severity: S3 (agrees)
- Checked by: verifier NAV, 2026-11-27

### NAV-03 verdict
- Verdict: DUPLICATE of NAV-04
- Proof: the one freeze in search mode that reproduces is the regex freeze in the Search panel, NAV-04.
- Severity: S1 (agrees)
- Checked by: verifier NAV, 2026-11-27

### RDR-01 verdict
- Verdict: CONFIRMED
- Proof: probes/RDR/xray-bom.verify.mjs (output .verify.out): default `new TextDecoder()` returns "# T" for EF BB BF "# T", `ignoreBOM:true` keeps U+FEFF; xray-lines.ts:21 uses the default. No doc promises X-ray shows bytes as written including a BOM (docs/architecture.md:41 says the buffer keeps the BOM, docs/using-marxy.md:250 only names X-ray), so it is a gap, not a stated promise. Not driven in the window
- Severity: S3 (agrees)
- Fix hint: `new TextDecoder('utf-8', { ignoreBOM: true })` for the first line, or mark the BOM; test via xrayLines on a BOM file
- Checked by: verifier RDR, 2026-11-27

### RDR-02 verdict
- Verdict: PLAUSIBLE
- Proof: margin.ts:244 observes `pane.host`, :237 unobserves `article` (a different element: pane/dom.ts and pane-set.ts give host and article as separate fields); unobserve of a non-observed target is a no-op, so the host stays observed after the pane goes. ResizeObserver targets cannot be listed, so not driven; effect is a leak plus redundant redraw callbacks from a detached host (which fires nothing once detached, so the practical harm is a retained reference)
- Severity: S3 (agrees)
- Fix hint: `resized.unobserve(host)` with the host kept in `watched`
- Checked by: verifier RDR, 2026-11-27

### RDR-03 verdict
- Verdict: CONFIRMED
- Proof: probes/RDR/rtl-table.verify.mjs (output rtl-table.verify.out) with `--browser chromium`: table direction rtl, cw=sw=3052, scrollLeft 0, cut "-2180px", note "39 more columns", column 0 right edge at 3052 (columnsOf wide-tables.ts:71 measures `right - origin` assuming LTR). WebKit not driven: `shots` only accepts msedge/chrome/chromium; Playwright 1.63 WebKit (webkit-2359) is installed, but the fault is in the app's measuring arithmetic, which is engine independent. Real WebKit run would need a browser-tests harness file
- Severity: S2 (agrees)
- Fix hint: in rtl tables measure column ends from the right edge (or use scrollLeft negative range), and never set a negative cut; test: open an Arabic page with a 40-column table and check it scrolls
- Checked by: verifier RDR, 2026-11-27

### EXP-03 verdict
- Verdict: PLAUSIBLE
- Proof: code reading on this commit: apps/desktop/src/export/page.ts printPane adds the @page, range, fold rules and data-marxy-print, calls window.print(), then runs `done` after an unconditional setTimeout of 1000 ms, which deletes them; afterprint is only a second trigger. No Rust print command exists. Whether WKWebView's print returns before the sheet has rendered cannot be driven in a browser build; it needs the real macOS window with Letter, folds open and a part selected, then Print to PDF and look at the sheet preview.
- Severity: S2 (agrees, if the timing holds)
- Fix hint: do not remove the rules on a timer; remove on afterprint only, with a long fallback (or on the next focus/keydown) for engines that never fire it.
- Checked by: verifier EXP-b, 2026-11-27

### EXP-04 verdict
- Verdict: CONFIRMED
- Proof: probes/EXP/b-cr-panel.verify.mjs (output b-cr-panel.verify.out) through the real panel: a planted CR-only .md, the "two words" paragraph selected with cursorAt, Export, What: The selection, As: Markdown as written, Save. The panel says "paragraph, line 3" and offers cr-lines-3-3.md; the file written to /demo/o-cr.md is empty ("") and the notice reads "Exported o-cr.md" with no warning. Cause as named: lineSpan/lineStarts (selection/cursor.ts:174-205) count a lone CR, linesBytes (export/model.ts:134) counts only 0x0a.
- Severity: S2 (agrees; silent empty export from a valid file)
- Fix hint: make linesBytes use the same line rule as lineStarts (LF, or CR not followed by LF), or slice by the part's byte range; test: export the selection of a CR-only file and compare bytes. lineOfIn in export.ts:~85 also counts LF only, so check it too.
- Checked by: verifier EXP-b, 2026-11-27

### EXP-05 verdict
- Verdict: CONFIRMED
- Proof: probes/EXP/b-double-save.verify.mjs (output b-double-save.verify.out): two clicks on "Save the page…" call shell.saveDialog 2 times (go at export.ts:410 calls run with no busy flag). The extra native sheets in the real window and the slow-build timing were not driven. The silent null is by code reading: build returns null for html/text without an article and jsonl without a snapshot, and run returns at `if (out === null) return` with no notice.
- Severity: S3 (agrees)
- Fix hint: a busy flag in run that disables the buttons until it settles; notify a refusal where build returns null.
- Checked by: verifier EXP-b, 2026-11-27

### EXP-02 verdict
- Verdict: CONFIRMED
- Proof: probes/EXP/a-panel.verify.mjs (output a-panel.verify.out), driven through the Export panel (This file, As a web page, click the primary Save button) on planted Markdown of 150/300/600 sections: Save click to a keydown answering took 183 ms / 1207 ms / STALLED over 10 s. Code agrees: export.ts:290 calls partHtml, which calls htmlFromRange per top block, and cloneRangeInert (copy-text.ts:35-37) walks every article child with intersectsNode per block. Catcher's scale.out shows raw, text and pdf at ~100 ms on the same file
- Severity: S1 (agrees); fixtures/demo files are tiny (largest .md 3.5 KB), so it needs a long file, from about 300 sections (1.2 s) up; macOS WKWebView not driven, likely slower
- Fix hint: in partHtml avoid per-block range clones over the whole article (build each block's HTML directly, or use a range whose common ancestor is the block); test: plant 600 sections, Save as web page, assert a key answers within a bound
- Checked by: verifier EXP-a, 2026-11-27

### EXP-01 verdict
- Verdict: DUPLICATE of EXP-02
- Proof: opening the panel and choosing a form before Save runs no partHtml (partHtml is called only from build/pageHtmlOf at export.ts:238,290, reached from run(); peek is zip-only); measured in probes/EXP/a-panel.verify.out: panel open 3-16 ms and choose-html 2-6 ms even at 600 sections, so merely using the tab does not freeze. Only Save as a web page on a long Markdown file does (EXP-02). Caveat: the owner's report names no file or choice, so this is a match on the only freeze found; the PDF path (EXP-03) is unproven in WKWebView and could also be what the owner hit
- Severity: S1 (agrees)
- Fix hint: fix EXP-02, then ask the owner which file and As choice they used
- Checked by: verifier EXP-a, 2026-11-27

### VWR-01 verdict
- Verdict: CONFIRMED (code reading; not driven, the browser build has no SQLite engine)
- Proof: sqlite.ts:640 `if (got.rows.length < EXPORT_PAGE || got.stopped) return;` ends the loop on a stopped page without recording it; table-cards.ts:109 builds the preview note from `cut` (the byte cap) only; the saved bytes get no note. Rust sets `page.stopped = "stopped after N s"` on interrupt at sqlite.rs:818 and returns the partial page, so the path is reachable. The page view does say it (sqlite.ts:341), so the export is the inconsistent surface. No doc or todo row says a silent cut is meant (searched docs/ and work/todo.md). The panel's sub-line promises "every row" (sqlite.ts:627).
- Severity: S2 wrong output
- Fix hint: have `build` report a stop (a flag or a second callback) so csvExport adds the note to the preview and warns the reader before save; the CSV itself cannot carry a note without breaking the format.
- Checked by: verifier VWR-b, 2026-11-27

### VWR-03 verdict
- Verdict: CONFIRMED
- Proof: my probe probes/VWR/b-docx-threshold.verify.mjs (output b-docx-threshold.verify.out), Chromium: a docx of 60,000 one-word paragraphs opens, 100,000 fails with "Maximum call stack size exceeded"; bisection puts the threshold between 61,640 (ok) and 62,656 (fails), about 62k paragraphs, not 120k. WebKit/WebView2 limits may be lower (not driven). Same spread at viewers/book.ts:304 (`article.append(...holder.childNodes)`, same pattern, not driven) and markdown.ts:234 and :256 (office-to-Markdown export only: a code block with 120k+ backtick runs, a table with 120k+ rows; not driven). A real long Markdown file is NOT affected: 300,000 paragraphs open (8.9 s, slow but no error); render/progressive.ts:237 spreads per slice, which is capped by characters, so it stays small. Also found: source/format-ops.ts:261 has the same `Math.max(0, ...)` on a selection with 120k+ backtick runs (not driven).
- Severity: S2 wrong output
- Fix hint: replace each spread with a loop or `append` in chunks (`for (const n of [...nodes])`, or a `reduce` for Math.max); the repair's test is the 100,000-paragraph docx.
- Checked by: verifier VWR-b, 2026-11-27

### VWR-02 verdict
- Verdict: CONFIRMED (related to R13; not a duplicate of P11 or R13)
- Proof: probes/VWR/a-sizes.verify.mjs (out a-sizes.verify.out), headless Chromium: eml of one unbroken line opens in 0.8 s at 50 KB, 1.4 s at 100 KB, 2.9 s at 200 KB, 7.8 s at 400 KB; CPU profile puts 99% in `draw` (mail.ts:332) with parse and textLines negligible, so the time is the browser's layout, not core. Cause is not the `pre-wrap; overflow-wrap:anywhere` the catcher blamed: probes/VWR/a-layout.verify.mjs shows that CSS alone lays out 400 KB in 20 ms. a-css.verify.mjs shows the cost comes from font kerning: a `.marxy-article` paragraph of 100 KB takes 1372 ms, and 3 ms with `font-kerning:none` or a monospace face. So any long unbreakable run set in the reading face pays it (the same article rule is why the catcher's 3 MB Markdown line took 23 s). P11 (core reading budgets, paste, JSONL, diff) and R13 (progressive mount per chunk, 1 MB many-line file) name different code paths; this is the layout of one unbroken run, so it is a new row, near R13 only in effect. Font-dependent: a real WebView with another face may differ; not driven there.
- Severity: S1 freeze (at 5 MB, the page does not answer for over 15 s)
- Fix hint: cap or split an over-long unbroken run (insert break opportunities or word-break past N characters, or set `font-kerning:none` on `.marxy-mail-line` and long runs) and note "shown in part"; also cap lines, since 800k short lines take 9.4 s (catcher).
- Checked by: verifier VWR-a, 2026-11-27

### VWR-04 verdict
- Verdict: CONFIRMED (related to P11/R13; not a duplicate)
- Proof: probes/VWR/a-sizes.verify.mjs (a-sizes.verify.out): rtf of one run of x opens in 2.9 s at 50 KB, 7.2 s at 100 KB, 14.8 s at 200 KB, 22.8 s at 400 KB, so 3 MB freezes. Profile: 98% of the time is inside `draw` (office.ts:280), core and markdown parse about 1% (readRtf is fast, as the catcher's fuzz1 shows). It is not `mapToFile` as suspected: the cost is the same browser layout as VWR-02, kerning of one long unbroken run in `.marxy-article p` (a-css.verify.mjs: 1372 ms at 100 KB, 3 ms with `font-kerning:none`). Slower than the mail (about 3.5x at the same size), likely from the article's narrower measure and extra passes; the docx 3 MB run being fast (catcher's hostile3) was not re-checked here. P11 and R13 name other paths (core reading budgets; progressive Markdown mount), so only related.
- Severity: S1 freeze
- Fix hint: same as VWR-02: break or cap a run longer than some thousands of characters before it reaches the article (in the reading or the viewer), or drop kerning for such paragraphs; one fix in the shared article path should cover Markdown, RTF and mail.
- Checked by: verifier VWR-a, 2026-11-27

### EDT-01 verdict
- Verdict: CONFIRMED
- Proof: own run of probes/EDT/edt01.verify.mjs (edt01.verify.out): stage an edit in a file no pane shows, change it on disk, quit, "Save and close": notices [] afterwards, disk unchanged, store still dirty, window stays. Cause read at close.ts:148-154: `s.save()` result 'failed' returns 'failed' with no notice, while left/held.ts:130 `saveHeld` does notify and is not used here.
- Severity: S2 wrong output (nothing lost; the reader is left with no reason)
- Fix hint: in the held-files `save()` call `saveHeld(s)` (or show showSaveFailedNotice with the error) before returning 'failed'.
- Checked by: verifier EDT, 2026-11-27

### EDT-02 verdict
- Verdict: PLAUSIBLE
- Proof: the defect is real in code and in the injected case: probes/EDT/edt02b.verify.out (rerun of the catcher's scenario): after the pane store's save rejects, notices [], and the 2nd and 3rd close requests give no prompt and no confirmClose (walk stays set; close.ts:204 returns when no notice is up; the Save click's async body, close.ts:~403, has no try/catch). Real throw sites found by reading: store.save catches write errors and returns 'failed' (store.ts:~722), save.ts rethrows only non-"is closed" errors from store.save, so the reachable ones are `deps.shell.saveDialog` for a scratch document (Tauri `save_dialog` returns Err only if the spawn_blocking join fails: a panic or IPC failure), `foldSource` rejecting inside doc.save, and `flushVersions()` rejecting after a good save. None is a refused write; no ordinary path throws. My second probe (edt02.verify.mjs) tried to make saveDialog reject on a scratch document but the override did not reach the call (the save was cancelled instead), so it proves nothing.
- Severity: S3 (rare trigger; S2 if one is found, since the window cannot be closed except by force-quit)
- Fix hint: wrap the Save click's async body in try/catch/finally that calls prompt.stop (and clears `walk`), and do the same for the Discard path.
- Checked by: verifier EDT, 2026-11-27

### EDT-03 verdict
- Verdict: BY-DESIGN
- Proof: docs/using-marxy.md:263-266 says "A paste into Source that carries HTML ... goes in as Markdown ... Mod+Alt+Shift+V pastes the plain text unconverted", with no limit to Markdown files, and docs/keys.md:80 lists the plain paste. Own run probes/EDT/l.verify.mjs (l.verify.out, fixed the catcher's toggle): HTML paste converts in every Source buffer: .py gets ``` fences, a JSON-looking div becomes `{\` / `\[1, 2\],\` (escaped, invalid JSON), a table into .csv becomes `| 1 | 2 |` / `| --- |`, bold in .txt becomes `**bold**`. So it is real as behaviour and the escapes in JSON/code are plainly unwanted, but the doc promises exactly this conversion.
- Severity: S3 (workaround: Mod+Alt+Shift+V; one undo)
- Fix hint: if the owner wants it changed, skip conversion in pasteExtension (paste.ts:116) when the open file is not Markdown, and say so in docs/using-marxy.md.
- Checked by: verifier EDT, 2026-11-27
