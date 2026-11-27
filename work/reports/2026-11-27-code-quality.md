# Code-quality review, 2026-11-27

A read-only review of `main` at `b30bf002` (the reader architecture plus #774 to #782): what needs rewriting,
rearchitecting or reorganising. Four reviewers read a frozen copy (front end, packages, Rust shell, tests and
tooling); every claim below that a row rests on was checked against the source afterwards. The rows are Q1 to Q9
in `todo.md`.

## Bottom line

No rewrite from scratch. The domain code is sound: the byte buffer and splice with provenance, the parser, the
source map, the sanitiser, the document store, the command and kind registries, the Rust `scope::check` model and
the archive limits. The trouble is at the seams: everything imports everything, a few closure factories hold
thousands of lines, the same idea is built several times, and the browser suite cannot pass on a CI machine.

## Order

1. Land M1 (round 16 and wave 5 from the Windows disk) and tag v0.2.0. Those branches change exactly what the
   large splits would cut: `view/rendered-view.ts`, typeset and the core readers. Nothing structural before the
   tag touches those files.
2. The pieces that touch none of them, started on 2026-11-27 each in its own session: one path-scope check in Rust
   (Q1), a test kit for the browser suite and a pull-request smoke job (Q5), and the aesthetics gate and mutation
   tests in CI (Q9).
3. After M1: the import structure together, so that in-flight branches are not failed by a new check: a
   dependency-direction rule with a baseline (Q3), core's `exports` map and the import rewrite (Q4). Then the key
   router (Q2, after the menu-freeze fix), then the long-function splits with the geometry table (Q6, Q7).

## Findings

### Rearchitect

- **Path scope in Rust has three implementations (Q1).** `file_scheme.rs:318` `handle_held` and `scope.rs:355`
  `handle_in` have the same body (the Windows final-path branch, the Unix device and inode compare, the fallback);
  only the predicate differs (`holds` against `holds_canonical(need)`). `commands/search.rs` judges its roots a
  third way. 35 sites in 11 files call `file_scheme::opened()` directly against 21 through `scope::`.
- **Key routing has no owner (Q2).** 53 keydown listeners and about 10 document or window dispatchers
  (`pane/keys.ts:189`, `selection/bind.ts:206` and `:312`, `selection/view.ts:904`, `viewers/keys.ts:9`,
  `frame/frame.ts:365`, `palette/early-chords.ts:24`, `palette/view.ts:1888` and others), ordered only by capture
  phase and `stopPropagation`. Whether a modal is open is decided at 16 sites with at least four different
  selectors; `inEditable` is defined twice (`pane/keys.ts:120`, `selection/bind.ts:88`).
- **The front end is one import cycle (Q3).** Counting value imports only, 38 of the 42 folders under
  `apps/desktop/src` are in one strongly connected component. `appHandle()` (a module-level singleton,
  `commands/app-handle.ts`) is called 202 times in 78 files, viewers, Source and document code included;
  `AppHandle` has about 27 members. `AppContext` is declared in `commands/registry.ts` but built in
  `selection/bind.ts:55`.
- **Core has no public surface (Q4).** 489 imports of `@marxy/core/src/...` in 223 files, against 132 through the
  package; `packages/core/package.json` has `"main": "src/index.ts"` and no `exports`. Core holds three things: the
  Markdown engine, about 13k lines of format readers (office, book, mail, archive, certificates) and workspace
  code (index model, paths, layout, position).
- **The browser suite cannot pass on a hosted runner (Q5).** 466 fixed sleeps in 125 files; 441 browser launches
  for about 2,050 tests; wall-clock budgets asserted as pass or fail; the same setup preamble pasted 150 to 237
  times. No pull request or `main` push runs it (M4, M5).

### Split

- **Long functions (Q6).** 43 front-end functions are over 200 lines. `createRenderedView` runs from line 409 of
  `view/rendered-view.ts` to the end, about 2,680 lines (S9), with at least five ways of holding the scroll
  (`restoreTo`, `holdAnchor`, `resizeHold`, `pinnedTop`, `holdPosition`, `holdApart`, `holdingScroll`); the app
  models "where the reader is" eight or more ways. Typeset's `attach()` is about 900 lines
  (`packages/typeset/src/index.ts:207` to `1108`). Also `createArchiveViewer` 1,372, the table lens 1,091,
  `createOpenPath` 1,003 and `readRtf` about 736 lines.

### Consolidate

- **Windowed rows (Q7)** are built separately in six or more places: the side-panel rows, reading rows, reading
  lines, the table lens, hex and archive.
- **Shared pieces (Q8).** Each viewer repeats the same scaffolding; 12 hand-made caches with different limits;
  `plural` 25 times, 17 of which print the bare number while the rest group it (1234 against 1,234), so counts read differently from panel to panel; in core, `utf8Length` four times
  plus two variants, `extensionOf` four times, 11 line splitters and three budget idioms (P4). In Rust, a second
  `ShellError` (`commands/os.rs:10`), about 47 `Result<_, String>` signatures, 89 platform `cfg` attributes inline
  in `atomic_write.rs`, and `main.rs` at about 1,700 lines of non-test code (the watch registry, the macOS menu,
  the close and exit state machine) with two `#[path]` includes.

### Reorganise or delete (Q9)

The owner accepted the recommendation for each, on 2026-11-27:

- `pnpm gate:aesthetics` (`scripts/gate-aesthetics.mjs`, 2,171 lines) and `test:mutations` are documented in
  `docs/testing.md` but run in no `verify` tier and no CI job. **Wire them in** (full tier and CI on `main`), not
  delete them: the gate checks the typography the reader exists for.
- `scripts/probe-layout.mjs` (1,581 lines) is a hand-run research probe by design (its header says so, and its
  test runs in the full tier). **Keep.** The review first counted it as orphaned; it is not.
- The contract-2 user-theme format beside the bundled looks is a documented feature (`docs/themes-and-type.md`).
  **Keep both.**
- Several folders hold one to three files; `frame/` has become a shared UI kit (`left/` imports it 51 times);
  about 30 modules carry their CSS inside TypeScript. **Move with Q3**, after M1, since it touches many files.

## Leave alone

The buffer, parser, source map and sanitiser; `document/store.ts` and its registry; the command registry (145
commands, one shape); the kind registry; `scope::check` and its `Need` model; archive `Limits` and `Fault`; the
Rust dependencies, which are lean; the Tauri and memory shells behind one interface; the `pnpm verify` tiers and
the `pnpm check` scripts.

## Corrections to the reviewers

- The TypeScript archive reader (`packages/core/src/viewer/archive-read.ts`) is not dead weight: the desktop app
  reads archives nested inside archives with it (`viewers/archive-nested.ts`, `archive-bytes.ts`). Keep both
  readers and hold them equal with shared fixtures.
- The browser suite launches a browser about once per four or five tests, not once per test.
- `isMac` is defined five times, not seven.
- The `plural` copies do not differ by locale: en-GB and en-US print integers the same way. They differ in grouping: 17
  print the bare number and eight group it. (Corrected the same day; the first version of this report said en-GB
  against en-US.)
