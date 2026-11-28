# Findings

Append-only. Write through .claude/skills/bug-catch/finding.mjs.

### VWR-01 · A mail address followed by a (comment) is read with the wrong address and no name
- Severity: S3 wrong output
- Domain: mail
- Where: packages/core/src/mail/mime.ts:507-521 (`parseAddresses`, `flush`), :485 (`angleAddress` needs the piece to end in `>`), :493 (`withoutComment`)
- Repro: open a .eml whose header reads `To: Jane <jane@y.org> (Boss)` (RFC 5322 comments are legal after an address); also `To: "Doe, J" <j@x> (c)` and `To: john@x.com (John, Jr.), b@y`
- Expected: Jane / jane@y.org; Doe, J / j@x; john@x.com then b@y
- Actual: first gives name "" and address `Jane <jane@y.org>`; second gives address `"Doe, J" <j@x>`; third splits the comment at its comma into `john@x.com (John` and `Jr.)`. The header card then shows the whole angle form as the address
- Evidence: probe probes/VWR/mail2.mjs (first lines of its output); `withoutComment` is only applied on the no-angle branch, and the split loop (`:522-535`) tracks quotes and `<>` but not parentheses
- Confidence: high
- Found by: catcher VWR, 2026-11-28

### VWR-02 · A mail body with 8-bit Latin-1 text and no charset shows replacement characters
- Severity: S3 wrong output
- Domain: mail
- Where: packages/core/src/mail/mime.ts:93-100 (`decodeCharset`), :473 (`text()`)
- Repro: .eml with `Subject: x`, a blank line, then the bytes `caf` 0xE9 (no Content-Type); or an HTML part with `<meta charset="iso-8859-1">` and no charset parameter
- Expected: "café", as the Subject of the same message reads (its header falls back to Latin-1 per byte, `headerText` :180-187)
- Actual: "caf\uFFFD"; the body falls back to lossy UTF-8 only, and the HTML part's own `<meta charset>` is never consulted
- Evidence: probe probes/VWR/mail2.mjs prints `"caf�"` for both bodies and `"café"` for the Subject; code reading of `decodeCharset` (missing label becomes `utf-8`, a failing label also becomes `utf-8`, never a single-byte fallback)
- Confidence: high
- Found by: catcher VWR, 2026-11-28

### VWR-03 · A numbered list inside a Word table cell loses its numbers
- Severity: S3 wrong output
- Domain: office
- Where: packages/core/src/office/word.ts:420 (`para.list` in `readTable` pushes `''` for an ordered level, `'• '` otherwise)
- Repro: a .docx with a one-cell table whose cell holds two paragraphs with numPr to a decimal numbering ("one", "two")
- Expected: "1. one" and "2. two" (docs/file-kinds.md "The office page": numbered lists read from the numbering part)
- Actual: the cell reads `one<br>two`; the numbering is dropped (bullets are kept)
- Evidence: probe probes/VWR/docx.mjs case `cell-ordered` prints `"| one<br>two |\n| --- |\n"`
- Confidence: high
- Found by: catcher VWR, 2026-11-28

### NAV-01 · A link to a heading whose name starts with a digit, has a non-ASCII letter, or is long does nothing
- Severity: S2 wrong result
- Domain: nav
- Where: packages/core/src/sanitize/policy.ts:111 (`IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.:-]{0,64}$/`, used for h1-h6 `id` at :176-181); first consumer apps/desktop/src/selection/view.ts:412 (`landFragment`)
- Repro: planted /demo/f/a.md with `[a](#1-intro) [b](#café) [c](#日本語)` then headings `# 1. Intro`, `# Café`, `# 日本語`; open it; click each link
- Expected: the page scrolls to the heading (the slug is GitHub's: `1-intro`, `café`, `日本語`)
- Actual: nothing happens, no notice. The headings are rendered with no `id` at all (`<h1 data-marxy-s=.. >Café</h1>`); `headingByte` finds the slug in the parse but `scrollToFragment` still needs the DOM id, so even mounting through does not help. `#my-head` and `#dup-1` work in the same page. A heading over 65 characters loses its id too. Numbered headings ("1. Intro", "2024 plan") are very common in plans.
- Evidence: probes/NAV/frag2.mjs (output frag2.out: `#café`, `#日本語` unchanged tops; `#my-head`, `#dup-1` scroll) and probes/NAV/frag3.mjs (frag3.out: `<h1>1. Intro</h1>` without id; `#1-intro` does nothing). Cause by reading: the sanitiser pattern refuses the slug that heading-ids.ts produced.
- Confidence: high
- Found by: catcher NAV, 2026-11-28

### NAV-02 · A percent-encoded anchor (`#my%20head`, `#caf%C3%A9`) never lands
- Severity: S3 wrong result
- Domain: nav
- Where: apps/desktop/src/selection/view.ts:382 (`scrollToFragment` uses `fragment` as written in `CSS.escape(id)`), :392 (`headingByte`); link branch at :479-ish passes `fragment` undecoded; `#`-only branch in `followLink` likewise
- Repro: a page with `[x](#my%20head)` and a heading `# My Head`; click the link
- Expected: browsers and GitHub decode a fragment before matching; the link reaches `my-head` only if the author wrote the slug, but a `%20` / `%C3%A9` form pasted from a browser address bar should at least match the id it names (`caf%C3%A9` = `café`)
- Actual: no scroll, no notice
- Evidence: probes/NAV/frag2.mjs (frag2.out, `#my%20head` and `#caf%C3%A9` unchanged); code reading: no `decodeURIComponent` on the fragment. With NAV-01 fixed, `#caf%C3%A9` would still fail. Confidence medium-high as `%20` never matches a slug anyway; the encoded non-ASCII form is the real case.
- Confidence: medium
- Found by: catcher NAV, 2026-11-28

### NAV-03 · Relative links do nothing for a document in a folder whose name has `#`, `%` or `?`
- Severity: S2 wrong result
- Domain: nav
- Where: apps/desktop/src/selection/link-target.ts:62-66 (`new URL(pathPart, \`file://${base}\`)` built from an unescaped folder path, then `decodeURIComponent(url.pathname)`)
- Repro: planted /demo/C#/a.md (`[to b](b.md)`), /demo/C#/b.md; same with folders `/demo/50%`, `/demo/q?x`, `/demo/a%41`; open a.md and click the link
- Expected: opens /demo/C#/b.md (a folder such as `C#`, `100%` or `What?` is ordinary)
- Actual: the link opens nothing (pane stays on a.md). `#` and `?` in the base start a fragment/query, so the folder part is dropped (`/demo/b.md`); `50%` makes `decodeURIComponent` throw (refused as malformed); `a%41` is decoded to `aA`. Links in `/demo/plain` work. Same code serves Word documents (viewers/office.ts:240).
- Evidence: probes/NAV/links.mjs (links.out: every folder row stays on a.md, plain row opens b.md); node check of the URL logic gives `/demo/b.md`, error, `/demo/aA/b.md`.
- Confidence: high
- Found by: catcher NAV, 2026-11-28

### LOK-01 · With a look in use, Settings' Text size, Variant (and Theme, Measure) are written to config.toml but change nothing, with no word said
- Severity: S3 wrong result
- Domain: settings, look
- Where: apps/desktop/src/settings/settings.ts:98-124 (`applyLive`), apps/desktop/src/look/paint.ts:93-125 (looks on: `paintEl(root, win)` rewrites the size, measure and variant tokens after every `onReaderConfigApplied`), packages/theme/src/settings-schema.ts (the rows carry no note)
- Repro: look.toml present and not `on = false` (or choose a look: palette "Look: Paper"); open Settings (Mod+,); drag Text size to 32, or choose Variant: Light
- Expected: the page changes, or the row says a look is painting the page and the file's value is not in force (the way `look.theme` / "Use the theme" is offered)
- Actual: config.toml gets `size = 32` and `variant = "light"`, the drawer shows the row as changed (dot, "1 setting changed") and offers Reset, but the page stays at the look's 20.5 px and night scheme; no notice. Before the change the Text size slider already reads 20 px while the page is 20.5 px
- Evidence: probe probes/LOK/looks-on-settings2.mjs: after `look.use.paper`, size 32 and variant light via the controls leave `--marxy-size-body` 20.5px, `data-marxy-variant=dark`, `data-marxy-look=paper`, body bg unchanged; `/config` reads `size = 32\nvariant = "light"`
- Confidence: high
- Found by: catcher LOK, 2026-11-28

### LOK-02 · "Marxy re-reads this file when it changes" is true only while the Settings drawer is open, and then not for a theme folder
- Severity: S3 wrong result
- Domain: config
- Where: packages/theme/src/config.ts:72 (`CONFIG_TEMPLATE` text, written into every config.toml Marxy creates), docs/using-marxy.md ("A hand edit to the file shows at once"), apps/desktop/src/settings/settings.ts:742-757 (the only watch of config.toml), :98-124 (`applyLive`: `themeMeant(now.theme)` is null for a folder, so nothing happens)
- Repro: (1) edit config.toml in another editor (`variant = "light"`, `size = 30`, `theme = "polar"`) with Settings closed and save; (2) with Settings open, hand-edit `theme = "mytheme"` where `mytheme/` is a theme folder beside config.toml
- Expected: the page follows the file, as the comment in the file says
- Actual: (1) nothing changes until relaunch (`grep -rn "\.watch(" apps/desktop/src` finds no watch of the config folder outside `mountSettings`; opening Settings afterwards shows the new values in its rows while the page still wears the old ones, because `mountSettings` adopts with `apply: false`); (2) the rows update but the old bundled theme stays: `applyLive` only applies a bundled name, and the folder start is "the launch's business"
- Evidence: code reading (grep above); a browser probe could not drive the watch because the memory shell refuses `watch('/')` for the config folder ("Marxy reads only the files you opened", probes/LOK/watch.mjs), so the drawer's hand-edit path is untested in the browser build; the real window is needed to see (2)
- Confidence: medium
- Found by: catcher LOK, 2026-11-28

### EDT-01 · In a file with mixed line endings, typing, Backspace or Shift+End at the end of a CRLF line rewrites that line's ending
- Severity: S1 data loss (bytes the reader did not ask to change)
- Domain: source editing
- Where: apps/desktop/src/source/buffer-commit.ts:20-31 (`lineSeparatorFor` gives a mixed file `\n`, so each CRLF line's CR is an ordinary character at the end of the line), apps/desktop/src/source/editor.ts (End and selection stop after the CR)
- Repro: plant `one\r\ntwo\r\nthree\nfour\n` as a .md (any mixed file); open it, Mod+E to Source, caret at 0, press End, then (a) type X, or (b) Backspace, or (c) Shift+End from column 1 and type Z; Mod+S. Also (d) ArrowLeft once after End, then Enter.
- Expected: (a) `oneX\r\n...`; (b) `on\r\n...`; (c) `oZ\r\n...`; (d) `one\r\n\r\n...`; everything else byte-identical
- Actual: disk is (a) `one\rX\ntwo\r\n...` (CR now a lone CR before X, LF left), (b) `one\ntwo\r\n...` (the CR is deleted, the letter `e` stays, the reader sees nothing happen), (c) `oZ\ntwo\r\n...`, (d) `one\n\ntwo\r\n...` (CodeMirror's Enter eats the whitespace after the caret, which includes the CR)
- Evidence: probes/EDT/p3.mjs and p4.mjs (WebKit, memory shell; output in this finding): the four disk strings above are read back with `shell.readFile`. End puts the caret after the CR (head 4 on `one\r`), so the plain "type at the end of a line" edit lands after the CR. The comment at buffer-commit.ts:20 chooses this model on purpose ("the CR stays a character at the end of the line"), but nothing hides the CR from caret movement, selection, Backspace or Enter. Not in todo (rows L33, F25 only name mixed files in passing). Files that are all CRLF are unaffected (lineSeparator is CRLF).
- Confidence: high
- Found by: catcher EDT, 2026-11-28

### LOK-03 · Larger/Smaller text (and the palette's variant commands) stop `variant = "auto"` following the system until relaunch
- Severity: S3 wrong result
- Domain: settings, appearance
- Where: apps/desktop/src/commands/appearance.ts:40-52 (`useVariant`, `useSize` call `applyReaderConfig(root, { variant: currentVariant(), size })`), apps/desktop/src/theme/reader-config.ts (`applyReaderConfig` stops the `auto` listener and re-applies a fixed variant); same shape in look/commands.ts `look.night` and the size reset (`configSize`)
- Repro: Settings, Variant: Follow the system; press Mod+= (or Mod+-, Mod+0); then switch the system between light and dark
- Expected: config.toml still says `variant = "auto"` and the page keeps following the system, as after a relaunch
- Actual: the page is frozen at whichever variant was showing when the key was pressed; only a relaunch (or re-choosing Follow the system) restores following. config.toml and the Settings row still say auto
- Evidence: probe probes/LOK/auto-size.mjs: before the key, system light -> `data-marxy-variant=light`, system dark -> dark; after Mod+= (config `variant = "auto"\nsize = 21`) the system going light leaves `data-marxy-variant=dark`
- Confidence: high
- Found by: catcher LOK, 2026-11-28

### LOK-04 · `size = 12`, `measure = 20` and `theme = 5` in config.toml are silently changed or ignored; only `chrome_size` says so
- Severity: S3 wrong result
- Domain: config
- Where: packages/theme/src/config.ts:226-246 (`size` and `measure` clamp with no warning; `chrome_size` at :230-236 warns), :218 (`theme` of the wrong type: no warning)
- Repro: config.toml with `size = 12`, `measure = 20`, `theme = 5` (or `chrome_size = 40` for the contrast); launch
- Expected: a notice such as the one `chrome_size` gets ("outside 11-26 px; using 26"), since docs/using-marxy.md gives the ranges 15-50 and 45-80
- Actual: size becomes 15 and measure 45 with no notice and no entry among the warnings Advanced lists; `theme = 5` is ignored the same way. Settings then shows both rows as changed with the clamped value, which differs from what the file says
- Evidence: probe probes/LOK/readsettings.mjs: `parseConfig` warnings for `size = 12\nmeasure = 20\nchrome_size = 40` list only the chrome_size one; `readSettings` states size=15, measure=45, both `changed`
- Confidence: high
- Found by: catcher LOK, 2026-11-28

### NAV-04 · A document never opened before appears scrolled to where the previous one was
- Severity: S2 wrong result
- Domain: nav
- Where: apps/desktop/src/view/rendered-view.ts:2829 (`show`: no scroll reset for an open with no `at` and no kept place; the only `scrollTop = 0` there is the data-tree one at :875); kept places come from apps/desktop/src/position/reading-persistence.ts `storedFor`
- Repro: boot fixtures/demo/plans/pg16-upgrade-plan.md; wheel down 1000 px; `window.marxy.handle.open('/demo/reading-in-3a.md')` (or any planted long file never opened)
- Expected: the new document starts at its top (byte 0)
- Actual: it lands at scrollTop 1000 (clamped to its max); planted A, D, B, E in turn all open at 3000 / byte 3075 after A was scrolled to 3000. Returning to a file shows its own kept place correctly (F again 1006), so only first opens inherit.
- Evidence: probes/NAV/place7.mjs (place7.out: plan 1000 -> F 1000 -> G 1000), place6.mjs (place6.out: D, B, E all 3000/3075), place8.mjs (place8.out: reading-in-3a.md opens at 1000, max 1052). Found in the browser build with the memory shell (no positions.json); the real window may differ if its saved places take a different path, so the real window is worth a check.
- Confidence: medium
- Found by: catcher NAV, 2026-11-28

### CMD-01 · The Line's ":250", "@heading" and "/text" in Source scroll to the line but leave the caret at the top, so the next keystroke edits the wrong place
- Severity: S2 wrong result
- Domain: line
- Where: apps/desktop/src/line/go.ts:91-94, apps/desktop/src/view/rendered-view.ts:1310-1319 and :974-998 (`mountSource` only calls `editor.scrollToByte`)
- Repro: plant a 300-line text file; open it; Mod+3 (Source); Mod+K, type `:250`, Enter; then type a character
- Expected: go.ts says "Source puts its caret on the line": the caret is on line 250, so the typed character lands there
- Actual: the view scrolls (scrollTop 0 -> 5008) but the CodeMirror selection stays on line 1 (`.cm-activeLine` is still "line number 1"); on a 9-line file typing `X` after `:7` + Enter gives `X# H` at the top of the file. Same for `/number 120` (scrolls, caret on line 1). In Read mode the same Line row puts the cursor on the part.
- Evidence: probes/CMD/line7.mjs (output probes/CMD/line7.out) and probes/CMD/line6.mjs (output probes/CMD/line6.out); `landAt` calls `handle.jumpToSource(byte)` and `mountSource` ends in `scrollToByte(byteOffset)` with no selection dispatch
- Confidence: high
- Found by: catcher CMD, 2026-11-28

### CMD-02 · Holding `d` (Remove the part) keeps removing the next parts as the key auto-repeats
- Severity: S2 data loss (each removal is its own undo step)
- Domain: commands
- Where: apps/desktop/src/selection/bind.ts:309-370 (the one dispatcher never reads `event.repeat`; only the pane chord for the workspace fold does, pane/keys.ts:163), apps/desktop/src/commands/changes.ts:205-219 (`change.remove`, key `d`)
- Repro: plant a file of 8 one-line paragraphs; open it; focus on the page, `j` to put the cursor on a part; hold `d` (probe: keyboard.down('d') six times 120 ms apart, which sets `repeat` from the second)
- Expected: one press removes one part; repeats of a held destructive key are ignored (as the fold key's are)
- Actual: 3 of the 8 paragraphs are gone after one held press ("Paragraph number 6, 7, 8"); the cursor lands on what follows each removal and the next repeat removes that. Same path for every single-key verb with an effect (`u`, `Shift+U`, `y`, `t` tick, `Alt+Arrow` moves).
- Evidence: probe probes/CMD/repeat.mjs, output probes/CMD/repeat.out (8 paragraphs before, 5 after)
- Confidence: high
- Found by: catcher CMD, 2026-11-28

### LOK-05 · Moving one Studio dial turns the looks on for good, after which Settings' variant, size and theme rows stop working (how a reader reaches LOK-01)
- Severity: S3 wrong result
- Domain: studio, settings
- Where: apps/desktop/src/studio/studio.ts (`seeded`: the first dial change seeds the theme's look and calls `setLookState`, `on` defaults to true), apps/desktop/src/look/store.ts:75-87, :120-141 (writes `on = true` to look.toml)
- Repro: fresh profile, no look.toml; Mod+Alt+T or Shift+A opens the Studio; focus the Ink slider and press End; Done; open Settings and choose Variant: Light (or change Text size)
- Expected: the setting applies; or the Studio says it has taken the page from config.toml and offers the way back
- Actual: look.toml now says `on = true, look = "ink"`; config.toml is written (`variant = "light"`) but the page stays dark at `data-marxy-look=ink`; nothing in Settings says why. The only way back is the palette's "Look: the theme config.toml names" or the pop-over's "Use the theme", neither mentioned by Settings
- Evidence: probe probes/LOK/studio2.mjs prints look.toml `on = true` after the dial and `v=dark` after Settings' Light; same mechanism as LOK-01 (probes/LOK/looks-on-settings2.mjs). Adds to LOK-01 (a different way in, not a different cause)
- Confidence: high
- Found by: catcher LOK, 2026-11-28

### NAV-05 · Back and Forward keys do not follow the head's Back and Forward buttons
- Severity: S2 wrong result
- Domain: nav
- Where: apps/desktop/src/commands/navigation.ts:58-84 (`nav.back` calls `selection.back()` = link-only history in selection/view.ts:1122-1145, else the palette's session history; `nav.forward` calls only `palette()?.forward()`); the buttons use `WindowTabs` steps (apps/desktop/src/frame/head.ts:123, :233; frame/window-tabs.ts)
- Repro: planted A, B, C; `handle.open` each in turn (or click tabs / palette results); press Alt+Left or Ctrl+[ ; then click the head's Back button
- Expected: docs/keys.md:90 says Mod+[ / Alt+← and Mod+] / Alt+→ are back / forward; they should step the pane's history as the buttons do
- Actual: after A,B,C the key does nothing (page stays C, repeated presses too) while the Back button (enabled) goes to B, then A; with the pane at A and Forward enabled, Alt+Right does nothing, the Forward button goes to B. After a followed link C->A, Alt+Left returns to C (link history) but Alt+Right does not go forward, and the Forward button stays off.
- Evidence: probes/NAV/back2.mjs (back2.out) and back.mjs (back.out); code reading of navigation.ts
- Confidence: high (browser build; chords arrive, since Alt+Left after a link works)
- Found by: catcher NAV, 2026-11-28

### CMD-03 · Ctrl/Cmd and the "+" key (Shift+=) or the numpad plus does not make the text larger
- Severity: S3 wrong but with a workaround (Mod+= without Shift)
- Domain: commands
- Where: apps/desktop/src/commands/appearance.ts:111 (`key: 'Mod+='`), apps/desktop/src/palette/commands.ts:179-183 (`chordMatches` asks that Shift match the spec exactly, and a `+` key arrives as `event.key === '+'`); the `Plus` spelling that ignores Shift exists (commands.ts:169) but this command does not use it
- Repro: open any page; press Mod+Shift+= (what a US keyboard types for "Cmd +"), or Mod+NumpadAdd
- Expected: text grows one step, as Mod+= does (docs/keys.md:104 "Mod+= / Mod+- / Mod+0 text larger / smaller / default")
- Actual: nothing happens; the key is left to the webview. Body font 20px: Control+= -> 21px, Control+Shift+= -> 21px (no change), Control+NumpadAdd -> 21px (no change), Control+Equal -> 22px.
- Evidence: probe probes/CMD/zoom.mjs, output probes/CMD/zoom.out
- Confidence: high
- Found by: catcher CMD, 2026-11-28

### NAV-06 · The links panel calls a link that opens fine "Lead nowhere" when its file name has `#` or `?` written as `%23` / `%3F`
- Severity: S3 wrong result
- Domain: nav
- Where: apps/desktop/src/left/doc-model.ts:350 (`splitTarget` uses `decodeURI`, which leaves `%23`, `%3F`, `%2F`, `%25`-class escapes encoded) against apps/desktop/src/selection/link-target.ts:66 (`decodeURIComponent`, what a click follows)
- Repro: folder holds a.md and `b#1.md`; a.md has `[x](b%231.md)`; open the Links panel (and Metadata's link count)
- Expected: the link is listed under "To files here", as the click (which opens `b#1.md`) treats it
- Actual: it is listed as dead; `c%3F.md` for `c?.md` likewise. Two resolvers for one rule.
- Evidence: probes/NAV/split.test.mjs (split.out: `b%231.md` and `c%3F.md` place "dead", `e%20%C3%A9.md` correctly "file"); the click side by node check of `new URL`/`decodeURIComponent` (b%23.md -> b#.md)
- Confidence: high for the panel, medium for the click (resolver read, not driven)
- Found by: catcher NAV, 2026-11-28

### CMD-04 · Forward does nothing after a Back over a followed link
- Severity: S2 wrong result (Back works, its undo does not)
- Domain: commands
- Where: apps/desktop/src/commands/navigation.ts:66-83 (`nav.back` tries `selection.back()` (the pane's link history) first; `nav.forward` has no counterpart and only asks `palette()?.forward()`, the session history), apps/desktop/src/selection/view.ts:1123-1146 (`canBack`/`back`; the controller has no `forward`)
- Repro: plant a.md with a link to b.md; open a.md; click the link (b.md shows); focus the page; Alt+ArrowLeft (a.md shows); Alt+ArrowRight
- Expected: b.md shows again (docs/keys.md:90 "back / forward"; docs/using-marxy.md:199 "Each pane has its own back and forward history")
- Actual: stays on a.md; the key is swallowed (the chord matched and `when` held), nothing moves. Repeating Back/Forward leaves the page on a.md.
- Evidence: probe probes/CMD/hist.mjs, output probes/CMD/hist.out
- Confidence: high
- Found by: catcher CMD, 2026-11-28

### CMD-05 · In `>` the command named exactly is not the first row: typing "read" and Enter runs "Out of the part…"
- Severity: S3 wrong but with a workaround (arrow to the row)
- Domain: palette
- Where: apps/desktop/src/palette/commands.ts:81-106 (`paletteCommands` filters with `fuzzyScore(...) <= 0` but sorts only by group then title, discarding the score)
- Repro: open any Markdown file; Mod+Shift+P; type `read`; look at the first row, press Enter. Also `source`, `open`, `split`
- Expected: the title that matches the typed word best is the highlighted row (the Go scope "ranks by match", docs/using-marxy.md:112; `>` is "grouped", :113, which does not say that a loose subsequence outranks the exact title)
- Actual: rows for `read`: "Out of the part: to what holds it, then to its heading", "Previous heading", "Always open this folder as readme", "Read as: …", "Read this file as…"; the command titled "Read" (Ctrl+1) is not in the first five. `source`: first row "A lens: only the tasks, the code, the links, your notes…", then "Source" second. `open`: "Open file…" is not in the first five (the first is "Into the part: the items of a list…"). Enter runs the highlighted first row.
- Evidence: probe probes/CMD/rank.mjs, output probes/CMD/rank.out. A verifier may call the group order by design; the issue is that a one-word exact title never leads.
- Confidence: medium
- Found by: catcher CMD, 2026-11-28

### VWR-04 · A Word `.doc` or `.docx` that is really RTF opens as raw control words, with no document page
- Severity: S3 wrong kind
- Domain: kinds
- Where: packages/core/src/kind/registry.ts:333-351 (`fileTypeOf` / content correction for a text head under a binary row), apps/desktop/src/viewers/office.ts:52-70 (only a `.rtf` name is ever handed to `openRtfFrom`)
- Repro: plant a file `x.doc` (or `x.docx`) whose bytes are `{\rtf1\ansi\deff0 Hello \b world\b0\par}` and open it (browser build)
- Expected: the office page ("Rich Text document, Hello world"), as the same bytes give under `x.rtf`; many generators write RTF into `.doc`
- Actual: the pane is the Source editor over `{\rtf1\ansi...`; under `.txt` the same; only the name `.rtf` reaches the RTF reader. The `.docx`-named zip under `.doc` gets "A Word 97-2003 document the app cannot read" (covered by its own card text)
- Evidence: probe probes/VWR/wrong2.mjs (shots, chromium): `/demo/w2.doc` and `/demo/w2.docx` print `PANE: ... {\rtf1\ansi\deff0 ...`, `/demo/w2.rtf` prints `VIEWER office: Rich Text document · 2 words ... Hello world`. Browser build only driven; the real window's binary sniff for a `.doc` with a text head was not driven, so confidence is medium
- Confidence: medium
- Found by: catcher VWR, 2026-11-28

### VWR-05 · A spreadsheet number format with a trailing comma shows the full number, not thousands or millions
- Severity: S2 wrong output
- Domain: sheet
- Where: packages/core/src/viewer/tables.ts:735-745 (`formatNumber`: `numPart`, `grouped`; a comma after the last digit placeholder is only read as grouping, never as a divide by 1,000 per comma)
- Repro: open an .xlsx whose cell holds 1500000 with the number format `0.0,,"M"` (also 2500 with `0.0,"K"`, 1234567 with `#,##0,`)
- Expected: `1.5M`, `2.5K`, `1,235` (Excel scales by 1,000 for each trailing comma)
- Actual: `1500000.0M`, `2500.0K`, `1,234,567`
- Evidence: probe probes/VWR/fmt.mjs and fmt2.mjs call `sheetValue` with these codes and print the three wrong strings; the same function feeds the grid, the Cell card and the CSV export (`sheetCsvValue`), so the wrong figure is also what is exported. The Rust side only hands over the code and the raw value (`tables/sheets.rs` `dense_cells`)
- Confidence: high
- Found by: catcher VWR, 2026-11-28

### VWR-06 · Optional decimals (`#`) in a spreadsheet number format are padded with zeros
- Severity: S3 wrong output
- Domain: sheet
- Where: packages/core/src/viewer/tables.ts:737 (`decimals` counts `#` and `0` alike, then `x.toFixed(decimals)` at :752 keeps the zeros)
- Repro: .xlsx cells 1234.5 with `#,##0.##`, 2 with `0.##`, 3.1 with `0.0#`
- Expected: `1,234.5`, `2.`, `3.1` (a `#` after the point is a digit shown only when it is not a trailing zero)
- Actual: `1,234.50`, `2.00`, `3.10`
- Evidence: probe probes/VWR/fmt2.mjs prints exactly those; `#,##0.##` is one of Excel's most common custom codes
- Confidence: high
- Found by: catcher VWR, 2026-11-28

### CMD-06 · The command list shows "Next tab" and "Previous tab" twice, and the sequence `g Shift+T` is labelled just "T"
- Severity: S3 cosmetic
- Domain: palette
- Where: apps/desktop/src/commands/frame.ts:135-198 (`tab.next` and `tab.next-page`, `tab.previous` and `tab.previous-page` share a title; the second of each is a page-key twin), apps/desktop/src/palette/commands.ts:134-154 (`keyLabel` splits a two-step spec on `+`, so `g Shift+T` becomes modifier "g Shift" and key "T")
- Repro: open two files; Mod+Shift+P; type `previous tab`
- Expected: one row per act; its key shown as `g ⇧T` (or `g Shift+T`)
- Actual: two rows "Previous tab", the second labelled `T` only (`Next tab` twice too, labelled `g t`). Four other title pairs repeat as well when both are offered ("Move section up/down" outline.* and op.*, "Copy as plain text (strip markdown)", "Copy as markdown"; the last two never show together in the probe).
- Evidence: probe probes/CMD/dupe.mjs, output probes/CMD/dupe.out; a node test over `commands()` listed the repeated titles (output in the same folder is not kept: tab and section pairs as above)
- Confidence: high
- Found by: catcher CMD, 2026-11-28

### CMD-07 · The Line reads `file:12:5` as the file "file:12", line 5, so a compiler's own reference goes nowhere; `:9-5` quietly goes to line 9
- Severity: S3 wrong but with a workaround (drop the column; type the range the right way round)
- Domain: line
- Where: apps/desktop/src/line/refs.ts:18-25 (`referenceQuery`: the lazy `(.+?):(\d+)` backtracks to the last colon), apps/desktop/src/line/refs.ts:8-15 (`lineQuery`: a range whose end is not past its start becomes the single start line)
- Repro: Mod+P, type `src/a.ts:12:5` (the form compilers, grep and stack traces print) and look for the Reference row; in a 12-line file, Mod+P, `:9-5`, Enter
- Expected: a Reference row for `src/a.ts` line 12 (the column dropped), as `src/a.ts:12` gives; for `:9-5` either lines 5 to 9 or a word saying the range is backwards
- Actual: unit probe: `referenceQuery("src/a.ts:12:5")` -> path "src/a.ts:12", from 5; it resolves to no file, so there is no row. `lineQuery("5-3")` -> from 5, to null; the row reads "Go to line 5" while the reader typed a range, and in the app (probes/CMD/line1.mjs, line2.mjs) `:9-5` + Enter puts the cursor on line 9 only
- Evidence: unit probe output probes/CMD/ref.out (referenceQuery and lineQuery over a list of forms); app behaviour in probes/CMD/line1.mjs and line2.mjs runs
- Confidence: high
- Found by: catcher CMD, 2026-11-28

### CMD-08 · A command that fails when chosen from the palette says nothing, though the same command from its key says so; the Line's `/` Enter in Source does nothing
- Severity: S3 silent failure
- Domain: palette
- Where: apps/desktop/src/palette/view.ts:236-241 (`runPaletteCommand`: `void cmd.run(ctx)`, no catch, a synchronous throw escapes the Enter handler), apps/desktop/src/palette/view.ts:1664-1680 (`runLineRow` ignores the promise of an `async` row such as the find row), apps/desktop/src/selection/bind.ts:389-395 (the key path's `runCommand` catches and notifies); apps/desktop/src/commands/find.ts:116-119 (`findInPane` returns false in Source and its callers, scopes-rows.ts:221, :244, :216-219, drop the answer)
- Repro: not driven to a failure (no command in the browser build rejects); for the Source half: Mod+3, Mod+K, `/alpha`, Enter on a row (or Enter with no row)
- Expected: a rejected command run from the palette is said as the key path says it ("X did not run: why"); in Source, a find that cannot open in-page find says so
- Actual: by code, the rejection is an unhandled promise rejection and no notice; in Source the Line's find row scrolls to the line (CMD-01) and opens no find: no highlight, no counts, no word
- Evidence: code reading (the two `void` calls above against bind.ts:389-395); probes/CMD/line3.out shows no `.cm-searchMatch` and no panel after Enter in Source
- Confidence: medium
- Found by: catcher CMD, 2026-11-28

### VWR-07 · A `.eml` that holds plain text with no header and no blank line reads as an empty message
- Severity: S3 wrong output
- Domain: mail
- Where: packages/core/src/mail/mime.ts:190-200 (`splitHead` returns `bodyStart = to` when no empty line is found), :409-413 (`readPart` then reads the whole text as headers; lines that are not `Name: value` are dropped)
- Repro: plant `n-words.eml` containing `just words, not a database` (one line, no colon, no blank line) and open it
- Expected: the text is shown (as a body, or the page says it has no headers and offers Source)
- Actual: the mail page says "A mail message · text/plain · 1 part", "(no subject)", "All 0 headers" and shows no body at all; the file's only text appears nowhere on the Read page (Source still has it)
- Evidence: probe probes/VWR/notdb.mjs (chromium shots), output line for `/demo/n-words.eml`; code reading of `splitHead` for the cause. The same happens for a file whose header lines are followed by body lines without a separating blank line
- Confidence: high
- Found by: catcher VWR, 2026-11-28

### VWR-08 · A list in an OpenDocument table cell runs its items together, and numbered items become bullets
- Severity: S2 wrong output
- Domain: office
- Where: packages/core/src/office/odf.ts:232 (`tableBlock`: a list's items are flat-mapped into one run of words with `run('• ')` before each, no line break between items, and no look at `ordered`)
- Repro: an .odt with a table whose one cell holds a numbered list (`text:list` with a `list-level-style-number` style) of "item 1" and "item 2"
- Expected: two lines in the cell, numbered as the list is (the Word reader gives `one<br>two` for the same shape)
- Actual: the cell reads `• item 1• item 2` on one line, bullets for a numbered list
- Evidence: probe probes/VWR/odt.mjs, case `numbered in cell`: output `"| • item 1• item 2 |\n| --- |\n"`
- Confidence: high
- Found by: catcher VWR, 2026-11-28

### VWR-09 · A comment inside an OpenDocument table cell is counted but never shown
- Severity: S3 wrong output
- Domain: office
- Where: packages/core/src/office/odf.ts:129-135 (`annotation` pushes an aside onto `ctx.comments`), :231-236 (`tableBlock` takes `blocksOf(ctx, tc)` and keeps only `para`, `heading` and `list` blocks, so the aside that `blocksOf` placed after the cell's paragraph is dropped)
- Repro: an .odt table cell `<text:p>cell text<office:annotation><dc:creator>Ann</dc:creator><text:p>note here</text:p></office:annotation></text:p>`
- Expected: the comment set under the table, with its author, as comments elsewhere in the document are (docs/file-kinds.md "The office page")
- Actual: the page shows `cell text` only; the Document card still counts 1 comment
- Evidence: probe probes/VWR/odt.mjs case `comment in cell`: markdown `"| cell text |\n| --- |\n"` with `comments=1`
- Confidence: high
- Found by: catcher VWR, 2026-11-28

### VWR-10 · An OpenDocument numbered list that continues after a paragraph restarts at 1, and an empty item is not counted
- Severity: S3 wrong output
- Domain: office
- Where: packages/core/src/office/odf.ts:197-216 (`listBlock`: `start` comes only from the first item's `start-value`; `text:continue-numbering` and `text:continue-list` are never read, and an item with no words is skipped so later items renumber)
- Repro: an .odt with a numbered list of two items, a paragraph, then `<text:list text:continue-numbering="true">` with one item; another list whose middle item is an empty `<text:p/>`
- Expected: "3." for the continued item (docs/file-kinds.md says a list resumes its numbers after an interruption; the Word reader does); the empty item keeps its number so "three" is 3
- Actual: the continued item is `1.`; the list with an empty middle item reads `1) one`, `2) three`
- Evidence: probe probes/VWR/odt.mjs cases `continue list` and `empty numbered item`
- Confidence: high
- Found by: catcher VWR, 2026-11-28

### EDT-02 · The in-place block editor does the same: End then typing in a block of a mixed-ending file writes a lone CR before the text
- Severity: S2 wrong output (bytes the reader did not ask to change)
- Domain: block editing (Rendered)
- Where: apps/desktop/src/source/block-editor.ts:60-80 (`baseExtensions` gives the island the file's separator, `\n` for a mixed file, so a CRLF line's CR is a character); the fold back is `foldSlice` in commands/block-edit.ts
- Repro: plant `# T\n\nhello\r\nworld\n\ntail\n`; Rendered; select the `hello`/`world` paragraph and press Mod+Enter; Control+Home, End, type Q; Escape
- Expected: `hello` + `Q` + `\r\n` + `world`
- Actual: the store holds `hello\rQ\r\nworld`: Q lands after the CR, so the ending becomes CR, Q, CRLF (probe prints `"# T\n\nhello\rQ\r\nworld\n\ntail\n"`)
- Evidence: probes/EDT/p7.mjs scenario "mixed block edit End type" (WebKit, memory shell). Same cause as EDT-01; listed separately because the fix must also cover the island's own editor, and a Rendered reader never sees Source. All-CRLF blocks are correct (same probe, first scenario: `second lineX\r\nY\r\n`).
- Confidence: high
- Found by: catcher EDT, 2026-11-28

### EDT-03 · Enter with the caret just before a CRLF line's CR (mixed-ending file) deletes the CR (correction of EDT-01 case d)
- Severity: S2 wrong output (a line ending changes from CRLF to LF)
- Domain: source editing
- Where: apps/desktop/src/source/buffer-commit.ts:20-31 (CR is a character of the line in a mixed file); CodeMirror's `insertNewlineAndIndent` removes the whitespace after the caret, which counts the CR
- Repro: plant `one\r\ntwo\r\nthree\nfour\n`; Source; caret at 0; End; ArrowLeft (caret 3, before the CR); Enter; Mod+S
- Expected: `one\n\r\ntwo\r\nthree\nfour\n` (an LF inserted, the original CRLF kept). EDT-01 case (d) gave the wrong expected value (`one\r\n\r\n`); this entry supersedes that part.
- Actual: `one\n\ntwo\r\nthree\nfour\n`: the CR is gone, so line 1's CRLF became an LF
- Evidence: probes/EDT/p3.mjs scenario 2 (WebKit, memory shell), also p2.mjs which prints the editor's text before and after Enter (`"a\r\nb\nc\r\nd"` becomes `"a\n\nb\nc\r\nd"`). Supersedes EDT-01 (d); same cause as EDT-01.
- Confidence: high
- Found by: catcher EDT, 2026-11-28
