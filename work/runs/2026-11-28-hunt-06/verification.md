# Verification

Append-only. Write through .claude/skills/bug-catch/finding.mjs.

### EDT-01 verdict
- Verdict: CONFIRMED
- Proof: probes/EDT/edt.verify.mjs, run twice, identical both times (output probes/EDT/edt.verify.out): on `one\r\ntwo\r\nthree\nfour\n`, End puts the caret at 4 (after the CR); typing X saves `one\rX\ntwo\r\n...`, Backspace saves `one\ntwo\r\n...`. buffer-commit.ts:20-31 confirms `\n` is the separator for a mixed file. No doc in docs/ declares this intended, and no todo row or other finding covers it.
- Severity: S1 (agrees; the reader's CRLF becomes lone CR or LF with nothing asked)
- Fix hint: keep the CR out of the caret's reach (End/selection stop before it, Backspace and typing skip it), or give each line its own separator; the test types after End in a mixed file and compares saved bytes
- Checked by: verifier A, 2026-11-28

### EDT-02 verdict
- Verdict: CONFIRMED
- Proof: probes/EDT/edt.verify.mjs, 2 of 2 runs (probes/EDT/edt.verify.out): block `hello\r\nworld` in a mixed file, Mod+Enter, End, Q, Escape leaves the store with `hello\rQ\r\nworld`. Same cause as EDT-01 (block-editor.ts baseExtensions uses the file's separator).
- Severity: S2 (agrees)
- Fix hint: fix with EDT-01's caret rule in the shared editor extensions; add a block-edit test over a mixed-ending block
- Checked by: verifier A, 2026-11-28

### EDT-03 verdict
- Verdict: CONFIRMED
- Proof: probes/EDT/edt.verify.mjs case C, 2 of 2 runs (probes/EDT/edt.verify.out): End, ArrowLeft, Enter saves `one\n\ntwo\r\nthree\nfour\n`; the CR of line 1 is gone. Same root cause as EDT-01; it corrects EDT-01's expected value for case (d) and is a separate symptom (Enter swallows the CR), so kept as its own verdict.
- Severity: S2 (agrees)
- Fix hint: same fix as EDT-01; include Enter before a CR in its test
- Checked by: verifier A, 2026-11-28

### VWR-01 verdict
- Verdict: CONFIRMED
- Proof: probes/VWR/mail.verify.mjs (output mail.verify.out): `Jane <jane@y.org> (Boss)` gives name "" and address `Jane <jane@y.org>`; `"Doe, J" <j@x> (c)` likewise; `john@x.com (John, Jr.), b@y` splits into three. The same address without the comment parses right (control line)
- Severity: S3 (agrees)
- Fix hint: strip a trailing parenthesised comment (and track parentheses in the split loop) before `angleAddress`; unit tests in the mime tests with these three headers
- Checked by: verifier D, 2026-11-28

### VWR-02 verdict
- Verdict: CONFIRMED
- Proof: probes/VWR/mail.verify.mjs: a body `caf\xE9` with no Content-Type reads "caf\uFFFD"; an HTML part with `<meta charset="iso-8859-1">` and no header charset also reads "caf\uFFFD"; `decodeCharset` falls back to UTF-8 only. Explicit utf-8 giving the replacement is correct and shown as control
- Severity: S3 (agrees)
- Fix hint: in `decodeCharset`/`text()`, when the label is missing or unknown and the bytes are not valid UTF-8, decode as windows-1252/Latin-1; optionally read an HTML part's meta charset
- Checked by: verifier D, 2026-11-28

### VWR-03 verdict
- Verdict: CONFIRMED
- Proof: probes/VWR/office.verify.mjs (output office.verify.out): ordered list outside a table reads `1) one`, `2) two`; the same two paragraphs in a table cell read `one<br>two`; bullets in a cell keep `• `
- Severity: S3 (agrees)
- Fix hint: word.ts:420, give an ordered level the same counter text the body path uses; test in the office tests with a one-cell table
- Checked by: verifier D, 2026-11-28

### VWR-04 verdict
- Verdict: CONFIRMED
- Proof: probes/VWR/rtf.verify.mjs (shots, chromium; output rtf.verify.out): the same RTF bytes under `.rtf` open the office page ("Rich Text document, Hello world"); under `.doc`, `.docx` and `.odt` the pane is Source over `{\rtf1...`, under `.txt` plain text. Browser build only; the real window's `.doc` path (shell sniff) was not driven, but kind correction is core code shared by both
- Severity: S3 (agrees)
- Fix hint: where content detection sees `{\rtf` under a Word row, route to `openRtfFrom` (office.ts:52-70 and the registry correction); test opens a planted x.doc with RTF bytes
- Checked by: verifier D, 2026-11-28

### VWR-05 verdict
- Verdict: CONFIRMED
- Proof: probes/VWR/sheet.verify.mjs (output sheet.verify.out): 1500000 with `0.0,,"M"` gives `1500000.0M`; 2500 with `0.0,"K"` gives `2500.0K`; 1234567 with `#,##0,` gives `1,234,567`, identical to plain `#,##0`
- Severity: S2 (agrees)
- Fix hint: in `formatNumber` (tables.ts:735-745) count commas after the last digit placeholder and divide by 1000 per comma before formatting; test the three codes through `sheetValue`
- Checked by: verifier D, 2026-11-28

### VWR-06 verdict
- Verdict: CONFIRMED
- Proof: probes/VWR/sheet.verify.mjs: `#,##0.##` of 1234.5 gives `1,234.50`; `0.##` of 2 gives `2.00`; `0.0#` of 3.1 gives `3.10`; `0.##` of 3.14159 gives `3.14` (so only the trailing-zero trim is missing)
- Severity: S3 (agrees)
- Fix hint: keep a count of required (`0`) and optional (`#`) decimals; `toFixed(total)` then trim trailing zeros down to the required count (and a bare trailing point stays per Excel)
- Checked by: verifier D, 2026-11-28

### VWR-07 verdict
- Verdict: CONFIRMED
- Proof: probes/VWR/mail.verify.mjs: `just words, not a database` parses with subject "", text "", 1 part; header lines followed by a body line with no blank line also give an empty text. Core level only; the page text ("All 0 headers") rests on the catcher's shots probe notdb.mjs
- Severity: S3 (agrees)
- Fix hint: in `splitHead`/`readPart`, when no blank line is found and the first line is not `Name: value`, treat the whole as body (or have the page say it has no headers); test in the mime tests
- Checked by: verifier D, 2026-11-28

### VWR-08 verdict
- Verdict: CONFIRMED
- Proof: probes/VWR/office.verify.mjs: a numbered list in an odt table cell reads `• item 1• item 2` (items run together, bullets); a bulleted list in a cell reads the same; outside a table the numbered list reads `1) item 1`, `2) item 2`. Item run-together is the worse half, so S2 holds
- Severity: S2 (agrees)
- Fix hint: odf.ts:232 `tableBlock`: join items with `<br>` as the Word reader does and use the list's counter text when `ordered`; test with the odt sample in the office tests
- Checked by: verifier D, 2026-11-28

### CMD-01 verdict
- Verdict: CONFIRMED
- Proof: probes/CMD/line.verify.mjs (output line.verify.out): 40-line file in Source, Mod+K ":30" Enter then typing Z gives "Zrow 1"; "/row 20" Enter then Z gives "Zrow 1" and "row 29Z" (the caret stays on line 1, or at the old place). landAt calls jumpToSource and mountSource only scrolls (rendered-view.ts:984)
- Severity: S2 (agrees)
- Fix hint: after scrollToByte in the Source branch of landAt, dispatch a selection at the byte and focus the editor; test: browser test that does Mod+K ":30" Enter, types, and checks which line changed
- Checked by: verifier C, 2026-11-28

### CMD-02 verdict
- Verdict: CONFIRMED
- Proof: probes/CMD/repeat.verify.mjs (output repeat.verify.out), fresh 8-paragraph file each run: one tap of d removes 1 paragraph; a held d (keydowns with repeat=true, confirmed by a capture listener) removed 2 in one run and 3 in the other
- Severity: S2 (agrees)
- Fix hint: selection/bind.ts dispatcher should return early for event.repeat on commands with an effect (keep repeat for movement keys); test: hold d, expect one removal
- Checked by: verifier C, 2026-11-28

### CMD-03 verdict
- Verdict: CONFIRMED
- Proof: probes/CMD/zoom.verify.mjs (output zoom.verify.out): Control+Equal 20px to 21px (keydown default-prevented); Control+Shift+Equal (key "+") and Control+NumpadAdd (key "+") stay at 21px, not prevented. docs/keys.md:104 lists Mod+= as text larger
- Severity: S3 (agrees)
- Fix hint: add a Mod+Plus key (chordMatches already ignores Shift for Plus) to view.text-larger; test: press Control+Shift+= and check size grows
- Checked by: verifier C, 2026-11-28

### CMD-04 verdict
- Verdict: DUPLICATE of NAV-05
- Proof: same cause (nav.forward only asks palette().forward(); the link history has no forward). NAV-05 states the link case too ("after a followed link C->A, Alt+Left returns to C but Alt+Right does not go forward"). probes/CMD/hist.verify.mjs (output hist.verify.out) re-ran it: follow link to B, Back shows A, then Control+], Alt+Right and palette Forward all leave A
- Severity: S2 (agrees)
- Fix hint: one fix with NAV-05: give the pane link history a forward step
- Checked by: verifier C, 2026-11-28

### CMD-05 verdict
- Verdict: BY-DESIGN
- Proof: docs/using-marxy.md:113 says the ">" scope lists "every command, grouped"; the order is group then title on purpose, and ranking by match is stated only for the unmarked scope (line 112). Behaviour is as the catcher says (probes/CMD/rank.verify.out: "read" first row is "Out of the part", "source" first row is "A lens"), so it is a weak spot in a grouped list, not a defect against the docs
- Severity: S3 (agrees)
- Fix hint: if the owner wants it, float an exact or prefix title match to the top within the grouped list; a doc line would need to change with it
- Checked by: verifier C, 2026-11-28

### CMD-06 verdict
- Verdict: CONFIRMED
- Proof: probes/CMD/rank.verify.mjs (output rank.verify.out): "previous tab" gives two rows "Previous tab", keys Ctrl+Shift+Tab and "T"; "next tab" gives two rows, Ctrl+Tab and "g t". The "T" label is the keyLabel split of "g Shift+T"
- Severity: S3 (agrees)
- Fix hint: hide page-key twins from the list or title them; make keyLabel split on spaces before "+"
- Checked by: verifier C, 2026-11-28

### CMD-07 verdict
- Verdict: CONFIRMED
- Proof: probes/CMD/refs.verify.mjs (output refs.verify.out), run on the real module: referenceQuery("src/a.ts:12:5") gives path "src/a.ts:12", from 5; lineQuery("9-5") gives from 9, to null. The app side (Line rows) was not driven here: my row probe ref.verify.mjs printed no rows even for a planted a.ts:12 (planted file likely not in the index), so it proves nothing
- Severity: S3 (agrees)
- Fix hint: referenceQuery should drop a trailing ":col" before the line; a backwards range should be swapped or refused; unit tests in line/ over both forms
- Checked by: verifier C, 2026-11-28

### CMD-08 verdict
- Verdict: PLAUSIBLE
- Proof: code reading: palette/view.ts:236-241 runPaletteCommand does void cmd.run(ctx) with no catch, while selection/bind.ts:389-395 catches and notifies. No command in the browser build rejects, so the failure was not driven; a command whose run throws (e.g. a save to a read-only path in the real window) would. The Source half is real but mostly a consequence of CMD-01: findInPane returns false in Source and no find opens (line3.out: no matches, no panel); docs/using-marxy.md:114 only promises "go there" for "/"
- Severity: S3 (agrees)
- Fix hint: wrap the call in runPaletteCommand in the same catch-and-notify as bind.ts; test: register a command that rejects and run it from the palette
- Checked by: verifier C, 2026-11-28

### VWR-09 verdict
- Verdict: CONFIRMED
- Proof: probes/VWR/odf.verify.mjs, 2 of 2 runs (probes/VWR/odf.verify.out): a comment in a body paragraph is set under it ("body text\n\nnote here"), but the same annotation in a table cell, in the cell's second paragraph, or with a paragraph after the table, gives only the cell text while `counts.comments` is 1. Cause as named: `blocksOf(ctx, tc)` runs `asides()` into the cell's own list and `tableBlock` keeps only para, heading and list blocks (odf.ts:231-236). docs/file-kinds.md:295 says comments are set under the paragraph they are on. No todo row or other finding covers it.
- Severity: S3 (agrees)
- Fix hint: in `tableBlock`, collect the aside blocks from each cell and emit them after the table; test an .odt with a comment in a cell and read the markdown
- Checked by: verifier E, 2026-11-28

### VWR-10 verdict
- Verdict: CONFIRMED
- Proof: probes/VWR/odf.verify.mjs, 2 of 2 runs (probes/VWR/odf.verify.out): a 3-item list, a paragraph, then a list with `text:continue-numbering="true"` gives "1. after" (also with `text:continue-list="a"`); a list with an empty middle item reads "1) one\n2) three". Cause as named: listBlock takes `start` only from the first item's `start-value` and drops an item with no words (odf.ts:197-216). docs/file-kinds.md:290-291 says a list resumes its numbers after an interruption, for Word and OpenDocument text. Not in todo or other findings (VWR-08 is lists inside cells, a different path). The empty-item half is arguably a matter of taste (LibreOffice also skips an empty item's number only when it is not numbered), so the continuation half is the firm part.
- Severity: S3 (agrees)
- Fix hint: read `continue-numbering` / `continue-list` and carry the count per list style across the body; test two lists with a paragraph between
- Checked by: verifier E, 2026-11-28

### LOK-04 verdict
- Verdict: CONFIRMED
- Proof: probes/LOK/size-warn.verify.mjs (probes/LOK/size-warn.verify.out): `size = 12`, `measure = 20` give 15 and 45 with `warnings: []` from both `parseConfig` and `readSettings`; `size = 99`, `measure = 200` give 50 and 80, again silent; `theme = 5` is dropped silently; `chrome_size = 40` and a string `size` do warn (config.ts:226-246 against :230-236). docs/using-marxy.md:408-409 gives the ranges but says nothing about silent clamping. No todo row or other finding covers it.
- Severity: S3 (agrees; cosmetic-leaning)
- Fix hint: push a warning like chrome_size's for size and measure, and for a non-string theme; add cases to the config parsing tests
- Checked by: verifier E, 2026-11-28

### NAV-01 verdict
- Verdict: CONFIRMED
- Proof: probes/NAV/frag.verify.mjs (output frag.verify.out): headings `1. Intro`, `Café` and a 79-character one render with `id=""`; links to their slugs leave the page where it was, while `#ok-head` scrolls. Cause as named: the h1-h6 `id` pattern IDENTIFIER (policy.ts:111) refuses what heading-ids produced. No doc says anchors are ASCII-only.
- Severity: S2 (agrees)
- Fix hint: widen the heading-id pattern (Unicode letters/digits, longer cap) or build ids outside the pattern; a browser test clicking `#1-intro` and `#café`.
- Checked by: verifier B, 2026-11-28

### NAV-02 verdict
- Verdict: CONFIRMED
- Proof: probes/NAV/frag.verify.mjs: `#a%2Db` and `#ok%2Dhead` (encoded forms of ids that exist and work when written plainly, `a-b`, `ok-head`) do nothing; `scrollToFragment` and `headingByte` (selection/view.ts:382-396) use the fragment undecoded. Independent of NAV-01 for ASCII ids; the `%C3%A9` case also needs NAV-01.
- Severity: S3 (agrees)
- Fix hint: decodeURIComponent the fragment (try/catch) once in `landFragment`/`followLink`; test with `#ok%2Dhead`.
- Checked by: verifier B, 2026-11-28

### NAV-03 verdict
- Verdict: CONFIRMED
- Proof: probes/NAV/links.verify.mjs (links.verify.out, 2 of 2 runs): clicking `[to b](b.md)` in /demo/plain opens b.md; in /demo/C#, /demo/50%, /demo/q?x and /demo/a%41 the pane stays on a.md. Cause at link-target.ts:62-66 (base not escaped before `new URL`, then decoded again).
- Severity: S3 (was S2; the folder names are uncommon, though the loss is a dead link with no notice)
- Fix hint: build the target by joining the decoded link path onto documentDir as strings, or encode the base's path first; test with folders `C#`, `50%`, `a%41`.
- Checked by: verifier B, 2026-11-28

### NAV-04 verdict
- Verdict: CONFIRMED
- Proof: probes/NAV/place.verify.mjs (place.verify.out, 2 of 2 runs): A scrolled to 1500; a never-opened Y.md opens at scrollTop 1500 (byte 1623); and the common path, clicking a link at the foot of A (12976), opens never-opened Z.md at 12931 instead of the top. Browser build with the memory shell only; the real window's saved places were not driven, so check it there (`check:tauri`).
- Severity: S2 (agrees)
- Fix hint: `show` should reset the scroll to 0 when there is no landing and no kept place; test: open a long file, scroll, open another never-opened one, expect byte 0.
- Checked by: verifier B, 2026-11-28

### NAV-05 verdict
- Verdict: CONFIRMED
- Proof: probes/NAV/back.verify.mjs (back.verify.out, 2 runs): after two button Backs the Forward button is on but Alt+Right does nothing; after a followed link and Alt+Left, Alt+Right does nothing and the Forward button is off. Keys walk the Line's session history (palette/session.ts goBack/goForward) and link history, the buttons walk WindowTabs; `nav.forward` has no link counterpart (navigation.ts:78-84). docs/keys.md:90 and docs/using-marxy.md:199 promise one per-pane back/forward. CMD-04 is the same bug found by another axis (a later duplicate of this).
- Severity: S2 (agrees)
- Fix hint: route nav.back/forward through the pane's WindowTabs steps (as head.ts:98-99), with link history folded in; a test pressing Alt+Left/Right after tab opens and a link.
- Checked by: verifier B, 2026-11-28

### NAV-06 verdict
- Verdict: CONFIRMED
- Proof: probes/NAV/split.verify.mjs (split.verify.out): `placeLinks` marks `b%231.md` and `c%3F.md` dead; probes/NAV/links.verify.mjs shows a click on the same links opens /demo/h/b#1.md and /demo/h/c?.md. Two resolvers (doc-model.ts:350 decodeURI vs link-target.ts:66 decodeURIComponent).
- Severity: S3 (agrees)
- Fix hint: have the panel resolve through link-target's rule (or share one decode); test with the two names.
- Checked by: verifier B, 2026-11-28

### LOK-01 verdict
- Verdict: CONFIRMED
- Proof: probes/LOK/look-settings.verify.mjs (output look-settings.verify.out), and probes/LOK/lok.verify.mjs (lok.verify.out): with "Look: Paper" in use, Settings' Text size 32 and Variant Light write `size = 32` and `variant = "light"` to config.toml but the page keeps `--marxy-size-body` 20.5px, night scheme, the same background, and no notice is shown. Control in lok.verify.out: with no look, the same two controls change the page (32px, light). No doc in docs/ says a look overrides these rows, and no todo row or other finding covers it.
- Severity: S3 (agrees)
- Fix hint: have the rows say when a look is painting the page (as "Use the theme" does) or let the Settings value win; test: choose a look, change Text size in Settings, read the page's size or see the note
- Checked by: verifier E, 2026-11-28

### LOK-03 verdict
- Verdict: CONFIRMED
- Proof: probes/LOK/lok.verify.mjs (lok.verify.out), my own run with Mod+- instead of the catcher's Mod+=: Variant "Follow the system" tracks the system before the key (dark -> dark, light -> light); after Mod+- config reads `size = 31` and `variant = "auto"`, yet the system going dark leaves `data-marxy-variant=light`. Cause as named: `useSize` and `useVariant` pass a fixed `currentVariant()` to `applyReaderConfig` (appearance.ts:40-52), which drops the auto listener. No todo row or other finding covers it.
- Severity: S3 (agrees)
- Fix hint: keep the auto listener when the key changes only the size (pass the config's variant, not the resolved one); test: variant auto, press Mod+-, flip the system scheme, expect the page to follow
- Checked by: verifier E, 2026-11-28

### LOK-05 verdict
- Verdict: DUPLICATE of LOK-01
- Proof: probes/LOK/studio.verify.mjs, 1 of 1 (studio.verify.out): End on the Studio's first slider writes look.toml `on = true, look = "ink"` and sets data-marxy-look=ink; Settings' Variant Light afterwards leaves the page `v=dark`. The cause is LOK-01's (a look in use repaints over the Settings rows); the Studio is only another way to turn a look on, as the finding itself says. One addition for the repair: the Studio turning looks on with no word is a second place to fix, since the reader never chose a look.
- Severity: S3 (agrees)
- Fix hint: with LOK-01's fix; add a test that the Studio's first dial move says (or does not set) that the look has taken over
- Checked by: verifier E, 2026-11-28

### LOK-02 verdict
- Verdict: PLAUSIBLE
- Proof: code reading only; the memory shell refuses `watch` on the config folder, so the browser build cannot drive it. Confirmed in the code: the only watch of config.toml is in `mountSettings` (settings.ts:742-757; `grep "\.watch("` finds the others on documents, collection trees and the user theme's own folder, theme/user-theme.ts:201), so with Settings closed a hand edit changes nothing until relaunch, against CONFIG_TEMPLATE's "re-reads this file when it changes" (config.ts:72). `applyLive` (settings.ts:98-124) applies only a bundled theme name, so a theme folder named while the drawer is open is not applied. docs/using-marxy.md:396 says "A hand edit to the file shows at once" in the Settings paragraph, which can be read as only the open page, so no BY-DESIGN. What would drive it: the real window (check:tauri, or Windows by hand): edit config.toml in another editor with Settings closed, then open Settings.
- Severity: S3 (agrees)
- Fix hint: watch the config folder once at boot and call the same adopt-and-apply path; or reword the template line and the doc to say only while Settings is open
- Checked by: verifier E, 2026-11-28
