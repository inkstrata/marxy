---
corpus: windowed-pages
id: 08
slug: find-select-copy
prefix: FSC
title: Find, select all and copy over a byte model
researched: 2026-11-27
confidence: medium
volatility: low
status: active
keywords: [find, select all, copy, CSS.highlights, SearchCursor, copy event, clipboardData, geometry table, pendingBlocks, mountThrough]
---

# 08 · Find, select all and copy over a byte model

## Abstract

Most of the app's find, select all and copy already works on a model rather than the screen in three places: the left
panel's search matches bytes, the selection model has `document`, `section` and `blocks` kinds that are byte ranges, and
native copy of code is rebuilt from the buffer's bytes. What assumes every block is mounted is the rendered find (it
walks the article's text nodes) and copy of a native DOM range. A pending change to find and copy already teaches both to
read blocks that are not yet appended, by reading the inert container of unmounted blocks. This chapter sets out how to
carry that one step further so that nothing depends on blocks being in the DOM, and what the editors (CodeMirror 6,
ProseMirror, Monaco, Google Docs) do. Web evidence is the editors' own source and docs; the engines' clipboard size
limits could not be found and are an `[absence]`.

## TL;DR

- Find should match over a **per-block rendered-text cache** keyed by the geometry table's blocks, not over the DOM. The
  match gives (block, offset in block text); only the mounted ones become `Range`s for `CSS.highlights`; a match in an
  unmounted block is mounted through (the pending change already does this). The same structure gives the count for the
  whole file, which a CM-style viewport model also gives.
- Select all must stop being a DOM selection. Make it the selection model's `document` kind (already present) and have
  the `copy` event handler build the clipboard from the model, as CodeMirror does (`state.sliceDoc`) and as the app
  already does for code. A DOM selection from a drag stays native; one that crosses the mount edge is clamped.
- Copy as text of unmounted blocks comes from the cached block text; copy as HTML comes from the parse (the inert
  fragment for that block range, sanitised) without mounting. No new mounting is needed for either.
- One path: find and copy ask the geometry table for byte to block, block to mounted, and mount-through. Small pages
  mount everything, so they take the same calls with an always-true "mounted".
- Biggest risk: the cached text must equal what the DOM walk gives (`NON_CONTENT` rule, hyphens, front matter rows). It
  needs an equivalence test on mounted blocks, run on the fixtures.

## Recommendation

1. **Per-block rendered text.** Add to the geometry table, per top-level block, a lazily built `text` string (and its
   length), built from the block's parsed fragment by the same skip rule as `NON_CONTENT`, never from layout. Build it in
   idle slices, as `parseInertInSlices` does for the parse, once per version of the bytes, cancellable. A block splice
   invalidates only its entry (the table agrees with the bytes after an edit). Concatenated text and a block-start offset
   table (a prefix array, binary-searched) replace `buildTextIndex`'s per-text-node `starts`.
2. **Find** runs `findAll` over that text. For each match: block by binary search; if the block is mounted, find the
   Range by walking just that block's text nodes with the existing walk; if not, count it and mark the block (the Spine's
   hit marks use block start bytes already). Stepping to an unmounted match calls mount-through to its block's byte, then
   places the Range. Highlights remain `CSS.highlights` over mounted blocks only; the existing window of at most 600
   Ranges is unchanged.
3. **Select all** sets the model selection `document`; paint a selection highlight with `CSS.highlights` on the mounted
   blocks. Also keep the native DOM selection on the mounted part so the browser's own UI looks right, but never read it
   for copy when the model selection is `document`.
4. **Copy** reads the model selection: text from the block text cache, bytes (source) for the "copy as" formats from the
   buffer, HTML from the parse of the block range. Native copy of a DOM range inside the mount stays as now.
5. Keep the pending change's logic (find over pending blocks, mount-through before show, select-all appending pending
   blocks) as the behaviour to preserve; its tests become the acceptance tests of the new path, run both on a page that
   mounts whole and on one that mounts a window.

## Findings

### FSC-01 · The rendered find walks the DOM's text nodes and indexes them as one string  [confirmed]

`collectText` creates a `TreeWalker` over the article and keeps every text node not under a `NON_CONTENT` selector
(`apps/desktop/src/find/walk.ts:66-81`); `walkText` builds the index from those pieces (`walk.ts:88-91`), and
`buildTextIndex` joins them, with `locate` a binary search over piece starts (`find/text-index.ts:33-64`). `findAll`
runs a regular expression over that one string (`text-index.ts:67-81`). The comment in `walk.ts:16-17` says ranges are
resolved from a fresh walk every time, because "the typesetter splits text nodes in the background". `find/view.ts`
calls `walkText` on every run (`view.ts:347`, `view.ts:593`). So find costs one full walk of the mounted article per
match run, and sees nothing that is not mounted. Sources: the files named, read 2026-11-27.

### FSC-02 · A pending change already makes find and select-all copy see unmounted blocks, through the inert container  [likely]

`pendingBlocks(article)` returns the container of blocks not yet appended, or null (`render/progressive.ts`, in the
pending diff: "The blocks of `article`'s document not yet appended, in order (the inert container)"; the mount's own
`pending: () => (done ? null : from)` is at `progressive.ts:233`). `walkPage` appends the text of those blocks after the
article's, with `mounted` counting how many pieces are in the page; `inPage` and `byteAt` tell whether a match is mounted
and which block's start byte to mount through; `placeRange` refuses a match in an unmounted piece. In `view.ts` a new
`reach()` mounts through the current match before it is shown, and `run` waits for a typing pause when the last walk took
more than 8 ms (`SLOW_WALK_MS`, `TYPING_PAUSE_MS` 120 ms). `cloneRangeInert` gains `appendRest`: a range that starts at
the first character and ends at the article itself (select all) takes the pending blocks too, and its test asserts that
the copy of a part-mounted page equals the copy of the finished page. Source: the diff of the pending change, read
2026-11-27; the test file in that diff is `find-copy-mounting.test.mjs`. The diff is a pending change to find and copy, not on main at a6d7fab5: `pendingBlocks`, `appendRest` and `SLOW_WALK_MS` are not in that checkout (only `progressive.ts:233` is), so this finding is unverified here and rests on a diff that was not re-read. This works because the unmounted blocks still
exist as DOM in an inert document: it costs memory, not layout. It does not work once unmounted blocks are dropped (tier
2 with a byte model), which is why FSC-14 and FSC-15 exist.

### FSC-03 · The walk's cost grows with the page; the pending change already treats it as a budget, not a constant  [likely]

The pending change makes typing wait for a 120 ms pause once a walk has taken over 8 ms, and reuses one walk per task
(`taskWalk`, cleared in a microtask). That is the app's own admission that a whole-page walk per keystroke is wrong on
long pages. A per-block text cache removes the walk: a keystroke is a regular expression over a string. Source: the
diff, read 2026-11-27. The cost of a regular expression over a 1 MB string was not measured here; it is bounded by the
file, so under the repository's scale rule it needs yielding (`findAll` over a long text is a "whole-file work once per
query" case) [likely].

### FSC-04 · The selection model already has byte-range kinds; native copy already reads bytes for code  [confirmed]

The `Selection` union has `document`, `section` and `blocks`, the last "a contiguous run of sibling blocks: `range` is
first.start to last.end", with `els` the mounted carriers ("a block not yet on the page has none")
(`selection/selection.ts:7-25`). A `copy` event listener on `document` handles a `blocks` selection (which applies only when every top-level child is a code block with a `run`, so code files only) over code by
`event.clipboardData.setData('text/plain', ... runtime.buffer.bytes.subarray(chosen.range.start, chosen.range.end))` and
`preventDefault()`, and for a DOM range over code pieces calls `codeRunSourceText` and does the same
(`selection/bind.ts:279-312`); `codeRunSourceText` maps page-text offsets back to the file's own bytes through the
buffer (`selection/copy-text.ts:137-176`, doc comment from about 129). Copy through the shell writes the text and HTML representations as one item
through `clipboardWriteItem` (`commands/copy-write.ts:36-55`), so the size of a copy is not bounded by a webview
clipboard path. So the architecture "model owns the selection; the event hands out bytes" exists and only needs to
cover prose.

### FSC-05 · CodeMirror 6 searches and copies the document, not the DOM; select-all is a state command  [confirmed]

`@codemirror/search` builds `new SearchCursor(state.doc, spec.unquoted, from, to, ...)` over the `Text` of the state
(`search.ts:205`), and the cursor's docs call it "an iterator over text matches in a document" [1][2]. The panel scrolls
to a match through `scrollToMatch: range => EditorView.scrollIntoView(range)` (`search.ts:69`), a state effect, not a DOM
operation [1]. The view docs say CodeMirror "only draws the code that is visible (plus a margin around it) to the DOM"
(`EditorView.viewport`) [2], and `selectAll` is a `StateCommand` bound to Mod-a [2]. Copy is a `handlers.copy` that
ignores the DOM selection: `copiedRange(state)` is `state.sliceDoc(range.from, range.to)` over `state.selection.ranges`,
then `data.clearData(); data.setData("text/plain", text)` on the event's `clipboardData` and returns true, which
prevents the default [3]. It only declines when "the DOM selection is outside this editor" [3]. It supplies only
text/plain in that handler. Sources: [1] `search.ts` on GitHub (main, 2026-11-27); [2] CodeMirror reference, codemirror.net
(2026-11-27); [3] `input.ts` on GitHub (main, 2026-11-27).

### FSC-06 · ProseMirror serialises the selection slice from its model, with text and HTML in one function  [confirmed]

`serializeForClipboard(view, slice)` returns `{dom, text, slice}`: the slice is of the state's document, not of the DOM;
the text is `clipboardTextSerializer` or `slice.content.textBetween(0, slice.content.size, "\n\n")`, the HTML a
serialised `dom` carrying `data-pm-slice` [4]. This is the model for the app's copy: one function that takes a model range
and returns both representations, called from the `copy` handler, with hooks (`transformCopied`) for display-only
filtering such as the app's `DROP_CLASSES`. Source [4]: `clipboard.ts` in prosemirror-view (master, 2026-11-27).

### FSC-07 · Monaco and VS Code keep a model apart from a thin view; the find widget is an overlay on the model  [likely]

The VS Code code-editor design doc describes the editor as Model-View-ViewModel, with the ViewModel "the bridge between
the View and the Model" and says a `\t` is "always a single character in Model" [5]. Search results on the Monaco design
doc describe the Find widget as an overlay widget and the view as showing only the visible range, but I did not read
the find controller's source, so that find in Monaco searches the model (not the DOM) is `[likely]` from the doc's
shape. Source [5]: VS Code wiki "Code Editor Design Doc" (2026-11-27).

### FSC-08 · Google Docs moved from HTML to canvas rendering, so its find, select and copy are not DOM operations; its details are not public  [likely]

Google announced it would migrate "from the current HTML-based rendering approach to a canvas-based approach" and said
screen reader and other assistive-technology support will not be impacted [6]. Nothing in the announcement says how
find, select all or copy work; I found no primary account. Treat Docs as an existence proof that a model-owned selection
works at scale, not as a source of design. The newest source is the 2021 announcement. **Searched:** web search
"Google Docs canvas based rendering find in document select all copy" (2026-11-27); the announcement page itself.
[absence] of a primary description of Docs' find or copy.

### FSC-09 · `CSS.highlights` paints Ranges without touching the DOM, so it fits the mounted blocks and cannot paint the rest  [confirmed]

MDN: the Custom Highlight API lets you "programmatically create text ranges and highlight them without affecting the
DOM structure in the page", and is Baseline 2025 ("Since June 2025, this feature works across the latest devices and
browser versions") [7]. A `Range` needs real nodes, so a highlight exists only for mounted blocks. The app already uses
it with a window of at most 600 Ranges and an overlay fallback (`find/view.ts:45-49`, header comment of `view.ts`). For
the oldest WKWebView (macOS 13, minimum 13.0) the overlay fallback stays; engine support for the API on each macOS is
vector 05's, not checked here [unverified for macOS 13].

### FSC-10 · Native DOM selection cannot span unmounted content; its end points are nodes  [likely]

A DOM selection is a `Range` whose ends are in the document, so when only some blocks are mounted a select-all (Mod-A)
selects the mounted part. The existing code confirms the consequence: a select-all ends at the article itself, with the
offset a count of the blocks present when made, so blocks appended since leave it short, which is why the pending change
adds `appendRest` (`cloneRangeInert`, in the diff: "a selection the reader took to the end of the page ends at the
article itself, at the count of blocks it then held"). A drag past the mounted edge cannot continue because the browser
selects only what exists; autoscroll while dragging would mount more under the pointer, so under tier 2 a drag across
many screens ends where the mount ends unless the mount follows the pointer. I did not find a standard describing this;
it follows from the Range definition. Mitigation: select-all as model state (FSC-04, FSC-05); for drags, extend the mount
as the pointer nears the edge (the mount is already driven by the reading position).

### FSC-11 · The `copy` event is the interception point; `setData` plus `preventDefault` replaces the browser's text  [confirmed]

MDN: `ClipboardEvent.clipboardData` "can be used to specify what data should be put into the clipboard from the cut and
copy event handlers, typically with a setData(format, data) call", and the feature has been available across browsers
since March 2017 [8]. The app's `bind.ts` handler already does `setData('text/plain', ...)` + `preventDefault()` for
code (FSC-04). For prose, set both `text/plain` and `text/html` in the same handler. Source [8]: MDN (2026-11-27).

### FSC-12 · Clipboard size limits in WKWebView and WebView2: no documented limit found  [absence]

Search found no engine-documented size cap on `copy`-event or `navigator.clipboard` writes; no WKWebView or WebView2 documentation of a size cap turned up. The app does not depend on it: copy through its commands writes through the native shell
(`clipboardWriteItem`), as in FSC-04, and the whole-document case should do the same (a `copy` event for a 3 MB
document would put 3 MB through the webview). A measured test on both engines with 1, 5 and 20 MB of plain text is
needed before relying on `setData` for select-all. **Searched:** web search "clipboard write size limit large text
WKWebView WebView2" (2026-11-27); MDN `clipboardData` page (no limit stated); a second pass searched DuckDuckGo for "WKWebView clipboard size limit setData" and "WebView2 clipboard maximum size copy event" and read a Windows clipboard-limit post (OS-level, no engine cap). Tag: `[absence]`.

### FSC-13 · The left panel's search is already a byte-model find that mounts through to a hit  [confirmed]

The Search panel matches over the file's store (open file from its store), then for a hit the `land` function calls
`handle.mountThrough(byte)` and `handle.selection.cursorAt(byte)` (`left/panels/search.ts:353-360`, about 349-361 for `land`); and it can open the
rendered find on the same query (`search.ts:335-347`, about 333-348 for `lightFind`), but `lightFind` runs only for plain queries (not regex, case-sensitive or whole-word). So "byte → block → mount-through → place" is a path in use today
for hits; the rendered find only differs by matching over page text rather than bytes. Rendered text differs from
bytes (markup, link destinations, entities, front-matter rows hidden by `NON_CONTENT`), which is why the rendered find
cannot match over the bytes directly: it needs the rendered text per block (FSC-14).

### FSC-14 · Find can match over a rendered-text cache without walking the DOM; the cache must match the walk  [likely]

`text-index.ts:7-10` states the invariant this rests on: the typesetter's line breaks are "empty `<span
class="marxy-lb">` elements whose generated content is not text", so "the concatenated text is unchanged by a pass";
only piece boundaries move. So a text string built once per block from the parse stays correct through typesetting.
What it must reproduce is the skip rule `NON_CONTENT` (`walk.ts:22-38`, about thirty selectors including three log-hidden ones: hidden, `aria-hidden`,
`.katex`, diagrams, front-matter rows, link destinations, log-filter spans, controls) and the typesetter's hyphen spans
(`copy-html.ts:8-15` drops `marxy-lb` and `marxy-hyphen` on copy, so they carry text the copy omits; whether the find
walk counts a `marxy-hyphen` text, I did not check). Two sources of truth is the risk the owner's rule names. Safest
shape: derive the block's text by running the existing `collectText` over the block's inert fragment (the same function),
so there is one rule, applied to a fragment rather than the live article. That costs one walk per block once, in idle
slices, not per query.

### FSC-15 · Copy as HTML of an unmounted block can be built from its parse, with no mounting  [likely]

`htmlFromRange` already operates on an inert clone: `cloneRangeInert` imports nodes into an inert document, `clean`
drops display-only classes, and `sanitizeHtml` runs last (`selection/copy-html.ts:59-68`). For a block range, the
equivalent is to take the block's inert fragment (kept from the parse as the pending change reads it, or re-rendered from
the tree by core on demand, since parse and render are core's), pass it through `clean` and `sanitizeHtml`, and join.
The partial first and last blocks of a drag are always mounted (they are under the pointer), so partial ranges stay
native. The fragment source is the choice: keep the inert fragments of all blocks (memory, no layout; the pending change
already does it while mounting) or re-render from the parse per block at copy time (CPU per copy, bounded by the
selection; renders must be the same function as mount to guarantee equality). Prefer re-render from the stored parse if
the app keeps the tree; otherwise keep the inert fragments.

### FSC-16 · What find, select all and copy call on the geometry table  [likely]

A minimal surface, reading the geometry table of vector 04/11: `blockAtByte(byte) → index`, `blockRange(i) → [s,e)`,
`isMounted(i) → boolean`, `mountThrough(byte)` (exists at `app-types.ts:253`, `app.ts:150`), `blockText(i) → string`
(cached, FSC-14), `blockFragment(i) → inert fragment` (FSC-15), `blocksIn(s, e) → iterator`. Find uses `blockText`,
`blockAtByte`, `isMounted`, `mountThrough`. Select all and copy use `blocksIn`, `blockText` and `blockFragment`, never
`isMounted`. Painting uses `isMounted` only. The geometry table's heights are not called by any of the three. One path
for small pages: `isMounted` is true everywhere and `mountThrough` is a no-op, which is what `whole()` already returns
(`progressive.ts:291-299`, `ensureThrough() {}`, `pending: () => null`).

## Options compared

| Option | Find | Select all and copy | Cost | Verdict |
|---|---|---|---|---|
| A. Keep DOM walk plus pending container (the pending change) | exact, over mounted + inert DOM | appends pending blocks | needs the inert DOM of every block retained; no help once blocks are dropped | Right now; a step, not the end state |
| B. Per-block text cache, model selection, copy from model (recommended) | regex over string; Range only for mounted | model state; copy from cache and parse | build once per version in idle; one equivalence risk | Fits tier 2; one path |
| C. Find over source bytes | cheap | bytes | wrong text: markup, entities, hidden rows differ from what the reader reads | Only for the Search panel (already so) |
| D. Mount everything on find or select all | simple | simple | gives up the node budget exactly when it is needed | Reject |
| E. Browser's native find (Cmd-F in the webview) | only mounted blocks | not applicable | the app has its own find already | Not an option |

## Open questions

- Does the find walk include the typesetter's `marxy-hyphen` text, and soft hyphens? Needs an equality test between
  the cached block text and `collectText` over the live block, on the fixtures, before the cache is trusted.
- Cost of `findAll` and of building a 1 to 5 MB text string and prefix array: measure, and decide whether the regex needs
  chunked, cancellable runs (repository scale rule).
- Clipboard size through the `copy` event on WKWebView and WebView2 at 1, 5 and 20 MB (FSC-12). Prefer the native shell
  write for select-all copy.
- Drag selection past the mount edge: how far ahead the mount runs while a pointer is down (cross-lead to vector 09,
  typesetting by distance).
- Screen-reader "select all" and find behaviour with a windowed page: vector 07.
- CSS.highlights on the oldest WKWebView (macOS 13): vector 05; the overlay fallback exists.
- Monaco's find (model, not DOM) was not read from source (FSC-07).

## Cross-links

- Vector 04 and 11 (data structure, API): FSC-16 lists the calls; `blockText` and `blockFragment` are per-block caches
  hanging off the table entries.
- Vector 01 (code map): `find/walk.ts`, `selection/copy-text.ts`, `selection/bind.ts` copy listener and `view.ts` walk
  calls are the places that assume every block is mounted (FSC-01, FSC-10).
- Vector 09 (typeset by distance, jump-to-heading): `mountThrough` is the same call jump-to-heading uses; find lands
  through it (FSC-02).
- Vector 10 (editing): a block splice invalidates only that block's `blockText` and `blockFragment`.
- Vector 07 (accessibility): select-all and find under a window.
- Vector 05 (engines): CSS.highlights on macOS 13; find in skipped content for tier 1.
- Large-files corpus: find walk cost is the same family as the "whole-page walk per key" findings; cited by ID where
  the lead chooses.

## Sources

All accessed 2026-11-27; pages kept in `sources/`.

1. `https://raw.githubusercontent.com/codemirror/search/main/src/search.ts`: SearchCursor over `state.doc`, `scrollToMatch`.
2. `https://codemirror.net/docs/ref/`: `EditorView.viewport`, `SearchCursor`, `selectAll`.
3. `https://raw.githubusercontent.com/codemirror/view/main/src/input.ts`: `copiedRange`, `handlers.copy`.
4. `https://raw.githubusercontent.com/ProseMirror/prosemirror-view/master/src/clipboard.ts`: `serializeForClipboard`.
5. `https://redirect.github.com/microsoft/vscode/wiki/%5BWIP%5D-Code-Editor-Design-Doc`: MVVM in Monaco.
6. `https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html`: canvas-based rendering announcement (2021).
7. `https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API`: Baseline 2025.
8. `https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/clipboardData`: `clipboardData` in copy handlers.
9. Local code (read 2026-11-27, checkout of the windowing worktree): `apps/desktop/src/find/walk.ts`, `find/view.ts`, `find/text-index.ts`,
   `selection/selection.ts`, `selection/bind.ts`, `selection/copy-text.ts`, `selection/copy-html.ts`,
   `commands/copy-write.ts`, `render/progressive.ts`, `left/panels/search.ts`; and the diff of the pending change to
   find and copy.
