# Verification

Append-only. Write through .claude/skills/bug-catch/finding.mjs.

### ENC-01 verdict
- Verdict: CONFIRMED
- Proof: probes/ENC/enc.verify.mjs (output enc.verify.out): 3000 lines of "\xE9\n" as windows-1252, 1365 of 3000 bufferOffsetOf lookups or round trips are wrong, first at line 1366 (just past the first 4096-byte checkpoint). Code read: countsOf counts a character straddling a checkpoint as seen, but byteAtUnits starts at lo*STEP mid-character and treats continuation bytes as width-1 characters (byte-map.ts:296-303).
- Severity: S2 (agrees)
- Fix hint: in byteAtUnits start the scan at charStart(text, lo*STEP) with the count before that character (or make countsOf checkpoint at character starts); test: buffer-offset round trip over a 2000-line cp1252 and UTF-16 file.
- Checked by: verifier ENC, 2026-11-28

### ENC-02 verdict
- Verdict: CONFIRMED
- Proof: probes/ENC/enc.verify.mjs and map.out: Shift_JIS bytes 61 81 20 62 88 EA 63 decode to "a\uFFFD b\u4E00c"; fileOffsetOf for the space (UTF-8 offset 4) returns 4, the space is file byte 2. decodeBody (decode.ts:290-303) feeds one byte at a time, so the decoder emits U+FFFD and the ASCII together on the second byte. Note: my run gave bufferOffsetOf(2)=1, not 4 as the catcher wrote; the forward mapping error stands. Rust decode_mapped not run.
- Severity: S3 (agrees)
- Fix hint: when a fed byte yields more than one character, record a table entry per character (the lone lead byte's U+FFFD ends at the lead byte, the ASCII at the next); test: round trip over damaged Shift_JIS and GBK.
- Checked by: verifier ENC, 2026-11-28

### AUTO-01 verdict
- Verdict: CONFIRMED
- Proof: probes/AUTO/stale.verify.mjs (own throwaway repo, no .gitignore, untracked src/dist/ and src/target/ files shown by `git status -uall`) ends with the worktree removed and the archive holding only changes.patch; neither file is archived (output in probes/AUTO/stale.verify.out). `keepable` filters by path segment only; scripts/README and docs/working.md:199 say uncommitted changes are saved, the tar exclusion is described for folders
- Severity: S2 (agrees; rare in practice because dist/target are usually gitignored, but a source folder so named is lost silently)
- Fix hint: in `saveChanges` drop remakable paths only from the ignored list (`ls-files --others --ignored`), never from the untracked-not-ignored list; test: runStale on a worktree with an untracked src/target/x file and assert it is in untracked.tar
- Checked by: verifier AUTO, 2026-11-28

### AUTO-02 verdict
- Verdict: CONFIRMED
- Proof: probes/AUTO/policy.verify.mjs cases 02a-02c: a plain owner comment after the intake holds the plan, but one containing "<!-- marxy-hold -->" or a quoted bot marker gives merge:true, reasons [] (output in probes/AUTO/policy.verify.out). Cause is `isAutomation` as a substring test (merge-policy.mjs:29) while the README (auto/README.md:84) says "one with no marker"
- Severity: S3 (was S2; needs an owner comment that quotes marker text)
- Fix hint: treat a comment as automation only when `parseMarkers(body).length > 0` and the body starts with or consists of the marker; test beside the evaluate tests
- Checked by: verifier AUTO, 2026-11-28

### AUTO-03 verdict
- Verdict: CONFIRMED
- Proof: probes/AUTO/policy.verify.mjs 03a (no run or model) and 03b (run only, no model) both give merge:true; control 03c with model=sonnet is held (probes/AUTO/policy.verify.out). Missing attributes pass `r.run !== author.run` and `family('') !== 'sonnet'`. The outsider-marker half was not driven (comment shape carries no author; GitHub permissions not tested): PLAUSIBLE for that part
- Severity: S2 (agrees)
- Fix hint: in `independent`, require non-empty run and model on the review marker; test: approve marker without model is not independent
- Checked by: verifier AUTO, 2026-11-28

### AUTO-04 verdict
- Verdict: CONFIRMED
- Proof: probes/AUTO/policy.verify.mjs 04a: approve and changes with equal createdAt merge; 04b control with changes 1 s later is held; 04c: `marxy-review-foo` parses as kind review (output in probes/AUTO/policy.verify.out). Tie goes to approval via `r.at > newestApproval`; README says only "no later changes verdict"
- Severity: S3 (agrees)
- Fix hint: use `>=` in reviewReasons and `(?![\w-])` after the kind in MARKER; tests for both
- Checked by: verifier AUTO, 2026-11-28

### AUTO-05 verdict
- Verdict: CONFIRMED
- Proof: probes/AUTO/policy.verify.mjs 05: with every command throwing, win32, darwin and linux each return busy:false; qdbus answering '5000' gives busy:false (parsed as 5,000,000 ms) while '5' gives busy (output in probes/AUTO/policy.verify.out). The KDE unit being milliseconds on Set is unverified, so that half is PLAUSIBLE; the fail-open on probe error is certain from code and run
- Severity: S3 (agrees)
- Fix hint: have `ask` return null on error and `presence` report busy (or unknown, holding the run) when a platform's input probe fails; test with a throwing `run`
- Checked by: verifier AUTO, 2026-11-28

### CAP-01 verdict
- Verdict: CONFIRMED
- Proof: code read on this commit: package.ts:56-57 TOC_MOST=5000, TOC_DEPTH=8; the walkers (package.ts:229-231, 250) return silently; book/index.ts:295-297 still says "The Outline is the book's own contents". book.test.ts:205-208 asserts the cut and no sentence. Not driven in a window.
- Severity: S3 (agrees)
- Fix hint: have the nav and ncx walkers report that they stopped, and add a sentence to the book account; extend book.test.ts to assert it.
- Checked by: verifier CAP, 2026-11-28

### CAP-02 verdict
- Verdict: CONFIRMED
- Proof: my own probe probes/CAP/find.verify.mjs (output find.verify.out), a docx of 100 paragraphs of 700 "e" (70,000 matches, under the paragraph cap): Ctrl+F "e" gives RangeError: Maximum call stack size exceeded; at 200 paragraphs (140,000) three errors and the bar stays on "counting…". Cause is the spread in page-find.ts:25-26 (`new Ctor(...found...)`) with no cap on matches in `run`. Chromium build only; real window not tried.
- Severity: S2 (agrees)
- Fix hint: build the Highlight with `add()` in a loop, or cap the marked matches as find/view.ts does; test: docx with 70,000 matches, assert the bar settles on a count.
- Checked by: verifier CAP, 2026-11-28

### CAP-03 verdict
- Verdict: CONFIRMED
- Proof: code read: office/markdown.ts:295 and office/rtf.ts:902 hard-code "more are left out" with the count; probes/CAP/word-cap.out (20,001 paragraphs) prints "1 more are left out."; rtf.out the same for 10,001 objects. Book and archive sentences already choose is/are.
- Severity: S3 (agrees)
- Fix hint: pick "is" when the count is 1, preferably through one shared helper; unit test at limit+1.
- Checked by: verifier CAP, 2026-11-28

### CAP-04 verdict
- Verdict: CONFIRMED
- Proof: probes/CAP/mime.out last line: with over 1,000,000 "--" lines in the first part, children is 0, text undefined and one sentence names "a part whose end was not found"; mime.ts:436-441 deliberately drops the last indexed part so later parts are not shown as its body, but the parts after it are lost unnamed. Code and catcher's probe output read; I did not rerun it. The comment shows the drop is intended, so only the wording and count are wrong.
- Severity: S3 (agrees)
- Fix hint: say "this part and the parts after it are not read" (with the count if known); test in the mail tests at the dash-line limit.
- Checked by: verifier CAP, 2026-11-28

### FND-01 verdict
- Verdict: CONFIRMED
- Proof: probes/FND/asmd.verify.mjs, output asmd.verify.out (Chromium, own copy of the steps): early Mod+A, Mod+Shift+C, Enter while mounting gives 4121 chars of 538911; after contentComplete the same keys give 538911. Code read: sel.src comes from blocks drawn at record time (drag.ts:136), copy-as.ts:89 prefers textOf(buffer, src). Not in todo.md or any other finding; no doc says it is meant.
- Severity: S2 wrong output, silent partial copy
- Fix hint: for a document-kind select-all, set src to the whole buffer range (as appendRest does for plain text), or resolve src lazily at copy time.
- Checked by: verifier FND, 2026-11-28

### FND-02 verdict
- Verdict: CONFIRMED
- Proof: probes/FND/math.verify.mjs, output math.verify.out (Chromium). Caution: the catcher's math.mjs wrote '\text' in a plain JS string, so the file held a TAB plus "ext", not \text; the "extzephyr" copy difference in mixed.out is a probe artefact, not KaTeX eating \t, so that copy claim needs a re-check with real TeX. With a real \text{zephyr}: early 1 of 4, after KaTeX still 1 of 4, Enter gives 2 of 4 on a collapsed highlight in the formula, next Enter 1 of 2, reopened 2 of 2. Count bug is real. Same family as FND-03 (no recount when a lazy pass changes counted text; only recount is in step()) but a different pass, so not a duplicate.
- Severity: S2 wrong result
- Fix hint: re-run the match (keep: true) after the math pass and the highlight pass, or have the text cache model them.
- Checked by: verifier FND, 2026-11-28

### FND-03 verdict
- Verdict: CONFIRMED
- Proof: probes/FND/longline.verify.mjs, output longline.verify.out (Chromium): count 1 of 3, step 0 gives 2 of 3 with collapsed highlight and one .marxy-line-omitted, step 1 1 of 2, fresh find 1 of 2. Shares a cause class with FND-02 (no recount after a lazy pass), a different pass (highlight.ts omission); verified separately, one trigger would fix both.
- Severity: S2 wrong result
- Fix hint: recount (keep: true) when highlight elides a line or math draws; or make find's text model match the post-pass text.
- Checked by: verifier FND, 2026-11-28

### FND-04 verdict
- Verdict: CONFIRMED
- Proof: probes/FND/softbreak.verify.mjs, output softbreak.verify.out (Chromium, different text): paragraph "the quick brown\nfox jumps over\nthe lazy dog" gives "brown fox" 0 of 0 and "over the" 0 of 0, while "fox jumps" finds 2 and a single-line phrase finds 1. query.ts:36 maps a space only to [ \u00A0]. docs/using-marxy.md:355 says find is literal with typographic folding; nothing says a wrap blocks a match. Not in todo.md or earlier findings.
- Severity: S2 wrong result (common in hard-wrapped prose)
- Fix hint: compile a space to a class that includes \n and \t (or fold whitespace in the text index) while keeping offsets mapped to nodes.
- Checked by: verifier FND, 2026-11-28

### WRK-01 verdict
- Verdict: CONFIRMED
- Proof: probes/WRK/worker.verify.mjs (own probe: 647 KB Markdown with a link definition, Chromium) prints `parse worker could not start (Uncaught ReferenceError: document is not defined)`; output in probes/WRK/worker.verify.out. Cause confirmed in code: decode-named-character-reference exports map `browser` to index.dom.js (package.json line 28), parse.worker.ts:6 imports the parser, parse-worker.ts:91-94 `gaveUp` disables the worker for the session. Same result under WebKit in DIF-01's probe.
- Severity: S2
- Fix hint: resolve the worker bundle with the `worker`/default condition (worker.plugins or resolve.conditions, or alias the package to index.js), and add a browser test that asserts the `parsed` mark says `worker`; progressive/split-cost/plain-text-large expectations then need updating.
- Checked by: verifier WRK, 2026-11-28

### DIF-01 verdict
- Verdict: DUPLICATE of WRK-01
- Proof: same cause and symptom (worker fails on `document`, `gaveUp`, `slices=370`); reproduced once via probes/WRK/worker.verify.mjs (see WRK-01), and DIF's own WebKit run in probes/DIF/worker-mark.out shows it on a second engine. Its extra point, that progressive.test:369, split-cost.test:225 and plain-text-large.test:152 stay green only because the worker never starts, is true by reading and belongs in the repair.
- Severity: S2
- Fix hint: see WRK-01.
- Checked by: verifier WRK, 2026-11-28

### DIF-02 verdict
- Verdict: CONFIRMED
- Proof: read scripts/verify-map.json: the `apps/desktop/src/document` entry lists none of progressive.test, split-cost, plain-text-large, progressive-large, large-open-panel. A script over the map shows they are mapped only under packages/core, src/pane, src/source, src/position, src/render and src/left; longest-prefix wins, so a change confined to src/document skips all five. Tier run itself not driven.
- Severity: S3
- Fix hint: add those five to the `apps/desktop/src/document` list (at least progressive, split-cost, plain-text-large); consider a check that open.ts's callers' tests are mapped.
- Checked by: verifier WRK, 2026-11-28

### DIF-03 verdict
- Verdict: CONFIRMED
- Proof: `node scripts/browser-tests.mjs test/plain-text-large.test.mjs` run alone again: fails with "the page was held 572 ms at 251 ms, after first text at 173 ms" (plain-text-large.test.mjs:92); output in probes/DIF/plain-text-large.verify.out. With the catcher's two runs (589, 612 ms) that is three failures at the same point, so not load noise on this machine. Second repeat was cut short by the tool timeout. Not bisected; may be machine-specific, a CI run would tell.
- Severity: S3
- Fix hint: find the task that starts right after first text (next run chunk or typeset pass) and bound it below 500 ms, or yield earlier.
- Checked by: verifier WRK, 2026-11-28
