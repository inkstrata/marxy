# Axes

### TWO · two opens at once around the changed open path
- Round: 1
- Type: shape
- Source: #829 (`parseLarge` aborts only when the pane closes: `open.ts:660` passes `() => closed`, and `closed` is set only in `close()`, `open.ts:1227`); #813 (opens emitted while no boot listens wait for the next boot, `frame/document-signal.ts`, `shell/tauri.ts`); hunt-03 NAV-04 (a second 2 MB open took 30 to 38 s); `docs/architecture.md:240`
- Lens: Assume the open path mishandles a second request while the first is in flight: a second file opened in the same pane, a tab switch, a reload from disk or an edit while a large parse is in the worker or `parseBehind` runs, the same file in two panes (the 64 KB gate), Back after a link, and several opens queued before the boot listens. Find a page that shows the wrong file or an old version, a parse that lands on a store it no longer belongs to, a wait that grows with the first file, or an open lost or run twice.
- Start in: apps/desktop/src/document/open.ts, apps/desktop/src/document/parse-worker.ts, apps/desktop/src/frame/document-signal.ts, apps/desktop/src/shell/tauri.ts, apps/desktop/src/pane/
- Model: sonnet

### SCH · work moved onto the one scheduler lost its place in line or its cancellation
- Round: 1
- Type: pattern
- Source: #822 (one scheduler for sliced work: `scheduler/index.ts` with three lanes); every caller passes `input` or the default (`startup/yield.ts:4` `yieldToEventLoop`, which the background parse, `buildNodeMapInSlices` and `parseBehind` use; `view/reading-rows.ts:61`, `view/reading-lines.ts:38`), only `render/highlight-queue.ts:16` uses `viewport`, and nothing uses `background`; `docs/big-files.md` rule 2 ("can be cancelled when the bytes change or the reader leaves")
- Lens: Assume the sites converted to `yieldToMain` changed what runs first or stopped checking whether they are still wanted. Find background work (a parse behind the page, a node map, a panel's model) that holds the reader's find, keys or frames off because it shares the `input` lane, and sliced work that runs on after its pane, document or query is gone, measured in CPU or task time.
- Start in: apps/desktop/src/scheduler/index.ts, apps/desktop/src/startup/yield.ts, apps/desktop/src/render/highlight-queue.ts, apps/desktop/src/view/reading-rows.ts, apps/desktop/src/view/reading-lines.ts, apps/desktop/src/find/walk.ts, apps/desktop/src/render/post.ts
- Model: sonnet

### PRS · a whole-file Markdown parse outside the store's kept parse
- Round: 1
- Type: pattern
- Source: hunt-02 B17, B18 (Transforms and Links parsing again, both confirmed S1) and its "For the next hunt" (other callers of whole-file parses in `left/`); hunt-03 NAV-06 (the Line's `@` parsed the whole file, confirmed); `docs/big-files.md` rule 1. Callers still in the tree: `commands/kind-tools.ts:63` (`parseMarkdown(buffer.bytes)`), `frame/model/outline.ts:275`, `left/transforms-model.ts:183`, `source/notes.ts:85`, `frontispiece/index.ts:29`, `left/doc-links.ts:84` (`pathMentions(text)` without a parse)
- Lens: Search `rg -n "parseMarkdown\(|parseMarkdownChunked\(|fromMarkdown\(|pathMentions\(" apps/desktop/src -g '!*.test.ts'` and, outside `document/store.ts` and `document/open.ts`, find each call that parses a whole document on a key, panel or command instead of reading the store's parse; time each on a 2 MB file and keep those over 200 ms of CPU.
- Start in: apps/desktop/src/commands/kind-tools.ts, apps/desktop/src/frame/model/outline.ts, apps/desktop/src/left/transforms-model.ts, apps/desktop/src/source/notes.ts, apps/desktop/src/left/doc-links.ts
- Model: sonnet

