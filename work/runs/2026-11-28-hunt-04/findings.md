# Findings

Append-only. Write through .claude/skills/bug-catch/finding.mjs.

### ENC-01 · In a single-byte or UTF-16 file past 4 KB of text, a file byte maps to the wrong character
- Severity: S2 wrong result
- Domain: encoding
- Where: packages/core/src/encoding/byte-map.ts:282-303 (byteAtUnits), :241-265 (countsOf)
- Repro: plant a Windows-1252 file of 2000 lines "\xE9\n" (chosen encoding windows-1252); ask the buffer offset of the file byte of each \xE9 (inspector byte, reading position, find across files all go through bufferOffsetOf). Same for UTF-16 with a BOM and emoji/accents, past 4096 UTF-8 bytes of text.
- Expected: file byte 2732 (the 1367th \xE9) names buffer offset 4098; round trip with fileOffsetOf is the identity
- Actual: got 4097 (mid-character); 634 of 2000 lookups wrong in the cp1252 probe; UTF-16 probe has 1254 wrong round trips across LE and BE. fileOffsetOf is right, bufferOffsetOf is not.
- Evidence: probes/ENC/cp1252.test.mjs (output cp1252.out) and probes/ENC/units.test.mjs (units.out). Cause: checkpoints are every STEP=4096 UTF-8 bytes, not at character starts. countsOf counts a character that straddles a checkpoint as already seen, but byteAtUnits starts scanning at b = lo*STEP, in the middle of it, and the loop treats each continuation byte as a width-1 character (v < 0xc0 gives width 1), so every non-ASCII character that straddles a checkpoint shifts the answer. ASCII-only text and text whose characters align with 4096 hide it.
- Confidence: high
- Found by: catcher ENC, 2026-11-28

### ENC-02 · A byte invalid in Shift_JIS or GBK swallows the ASCII after it: the ASCII character names the wrong file byte
- Severity: S3 wrong result
- Domain: encoding
- Where: packages/core/src/encoding/decode.ts:290-303 (decodeBody), apps/desktop/src-tauri/src/encoding/mod.rs:498-516 (decode_mapped)
- Repro: file bytes 61 81 20 62 88 EA 63 read as Shift_JIS (guess or chosen); ask the file offset of the space (UTF-8 offset 4). GBK with 61 B0 A1 62 81 20 63 behaves the same.
- Expected: the space is file byte 2; the U+FFFD for the lone lead byte 81 is byte 1
- Actual: fileOffsetOf gives 4 for the space (probes/ENC/map.out); bufferOffsetOf(2) gives 4 (the round trip disagrees). A lead byte followed by ASCII makes the decoder emit U+FFFD and the ASCII together on the second byte, so one pair covers both and only the character's end is exact; a selection, find hit or inspector byte starting on that ASCII character names bytes 2 too late (here), and the shift grows with the number of consecutive lead+ASCII pairs only until the next pair, so it is local. A lead byte before a newline or a space is common in damaged files.
- Evidence: probes/ENC/map.test.mjs, output map.out. Rust decode_mapped is the same shape (`clean = out.len() > before` then one pair per fed byte), read not run.
- Confidence: high (TS), medium (Rust, same logic)
- Found by: catcher ENC, 2026-11-28

### WRK-01 · The Markdown parse worker never starts in the browser build, so every large file is still parsed on the page
- Severity: S2 wrong result (a shipped feature that silently does nothing; the freeze it was written to remove stays)
- Domain: parse worker, large Markdown
- Where: apps/desktop/src/document/parse.worker.ts:6, apps/desktop/src/document/parse-worker.ts:79-93 (gives up for the session), apps/desktop/vite.config.* (no `resolve.conditions` or alias for `decode-named-character-reference`)
- Repro: `pnpm --filter @marxy/desktop shots <probes/WRK/worker.mjs>` (plants a 600 KB Markdown file into the memory shell, opens it, prints the console); Edge/Chromium via Vite dev server
- Expected: a Markdown file of 256 KB or more is parsed in `parse.worker.ts` and the `parsed` mark says `worker`
- Actual: console warns `marxy: large Markdown is parsed on the page: the parse worker could not start (Uncaught ReferenceError: document is not defined)`; `unusable` is then set, so no later open tries a worker; the file is parsed in slices on the page as before #829
- Evidence: probe probes/WRK/worker.mjs (output captured above in the run: the warning line). Cause by code reading: the worker imports `parseMarkdown`, which pulls in micromark -> `decode-named-character-reference`, whose package.json maps the `browser` condition to `index.dom.js`; that file runs `document.createElement('i')` at module top level, and Vite resolves worker bundles with the browser condition. `handoff.test.ts` and core's unit tests run under Node (`default` export, no DOM) so they pass. The built app's worker bundle uses the same resolution, so it is likely the same there (not run: real window not driven). Browser tests that expect `slices=` (progressive.test.mjs, split-cost.test.mjs) pass for the same reason, so nothing notices.
- Confidence: high (dev server, seen); medium for the built window
- Found by: catcher WRK, 2026-11-28

### AUTO-01 · The weekly clean deletes untracked work under a folder named dist, target, node_modules or .venv without archiving it
- Severity: S2 data loss
- Domain: automation (clean)
- Where: scripts/lib/stale.mjs:49-52 (`REMAKABLE`, `keepable`), scripts/lib/stale-run.mjs:73-85 (`saveChanges`)
- Repro: throwaway repo, worktree `agent/a` with an untracked, not ignored file `docs/dist/notes.md` and `newfile.md`; run `runStale({ws, root}, {apply: true, now: now + 60 days})` (probes/AUTO/stale.mjs)
- Expected: README "Cleanup": uncommitted changes are saved as `changes.patch` and `untracked.tar` before the worktree goes
- Actual: `untracked.tar` holds only `newfile.md`; `docs/dist/notes.md` is in no archive and the worktree is force-removed. `keepable` drops any path with a segment named like a build output, whatever git says about it (ignored or not), and `git diff HEAD` has no untracked files
- Evidence: probes/AUTO/stale.out (tar listing shows newfile.md only; folder gone). Only paths that are git-ignored are safe to call remakable; untracked-not-ignored paths must be kept
- Confidence: high
- Found by: catcher AUTO, 2026-11-28

### AUTO-02 · An owner comment that merely contains the text "<!-- marxy-" is ignored by the plan gate, so the plan merges over the owner's veto
- Severity: S2 wrong result (gate merges what policy forbids)
- Domain: automation (merge gate)
- Where: scripts/auto/lib/merge-policy.mjs:29 (`isAutomation`), :75 (`planReasons`)
- Repro: probes/AUTO/gov.mjs: a plan PR with approval, current-head intake, then an owner comment "Why does <!-- marxy-hold --> not work? Do not merge" (or one that quotes a bot comment)
- Expected: README: merge only if the intake is newer than every owner comment, "one with no `<!-- marxy-` marker"; this comment is the owner's and is newer, so `owner commented after the intake`
- Actual: `evaluate` returns `{merge:true, reasons:[]}`. `isAutomation` is a substring test, so any comment containing the string, including a reply that quotes a bot comment (GitHub's quote reply does), counts as automation. The plain comment "veto this" holds correctly
- Evidence: probes/AUTO/gov.out lines 1-3. `isAutomation` also differs from `parseMarkers` (`<!--\s*marxy-`), so `<!--marxy-x-->` is a marker to one and not to the other
- Confidence: high
- Found by: catcher AUTO, 2026-11-28

### AUTO-03 · A review marker with no run or model attribute counts as an independent approval; markers from any commenter count
- Severity: S2 wrong result (security of the gate)
- Domain: automation (merge gate)
- Where: scripts/auto/lib/merge-policy.mjs:50-52 (`independent`), scripts/auto/lib/github.mjs:46 (comments keep body and time only)
- Repro: probes/AUTO/gate.mjs case 1: author `run=night-1 model=sonnet`, one comment `<!-- marxy-review verdict=approve head=<sha> -->`, CI green, CLEAN
- Expected: approval "from a run and a model different from the author's"; a marker naming no run or model proves neither
- Actual: `evaluate` merges. `r.run !== author.run` is `undefined !== 'night-1'` and `family('')` is `''`, which differs from `sonnet`. Only the author marker is checked for missing fields. Also `listOpenPRs` drops each comment's author, so anyone able to comment on the public repo can post a marker; the same holds for `intake` markers and for `changes` (a hold) from anyone
- Evidence: probes/AUTO/gate.out line 1. Supersedes the lead on `listOpenPRs` keeping only body and time: reproduced at the unit level (the comment shape has no author field to check); the real GitHub side was not run
- Confidence: high (missing attributes), medium (outsider markers: depends on repo comment permissions)
- Found by: catcher AUTO, 2026-11-28

### AUTO-04 · A `changes` verdict posted in the same second as the approval is ignored; `marxy-review-anything` parses as a review
- Severity: S3
- Domain: automation (merge gate)
- Where: scripts/auto/lib/merge-policy.mjs:6 (`MARKER`, `\b` after the kind), :55 (`r.at > newestApproval`)
- Repro: probes/AUTO/gate.mjs cases 2 and 4: `changes` and `approve` for the head with equal `createdAt` (GitHub times have one-second resolution); and a comment `<!-- marxy-review-foo verdict=approve head=<sha> run=r2 model=opus -->`
- Expected: README "no later changes verdict": an equal time is not provably earlier, so hold; a malformed kind is no marker
- Actual: both merge (`reasons: []`). `\b` matches between `w` and `-`, and ties go to the approval
- Evidence: probes/AUTO/gate.out lines 2 and 6. Does not reproduce the lead "changes older than the newest approval" as a bug: that matches the README wording
- Confidence: high
- Found by: catcher AUTO, 2026-11-28

### AUTO-05 · Presence fails open: when a probe errors or times out, or KDE reports milliseconds below 1,000,000, the owner counts as away
- Severity: S3
- Domain: automation (presence)
- Where: scripts/auto/lib/presence.mjs:48-49 (`ask`, `input`), :42 (`parseKdeIdle`)
- Repro: probes/AUTO/presence.mjs: every command throws (the PowerShell call has a 10 s timeout and lists every process path); then a Linux run where `qdbus` answers `5000`
- Expected: README "When you are using the machine": input in the last 10 minutes means busy; an unreadable signal should not read as an idle owner (the Windows script can time out on a loaded gaming machine, exactly when the owner is there)
- Actual: all three platforms return `{busy:false}` when the probes fail (`NaN < IDLE_MS` is false); `parseKdeIdle('5000')` gives 5,000,000 ms, so input 5 s ago looks like 83 minutes idle if KDE's unit is milliseconds (the code comment says the unit is unverified). Anything under 1,000,000 is taken as seconds, so a real millisecond reading never shows recent input
- Evidence: probes/AUTO/presence.out, gov.out last line
- Confidence: medium (the failure path is certain; the KDE unit is unverified)
- Found by: catcher AUTO, 2026-11-28

### FND-01 · Select all then Copy as Markdown on a long page still mounting copies only the part drawn so far
- Severity: S2 wrong output
- Domain: selection, copy
- Where: apps/desktop/src/selection/drag.ts:136 (`recordDrag` takes `src` from the blocks in the article at the moment of the selection), apps/desktop/src/commands/copy-as.ts:89 (`exact = textOf(buffer, src)`), apps/desktop/src/commands/copy-text.ts:78-91 (`selection.copy-markdown`)
- Repro: open a 0.5 to 5 MB Markdown file (a 4000-paragraph file is enough) and, before the page has finished mounting, press Mod+A then Mod+Shift+C then Enter (Copy as, first row = Markdown, the default `copy_format`)
- Expected: the clipboard holds the whole file's Markdown, as it does once the page is fully mounted; Mod+A then Mod+C already copies the whole document (`appendRest`, copy-text.ts:85)
- Actual: 4,121 characters of a 538,911-character file (only the blocks drawn when Mod+A was pressed); the same keys after `contentComplete` give 538,911. No notice says the copy is partial. The same `src` feeds "Copy as markdown" from the palette (`selection.copy-markdown`), which has the same cut. `appendRest` fixed the plain and rich text path only
- Evidence: probe probes/FND/asmd.mjs (output in probes/FND/asmd.out): `early copy-as 4121 mounting true` against `late copy-as 538911`. Cause by reading: `blockRangeOf` is evaluated once, on the drawn blocks, and `renderedInput` prefers `textOf(buffer, src)` over the page. Adds to the promise of #819/#821 (select-all copy over the whole page still mounting)
- Confidence: high
- Found by: catcher FND, 2026-11-28

### FND-02 · Find counts a formula's TeX source while the page is mounting, then keeps the stale count and a dead step once KaTeX has drawn it
- Severity: S2 wrong result
- Domain: find, math
- Where: apps/desktop/src/find/view.ts:782-784 (the one re-match is on `contentComplete`, before the deferred math pass), apps/desktop/src/startup/idle-work.ts:78 and apps/desktop/src/render/math.ts:96-110 (KaTeX replaces a block's text after the mount is complete), apps/desktop/src/find/walk.ts:25 (`.katex` skipped), apps/desktop/src/find/view.ts:828-830 (`step` recounts only after a step lands on a collapsed Range)
- Repro: a long (4000 paragraphs) Markdown file with `Inline $\text{zephyr}+x^2$` and a `$$` block holding the same, plus "zephyr" in the first and last paragraph; Mod+F, type `zephyr` while it is still mounting; wait for the page to finish and the math to draw; press Enter
- Expected: "N of M" with M the matches in the text the reader reads (docs/using-marxy.md:355 "skips ... maths glyphs"), unchanged by the page finishing; a step lands on a drawn match
- Actual: while mounting the count is 4 (TeX source in the not-yet-drawn math is matched); after KaTeX it still reads "1 of 4" with nothing re-run; Enter goes to "2 of 4" with an empty (collapsed) highlight on the formula; the next Enter notices and recounts to "1 of 2". A new find reads 2. The count the reader saw first was never the page's
- Evidence: probe probes/FND/math.mjs (output probes/FND/math.out): `early 1 of 4`, `after katex, no key 1 of 4`, `step 0 2 of 4 {"t":"","coll":true,...}`, `step 1 1 of 2`, `reopened 2 of 2`. Same cause for copy: probe probes/FND/mixed.mjs (probes/FND/mixed.out) shows select-all Copy while mounting gives `\text{zephyr}+x^2` and the copy of the finished page gives `extzephyr+x2` (KaTeX's glyph text, `\t` eaten), so "the same text as a copy of the finished page" (find-copy-mounting test) holds only for pages without math. Hidden by the test, whose fixture has no formulas
- Confidence: high
- Found by: catcher FND, 2026-11-28

### CAP-01 · A book's Outline silently stops at 5,000 entries or 8 levels, yet the page calls it the book's own contents
- Severity: S3 silent cap
- Domain: book
- Where: packages/core/src/book/package.ts:229-231 (navLinks), packages/core/src/book/package.ts:250-252 (ncxLinks), packages/core/src/book/index.ts:241-258, packages/core/src/book/index.ts:293-298
- Repro: build an EPUB whose nav.xhtml lists 5,001 or more links (or nests lists 9 deep); open it; read the Outline and the page's account ("The Outline is the book's own contents, from its nav document.")
- Expected: docs/big-files.md rule 5: a cap says so. The account or the Outline names that entries past the first 5,000 (or past 8 levels) are not listed
- Actual: `walk` just returns at `out.length >= TOC_MOST` / `nest >= TOC_DEPTH`; nothing is pushed to the account, `said` or any note. The account still says the Outline is the book's own contents. The book's own test (book.test.ts:205-208, 228-232) asserts the cut and never asserts a sentence about it
- Evidence: code reading plus the existing unit test, which shows the cut with no message. `TOC_MOST`, `TOC_DEPTH` have no other use in packages or apps (grep). Not driven in the window. The chapters themselves are all on the page, so only the Outline is short
- Confidence: medium
- Found by: catcher CAP, 2026-11-28

### DIF-01 · Large Markdown is never parsed in the worker: the worker dies on load, and every test about it still passes
- Severity: S2 wrong result (a merged feature that does nothing; its tests cannot see it)
- Domain: document open, parse worker
- Where: apps/desktop/src/document/parse.worker.ts:6 (imports `@marxy/core/src/parse/parse.ts`), apps/desktop/vite.config.ts:155 (`worker: { format: 'es', ... }` with no `resolve.conditions`), apps/desktop/src/document/parse-worker.ts:91-94 (`gaveUp`)
- Repro: WebKit build or dev server: open a 1 MB Markdown file (probes/DIF/worker-mark.mjs does it through the memory shell); read the `parsed` mark and the console
- Expected: the `parsed` mark says `worker` (#829: "Large Markdown parsed in a worker"); a file with a definition or no blank line is parsed off the main thread
- Actual: console warning `marxy: large Markdown is parsed on the page: the parse worker could not start (ReferenceError: Can't find variable: document)`; the mark says `slices=370`; `unusable` is set so no other worker is tried this session. Cause: the worker graph pulls in `mdast-util-from-markdown` -> `decode-named-character-reference`, whose `exports` map sends the `browser` condition to `index.dom.js`, which runs `document.createElement('i')` at load; a worker has no `document`. Vite resolves the worker with the `browser` condition
- Evidence: a probe (probes/DIF/worker-mark.mjs, output probes/DIF/worker-mark.out) shows the warning and `parsed slices=370`. Code reading for the cause: node_modules/.pnpm/decode-named-character-reference@1.3.0/.../index.dom.js line 5 and its package.json exports (`"browser": "./index.dom.js"`; only `worker`/`workerd` map to index.js). Not run in the release build or the real WebView2 window: the same bundler setting is likely to give the same result, so check:tauri is needed. The browser tests `progressive.test.mjs:369`, `split-cost.test.mjs:225` still expect `slices=N` and PASS (run here: progressive and split-cost green), which is how this went unseen: #829's draft says "has not run in a browser yet", and the tests that its own body says it contradicts are the ones still green because the worker never starts. `plain-text-large.test.mjs:152` (a no-blank-line text is not parsed behind its page) also passes for the same reason. When the worker is fixed, all three go red
- Confidence: high
- Found by: catcher DIF, 2026-11-28

### FND-03 · Find counts the tail of a very long code line that the page elides once the block is highlighted, then steps onto an empty highlight
- Severity: S2 wrong result
- Domain: find, code blocks
- Where: apps/desktop/src/render/highlight.ts:176-186 and :496-516 (the tail of a line over 1000 characters becomes `.marxy-line-omitted` only when the fence scrolls near the view), apps/desktop/src/find/walk.ts:30 (`.marxy-line-omitted` skipped), apps/desktop/src/find/view.ts:828-830 (the only recount, and only after a step lands on a collapsed Range)
- Repro: a Markdown file with 300 paragraphs, then a fenced `js` block whose one line is 30,000 characters ending in ` zephyr`, then more paragraphs ending "End zephyr."; with "Intro zephyr." in the first paragraph; Mod+F, type `zephyr` (the block has not been scrolled near yet); press Enter twice
- Expected: the count holds only what the page shows (docs/using-marxy.md:355: find skips "hidden text"; the elided tail is not drawn), and a step never lands on nothing
- Actual: "1 of 3"; Enter goes to "2 of 3" with a collapsed highlight in the code block (the block was highlighted and its tail elided as the step scrolled to it); the next Enter notices and the count becomes "1 of 2". A new find reads "1 of 2". On a 1 to 5 MB page every block that has not yet been near the view is in this state, so the first count is wrong for any query that also occurs in a long line, a minified bundle or an inlined base64 blob
- Evidence: probe probes/FND/longline.mjs (output probes/FND/longline.out): `count 1 of 3`, `step 0 2 of 3 {"t":"","coll":true,...} omitted 1`, `step 1 1 of 2`, `fresh 1 of 2`. Same family as FND-02 (a later DOM pass changes the text find counted, and nothing re-runs the match), a different pass: the fix for both is one trigger that re-matches when the counted text changes, which L33's text cache must also model (the cache has to equal the text after the lazy passes, not before)
- Confidence: high
- Found by: catcher FND, 2026-11-28

### FND-04 · Find never matches a phrase that crosses a soft line break in the Markdown source
- Severity: S2 wrong result
- Domain: find
- Where: apps/desktop/src/find/query.ts:36 (a typed space becomes `[ \u00A0]` only), apps/desktop/src/find/text-index.ts:4 (pieces join with no separator, so the paragraph's `\n` between source lines stays in the text)
- Repro: a file with the paragraph "the lamps and the" newline "river and the road" (a Markdown paragraph hard-wrapped at 80 columns, the usual form); Mod+F; type `the river`
- Expected: "1 of 1": the page draws "the lamps and the river and the road" on one line, the soft break is a space
- Actual: "0 of 0"; `the lamps` finds 1, `lamps and the river` finds 0. In the DOM the paragraph's text is `the lamps and the\nriver and the&nbsp;road`
- Evidence: probe probes/FND/softbreak.mjs (output probes/FND/softbreak.out): `"the lamps" 1 of 1`, `"the river" 0 of 0`, `"lamps and the river" 0 of 0`. For a 1 to 5 MB source wrapped at a column most phrases of more than a word fall on a wrap somewhere, so the count of a phrase is short by every wrapped occurrence, and the same short count is what select-all-less users see from the first key. Copy keeps the `\n`, as the file does, so only find is affected. L33's cache must fold `\n` and runs of whitespace in a text node the way the page draws them
- Confidence: high
- Found by: catcher FND, 2026-11-28

### DIF-02 · `pnpm verify --tier changed` on a change to the open path's large-parse code skips every test that parses a large file
- Severity: S3 wrong tooling result (a green gate that did not run the covering tests)
- Domain: scripts/verify, verify-map
- Where: scripts/verify-map.json (key `apps/desktop/src/document`), apps/desktop/src/document/open.ts:781-792 (`parseLarge`), :760-778 (`parseBehind`)
- Repro: `node scripts/verify.mjs --tier changed --list` on a branch whose only change is under apps/desktop/src/document/ (e.g. open.ts, parse-worker.ts); read the `browser` step's file list
- Expected: the browser files that open a large Markdown or plain-text file and assert how it was parsed (progressive.test.mjs:369 and split-cost.test.mjs:225 `slices=N`, plain-text-large.test.mjs:152 "not parsed behind its page", progressive-large.test.mjs, large-open-panel.test.mjs) run
- Actual: the `document` entry lists warm-store, land-readable, archive-*, save-*, store-*, tail-follow ... and none of those five (they are mapped only under packages/core, pane, source, position, render, left). A change to `parseLarge`/`parseBehind` therefore passes `--tier changed` while the three tests it contradicts stay unrun, so #829's own list of contradicted tests could not have turned the tier red; only `--tier full` (or CI's full run) would
- Evidence: code reading of scripts/verify-map.json `apps/desktop/src/document` entry (no `progressive`, `split-cost`, `plain-text-large`, `large-open-panel`), and `node scripts/verify.mjs --check-map` reports no problem, since the check only finds stale or unlisted files, not covering gaps. Not driven as a tier run (long). Related to DIF-01: those tests are green today only because the worker never starts
- Confidence: medium
- Found by: catcher DIF, 2026-11-28

### CAP-02 · Find in a Word or book page with tens of thousands of matches throws and leaves the bar on "counting…"
- Severity: S2 wrong result, find dead
- Domain: office, book, find
- Where: apps/desktop/src/viewers/page-find.ts:25-26 (`new Ctor(...found.filter(...))` spreads one Range per match into call arguments), apps/desktop/src/viewers/page-find.ts:38-49 (`run` pushes a Range for every match with no cap)
- Repro: build a .docx of 4,000 paragraphs reading "eeee eeee eeee eeee N" (word/document.xml only); open it (Read); Ctrl+F and type `e`. 64,000 matches. Edge/Chromium build, memory shell. Same code serves the book page (viewers/book.ts:396). Real-window not tried
- Expected: a count and a current match, or a sentence saying only the first N matches are marked (the main find windows at 600 for this reason, find/view.ts:50-54)
- Actual: `RangeError: Maximum call stack size exceeded` three times in the page; the find bar sits on "counting…" and never settles; no match is shown or reached by Enter. 2,000 paragraphs (32,046 matches) works: "47 of 32046"
- Evidence: probe probes/CAP/word-find-threshold.mjs, output probes/CAP/word-find-threshold.out (2000: ok; 4000, 6000, 9000: 3 new page errors each, bar "counting…"); probes/CAP/word-cap.out shows the same error on the 20,000-paragraph cap documents at limit-1, limit and limit+1. A spread of Ranges into `Highlight`'s constructor is the cause by code reading (AGENTS.md forbids array spread into call arguments); I did not bisect the exact threshold between 32k and 64k
- Confidence: high
- Found by: catcher CAP, 2026-11-28

### DIF-03 · A 2 MB plain .txt holds the page 590-610 ms right after first text; plain-text-large's first test fails on this tree
- Severity: S3 slow (a hold just over its 500 ms budget; the test is red)
- Domain: plain text open, mounting in runs
- Where: apps/desktop/test/plain-text-large.test.mjs:20 (`HELD_MS = 500`) and :92 (the assertion); the mount code in apps/desktop/src/view/ (plain-text runs) is where a fix would start
- Repro: from the worktree root, `node scripts/browser-tests.mjs test/plain-text-large.test.mjs` (WebKit, Windows, one file alone)
- Expected: "held at most" under 500 ms at a time once first text is up
- Actual: failed twice, once in a three-file batch (589 ms at 281 ms, first text at 174 ms) and once alone (612 ms at 265 ms, first text at 169 ms; the other two tests in the file pass, including the no-blank-line one this file was meant to assert after #829). A hold that stable, at the same point, is not load noise
- Evidence: test output from two runs (not saved to a file). Not bisected: whether #829-#840 caused it or an earlier merge did is not known (DIF-01 changes nothing here, since no worker runs). Another catcher on a quieter machine should rerun it; the hold sits just after first text, where the next chunk of runs or the typeset pass starts
- Confidence: low
- Found by: catcher DIF, 2026-11-28

### CAP-03 · "1 more are left out": the Word and RTF cap sentences give a wrong-number grammar at one past the limit
- Severity: S3 cosmetic
- Domain: office
- Where: packages/core/src/office/markdown.ts:295, packages/core/src/office/rtf.ts:902
- Repro: a .docx of 20,001 paragraphs, or an .rtf with 10,001 `\pict` groups; open it and read the line above the text
- Expected: "1 more is left out" (the book and archive sentences already pick is/are, e.g. book/index.ts:305, archive.ts:996)
- Actual: "Only the first 20,000 paragraphs, headings, tables and lists are shown; 1 more are left out." and "Only the first 10,000 pictures and objects are named; 1 more are left out." The counts themselves are right at limit-1 (no line), limit (no line) and limit+1 (line, count 1)
- Evidence: probe probes/CAP/word-cap.out (20,001 case prints the sentence) and probes/CAP/rtf.out (10,001 objects). Counts and the boundary are correct at limit-1, limit, limit+1; only the verb is wrong
- Confidence: high
- Found by: catcher CAP, 2026-11-28

### CAP-04 · A mail whose early part holds a million "--" lines loses every part after it, but the page names only one
- Severity: S3 wrong words
- Domain: mail
- Where: packages/core/src/mail/mime.ts:441-445 (the sentence), packages/core/src/mail/mime.ts:358-405 (`delimiters` stops at the dash-line index)
- Repro: a multipart/mixed message whose first text part holds 1,000,001 lines that begin `--` (a long diff or ruled log can), then a second text part and the closing delimiter. parseMessage on it
- Expected: the page says that this part and the parts after it are not read (the real count of what was left out)
- Actual: `root.children.length` is 0: both parts are gone, the message shows no body, and `capped` holds one sentence: "Past 1,000,000 lines beginning “--”, a part whose end was not found is not read." It speaks of one part; the second part ("second") is lost without being named. The message has 1 attachment-list row and `text` is undefined. Source still holds the bytes
- Evidence: probe probes/CAP/mime.mjs, last line of probes/CAP/mime.out. Other mail caps are exact at limit-1, limit and limit+1: 499/500 children with the root counted, 1,000 headers, 256 KB of headers, depth 12 (all in the same output)
- Confidence: medium
- Found by: catcher CAP, 2026-11-28
