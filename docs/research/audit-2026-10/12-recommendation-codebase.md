# 12 — Recommendation: the codebase

**Date:** 2026-10-01 · **Author:** the audit lead · **Inputs:** `01-codebase-audit.md`,
`04-tests-and-gates.md`, `05-performance-audit.md`, the three feature studies (06, 07, 08),
`09-decision-inventory.md` and `10-overfit-decisions.md`.

**Abstract.** The product code is healthier than the project's own documents suggest and
smaller than its machinery: about 22,500 lines of product source carry 18,700 lines of unit tests,
8,500 lines of browser tests, 14,800 lines of gate scripts and 15,400 lines of orchestrator. The
parse-to-DOM-to-splice path with byte provenance is solid and is the asset every new feature
should stand on. The app shell is not: `app.ts` is a 1,399-line module with 33 module-level
variables, the index is startup work with no owner (two reproduced defects), and about 1,700
lines are dead or parallel. The recommendation is one refactor before any feature, in a fixed
order: own the index, build the document store ADR-0037 describes for N documents, wire what is
already built, delete what is dead, retire the parallel render path, unfreeze the contracts, and
then build collections, text operations and the split in that order. Manage the codebase as one
person with ad-hoc agents, on trunk, with a pruned PR path.

## 1. Where the code stands

| Measure | Value | Source |
| --- | --- | --- |
| Product source (packages + app TS + Rust) | 22,474 lines | `01-codebase-audit.md` [C1] |
| Unit tests beside it / browser tests | 18,714 / 8,504 lines | same |
| Gate scripts / orchestrator | 14,797 / 15,406 lines | same |
| Share of file changes on `main` that touched product source | 701 of 4,126 (17 %) | [C12] |
| `docs/scope.md` v1 items shipped and reachable | 17 of 31 | §1.4 |
| Built but not reachable | 4 (outline, light variant, weight table, AppImage) | §1.4 |
| Dead or parallel code | about 1,700 lines | §3.2 |
| Build health | typecheck, lint, 1,191 tests, `cargo check` all green | §5 |

Two things in that table decide the recommendation. Only a sixth of the change on `main` was
product change, and just over half of v1 is reachable. The machinery was built first and the
product is behind it. That is not a reason to add process; it is a reason to turn the remaining
effort toward the screen.

## 2. The invariants to keep

These are the parts of the codebase that are right, and every recommendation below is written so
as not to touch them.

- **One buffer, one AST, byte provenance on every node, into the DOM, back through the splice**
  (ADR-0003, 0018, 0023). `packages/core` parse and render, `atomic_write.rs`, the reading-position
  model. `01-codebase-audit.md` §2.1 confirms it is real end to end.
- **Sanitise always; the CSP.** `packages/core/src/sanitize/*` and `tauri.conf.json`'s policy.
  The posture is loosened in `10-overfit-decisions.md` §3.1 by a setting, not by removing these.
- **Operations as pure `string → string` under one undo** (ADR-0004). `08-feature-text-operations.md`
  found the mechanism carries the whole feature; the work is catalogue, not architecture.
- **The typesetter package** (`packages/typeset`), well isolated, measured cheap
  (`07-feature-split-view.md`: 20 ms for one article, 26 ms for two).
- **The watcher and live reload**, including the ref-counted multi-root design in Rust.
- **The palette's search and session modules**, which are tested and fast enough to 20,000
  entries (`06-feature-collection-and-search.md`).

## 3. The refactor, in order

One sequence, each step a few days to two weeks for one person with an agent, each leaving `main`
releasable. The order matters: each step is the precondition of the next, and all three features
the author wants depend on steps 1 and 2.

### Step 1 — Give the index an owner (days)

The two reproduced defects (`01-codebase-audit.md` §1.3) share a cause: the index is a step in
`runDeferredStartup`, delivered to the palette once in `main.ts:11-14`, and re-walked and discarded
on every render (`app.ts:976-992` → `startup/idle-work.ts:105-115`). A launch from the Dock leaves
search empty for the session; opening a file in a second repository searches the first.

- Create `apps/desktop/src/index/service.ts`, keyed by root: walk once per root, persist with the
  existing `core/index-model/persist.ts`, refresh from the root watcher, publish by subscription.
- Delete the one-shot hand-off in `main.ts`; stop the two re-render paths from walking; stop
  `shell.readFile` from caching bytes for index reads (`shell/tauri.ts:95`).
- Decide the walker: the TypeScript walker that runs today, or the 573-line Rust indexer that is
  written, tested, and not compiled in (`src-tauri/src/index/mod.rs`, no `mod index;` in
  `main.rs`). The collection study recommends staying in TypeScript until a multi-root collection
  crosses the 16 ms keystroke budget (measured: 6.6 ms p95 at 20k entries, 15.2 ms at 50k).
  Delete the Rust module unless it is wired here.
- Fix the three dead ranking fields the collection study found: `lastReadMs` never set,
  `history.json` timestamps rewritten on every save, recent roots keyed by `dirname`.

This is a bug fix today and the foundation for collections tomorrow.

### Step 2 — Build the document store for N documents; make `app.ts` a composition root (1–2 weeks)

ADR-0037 is proposed, unimplemented, and already out of date: as written it puts `mode` and
`anchor` in a single store, which bakes in one view (`07-feature-split-view.md`). Amend it before
building: **one `DocumentStore` per open document** (path, disk bytes, buffer, AST, node map,
history, version) and **one `RenderedView` per article** (typesetter, grid scheduling, anchor,
resize observer, scroller, mode).

- `apps/desktop/src/document/store.ts` with the seven transitions ADR-0037 lists; delete the
  module state in `selection/view.ts`, `commands/edits.ts` and `save.ts`.
- `apps/desktop/src/view/rendered-view.ts` lifting `app.ts:607-780`.
- `trust/controller.ts` lifting `app.ts:388-579`; `startup/measure.ts` lifting the measurement code.
- `app.ts` ends under 300 lines and resets no state by hand.
- Keep `#doc` as the id of the first pane: 54 test and script files name it.
- This dissolves the seven-module import cycle (`01-codebase-audit.md` §2.4), fixes the three
  undo and save defects ADR-0037 reproduces, and is the one precondition of the split view.

### Step 3 — Wire what is built (days)

Six scope items close with small changes: let the palette list every registry command whose
`when` holds, not only `op.*` (`palette/view.ts:91-95`); move `Mod+E` and the history listeners
into the registry; apply config `variant` and `size` in the app (the code exists in
`render/headless.ts:305-318`); wire `outlineFrom` into `#marxy-outline`; add "open in external
editor" (design §09 has it); add drag-to-open. The light variant, text size and the outline are
built and unreachable today.

### Step 4 — Delete what is dead (a day)

About 1,700 lines (`01-codebase-audit.md` §3.2): the uncompiled Rust indexer (unless step 1 wired
it), the legacy palette model and its hand-written headless DOM (`palette/palette.ts`,
`palette/index.ts`, `palette/view.ts:531-760` and their tests), `source/mode-toggle.ts` and
`source/index.ts`, `core/position/snapshot.ts`, six unused exports, two stale `deferrals.json`
rows, the duplicate `tauri_plugin_dialog::init()`. Move the three `MARXY_*_MUTATION` switches and
the twenty `window.__marxy*` hooks into test-only entries.

### Step 5 — Retire the parallel render path (days)

`render/headless.ts` (412 lines) plus `stub.ts` and `vite.config.ts` re-implement
parse → render → typeset for the aesthetics gate and skip highlighting, KaTeX, notices and the
frontispiece. The gate therefore judges a page a reader never sees. Point
`scripts/gate-aesthetics.mjs` at the app harness (`harness/app-harness.ts`,
`startApp(memoryShell)`) and delete the three files.

### Step 6 — Unfreeze the contracts; make `Shell` the real interface (days)

Delete `test:contracts-frozen` from `package.json` (`10-overfit-decisions.md` §3.2). Nine of the
twenty-nine `Shell` members are unimplemented and the app programs to an ad hoc `AppShell`
(`app.ts:80`); implement or delete the nine, fold `peekFile` and `recordRead` in, delete
`AppShell` and the duplicate type in `shell/tauri.ts`. Leave the AST and operation contracts as
they are. Replace the 52 deep `@marxy/*/src/...` imports with package exports; move
`core/index-model/paths.ts` to `core/paths.ts`.

### Step 7 — The two large-document levers (M each)

`05-performance-audit.md` §9 and §11: start-up for normal documents is 292 ms to a laid-out page
and the typesetter costs 0–27 ms, but a 1 MB file takes 4–5 s to first text and 766 MB of
WebContent memory, and 5 MB takes minutes. Two causes, both before first text: the grid pass in
`packages/typeset/src/grid.ts:46-55` is a write-then-read loop over every block (quadratic; 2.2 s at
1 MB), and the whole document is laid out before the first paint. Fix the grid pass as one read
pass and one write pass; then emit first text after the first two screens of blocks and append the
rest in idle chunks (or `content-visibility: auto`). The index fix in step 1 is the third lever
(975 IPC calls per walk). Nothing else in the bundle, fonts or parser is a start-up lever.

### Step 8 — Resolve the half-features that a decision is waiting on (days each)

- **Remote images.** Under ADR-0044 (proposed in `10-overfit-decisions.md`): one `remote-images`
  setting, the plain blocked notice, no per-host grant store (about 250 lines go). The Rust
  fetcher is not built and stays unbuilt unless a hardened mode is asked for.
- **The Linux weight table.** Implement `webkitVersion` or delete the version rows in
  `theme/offset.ts` and document the constant.
- **The typesetter.** Keep it; add `typeset = false` to the config using the existing fallback;
  vendor `justif`'s hyphenation patterns or drop the unused `engine: 'justif'` path so a young
  dependency is off the critical path.

## 4. Then the features, in this order

The three studies agree on the dependency graph, and it fixes the order.

| Order | Feature | Why here | Study |
| --- | --- | --- | --- |
| 1 | **Collections and quick search** | Needs only step 1 and a `collection.toml`; no contract change if the matcher stays in TypeScript; the empty state ("changed since you read") is the single most useful thing for AI output and no surveyed tool has it. | 06 |
| 2 | **Copy and extract pack** of text operations | Clipboard-only, cannot change a byte, fits the frozen contract unchanged; rich copy needs no Rust change (the shell already writes HTML and plain flavours). Then the verb menu as the one click surface. | 08 |
| 3 | **Split view** | Needs step 2 in full plus one theme story (`--marxy-room` from `100vw` to container width); two panes at the 66-character measure need 1,318 px, which 13-inch Macs provide at default scaling. | 07 |
| 4 | **Transform operations and edit-one-block-in-Source** | Needs the verb menu, block-aligned multi-block selection, and the ADR-0005 amendment. | 08 |
| 5 | **Content search** on demand (ripgrep-style, `/` prefix) | After collections; no index to keep fresh. | 06 |

What not to build, from the studies: a persistent search bar or sidebar (the palette with a
default collection scope does it), a `tantivy` index (staleness for AI output that regenerates),
a hover copy glyph (the only candidate that appears without a deliberate act), a diff mode
disguised as a split (it deserves its own story), multiple OS windows as the split (a dead end
through five hard-coded `"main"` sites in Rust).

## 5. How to manage the codebase from here

**One person, ad-hoc agents, trunk.** The last 27 PRs landed this way and `main` stayed green.
Concretely:

- **Branches** `type/short-slug`, a Jira key optional. Squash merge. Conventional subject (the
  hook stays). One `changelog.d/` fragment per change.
- **The PR path** is `04-tests-and-gates.md`'s pruned list: typecheck, lint, unit tests, goldens,
  fidelity, licences, boundaries, the mechanical aesthetics checks in one engine, the desktop
  WebKit suite. Screenshot comparison, rag baselines, Linux, perf measurement and the
  orchestrator's tests go to nightly or run on demand.
- **Agents** work in worktrees (`git worktree add ../marxy-wt/<slug>`), one task each, with
  `AGENTS.md` cut to the spirit, the architecture paragraph, the module map and the three
  commands. A strong model reviews before the author reads; the author decides.
- **The plan** is a list the author writes, one file per story if the ADR-0042 format is kept,
  with paths and acceptance only where they help an agent. Nothing enforces its shape.
- **Decisions** still get an ADR when meaning changes. Adding a field does not.
- **Taste** is the author opening the app. The queue file stays for notes; no gate reads it.
- **Releases** when a phase of the roadmap in `14-roadmap-proposal.md` is reachable on screen,
  never on a date; the first tag should exist soon, unsigned, so the release workflow is real.

**What this is not.** It is not a return to no process. The gates that protect readers (byte
fidelity, sanitiser vectors, goldens, no-network under the `never` setting, boundaries) stay on
every PR, because they catch what an agent cannot see. It is the removal of the gates that
protect the process from itself.

## For the synthesis

1. The product code is healthy and the provenance path is the asset; the app shell and the index are the debt.
2. One refactor before any feature, in order: own the index, build the N-document store, wire what is built, delete 1,700 dead lines, retire the parallel render path, unfreeze the contracts, resolve the three half-features.
3. Then features in dependency order: collections, copy/extract operations, split view, transforms and block editing, on-demand content search.
4. Just over half of v1 is reachable today and four more items are built but unwired; the distance to a first release is days of wiring, not weeks of building.
5. Manage as one person plus ad-hoc agents on trunk with a pruned PR path; keep the reader-protecting gates on every PR and move the rest to nightly.
6. Tag a first unsigned release soon so the release workflow stops being hypothetical.
