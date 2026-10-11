# Cards for waves 6 and 7: the toolbar, peeking, chrome styling, Transform, and the kind chip

**In short.** The replan of 2026-10-11 ([12-replan-2026-10-11.md](12-replan-2026-10-11.md)) puts the toolbar (W-05) in
wave 6 as the door for Copy, Export, Transform and the kind chip, and the stories that use it in wave 7 (W-04, W-03,
W-21, J-06); K-07 follows in wave 8 and is carded here because it hangs on the same toolbar. The cards were drafted
by a Sonnet agent from `main` at `ba70964d` and, for the workspace, from W-02's branch
(`origin/feat/w-02-workspace-shell`, PR #561, not merged: every W card says *after W-02 (#561)*). They name J-04's API
(`COPY_TARGETS`, `writeCopy`, `copy-as.menu`) and W-19's command ids (`view.mode-read`, `view.mode-split`,
`view.mode-source`) from the cards in [11-cards-wave-4.md](11-cards-wave-4.md); neither is on `main` yet.

| Id | Model / effort | Size | Depends on | Wave | Review |
| --- | --- | --- | --- | --- | --- |
| W-05 | sonnet / high | M | W-02 (#561); W-19 and J-04 for the Read/Split/Source and Copy controls to appear | 6 | lead; **touches `app.ts`** |
| W-04 | sonnet / medium | M | H-03 (merged), W-02 (#561), W-05 | 7 | lead; taste entry for the author |
| W-03 | sonnet / medium | M | W-02 (#561), W-05, W-19 | 7 | lead |
| W-21 | sonnet / high | M | W-05, W-04, J-04, W-19, F-33 | 7 | **adversarial** (writes into documents) |
| J-06 | sonnet / medium | S | J-04, J-05, W-21 | 7 (after W-21) | lead; privacy probes |
| K-07 | sonnet / medium | M | K-05a, W-05, J-04 (merged K-03, K-04, K-18) | 8 | lead |

**`app.ts`:** exactly one card in these waves touches `apps/desktop/src/app.ts`: **W-05** (wave 6), by one call that
installs `workspace/fill.ts`. Every later story that puts something in a region adds itself inside `fill.ts`, not
`app.ts`. No wave 7 card here touches `app.ts` (V-11, if it needs to, owns it).

**The caller rule.** None of these cards adds a core API. W-05 is the caller of `nav.back`, `nav.forward`, `view.find`
and (after W-19, J-04) of `view.mode-*` and `copy-as.menu`; W-21 is the second caller of `runTransform`
(`packages/core/src/transforms/registry.ts:97`) and the first of `TRANSFORMS` (`:85`) outside tests; J-06 is the second
caller of `shell.clipboardRead`, after J-05's paste.

**A door shows only what is behind it.** The toolbar (W-05) is a table of controls, each naming the registry command it
runs. A control is drawn only when its command is registered (and, for the two panel toggles, only when its region has
content). So the toolbar has no dead button, and the door for each later story opens by that story registering its
command: `transform.open` (W-21), `export.menu` (W-15), `kind.chip` (K-07), `view.toggle-sidebar` and
`view.toggle-inspector` (W-03).

---

### W-05 — The toolbar: a row of doors, each drawn only when its command exists

**Model:** sonnet (high) · **Size:** M · **Depends on:** W-02 (#561: the `toolbar` region and `Workspace`); W-19 (card,
`11-cards-wave-4.md`: `view.mode-read|split|source`) and J-04 (card: `copy-as.menu`) for those two controls to appear ·
**Parallel with:** F-33, V-16, V-09

**Outcome.** After W-02 (#561), unfolding shows a toolbar in the `toolbar` region (`data-marxy-workspace-region="toolbar"`).
Left to right: back, forward, the document's name with a quiet dirty dot and its folder; the Read/Split/Source switch;
Copy (a click copies in the `copy_format` target, its chevron opens *Copy as*); Find. Slots for the controls whose
stories are not built: the sidebar and inspector toggles, **+**, the kind chip, Export, Transform. A slot is drawn the
moment its command is registered, with no change here. Folded, none of it exists. No Extract button, no theme switcher
(`06-reconciliation.md` rows 3 and 4; `mock-v2/01-workspace.md` Round 7).

**Why now.** W-02 left six empty regions; ADR-0065 puts Copy, Export and Transform in the unfolded toolbar and the replan
makes W-05 their door. K-07, W-21, W-03 and W-14 hang on a toolbar to put a control in.

**Paths.**
- New: `apps/desktop/src/workspace/toolbar.ts` (`TOOLBAR_ITEMS`: `{ id, command(s), needsFill?, kind }` in order;
  `visibleItems(items, commandIds, filledRegions)`; `mountToolbar(el, handle)`), `apps/desktop/src/workspace/fill.ts`
  (`installWorkspaceFills(handle)`: the one place a story adds a region's content), `apps/desktop/src/workspace/toolbar-items.test.ts`
  (node), `apps/desktop/src/workspace/toolbar.test.mjs` (WebKit, `test/support/two-pane.mjs` `bootTwoPanes`).
- Edit: `apps/desktop/src/workspace/state.ts` (W-02: `Workspace` at `:68`; add `fill(region, mount)`, which runs
  `mount(el)` whenever that region's element is made, in `unfold` `:145`, and its returned disposer when it is removed, in
  `fold` `:163` and `destroy` `:194`; `hasFill(region)`), `apps/desktop/src/workspace/regions.ts` (`mountRegions` `:31`
  returns the elements `fill` needs), **`apps/desktop/src/app.ts`** (one call, `installWorkspaceFills(handle)`, beside
  `installCommandKeys(handle)`; `app-types.ts` unchanged), `packages/theme/src/base.css` (layout only, a `.marxy-toolbar`
  block after W-02's "unfolded workspace" block: flex row, gaps, no ground, border, radius or shadow: W-04 owns the look),
  `scripts/registry.json` (`dataAttributes`: `data-marxy-toolbar-item`), `docs/design/09-app-shell.md` (a §Toolbar and the
  DOM skeleton at `:6`).
- Read: `commands/navigation.ts` (`nav.back` `:58`, `nav.forward` `:72`, `historyAllowed` `:30`), `commands/find.ts:55`
  (`view.find`), `commands/index.ts:29` (`commands()`), `selection/bind.ts:51` (`buildAppContext`: a button runs
  `command.when(ctx)` then `command.run(ctx)`), `palette/commands.ts:43` (`keyLabel`, for the tooltip), `app-types.ts:107,126`
  (`openDocument()`, `onDocumentChange`), `app.ts:39` (`followPaneModes`: `<body data-marxy-mode>` mirrors the focused
  pane), `document/untitled.ts:34` (`documentName`), `view/rendered-view.ts:537` (`setModeChrome`).

**Build order.**
1. `Workspace.fill` and a test with a stub fill: made on unfold, disposed on fold, run again on the next unfold.
2. `TOOLBAR_ITEMS` and `visibleItems` as pure functions with the table test (order, and "a command that is not
   registered draws nothing"). Items, in order: `sidebar` (`view.toggle-sidebar`, needs a `sidebar` fill), `back`, `forward`,
   `title` (always), `new` (`document.new-menu`, W-14), `mode` (the three `view.mode-*`), `kind` (`kind.chip`), `copy`
   (`copy-as.menu` for the chevron; the click runs `copy-as.<copy_format>`), `export` (`export.menu`), `transform`
   (`transform.open`), `find` (`view.find`), `inspector` (`view.toggle-inspector`, needs an `inspector` fill).
3. DOM: `role="toolbar"`, one tab stop with arrow-key roving, each control named by its command's title and its key in the
   tooltip. The mode switch is a `radiogroup`: Split is checked when two panes show one path, else the focused pane's
   mode (a `MutationObserver` on `<body data-marxy-mode>`, which the focused pane writes). A control whose `when` is false
   is `aria-disabled`, not removed (Back at the start of history).
4. The title: name and dirty dot from the open store's snapshot (`dirty`), refreshed on `onDocumentChange`; a scratch
   document says "Untitled" (`documentName`).
5. Layout only; the look is W-04's.

**Acceptance.**
- Folded, no toolbar element exists; the existing folded `gate:aesthetics` cases pass unchanged.
- Unfolded with a document open (W-19, J-04 merged): the toolbar holds back, forward, title, Read/Split/Source, Copy and
  Find in that order and nothing else (`toolbar.test.mjs` fails on `main`: the region is empty).
- The door: registering a stub command `transform.open` adds a Transform control, `export.menu` an Export control,
  `kind.chip` a kind control; removing it removes the control (`toolbar-items.test.ts`; fails on `main`).
- Clicking Source puts the focused pane in Source and checks it; `⌘E` moves the check; two panes on one path check Split.
- Copy's click writes one pasteboard item through `writeCopy` for the configured target; its chevron opens the *Copy as*
  menu (J-04's test double). Back is `aria-disabled` on the first document and enabled after a second is opened.
- The name and dirty dot follow an edit and a save; a scratch document says "Untitled".
- The reading column's left edge and width are identical before and after the toolbar fills (the geometry test from
  W-02's `workspace.test.mjs`); the unfolded `gate:aesthetics` case passes, and a control outside any region fails it.
- Every control has an accessible name; Tab reaches the toolbar once, arrows move within it, Return activates.

**Tests and gates.** `toolbar-items.test.ts`, `toolbar.test.mjs`, W-02's `workspace.test.mjs`. `pnpm check`, `gate:aesthetics` (both states).

**Do not.** Draw a control whose command does not exist; add an Extract button or a theme switcher; style beyond layout
(W-04); put content in the sidebar, tabs, inspector or status bar; register `Mod+/` (W-21) or a panel key (W-03); touch
`app.ts` beyond the one call.

**Risks.** (1) The plan's **customize sheet** is not in this card: with most slots conditional, the reader has nothing
to put back yet. It is W-05.1, after W-21 and K-07 have landed. (2) **+** draws nothing until W-14 registers its menu.
(3) The toolbar region is 52 px tall (W-02's `--marxy-ws-toolbar-h`); at `chrome_size = 26` check the controls fit and say
so in the PR.

---

### W-04 — One chrome for every summoned surface and every menu

**Model:** sonnet (medium) · **Size:** M · **Depends on:** H-03 (merged), W-02 (#561), W-05 (the toolbar's classes) ·
**Parallel with:** W-03, V-02 · **Lands before W-21** (its sheet takes this card's classes)

**Outcome.** The palette, the verb menu, the find field, the outline dialog, notices, the unfolded regions' frame and the
toolbar's controls share one spec. Face: `--marxy-face-chrome`; size: `--marxy-size-chrome`. A raised surface (palette,
verb menu, find, outline, a peek) has `--marxy-color-surface`, `--marxy-shadow-surface` and a radius of 6, 9 or 13 px by
size. One spacing spec for every menu and dropdown: rows 28 px, padding 5 px by 10 px, an 8 px gap after an icon, the
shortcut right-aligned. Every length is a ratio of the chrome size (28 px at 13), so `chrome_size` scales them. **The text
being read is untouched.**

**Why now.** The tokens exist and nothing reads the shadow: `--marxy-shadow-surface` (`tokens.css:94`, set by Night and
Paper at `theme.css:48,112`) has no consumer; `--marxy-face-chrome` and `--marxy-size-chrome` are read only by W-02's
regions. Each surface draws its own: the palette 8 px, `0 12px 40px` and rows of `0.45rem 1rem`
(`palette/view.ts:275-309`); the verb menu `--marxy-code-radius`, `0 6px 24px`, the text face at caption size, rows of
`0.3em 0.9em` (`base.css:85-117`); find 6 px and `0 0.25rem 1.5rem` (`base.css:628-645`). W-05, W-21 and the peeks add
more; they should be born into one spec.

**Paths.**
- New: `apps/desktop/test/chrome-surfaces.test.mjs` (WebKit: computed style of each surface, and the row geometry at three
  chrome sizes), `packages/theme/src/chrome-spec.test.ts` (node: no literal `box-shadow` colour, `border-radius` px or
  `font-family` in the rules of those surfaces).
- Edit: `packages/theme/src/base.css` (`.marxy-notice` `:44`, `.marxy-verb-menu*` `:85-117`, `.marxy-find` `:628-645`, the
  `forced-colors` block `:685-687` kept in step; add `.marxy-surface`, `.marxy-menu`, `.marxy-menu-row`, `.marxy-menu-key`
  and the ratios, once), `apps/desktop/src/palette/view.ts` (`injectPaletteStyles` `:272`), `apps/desktop/src/outline/view.ts`
  (the sheet at `:51`), `apps/desktop/src/selection/verb-menu.ts` (row markup near `:196` takes the classes),
  `apps/desktop/src/workspace/toolbar.ts` (W-05: classes), `docs/design/05-theme.md` (the spec, one table),
  `docs/taste-review/queue.d/W-04.md` (before-and-after of the five surfaces in both variants: the author judges).
- Read: `docs/adr/0059-token-contract-v2.md` items 4 and 6, `03-kinds-and-the-look.md` §Chrome styling,
  `packages/theme/scripts/lint-default-theme.mjs:17-19` (no bare px margin or padding in `base.css`), `theme/reader-config.ts:19`.

**Build order.** 1. The classes and ratios in `base.css`: `calc(var(--marxy-size-chrome) * 28 / 13)` for a row, `* 5 / 13`
and `* 10 / 13` for padding, `* 8 / 13` for the icon gap. 2. Move the verb menu and notices onto them. 3. The palette and
outline sheets: replace their literals with the classes' values. 4. Find. 5. The static test, then the computed-style test.

**Acceptance.**
- Each raised surface's computed `box-shadow` equals the resolved `--marxy-shadow-surface`, its `font-family` the chrome
  face, its `border-radius` one of 6, 9, 13 px at 13 px chrome (`chrome-surfaces.test.mjs`; fails on `main`).
- Menu rows (verb menu, palette) are 28 px, padded 5 px by 10 px, at chrome 13 px; at 16 and 26 px they are
  `round(28 * size / 13)`; the shortcut's right edge is the same x on every row.
- The static test finds no literal shadow, radius or face in those rules (fails on `main`).
- The article's computed font, size and line box are identical before and after, in both variants; `gate:aesthetics`,
  `gate:contrast` and `gate:golden` are unmoved.
- Under `forced-colors` the surfaces keep a `CanvasText` border and no shadow.

**Tests and gates.** The two new tests, `palette.test.mjs`, `verb-menu.test.mjs`. `pnpm check`, `gate:aesthetics`, `gate:contrast`, `gate:golden`.

**Do not.** Add a `--marxy-*` token (the radii and the row are system constants and ratios of the chrome size; a new name
needs an ADR); change a theme's values (`theme.css` is H-04's taste); write a bare px margin or padding; move any
behaviour or key; style a code block or the article.

**Risks.** The palette's rows become 28 px: more rows on screen, a visible change, which is why the taste entry is part of
the card. At `chrome_size = 26` rows are 56 px: say what the palette shows. The five surfaces are in three files, two of
them runtime sheets; keep one source for the numbers.

---

### W-03 — Peeking: an edge shows one panel; clicking or its key docks it; Esc folds

**Model:** sonnet (medium) · **Size:** M · **Depends on:** W-02 (#561), W-05 (the `fill` hook, and the toolbar the top edge
shows), W-19 (card: `keys-table.test.mjs`) · **Parallel with:** W-04, V-02

**Outcome.** Folded, the pointer resting within 8 px of the left, right or top edge for 150 ms shows that edge's panel as an
overlay with the theme's shadow: the sidebar, the inspector, the toolbar (with tabs once they have content). Moving away
hides it. Clicking inside it, or its key, **docks** it: the window unfolds with that panel and the toolbar showing.
`⌃⌘S` (sidebar) and `⌥⌘I` (inspector) dock from folded and toggle when unfolded. `Esc` with nothing else open folds.
Peeking never moves the column. **A region peeks only once it has content**, so today only the top edge works (the
toolbar); the sidebar and inspector light up with W-07 and W-09, with no change here.

**Why now.** ADR-0058 item 5 and `02-fold-up-workspace.md` §Peeking; W-02 deferred `Esc` here (`commands/workspace.ts:6`)
and registered no panel keys; W-05 gives the top edge something to show.

**Paths.**
- New: `apps/desktop/src/workspace/peek.ts` (`edgeFor(x, y, w, h)`, the dwell, `installPeek(workspace)`),
  `apps/desktop/src/commands/panels.ts` (`view.toggle-sidebar`, `view.toggle-inspector`, `view.fold-workspace`),
  `apps/desktop/src/workspace/peek-edge.test.ts` (node: edges and dwell with an injected clock),
  `apps/desktop/src/workspace/peek.test.mjs` (WebKit).
- Edit: `apps/desktop/src/workspace/state.ts` (W-02: add `peek(region)`, `unpeek()`, `dock(region)`; `unfold` `:145` takes an
  arrangement override), `apps/desktop/src/workspace/fill.ts` (W-05: call `installPeek`), `apps/desktop/src/pane/keys.ts`
  (`PaneChord` `:11` gains `ctrl?`; `paneChordFor` `:38` demands `!event.ctrlKey` on a Mac today, so honour `ctrl`; add
  `{ code: 'KeyS', ctrl: true, command: 'view.toggle-sidebar' }` and `{ code: 'KeyI', alt: true, command: 'view.toggle-inspector' }`),
  `apps/desktop/src/commands/index.ts`, `packages/theme/src/base.css` (a `body[data-marxy-peek]` overlay block next to
  W-02's: fixed, over the column, `--marxy-shadow-surface`, a fade of 170 ms or less, none under the `prefers-reduced-motion`
  block at `:695`), `scripts/gate-aesthetics.mjs` (`WORKSPACE`: a folded page with `data-marxy-peek` may show exactly the
  one region it names; new case), `scripts/registry.json` (`dataAttributes`: `data-marxy-peek`),
  `apps/desktop/test/keys-table.test.mjs` (W-19: the shared `Escape`, below), `docs/design/09-app-shell.md` (§Keyboard map
  `:78-104` and a §Peeking).
- Read: `commands/selection-nav.ts:11-22` (`selection.clear`, key `Escape`), `selection/bind.ts:84,217` (`inEditable`,
  `installCommandKeys`: a non-`global` command never runs in an editable), `pane/keys.ts:60` (`installPaneKeys`: held
  while a dialog is open), the Esc handlers `palette/view.ts:962`, `find/view.ts:334`, `outline/view.ts:176`,
  `selection/verb-menu.ts:252`, ADR-0058 items 4 and 5.

**Build order.**
1. `edgeFor` and the dwell, pure, with tests: side bands win over the top band at a corner; leaving the band cancels;
   dwell restarts after a hide.
2. `Workspace.peek/unpeek/dock`: peek makes the region's element (and runs its `fill`) as a child of `<body>` with
   `data-marxy-peek="<region>"` on `<body>`; folded only; not with `event.buttons !== 0` (a drag-select near the edge), nor
   with `dialog[open]`, nor for a region with no fill. `dock` from folded unfolds with that region and the toolbar open
   and drops the peek; unfolded it toggles the region (`setPanel`).
3. The three commands and the two chords. `view.fold-workspace`: key `Escape`, not `global`, `when` unfolded, selection
   `none`, no `dialog[open]`, no `.marxy-verb-menu`, `#marxy-find` hidden. **`Escape` is then shared with
   `selection.clear`** (disjoint `when`): W-19's chord table gets a declared `SHARED_CHORDS` entry and a test that the two
   `when`s are never both true.
4. The gate's peeked case, then the motion.

**Acceptance.**
- With the toolbar filled, resting 8 px from the top for 150 ms in a folded window adds the toolbar region; the article's
  `getBoundingClientRect` is identical before, during and after; leaving removes it; 100 ms adds nothing (`peek.test.mjs`
  fails on `main`: nothing peeks).
- At rest there is no peek element and the folded `gate:aesthetics` passes unmodified; the peeked page passes the new
  case; a second region or a stray element fails it.
- No peek with a button down, with a dialog open, or for a region with no fill (the sidebar today).
- A click inside the peeked toolbar docks it: `workspace.mode` is `unfolded`, the toolbar region is shown, and folding
  again remembers it (`workspace.json`).
- With a stub fill for `inspector`, `⌥⌘I` from folded unfolds with it docked, a second press undocks it; `⌃⌘S` the same for
  the sidebar; both work from inside CodeMirror.
- Unfolded, `Esc` folds; with a selection it clears the selection and the next `Esc` folds; with the palette, find, the
  outline or the verb menu open it closes only that; in a Source editor it does nothing to the workspace.
- `keys-table.test.mjs` passes with the two new chords and the declared `Escape`.
- Under reduced motion the peek has a transition duration of 0.

**Tests and gates.** `peek-edge.test.ts`, `peek.test.mjs`, `keys-table.test.mjs`, `workspace.test.mjs`. `pnpm check`, `gate:aesthetics` (folded, peeked, unfolded).

**Do not.** Draw anything in the folded window at rest: no floating sidebar button, no first-run hint (see Risks); peek
from the bottom; put content in a region; bind `Esc` in an editable; move the column.

**Risks.** (1) **`02-fold-up-workspace.md` and the mockup add a quiet sidebar button that shows while the pointer moves,
and a first-run hint.** Both put a control in the folded window; ADR-0058's "how we would know this was wrong" names
exactly that. Not built; the author may rule. (2) The webview may get no pointer events in the last pixels at the window's
edge, where macOS keeps the resize handle; the band is measured inside the client area and only the built-app smoke can
confirm it: unverified. (3) Off a Mac, `⌃⌘S` has no spelling; the palette command is the route until the author names one.

---

### W-21 — Transform: the toolbar button, the palette's group and the result sheet

**Model:** sonnet (high) · **Size:** M · **Depends on:** W-05, W-04 (the sheet takes its classes), J-04 (card: `writeCopy`),
W-19 (card: `⌘/` summons `>`), J-03 (merged); F-33 for its walk · **Parallel with:** W-03

**Outcome.** `⌘/` and the toolbar's Transform button open the palette on `>Transform`: one row per transform that can run
(`TRANSFORMS`), none that is in `NOT_YET`. Choosing one runs it on the selection, else the whole document, and opens the
**result sheet**: Before and After side by side with character counts. Actions: **Copy result** (Return; one pasteboard
item through `writeCopy`), **Apply** (⌘Return; replaces the input range in the document, one undo step), **Open as new
document** (`openScratch`), **Add another step** (the same list, on the result). `Esc` closes with nothing changed.
**Apply is offered only for `edit` transforms** (`Transform.kind`, `transforms/types.ts:16`): `derive` and `literal`
outputs are new text, not an edit of the input, so they copy or open as a document (the author may widen this).

**Why now.** 45 of 50 transforms have no door but J-04's menu, and ADR-0065 item 4 wants the palette, toolbar and verb menu
to agree on one library. J-06, J-09 and J-11 wait on the sheet.

**Data safety.** This card writes into documents. Ask for an **adversarial review** (probes: Apply after the file
reloaded from disk, after an edit in the other pane, with unfolded Source text, a selection across front matter, mixed line
endings). Run **F-33's walk** (`apps/desktop/test/store-walk.test.mjs`, `MARXY_WALK_SEEDS=200`) with a new
`apply-transform` op once F-33 has merged (it is wave 6) and say so in the PR.

**Paths.**
- New: `apps/desktop/src/transform/sheet.ts` (the dialog, built on demand like `outline/view.ts:97`, `:188`, `:225`),
  `apps/desktop/src/transform/chain.ts` (steps; pure) and `chain.test.ts`, `apps/desktop/src/commands/transform.ts`
  (`transform.open`, the toolbar's door; one `transform.run.<id>` per entry of `TRANSFORMS`, titled `Transform: <name>`),
  `apps/desktop/test/transform-sheet.test.mjs`.
- Edit: `apps/desktop/src/commands/registry.ts` (`Command.group` `:37`: add `'transform'`), `palette/commands.ts`
  (`GROUP_ORDER` `:7`: last), `palette/view.ts` (W-19's `⌘/` summons with the query `>Transform`),
  `apps/desktop/src/commands/index.ts`, `apps/desktop/src/source/structure.ts` (export a `replaceRange(target, from, to, text)`
  over `apply` `:63`, one isolated undo step), `docs/design/09-app-shell.md`, `docs/design/03-selection-and-operations.md`.
- Read: `packages/core/src/transforms/registry.ts` (`TRANSFORMS` `:85`, `transformById` `:92`, `runTransform` `:97`, `NOT_YET`
  `:37`, `Transform.outsideCode` `:28`), `selection/bind.ts:51,74` (`buildAppContext`: `operationInput()` and
  `applyBufferMutation`, whose `baseVersion` is the runtime's), `commands/edits.ts:27,51`, `document/store.ts` (`apply`:
  refuses a stale `baseVersion`), `document/scratch.ts:16` (`openScratch`), `commands/source-edit.ts:51` (`inSource`),
  `source/editor.ts:56` (`activeSourceEditor`), `app-types.ts:136` (`foldSource`).

**Build order.**
1. `chain.ts`: input, steps, `output()` by `runTransform`; the same input and step list give the same output.
2. The commands and the palette group; `transform.open` opens the palette on `>Transform`.
3. The input: Rendered `ctx.operationInput()` when a selection exists, else the whole buffer's range from
   `store.snapshot()`; Source: the CodeMirror selection, else the whole document.
4. The sheet and its four actions. Apply in Rendered calls `applyBufferMutation` (stale version refused, untouched, with a
   notice); with another pane holding unfolded Source on the store, `foldSource()` first, as `edits.ts:70` does for undo.
   In Source, `replaceRange`.
5. Return = Copy result; Esc = close; focus goes back where it was.

**Acceptance.**
- `⌘/` opens the palette with `Transform` typed and lists exactly `TRANSFORMS.length` transform rows (`transform-sheet.test.mjs`
  fails on `main`: no such rows).
- Choosing *Sort lines* on a selected list shows Before equal to the selection's bytes and After equal to
  `runTransform(id, text)`, with counts; Return writes one item (`pasteboardNativeWrites` 1, `lastPasteboardWrite` is After)
  and the store's version and the file's bytes are unchanged.
- Apply replaces exactly the range: every byte outside it is identical (a byte diff), the buffer is dirty, nothing is on
  disk until Save, and one `document.undo` restores the original bytes; a CRLF + BOM fixture keeps both.
- Apply is absent for a `derive` or `literal` transform (`x-links`, `json-string`) and present for an `edit`.
- Editing the document after the sheet opened and then pressing Apply changes nothing and says the document changed.
- Add another step runs the second transform on the first's After; Apply replaces the original range with the final
  output, one undo step. In Source the same, by one CodeMirror transaction.
- `Esc`: nothing changed, nothing copied. The sheet reads no clipboard (`pasteboardDataReads` empty).
- The toolbar shows Transform once `transform.open` is registered, and the button opens the palette.

**Tests and gates.** `chain.test.ts`, `transform-sheet.test.mjs`, `palette.test.mjs`, `source-structure.test.mjs`. `pnpm check`,
`gate:fidelity`, `gate:no-network`, the F-33 walk.

**Do not.** Transform the clipboard (J-06); keep a history or pipelines (J-08, J-11); a Diff view (J-11); read the
clipboard; add an Extract button; write to disk; add a `⌘Return` to the palette.

**Risks.** (1) `>` without a query gains 45 rows; the group sorts last, and the palette's preview of a transform's output
(`04-palette.md`) is W-13, not built here. (2) A 5 MB document runs a transform on the main thread: measure and report.
(3) `outsideCode` transforms leave code blocks and front matter alone only inside a Markdown document; in Source on a
`.py` file, say which transforms apply. (4) The mockup copies on Return in the palette; here Return opens the sheet, and
the sheet copies.

---

### J-06 — Transform the clipboard

**Model:** sonnet (medium) · **Size:** S · **Depends on:** J-02 (merged), J-04 (card), J-05 (card: `paste/read-clipboard.ts`),
W-21 (the sheet) · **Parallel with:** W-03, K-07

**Outcome.** The palette gets a command per runnable transform, `Transform clipboard: <name>`. Running one reads the
clipboard **on that action** (types first; a concealed item is refused and nothing is read), runs the transform on its
text, and opens W-21's sheet with the clipboard as the input. **Return writes the result back** (one pasteboard item,
plain text, a reader's copy) and says so; `Esc` writes nothing. The reader sees Before and After before anything is written.

**Why now.** ADR-0065 item 3 and J-02's `clipboardRead` have one caller (J-05's paste); this is the second, and it is the
palette's answer to "clean what I just copied elsewhere".

**Paths.**
- New: `apps/desktop/src/commands/transform-clipboard.ts`, `apps/desktop/test/transform-clipboard.test.mjs`.
- Edit: `apps/desktop/src/transform/sheet.ts` (W-21: an input of kind `clipboard`; the primary action is *Write back*;
  Apply is not offered; *Open as new document* and *Add another step* stay), `apps/desktop/src/commands/index.ts`,
  `apps/desktop/src/paste/read-clipboard.ts` (J-05: export its read-and-convert function if it is private),
  `docs/design/06-shell.md`.
- Read: `packages/shell-api/src/index.ts:118,125,132` (`clipboardTypes`, `clipboardRead`, `clipboardWriteItem`),
  `apps/desktop/src/shell/clipboard.ts:14` (`CONCEALED`), `shell/memory.ts` (`pasteboardDataReads`, `lastPasteboardWrite`,
  `pasteboardNativeWrites`, per J-04's card), `11-cards-wave-4.md` J-05 build order step 1, `studio/workbench.md:98-105`.

**Build order.** 1. The command reads through J-05's reader (the same refusals and messages). 2. Text: the plain text; HTML
only: `convertClipboard`'s Markdown. 3. Open the sheet; Return calls `writeCopy` with `{ text: after }`. 4. The notice:
"Clipboard transformed: <name>".

**Acceptance.**
- No `clipboardTypes` or `clipboardRead` call at boot, on listing the palette, on focus or after a copy; one pair after the
  command runs (`transform-clipboard.test.mjs` fails on `main`: no command).
- A concealed item: a notice, no data read (`pasteboardDataReads` empty), no sheet. A transient item is read (J-05's ruling).
- Return writes exactly one item whose plain text is After; `Esc` writes none; an empty clipboard says "Nothing on the
  clipboard to transform" and opens no sheet; an image-only clipboard is refused by name.
- The document store's version and the scratch count are unchanged.

**Tests and gates.** `transform-clipboard.test.mjs`. `pnpm check`, `gate:no-network`.

**Do not.** Watch the pasteboard; read at launch or on focus; record history (J-08); write HTML or RTF; run without the
sheet; add a global key or a Services entry.

**Risks.** `studio/workbench.md:100` says a pipeline refuses a transient item; J-05's ruling pastes it (only concealed is
refused). This card follows J-05 so the two reads agree; the author may tighten both. A 5 MB clipboard is read once:
measure and report.

---

### K-07 — The kind chip and the per-kind tool strip

**Model:** sonnet (medium) · **Size:** M · **Depends on:** K-05a (the kind decided at open), W-05 (the `kind` slot and
`fill`), K-03, K-04, K-18 (merged); J-04's change to `openVerbMenu` for menu rows · **Parallel with:** V-12, W-06, W-07

**Outcome.** In the unfolded toolbar a chip shows the open file's kind (K-18's glyph and the name). Its menu lists, first,
the reason that decided it and then the others (tier, signal, where seen), then *Show as* each kind, *Show as detected* and
*Always open this folder as …*; a choice runs K-04's command and then **reopens the file** so it takes effect now. The
`strip` region shows at most four tools for the kind. A tool appears only when its command is registered, so today the
strip holds only what exists (report and changelog: *Changes*; readme and docs: *Outline*; code: *Line numbers*) and a
kind with no tool hides the strip band without changing the remembered panels. `[strip]` in `config.toml` chooses and
orders a kind's tools.

**Why now.** K-04's commands say "will open as X" and K-05a makes it true at the next open; the chip is the door for them and
for the reasons ADR-0060 item 3 keeps. W-05 made the slot.

**Paths.**
- New: `apps/desktop/src/workspace/kind-chip.ts`, `apps/desktop/src/workspace/strip.ts` (`STRIP_TOOLS`: per kind, the mock's
  tools each with a `command` or `null`; `toolsFor(kind, config, registered)`), `apps/desktop/src/commands/kind-chip.ts`
  (`kind.chip`: opens the menu), `workspace/strip.test.ts` (node), `workspace/kind-chip.test.mjs` (WebKit).
- Edit: `apps/desktop/src/workspace/fill.ts` (W-05), `packages/theme/src/config.ts` (`Config` `:33`, `DEFAULTS` `:56`,
  `KNOWN` `:70`, `parseConfig` `:96`: a `strip` table; `parseKindRules` `:218` is the model: an unknown tool id warns and
  is skipped, more than four warns and truncates), `apps/desktop/src/commands/kind.ts` (`showAs` `:58` and
  `alwaysOpenFolderAs`: reopen with `appHandle().open(path)`), `apps/desktop/src/document/open.ts` (keep the whole
  `DetectResult`, not only `.kind`, where K-05a decides it; skip if K-05a already does),
  `apps/desktop/src/selection/verb-menu.ts` (`openVerbMenu` `:187`, after J-04 gives it `rows`), `docs/design/09-app-shell.md`,
  `docs/design/11-config-and-storage.md`.
- Read: `packages/core/src/kind/show-as.ts:168` (`detectFileKind`), `kind/detect.ts:66` (`Reason`, `DetectResult`),
  `kind-icons/icons.ts:12,81` (`KIND_GLYPHS`, `kindIconElement`), `commands/compare.ts:110` (*Show what changed on disk*),
  `commands/outline.ts:22`, `commands/source-view.ts:39`, `mock-v2/01-workspace.md` (Round 6: the strip lists),
  `03-content-modes.md`, ADR-0060 items 3, 6, 9.

**Build order.** 1. `STRIP_TOOLS` as a table test: no kind lists more than four; a tool names a command or `null`. 2. The
config key. 3. The chip, its menu rows and the reopen. 4. The strip fill, `region.hidden` set from emptiness on the
element, not through `setPanel`.

**Acceptance.**
- The chip shows README.md as readme, a `.py` as code, a task-list note as report, updates when the focused pane's
  document changes, and is absent with no document (`kind-chip.test.mjs` fails on `main`).
- The menu's reasons equal the `Reason`s `detectFileKind` returned at open, the decisive one first; nothing is recomputed.
- *Show as report* on an article writes the existing `kinds.json` entry, reopens, and the pane root reads
  `data-marxy-kind="report"`; the document's bytes are untouched.
- *Always open this folder as* appends one `[[kind]]` and no other byte of `config.toml` changes (K-04's append test, run
  through the chip).
- The strip for a kind shows exactly the tools of its row whose commands are registered, never more than four; clicking
  *Changes* runs `compare.since-reload`; an empty strip hides its band and `workspace.arrangement.strip` is unchanged.
- `[strip] report = ["nope"]` warns and is skipped (`config` test); folded, neither exists and the folded gate passes.

**Tests and gates.** `strip.test.ts`, `kind-chip.test.mjs`, the config tests. `pnpm check`, `gate:aesthetics` (both states).

**Do not.** Add a tool whose command does not exist; AI tools; re-detect on a reload; per-kind layouts (K-14); the *Look*
jump (K-15); a settings page or the customize sheet (W-12, W-05.1); draw either folded.

**Risks.** (1) Most kinds have an empty strip today; it fills as K-08 to K-22 register commands. (2) *Show as* over unsaved
edits meets `open`'s own prompt (`app-types.ts:93`); the chip adds none. (3) If K-05a stores only the kind, the reasons are
the small edit in `open.ts` above.
