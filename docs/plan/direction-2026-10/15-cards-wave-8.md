# Cards for wave 8: tabs, the sidebar, the inspector's Links tab, and the library view

**In short.** The replan of 2026-10-11 ([12-replan-2026-10-11.md](12-replan-2026-10-11.md)) puts W-06, W-07, W-09 and Q-03
in wave 8; their descriptions are one line each in [05-plan.md](05-plan.md) and a paragraph in
[02-fold-up-workspace.md](02-fold-up-workspace.md) and `mock-v2/05-collections.md`, so each card below says what it
decided and what it did not. They were written against `origin/main` at `dac2d1a3`; every Path was checked against
`git ls-files` (a path that does not exist is marked *new*) and every function named was found with `git grep`, except
the two names that come from V-11's uncommitted branch (marked *in flight*). The four cards fill regions W-02 made, through the
`workspace/fill.ts` hook W-05 made, so **none touches `app.ts`**.

| Id | Model / effort | Size | Depends on | Review |
| --- | --- | --- | --- | --- |
| W-06 | sonnet / high | M | W-02, W-05 (merged); no file shared with V-11.1 or W-21.1 | lead; the F-33 walk gains tab ops |
| W-07 | sonnet / medium | M | W-02, W-05, W-03 (merged) | lead |
| W-09 | sonnet / medium | M | W-02, W-05, K-03 (merged); **V-11.1** (lands first) | lead |
| Q-03 | sonnet / high | L | Q-01, Q-02, W-02 (merged); W-06 for ⌥Enter to land in a tab | lead; **splits at step 4 if the PR passes ~1,200 lines** |

**In flight, and what each does to these cards.**
- **V-11.1** (defer the Markdown parse of a Source-default file; uncommitted in `../marxy-wt/V-11`: `document/store.ts`,
  `document/open.ts`, `view/rendered-view.ts`, `commands/document.ts`). It adds `DocumentStore.parsed()` and makes
  `snapshot().ast` parse on first read. **W-09 reads that AST, so W-09 lands after V-11.1** and must not read `ast` of
  a store for which `parsed()` is false. W-06, W-07 and Q-03 share no file with it.
- **W-21.1** (the Transform sheet off the main thread; `transform/`, `commands/transform.ts`, the walk oracle). It shares
  no file with any card here. W-06 changes which document a pane shows while a sheet may be open; the sheet's own
  `stale` result (`transform/chain.ts:137`) is the guard, and W-06's test asserts it once W-21.1 has merged.

**One `fill.ts`.** W-06, W-07 and W-09 each add one `workspace.fill(...)` line to `installWorkspaceFills`
(`workspace/fill.ts`), `commands/index.ts` gains one `import` and one line per card, and `packages/theme/src/base.css`
and `scripts/registry.json` gain a block each. These are additive and git merges them; land the cards one at a time
anyway, in the order W-07, W-09, W-06, Q-03, and rebase on the one before. F-32 made the operation lists safe for
parallel work; the command list in `commands/index.ts` is not one of them.

**The caller rule.** One core API is added in the four cards: `pathMentions` (W-09, called by W-09's Links tab and by
the existing `x-paths` transform) and the library's evaluator `evaluateQuery` with `measureText` (Q-03, called by Q-03's
view). Q-03 is the first caller of `parseQuery` and `completeQuery` (`packages/core/src/index-model/query.ts`, Q-02). **Q-01's
`appendQuery` stays without a caller until Q-07** (saved queries in the sidebar), which is not in this wave.

**A door shows only what is behind it** (W-05's rule, kept). W-07 draws a *Library* row in the sidebar only when the
command `library.open` is registered; Q-03 registers it. The toolbar's sidebar and inspector toggles (W-05) and the
panel keys and edge peeks (W-03) light up on their own when W-07 and W-09 fill their regions; no card here edits them.

**The harness.** Browser tests for W-07 and Q-03 need the palette's feed, so they boot the full app as
`test/open-beside.test.mjs` does (`shippedSkeleton`, `harnessBase`, `closeHarness` from `test/support/two-pane.mjs`), then
`handle.workspace().unfold()` and `palette().setIndexEntries([...])`. `bootTwoPanes` alone has no palette
(`roadmap-2026-10/harness-map.md`). Run one file with
`pnpm --filter @marxy/desktop exec node --test --experimental-strip-types test/<name>.test.mjs`.

---

### W-06 — Tabs: the documents opened in this unfolded window, one click apart

**Model:** sonnet (high) · **Size:** M · **Depends on:** W-02 (`tabs` region), W-05 (`fill`), both merged · **Parallel with:**
W-07, W-09 (separate files; the `fill.ts` line is the only overlap) · **Lands after** W-07 and W-09 in the order above.

**Outcome.** Unfolded, the `tabs` region holds a row of tabs: the kind's icon (K-18), the file's name, an unsaved dot, and
nothing else (`02-fold-up-workspace.md` §Tabs). A tab is added for every document a pane opens while the window is
unfolded (landed, not merely requested), to the right of the active tab; opening a path already tabbed focuses its tab.
The active tab is the focused pane's document; the other pane's document, in Split, has a quiet "shown" mark. Clicking a
tab opens its path in the focused pane, **asking about unsaved edits exactly as any open does** (`confirmLeaveDocument`,
`close.ts:213`). The close button removes a tab; on the document a pane shows it opens the next tab there first (asking the
same way), and the last tab has no close button. A scratch document ("Untitled") is a tab only while a pane shows it.
With fewer than two tabs the band is hidden (`region.hidden`; `workspace.arrangement.tabs` unchanged), so the
unfolded window with one document looks as it does today. Folded, no tabs exist and the palette's Recent is the
switcher; folding forgets the tab list (it is not remembered, below). Palette commands `tab.next`, `tab.previous`, `tab.close`; no keys.

**Decision made here, for the author to veto.** A tab keeps **no unsaved edits of its own**. Only a document a pane shows can be
dirty, so quit, fold, a closed pane and the close guard (`close.ts:101` `dirtyDocuments(panes)`) are unchanged and no new
way to lose a byte exists. The price: switching from a dirty tab asks (Save, Discard, Cancel), which Chrome-style tabs do
not. The alternative, background tabs that hold their stores open (`document/registry.ts` `acquire`), changes what quit,
fold and `beforeReplace` must see, adds the walk's first "unreachable dirty store" invariant, and is an Opus card (W-06.1).
It is held until the author says it is wanted.

**Why now.** ADR-0058 item 5 reversed ADR-0011 for the unfolded window; W-02 left the region empty and W-05's fill hook
makes it one line to fill. The library (Q-03) and the sidebar (W-07) both open documents; a tab row is where the
reader sees what they have opened.

**Paths.**
- New: `apps/desktop/src/workspace/tabs.ts` (`TabList`: pure, `add(path)`, `activate(path)`, `close(path)`,
  `neighbour(path)`, `snapshot()`; capped at 24, the oldest tab not shown dropped, which loses nothing),
  `apps/desktop/src/workspace/tabs-view.ts` (`mountTabs(el, handle)`), `apps/desktop/src/commands/tabs.ts`
  (`tab.next`, `tab.previous`, `tab.close`), `apps/desktop/src/workspace/tabs.test.ts` (node),
  `apps/desktop/src/workspace/tabs.test.mjs` (WebKit, `test/support/two-pane.mjs` `bootTwoPanes`).
- Edit: `apps/desktop/src/workspace/fill.ts` (`installWorkspaceFills`: one `workspace.fill('tabs', ...)`),
  `apps/desktop/src/commands/index.ts` (the import and the list), `packages/theme/src/base.css` (a `.marxy-tabs` layout block
  after W-02's `tabs` rule; layout only, W-04 owns the look), `scripts/registry.json` (`dataAttributes`: `data-marxy-tab`,
  `data-marxy-tab-active`, `data-marxy-tab-shown`), `apps/desktop/test/support/store-walk.mjs` (`OPS`: `tabSwitch`, `tabClose`;
  `INVARIANTS` unchanged: they must still hold), `docs/design/09-app-shell.md` (§Tabs).
- Read: `pane/pane-set.ts:50,52` (`PaneChange`, `PaneSet.onChange`, `openIn`), `app-types.ts` (`AppHandle.panes()`,
  `onDocumentChange`), `workspace/toolbar.ts` (`createDocumentSignal`, the model for a fill that follows the focused pane),
  `workspace/kind-chip.ts` (`mountStrip`: a fill that hides its own band), `kind-icons/icons.ts:81` (`kindIconElement`),
  `document/untitled.ts` (`documentName`, `isUntitled`), `pane/pane-set.ts:38` (`Pane.kind()`).

**Build order.**
1. `TabList` and its table test: add beside the active tab, no duplicate, close picks the neighbour, the cap, scratch tabs
   drop when no pane shows them.
2. `mountTabs`: seeds from the panes already open at unfold, follows `panes().onChange` (`open`, `close`, `focus`) and the
   focused store's `snapshot().dirty` for the dot. `role="tablist"`, one tab stop, arrow-key roving, Return activates,
   Delete closes; each tab named by its file name and folder.
3. Activation through `focused.content.open(path)` and nothing else: no new path into a pane, no change to `open.ts`.
4. The band hides itself below two tabs; `commands/tabs.ts`.
5. The walk: `tabSwitch` (activate a tab on a dirty and on a clean pane) and `tabClose`, both through the real commands.

**Acceptance.**
- Folded, no tabs element exists and the existing folded `gate:aesthetics` cases pass unchanged.
- Unfolded with two documents opened one after the other: two tabs, the second active; clicking the first shows it in
  the focused pane and checks it (`tabs.test.mjs`; fails on `main`: the region is empty).
- A dirty document in the focused pane: clicking another tab asks, and Cancel leaves the pane, the buffer and the tab
  row as they were; Discard shows the other document. No edit survives off screen (the store walk's "no lost byte
  without a notice" still holds with the new ops, 2,000 seeds).
- One tab: the band is `hidden` and the reading column's left edge and width are identical to the one-tab case before this card
  (W-02's geometry test). Two tabs: the band is 34 px and the column's left edge is unmoved.
- Closing the active tab opens its neighbour there; the last tab has no close button; a scratch tab is gone when the
  pane shows another document.
- Two panes on two paths: both tabs are marked, only the focused pane's is active.
- Every tab has an accessible name; Tab reaches the row once, arrows move within it.

**Tests and gates.** `tabs.test.ts`, `tabs.test.mjs`, `workspace.test.mjs`, `pane-close-guard.test.mjs`, `close-guard.test.mjs`
(unchanged, must pass), the store walk (`test/store-walk.test.mjs`, `test/store-walk-panes.test.mjs` run it). `pnpm check`, `gate:aesthetics` (both states).

**Do not.** Keep a dirty store open for a tab that no pane shows; change `document/open.ts`, `pane/index.ts` or
`close.ts`; remember tabs across a fold or a launch; add a key (⌘W closes the window; ⌃Tab is the author's to rule);
drag-reorder or pin tabs; style beyond layout (W-04).

**Risks.** (1) `panes().onChange` reports `open` after a document lands; a refused open (the reader dismissed the prompt)
must add no tab: test it. (2) Palette *Open beside* and Cmd-click beside make a second pane: its document gets a tab like
any other. (3) A path renamed by Save As moves its store's path: the tab follows `onDocumentChange`, not the string it was
made with. (4) V-11.1 changes when a code file's parse happens, not what opens: no overlap.

---

### W-07 — The sidebar I: Recent, Pinned and Changed since you read, each section foldable

**Model:** sonnet (medium) · **Size:** M · **Depends on:** W-02, W-05 (`fill`), W-03 (the left edge peeks a filled
sidebar), all merged; C-12's `emptyStateSections` (merged) · **Parallel with:** W-09, Q-03

**Outcome.** Unfolded, the `sidebar` region holds two sections, each with a header that collapses it (a collapsed one keeps its
header and a quiet count), `⌥`-click on a header collapses or expands both, and each state is remembered.
**Recent**: the last eight documents opened, newest first. **Pinned · Changed since you read**: the pinned documents, then
the files in watched folders changed since they were read (C-12's two views, the same rows the palette shows when
empty). A row is the kind glyph, the title, a quiet age; Return or a click opens it in the focused pane, `⌘`-click opens it beside, as
the palette's rows do. An empty section is not drawn. When `library.open` is registered (Q-03) a *Library* row at the top runs it;
until then there is no such row. The Repositories and Folders sections are W-08; Smart collections are Q-07; neither
is drawn. This card makes `view.toggle-sidebar` (`⌃⌘S`) and the toolbar's sidebar toggle appear, and the left edge peek work.

**Why now.** W-02 left the region empty and W-03 made it peek only "once it has content"; the C-12 views are built
(`palette/empty-state.ts:81`) and reachable only from the palette.

**Paths.**
- New: `apps/desktop/src/workspace/sidebar.ts` (`SIDEBAR_SECTIONS`, `sidebarSections(input)`: a thin call to
  `emptyStateSections` with the lists unmerged, recent cut to eight; `mountSidebar(el, handle)`),
  `apps/desktop/src/workspace/sidebar-sections.test.ts` (node), `apps/desktop/test/sidebar.test.mjs` (WebKit, full app).
- Edit: `apps/desktop/src/workspace/fill.ts` (one `workspace.fill('sidebar', ...)`),
  `packages/core/src/layout/workspace-storage.ts` (`WorkspaceEnvelope`, `parseWorkspaceFile`, `serializeWorkspaceFile`,
  `WorkspacePersistence`: an optional `sidebar: { collapsed: string[] }`, unknown ids dropped, no version bump) and its test
  `packages/core/src/layout/workspace-storage.test.ts`, `apps/desktop/src/workspace/state.ts` (`WorkspaceStore` `:34`,
  `workspaceStoreFor` `:45`: `loadSections()` / `saveSections()`; folded and launch still read nothing), `packages/theme/src/base.css` (`.marxy-sidebar` layout block),
  `scripts/registry.json` (`dataAttributes`: `data-marxy-sidebar-section`, `data-marxy-sidebar-row`),
  `docs/design/09-app-shell.md` (§Sidebar), `docs/design/11-config-and-storage.md` (workspace.json gains `sidebar`).
- Read: `palette/empty-state.ts` (`emptyStateSections`, `changedSinceRead`, `relativeAge`, `EMPTY_STATE_LIMIT`),
  `palette/session.ts` (`PaletteSession`: `pinned`, `mru`, `readAt`), `commands/app-handle.ts` (`palette()`, then
  `palette().session` and `palette().feed.entries()`), `index/service.ts` (`IndexService.baselineMs`, `isWatched`),
  `kind-icons/icons.ts:81`, `commands/registry.ts` (how a `fill` finds out a command exists), `workspace/toolbar.ts` (`visibleItems`: the same test).

**Build order.** 1. `sidebarSections` over fixed inputs: order, the cap of eight, the pinned documents absent from Recent, a
file in an unwatched folder not "changed". 2. The workspace.json field and its round trip (a collapsed id survives fold and
unfold; an unknown id and a missing file give the defaults). 3. The fill: sections, rows, roving list, refreshed on
`handle.onDocumentChange` and `palette().feed.subscribe` (fires on an index patch). 4. The Library row, drawn from `commands()`.

**Acceptance.**
- Folded, nothing is added: no sidebar element, and the left-edge peek of W-03 now shows the filled sidebar (extend
  `workspace/peek.test.mjs`; fails on `main`, where nothing fills it).
- With ten files opened, Recent shows eight, newest first; a pinned file is under Pinned and not repeated in Recent; a
  file modified after its read time is under Changed (`sidebar-sections.test.ts`, `sidebar.test.mjs`; both fail on `main`).
- Clicking a header collapses its section and shows the count; folding then unfolding keeps it collapsed, and a launch
  after that does too (`workspace.json` holds the id and no other byte of the file's shape changes).
- `⌥`-click collapses both, and a second one expands both.
- No `library.open` command registered: no Library row. A stub command with that id adds it; removing it removes it.
- Return on a focused row opens it in the focused pane; `⌘`-click opens it in the other pane (made if need be).
- Every row and header has an accessible name; Tab reaches the sidebar once, arrows move within it.
- `view.toggle-sidebar` is available and `⌃⌘S` docks and undocks it (`keys-table.test.mjs` unchanged and passing).

**Tests and gates.** `sidebar-sections.test.ts`, `sidebar.test.mjs`, `workspace-storage.test.ts`, `peek.test.mjs`,
`workspace.test.mjs`. `pnpm check`, `gate:aesthetics` (both states).

**Do not.** Add Repositories, Folders, Smart collections or any tree (W-08, Q-07); a pin or unpin control (the palette's
`⌘.` stays the only one); a new "changed" rule (use `changedSinceRead`); read the disk to build a row (the index and the
session hold everything); put a count or a live state in a row; touch `app.ts`.

**Risks.** (1) `palette()` is set after `startApp`: the fill must tolerate its absence and fill when it appears (the
unfold happens after the palette mounts in practice; test both orders). (2) `feed.entries()` is scope-capped
(`SCOPE_ENTRY_CAP`); say so in the code if a pinned file falls outside it. (3) The sidebar is 252 px (`--marxy-ws-sidebar-w`);
at `chrome_size = 26` check the rows fit and say so in the PR.

---

### W-09 — The inspector shell and its Links tab

**Model:** sonnet (medium) · **Size:** M · **Depends on:** W-02, W-05 (`fill`), K-03 (merged); **V-11.1** (in flight: the
Links tab reads the AST, whose first read V-11.1 makes lazy) · **Parallel with:** W-07, Q-03

**Outcome.** Unfolded, the `inspector` region holds a tab strip and the selected tab's panel for the focused pane's
document. The strip is a table of tabs, **each drawn only when its builder is registered**: `registerInspectorTab({ id, title, mount })`.
Today one is registered, **Links**; W-10 (Outline), W-17 (Metadata) and V-06 (Versions) register theirs with no change here.
There is no Look tab (`06-reconciliation.md` row 6). **Links** lists, for the focused document, in this order:
- **Links**: every link in the text, as written (the real target, never the label): the link text, its destination, and
  `linkHostMismatchLabel` (`render/link-host.ts:77`) when the text names a different host (commitment 4). A row lands on the link in the
  document (`handle.open(path, { at: byte })`, the outline's way). External destinations are shown and never fetched or opened from here.
- **Paths mentioned**: the paths the text names (`pathMentions`), each *found*, *not found* or *not checked*. A path is
  resolved against the document's folder and its repository root; `~/` against the home folder; `shell.stat` decides.
  `stat` answers `null` for a missing path **and** for a symlink or a deny-listed folder, so a `null` is "not found
  here", and a symlinked target is not claimed missing: the row says "not checked" for any path whose parent is not listed.
- **Backlinks** are not in this card (below).
For a file that opens in Source and has not been parsed (`store.parsed()` false), Links lists the paths mentioned from the
bytes and says "Links are listed for Markdown" in place of the link list; it never forces the parse.

**Why now.** The inspector is the home of everything the document knows about itself, and `02-fold-up-workspace.md`
§Layout says notes about a file (a path that does not exist) live there and not as marks in the text. The panel keys and
the toolbar's inspector toggle (W-03, W-05) wait for a filled region.

**Paths.**
- New: `apps/desktop/src/workspace/inspector.ts` (`registerInspectorTab`, `inspectorTabs()`, `mountInspector(el, handle)`: the
  shell), `apps/desktop/src/workspace/links-tab.ts` (`linksOf(ast)`, `resolveMentioned(path, docPath, root, home)`,
  `mountLinksTab`), `apps/desktop/src/workspace/inspector.test.ts` (node), `apps/desktop/src/workspace/links-tab.test.ts` (node),
  `apps/desktop/src/workspace/inspector.test.mjs` (WebKit, `bootTwoPanes`).
- Edit: `packages/core/src/transforms/extract.ts` (move the path regex of `xPaths` into an exported `pathMentions(lf):
  string[]`; `xPaths` calls it; output unchanged) and `packages/core/src/transforms/extract.test.ts`,
  `apps/desktop/src/workspace/fill.ts` (one `workspace.fill('inspector', ...)`, and the Links registration beside it),
  `packages/theme/src/base.css` (`.marxy-inspector` layout block), `scripts/registry.json` (`dataAttributes`:
  `data-marxy-inspector-tab`, `data-marxy-link-row`), `docs/design/09-app-shell.md` (§Inspector).
- Read: `packages/core/src/contracts/ast.ts:57` (`Link`: `url`, `children`, `start`, `end`), `render/link-host.ts` (`linkHostMismatchLabel`, `linkDestinationLabel`),
  `outline/view.ts` (`OutlineSource.land`), `app-types.ts` (`AppHandle.document()`, `currentPath`, `onDocumentChange`),
  `document/store.ts` (`DocumentStore.snapshot`; `parsed()` after V-11.1), `packages/shell-api/src/index.ts:84` (`stat`), `theme/user-theme.ts`
  (`inferHomeFromConfig`), `transforms/prose.ts:43` (`walk`).

**Build order.** 1. `pathMentions` out of `xPaths`, with its existing test unchanged. 2. `linksOf(ast)`: the link nodes in
document order with their byte ranges, no DOM; a table test over the fixtures (an inline link, a reference link, an autolink, a link
inside a table cell). 3. `resolveMentioned` with a fake `stat`: found, not found, not checked. 4. The inspector shell and its
registry (a stub tab appears and disappears). 5. The Links panel; it follows the focused pane and `onDocumentChange`.

**Acceptance.**
- Folded, no inspector element exists; the folded `gate:aesthetics` cases pass unchanged.
- Unfolded with a document open: the strip holds exactly Links; registering a stub tab adds one, removing it removes it
  (`inspector.test.ts`; fails on `main`).
- A document with an inline link whose text names `apple.com` and whose target is `xn--...`: its row shows the real
  destination and the label `linkHostMismatchLabel` returns, and clicking it moves the document to that link.
- A document naming one path that exists and one that does not: the first reads found, the second not found
  (`links-tab.test.ts`); a path under a symlinked folder reads not checked.
- A code file opened by V-11 (Source, never parsed): Links lists its paths mentioned, `store.parsed()` is still false afterwards, and
  `first_text` is no slower than before the tab (V-11.1's check in `test/code-open.test.mjs` unchanged and passing).
- `pathMentions` returns what `xPaths` returned for every case in `extract.test.ts`.
- Nothing is fetched: `gate:no-network` passes, and a test with a network-refusing page loads the tab.
- Every row has an accessible name; Tab reaches the inspector once, arrows move within it.

**Tests and gates.** `inspector.test.ts`, `links-tab.test.ts`, `inspector.test.mjs`, `extract.test.ts`, `code-open.test.mjs`. `pnpm check`,
`gate:aesthetics` (both states), `gate:no-network`.

**Do not.** Add Outline, Metadata, Versions or Look (W-10, W-17, V-06; the last is dropped); fetch, open or resolve an external URL;
force the parse of a Source-default file; add a status-bar item (W-11); write to the document; touch `app.ts`.

**Risks.** (1) The shape of `snapshot().ast` for an unparsed store is V-11.1's to settle: if it merges differently from
`parsed()` as named here, the card's one read of it changes and nothing else. (2) The inspector opens by default only in
windows 1,600 px or wider (`INSPECTOR_MIN_WINDOW`, `workspace/state.ts:22`); the tests dock it by hand. (3) The path regex only
finds backticked paths that contain a slash (today's `xPaths`); a bare `README.md` is not listed. Widening it is a change of
`x-paths` too and is not made here.

**Questions for the author (the direction is thin here).** *Backlinks* ("files that link here") need a scan of other files'
bytes; ADR-0062 item 5 allows an on-demand scan and no stored index. Do you want it as a button in this tab (a
`searchContent` over the repository for the file's name; approximate; a later card), or left to the library (Q-06 and `in:`)?
Until you say, the tab has no Backlinks heading.

---

### Q-03 — The library view: scopes, a query field, results that say why they matched, a preview

**Model:** sonnet (high) · **Size:** L · **Depends on:** Q-01, Q-02 (merged), W-02 (merged); W-06 (merged first) for `⌥Enter` to
land in a tab, otherwise it opens beside · **Parallel with:** W-09 · **Gives Q-02 its caller**

**Outcome.** The palette command **Library** (`library.open`) opens a full-window view inside the unfolded workspace
(ADR-0062 item 2): the panes are hidden, not closed, and come back as they were. From top to bottom: the scope's name
and path; the **query field** with its **chips** and a completion list; the **results**; on the right a **preview**
pane. Folding closes it (it is part of the unfolded window).
- **Scopes** (the ones that exist): *All files*; each folder declared in `collection.toml`; *Recent*; *Pinned*; *Changed since
  you read*. Each is a base set plus the query. Switching scope clears the query and the selection.
- **Query.** The field parses with `parseQuery` and completes with `completeQuery` (Tab accepts, ↑↓ move); each term is a removable chip;
  an unknown key and an incomplete value show amber and say they are searched as text or ignored.
- **Evaluation** is new (below). Plain words match title, path, headings and, when the field holds text, file lines through
  the shell's `searchContent`.
- **Rows**: kind glyph, title, path relative to its root, kind, modified age, a status mark (changed, pinned) that is an icon with a
  name, never colour alone, and **why it matched**: one short line per reason (`title`, `path`, `heading "Cache"`, `line 12: ...`,
  `kind:report`, `changed since you read`). Sort: relevance (while text is typed), modified, name, path.
- **Preview.** Text only: title, path, kind and why it was detected, modified, size, its headings, and the matching lines.
  A rendered preview is not in this card.
- **Keys**: `/` or `⌘F` focuses the field (inside the view); ↓ goes into the list; Return opens the row in the focused pane, `⌥`Return
  in the other pane or a new tab; Esc clears the field, then closes the view. No global key (below).
- Cut from this card (each a named later card): facet menus, grouping, density, columns, saved queries and *Save as smart
  collection* (Q-07), Add source and Index health (Q-04), bulk actions (Q-05), near-duplicates and broken paths (Q-06).
  `is:dup`, `is:broken`, `is:archived`, `is:error`, `is:captured` parse, show an amber chip "not available yet" and match nothing.

**The seam this card decides.** There is no content index (ADR-0062 item 5), so a key is one of two kinds. **Index keys**
are answered from the `IndexEntry` and the palette session, with no read: `kind:` (`readerKind`), `in:`, `path:`, `modified:`, `size:`,
`is:changed`, `is:pinned`, `is:recent`, `is:read`, `is:unread`. **Content keys**, `words:`, `has:` and `tasks:`, are answered by measuring
text (`measureText`), and only for the files the index keys left. Those files are read with `shell.readHead` (the shell caps it
at 256 KB; a larger file is measured on its first 256 KB and its row says "≥"), within `CONTENT_SEARCH_LIMITS.maxTotalBytes`; past that,
the results say "measured N of M files". `readFile` is not used: it arms the stale-write guard.

**Why now.** The replan's rule: Q-01 and Q-02 are callerless (`parseQuery`, `completeQuery`), and ADR-0062's library is the largest
accepted piece of the direction with no door.

**Paths.**
- New: `packages/core/src/index-model/query-eval.ts` (`evaluateQuery(query, entries, ctx): QueryHit[]` with `why: Reason[]` per hit;
  `measureText(text): { words; hasCode; hasPaths; hasLinks; openTasks }`; pure, no DOM, no Node),
  `packages/core/src/index-model/query-eval.test.ts`, `apps/desktop/src/library/view.ts` (`mountLibrary(workspace, handle)`:
  the mount over `#marxy-main`, hide and restore the panes), `apps/desktop/src/library/scopes.ts` (`libraryScopes(...)`: pure),
  `apps/desktop/src/library/rows.ts` (row model and `whyLines`), `apps/desktop/src/library/measure.ts` (the bounded reader over
  `readHead`), `apps/desktop/src/library/scopes.test.ts`, `apps/desktop/src/library/rows.test.ts` (node),
  `apps/desktop/src/commands/library.ts` (`library.open`), `apps/desktop/test/library.test.mjs` (WebKit, full app).
- Edit: `packages/core/src/index-model/index.ts` (export `evaluateQuery`, `measureText`, their types), `apps/desktop/src/commands/index.ts`
  (the import and the list), `packages/theme/src/base.css` (`.marxy-library` layout block; no ground, border or shadow beyond W-04's
  classes), `scripts/registry.json` (`dataAttributes`: `data-marxy-library`, `data-marxy-library-row`, `data-marxy-query-chip`; `events` if the
  view marks one), `scripts/gate-aesthetics.mjs` (`WORKSPACE`: an unfolded page with the library shown, one new case),
  `docs/design/09-app-shell.md` (§Library view), `docs/plan/direction-2026-10/mock-v2/05-collections.md` (a note at the top that
  the cut list above is not built).
- Read: `index-model/query.ts` (`Query`, `Term`, `FieldTerm`, `CompletionContext`), `index-model/content-search.ts`
  (`CONTENT_SEARCH_LIMITS`, `ContentSearchHit`), `palette/empty-state.ts` (`changedSinceRead`, `relativeAge`),
  `palette/session.ts`, `collection/load.ts:52` (`loadCollection`: the declared folders), `commands/app-handle.ts` (`palette().feed`,
  `palette().session`), `shell/memory.ts:323` (`searchContent` in the memory shell), `pane/pane-set.ts` (`openIn`),
  `kind-icons/icons.ts:81`, `docs/adr/0062-the-library.md`, `mock-v2/05-collections.md` (§Query syntax, §Results).

**Build order.**
1. `evaluateQuery` over fixed entries: every index key, `-` negation, `OR`, "any of" commas, a flagged term ignored or searched
   as text exactly as the parser says, and the `why` list for each (the table test is the spec). It takes the clock and the
   session as arguments.
2. `measureText` and the content keys over a fake reader, including the cap and the "≥" mark.
3. `libraryScopes` (the declared folders, Recent, Pinned, Changed) and `whyLines`.
4. The view: mount, hide and restore the panes, the field with chips and completion, the list and the preview. **A good place to stop
   and open the PR if steps 1 to 3 plus the view pass 1,200 lines:** steps 1 to 3 as "Q-03 (core)" with its tests and no caller
   but the view's own stub, then the view; the lead decides.
5. `library.open`, and Return and `⌥`Return.

**Acceptance.**
- `parseQuery`'s output evaluates: `kind:readme in:plans -path:archive` over a fixture returns exactly the entries a hand-written filter
  returns, each with its reasons (`query-eval.test.ts`, 100% of the grammar's keys; fails on `main`).
- `words:>500` measures only the files the other terms left, reads each at most once and none over the cap (`measure` test with a counting reader);
  a 300 KB file is measured on 256 KB and reads "≥".
- Folded, the command is unavailable and no library element exists; unfolded, `library.open` shows the view and the panes
  are `hidden` and keep their state (`library.test.mjs`: scroll position and a dirty buffer survive a round trip; fails on `main`).
- Typing `cache` lists files whose title, path or a heading contain it, each with its reason, and files with a line containing it with that line; a chip
  appears for `kind:report`, and its × removes the token from the field and re-runs.
- An unknown key (`model:x`) shows an amber chip and is searched as text; `is:dup` shows "not available yet" and matches nothing.
- Return opens the row in the focused pane and closes the view; `⌥`Return opens it in the other pane (or a new tab once W-06 has merged).
  Esc clears the field, then closes the view with focus back on the pane that had it.
- The view reads nothing at launch and no file while no query needs content (`shell.calls` in the memory shell shows no `readHead` before a content key is typed).
- Every control has an accessible name; the list is a `listbox` with `aria-activedescendant`; status marks have text.
- The results of 20,000 entries render the first screenful in under one frame budget the harness already measures (record the
  number, do not gate it: ADR-0032).

**Tests and gates.** `query-eval.test.ts`, `scopes.test.ts`, `rows.test.ts`, `library.test.mjs`. `pnpm check`, `gate:aesthetics`
(both states and the new case), `gate:fidelity` (core, unchanged), `gate:no-network`.

**Do not.** Build a persistent index or a cache file (ADR-0062 item 5); write any file; add a global key; add facets, grouping, bulk
actions, saved queries, duplicates or broken paths; render the preview as Markdown (innerHTML is not allowed in `library/`); add
`model:`, `session:`, `tag:`, `is:ai` or `is:live`; touch `app.ts`, `document/` or `pane/`.

**Risks.** (1) The view hides the panes with `hidden` and `inert`; a pane's Source editor keeps its focus handlers: test a
dirty Source pane. (2) The first screenful of 20,000 rows must not build 20,000 nodes: window the list. (3) `feed.entries()` is scope-capped
at 100,000; say so in the results. (4) `searchContent` takes paths narrowed by `searchablePaths`; the scope's candidates go through it.

**Questions for the author.** (a) A key for Library: the mock uses `⌘F` or `/` inside the view and none to open it; the palette command
and W-07's Library row are the doors until you rule one. (b) The rendered Preview tab (and Info and Outline tabs) of the mock: a
follow-up card, Q-03.1, under the `innerHtmlAllowedIn` rule; wanted before Q-04? (c) The mock's sidebar "Inbox" scope depends on the capture
destination (P-01); it is not a scope here.
