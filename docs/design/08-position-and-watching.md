# 08 — Reading position and watching

ADR-0018: position is `{ path, byteOffset, fraction, mode }`, never a scroll offset. This
document fixes how it is computed from the DOM, restored, persisted, and preserved across the
three events that move text under the reader: reload, mode switch, re-layout.

## Computing the position (D-A17)

The render post-pass (§02) leaves `blocks: { el: Element; start: number; top: number; height: number }[]`
in document order, refreshed after every typeset pass and grid pass (tops change). On scroll
(passive listener, sampled at most once per animation frame):

```
i = first index with blocks[i].top + blocks[i].height > scrollTop + readingLine   // binary search
byteOffset = blocks[i].start
fraction = clamp((scrollTop + readingLine - blocks[i].top) / blocks[i].height, 0, 1)
```

`readingLine = 0.4 × viewportHeight` (the "reading line"; also where find lands a match, §09).
Choosing the block under the reading line rather than at the viewport top means a heading
just above the top does not become the position, so a reload never scrolls the reader up to
a heading they had already passed.

## Restoring

```
el = the block with the smallest start ≥ byteOffset (else the last block)
scrollTop = el.top + fraction × el.height − readingLine
```

Restore runs **after** typesetting the viewport but **before** that frame is committed (the
typeset controller exposes `ready` for the viewport pass; the app awaits it, then sets
`scrollTop`, all within the same frame using `requestAnimationFrame` ordering) so the reader
never sees a jump. If the document became shorter and `byteOffset ≥ byteLength`, restore to
the end.

## Persistence

`positions.json` (§11): `{ version: 1, positions: { "<path>": { byteOffset, fraction, mode, at } } }`,
LRU capped at 5,000 paths. Written debounced 500 ms after the position changes, and on window
close. On open, if an entry exists and the file's byte length is ≥ `byteOffset`, restore;
otherwise start at the top. Positions are per path, not per content hash: a regenerated
artifact keeps its place, which is the point.

With two panes, one pane writes each path's place (D-12): the focused pane if it shows the path, else the
lowest slot that does (`writerFor`, `apps/desktop/src/layout/restore.ts`). A second view of a file already
shown is never written, so a pair of views of one file leaves one entry, the writer's. Which documents are
open, in which modes, at which ratio, is `layout.json` (§11); positions stay per path.

## Mode switch (§09 has the keys)

Rendered → Source: `pos = current()`; CodeMirror scrolls so that line containing
`byteToUtf16(byteOffset)` sits at the reading line (`view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: readingLine }) })`).
Source → Rendered: `byteOffset = utf16ToByte(the first visible line's from)`, `fraction = 0`;
after re-render and viewport typeset, restore. Selection: Rendered `node` selection → CodeMirror
selection over `[byteToUtf16(start), byteToUtf16(end))`; CodeMirror selection → the node whose
range contains the cursor's byte, else `none`.

## Reload after an external change (A19, the defining interaction)

```
on marxy:watch batch:
  if any event.path == buffer.path (or renamed.to == buffer.path):
     bytes = shell.readFile(path)                     // may fail once during an atomic rename; retry after 50 ms, twice
     if contentHash(bytes) == savedHash: ignore        // our own save
     if contentHash(bytes) == contentHash(buffer.bytes): ignore
     if dirty: notice "The file changed on disk" [Reload, discarding your changes] [Keep mine]; stop
     pos = current(); pos.byteOffset = offsetThroughEdit(pos.byteOffset, buffer.bytes, bytes)
     history.clear(); buffer = createBuffer(path, bytes)
     reparse the changed blocks → re-render → typeset viewport (cache) → restore(pos)   // budget 100 ms at 200 KB
  if event.kind == 'removed' && event.path == buffer.path:
     notice "The file was deleted" [Keep showing it] [Close]; the buffer stays; saving recreates the file
  else: index update only (§07)
```

A byte offset is not stable across an edit above it: an agent inserting a section before the
reader moves every later byte. `offsetThroughEdit` (core, `position/restore.ts`) finds the one
changed run between the old and new bytes' common prefix and suffix; an offset before it stays,
one after it moves by the change in length, one inside it lands at the run's start
(`reloadOpenDocument(bytes, previous, previousBytes)`, MARXY-198).

The reparse is incremental (B-23, `core/parse/reparse.ts`): `reparseMarkdown(previous, before,
after)` parses only the top-level blocks the change touches and keeps the rest of the previous parse
by byte range, moving the blocks after the change by its length. Both ends of the region are fresh
lines: a line that starts a top-level block at column 0, after a blank line, and not after indented
code, so nothing before it is still open (a list item, which micromark keeps open across blank
lines, takes only indented lines). The region restarts at a fresh line in a block wholly before the
change and not after a list, and ends at a witness, a fresh line in the previous parse after the
change. The region is parsed through the witness's line and its line ending; when the witness is
fresh in that parse too, every block from it on is the previous parse's, moved. Otherwise the region
grows, and past half the file it parses the whole file. A previous parse or a region's parse that
holds a link reference or footnote definition (they apply file-wide) is parsed whole, and so is a
file opening like frontmatter that does not close; text that only looks like a definition (`if
xs[0]:` in code) is not. The result equals `parseMarkdown` node for node and line start for line
start (`reparse.test.ts`: a structured generator of 44 block constructs on every pull request,
`pnpm --filter @marxy/core test:reparse-stress` for 1,500 seeds, random edits over the corpus, and
the cases the review of #467 found). The watcher reparses to map the place, and the store's `reload`
reparses from its own parse the same way.

The `live_reload` mark spans the watch event to every view settled at its place, with the stages
in its detail (`read`, `map`, `store`, `settle`); `node scripts/measure-reload.mjs` prints them for
a 1 MB agent transcript. Measured on 2026-10-08 (WebKit, medians of three, one line written above
the reader): 1,034 ms before B-23, 150 to 260 ms after; on the denser 200,000-node document of the
F-19.1 review, 5.4 s before and about 0.6 s after. **The nightly `live_reload` series changes
meaning at B-23:** the mark used to span the store's reload to settled and now spans the watch event
to settled, so it includes the file read and the watcher's parse, which the reader waits through.
A step in the nightly record at that commit is partly this widening, not only the reparse. What
remains is the whole-document render, sanitise and node map, which a partial re-render would cut
(02-phase-b.md, "left out").

Atomic-replace writes (write-temp-then-rename) arrive as `renamed → path` or `created` (§06
mapping) and take the same branch as `modified`. The watcher is on the root directory, so the
inode of the file never matters. Delete-then-recreate within one debounce window collapses to
one batch containing `removed` and `created`; the app applies the last event for the path.

## Two views of one file (D-10)

A file shown in both panes ("Split this document") is one store and one watch. The registry hands the
second pane the store already open for the path, so the file is read and parsed once, and the window's
live reload (`oneWatchPerStore`, started by whichever pane shows the store first) is the store's: it
closes with the store when the last view lets go, and a pane that goes while another still shows the
store leaves it running. The folder's watch fires for every file in it, so an event that names another
file is that file's store's and this one's bytes are not read for it.

A change on disk is handled once for the store and reaches every view:

- **Ask every view before the store reloads.** Source text typed in either pane and not yet folded in is
  an unsaved edit the store cannot see. The watch asks every view, and the store asks again at the turn it
  would commit (`reload(bytes, { holds })`), so a key typed in between cannot slip through. Either answer
  keeps the change out, says so in each pane that shows the file, and leaves the stale-write guard on the
  bytes the text came from: a save is then refused, never written over the other program's change.
- **Each view keeps its own place.** The reload maps each view's place through the change; an edit or fold
  from either view maps the other's anchor by the edit's delta (ADR-0037 §6). A Rendered view over a store
  the other pane folded Source text into is set again as for any edit, not sent to the top.
- **A rename follows once.** With unsaved text in any view the store is renamed in place under every pane
  (the buffer keeps its edits and the guard is armed on the new name with the bytes last read, so a save
  that would overwrite what the new name holds is refused); with none, each view in turn opens the new path
  and the registry gives them one store.
- **Notices are per pane.** "Removed", "changed on disk", blocked content and a failed save are said in the
  pane that shows the file and in no other; opening a document clears that pane's notices only.

## Re-layout (fonts, resize, theme)

Position is captured before `typeset.relayout(reason)` and restored after its viewport pass,
exactly as for reload. Resize captures on `resize` start (first event) and restores on the
debounced end, so a window being dragged wider does not drift the reader.

## Tests

- Unit (`apps/desktop/src/position/position.test.ts`, jsdom-free: operate on the `blocks` array):
  the block under the reading line is chosen; fraction is 0 at its top and 1 at its bottom;
  restore is the inverse of compute for every block boundary of the corpus at three viewport
  heights.
- Playwright: reload of `03-ai-plan.md` after a scripted `write-temp-then-rename` keeps the same
  first visible block; `removed` shows the notice and the text stays; a dirty buffer gets the
  conflict notice and is not replaced; mode switch and back returns to the same block.
- Perf: `live_reload_ms` < 100 on the reference tier for `01-long-technical.md`.
