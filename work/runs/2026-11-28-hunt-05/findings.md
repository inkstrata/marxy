# Findings

Append-only. Write through .claude/skills/bug-catch/finding.mjs.

### TWO-01 · Opening a second file in a pane waits for the whole first file's parse, however large
- Severity: S2 wrong result (a wait that grows with the abandoned file)
- Domain: open
- Where: apps/desktop/src/document/open.ts:660 (`parseLarge(..., () => closed)`), :663-664, :1048-1053 (`open` runs inside `serially`), :354 (`serially` is the view's queue)
- Repro: open a 4.9 MB Markdown file (many list items, hard breaks, tables), and at once open `small.md` in the same pane (a palette pick, a link, a tab click); the small file's page does not show until the big file's parse and page are done
- Expected: the second request supersedes the first; the abandoned file's parse stops at its next slice and the small file shows at once
- Actual: the second `open` is queued behind the first; the first's abort test is `closed`, which only `close()` sets, so nothing can cancel it. Small file shown after 3.6 s behind a 2 MB prose file and after 10.8 s behind a 4.9 MB rich one (the wait follows the first file; hunt-03 NAV-04 saw 30 to 38 s on a real 2 MB open)
- Evidence: probe probes/TWO/second.mjs (outputs probes/TWO/second.out for 2 MB, second5.out for 4.9 MB); both opens issued in one `page.evaluate`, the h1 polled every 0.5 s. Code reading: no open generation or per-open abort exists, only `closed`
- Confidence: high
- Found by: catcher TWO, 2026-11-28

### SCH-01 · A small file opened right after a big Markdown one waits for the big one's whole open
- Severity: S2 wrong result (stall)
- Domain: document open
- Where: apps/desktop/src/document/open.ts:1046-1063 (`open` queues on `view.serially`), open.ts:660-663 (parse and node map checked only against `closed`), apps/desktop/src/view/rendered-view.ts:739
- Repro: open a 4 MB Markdown file (many `##` sections, blank-line separated); at once open a small file (Open, palette, or click in Places)
- Expected: the newer open replaces the older; the first file's parse and render stop (docs/big-files.md rule 2: cancelled when the reader leaves)
- Actual: the small file's open resolves only after the big file's open has finished: 5689 ms vs 42-58 ms when opened alone. `closed` is set only when the pane closes, so a newer open never cancels the older one's slices.
- Evidence: probe probes/SCH/queue-open.mjs, output probes/SCH/queue-open.out ("B alone 42", "A alone 5631", "A then B: a 5647, b 5689"). Code: the `stale`/`closed` checks passed to `parseLarge`, `buildNodeMapInSlices` and `renderDocumentSafeHtmlInSlices` have no "a newer open exists" term; opens are only chained.
- Confidence: high
- Found by: catcher SCH, 2026-11-28

### PRS-01 · Typing in the palette over a big changelog freezes the window for seconds, once per edit
- Severity: S1 freeze
- Domain: commands, kinds
- Where: apps/desktop/src/commands/kind-tools.ts:63 (`releaseOf` parses the whole buffer), :70 (`hasRelease`), :131-132 (`when` and `unavailable` of `changelog.copy-release-notes`)
- Repro: plant a 2 MB `CHANGELOG.md` of `## n.0.0` sections (probes/PRS/changelog2.mjs); open it (kind changelog); Ctrl+K and type a letter. Any edit of the file makes the next palette query do it again
- Expected: the command's `when` reads the store's parse (`snapshot().ast`) or a bounded scan; the palette answers at once
- Actual: the first query stalls the page about 4.3 s in `parseMarkdown`, called synchronously from `paletteCommands` -> `hasRelease` -> `releaseOf`. The WeakMap is keyed by `Buffer`, so every version of the bytes parses again
- Evidence: probe probes/PRS/changelog2.mjs with a CDP profile (output in probes/PRS/changelog2.out): `parseMarkdown parse/parse.ts:23` 4321 ms under `releaseOf kind-tools.ts:38` under `paletteCommands palette/commands.ts:68`. Node timing of the same parse on 2 MB: 3.3-4.5 s (probes/PRS/time.out). Breaks docs/big-files.md rule 1 (reuse the store's parse). Note: opening the palette alone (no typing) shows no parse; it is the first query
- Confidence: high
- Found by: catcher PRS, 2026-11-28

### SCH-02 · Colouring the code in view crawls at one block per 100 ms while any background parse or mount is slicing
- Severity: S3 slow (cosmetic delay, grows with the number of blocks in view)
- Domain: scheduler, highlighting
- Where: apps/desktop/src/scheduler/index.ts:37-51 (`pump`), apps/desktop/src/startup/yield.ts:4, apps/desktop/src/view/reading-rows.ts:61, apps/desktop/src/view/reading-lines.ts:38, apps/desktop/src/render/highlight-queue.ts:16
- Repro: open a 1-4 MB Markdown file with many fenced code blocks (the parse behind, the node map and the sliced render all run on `input`); scroll to code blocks and watch them stay plain
- Expected: the scheduler's own doc says `input` is what the reader just asked for, `viewport` is what is on screen, `background` is what nobody waits on, higher first
- Actual: every background job (parse, node map, parseBehind, sliced render, line and row indexing) passes `input`, which outranks `viewport`; highlight jobs wait on `viewport`, so while any input-lane job slices, each highlight job waits for `STARVE_MS` (100 ms) before `pump` lets it through, one job per 100 ms. `background` is used by nothing, so the three lanes collapse to two with the screen's work below the file's.
- Evidence: probe probes/SCH/lane-starve.mjs (output lane-starve.out): ten `yieldToMain('viewport')` take 0 ms idle and 1008 ms with a 2 ms-slice `runSliced` on the default lane running; ten on `input` take 21 ms. The real highlight path is code reading: `JobQueue.nextTask` is `yieldToMain('viewport')` after every job. Not driven end to end over a big page.
- Confidence: high for the mechanism, medium for the size of the effect on a real page
- Found by: catcher SCH, 2026-11-28

### PRS-02 · Moving one section in a big document parses the whole file again first, per move (a drag does it per step)
- Severity: S1 freeze
- Domain: outline
- Where: apps/desktop/src/frame/model/outline.ts:275 (`parseMarkdown(candidate, ...)` in `applyOutlineAction`), :112-285 callers `runOutlineAction`; apps/desktop/src/left/panels/outline.ts:121-130 (`moveTo` loops `runOutlineAction` n times)
- Repro: plant a 2 MB Markdown file of `## Section n` blocks (probes/PRS/move.mjs); Alt+3 (Outline); click row "Section 3"; Alt+ArrowDown
- Expected: a move costs what the section costs; the shape check reads bounded work, or runs in slices that can be cancelled
- Actual: before the splice is staged, `applyOutlineAction` encodes a full candidate copy, calls the synchronous `parseMarkdown` on all of it and builds `blockKeys` for every top-level block. One move held the page about 3.6 s in this probe. A drag past n siblings runs it n times in a loop, then undoes n times
- Evidence: probe probes/PRS/move.mjs with a CDP profile (probes/PRS/move.out): `applyOutlineAction outline.ts:113` 3668 ms, of which `parseMarkdown parse/parse.ts:23` 3566 ms. Separately `store.apply` commit was 2.1 s (not on this axis). Breaks docs/big-files.md rule 1 and "no parse on a key"
- Confidence: high
- Found by: catcher PRS, 2026-11-28

### SCH-03 · Code blocks in the first screens stay uncoloured until the whole 3 MB page has finished mounting
- Severity: S3 slow
- Domain: rendering, highlighting
- Where: apps/desktop/src/view/rendered-view.ts:2706-2723 (`afterComplete`, `deferAfterComplete`), apps/desktop/src/render/progressive.ts:205-229 (the mount's idle steps)
- Repro: plant a 3 MB Markdown file with 40 fenced `js` blocks at the top and ~60,000 short paragraphs after; open it and watch the first fences
- Expected: the `viewport` lane exists so the blocks on screen are coloured first; docs/big-files.md says the page is mounted "two screens first and the rest in idle slices"
- Actual: all 40 fences are in the page at 3.9 s but none is coloured until the mount completes at about 8.3 s; first colour at 9.1 s. Colour, images and KaTeX run only after `current.complete`, so what the reader is looking at waits for the idle mount of the far end of the file.
- Evidence: probe probes/SCH/highlight-rate.mjs (output highlight-rate.out): `done/code/blocks` is 0/40/3007 at 3876 ms and stays 0 until 17/40/61701 at 9103 ms (17 = the fences in view; the rest are coloured lazily). The comment at rendered-view.ts:2706 says this is intended ("see the whole document"), so a verifier may call it by design; the gap is that the lane that exists for it (`viewport`) is never reached until the background mount is done. Headless Chromium, memory shell, so absolute times differ in the real window.
- Confidence: medium
- Found by: catcher SCH, 2026-11-28

### TWO-02 · The same large file opened in both panes at once takes 18 to 30 s to show; one open, or one after the other, takes about a second
- Severity: S2 wrong result (a wait many times the single open's)
- Domain: open
- Where: apps/desktop/src/document/open.ts:650-667 (`holding` is read before the parse and is null while the other pane's open is still parsing), :707 (`deps.stores.acquire` hands back the other pane's store, so the parse this pane made is dropped), document/registry.ts:102-107
- Repro: with two panes on screen, `handle.open('/demo/D.md')` and `handle.open('/demo/D.md', { target: 'other' })` back to back, D.md being 3 MB of list items with hard breaks and links (a second launch plus a restored layout, or Open in other pane pressed twice, meets the same)
- Expected: one parse for a file however many panes show it (the comment at open.ts:718): both panes show within about the time of one open
- Actual: first text in either pane after 17.8 s, the second pane after 25.4 s, both done at 30.3 s. The same file opened in the other pane after the first is settled shows in 1.2 s; a lone open in a pane shows first text in 0.5 s
- Evidence: probes/TWO/twopanes3.mjs (output twopanes3.out) and twopanes2.mjs (twopanes2.out: 19.2 s, 28.0 s, 32.5 s against 1.2 s sequential). The cause is read from the code, not isolated: pane B reads `heldNow` before pane A has acquired, so `holding` is null, B parses the whole file itself, then `acquire` returns A's store and B's `preparsed` is thrown away. The `parsed` mark count (3) shows one store, which hides the second parse
- Confidence: medium (the wait is seen; the double parse is the reading that fits it)
- Found by: catcher TWO, 2026-11-28

### TWO-03 · Opening several files from the system (Explorer or Finder "Open", a drop of several files) opens only the first
- Severity: S2 wrong result
- Domain: startup
- Where: apps/desktop/src/startup/system-opens.ts:15-17 (`paths.find(...)` keeps one path of the payload), apps/desktop/src-tauri/src/main.rs:1040-1050 (`deliver_open_files` puts every path in scope and emits all of them in one payload)
- Repro: select three Markdown files in Explorer and Open with Marxy (one launch with three arguments; the single-instance hand-off to a running window is one payload), or drop three files on the window
- Expected: docs/using-marxy.md:9-10 says a second launch hands "its files" to the running window and files can be dropped: each file opens (a tab, or in order)
- Actual: the other two are in the opened scope but nothing ever opens them; no notice says so
- Evidence: code reading alone: `take(paths)` opens `paths.find(p => p.length > 0 && !p.startsWith('-'))` and drops the rest, while Rust sends the whole batch and `document_paths_from_argv`/`document_paths_from_drop` keep every document path. Not driven in the real window
- Confidence: medium
- Found by: catcher TWO, 2026-11-28

### TWO-04 · A file edited while a large open is still parsing shows the old version for good
- Severity: S2 wrong result (stale page, no notice)
- Domain: open, live reload
- Where: apps/desktop/src/document/open.ts:1000-1030 (`finishDocumentOpen` starts `watches.watch(current)` only after `view.typeset()` and `whenIdle`), document/live-reload.ts:495-520 (`watchFolderOf` subscribes and never compares the store's bytes with disk when the watch comes up)
- Repro: open a 3 MB Markdown file; one second later an editor or a build rewrites it (a different first heading); wait
- Expected: once the page is up the watch reads disk, sees it differs, and reloads (or the page never claims to show a version that is gone)
- Actual: the page shows the first version for 60 s and after an event for another file in the folder; the change is only ever noticed if the same file changes again. The bigger the file, the longer the window between the read and the watch
- Evidence: probe probes/TWO/editduring.mjs (output editduring.out): file planted as version 1, open started, version 2 planted 300 ms later (the memory shell has no watch yet, as a real one has none), h1 stays VERSION1 across 12 polls over 60 s with the watch up from the 12 s poll on. The real watcher's pre-subscription gap is the same by construction; not driven in the real window
- Confidence: high for the missing catch-up, medium that a real watcher shows the same
- Found by: catcher TWO, 2026-11-28

### TWO-05 · Asking for the file already open (or opening) again reads and parses it all again: 22 s a time for 3 MB
- Severity: S2 wrong result (an open run twice)
- Domain: open
- Where: apps/desktop/src/document/open.ts:1048-1050 (`open` returns early only when there are unsaved changes), :1011-1021 (`openReplacing` has no case for `file === openPath` with no `at` and a clean store; with the first open still in flight `currentPath()` is still the old file, so the second is not recognised at all)
- Repro: open a 3 MB Markdown file; at once, or after it has settled, open the same path again (palette on the current document, a second launch or Finder open of the file, a click on its own link or crumb)
- Expected: the same file asked for with nowhere to go is a no-op (or a cheap check of disk against the store), and a second request for a path whose open is running joins it
- Actual: two requests in one tick settle after 44.8 s with two `file_read` marks and two `readFile` calls; one more request on the settled file takes 21.9 s again. The page is rebuilt each time
- Evidence: probe probes/TWO/twice.mjs (output twice.out). The main-thread cost of the repeat was not measured here
- Confidence: high
- Found by: catcher TWO, 2026-11-28

### PRS-03 · Opening Links (or Metadata) on a big file scans the whole text once per distinct written path
- Severity: S2 freeze (1.4 s at 2,271 paths in 2 MB; 16 s at 35,000 paths)
- Domain: links panel
- Where: apps/desktop/src/left/doc-model.ts:408-430 (`linesNaming`: `text.indexOf(w)` over the whole text for each distinct needle), called from apps/desktop/src/left/doc-links.ts:89 (`saidOf`, synchronous); also reached by `linkCount` (doc-links.ts, left/panels/metadata.ts:443)
- Repro: plant a 2 MB Markdown file with one backticked `src/fileN.ts` path in every 900 bytes (probes/PRS/paths2k.mjs); open it; Alt+4
- Expected: work per panel is bounded or sliced; the mention lines come from one pass (the prose lines already walked by `pathMentions`)
- Actual: `saidOf` holds the page 1.4 s; with 35,000 distinct paths (probes/PRS/bom.mjs, BOM=0 and 1) 16-18 s. Work is paths x file size, not file size
- Evidence: CDP profile probes/PRS/paths2k.out: `saidOf doc-links.ts:38` 1418 ms, of which `linesNaming` 1376 ms; probes/PRS/bom.out: 16 s and 17.8 s. Not a parse, but the same rule (docs/big-files.md: whole-file work yields, once per version). Cached per version, so every edit pays it again on the next panel draw
- Confidence: high
- Found by: catcher PRS, 2026-11-28

### PRS-04 · Opening the Transforms panel on a big Markdown file with a byte-order mark freezes the window for seconds
- Severity: S1 freeze
- Domain: transforms
- Where: apps/desktop/src/left/transforms-model.ts:183 (`parseOf` -> `parseMarkdown(encoder.encode(text))`, synchronous, inside the sliced `byNodes`), fed by apps/desktop/src/left/panels/transforms.ts:55-70 (`docOf`: `textParse()` is null for a BOM, and `crParse` refuses a BOM too, so `parsed` is null)
- Repro: plant a 2 MB Markdown file that starts with U+FEFF, with task lists and prose (probes/PRS/tr.mjs, BOM=1); open it; Alt+6 (Transforms)
- Expected: the rows that read nodes (Renumber, Align tables, Tick, Untick) take the store's parse, or parse in slices; the panel opens at once
- Actual: the same file without the BOM spends 0.6 s in the panel's work; with the BOM the profile shows `parseMarkdown` 9.9 s, `parseOf` 5.0 s in one `byNodes` call (the rest the other node rows and core's own parse for the next ones), all on the main thread. The parse is not in the generator's slices, so its `yield` cannot help. The same happens for a file with a byte the strict decode replaces (`textPairOf` returns null for it too); that variant was not driven
- Evidence: probe probes/PRS/tr.mjs, CDP profiles in probes/PRS/tr.out (BOM=1: `parseMarkdown` 9925 ms under `parseOf transforms-model.ts:106` 5013 ms; BOM=0: no parse, 583 ms). Breaks docs/big-files.md rule 1 (reuse the store's parse) for a common Windows file shape
- Confidence: high
- Found by: catcher PRS, 2026-11-28
