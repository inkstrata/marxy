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
