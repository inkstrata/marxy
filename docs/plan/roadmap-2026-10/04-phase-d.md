# Phase D — Cross-reference: the split (story plan)

**Date:** 2026-10-02 · **Source:** `docs/research/audit-2026-10/14-roadmap-proposal.md` (Phase D),
`07-feature-split-view.md` (the design), `12-recommendation-codebase.md` (the refactor this stands on),
`05-performance-audit.md` §11.4 (cost). **Status:** a plan for implementing agents; nothing here is built.

**Abstract.** Phase D puts two documents side by side in one window: two columns, never more, one
hairline between them, each pane scrolling on its own, each pane Rendered or Source, a link followed into
the neighbour, the same file open twice at two positions, layout and reading positions remembered across
launches. It is built on what Phase B leaves behind (one `DocumentStore` per open document, one view per
article, a container-relative `--marxy-room`) and adds almost no new engine: the work is a pane model, a
divider, focus, a scroller per pane, the palette's "beside" mode, and moving the singletons that still
mean "the one document" (selection, Source editor, notices, close and save guards, find, outline) onto
the focused pane. Fourteen stories in five waves. Nothing needs a `shell-api` member or a Rust change;
the watcher is already a ref-counted table of one thread per canonical directory
(`apps/desktop/src-tauri/src/main.rs:254-340`, `apps/desktop/src-tauri/src/watch/mod.rs`) and a store
holds one subscription however many views it has.

## Phase goal and screen criterion

From the roadmap (`14-roadmap-proposal.md`, Phase D):

> **Ends with:** v0.4.0. Two columns, binary only, in one window (`07-feature-split-view.md`): "open in
> split" and "split with recent" from the palette; focus movement by key; hairline divider; independent
> scroll by default; a link followed into the neighbour; the same file twice at two positions; Source or
> Rendered per pane; layout restored on launch; refuse a second pane under 929 px. Find and outline bind
> to the focused pane.
>
> **Screen criterion:** a plan and its result side by side, a README beside the source it documents, a
> link clicked in one lands in the other.

"Clicked" means Cmd/Ctrl-click (see D-09 and the open questions); a plain click keeps replacing the
document in its own pane, as today.

## Preconditions: what must be on `main` first

Phase D starts only when Phases A, B and C are merged. These are the interfaces the stories assume. The
names come from `12-recommendation-codebase.md` §3 step 2, `07-feature-split-view.md` §6.1 and
`06-feature-collection-and-search.md` §5.3; **Phase B's real names may differ, and every story must read
the code first and adapt to what is there.** If the difference changes a story's shape (not just a
name), the agent stops and reports rather than inventing a parallel structure.

| # | Assumed from | Interface | If it differs |
| --- | --- | --- | --- |
| P1 | B step 2 | `apps/desktop/src/document/store.ts`: `DocumentStore`, one per canonical path, holding `path`, `disk`, `buffer`, `ast`, `nodeMap`, `history`, `version`, `dirty`; `snapshot()`, `subscribe(cb)`, `apply(...)`; a registry `openStore(path)` that returns the **same instance** for the same path and counts its views, so the last `release()` closes it. `mode` and `anchor` are **not** in the store (the ADR-0037 amendment). | If the store is not keyed by path or does not count views, D-01 adds that (a registry and a reference count) and says so in its PR. |
| P2 | B step 2 | `apps/desktop/src/view/rendered-view.ts`: `createView(host, store)` returning a view that owns `mode`, `anchor`, `scroller`, the typesetter, the `ResizeObserver`, snap timers, the Source editor, link history and its notices region, with `destroy()` releasing all of them (today's `teardownDocument()`, `apps/desktop/src/app.ts:769`, is the model). | The view must be constructible twice in one page. If a singleton remains (see the grep list in D-01 step 1), D-01 removes it. |
| P3 | B step 2 | `app.ts` is a composition root under 300 lines; `startApp(shell, opts)` and `AppHandle` (`app.ts:124-165` today) survive; `AppHandle.open(path, { at })` opens into the one view. | D-01 changes `open` to target a pane; the handle's existing members keep their meaning for a single pane. |
| P4 | B | The skeleton is `main#marxy-main > section.marxy-pane > (#marxy-notices, article#doc, Source mount)` with `container-type: inline-size` on the pane, and `--marxy-room` and the 30 em gutter step in `packages/theme/src/base.css` (today `:100` and `:125`) are container-relative (`cqw`, `@container`). | If B left `container-type` on `#marxy-main`, D-01 moves it to `.marxy-pane` and re-runs `packages/theme/test/layout.test.mjs`. |
| P5 | B | The Source editor mounts **inside the pane**, not `position: fixed; inset: 0` (`apps/desktop/index.html:16` today). | If not, D-01 and D-11 split the work as written below. |
| P6 | B step 2/6 | The parallel render path is retired and `scripts/gate-aesthetics.mjs` drives the app through `harness/app-harness.ts` (`startApp(memoryShell)`). | D-14 adapts; if the gate still uses `render/headless.ts`, D-14 reports it and builds the split case on the app harness instead. |
| P7 | B step 7 | The grid pass is one read pass and one write pass (`packages/typeset/src/grid.ts:46-55` today is a write-then-read loop) and first text is emitted after the first two screens. | D-14's cost step measures this; if it is missing, the bounds in D-14 are reported as not met rather than loosened. |
| P8 | A step 3 | The palette lists every registry command whose `when` holds (not only `op.*`, `palette/view.ts:91-95` today); `Mod+E` and the history keys are registry commands; `apps/desktop/src/outline/` exists and takes a view; `Mod+Shift+O` opens it. | D-06/D-13 bind whatever exists; they do not build the outline. |
| P9 | A | The pruned PR path (`04-tests-and-gates.md` §6): typecheck, lint, unit tests, goldens, fidelity, boundaries, registry, mechanical aesthetics, the desktop WebKit suite, a changelog fragment, a conventional subject. Visual comparison and perf are nightly. ADR-0044 to ADR-0051 are proposed; ADR-0037 is accepted with the per-document amendment. | Stories still pass whatever CI is current. |
| P10 | C | `openHit(hit, { target: 'here' \| 'split' })` in `apps/desktop/src/palette/view.ts` (today's `activateHit`, `:391`, which calls `renderPath(deps, …)`); `'here'` is today's behaviour and `'split'` is stubbed. The palette's empty state has sections (Pinned, Changed since you read, Recent). | D-07 implements `'split'`; if `openHit` does not exist, D-07 introduces it as `06` §5.3 specifies. |
| P11 | A/C | Find does not exist in Rendered mode today (`apps/desktop/src/find/` is absent; `docs/design/09-app-shell.md` §Find is a spec). Source mode already has CodeMirror's search keymap (`apps/desktop/src/source/editor.ts`, `baseExtensions`). | D-03 and D-13 build Rendered find; if an earlier phase already built it, D-13 shrinks to the pane binding and D-03 is skipped (the agent says so). |

New stories also rely on the rules in `AGENTS.md` that the audit keeps: byte fidelity, sanitise always,
names from `scripts/registry.json` first, no raw `invoke(` outside `src/shell`, the typography research
(`docs/research/reader-typography/`) as the authority, chrome at rest is zero.

## Shared rules for every story

- One story, one branch (`feat/D-nn-slug`), one worktree, one PR. A conventional commit subject with the
  story id (`feat(desktop): … (D-04)`). No attribution lines.
- Every story adds one `changelog.d/D-nn.md` fragment (one line, plain language, ends with `(D-nn)`),
  unless nothing a reader or developer can see changed, in which case the PR says so.
- New names (data attributes, marks, events) go into `scripts/registry.json` **before** the code that
  uses them. Only D-01 adds names in this phase (see the wave section).
- Do not edit a path outside the story's list. If a needed change lives elsewhere, report it.
- `#doc` stays the id of the first pane's article (54 test, script and package files name it,
  `07` §2.2 row 4). Tests move to `data-marxy-pane` over time, not inside Phase D.
- Run `pnpm precheck` before pushing, plus the gates a story names. Never re-run a flaky test until it
  passes; fix it or report it.
- The author reviews beauty by opening the app; no gate or checklist may require a taste-review entry
  (memory: taste queue voluntary). A story that changes what the reader sees may add a queue note.

## Dependency graph and waves

| Wave | Stories (run in parallel) | Why this grouping |
| --- | --- | --- |
| **W1** | **D-01** pane model and skeleton · **D-02** layout geometry and `layout.json` format · **D-03** find text index and query (pure) | D-02 and D-03 are pure modules with no dependency on D-01; D-01 is the critical path. |
| **W2** | **D-04** divider and theme tokens · **D-05** per-pane scroll · **D-06** focus · **D-08** close a pane and the two-document guards | All need only D-01 (D-04 also D-02). Paths are disjoint (see each story). |
| **W3** | **D-07** open beside and split with recent · **D-11** Source or Rendered per pane · **D-13** find and outline on the focused pane | D-07 needs D-08's guard before it may replace a document in a pane; D-11 and D-13 need focus and scroll. |
| **W4** | **D-09** follow a link into the neighbour · **D-10** the same file twice, one watch per store, notices per pane · **D-12** persist layout and positions, restore on launch | All need a second pane that the user can open (D-07); D-12 also needs D-11's modes. Paths are disjoint. |
| **W5** | **D-14** aesthetics gate, desktop suite and cost bounds | Closes the phase against the screen criterion; needs everything. |

Serial spine: D-01 → D-06/D-08 → D-07 → D-09/D-10/D-12 → D-14. D-02, D-03, D-04, D-05, D-11 and D-13 hang
off it and run beside it.

Registry edits: only D-01 touches `scripts/registry.json` (the data attributes `data-marxy-pane`,
`data-marxy-focus`, `data-marxy-split` and the mark `split_open`). The `find_first_match` mark that D-13
emits is already in the registry. Nothing else in the phase needs a new name; if a story finds it does, it
adds the name to the registry first and says so in its PR.

Two files collect one-line wiring from several stories: `apps/desktop/src/commands/index.ts` (each story that
adds commands appends one `...xCommands()` line to `commands()`, `:14-22`) and `apps/desktop/src/pane/index.ts`
(D-04 and D-05 each append one `install…(panes)` line). Those lines are append-only; whichever story merges
second rebases and keeps both. No other file is shared inside a wave.

## Verification at the end of the phase

Commands (from the repository root, in the story-free `main` after D-14 merges):

```bash
pnpm typecheck && pnpm lint && pnpm test           # includes the new desktop WebKit tests named below
pnpm check:registry && pnpm check:boundaries
pnpm gate:aesthetics                               # includes the split case added in D-14
node --test --experimental-strip-types apps/desktop/test/split-screen-criterion.test.mjs
```

The author's manual check (about ten minutes, on the packaged build, window 1,440 px wide or more):

1. Open a README that links to a plan. `Mod+\`, Enter: the most recent other document opens beside it.
2. In the plan, Cmd-click a relative link to its result: it replaces the right pane; the plan stays put
   and keeps focus. Click in the right pane, press Space: only the right pane scrolls.
3. `Mod+1`, `Mod+2`, `Mod+Alt+Left/Right` move focus; the window title names the focused document.
4. Palette, "Split this document": the same file twice; scroll them apart; tick a task in one, the
   other shows it.
5. `Mod+E` in the right pane: Source beside Rendered. A README beside the `.rs` or `.ts` file it
   documents (Cmd-click its link) opens that file in Source in the neighbour.
6. `Mod+F` finds only in the focused pane and lands the match at 40 % of that pane's height.
7. Drag the divider; double-click it: even again. `Mod+Shift+\` closes the focused pane; the survivor
   fills the window.
8. Quit with two panes open and relaunch: both documents, modes, ratio, positions and focus are back.
   Shrink the window under 929 px and press `Mod+\` with one pane open: a notice says why it will not
   split.
9. Edit in one pane, quit: the guard names the file.

## Stories

### D-01 — Build the pane model and the DOM skeleton for two panes

**Model:** opus · **Size:** L · **Depends on:** Phase B (P1 to P5) · **Parallel with:** D-02, D-03

**Outcome.** With one document nothing a reader sees changes. Underneath, the window is a `PaneSet`: an
ordered list of at most two panes, left to right, each a `section.marxy-pane` inside `#marxy-main` with
its own notices region, its own article, its own Source mount and its own view over a store. Code (and
the test helper this story ships) can open a document in a pane, create the second pane, focus a pane
and close one. The first pane's article is `#doc`; the second's is `#doc-2`; closing the left pane makes
the survivor's article `#doc` again. No key, no divider, no palette entry yet: later stories add those.

**Why now.** The audit's one structural finding for the split: "the app shell holds the open document as
55 module-level variables" and every call site assumes one `#doc` (`07` §2.2 rows 1 to 6; `07` §6.2 for
the skeleton). Everything else in Phase D hangs off this model, and the 54 files that name `#doc` must
keep passing.

**Paths.**
- New: `apps/desktop/src/pane/pane-set.ts`, `apps/desktop/src/pane/dom.ts`, `apps/desktop/src/pane/index.ts`.
- Edit: `apps/desktop/index.html` (skeleton and the app-shell CSS in its inline `<style>`), the
  composition root (`apps/desktop/src/app.ts` today) and the view factory (`apps/desktop/src/view/rendered-view.ts`
  under P2) only as far as needed to take a host element and a pane; `apps/desktop/src/notices/index.ts`
  (`ensureNoticesRegion`, `:15-30`: add an optional pane argument, default unchanged).
- Edit: `scripts/registry.json` (`dataAttributes`: `data-marxy-pane`, `data-marxy-focus`,
  `data-marxy-split`; `marks`: `split_open`).
- Docs: `docs/design/09-app-shell.md` (skeleton, state table: `layout`, `focusedPane`; `mode` moves to the
  view), `docs/adr/0005-two-modes.md` (one sentence: "the focused pane"), `docs/adr/0011-palette-not-tabs.md`
  (a note that a summoned split passes), and a new short ADR, `docs/adr/00NN-two-column-split.md` (the
  next free number after the ADRs Phases A to C minted): two columns, in one window, binary, no tree, no
  OS windows, scroll independent, `#doc` is the first pane.
- New tests and helper: `apps/desktop/test/pane-set.test.mjs`, `apps/desktop/test/support/two-pane.mjs`.

**Build order.**
1. Read the code as Phase B left it. Run
   `grep -rn "getElementById('doc')\|getElementById('marxy-source')\|getElementById('marxy-notices')\|document.documentElement" apps/desktop/src`
   and `grep -c "^let " $(grep -rl "^let " apps/desktop/src --include=*.ts)`. List every remaining
   module-level variable that means "the one document or view" (candidates today: `selection/view.ts:75-85`,
   `source/editor.ts:35-36` `sharedParent`/`sharedEditor`, `notices/index.ts:11-12`, `palette/session.ts:19`,
   `close.ts:21`, `save.ts:24`). Put the list in the PR description; D-05, D-06, D-08, D-10, D-11 each
   own one or two of them (named in their stories). This story removes only what stops a **second view
   from being constructed**.
2. `scripts/registry.json`: add the three data attributes and the `split_open` mark first.
3. `pane/dom.ts`: `export type Slot = 0 | 1;`
   `export function idsForSlot(slot: Slot): { article: string; notices: string; source: string }` returning
   `doc` / `marxy-notices` / `marxy-source` for slot 0 and `doc-2` / `marxy-notices-2` / `marxy-source-2`
   for slot 1; `export function createPaneElement(slot: Slot): PaneParts` building
   `section.marxy-pane[data-marxy-pane="<slot>"][tabindex="-1"]` containing `div[role=status]` (notices),
   `article.marxy-article`, `div.marxy-source-mount[hidden]` and a `div.marxy-find-slot` (an empty,
   zero-height `position: sticky; top: 0` holder that D-13 fills; it must be invisible and empty at
   rest); `export function applySlot(parts: PaneParts, slot: Slot): void` that sets the attribute and the
   three ids together (a rename is one synchronous task: `getElementById('doc')` must never be null
   between statements another script can observe).
4. `pane/pane-set.ts`:
   ```ts
   export const MAX_PANES = 2;
   export interface Pane { readonly slot: Slot; readonly host: HTMLElement; readonly article: HTMLElement; readonly view: View /* P2 */; path(): string | null; }
   export interface PaneSet {
     readonly panes: readonly Pane[];            // length 1 or 2, left to right
     readonly focused: Pane;
     ratio: number;                              // width fraction of the left pane; default 0.5
     openIn(target: 'focused' | 'other' | Slot, path: string, opts?: { at?: number }): Promise<Pane | null>;
     close(pane: Pane): Promise<boolean>;        // false when refused (see D-08's guard hook)
     focus(pane: Pane): void;                    // sets data-marxy-focus on that host only, calls host.focus({ preventScroll: true }), emits 'focus'
     setRatio(ratio: number): void;              // writes the grid template, emits 'ratio'; callers clamp with D-02
     onSplit(cb: (main: HTMLElement) => () => void): void;   // called when a second pane appears; the returned cleanup runs when it goes
     onChange(cb: (e: { kind: 'open' | 'close' | 'focus' | 'ratio'; pane?: Pane }) => void): () => void;
     beforeReplace?: (pane: Pane) => Promise<boolean>;   // set by D-08; default permits
     canSplit?: () => boolean;                   // set by D-07; default permits
   }
   export function createPaneSet(deps: { main: HTMLElement; openStore: …; createView: …; mark(name: string): void }): PaneSet;
   ```
   `openIn('other', …)` with one pane calls `canSplit()`, appends `createPaneElement(1)`, sets
   `data-marxy-split` on `#marxy-main` and the grid template of `#marxy-main` set to the two ratios as `fr` units (left `ratio`, right `1 - ratio`),
   creates the view over `openStore(path)`, emits the `split_open` mark when its first text is laid
   out. `openIn` into an occupied pane awaits `beforeReplace(pane)` first, then replaces that pane's
   view's store without recreating the pane. `close(pane)`: await `beforeReplace`-style guard (D-08),
   `view.destroy()` (releases the store), remove the host, move the survivor to slot 0 with `applySlot`,
   remove `data-marxy-split`, clear the grid template, focus the survivor.
5. `index.html`: skeleton as `07` §6.2 (one pane; no divider element exists with one document).
   Inline CSS, replacing today's Source-overlay rules (`:16-17`): `.marxy-pane { position: relative;
   container-type: inline-size; min-width: 0; }`;
   `#marxy-main[data-marxy-split] { display: grid; height: 100vh; }`;
   `#marxy-main[data-marxy-split] > .marxy-pane { overflow-y: auto; height: 100vh; }`;
   `.marxy-source-mount[hidden] { display: none; }`;
   `#marxy-main:not([data-marxy-split]) .marxy-source-mount:not([hidden]) { position: fixed; inset: 0; overflow: auto; }`
   (today's behaviour, one pane);
   `#marxy-main[data-marxy-split] .marxy-source-mount:not([hidden]) { position: absolute; inset: 0; overflow: auto; }`;
   the notices-over-Source rule becomes per pane (`.marxy-pane[data-marxy-mode="source"] > [role=status]`
   `position: sticky; top: 0`) instead of `body[data-marxy-mode="source"] #marxy-notices`. Keep
   `#marxy-palette`, `#marxy-outline` unchanged. If P5 already moved the Source mount, keep what B did and
   add only the split-state rule.
6. Composition root: create the `PaneSet` in `startApp`; `AppHandle.open(path, opts)` becomes
   `panes.openIn('focused', path, opts)`; `currentPath()` is the focused pane's path; add
   `AppHandle.panes(): PaneSet` for the harness. Anything that today reads `#doc` through
   `getElementById` still works (slot 0).
7. `test/support/two-pane.mjs`: a `bootTwoPanes(page, { files, open: [a, b] })` helper in the style of
   `boot` in `apps/desktop/test/live-reload.test.mjs:58-90` (Vite server on port 0, `app.html`, the
   memory shell, `window.__marxyHandle`), returning handles to both panes. Later stories reuse it.
8. Docs: the skeleton and state table in `docs/design/09-app-shell.md`; the ADR; the two ADR sentences.

**Acceptance.**
- With one document the app behaves as before: every existing desktop test passes unchanged
  (`pnpm --filter @marxy/desktop test`), including `apps/desktop/test/app-harness.test.mjs`,
  `live-reload.test.mjs`, `save.test.mjs`, `selection.test.mjs`.
- With one document the DOM has no `.marxy-divider` and no `data-marxy-split`; `checkChrome` in
  `scripts/gate-aesthetics.mjs:548` returns no problems (`pnpm gate:aesthetics`).
- `apps/desktop/test/pane-set.test.mjs`: `openIn('other', B)` yields two `section.marxy-pane` with
  `data-marxy-pane` 0 and 1, `#doc` in the first and `#doc-2` in the second, both showing their own
  text; `#marxy-main` has `data-marxy-split`; the `split_open` mark was recorded.
- Same test: `close(panes[0])` leaves one pane whose article has `id="doc"`, whose notices region has
  `id="marxy-notices"`, and `data-marxy-split` gone; `handle.debugCounts()` (`app.ts:146`, `:1353` today) reports
  one typesetter and one resize observer after open-split-close, and after ten such cycles.
- Same test: `panes[0].view !== panes[1].view`, and for two different paths their stores differ; with
  `focus(panes[1])` exactly one host carries `data-marxy-focus` and `document.activeElement` is inside it.
- Same test: `onSplit`'s callback runs once when the second pane appears and its cleanup once when it closes.
- `canSplit` returning false makes `openIn('other', …)` resolve `null` and leave one pane (unit-level
  in the same file); `beforeReplace` returning false leaves the pane's document in place.
- `pnpm check:registry` passes with the new names.

**Tests.** Stay green: all of `apps/desktop/test/*.test.mjs`, `packages/typeset` tests, `pnpm check:boundaries`
(nothing outside `apps/desktop/src/shell` may `invoke(`). New: `test/pane-set.test.mjs`. Gates:
`pnpm precheck`, `pnpm gate:aesthetics`.

**Do not.** Add a divider, a key, a palette entry or a layout file (D-04, D-06, D-07, D-12). Change what a
single document looks like or how it scrolls. Rename `#doc`, `#marxy-source` or `#marxy-notices` in slot 0.
Allow a third pane (`MAX_PANES` is a constant, not a feature). Touch `packages/core/src/contracts/`.
Edit `selection/view.ts`, `source/editor.ts`, `close.ts`, `save.ts` (other stories own them).

**Risks and open questions.** Phase B's real view API may not let a second view be constructed (see step 1
list); if more than the listed singletons block it, report before widening. The id rename on close
(`doc-2` to `doc`) is the cheapest way to keep 54 files green; if some code caches `getElementById`
results across a close, that is a bug to fix where found. Whether `container-type: inline-size` on a pane
that is also `overflow-y: auto` and `height: 100vh` behaves in WKWebView and WebKitGTK is checked here by
`packages/theme/test/layout.test.mjs` plus the new test; report any difference.

**From the B-13 review (2026-10-07).** A second view stands beside the first for Rendered only: `source/editor.ts`
keeps a module-shared `sharedEditor`/`sharedParent`, and one view's `clear()` destroys the other's editor. Replace
that pair here.

---

### D-02 — Write the layout geometry and the `layout.json` format

**Model:** sonnet · **Size:** S · **Depends on:** nothing · **Parallel with:** D-01, D-03

**Outcome.** Two pure, shell-free modules in `@marxy/core` with their tests: the arithmetic that says how
wide a window must be for two panes at the typography floor and how far a divider may move, and the
parser and serialiser of `layout.json` (the file that remembers the split), with the same version and
quarantine discipline as `positions.json`. Nothing is wired; later stories import them.

**Why now.** The narrow-window rule (two 66-character columns need 1,318 px, two 45-character columns
929 px, `07` §5) and the layout file (`07` §4.6, §6.5) are both decided and both testable without a DOM.
D-04, D-07 and D-12 each need them, and they should not each re-derive the numbers.

**Paths.** New: `packages/core/src/layout/geometry.ts`, `packages/core/src/layout/storage.ts`,
`packages/core/src/layout/index.ts`, `packages/core/src/layout/geometry.test.ts`,
`packages/core/src/layout/storage.test.ts`. Edit: `packages/core/src/index.ts` (one export line,
`export * from './layout/index.ts'`, next to `./sourcemap/index.ts`, `:12`).

**Build order.**
1. `geometry.ts`:
   ```ts
   export const MAX_COLUMNS = 2;
   export const MIN_COLUMN_CHARS = 45;              // ADR-0033 floor
   export const DEFAULT_RATIO = 0.5;
   export interface SplitMetrics { readonly avgChar: number; readonly bodyPx: number; readonly gutterPx: number; }
   export function minColumnWidth(m: SplitMetrics): number;   // 45 * avgChar * bodyPx + 2 * gutterPx
   export function minSplitWidth(m: SplitMetrics): number;    // 2 * minColumnWidth(m)
   export function fitsTwoColumns(widthPx: number, m: SplitMetrics): boolean;  // floor(width) >= floor(minSplitWidth)
   export function clampRatio(ratio: number, widthPx: number, m: SplitMetrics): number;
   ```
   `clampRatio` keeps both columns at or above `minColumnWidth`, returns `DEFAULT_RATIO` for a NaN or an
   impossible width, and never returns outside (0, 1).
2. `storage.ts`, modelled on `packages/core/src/position/storage.ts` (`parsePositionsFile`,
   `serializePositionsFile`, `quarantinePathFor`): `LAYOUT_FILE_VERSION = 1`;
   `interface LayoutColumn { path: string; mode: 'rendered' | 'source' }`;
   `interface LayoutEnvelope { version: number; columns: LayoutColumn[]; ratio: number; focused: number }`;
   `emptyLayoutEnvelope()`; `parseLayoutFile(bytes): LoadLayoutResult` (`ok` or `quarantined`, same
   shapes as positions; non-UTF-8, non-JSON, non-object, missing numeric `version` quarantine;
   `columns` entries without a string `path` are dropped, more than `MAX_COLUMNS` are truncated, a
   `mode` that is not `rendered`/`source` becomes `rendered`; `ratio` outside [0.2, 0.8] or non-numeric
   becomes `DEFAULT_RATIO`; `focused` clamps into the columns); `serializeLayoutFile(env)`; reuse
   `quarantinePathFor` by importing it from `../position/storage.ts`.
3. Tests: the numbers from `07` §5 and Appendix A: with `{ avgChar: 0.463, bodyPx: 20, gutterPx: 24 }`,
   `minColumnWidth` is 464.7 (to one decimal), `minSplitWidth` 929.4; `fitsTwoColumns(929)` is true,
   `fitsTwoColumns(928)` false, `fitsTwoColumns(1318)` true; at `bodyPx: 28` the minimum is about 1,262.8
   so 1,200 is refused; `clampRatio(0.05, 1470, m)` is at least `minColumnWidth / 1470`; storage: round
   trip; truncation; quarantine on garbage; a newer `version` is preserved and flagged the way
   `PositionPersistence` flags it (return `version` unchanged so D-12 can refuse to overwrite).

**Acceptance.**
- `fitsTwoColumns(929, defaults)` is true and `fitsTwoColumns(928, defaults)` is false
  (`packages/core/src/layout/geometry.test.ts`).
- `minSplitWidth` at body 20 px equals 929.4 to 0.1 and at 28 px exceeds 1,262
  (`geometry.test.ts`).
- A three-column file parses to two columns; a file of `{"version":1,"columns":"x"}` yields an empty
  layout without throwing; non-JSON bytes quarantine and return the original bytes
  (`packages/core/src/layout/storage.test.ts`).
- `pnpm check:boundaries`: the module imports nothing from `apps/`, no Node built-ins, no DOM.

**Tests.** Stay green: `pnpm --filter @marxy/core test` (`node --test 'src/**/*.test.ts'`),
`gate:golden`, `gate:fidelity` (untouched). New: the two test files. Gates: `pnpm precheck`.

**Do not.** Read the DOM, the window or CSS here (the desktop passes `SplitMetrics` in). Add the
persistence class (D-12). Hard-code 929 anywhere but a test and the doc comment. Edit
`position/storage.ts` (import from it only).

**Risks and open questions.** The gutter is 16 px below 30 em and 24 px above (`base.css:125`); at every
width where two panes are even possible it is 24, so `gutterPx` is a parameter rather than a function.

---

### D-03 — Write the pure half of Rendered find: the text index and the query compiler

**Model:** sonnet · **Size:** S · **Depends on:** nothing · **Parallel with:** D-01, D-02

**Outcome.** Two DOM-free modules and their tests: one turns a list of text-node strings into a single
searchable string with a way back to `(node index, offset)`, the other compiles what a reader types into
a regular expression that matches what the page shows (smart quotes, dashes, ellipsis, non-breaking
spaces). Nothing is wired and nothing is visible; D-13 builds the pane-bound find on them.

**Why now.** Find does not exist in Rendered mode (`05` §10.1: "the feature does not exist in Rendered
mode"; `07` §1 finding 7) and the design is already fixed in `docs/design/09-app-shell.md` §Find. The
pure half has no dependency on the split, so it is built in the first wave and D-13 stays small.

**Paths.** New: `apps/desktop/src/find/text-index.ts`, `apps/desktop/src/find/query.ts`,
`apps/desktop/test/find-index.test.mjs`, `apps/desktop/test/find-query.test.mjs` (`test/**/*.test.mjs` is
already in the package's test glob, `apps/desktop/package.json` `test` script; these import the `.ts`
files the way `test/live-reload.test.mjs:11` does). No other file.

**Build order.**
1. `text-index.ts`: `buildTextIndex(pieces: readonly string[]): TextIndex` where
   `interface TextIndex { readonly text: string; locate(offset: number): { piece: number; offset: number } }`
   and `findAll(index, re: RegExp): { start: number; end: number }[]` (global, non-overlapping, empty
   matches skipped). Pieces concatenate with no separator (a text-node boundary inside a word is not a
   space). Offsets are UTF-16 code units, as the DOM's are. Document in a comment why this is safe
   after typesetting: the typesetter's line breaks are empty `<span class="marxy-lb">` elements whose
   generated content is not text (`packages/typeset/src/apply.ts:1-8`), so concatenated text is
   unchanged by a pass; only the pieces' boundaries move, which is why D-13 re-resolves a range from a
   fresh walk at highlight time rather than keeping node references.
2. `query.ts`: `compileQuery(input: string): RegExp | null` following `docs/design/09-app-shell.md`
   §Find: flags `giu`, regex metacharacters escaped first, then the substitutions on the query (never
   the text): `'` to `['‘’]`, `"` to `["“”]`, `---` to `(?:---|—)`, then `--` to `(?:--|–)`, `...` to
   `(?:\.\.\.|…)`, a space to `[  ]`. Empty input returns `null`.
3. Tests: apostrophe finds a curly one; `--` finds an en dash; `...` finds an ellipsis; a space finds a
   non-breaking space; a match across two pieces locates both ends in the right pieces; `.` in the query
   is literal; two panes' worth of pieces are independent (the functions hold no module state).

**Acceptance.**
- `compileQuery("don't")` matches `don’t` and `don't` (`test/find-query.test.mjs`).
- `compileQuery('a--b')` matches `a–b` (`find-query.test.mjs`).
- `buildTextIndex(['foo ', 'bar baz'])` locates the match for `bar` at `{ piece: 1, offset: 0 }` and a
  match for `o b` spanning the boundary reports both ends (`test/find-index.test.mjs`).
- `findAll` on 200 KB of text with a one-character query returns in under 50 ms on this machine
  (recorded in the test output; assert a generous 500 ms so a slow runner does not fail it).

**Tests.** Stay green: the whole desktop suite. New: the two files above. Gates: `pnpm precheck`.

**Do not.** Touch the DOM, `CSS.highlights`, keys, `app.ts` or any view (D-13). Index `.katex` text here
(D-13 filters nodes before calling in). Add a dependency.

**Risks and open questions.** None blocking. If D-13's author finds the pieces-list shape awkward for a
`TreeWalker`, changing it is D-13's call and this file's tests move with it.

---

### D-04 — Draw the hairline divider, add its theme tokens, and make it resizable

**Model:** sonnet · **Size:** M · **Depends on:** D-01, D-02 · **Parallel with:** D-05, D-06, D-08

**Outcome.** When two panes are open, a single 1 px hairline in the theme's rule colour separates them,
inside `#marxy-main`, with no handle, no label and no layout width. Dragging it resizes the panes;
double-clicking it makes them even again; two palette commands do the same by keyboard. When focus
moves, the hairline's focused side fades in the theme's accent colour over 150 ms (not under
`prefers-reduced-motion`). With one pane there is no divider element at all. The colours are theme tokens
a theme author can change.

**Why now.** `07` §4.4: "one 1 px hairline, no handle", resize by drag and reset by double-click (Zed);
and the checklist in `docs/design/09-app-shell.md:187-196` makes keyboard completeness a test, so the
drag needs a keyboard alternative. Tokens are the theme boundary (`docs/theme-contract.md`: "rules and
dividers" are theme-owned).

**Paths.**
- New: `apps/desktop/src/pane/divider.ts`, `apps/desktop/src/commands/pane-layout.ts`,
  `apps/desktop/test/divider.test.mjs`.
- Edit: `packages/theme/src/tokens.css`, `packages/theme/default/theme.css` (the light block),
  `packages/theme/tokens.contract.json`, `packages/theme/test/palettes.json`, `packages/theme/src/base.css`
  (divider rules only), `docs/design/05-theme.md` (palette table), `apps/desktop/src/commands/index.ts`
  (one line adding `paneLayoutCommands()` to `commands()`, `:14-22`), `apps/desktop/src/pane/index.ts`
  (one line: `panes.onSplit((main) => createDivider(panes, main).destroy)`; `PaneSet.setRatio` and
  `onSplit` are D-01's, so `pane-set.ts` is not edited here).

**Build order.**
1. Tokens first, following `scripts/check-tokens.mjs` (names, unit kinds, comments; the contract is the
   names, `tokens.contract.json`): `--marxy-color-divider` (dark default `var(--marxy-color-rule)`,
   light `var(--marxy-color-rule)`), `--marxy-color-divider-focus` (dark and light `var(--marxy-color-accent)`),
   `--marxy-divider-hit` (`8px`). Add them to `tokens.css` (dark), `default/theme.css` (light),
   `tokens.contract.json`, `palettes.json`, and the table in `docs/design/05-theme.md`.
   `node scripts/check-tokens.mjs` must pass.
2. `divider.ts`: `createDivider(panes: PaneSet, main: HTMLElement): { el: HTMLElement; destroy(): void }`.
   The element is `div.marxy-divider[role="separator"][aria-orientation="vertical"]`, an absolutely
   positioned child of `#marxy-main` at `left: calc(ratio * 100%)` with a hit area of
   `var(--marxy-divider-hit)` centred on the boundary and **zero flow width** (the grid columns are
   exactly `ratio fr` and `1 - ratio fr`; the typography arithmetic in `07` §5 assumes no extra pixel).
   Pointer capture on `pointerdown`; `pointermove` calls `panes.setRatio(clampRatio(x / main width,
   mainWidth, metrics))` using D-02; `dblclick` calls `panes.setRatio(DEFAULT_RATIO)`. `metrics` is read
   from the root's computed `--marxy-avg-char` and `--marxy-size-body` and the pane article's gutter.
3. `base.css`: `.marxy-divider::before` draws 1 px of `var(--marxy-color-divider)`, `cursor: col-resize`
   on the element; the focused-side fade is a 150 ms keyframe from `--marxy-color-divider-focus` to
   `--marxy-color-divider`, started by `#marxy-main:has(> .marxy-pane[data-marxy-pane="0"][data-marxy-focus])`
   (hairline drawn on the left edge of the hit area) or the `"1"` equivalent (right edge); under
   `@media (prefers-reduced-motion: reduce)` (existing block at `:495`) and
   `@media (forced-colors: active)` (`:486`) there is no animation and the hairline is `CanvasText`/rule
   colour. Keep it one rule block so the author can delete the animation without touching the rest.
4. `commands/pane-layout.ts`: `view.reset-split` ("Even split", `when`: two panes), `view.split-wider`
   and `view.split-narrower` ("Widen / narrow the focused pane", ratio steps of 0.05 toward or away from
   the focused side, clamped by `clampRatio`). No `key` fields (palette only).
5. Divider lifecycle: `createDivider` is registered with `panes.onSplit` (D-01), so it exists exactly while
   two panes do.

**Acceptance.**
- Two panes: `document.querySelectorAll('.marxy-divider').length === 1`, inside `#marxy-main`, and its
  `getBoundingClientRect().width` is at most the hit area while the panes' widths still sum to the
  main's width (`apps/desktop/test/divider.test.mjs`).
- One pane: no `.marxy-divider` in the DOM (`divider.test.mjs`).
- Dragging from the boundary to 30 % of the width sets the left pane's width to 30 % within one pixel
  and never below the 45-character floor: dragging to 5 % stops at `minColumnWidth`
  (`divider.test.mjs`, using `page.mouse`).
- Double-click returns the panes to equal widths (`divider.test.mjs`); `view.reset-split` does the same
  from the palette command list (`handle.commands()` includes it, `when` true only with two panes).
- `node scripts/check-tokens.mjs` and `pnpm --filter @marxy/theme test` pass with the three tokens;
  `packages/theme/test/palettes.test.mjs` finds them in both variants.
- `pnpm gate:aesthetics` is unchanged for every single-document case (no baseline moves).

**Tests.** Stay green: `packages/theme/test/*.test.mjs` (`layout`, `grid`, `media-queries`, `palettes`),
`scripts/check-tokens.test.mjs`. New: `test/divider.test.mjs`. Gates: `pnpm precheck`, `pnpm gate:aesthetics`,
`pnpm lint:theme`.

**Do not.** Add a handle, a grip glyph, a title strip, or any text to the divider. Make the divider take
layout width. Dim the unfocused pane (the aesthetics gate checks contrast, `07` §4.4). Hard-code a colour
or `150ms` outside the CSS rule and tokens. Edit `scripts/registry.json` (no new name is needed; `.marxy-divider`
is a class under the existing prefix). Change any existing token's value.

**Risks and open questions.** Whether the hairline is on by default, and whether the focus fade stays, is a
taste call (`07` §4.4); both live in one CSS rule block and a token, so the author can remove either
after opening the app. `:has()` is supported in the WebKit engines Marxy ships on (WKWebView, WebKitGTK
2.42+); if the project's WebKitGTK floor is older, replace the selector with a `data-marxy-focus`-reading
class set by `PaneSet.focus` and report it.

---

### D-05 — Make each pane its own scroller, with its own reading position and anchor

**Model:** opus · **Size:** M · **Depends on:** D-01 · **Parallel with:** D-04, D-06, D-08

**Outcome.** With two panes each scrolls on its own: wheel, trackpad, Space, PageDown and the arrow keys
move only the pane under the pointer or the focused one, and each pane keeps its own reading position.
With one pane, scrolling is exactly what it is today (the window scrolls). Splitting and unsplitting
preserve where each document was being read.

**Why now.** The page scrolls the window: `readingScroller()` returns `document.documentElement`
(`apps/desktop/src/app.ts:197-199`), and the scroll listener, the reading anchor and the palette copy that
(`07` §2.2 row 3, §6.7). Two documents in one window cannot share a scroller.

**Paths.**
- New: `apps/desktop/src/pane/scroll.ts`, `apps/desktop/test/pane-scroll.test.mjs`.
- Edit: the view (`apps/desktop/src/view/rendered-view.ts`, P2) for `scroller`, the anchor and the scroll
  listener (today `app.ts:197`, `:647-672` `releaseAnchor`/`listenForReaderScroll`, `:673` `holdAnchor`,
  `:1014` `installScrollPersistence`, `:741` `keepOnGrid`); `apps/desktop/src/pane/index.ts` (one line:
  `installScroll(panes)`, which calls `view.rebindScroller()` from `panes.onChange`; `pane-set.ts` is not
  edited); `apps/desktop/src/position/position.ts` only if a signature must change (it already takes the
  scroller as a parameter, `:15-37`).

**Build order.**
1. Decide and document the model in a header comment in `pane/scroll.ts`: **one pane scrolls the window,
   two panes scroll their own elements.** An always-pane scroller was rejected because 54 files and
   most of the existing harness read `document.documentElement.scrollTop` and `window.scrollTo`
   (for example `test/live-reload.test.mjs:102`); a pane-only model would turn Phase D into a rewrite of
   them. The cost is one transition, handled in step 3. If Phase B already made the pane the scroller
   in the one-pane state, keep that and delete the transition (report which).
2. `view.scroller` becomes `panes.size > 1 ? pane.host : document.documentElement`. Every reader of the
   scroller goes through it. Grep `document.documentElement` and `scrollTop` under `apps/desktop/src`;
   the ones to keep as `documentElement` are the single-pane window cases only. (`selection/view.ts:94`
   `scrollToFragment` and `palette/view.ts:515` are owned by D-09 and D-07; leave them.)
3. `view.rebindScroller()`: before the layout changes, read `currentPosition(old scroller, blocks, path,
   mode)`; after `data-marxy-split` toggles, detach the persistence listener from the old scroller, attach
   to the new one, and `restoreScrollToPosition(new scroller, blocks, position)`. Because the position
   is a byte coordinate (ADR-0018) a pane that changes width or scroller keeps its place. Run it for
   **both** panes on a split and for the survivor on a close.
4. Anchor release: today the four reader-input events (`wheel`, `touchstart`, `mousedown`, `keydown`) are
   captured on `window` and release the one anchor (`app.ts:655`). Make them release **only the anchor of
   the pane the event happened in** (`host.contains(event.target)`), and a `keydown` the focused pane's.
   Otherwise scrolling the right pane lets the left pane's pending open anchor drift.
5. Scroll persistence: the `scroll` listener writes the position of the pane that scrolled, through the
   rule D-12 finalises. Until then: only slot 0's pane writes (`pane.slot === 0`), so two panes do not
   fight over one `positions.json` key.
6. Keyboard scrolling: Space/PageDown only scrolls a scroller that has focus. Give each `.marxy-pane` a
   `tabindex="-1"` and have `PaneSet.focus(pane)` call `pane.host.focus({ preventScroll: true })`
   (D-06 calls it on key and click). No focus ring (the host is not in the tab order).
7. Typesetter: `packages/typeset/src/index.ts:261,270` read `window.innerHeight`, which is right for
   side-by-side panes of full height; do not change them. Verify the typesetter's `IntersectionObserver`
   (`:276-285`, `rootMargin: '200% 0px'`, implicit root) still fires for blocks inside an
   `overflow-y: auto` pane (an implicit root accounts for ancestor clipping); the test below proves it.

**Acceptance.**
- Two panes, each with a 12-paragraph document (the `para` fixtures of `test/live-reload.test.mjs:28-34`):
  setting `panes.panes[1].host.scrollTop = 400` leaves `panes.panes[0].host.scrollTop` at its old value and
  the left pane's `sourceHarness().byteOffset` unchanged (`test/pane-scroll.test.mjs`).
- Mouse wheel over the right pane scrolls only the right pane (`page.mouse.wheel` after moving there)
  (`pane-scroll.test.mjs`).
- Focus the right pane via `panes.focus`, press Space: the right pane's `scrollTop` increases and the
  left's does not (`pane-scroll.test.mjs`).
- Scroll the single document to the 6th paragraph, split, close the split: the first block under the reading
  line is the same block throughout (`handle.sourceHarness().byteOffset` equal before and after, and
  after reopening a one-pane layout) (`pane-scroll.test.mjs`).
- A pending open anchor in the left pane survives a wheel event over the right pane
  (`pane-scroll.test.mjs`).
- A paragraph below the fold in the right pane is typeset once scrolled into view
  (`data-marxy-typeset` or the `marxy-lb` spans appear) (`pane-scroll.test.mjs`).
- All single-pane tests that read `scrollY` still pass unchanged.

**Tests.** Stay green: `test/live-reload.test.mjs`, `test/persist-reading.test.mjs`,
`test/layout-shift-window.test.mjs`, `test/jump-to-source.test.mjs`, `test/source-mode-shell.test.mjs`.
New: `test/pane-scroll.test.mjs`. Gates: `pnpm precheck`.

**Do not.** Link the two scrollers (not built, not behind a flag). Edit `selection/view.ts` or
`palette/view.ts` (D-06/D-09, D-07). Touch `packages/typeset`. Change how a single document scrolls or
add an `overflow` rule to the one-pane layout. Persist anything new.

**Risks and open questions.** The transition at split and unsplit is the one place a reader could see a
jump; the byte-coordinate restore should make it invisible but it runs while the pane's width changes,
so it must wait for the width-change relayout (`ResizeObserver` debounce, `app.ts:741-760` today) or
hold the anchor until the pass lands. Report if a one-frame flicker is observable.

---

### D-06 — Move focus between panes by key and click, and bind selection to the focused pane

**Model:** opus · **Size:** L · **Depends on:** D-01 · **Parallel with:** D-04, D-05, D-08

**Outcome.** One pane is focused at a time. `Mod+1` and `Mod+2` focus the left and right pane;
`Mod+Alt+Left` and `Mod+Alt+Right` do the same; a click in a pane, or a scroll gesture after a pause,
focuses it. Focus is shown by the window title naming the focused document and by D-04's fade, never by
dimming. Selection, copy and operations act on the focused pane's document; focusing the other pane
clears the selection. Overlays (palette, outline, find) bind to the pane that was focused when they
opened, and `Esc` returns focus there. The same keys work while a Source editor has focus.

**Why now.** `07` §4.3 and §6.7 ("selection and operations are singletons": `selection/view.ts:75-85`).
Every later story asks "which pane?", and the answer is `panes.focused`.

**Paths.**
- New: `apps/desktop/src/pane/focus.ts`, `apps/desktop/src/pane/keys.ts`, `apps/desktop/src/commands/pane-focus.ts`,
  `apps/desktop/test/pane-focus.test.mjs`.
- Edit: `apps/desktop/src/selection/view.ts` (`installRenderedSelection` and the module state at `:75-85`),
  `apps/desktop/src/selection/bind.ts` (`buildAppContext`, `:41-56`), `apps/desktop/src/commands/index.ts`
  (one line for `paneFocusCommands()`; `PaneSet.focus` itself is D-01's), `docs/design/09-app-shell.md` (keyboard map rows
  for the focus keys and, anticipating D-07 and D-08, the five pane chords in one table; the other two
  stories only fill in their behaviour).

**Build order.**
1. `focus.ts`: `focusRules(panes, main)`: `pointerdown` (capture) on a pane focuses it; `wheel` focuses
   the pane under the pointer if no wheel event happened in the last 150 ms (`FOCUS_ON_WHEEL = true`, one
   constant, so the author can veto it); `PaneSet.focus` is the only place `data-marxy-focus` is set.
2. `pane/keys.ts`: **one table of every pane chord** and one `window` capture-phase `keydown` listener.
   Chords match on physical keys (`event.code`), because `Mod+Shift+\` arrives as `event.key === '|'` on a
   US layout and `keyMatches` (`selection/bind.ts:26-37`) compares `event.key`:
   `Mod+Backslash` to `view.open-beside`, `Mod+Shift+Backslash` to `view.close-pane`, `Mod+Digit1` to
   `view.focus-left`, `Mod+Digit2` to `view.focus-right`, `Mod+Alt+ArrowLeft` / `Mod+Alt+ArrowRight` to
   the same two. `Mod` is Command on macOS, Ctrl elsewhere (`isMac()`, `selection/bind.ts:22`). The
   listener looks the command up by id in the registry, skips it if the command is not registered yet
   (D-07 and D-08 register theirs), calls `preventDefault()` and `stopPropagation()` (so the registry's
   own bubble-phase dispatcher, `installCommandKeys`, `selection/bind.ts:66-95`, does not run it a second
   time) and runs it. It deliberately does **not** skip editable targets: the registry dispatcher does
   (`inEditable`, `:58-63`), and a pane key must work from a CodeMirror editor. It does skip when a
   `dialog[open]` owns the event, except `Mod+Backslash`. It does not match `Alt+Arrow` without `Mod`
   (that is history, `palette/keys.ts:19-34`).
3. `commands/pane-focus.ts`: `view.focus-left` ("Focus left pane", key `Mod+1`), `view.focus-right`
   ("Focus right pane", key `Mod+2`), with `when` true only when the target pane exists. The `key` field
   documents the chord for the palette; the dispatch is step 2's.
4. Selection: `selection/view.ts` keeps module state for one article (`ctx`, `state`, `installedOn`,
   `lastClickTarget`, `pointerDrag`, `navHistory`/`navIndex`, `pendingFragment`). Attach the listeners
   once **per pane article** (delegated, so a re-render does not reattach), keep **one** selection
   state, and on `PaneSet` `focus` events call `selectNone()` and re-point `ctx` (buffer, ast, node map,
   shell) at the newly focused pane's store snapshot. A click in the unfocused pane focuses it and then
   selects (the focus change comes first, so the clear does not eat the click). `navHistory` stays global
   here; D-09 makes it per pane.
5. `buildAppContext()` reads the focused pane's selection context; `Mod+C`, `Mod+Z`, `Mod+S` and the
   operations therefore act on the focused pane. (Per-store undo and save wiring is D-08's; this story
   only guarantees `buildAppContext()` is the focused pane's.)
6. Overlay origin: the palette (`palette/view.ts` `open()`), the outline and find record `panes.focused`
   when they open. On `Esc` or dismissal focus returns to that pane's host (`docs/design/09-app-shell.md`
   keyboard-completeness: "every open dialog returns focus to the article on `Esc`"). This story adds
   `PaneSet.focusOrigin(): { restore(): void }`; D-07 and D-13 call it. Do not edit `palette/view.ts`
   here (D-07 owns it); the helper is tested directly.
7. A Source pane: `PaneSet.focus` also focuses the editor (`editor.view.focus()`) so `Mod+F` and typing go
   to the right pane. (D-11 owns per-pane editors; until then this applies to slot 0's editor.)

**Acceptance.**
- With two panes, dispatching `Mod+2` focuses the right pane: exactly one pane has `data-marxy-focus`,
  `document.activeElement` is within it, and `handle.currentPath()` is its path; `Mod+1` returns
  (`apps/desktop/test/pane-focus.test.mjs`).
- `Mod+Alt+ArrowRight` and `Mod+Alt+ArrowLeft` do the same, and `Alt+ArrowLeft` alone still goes back
  (`pane-focus.test.mjs`; `src/palette/keys.test.ts` stays green).
- A pointer click inside the unfocused pane's text focuses it and selects the block under the click
  (`pane-focus.test.mjs`); the first wheel gesture over the other pane after 150 ms of stillness focuses it.
- Selecting a block in the left pane, then focusing the right pane, leaves no `.marxy-selected` in either
  (`pane-focus.test.mjs`); `Mod+C` with a node selection in the right pane copies the right pane's text
  (assert via the memory shell's clipboard call).
- A `Mod+2` keydown dispatched on a CodeMirror `.cm-content` (with the left pane in Source) still moves
  focus (`pane-focus.test.mjs`).
- A `Mod+2` chord runs once, not twice (count `view.focus-right` runs through a spy command).
- Two panes of two different files, each edited (a task ticked in each): `Mod+Z` with the right pane
  focused undoes the right file's edit only, and `Mod+Z` after `Mod+1` undoes the left's
  (`pane-focus.test.mjs`; the history belongs to the store, Phase B, and this story only proves `Mod+Z` reaches
  the focused pane's).
- Single-pane behaviour: `apps/desktop/test/selection.test.mjs`, `operations-copy.test.mjs`,
  `operations-edit.test.mjs` pass unchanged.

**Tests.** Stay green: the three selection and operation suites above, `src/palette/keys.test.ts`,
`src/menu/menu-commands.test.ts`. New: `test/pane-focus.test.mjs`. Gates: `pnpm precheck`.

**Do not.** Bind `Mod+W` (the native menu's Close Window quits the process, `main.rs:614-616`). Add focus
chrome (a ring, a border, a dim). Make the registry dispatcher (`installCommandKeys`) skip editables.
Edit `palette/view.ts`, `close.ts`, `save.ts`, `title.ts` (D-07, D-08). Add single-letter bindings
(`docs/design/09-app-shell.md`: none in v1).

**Risks and open questions.** Focus-on-wheel is the likeliest thing the author vetoes (it changes the
window title and clears selection while someone is only scrolling to peek); it is one constant. The
selection rebind is the invasive part: if Phase B left more per-document state in `selection/view.ts` than
listed, report it. On non-US keyboard layouts `Backslash` may be hard to reach; the palette lists every
command (P8), which is the fallback.

---

### D-07 — Open beside from the palette, split with recent, and refuse a second pane that cannot fit

**Model:** sonnet · **Size:** M · **Depends on:** D-01, D-02, D-05, D-06, D-08 · **Parallel with:** D-11, D-13

**Outcome.** `Mod+\` opens the palette in "beside" mode: its empty list is the recent documents (those not
already on screen), and Enter opens the first in the other column, creating it if absent. That is "split
with recent" in two keystrokes. `Mod+Enter` on any palette row opens that row beside. Typing finds
anything the palette finds. When the window is narrower than two columns at the typography floor
(929 px at the default text size) the second pane is not created: a notice says why.

**Why now.** `07` §4.2: the palette is already the document manager (ADR-0011) and the MRU stack already
exists; Phase C's hand-off seam `openHit(hit, { target })` (`06` §5.3) is waiting for the `'split'` half.

**Paths.**
- New: `apps/desktop/src/pane/fit.ts`, `apps/desktop/src/commands/pane-open.ts`,
  `apps/desktop/test/open-beside.test.mjs`.
- Edit: `apps/desktop/src/palette/view.ts` (`activateHit` `:391` / `openHit` under P10, `open()`, the
  `scroller` captured at mount `:515`, the notice line, the `Mod+Enter` handler near `:445-475`),
  `apps/desktop/src/palette/session.ts` only to add a pure `recentExcluding(session, paths)` helper (and
  its test in `apps/desktop/src/palette/session.test.ts`), `apps/desktop/src/commands/index.ts` (one line),
  the composition root's `open` (`AppHandle.open(path, { at, target })`), `docs/design/09-app-shell.md`
  (keyboard map and the "Open beside" paragraph), `docs/design/07-index-and-palette.md` (one paragraph).

**Build order.**
1. `pane/fit.ts`: `readSplitMetrics(): SplitMetrics` (root computed `--marxy-avg-char`,
   `--marxy-size-body`, the 24 px gutter) and `canShowTwoColumns(main: HTMLElement): boolean` calling
   D-02's `fitsTwoColumns(main.clientWidth, readSplitMetrics())`. Set `PaneSet.canSplit` to it in the
   composition root. Notice text: "Marxy needs a window at least 929 px wide to show two documents side by
   side." with the number from `Math.floor(minSplitWidth(...))`, not typed.
2. `palette/view.ts`: `open(opts?: { target?: 'here' | 'split' })`. In `'split'` mode the palette shows
   the empty-state as one section, Recent, from `recentExcluding(session, visiblePaths)`, with row 0
   selected; the existing notice line (`.marxy-palette-notice`) says "Open beside". `Enter` calls
   `openHit(hit, { target: 'split' })`; `Mod+Enter` (the `isMod` helper, `:63`) on any row in either
   mode does too. In `'here'` mode nothing changes. `openHit(hit, { target: 'split' })` calls
   `AppHandle.open(path, { at, target: 'other' })`, which calls `panes.openIn('other', …)`; if it
   resolves `null` because of `canSplit`, leave the palette open and show the fit notice in its notice
   line so `Enter` can still open the document here (the reader loses nothing).
3. Replace the palette's captured `scroller = document.documentElement` (`:515`) with a getter that
   returns the focused pane's scroller (D-05's `view.scroller`).
4. `commands/pane-open.ts`: `view.open-beside` ("Open beside…", key `Mod+\`): when one pane and
   `!canShowTwoColumns`, show the fit notice (`notify`) and do not open the palette; otherwise
   `palette.open({ target: 'split' })`. `D-06`'s `pane/keys.ts` already routes the chord here.
5. `PaletteController` gains nothing else. Record `focusOrigin()` (D-06) on open and restore on dismiss.
6. Tests drive `handle.commands()` and the palette input through the existing harness
   (`apps/desktop/test/palette.test.mjs` shows the boot).

**Acceptance.**
- Window 1,470 px, one document open and two more in the MRU: `Mod+\`, then Enter, creates a second pane
  showing the most recent other document; the first pane's document and position are untouched
  (`apps/desktop/test/open-beside.test.mjs`).
- `Mod+\` with two panes open and Enter replaces the **other** pane's document and leaves the focused
  one (`open-beside.test.mjs`).
- `Mod+Enter` on the third row of a typed result opens that file beside (`open-beside.test.mjs`).
- Window 900 px, one document: `Mod+\` shows the fit notice naming 929 px and opens no palette and no
  second pane; window 929 px: the split opens (`open-beside.test.mjs`, `page.setViewportSize`).
- Beside mode with an empty query never lists the document shown in the focused pane
  (`src/palette/session.test.ts`: `recentExcluding`).
- Plain `Mod+P` and Enter still open here, `activateHit`'s old behaviour: `apps/desktop/test/palette.test.mjs`,
  `palette-index.test.mjs`, `palette-input-guards.test.mjs`, `src/palette/view.test.ts` pass unchanged.
- ADR-0011's reversal criterion is not touched: `TAB_BAR_DOM_MUTATION` checks (`palette/view.ts:26`) still
  find no tab strip.

**Tests.** Stay green: `src/palette/*.test.ts`, `test/palette*.test.mjs`, the keyboard-completeness test
if Phase A added one. New: `test/open-beside.test.mjs`, the `recentExcluding` case. Gates: `pnpm precheck`.

**Do not.** Add a menu item or a button (ADR-0011: nothing at rest). Build "Split this document" (D-10).
Resolve ranking or collection scope (Phase C owns everything up to `openHit`). Add a third pane. Replace a
dirty document without `beforeReplace` (D-08 sets it; this story must not bypass `PaneSet.openIn`).

**Risks and open questions.** In beside mode Phase C's empty state has more sections than Recent; this story
shows Recent only, so Enter on an empty query means "the most recent other document". Say so in the PR if
Phase C's layout makes that awkward. `Mod+Enter` may already be bound inside the palette (`:445-475`); if
so, report and choose the next free chord rather than overloading it.

---

### D-08 — Close a pane, and make save, the title and quit know about two documents

**Model:** opus · **Size:** M · **Depends on:** D-01 · **Parallel with:** D-04, D-05, D-06

**Outcome.** `Mod+Shift+\` closes the focused pane and the survivor takes the whole window. A document with
unsaved changes is never lost by closing or replacing its pane: a notice names the file and offers save,
discard or dismiss, as it does today for one document. `Mod+S` saves the focused pane's document, the
window title names the focused document (with the dirty dot for that document), and quitting with two
dirty documents asks about each in turn, naming it.

**Why now.** `07` §6.7: "close and quit with two dirty documents: the guard asks about each dirty store in
turn" (`apps/desktop/src/close.ts:21-24`, one notice, one document); edits live in memory until an
explicit save, so a pane that is closed or replaced is the one place two-document edits can be dropped.

**Paths.**
- New: `apps/desktop/src/commands/pane-close.ts`, `apps/desktop/test/pane-close-guard.test.mjs`.
- Edit: `apps/desktop/src/close.ts` (`CloseGuardHost`, `installCloseGuard` `:28`, `confirmLeaveDocument`
  `:56`, `showPrompt` `:62`), `apps/desktop/src/save.ts` (`SaveHost`, `save()` `:77`: take an optional
  store/path; default the focused one), `apps/desktop/src/title.ts` (`updateTitle`), the composition root
  where the guard, save host and title are installed (`app.ts:1380-1395` today), which also assigns
  `panes.beforeReplace` (D-01 defined the hook; `pane-set.ts` is not edited), `apps/desktop/src/commands/index.ts`
  (one line), `docs/design/09-app-shell.md` (Window title; Close).

**Build order.**
1. `CloseGuardHost` becomes store-aware: `dirtyDocuments(): { path: string; name: string; pane: Pane | null }[]`
   in slot order, replacing the single `isDirty()`/`documentName()`. `confirmLeaveDocument(path, proceed)`
   asks only about **that** store, and only when no other pane also shows it (a document shown in two
   panes is not lost by closing one view).
2. `showPrompt` puts its notice in the **pane that shows the dirty document**
   (`ensureNoticesRegion(pane)`, D-01) and names it: "<name> has changes that are not saved."
   Save calls `save({ store })` for that store, not the focused one. After a save that races new edits,
   ask again (the existing loop, `close.ts:85-91`).
3. Quit/close-window with several dirty documents: `installCloseGuard`'s handler walks
   `dirtyDocuments()`; each answer proceeds to the next; "close without saving" on one still asks about
   the rest; any "Dismiss" stops the quit. The existing second-close-request-quits behaviour
   (`close.ts:36-41`) stays for the last prompt only.
4. `PaneSet.beforeReplace = (pane) => confirm(pane's document)`; `PaneSet.close` uses the same hook. It
   resolves true when the document is clean, shown elsewhere, or the reader chose save or discard.
5. `commands/pane-close.ts`: `view.close-pane` ("Close this pane", key `Mod+Shift+\`, `when`: two panes);
   `run` calls `panes.close(panes.focused)`. The `Mod+W` row of the keyboard table is **unchanged**.
6. `title.ts`: `updateTitle(shell, focusedPath, focusedDirty)`; call it on every `focus` event and on
   each dirty change of the focused store. The title stays the only persistent indicator
   (`docs/design/09-app-shell.md` §Window title).
7. `save.ts`: `save(opts?: { as?: boolean; store?: DocumentStore })` and `SaveHost.getOpenBuffer()` reads the
   focused pane's store (or the one passed).

**Acceptance.**
- Close the right pane (clean): one pane remains, `#doc` is its article, the left pane's reading position is
  unchanged (`apps/desktop/test/pane-close-guard.test.mjs`).
- Edit a task in the right pane (dirty), `Mod+Shift+\`: the right pane stays, a notice **in the right pane**
  names the file; choosing "Close without saving" closes it and the survivor's bytes on disk are
  untouched; choosing "Save and close" writes that file's bytes and closes it (`pane-close-guard.test.mjs`).
- Open a third document beside a dirty one (`openIn('other', …)`): the same notice appears and nothing is
  replaced until the reader answers (`pane-close-guard.test.mjs`).
- Same file in both panes, dirty: closing one pane closes without a prompt (the store is still shown);
  closing the second prompts (`pane-close-guard.test.mjs`; needs D-10's same-file path or a store opened
  twice through `panes.openIn`).
- Two dirty documents, a close-requested event: the first prompt names the left file; after "Close without
  saving" the second names the right; "Dismiss" on either stops the quit (`confirmClose` not called)
  (`pane-close-guard.test.mjs`; `apps/desktop/test/close-guard.test.mjs` stays green).
- `Mod+S` with the right pane focused writes the right file only (assert the memory shell's
  `writeFileAtomic` calls); the window title is `<right name> — marxy •` while it is dirty and not
  dirty-marked once saved (`pane-close-guard.test.mjs`, `src/title` expectations in
  `apps/desktop/test/save.test.mjs` unchanged for one pane).
- `apps/desktop/test/save-close-r5.test.mjs`, `save-trust-r4.test.mjs`, `explicit-save.test.mjs`,
  `data-loss.test.mjs` pass unchanged.

**Tests.** Stay green: the five save/close suites above. New: `test/pane-close-guard.test.mjs`. Gates:
`pnpm precheck`.

**Do not.** Autosave. Add a modal dialog (the guard is a notice, `docs/design/01-buffer.md`). Change `Mod+W`.
Add a dirty indicator anywhere but the title. Touch the undo history's storage (Phase B moved it to the
store; this story only reads `store.dirty`).

**Risks and open questions.** Whether the window title should show a dirty dot when the **unfocused**
document is dirty is the author's call; this story follows `07` §4.4 (focused document only) and relies on
the quit guard for the other. If P1's store has no `dirty`, derive it the way `commands/edits.ts`
(`documentIsDirty`) does today and report.

---

**From the D-01 review (2026-10-08).** D-01 asks the unsaved-edits guard only when the pane being replaced is dirty,
but `confirmLeaveDocument` still reads the focused pane. Three ways to lose edits, unreachable from any UI until
D-07: `openIn(1, …)` into a dirty pane while the focused one is clean replaces it without asking; with both panes
dirty the prompt names and saves only the focused document; `close()` of a dirty pane discards without asking. This
story makes the guard per pane and tests all three.

**From the D-01 re-review (2026-10-08).** A refused close (`close()` returning `false` when the fold leaves text
behind, or when the right pane is empty) shows nothing today; this story's close command must say so in the pane.
D-01 added `ownsTitle` and a focus listener in `pane/index.ts` that re-titles the window: replace that listener with
`updateTitle` and the dirty dot here, so there is one title writer. `09-app-shell.md` §State lists the close guard's
prompt as bound to the first pane, but `app.ts` binds it to the focused pane; this story fixes the doc with the code.

### D-09 — Follow a link into the neighbour pane

**Model:** sonnet · **Size:** M · **Depends on:** D-06, D-07, D-08 · **Parallel with:** D-10, D-12

**Outcome.** Cmd-click (Ctrl-click on Linux) on a relative link to another document opens it in the
neighbouring pane, creating the second pane if there is none, while the pane the reader is in keeps its
place and its focus. A README's link to a source file opens the file in Source in the neighbour. A plain
click is unchanged: it replaces the document in its own pane. Back (`Mod+[`) walks the history of the
pane it is pressed in.

**Why now.** The screen criterion: "a link clicked in one lands in the other" (`14-roadmap-proposal.md`,
Phase D). `07` §3 "What to borrow" names Obsidian's open-in-the-other-pane as the pattern that matches the
stated use, with `Cmd+click` as the convention; `07` §4.2 binds it.

**Paths.**
- Edit: `apps/desktop/src/selection/view.ts` (`followLink` `:128-186`, `recordNavOpen` `:100-106`,
  `installLinkHistoryKeys` `:108-123`, `scrollToFragment` `:89-98`, the module state `navHistory`,
  `navIndex`, `pendingFragment` `:82-85`).
- New: `apps/desktop/test/link-beside.test.mjs`.
- Edit: `docs/design/09-app-shell.md` (a paragraph under Navigation: "Open a link beside").

**Build order.**
1. Per-pane link history: move `navHistory`/`navIndex`/`pendingFragment` from module scope to the pane
   (`WeakMap<Pane, { history: string[]; index: number; pendingFragment?: string }>`). `recordNavOpen(pane,
   nextPath)` starts from **that pane's** current path (today it reads `appHandle?.currentPath()`, which is
   the focused pane's). `installLinkHistoryKeys` handles back for the focused pane.
2. `followLink(anchor, ev)` computes `beside = isMac() ? ev.metaKey : ev.ctrlKey` (use the existing
   `isMac()` pattern, `selection/bind.ts:22`) and the origin pane from `anchor.closest('.marxy-pane')`.
   Fragment-only links (`#x`) ignore `beside` and scroll **the pane the link is in** (`scrollToFragment`
   uses `pane.view.scroller`, not `document.documentElement`, `:94`). External links ignore it.
3. When `beside` and the target passes the existing checks (inside the image root, readable): call
   `appHandle.open(target, { target: 'other', focus: 'stay' })` through `panes.openIn('other', …)`
   (D-07's `AppHandle.open` option; if it lacks `focus: 'stay'`, add it as a small edit there: the
   default for palette opens stays "move focus to the opened pane" where today's behaviour is "the
   document replaces this one"; for link-beside the **origin pane keeps focus**). The neighbour's history
   starts with the target. When the window is too narrow (`canSplit` false) show D-07's fit notice and open
   nothing.
4. Source files beside only: today `MARKDOWN_LINK` (`:87`) refuses everything else with "Only markdown
   documents open inside Marxy." (`:167-169`). With `beside`, accept a target whose
   `defaultModeForPath(target) === 'source'` (`apps/desktop/src/source/default-mode.ts`) **and** whose first
   8 KB contain no NUL byte (read through `ctx.shell.readFile`); otherwise show "That file is not text."
   A plain click keeps the old refusal (see open questions). The pane opens in Source (D-11's default
   per path).
5. Plain click on a Markdown link: unchanged (`recordNavOpen`, `appHandle.open(target)` replacing the
   **origin** pane's document, then scroll to its fragment). Make the replaced pane the origin pane, not
   merely the focused one (they are the same after D-06's pointerdown focus, but test it).

**Acceptance.**
- Two panes (plan left, README right): Cmd-click a relative link in the left pane to `result.md`: the right
  pane now shows `result.md`, the left still shows the plan at the same `byteOffset`, and the left pane
  remains focused (`apps/desktop/test/link-beside.test.mjs`).
- One pane: the same Cmd-click creates the second pane showing the target (window 1,470 px); at 900 px it
  shows the fit notice and opens nothing (`link-beside.test.mjs`).
- A plain click replaces the left pane's document and leaves the right untouched; `Mod+[` in the left pane
  returns to the plan and does not move the right pane (`link-beside.test.mjs`;
  `apps/desktop/test/links.test.mjs`, `link-host.test.mjs` pass unchanged).
- Cmd-click on `[src](./src/lib.rs)` opens `lib.rs` beside in Source mode (`data-marxy-mode="source"` on that
  pane); a link to `./logo.png` shows "That file is not text." (`link-beside.test.mjs`).
- Cmd-click on `#heading` scrolls the pane it is in (`link-beside.test.mjs`).
- Cmd-click on an `https:` link still goes to `shell.openExternal` and creates no pane
  (`link-beside.test.mjs`).

**Tests.** Stay green: `test/links.test.mjs`, `test/link-host.test.mjs`, `test/selection.test.mjs`,
`test/open-path.test.mjs`. New: `test/link-beside.test.mjs`. Gates: `pnpm precheck`.

**Do not.** Change what a plain click does. Open anything outside the image root (the existing refusal at
`:156-159` applies to `beside` too). Open binary files. Add a "open link in…" menu (the verb menu is Phase C's
and is not extended here). Edit `palette/view.ts`.

**Risks and open questions.** Whether a plain click in a two-pane layout should open the link in the neighbour
(the "reference pane" model) rather than replace is the author's call; the study and this plan keep plain
click as replace. Whether a link to a source file may open at all (today refused for every click) is also
the author's; this story allows it beside only, which is what the README-beside-source criterion needs.

---

### D-10 — Show the same file twice, share one store and one watch, and keep notices in their own pane

**Model:** opus · **Size:** L · **Depends on:** D-01, D-05, D-07 · **Parallel with:** D-09, D-12

**Outcome.** The palette command "Split this document" opens the document again in the other pane, at the
reading position of the first, and the two views move independently from there. Both views are over one
store: an edit, an undo, a task tick or an external change shows in both within a frame, and each view
keeps its own place (the other view's reading anchor shifts by the edit's delta). The file is parsed once
and watched once. A notice about a file (removed, changed on disk, blocked content, save failed) appears
only in the pane that shows it.

**Why now.** `07` §4.2: "two positions in one long document is a strong reading use (a spec's constraints
against its examples)", and the reason ADR-0037 must keep `mode` and `anchor` out of the store (`07` §2.3).
Phase D also owes `07` §6.6 story 7: per-pane live reload and notices, and the watcher claim in the task.

**Paths.**
- New: `apps/desktop/src/commands/pane-split-same.ts`, `apps/desktop/test/split-same-file.test.mjs`,
  `apps/desktop/test/split-watch.test.mjs`.
- Edit: `apps/desktop/src/notices/index.ts` (`notify`, `ensureNoticesRegion`, `dismissNotice`),
  `apps/desktop/src/notices/disk.ts`, `apps/desktop/src/notices/blocked.ts`, `apps/desktop/src/notices/trust-copy.ts`
  and `apps/desktop/src/notices/truncation.ts` only at their `notify` call sites; the store's watch
  registration and the view's reload handling (`apps/desktop/src/document/store.ts` and
  `apps/desktop/src/view/rendered-view.ts` under P1/P2; today `registerDocumentWatch` `app.ts:892`,
  `handleDocumentWatch` `:823`); `apps/desktop/src/commands/index.ts` (one line);
  `docs/design/08-position-and-watching.md` (a paragraph on two views over one store).

**Build order.**
1. `commands/pane-split-same.ts`: `view.split-same` ("Split this document", no key; `when`: one pane with a
   document and `canShowTwoColumns`) runs
   `panes.openIn('other', focused.path(), { at: focused.view.currentByteOffset() })`. Because `openStore(path)`
   returns the existing instance (P1), the new view is a second subscriber, not a second parse.
2. Confirm the fan-out: `store.apply(...)` / a reload bumps `version`; **every** view subscribed re-renders
   through the path a single view uses and maps its own anchor through the edit with `offsetThroughEdit`
   (`packages/core/src/position/restore.ts`; the mapping is ADR-0037 clause 6). If P1/P2 already do this,
   this step is the test only.
3. One watch per store: the store opens `shell.watch(dirname(path), …)` when its first view attaches and
   closes it when the last view releases; a second view of the same path never calls `shell.watch`. Two
   **different** files in one directory make two `shell.watch` calls in TypeScript but share one native
   thread (`apps/desktop/src-tauri/src/main.rs:305-323` `watch_root` keeps `refs` per canonical root). Each
   store's handler ignores events for other paths in its directory (the `fs-watch` listener filters by
   root only, `apps/desktop/src/shell/tauri.ts:150-153`).
4. Notices per pane: `notify(input, { pane })` appends to `ensureNoticesRegion(pane)` (D-01 added the
   optional argument); with no pane the focused one. The one-per-kind-and-text dedupe (`notices/index.ts:32-39`)
   becomes per pane. Callers about a file pass the pane that shows it (look the pane up by store); callers
   about the app (theme warning, index truncated) use the focused pane. Opening a document clears the
   notices of the pane it opens in, not every pane.
5. Reload per view: a `Modified` event for a path shown in either or both panes reloads the store once and
   each view re-renders at its own position; `Removed` shows the "file removed" notice in each pane that
   shows the file and nowhere else (`notices/disk.ts`).
6. Parse once: expose a parse counter through the existing mark mechanism (`rendered`, `parsed` are marks
   already; `scripts/registry.json`) or count `parseMarkdown` calls in the test with a harness hook, and
   assert one parse for two views.

**Acceptance.**
- Split this document at byte offset X; scroll the right pane to the end: the left pane's reading position
  does not change (`handle.sourceHarness()` for each pane) (`apps/desktop/test/split-same-file.test.mjs`).
- Tick a task checkbox in the left pane: the right pane's article shows the same task checked after two
  animation frames and its reading position shifts by the edit's delta, not to the top
  (`split-same-file.test.mjs`); `Mod+Z` in either pane undoes it in both.
- Two views of one file produce exactly one `parsed` mark and
  `handle.panes().panes[0].view.store === handle.panes().panes[1].view.store` (identity)
  (`split-same-file.test.mjs`).
- Memory shell `calls` filtered to `watch` has length 1 with the file open twice; closing one pane leaves it
  open (`watchCloses` empty); closing the last closes it (`apps/desktop/test/split-watch.test.mjs`, the
  wrapper pattern of `test/live-reload.test.mjs:75-85`).
- Two different files in one directory: `shell.emit([{ kind: 'modified', path: right }])` reloads the right
  pane and does not re-read the left file (`split-watch.test.mjs`).
- `emit` a `removed` event for the left file: the notice appears in the left pane's region and the right
  region stays empty (`split-watch.test.mjs`).
- `apps/desktop/test/live-reload.test.mjs`, `data-loss.test.mjs`, `trust.test.mjs`, `images.test.mjs` pass
  unchanged.

**Tests.** Stay green: the four suites above, `test/tauri-stale-write.test.mjs`. New: the two files. Gates:
`pnpm precheck`; `cd apps/desktop/src-tauri && cargo test` is unaffected (no Rust change) but run
`pnpm lint:rust` only if you touch Rust, which you should not.

**Do not.** Change `shell-api` or any Rust file. Make a second store for the same canonical path (the stale-write
guard, `shell.recordRead`, is per path and two buffers for one file is the hazard of multiple windows,
`07` §2.2 row 9). Persist the second view's position (D-12 decides). Link the two scrollers. Add a mode to the
store.

**Risks and open questions.** If Phase B's views do not re-render on a store `version` change (for example
`commitEdit` re-renders only the one view that made it), this story is larger than L; report instead of
reimplementing the store. Canonical-path keying: `/r/A.md` and a symlink to it must resolve to one store
(use whatever canonicalisation `openStore` has; the Rust side canonicalises roots, `main.rs:268`).

---

### D-11 — Let each pane be Rendered or Source

**Model:** opus · **Size:** M · **Depends on:** D-01, D-05, D-06 · **Parallel with:** D-07, D-13

**Outcome.** Each pane has its own mode. `Mod+E` toggles the focused pane only, so a README can sit Rendered
beside the source file it documents, or the same file can sit Rendered on the left and Source on the right.
Source is a CodeMirror inside its pane, with its own scroll and cursor. A non-Markdown file opens in Source
by default, per the existing rule. Typing in a Source pane reaches the neighbouring view of the same file as
soon as focus moves away from it.

**Why now.** `07` §4.5 and §2.2 rows 5 and 6: mode is a `<body>` attribute and Source is a fixed overlay
covering the whole window; "Rendered on the left and Source of the same file on the right is the one workflow
where 'reader but adept at both' meets the split."

**Paths.**
- Edit: `apps/desktop/src/source/editor.ts` (`sharedParent`/`sharedEditor` `:35-36`, `activeSourceEditor`
  `:44`, `createSourceEditor` `:49-77`), `AppHandle.jumpToSource` (F-03 deleted `mode-open.ts`; the app's
  `showSource` is the one Source entry), `apps/desktop/src/source/tab-width.ts` (`:28`),
  `apps/desktop/src/commands/source-view.ts` (`view.toggle-line-numbers`, `:38-55`), the view's mode
  handling (`apps/desktop/src/view/rendered-view.ts`; today `app.ts:201-262` `sourceMount`,
  `setModeChrome`, `showSource`, `showRendered`, and `:314-321` `installKeyDispatcher`, the `Mod+E`
  handler, unless Phase A moved it into the registry),
  `apps/desktop/src/source/mode-switch.ts` only if it reads `document.body`.
- New: `apps/desktop/test/pane-mode.test.mjs`.
- Docs: `docs/design/09-app-shell.md` (Source mode section: "in the pane"), `docs/adr/0005-two-modes.md` only if
  D-01 did not already add "the focused pane".

**Build order.**
1. `source/editor.ts`: replace the singleton pair with `Map<HTMLElement, SourceEditor>` keyed by the mount
   element. `createSourceEditor({ parent })` returns the existing editor for that parent
   (`replaceBuffer`, as today) or creates one; `destroy()` removes its map entry. `activeSourceEditor()` keeps
   its signature and returns the focused pane's editor through a resolver the composition root sets
   (`setActiveSourceEditorResolver`). The two `Compartment`s (`:33-34`) may be shared by every editor (a
   compartment is a token, each `EditorView` has its own state).
2. Per-pane mode: the pane section carries `data-marxy-mode` (registered already); the view's `mode` drives
   it. **`document.body.dataset.marxyMode` keeps mirroring the focused pane's mode**, so existing CSS and
   the 54-file tail of tests that read it (`commands/source-view.ts:42`, `test/source-mode-shell.test.mjs`)
   keep working; document the mirror in a comment.
3. `Mod+E` (`toggleViewMode`) acts on `panes.focused.view`. The busy flag `modeToggleBusy` (`app.ts:191`) is
   per view.
4. `jumpToSource(byteOffset)` (palette jump-to-source) acts on the focused pane's view: its mount, `article`
   and a reading line from that pane's `clientHeight`, not `window.innerHeight`. Never a second path that
   shows the editor without the view's mode state (F-03).
   `tab-width.ts:28` resolves the editor through `activeSourceEditor()` instead of
   `#marxy-source .cm-editor`. `view.toggle-line-numbers` uses the focused pane's mount.
5. Default mode when a pane opens a document: `defaultModeForPath(path)` (`source/default-mode.ts:15`), then the
   stored mode from `positions.json` if D-12 supplies one.
6. Fold on blur: when focus leaves a Source pane whose editor text differs from its store's buffer, call the
   existing fold (`source/buffer-commit.ts`, "edit in Source", one history entry) so another view of the
   same store re-renders. A Source pane that is the only view of its store folds only on leaving Source, as today.
7. CSS: D-01 already made the Source mount in-pane in split state; do not edit `index.html` here.

**Acceptance.**
- Two panes of different files: `Mod+E` with the right pane focused makes only the right pane's
  `data-marxy-mode` `source`; the left pane's `scrollTop` and article are untouched; `body.dataset.marxyMode`
  is `source` while the right pane is focused and `rendered` after `Mod+1` (`apps/desktop/test/pane-mode.test.mjs`).
- The right pane's Source mount is `position: absolute` and inside its pane, not `fixed`
  (`getComputedStyle`), and its `.cm-editor` is a descendant of `[data-marxy-pane="1"]`
  (`pane-mode.test.mjs`).
- Opening `lib.rs` beside a README: it is in Source with no `Mod+E` (`pane-mode.test.mjs`).
- Same file, Rendered left and Source right: type a character in the right editor, `Mod+1`: the left article
  shows it and `handle.sourceHarness().bufferHash` differs from before; undo restores both
  (`pane-mode.test.mjs`).
- Source round trip without edits leaves the buffer fingerprint identical in either pane
  (`sourceHarness().bufferHash`; `test/source-mode-shell.test.mjs` unchanged).
- `test/source-gutter.test.mjs`, `source-browser.test.mjs`, `tab-width.test.mjs`, `jump-to-source.test.mjs`,
  `src/source/*.test.mjs` pass unchanged; `gate:fidelity` unaffected.

**Tests.** Stay green: the Source suites above and `test/save.test.mjs`. New: `test/pane-mode.test.mjs`.
Gates: `pnpm precheck`, `pnpm gate:bundle` (CodeMirror must stay a lazy chunk, `src/source/startup-deferral.test.mjs`).

**Do not.** Import CodeMirror eagerly (MARXY-33: it stays off the start-up path). Change the buffer or
fidelity logic in `source/buffer-commit.ts`. Make Source edit-in-place per block (Phase E, ADR-0048). Add a
mode indicator to the pane.

**Risks and open questions.** "Fold on blur" changes when a Source edit reaches the neighbouring view
(not per keystroke); if the author wants live mirroring, that needs the store to accept CodeMirror
transactions, which is Phase E's block editing and larger. A Source pane that is the only view of a dirty
store and is closed is covered by D-08.

---

### D-12 — Remember the layout and each pane's place, and restore them on launch

**Model:** sonnet · **Size:** M · **Depends on:** D-02, D-06, D-07, D-11 · **Parallel with:** D-09, D-10

**Outcome.** Quit with two documents side by side and relaunch: both are back, in the same modes, at the same
ratio, each at its own reading position, with the same pane focused. A file that is gone is left out with a
notice in its pane. A window too narrow for two columns restores one. Reading positions in `positions.json`
are written by the right pane when two panes show one file.

**Why now.** `07` §4.6 and §6.5: layout persists in `layout.json` next to `positions.json`, restored at launch
without a file argument; "the first pane showing that path writes the position, or the focused one if both
do" (`apps/desktop/src/app.ts:1014-1031` today writes the one position on scroll).

**Paths.**
- New: `packages/core/src/layout/persistence.ts`, `packages/core/src/layout/persistence.test.ts`,
  `apps/desktop/src/layout/restore.ts`, `apps/desktop/test/layout-restore.test.mjs`.
- Edit: `packages/core/src/layout/index.ts` (export), the composition root's persistence block
  (`ensurePersistenceLoaded` `app.ts:1044-1060`, `installScrollPersistence` `:1014`, `flushAllPersistence`
  `:1010`, `restorePersistedPositionIfNeeded` `:1062`) and its per-pane successors in the view,
  `apps/desktop/src/pane/index.ts` (one wiring line), `docs/design/11-config-and-storage.md` (`layout.json`
  entry), `docs/design/08-position-and-watching.md` (the writer rule).

**Build order.**
1. `LayoutPersistence` in core, a twin of `PositionPersistence`
   (`packages/core/src/position/persistence.ts`): `static open(io)` reads `<data>/layout.json` through the
   same `PositionPersistenceIo` shape, quarantines a corrupt file to `layout.json.bad` (D-02's `parseLayoutFile`),
   refuses to overwrite a file with a newer `version`, `note(envelope)` debounced by `POSITIONS_DEBOUNCE_MS`
   (500 ms), `flush()` atomic write. Its tests mirror `packages/core/src/position/persist.test.ts`.
2. Desktop wiring: on `PaneSet` `onChange` (open, close, focus, ratio) and on a pane's mode change, call
   `note({ version: 1, columns: panes.map(p => ({ path, mode })), ratio, focused })`. Flush with
   `flushAllPersistence()` on close, exactly where positions flush today.
3. `restore.ts`: after `first_text` (never before: cold start must not wait for a second document), when the
   launch has **no file argument**, read the layout; open column 0 into the first pane, then column 1 into a
   second if `canShowTwoColumns`; for each column `readFile` first and drop a missing one with a notice in its
   pane ("`<name>` is no longer there, so it was left out of the layout."). If only one column survives or the
   window is too narrow, show the **focused** column's document alone and keep `layout.json` untouched until
   the reader changes the layout. Apply `ratio` (clamped with D-02) and `focused`. Each pane's mode comes from
   its column; its reading position from `positions.json` through `positionForOpen(path, byteLength)`.
4. A launch **with** a file argument, and any later open from Finder or the Dock
   (`AppHandle.open`, the `onOpenFiles` callback, `app.ts:1337`): restore the saved layout, then open the
   argument into the **focused** pane (the same rule as a second launch: `07` §2.2 row 13), so a reader's parked
   reference survives. (If the author prefers "argument wins and layout is dropped", it is one branch in
   `restore.ts`.)
5. Writer rule for `positions.json`: `positionPersistence.note(path, pos)` is called only by the pane
   returned by `writerFor(path)`: the focused pane if it shows `path`, else the lowest slot that does. A second
   view of a file already shown starts at the first view's position (D-10) and is never written. Replace D-05's
   temporary `pane.slot === 0` rule.
6. Docs: `layout.json` is `{ version, columns: [{ path, mode }], ratio, focused }`, written with the same
   atomic-write and quarantine rules as `positions.json`; restored only as described; positions are per path.

**Acceptance.**
- `LayoutPersistence`: a write is debounced to one call after a burst; a corrupt file is quarantined and
  replaced by an empty layout; a file with `version: 2` is left on disk byte for byte
  (`packages/core/src/layout/persistence.test.ts`).
- Open A and B beside each other, B in Source at ratio 0.4 and focused, flush, start a fresh app on the same
  memory shell data: the two documents, modes, ratio and focus return and `first_text` was marked before
  `split_open` (`apps/desktop/test/layout-restore.test.mjs`).
- A deleted column is dropped with a notice in its pane; both deleted shows the normal empty state
  (`layout-restore.test.mjs`).
- Restoring at a 900 px viewport shows one pane (the focused column), shows no layout write for 1 s, and
  after widening and pressing `Mod+\` a layout write happens (`layout-restore.test.mjs`).
- Launch with a file argument and a saved two-column layout: the argument opens in the focused pane and the
  other pane is intact (`layout-restore.test.mjs`).
- Same file in both panes: scrolling the **second** pane writes no `positions.json` entry change; scrolling
  the focused pane does (`layout-restore.test.mjs`; `apps/desktop/test/persist-reading.test.mjs` unchanged).
- A one-document session writes `layout.json` with one column and restores one pane.

**Tests.** Stay green: `test/persist-reading.test.mjs`, `test/open-path.test.mjs`,
`packages/core/src/position/persist.test.ts`. New: the two files above. Gates: `pnpm precheck`,
`pnpm --filter @marxy/core test`.

**Do not.** Persist the second view's position of a same-file pair, scroll coordinates in pixels, or anything
about the palette. Write `layout.json` while the file has a newer version. Block `first_text` on the
layout read or the second document. Add a field to `positions.json` or change its version.

**Risks and open questions.** Which wins when the app is launched with a file while a layout exists is the
author's call (the study's two sentences disagree, `07` §4.6); this plan restores the layout and puts the
argument in the focused pane. If P3's `ensurePersistenceLoaded` moved, find its successor first.

---

### D-13 — Make Rendered find, and the outline, work on the focused pane

**Model:** opus · **Size:** L · **Depends on:** D-03, D-05, D-06 · **Parallel with:** D-07, D-11

**Outcome.** `Mod+F` in a Rendered pane opens a small find field at the top right of that pane, finds as you
type in that pane's text only, shows `3 of 41`, highlights matches, and lands the current match at 40 % of the
pane's height. `Enter` and `Shift+Enter` step, `Esc` closes and returns focus. In a Source pane `Mod+F` is
CodeMirror's own search, in that pane. `Mod+Shift+O` opens the outline of the focused pane, anchored to that
pane's right edge, and its current-heading mark follows that pane's scroll. Nothing here searches both
panes.

**Why now.** The roadmap says "find and outline bind to the focused pane". Phase A wires the outline; **find
does not exist in Rendered mode** (`05` §10.1; `docs/design/09-app-shell.md` §Find is a spec; the
`find_first_match` mark has no emitter). So Phase D builds Rendered find, pane-aware from its first line,
which `07` §1 finding 7 says is cheaper than retrofitting.

**Paths.**
- New: `apps/desktop/src/find/view.ts`, `apps/desktop/src/find/walk.ts`, `apps/desktop/src/commands/find.ts`,
  `apps/desktop/test/find-pane.test.mjs`.
- Uses (from D-03, do not edit): `apps/desktop/src/find/text-index.ts`, `apps/desktop/src/find/query.ts`.
- Edit: the outline module Phase A created (`apps/desktop/src/outline/`, P8) for its pane binding;
  `packages/theme/src/base.css` (`::highlight(marxy-find)`, `::highlight(marxy-find-current)`, the
  `mark.marxy-find` fallback and the `.marxy-find` field; tokens `--marxy-color-find` and
  `--marxy-color-find-current` already exist, `packages/theme/src/tokens.css:41-42`); `apps/desktop/src/commands/index.ts`
  (one line); `docs/design/09-app-shell.md` (Find and Outline: "per pane").

**Build order.**
1. `walk.ts`: `collectText(article: HTMLElement): { pieces: string[]; nodes: Text[] }` using a `TreeWalker`
   over text nodes, skipping any inside `.katex` (design: "Text inside `.katex` subtrees is excluded"), and
   `rangeFor(article, start, end): Range` that **re-walks** to resolve an offset pair, because the
   typesetter splits text nodes in the background (`packages/typeset/src/apply.ts:22-34`) and stored node
   references go stale.
2. `find/view.ts`: `createFind(pane: Pane): FindController` mounting an input in the pane's
   `.marxy-find-slot` (D-01: a zero-height sticky holder, so the field stays at the pane's top right
   whether the window or the pane scrolls). Matching reruns one frame after the last keystroke using
   `compileQuery`, `buildTextIndex` and `findAll` from D-03; highlights through
   `CSS.highlights.set('marxy-find', new Highlight(...ranges))` and `marxy-find-current`; when
   `CSS.highlights` is undefined, wrap matches in `<mark class="marxy-find">` and unwrap on close (a test
   deletes `CSS.highlights`, as the design requires). Navigation scrolls the current match to
   `readingLine(scroller.clientHeight)` (`packages/core/src/position/blocks.ts`) of `pane.view.scroller`.
   Emit the `find_first_match` mark when the first highlight is set. Opening find in one pane closes it in
   the other; each pane keeps its own last query. Closing removes every highlight it set.
3. `commands/find.ts`: `view.find` ("Find in this pane", key `Mod+F`): when the focused pane is Rendered, open
   its `FindController`; when it is Source, focus CodeMirror's search (`openSearchPanel` from
   `@codemirror/search`, a lazy import; the keymap is already in `baseExtensions`, `source/editor.ts`).
   Use D-06's `focusOrigin()` so `Esc` returns focus to the pane find opened from.
4. Outline: bind the dialog to `panes.focused` at open; build entries from that pane's AST
   (`outlineFrom` in `@marxy/core`); anchor the `<dialog>` to the pane's right edge when split
   (`inset-inline-end` computed from `pane.host.getBoundingClientRect()`; it is modal and may cover text);
   the current-heading mark follows that pane's per-frame position sample (`position/position.ts`
   `currentPosition(scroller, blocks, …)`), not a second scroll listener.
5. Theme: highlight styles from the existing tokens, with the current match also outlined (colour is never the
   only signal, ADR-0033).

**From L-11 (2026-10-07).** Matches use `--marxy-color-find` / `--marxy-color-find-current` as a pale fill and the
`--marxy-color-find-edge` outline for the 3:1 indicator (WCAG 1.4.11), as Source does after L-11.

**Acceptance.**
- Two panes; `Mod+F` with the right pane focused opens find in the right pane only, typing a word that is in
  both documents highlights ranges in the right article only, and the count `N of M` counts the right pane
  (`apps/desktop/test/find-pane.test.mjs`).
- The current match's top is within 2 px of 40 % of the right pane's `clientHeight` below the pane's top
  (`find-pane.test.mjs`); `Enter` moves it and `Shift+Enter` moves back.
- `Esc` closes, removes `CSS.highlights.get('marxy-find')` ranges, and returns focus to the pane it opened
  from (`find-pane.test.mjs`).
- With `CSS.highlights` deleted the fallback wraps `mark.marxy-find` and unwrapping on close restores the
  article's `innerHTML` byte for byte (`find-pane.test.mjs`).
- After the typesetter has split text nodes (wait for `data-marxy-done`), a match that spans a line break is
  still found and highlighted (`find-pane.test.mjs`).
- `find_first_match` is marked and under 50 ms for `fixtures/corpus/01-long-technical.md` in the harness
  (recorded; assert 500 ms) (`find-pane.test.mjs`).
- Source pane focused: `Mod+F` shows CodeMirror's panel inside that pane and the other pane shows none
  (`find-pane.test.mjs`).
- Outline with the left pane focused lists the left document's headings; scrolling the left pane moves the
  current-heading mark; opened from the right pane the dialog's right edge is within 2 px of the right
  pane's right edge (`find-pane.test.mjs`, or the outline test Phase A added).
- `pnpm gate:aesthetics` unchanged for every existing case; the find field is hidden and empty at rest
  (`checkChrome`).

**Tests.** Stay green: `test/find-index.test.mjs`, `test/find-query.test.mjs` (D-03), the outline tests Phase A
added, `test/selection.test.mjs`. New: `test/find-pane.test.mjs`. Gates: `pnpm precheck`, `pnpm gate:aesthetics`,
`pnpm lint:theme`.

**Do not.** Search both panes. Show a persistent search bar (the palette and `Mod+F` are the two surfaces,
`12` §4). Index `.katex` text or alt text. Change what a document's text content is (find reads, never
writes; byte fidelity is untouched). Edit `text-index.ts` or `query.ts` without moving D-03's tests with it.
Add find to the native menu.

**Risks and open questions.** If an earlier phase already built Rendered find, shrink this story to steps 3
and 4 and say so. `CSS.highlights` ranges over text that the typesetter later splits stay valid (a range
tracks DOM mutation) but a re-run after a pass is cheap and safe; the test above decides whether a re-run on
`data-marxy-typeset` changes is needed.

**From the D-03 review (2026-10-07).** `locate(offset)` places an offset on a piece boundary in the later piece, so
a match ending at the end of piece 0 locates at `(piece 1, 0)`. A `CSS.highlights` Range ending there is valid; a
`<mark>` fallback built with `surroundContents` throws when the next piece is in another block. If D-13 needs the
fallback, add an end bias (`locate(offset, 'end')` prefers the previous non-empty piece) and move D-03's tests with it.

---

### D-14 — Close the phase: the split in the aesthetics gate, the screen-criterion test and the cost bounds

**Model:** sonnet · **Size:** M · **Depends on:** D-07, D-09, D-10, D-11, D-12, D-13 · **Parallel with:** nothing (last)

**Outcome.** A reader's two-pane page is checked by the same mechanical rules as a one-pane page: measure,
contrast, no chrome, nothing spilling out of its pane. One desktop test walks the phase's screen criterion
end to end. Two panes are shown to cost what the audit predicted (and a recorded number to compare against
next time), and a leak of typesetters or observers across split and close cycles fails a test.

**Why now.** `07` §6.7: "aesthetics gate and screenshots: new split case"; `05-performance-audit.md` §11.4:
"each document in view pays its own parse, layout, grid pass and background typeset, and WebContent memory
rose from 89 MB for a 20 KB document to 766 MB for a 1 MB one. Rank 1 and rank 8 bound the per-pane cost;
without them, parking one large log next to a README makes the whole window sluggish." The study measured
26 ms typeset for two panes against 20 ms for one, and says the packaged `WKWebView`, Linux and long scrolls
were not measured.

**Paths.**
- Edit: `scripts/gate-aesthetics.mjs` (the split case; `WIDTHS` `:57`, `checkChrome` `:548`, the matrix
  `:98-114`), or its successor under P6.
- New: `apps/desktop/test/split-screen-criterion.test.mjs`, `apps/desktop/test/split-cost.test.mjs`.
- Edit: `docs/aesthetics-acceptance.md` (one paragraph: a split page is judged per pane at the same checks),
  `docs/taste-review/queue.md` only as an optional note.

**Build order.**
1. Aesthetics, mechanical half (on the PR path): add a "split" case rendered through the app harness (P6) at
   1,470 px, 960 px and 929 px, two panes (`01-long-technical.md` and `16-api-reference.md` from
   `fixtures/corpus/`), plus a synthetic page with one 140-character code line and one wide table (inline,
   not a new corpus file: a corpus file triggers the golden ceremony). Assert per pane: the article's
   measure in average characters is between 45 and 80 (`articleWidth / (avgChar * bodyPx)`); no `pre` or
   `table` right edge past its pane's right edge (the `--marxy-room` regression `07` §5 measured at 343 px);
   `checkChrome` finds nothing outside `#marxy-main`; the divider is 1 px wide; body contrast unchanged.
2. Aesthetics, visual half (nightly, ADR-0047): add split screenshots (1,470 px, dark and light) to the
   nightly baseline set under `fixtures/baselines/webkit-macos/` with the gate's existing update flag; they
   are **not** compared on the PR path.
3. `test/split-screen-criterion.test.mjs`: fixtures `README.md`, `plan.md`, `result.md`, `src/lib.rs`
   (links between them), using `test/support/two-pane.mjs`. Steps: open the plan; `Mod+\` Enter opens the
   most recent other; Cmd-click a link in the plan lands `result.md` in the neighbour; scroll each pane
   independently; `Mod+2` then `Mod+E` puts the right pane in Source; Cmd-click the README's link to
   `src/lib.rs` opens it in Source beside; `Mod+F` finds in the focused pane; `view.split-same`; close a pane;
   narrow the viewport below 929 px and assert the notice. (Relaunch restore is D-12's test.)
4. `test/split-cost.test.mjs`: asserts only what cannot be a slow-runner flake: after 20 open-split-close
   cycles `handle.debugCounts()` equals the pane count (typesetters, resize observers); same file twice parses
   once and shares one store; two panes' snap timers do not starve each other (both panes reach
   `data-marxy-done` while the other is mid-scroll); the left pane's `typeset_viewport` is not re-run by the
   right pane opening. It **prints** `split_open`, each pane's `typeset_viewport` `ms=` and first text for a
   20 KB pair, a 20 KB + 256 KB pair and a 20 KB + 1 MB pair (generate the large files in the test from
   corpus text; do not commit them).
5. One-off measurement for the PR description (not a gate, not committed): build the release binary, write a
   two-column `layout.json` (D-12) into a scratch data directory, launch, and sample `ps -o rss=` for the
   `marxy` process and its WebContent process every 100 ms, as `05` §9.3 describes (its `app-mem.mjs` is
   scratch and not in the repository; the sampling is a ten-line shell loop). Record the three pairs above
   and the single-document baselines.
6. Compare with the report-back thresholds below and write the numbers into the PR.

**Report-back thresholds (recorded, not gated; ADR-0032).** If any of these fails, do not loosen it and do
not merge a "fix": say what was measured and which Phase B lever (`05` §11 rank 1 grid pass, rank 8 first
two screens) is missing.
- A 20 KB document beside a 20 KB document: `split_open` (command to second pane's first text) under 150 ms.
- The first pane's `typeset_viewport` changes by less than 25 % when the second pane opens.
- 20 KB + 1 MB: first text of the small pane is not delayed by the large pane's parse beyond one frame after
  the small pane has painted (the large document may take as long as it takes alone; the window stays
  scrollable in the small pane).
- WebContent RSS for a pair is at most the single-document RSS of the larger plus 25 % of the smaller's
  increment over the empty-window baseline (about 89 MB, `05` §9.3), i.e. two panes share one process and one
  parser and the second document costs what it costs alone, not twice the first.

**Acceptance.**
- `pnpm gate:aesthetics` includes the split case and fails if a `pre` is made to spill (verify by temporarily
  reverting the container-relative `--marxy-room` in a scratch branch; say so in the PR) (`scripts/gate-aesthetics.mjs`).
- `apps/desktop/test/split-screen-criterion.test.mjs` passes and exercises every verb in the phase.
- `apps/desktop/test/split-cost.test.mjs` passes and its output records the numbers above.
- The PR description carries the measured numbers and the verdict against each threshold.

**Tests.** Stay green: all of `pnpm test`; every existing aesthetics case, with no single-document baseline
changing. New: the two test files. Gates: `pnpm precheck --all` once, `pnpm gate:aesthetics`.

**Do not.** Add a screenshot comparison to the PR path (ADR-0047). Add a corpus file. Write a perf gate or a
budget file entry (ADR-0032; the product tier of `fixtures/perf-budgets.json` is slated for deletion in
amendment 10). Retry a flaky test until it passes. Touch an existing single-document baseline.

**Risks and open questions.** The cost step cannot see Linux WebKitGTK (`07` §6.7); the PR says so. If P6 did
not retire `render/headless.ts`, the split case must still be built on the app harness, so the gate judges the
page a reader sees.

## What this phase deliberately leaves out

- **A diff mode.** Two versions of a regenerated file are a diff, not a split: the reader-artifacts handbook
  names "reading two full texts side by side" as the failure of the compare task
  (`docs/research/reader-artifacts/01-reading-tasks.md`; `07` §1 finding 8), and Kaleidoscope-style sync scroll works
  only because it aligns changed blocks. It is a separate feature after Phase E's transforms (`14-roadmap-proposal.md`).
- **OS windows as the split.** Not a second window, not Marxy placing its own windows, not a `shell-api`
  member for either. Five hard-coded `"main"` sites in Rust (`apps/desktop/src-tauri/src/main.rs:145,173,442,756,845`),
  a capability glob, close-quits-the-process, single-instance routing and two buffers per file make it a dead end
  for what makes the split Marxy's own (`07` §4.9). macOS tiling already places two Marxy windows if the author
  ever wants that, and the same file in two windows is not supported.
- **More than two panes, vertical splits, a pane tree.** `MAX_PANES` and `MAX_COLUMNS` are constants and the
  layout is a list so a third column later is a limit change; today the typography floor makes it two on a
  laptop (`07` §4.1, §5). A stacked pane halves the height and the typesetter's `window.innerHeight` assumptions
  (`packages/typeset/src/index.ts:261,270`) would be wrong for it.
- **Linked scroll** (`07` §4.7, §6.6 story 10). Independent scroll is the only mode. No command, no flag. A
  coordinate-linked scroll is meaningful for one file shown twice and for nothing else, and pixel locking is
  noise for unrelated documents; if it is wanted later it is a command with no key, never persisted.
- **Chrome.** No tab bar, pane header, title strip, handle on the divider, close button, or sidebar
  (design constraint 6; ADR-0011, ADR-0050). Focus is the window title and a 150 ms fade.
- **Searching both panes at once, swapping panes, dragging a pane out, a "split" menu item, a keyboard
  resize chord.** The palette lists `view.split-wider`, `view.split-narrower` and `view.reset-split` without
  keys.
- **Persisting the second view's position of a same-file pair**, and restoring a layout across a path that moved.
- **Any `shell-api`, Rust, contract or ADR-0037 change.** The ADR-0037 amendment is Phase B's.
- **Linux verification** of the split (ADR-0046): a release criterion when hardware exists.

## Open questions for the author

1. **Plain click in a two-pane layout.** The plan keeps "replace in this pane"; Cmd-click goes to the neighbour.
   Should a plain click open in the neighbour when two panes exist (the reference-pane model)? (D-09)
2. **A file launched while a layout is saved.** The plan restores the layout and puts the file in the focused
   pane; `07` §4.6 is ambiguous. (D-12)
3. **Links to source files.** Today every link to a non-Markdown file is refused. The plan lets Cmd-click open
   a text file in Source beside, which the "README beside the source it documents" criterion needs. (D-09)
4. **Focus on wheel, the dirty dot on the focused document only, and the divider's fade.** All three are small
   taste calls behind one constant, one rule and one CSS block. (D-06, D-08, D-04)
5. **Source typing reaches the neighbouring view when focus leaves**, not per keystroke. (D-11)
