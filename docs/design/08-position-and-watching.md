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
     pos = current(); history.clear(); buffer = createBuffer(path, bytes)
     reparse → re-render → typeset viewport (cache) → restore(pos)        // budget 100 ms at 200 KB
  if event.kind == 'removed' && event.path == buffer.path:
     notice "The file was deleted" [Keep showing it] [Close]; the buffer stays; saving recreates the file
  else: index update only (§07)
```

The `mark('live_reload', …)` pair around this path feeds the perf gate's `live_reload_ms`.

Atomic-replace writes (write-temp-then-rename) arrive as `renamed → path` or `created` (§06
mapping) and take the same branch as `modified`. The watcher is on the root directory, so the
inode of the file never matters. Delete-then-recreate within one debounce window collapses to
one batch containing `removed` and `created`; the app applies the last event for the path.

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
