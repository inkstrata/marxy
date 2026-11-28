# Hunt 04: axes

Planned 2026-11-27 from hunts 01 to 03 (findings, verdicts, triage, READMEs), `AGENTS.md`, `docs/principles.md`,
`docs/big-files.md`, `docs/architecture.md`, `docs/using-marxy.md`, `work/todo.md`, `work/weeks/2026-11-27.md` and
`git log 1148bc9b..origin/main` (hunt 03 landed in #795; since then #796 to #840, 32 commits). Ranked by bugs only this
axis would find, times severity, over cost. Ranks 1 to 6 are proposed for round 1 (six at once); 7 to 10 wait, `Round`
left empty. Known and left out: every row in `work/todo.md` (notably P11, L16, L20, L32, L33, M4, B22, L35) and every
finding of hunts 01 to 03.

### WRK · a big Markdown file parsed in the worker is not the file parsed on the page
- Round: 1
- Type: invariant
- Source: #829 (merged as a draft: "has not run in a browser yet"; its own "Next" list of tests to fix was not done); `AGENTS.md` "One parser"; `packages/core/src/parse/from-mdast.ts:476` (`fences`) and `:484` (`codeEndings`), `parse/bounded-gfm.ts:28`, `parse/byte-offsets.ts:192`, `operations/parents.ts:8`: WeakMaps keyed by tree nodes, which `structuredClone` drops and `ParseNotes` (document-level only) does not carry
- Lens: Assume the document `documentFromHandoff` rebuilds from the worker (Markdown from 256 KB alone, or 64 KB beside another pane, and every `parseBehind`) differs from `parseMarkdown` on the page in what core keeps beside the tree. Find the features that read node-keyed side tables or object identity (code fences and their endings, unclosed brackets, UTF-16 offsets, parents, moving a section, folding Source back, Copy as, Format as code, export as written, an edit inside a fence) and show one that gives a wrong result on a worker-parsed file but not on a small one; also check the fallback when the worker fails to start and the `parsed` mark.
- Start in: apps/desktop/src/document/parse-worker.ts, apps/desktop/src/document/parse.worker.ts, apps/desktop/src/document/open.ts (`parseLarge`, `parseBehind`), packages/core/src/parse/handoff.ts, packages/core/src/parse/from-mdast.ts, packages/core/src/operations/
- Model: sonnet

### ENC · an edit or save of a non-UTF-8 file names the wrong bytes after the compact byte map
- Round: 1
- Type: invariant
- Source: #823 (compact byte map for multi-byte decodes, bounded encoding readings: `packages/core/src/encoding/byte-map.ts` largely rewritten; `src-tauri/src/encoding/table.rs` new); #805 (Shift_JIS and GBK guessed first); `AGENTS.md` "Bytes are the document"; `docs/using-marxy.md:50` ("copy and edits always name exact bytes"); hunt-03 SHL-01, SHL-02 (the map and the guess were the bug sites)
- Lens: Assume the new compact map maps some UTF-16 offset to the wrong byte for a run it compresses: Shift_JIS or GBK with mixed one- and two-byte characters, UTF-16 with surrogate pairs and a BOM, a single-byte code page with CRLF, a broken byte mid-run, a run that crosses a map checkpoint. Find an edit, a selection copied as written, a find hit or a save whose bytes differ from what the reader chose, by comparing `data-marxy-s`/`-e` and the saved file with an independent decode (`TextDecoder` or `iconv`) of the same bytes. Leave out L16's cost; this is about correctness.
- Start in: packages/core/src/encoding/byte-map.ts, packages/core/src/encoding/decode.ts, packages/core/src/buffer/, apps/desktop/src-tauri/src/encoding/, apps/desktop/src/source/
- Model: sonnet

### DIF · the latest merges broke something they did not touch
- Round: 1
- Type: diff
- Source: `git log origin/main` #828 to #840; #829 and #830 were merged with draft bodies ("the session was stopped part way", "`pnpm verify --tier changed` ... has not passed here"); #829's own list of tests it contradicts (`progressive.test.mjs` about line 369 and `split-cost.test.mjs` about line 225 expect `slices=N`; `plain-text-large.test.mjs:152` asserts a no-blank-line text is not parsed behind its page); #830 changed product code from a test pull request (`left/panels/links.ts` adds an `onLinksFound` listener with no removal on the panel's destroy; `view/reading-rows.ts` moves a redraw to the next frame; `shell/memory.ts` `rejectNextWrite`); #838 and #840 changed `scripts/verify.mjs`, `scripts/work.mjs` and `AGENTS.md`
- Lens: Assume each change from #828 to #840 broke a caller, a listener's life or a test outside its own diff. Run the browser files `scripts/verify-map.json` maps to the changed folders (three at a time) and the scripts' unit tests on this tree, then trace every changed export and changed behaviour to its other callers: a listener or frame callback that outlives its panel or view, a redraw on a destroyed view, a `verify` tier or `work` command that now skips or breaks what it used to run. Leave the worker's parse equality to WRK; its contradicted tests and the page around it are yours.
- Start in: apps/desktop/src/left/panels/links.ts, apps/desktop/src/frame/model/links-found.ts, apps/desktop/src/view/reading-rows.ts, apps/desktop/src/shell/memory.ts, apps/desktop/test/progressive.test.mjs, apps/desktop/test/split-cost.test.mjs, apps/desktop/test/plain-text-large.test.mjs, scripts/verify.mjs, scripts/work.mjs
- Model: sonnet

### AUTO · the merge gate, the governor and the weekly clean decide against the written policy
- Round: 1
- Type: spec
- Source: #838, #840; `scripts/auto/README.md` ("The merge gate", "The budget", "When you are using the machine", "Cleanup") against `scripts/auto/lib/merge-policy.mjs`, `github.mjs`, `governor.mjs`, `presence.mjs`, `clean.mjs` and `scripts/lib/stale.mjs`, `stale-run.mjs`. Leads from reading: `github.mjs` `listOpenPRs` keeps only a comment's body and time, not its author, so a `marxy-review verdict=approve` marker posted by anyone on the public repository counts, and any comment without a marker counts as the owner's; `reviewReasons` ignores a `changes` verdict older than the newest approval
- Lens: Assume the gate merges, the governor allows or the clean removes something `scripts/auto/README.md` forbids. Drive `evaluate`, `decide`, `slotsUntilReset`, `lastReset`, the presence rules and `staleTrees`/`runStale` with crafted records, clocks and throwaway repositories (a marker comment from a login other than inkstrata, a `changes` verdict then a push then an approval, a rename out of a CODEOWNERS path, the DST weekends, Friday 14:00 and 20:00, a squash-merged branch, a worktree with only ignored files) and find each wrong answer. Never run `tick`, `merge` without `--dry-run`, `clean`, `work clean --apply` or any `gh` write against the real repository or checkouts; probes use temporary repositories and `MARXY_STATE_DIR`.
- Start in: scripts/auto/lib/merge-policy.mjs, scripts/auto/lib/github.mjs, scripts/auto/lib/governor.mjs, scripts/auto/lib/presence.mjs, scripts/auto/lib/clean.mjs, scripts/lib/stale.mjs, scripts/lib/stale-run.mjs, scripts/auto/auto.mjs
- Model: sonnet

### FND · find, select all and copy on a long page still mounting break their promises
- Round: 1
- Type: spec
- Source: #819 (find and select-all copy over the whole of a long page still mounting), #821 (whole-selection Copy as reuses the parse); `docs/using-marxy.md:355` (count from the first key, a match not yet drawn is drawn when stepped to, "still counting", the kept match on a remake, Next from the last counted match does not wrap); hunt-03 NAV-01, NAV-05, EDT-04, EDT-07 (the bugs these fixes answered). The week's L33 replaces this path, so what this axis finds also writes L33's acceptance test
- Lens: Assume every sentence of `docs/using-marxy.md:355` and the select-all copy promise is broken on a 1 to 5 MB Markdown page while it is still mounting or typesetting. Find each one the code does not keep: a count that changes or jumps when blocks mount, a step to a pending match that lands on the wrong element or byte, a kept match lost when the page is remade from disk, copy whose text differs from the fully drawn page (footnotes, tables, code, hard breaks), and work per key that grows with the file.
- Start in: apps/desktop/src/find/view.ts, apps/desktop/src/find/walk.ts, apps/desktop/src/selection/copy-text.ts, apps/desktop/src/commands/copy-as.ts, apps/desktop/src/render/progressive.ts
- Model: sonnet

### CAP · a cap landed since hunt 03 drops content silently or fails at its limit
- Round: 1
- Type: invariant
- Source: `docs/big-files.md` rule 5 ("Every cap says so ... never fails the page"); caps landed since hunt 03: Word's first 20,000 paragraphs (#818), data trees folded past 300 open branches and broken non-UTF-8 data windowed (#821), the word diff's token cap (#836), the bracket scan (#837), paste classify at 4 MB and JSON Lines records at 1 MB (#812), archive folders, office find, book contents, mail delimiters and the certificate walk (#816), bounded encoding readings (#823), slide and comment positions (#803)
- Lens: Assume each cap above loses content without saying so, says a wrong count of what it left out, or throws or blanks the page at exactly its limit or one past. Plant inputs at limit − 1, limit and limit + 1 for each, open them, and check that the page names what it left out in its own words, still opens and answers keys, and that Source (or the hex view) still holds every byte. Leave out the lines-of-text budget (P11) and the Tuesday hunt's long-line and paste shapes; this is the caps that already landed.
- Start in: packages/core/src/office/, packages/core/src/reading/, packages/core/src/diff/words.ts, packages/core/src/mail/mime.ts, packages/core/src/viewer/archive.ts, packages/core/src/viewer/cert.ts, apps/desktop/src/viewers/office.ts, apps/desktop/src/source/paste.ts
- Model: sonnet

### TWO · two opens at once around the changed open path
- Round:
- Type: shape
- Source: #829 (`parseLarge` aborts only when the pane closes: `open.ts:660` passes `() => closed`, and `closed` is set only in `close()`, `open.ts:1227`); #813 (opens emitted while no boot listens wait for the next boot, `frame/document-signal.ts`, `shell/tauri.ts`); hunt-03 NAV-04 (a second 2 MB open took 30 to 38 s); `docs/architecture.md:240`
- Lens: Assume the open path mishandles a second request while the first is in flight: a second file opened in the same pane, a tab switch, a reload from disk or an edit while a large parse is in the worker or `parseBehind` runs, the same file in two panes (the 64 KB gate), Back after a link, and several opens queued before the boot listens. Find a page that shows the wrong file or an old version, a parse that lands on a store it no longer belongs to, a wait that grows with the first file, or an open lost or run twice.
- Start in: apps/desktop/src/document/open.ts, apps/desktop/src/document/parse-worker.ts, apps/desktop/src/frame/document-signal.ts, apps/desktop/src/shell/tauri.ts, apps/desktop/src/pane/
- Model: sonnet

### SCH · work moved onto the one scheduler lost its place in line or its cancellation
- Round:
- Type: pattern
- Source: #822 (one scheduler for sliced work: `scheduler/index.ts` with three lanes); every caller passes `input` or the default (`startup/yield.ts:4` `yieldToEventLoop`, which the background parse, `buildNodeMapInSlices` and `parseBehind` use; `view/reading-rows.ts:61`, `view/reading-lines.ts:38`), only `render/highlight-queue.ts:16` uses `viewport`, and nothing uses `background`; `docs/big-files.md` rule 2 ("can be cancelled when the bytes change or the reader leaves")
- Lens: Assume the sites converted to `yieldToMain` changed what runs first or stopped checking whether they are still wanted. Find background work (a parse behind the page, a node map, a panel's model) that holds the reader's find, keys or frames off because it shares the `input` lane, and sliced work that runs on after its pane, document or query is gone, measured in CPU or task time.
- Start in: apps/desktop/src/scheduler/index.ts, apps/desktop/src/startup/yield.ts, apps/desktop/src/render/highlight-queue.ts, apps/desktop/src/view/reading-rows.ts, apps/desktop/src/view/reading-lines.ts, apps/desktop/src/find/walk.ts, apps/desktop/src/render/post.ts
- Model: sonnet

### PRS · a whole-file Markdown parse outside the store's kept parse
- Round:
- Type: pattern
- Source: hunt-02 B17, B18 (Transforms and Links parsing again, both confirmed S1) and its "For the next hunt" (other callers of whole-file parses in `left/`); hunt-03 NAV-06 (the Line's `@` parsed the whole file, confirmed); `docs/big-files.md` rule 1. Callers still in the tree: `commands/kind-tools.ts:63` (`parseMarkdown(buffer.bytes)`), `frame/model/outline.ts:275`, `left/transforms-model.ts:183`, `source/notes.ts:85`, `frontispiece/index.ts:29`, `left/doc-links.ts:84` (`pathMentions(text)` without a parse)
- Lens: Search `rg -n "parseMarkdown\(|parseMarkdownChunked\(|fromMarkdown\(|pathMentions\(" apps/desktop/src -g '!*.test.ts'` and, outside `document/store.ts` and `document/open.ts`, find each call that parses a whole document on a key, panel or command instead of reading the store's parse; time each on a 2 MB file and keep those over 200 ms of CPU.
- Start in: apps/desktop/src/commands/kind-tools.ts, apps/desktop/src/frame/model/outline.ts, apps/desktop/src/left/transforms-model.ts, apps/desktop/src/source/notes.ts, apps/desktop/src/left/doc-links.ts
- Model: haiku

### WKT · what Chromium passes, WebKit (the macOS engine) fails, in what changed
- Round:
- Type: environment
- Source: hunt-01, hunt-02 and hunt-03 "Not reached: WebKit" each time; Eris (macOS) is the owner's reading machine; changed engine-sensitive code since hunt 03: the module worker (#829), the message-channel scheduler (#822), the typeset grid pass (#824), `packages/theme/src/base.css` (+17), leaving Source without layout (#825). M4's 14 known failing files are left out
- Lens: Assume the changes since hunt 03 work in Chromium and not in WebKit. Through `scripts/browser-tests.mjs` with Playwright WebKit (not `shots`), find what a reader on macOS meets first: a large Markdown file whose worker never answers or never falls back, slices that starve frames, paragraphs left unset or off the grid after a resize or after leaving Source, and the `base.css` rules drawn differently. Name any browser file outside M4's list that fails only in WebKit.
- Start in: apps/desktop/src/document/parse-worker.ts, apps/desktop/src/scheduler/index.ts, packages/typeset/src/grid.ts, packages/theme/src/base.css, scripts/browser-tests.mjs
- Model: sonnet

## Cut

- **The real WebView2 window on Windows** (`check:tauri`): one run per machine, and the week's first nightly runs it with the install check (week plan, Hardening); bring it in for round 2 if WRK or ENC find something headless Chromium cannot confirm.
- **The scale record** (#828): pure, unwired until L21's store half, and covered by its own and growth tests; its mistakes surface when L21 builds on it.
- **Typesetting and leaving Source** (#824, #825): hunt 03's RDR and EDT read these, L22 replaces the idle queue, and WKT covers the engine-sensitive part.
- **Container readers** (#816, #803, mail, archives, certificates): their new caps are CAP's; the rest was walked once in #816 with hostile tests.
- **macOS saves keep the Created date** (#814, `atomic_write.rs`): macOS-only code that Osiris can only read, not drive (medium confidence at best); for Eris or round 2.
- **A separate weekly-clean axis**: folded into AUTO, which reads the same `scripts/` files for the same reason.
- **Lines-of-text budget and long-line, paste shapes**: P11 is in the week's queue and the Tuesday hunt is on exactly those shapes.
