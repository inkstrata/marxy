# Phase A — The large-document lane; pause, prune, wire

**Date:** 2026-10-02 · **Status:** plan · **Stories:** 17 (`A-01` … `A-17`) · **Ends with:** v0.1.0,
unsigned, installable on macOS · **Source:** `docs/research/audit-2026-10/14-roadmap-proposal.md`
"Phase A", with the large-document levers moved in from its Phase B at the author's request.

**Abstract.** Phase A makes Marxy fast on the documents agents write, stops the machinery that grew
around it, and makes everything already built reachable. It has four lanes. The **large-document
lane** (A-01 to A-03) rewrites the quadratic baseline-grid pass, puts first text on screen after the
first two screens of blocks and appends the rest in idle time, and moves measurement to a nightly
run of the existing app harness; a 1 MB transcript goes from 4–5 s of blank window to well under a
second. The **index lane** (A-04 to A-06) gives the palette's index an owner keyed by root, so a
Dock launch and a second repository both search correctly, cuts the walk's IPC calls, and makes the
ranking fields honest. The **process lane** (A-07 to A-11) records the pause, prunes the
pull-request path to the product gates `04-tests-and-gates.md` §6 recommends, and rewrites the CI
contract to match. The **wire lane** (A-12 to A-16) makes the palette list every command, moves the
stray key listeners into the registry, and wires the light variant, text size, the outline, the
external editor and drag to open. A-17 makes the release workflow complete on a tag, and the author
tags v0.1.0. The Rust indexer is **not** wired here: the TypeScript walker stays (A-05 cuts its
calls) and `apps/desktop/src-tauri/src/index/mod.rs` is deleted with the other dead code in
Phase B.

## Phase goal and screen criterion

From the roadmap (`14-roadmap-proposal.md`, Phase A):

> **Ends with:** the fleet paused, the PR path pruned, v0.1.0 tagged and installable on macOS,
> unsigned; everything that is built is reachable.
>
> **Screen criterion:** launch from the Dock, open two files in two repositories, search finds both;
> toggle light; summon the outline.

Added by the author on 2026-10-02, moved in from the roadmap's Phase B:

> A 1 MB transcript shows its first screen in well under a second (today 4–5 s).

The phase is done when the author has seen all four on the installed v0.1.0 build, not on a date.

## Preconditions

What must be true before Wave 0 starts:

1. **The audit and this plan are on `main`.** MARXY-346 (the audit and five corpus texts) and
   MARXY-347 (this plan, ADR-0044 to ADR-0051 as *proposed*, and the per-document amendment to
   ADR-0037). The ADRs land with the plan's own pull request; no Phase A story writes them. Phase A
   relies on four of the ten amendments in `10-overfit-decisions.md` §5: ADR-0047 (visual
   comparison nightly: A-10), ADR-0051 (the fleet paused: A-07, A-11), amendment 10 (delete the
   product tier: A-03) and ADR-0046 (Linux a release criterion, not a PR gate: A-09, A-17). If the
   author strikes any of these four, the named stories change before they start.
2. **The fleet loop is not running.** It has been stopped since 2026-09-29.
   `pgrep -fl 'orchestration/loop.sh'` prints nothing. Nobody runs `jira.mjs push` or `sync`.
3. **Every implementing worktree can run WebKit.** `pnpm install --frozen-lockfile` then
   `pnpm exec playwright install webkit`. Most acceptance in this phase is a WebKit test, and those
   tests *skip silently* without the browser; implementors run them with
   `MARXY_BROWSER_TESTS_REQUIRED=1` so a missing browser fails instead.
4. **A-07 merges first and alone (Wave 0).** Until it lands, the current CI rejects any branch
   without a `MARXY-nnn` key and a board row (`check-story --strict` and the commit-subject rule in
   `commitlint.config.mjs:25-33`). A-07's own pull request passes because GitHub runs the workflow
   and the commitlint config from the pull request's own tree. Once A-07 is on `main`, branches
   are `type/a-nn-slug`, subjects end in `(A-nn)`, and no board row is needed. This makes the
   board-row step in `00-orchestration.md` §6 unnecessary for every story after A-07.
5. **Each story gets a changelog fragment** `changelog.d/A-nn.md`, one reader-facing line ending
   in `(A-nn)` (the format `scripts/lib/changelog.mjs` reads). A taste-review row is welcome where
   the reader sees a change, and no gate requires one.

## Dependency graph and waves

| Id | Title | Model | Size | Depends on | Wave |
| --- | --- | --- | --- | --- | --- |
| A-01 | Grid pass in one read and one write per round; the large-document harness | opus | M | A-07 | 1 |
| A-02 | First text from the first screens; the rest appended in idle chunks | opus | L | A-01, A-04 | 2 |
| A-03 | Measure nightly, not on pull requests; delete the product tier | opus | L | A-01, A-08 | 2 |
| A-04 | Give the index an owner: one index per root, published to the palette | opus | M | A-07 | 1 |
| A-05 | Walk a root in fewer shell calls, from a snapshot | sonnet | M | A-04 | 2 |
| A-06 | Make the palette's ranking fields honest | sonnet | M | A-04, A-12 | 2 |
| A-07 | Pause the fleet and unlock the conventions job | sonnet | S | — | 0 |
| A-08 | One `pnpm check`; delete the checks of CI's own shape | sonnet | M | A-07 | 1 |
| A-09 | Path-filter the Rust and typography jobs; dual-OS build to nightly; `fast` only on `main` | opus | M | A-03, A-08 | 3 |
| A-10 | `browser-lite` on pull requests; visual comparison and the full WebKit suites nightly | opus | M | A-06, A-09 | 4 |
| A-11 | Rewrite the CI contract and the process documents | sonnet | M | A-03, A-07, A-08, A-09, A-10 | 5 |
| A-12 | The palette lists every command whose `when` holds | sonnet | M | A-07 | 1 |
| A-13 | `Mod+E`, back and forward through the registry | sonnet | M | A-02, A-06, A-12 | 3 |
| A-14 | Light variant and text size from config and by command | sonnet | M | A-04, A-12, A-13 | 4 |
| A-15 | The outline, summoned | sonnet | M | A-12 | 3 |
| A-16 | Open in external editor; drag a file to open it | opus | M | A-12 | 3 |
| A-17 | The release workflow completes on a tag; v0.1.0 | sonnet | S | A-01 … A-16 | 5 |

**Waves.** Each wave has at most four stories, at most two on Opus, pairwise disjoint paths, and at
most one story on `apps/desktop/src/app.ts` (`00-orchestration.md` §5).

| Wave | Stories | On Opus | Owner of `app.ts` | Note |
| --- | --- | --- | --- | --- |
| 0 | A-07 | — | — | Lands alone; unblocks story-id subjects |
| 1 | A-01, A-04, A-08, A-12 | A-01, A-04 | A-04 | Grid and index start the performance lane |
| 2 | A-02, A-03, A-05, A-06 | A-02, A-03 | A-02 | First text, nightly measurement, the index finished |
| 3 | A-09, A-13, A-15, A-16 | A-09, A-16 | A-13 | |
| 4 | A-10, A-14 | A-10 | A-14 | |
| 5 | A-11, A-17 | — | — | Then the author verifies and tags |

**Files more than one story touches, and the order they touch them in.** Waves are serial, so these
never collide inside a wave. They are listed so a reviewer knows which earlier story a diff builds
on.

| File | Stories, in order |
| --- | --- |
| `apps/desktop/src/app.ts` | A-04 → A-02 → A-13 → A-14 |
| `apps/desktop/src/main.ts` | A-04 |
| `apps/desktop/src/palette/view.ts` | A-12 → A-06 → A-13 |
| `apps/desktop/src/palette/history.ts` | A-04 → A-06 |
| `apps/desktop/src/commands/index.ts` | A-12 only. A-12 adds four empty command modules, one each for A-13 to A-16, so later stories edit only their own file |
| `apps/desktop/src/index/service.ts`, `index/walk.ts` | A-04 (creates) → A-05 |
| `packages/typeset/src/grid.ts` | A-01 → A-02 |
| `scripts/perf-harness.mjs` | A-01 (creates) → A-03 |
| `package.json` | A-07 → A-08 → A-03 |
| `.github/workflows/ci.yml` | A-07 → A-08 → A-03 → A-09 → A-10 |
| `.github/workflows/nightly.yml` | A-03 → A-09 → A-10 |
| `scripts/check-workflows.mjs` | A-08 → A-09 |
| `scripts/gates-by-path.json` | A-08 → A-03 |
| `apps/desktop/package.json` | A-10 → A-17 |
| `apps/desktop/src-tauri/Cargo.toml`, `Cargo.lock` | A-16 → A-17 |
| `apps/desktop/src/palette/search.test.ts` | A-06 → A-10 |
| `AGENTS.md`, `docs/ci-contract.md` | A-07 (a pointer) → A-11 (the rewrite) |

---

## Stories

### A-01 — Put the grid pass in one read and one write per round, and commit the large-document harness

**Model:** opus · **Size:** M · **Depends on:** A-07 · **Parallel with:** A-04, A-08, A-12

**Outcome.** Opening a large document no longer spends seconds in the baseline-grid pass. Today the
pass reads a block's position, writes a padding, and reads the next block's position again, once
per block, so the browser lays the whole article out again for every push. At 1 MB that is 2.2 s
before first text, and every font load, resize and background typeset chunk pays it again. After
this story the pass reads every position at once, writes every padding at once, and repeats that
only while something is still off the grid, a small fixed number of rounds whatever the length.
Every corpus document gets exactly the paddings it gets today. A developer can also run
`node scripts/perf-harness.mjs` to reproduce the audit's large-document table on their own machine.

**Why now.** `05-performance-audit.md` §9.1 and §9.2 measure the grid pass's write-then-read loop as
quadratic (2,251 ms of a 4.2–5.2 s first text at 1 MB) and §11.1 ranks it first. The harness is the
committed form of the audit's appendix scripts (§13.3, and the `webkit-layout.mjs` loop of §9.2),
so this and the next two stories have a measurement anyone can repeat.

**Paths.**
- `packages/typeset/src/grid.ts`
- `packages/theme/test/grid.test.mjs`
- `scripts/perf-harness.mjs` (new)
- `scripts/perf-harness.test.mjs` (new)
- `changelog.d/A-01.md` (new)

**Build order.**
1. `scripts/perf-harness.mjs`, the measuring tool, before any change, so the "before" numbers come
   from the same code as the "after":
   - `generateLarge(targetBytes: number): Uint8Array`. Repeat `fixtures/corpus/01-long-technical.md`
     with one blank line between copies until the size is reached, as `05` §13.1 did. It must be
     deterministic. Accept the size names `256k`, `1m` and `5m`.
   - `stageDeltas(marks: Record<string, number>)`. From the app's marks, compute parse
     (`parsed − file_read`), render (`rendered − parsed`), layout and fonts (`fonts_ready − rendered`),
     grid (`render − fonts_ready`), paint wait (`first_text − render`), first text, and the `ms=`
     detail of `typeset_viewport`. These are the columns of `05` §9.1.
   - `median(xs: number[]): number`.
   - The CLI. `--build` runs `pnpm --filter @marxy/desktop build:web`. `--runs N` defaults to 5.
     `--files` takes a comma-separated list of corpus names. `--large 256k,1m` adds generated files.
     `--write <dir>` writes the generated files to disk as `big-256k.md`, `big-1m.md` and
     `big-5m.md`, for manual use, and exits. `--grid-only`
     loads the rendered HTML into a themed article and times `snapToGrid` alone, the way
     `packages/theme/test/grid.test.mjs:26` loads `grid.ts` from source with its types stripped.
     `--json <path>` writes the results. The default output is one JSON line per file, with
     medians.
   - The browser part is the core loop of `05` §13.3. Serve `apps/desktop/dist` on `127.0.0.1`
     with `node:http`. Launch WebKit with `launchWebkit` from `scripts/playwright-webkit.mjs`. Go to
     `app.html` and call `window.marxyApp.start({'/docs/doc.md': b64}, ['/docs/doc.md'])` (the entry
     is `apps/desktop/src/harness/app-harness.ts`). Await `handle.ready`, then read every `mark`
     call from `handle.shell.calls`. Print **every** mark it finds, not a fixed list, so marks added
     later (A-02) appear without editing the harness.
   - Export `generateLarge`, `stageDeltas` and `median`, and run the CLI only when the file is
     invoked directly (`import.meta.url === pathToFileURL(process.argv[1]).href`), so tests can
     import it (A-02's test does).
2. Run the harness on `main` for `01-long-technical.md`, `15-prose-volume.md`, `256k` and `1m` with
   `--runs 5`, and `--grid-only` for `1m`. Keep the output for the pull request ("before").
3. Rewrite step 2 of `snapToGrid` in `packages/typeset/src/grid.ts:43-56`. The rest of the file
   stays as it is: step 1 for the islands, the `snapped` `WeakMap` that undoes earlier snaps,
   `overflow-anchor: none`, `shortfall`, `isBlock` and `apply`.
   - Each **round** does three things. It reads the article's origin and every block child's top in
     one pass. It walks the children in order, carrying a running push, and plans a padding for
     each child whose top plus the push so far is off the grid. It writes all planned paddings in
     one `apply` call.
   - Rounds repeat until a round plans nothing, with at most four rounds.
   - Explain the bound in the code comment. A running delta drifts because a block's new
     `padding-bottom` can change how its margins collapse (MARXY-282,
     `docs/design/04-typeset.md` §Grid). That change happens at most once per element, when its
     padding goes from none to some. So the second round corrects what the first round's
     prediction missed, and a third round should find nothing.
   - The module must keep **no imports and no exports other than `snapToGrid`**, because
     `grid.test.mjs` loads its source with the types stripped.
   - Keep the signature `snapToGrid(article: HTMLElement, lineBox: number): number`. It still
     returns the number of elements padded.
4. Extend `packages/theme/test/grid.test.mjs`:
   - **An oracle.** Copy today's step-2 loop into the test as `snapSequential` and run it on a clone
     of each `CORPUS` document. At every width and size of the existing loop (`grid.test.mjs:124`),
     assert that the new pass pads the same elements by the same amount, within 0.5 px.
   - **A structural bound.** In the page, wrap `Element.prototype.getBoundingClientRect` and
     `CSSStyleDeclaration.prototype.setProperty` to log a read/write sequence during one
     `snapToGrid` call. Use `15-prose-volume.md` and a 256 KB document built with `generateLarge`.
     Assert that the number of reads that follow a write is at most 5 for both, so it does not grow
     with the document.
5. `scripts/perf-harness.test.mjs` (Node, in the root `pnpm test` glob `scripts/*.test.mjs`).
   `generateLarge` is deterministic (the same hash on two calls) and at least the requested size;
   `stageDeltas` maps a fixed mark list to the expected stages; `median` handles odd and even
   lengths.
6. Run the harness again ("after") and put both tables in the pull request.

**Acceptance.**
- The existing grid tests stay green with WebKit required. Every block is on the grid at three
  widths and four sizes (`packages/theme/test/grid.test.mjs:124`), and the MARXY-282 case still
  holds: after a push on the first of two adjacent blocks, the second lands on the grid
  (`grid.test.mjs:96`).
- The new oracle test passes: the same padded elements and amounts as the sequential pass, within
  0.5 px, on every corpus file, width and size (`grid.test.mjs`).
- The new structural test passes: at most 5 reads-after-write per call, on both the 53 KB and the
  256 KB document (`grid.test.mjs`).
- `node scripts/perf-harness.mjs --large 1m --runs 5` reports the median grid stage at 1 MB, before
  and after, in the pull request, with the time of `snapToGrid` alone; the reviewer re-runs it and
  quotes their numbers beside them. *Amended 2026-10-02 by the lead:* the original bound (grid stage
  at most 250 ms) moved to A-02. A-01 found that the stage is not the grid pass: 2.3–2.8 s of it is
  one forced restyle of the whole article, triggered by the first style read after the bundled fonts
  load (today `[...document.fonts]` in the `fonts_ready` mark's detail, `app.ts:1110`; stubbed out,
  the same cost moves to `snap()`'s `getComputedStyle`). The generated 1 MB document puts no block
  off the grid, so the old quadratic loop never ran on it. Outside A-01's paths.
- `pnpm gate:aesthetics` is green. It runs the same pass through `render/headless.ts:227`, so a
  changed padding would show up there.
- `scripts/perf-harness.test.mjs` is green in `pnpm test`.

**Tests.**
- Stay green: `pnpm --filter @marxy/theme test` and `pnpm --filter @marxy/typeset test`, both with
  `MARXY_BROWSER_TESTS_REQUIRED=1`; `apps/desktop/test/user-theme.test.mjs` (its scroll bound of
  8 px is the one MARXY-282 was held to); `pnpm gate:aesthetics`.
- New: the two `grid.test.mjs` cases and `scripts/perf-harness.test.mjs`.
- Run: `pnpm precheck`;
  `node scripts/perf-harness.mjs --build --files 01-long-technical.md,15-prose-volume.md --large 256k,1m`.

**Do not.**
- Change step 1 (the islands), the heading rule, `packages/theme/src/base.css`, or the grid unit
  (ADR-0030).
- Loosen any bound in any test.
- Touch `fixtures/baselines/`.
- Add an import to `grid.ts`.
- Edit `app.ts` or `render/headless.ts`; the callers do not change.
- Commit a generated large file. The harness generates them at run time, and `--write` goes to a
  path the caller names.

**Risks and open questions.**
- Each round may cost a full relayout of a 1 MB article (the first forced layout alone is 1.8 s in
  `05` §9.2). If the grid stage is still above 250 ms after this change, report the per-round times
  and stop; do not tune the target. The alternative the audit names, computing offsets from
  heights read once, is a design decision for the lead.
- If a corpus document needs more than four rounds, or the oracle and the new pass disagree
  anywhere, report the file, width and size, and do not loosen the comparison.
  `10-hostile.md` is the likely case.

### A-02 — Put first text on screen after the first screens and append the rest in idle chunks

**Model:** opus · **Size:** L · **Depends on:** A-01, A-04 · **Parallel with:** A-03, A-05, A-06

**Outcome.** A 1 MB transcript shows its first screen in well under a second, where today it shows
a blank window for 4–5 s. Marxy still parses and renders the whole document once. What changes is
what goes into the page before first text: only the blocks that fill the first two screens, or the
blocks around a remembered reading position. The rest is appended below in idle-time chunks, and
the grid pass, the typesetter and the reading position work on the part that is there. Documents
under a size threshold, which includes every corpus file, render exactly as today. The new code is
one object per article, so the per-article view of Phase B (ADR-0037 as amended) owns it as it
stands.

**Why now.** `05-performance-audit.md` §11.2 rank 8: the forced whole-document layout before first
text costs 1.8–2.3 s at 1 MB. §9.4 says Marxy falls over between 256 KB and 1 MB, and agent
transcripts and logs, the second content type in `docs/brief.md`, routinely exceed 1 MB.

**Paths.**
- `apps/desktop/src/render/progressive.ts` (new)
- `apps/desktop/src/app.ts`
- `packages/typeset/src/grid.ts`
- `packages/typeset/src/index.ts`
- `scripts/registry.json`
- `apps/desktop/test/progressive.test.mjs` (new)
- `docs/design/04-typeset.md`, §Grid only: one sentence that step 2 now runs in rounds (A-01) and
  takes `from` (this story)
- `changelog.d/A-02.md` (new)

**Build order.**
1. `apps/desktop/src/render/progressive.ts`. Its header comment says it is one per article and that
   Phase B's `RenderedView` owns it.
   ```ts
   export interface ProgressiveMount {
     /** Resolves when every top-level block is in the article. */
     readonly complete: Promise<void>;
     /** True when the whole document is in the article. */
     isComplete(): boolean;
     /** Appends synchronously until the block containing `byte` and `screens` screens below it are in. */
     ensureThrough(byte: number): void;
     /** Stops appending; nothing more is added (a new open, a teardown). */
     cancel(): void;
   }
   export function mountProgressively(
     article: HTMLElement,
     html: string,
     opts: {
       readonly thresholdBytes?: number;  // under this, assign the whole HTML as today; start at 65_536
       readonly screens?: number;          // default 2
       readonly landing?: number;          // a byte offset that must be in the first append
       readonly onChunk?: (added: readonly HTMLElement[]) => void;
     },
   ): ProgressiveMount;
   ```
   - **Under the threshold**, assign the whole HTML in one step, exactly as `assignHtml` does today
     (`app.ts:348-350`), and resolve `complete` at once.
   - **Over the threshold**, parse the HTML into a `<template>`. Move top-level nodes into the
     article until two things hold: its height is at least `screens × innerHeight`, and the block
     whose `data-marxy-s`/`data-marxy-e` range contains `landing` is in, with `screens` screens
     below it. Measure the height once per batch of nodes, not once per node. Then append the rest
     in chunks with an 8 ms time budget each, on the same idle scheduling `whenIdle` uses
     (`startup/idle-work.ts:33-48`, `setTimeout` in WebKit). Call `onChunk` after each chunk.
2. `scripts/registry.json`:
   - Add `apps/desktop/src/render/progressive.ts` to `innerHtmlAllowedIn`. The template is a new
     route from a string to parsed markup, and `check-registry` matches every such route.
   - Add the marks `first_screen` (detail `blocks=N bytes=M`) and `content_complete` (detail
     `ms=… chunks=…`).
3. `packages/typeset/src/grid.ts`. Add an optional third parameter
   `opts?: { readonly from?: HTMLElement }`:
   - Step 1 pads only the islands inside or after `from`.
   - Step 2 starts at `from`'s index. Its predecessor may still be pushed, because appending below
     a block can leave the first new child off the grid.
   - Earlier snaps are undone only from that predecessor on.
   - With no `from`, the behaviour is exactly A-01's, and A-01's oracle test stays green.
4. `packages/typeset/src/index.ts`. Add `adopt(roots: readonly HTMLElement[]): void` to
   `TypesetController`. It queues the `CANDIDATES` found inside `roots` into the background queue and
   the `IntersectionObserver` of `layout` (`index.ts:257-308`), and resolves `done` only after they
   are set.
5. `apps/desktop/src/app.ts`, in this order:
   - **`openDocumentThroughRenderMark`** (`app.ts:1079-1118`). Replace `assignHtml(doc, html)` with
     `mountProgressively(doc, html, { landing })`, keeping the mount in module state beside
     `typeset`. Keep the order of the marks: `rendered`, then the forced layout
     (`void doc.offsetHeight`), `fonts_ready`, `keepOnGrid`, `landOn`, `render`. Mark
     `first_screen` after the first append.
   - **`onChunk`** runs `snapToGrid(article, lineBox, { from: added[0] })` through the existing
     coalescing (`scheduleSnap`, `app.ts:711-721`), rebuilds `state.document.blocks` and calls
     `typeset?.adopt(added)`.
   - **`finishDocumentOpen`** (`app.ts:1120-1141`) awaits `mount.complete` before
     `runDeferredStartup`, so images, KaTeX and highlighting see the whole document. Mark
     `content_complete`.
   - **`teardownDocument`** (`app.ts:769-780`) cancels the mount.
   - **The other three render paths** use the same mount: `rerenderOpenDocument` (`app.ts:550-572`),
     `rerenderFromBuffer` (`app.ts:976-992`), and through it `reloadOpenFromDisk`
     (`app.ts:803-821`). Each calls `ensureThrough(position.byteOffset)` before
     `restoreScrollToPosition`, so a reload or an operation deep in the document lands where the
     reader was.
   - **The handle** gains `contentComplete(): Promise<void>` on `AppHandle`, so tests and the
     harness can wait for the whole document.
   - **The `fonts_ready` mark** (*added 2026-10-02 after A-01*). Its detail iterates
     `document.fonts` (`app.ts:1110`), which forces WebKit to restyle the whole article once the
     bundled fonts have loaded: 1.7–2.8 s at 1 MB, booked to the grid stage. Removing the spread
     alone saves nothing: the same restyle moves to the next style read (`snap()`'s
     `getComputedStyle`). The target is the restyle itself, which scales with what is in the
     article: make sure the first style read after the fonts load happens while the article holds
     only the first screens, and drop the face list from the mark's detail (or compute it after
     `content_complete`) so it cannot force the restyle early. Report, in the pull request, the
     stage breakdown at 1 MB before and after.
6. `apps/desktop/test/progressive.test.mjs`. It runs in WebKit on the app harness (`app.html`) with
   a 1 MB document built by `generateLarge` from `scripts/perf-harness.mjs`, and checks:
   - At `first_text` the article holds fewer top-level children than the document has, and
     `first_text` comes before `content_complete`.
   - After `contentComplete()`, `textContent` equals that of the same document mounted with
     `thresholdBytes: Infinity`.
   - After completion every block is on the grid, checked with the top-mod-unit rule of
     `grid.test.mjs`.
   - Opened with `at` at 80 % of the bytes, the block containing that byte is on the reading line
     after `first_text` and is still there after completion.
   - A live reload (`writeFileAtomic` plus `emit([{ kind: 'modified', path }])`, as
     `test/live-reload.test.mjs` does) keeps the reading byte within one block.
   - `commitEdit` of a one-byte change at 1 MB keeps the reading position.
   - Opening a second document while chunks are still pending leaves `debugCounts()` at one
     typesetter and one resize observer, and adds no stray nodes to the article.
   - A corpus document (`01-long-technical.md`) emits `first_screen` with all of its blocks and
     resolves `contentComplete` at once.
7. Run `node scripts/perf-harness.mjs` for the corpus, `256k` and `1m`, before and after, and put
   both in the pull request.

**Acceptance.**
- At 1 MB, the median `first_text` of 5 runs is at most 1,000 ms (the target is 800), down from
  4.2–5.2 s in `05` §9.1. Measured with `scripts/perf-harness.mjs`; the before and after are in the
  pull request and the reviewer re-measures.
- At 256 KB, the median `first_text` is at most 300 ms, down from 550 ms. Same harness.
- For every corpus file, `first_text` is within ±10 % of the before numbers, because these
  documents stay under the threshold. Same harness.
- Each case in `apps/desktop/test/progressive.test.mjs` passes with WebKit required.
- `pnpm check` passes, with `check-registry` accepting the new route and marks.
- `pnpm gate:golden`, `pnpm gate:no-network` and `pnpm gate:aesthetics` are unchanged and green.
- The desktop suite is green with WebKit required, in particular `open-path`, `live-reload`,
  `persist-reading`, `operations-edit`, `palette-index` and `app-harness`.

**Tests.**
- Stay green: `MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test`; the theme and
  typeset packages with WebKit required; the A-01 oracle test.
- New: `apps/desktop/test/progressive.test.mjs`.
- Run: `pnpm precheck`, `pnpm gate:aesthetics`, `pnpm gate:no-network`,
  `node scripts/perf-harness.mjs --files 01-long-technical.md,15-prose-volume.md,32-long-reference.md --large 256k,1m`.

**Do not.**
- Split the parse or the HTML render. There is still one parse and one AST (ADR-0003), and
  `05` §11.3 calls chunked parse speculative.
- Use `content-visibility: auto` instead of chunking. It is the audit's alternative, and if chunking
  cannot meet the acceptance, report before switching.
- Change the reading-position model in `apps/desktop/src/position/` or the typesetter's line
  breaking.
- Lower the threshold so that corpus files take the new path. That would move screenshot baselines
  and needs the author.
- Touch `startup/idle-work.ts`; the index has left it (A-04).

**Risks and open questions.**
- Parse plus render alone is about 540 ms at 1 MB in WebKit (`05` §9.1: 385 + 156). If `first_text`
  is still above 1 s after this change, report the stage breakdown. Parsing in a worker or
  rendering in chunks is a separate decision.
- While chunks are pending, select-all followed by copy takes only the part that is there, and a
  screen reader sees a shorter page for a moment. Note both in the pull request; do not build a
  workaround.
- WebKit throttles timers in a window that cannot paint, so `content_complete` can arrive late on a
  locked screen (`05` §9.3). It does not affect `first_text`.
- The threshold is a guess. If the harness shows that a lower one helps the 53 KB prose document
  without moving any baseline, report the numbers instead of changing it.

### A-03 — Measure nightly, not on pull requests, and delete the product tier

**Model:** opus · **Size:** L · **Depends on:** A-01, A-08 · **Parallel with:** A-02, A-05, A-06

**Outcome.** Every night, CI measures what a reader feels on the app harness: first text for the
corpus and the large files, the typeset viewport, live reload, opening a second document, and
palette search at 5,000, 20,000 and 50,000 entries. It also records a macOS start-up with every
mark. It writes one record per run, and fails only when a measurement produced no sample. Pull
requests no longer build the app twice to measure two numbers that cannot fail. The perf gate,
the parse measurement and the "product" and "ci" tiers of `fixtures/perf-budgets.json` are
deleted, about 1,000 lines. `pnpm perf` runs the same harness locally.

**Why now.** `05-performance-audit.md` §10 (the CI apparatus measures two numbers that cannot fail
and never sees five of the seven budgets) and §11.1 rank 5. Amendment 10 in `10-overfit-decisions.md`
§5 deletes the product tier. `04-tests-and-gates.md` §6.1 moves start-up and parse measurement off
the pull-request path.

**Paths.**
- `scripts/perf-harness.mjs`, `scripts/perf-harness.test.mjs`
- `scripts/gate-perf.mjs` (delete), `scripts/measure-parse.mjs` (delete), `scripts/ci-summary.mjs` (delete)
- `scripts/measure-startup.mjs`
- `fixtures/perf-budgets.json`
- `scripts/gates-by-path.json`
- `package.json`, the `gate:perf` and `perf` scripts only
- `.github/workflows/ci.yml`, the measurement steps of the `gates` job only (`ci.yml:240-264`)
- `.github/workflows/nightly.yml`
- `apps/desktop/src/palette/search-perf.test.ts`
- `packages/core/src/parse/parse.test.ts` and `packages/core/src/sanitize/budget.test.ts`, the
  comments that name `gate-perf` and `measure-parse` only (`parse.test.ts:371,407`, `budget.test.ts:7`)
- `changelog.d/A-03.md` (new)

**Build order.**
1. Add the remaining harness modes to `scripts/perf-harness.mjs`:
   - **`--reload`.** After boot, append bytes through `handle.shell.writeFileAtomic` and call
     `emit([{ kind: 'modified', path }])`, then read the `ms=` of the `live_reload` mark
     (`05` §8.1).
   - **`--open-second`.** Boot on one document, then `handle.open('/docs/other.md')`; record the
     time from the call to the next `render` mark (`05` §8.2).
   - **`--palette`.** Runs in Node with no browser. Call `prepareIndex` and then `searchPrepared`
     200 times, at 5k, 20k and 50k synthetic entries shaped like those in
     `apps/desktop/src/palette/search-perf.test.ts`, and record p50 and p95 (`05` §7.1).
   - **`--record <path>`.** Write one JSON record with the date, the commit
     (`git rev-parse HEAD`), the runner (`MARXY_RUNNER_CLASS`, or the OS and architecture), the Node
     and WebKit versions, and the numbers. Exit non-zero only if a requested measurement produced
     no sample (ADR-0032).
2. `scripts/measure-startup.mjs`:
   - Record **every** `MARK` line of every launch, not only `first_text`. A launch that never
     paints, such as one on a locked screen, still yields the shell stages and says `no_paint`
     (`05` §4.1, §12 point 7).
   - Remove its dependence on `gate-perf.mjs` and on the `ci` tier of `perf-budgets.json`. That
     includes the runner-class requirement at `measure-startup.mjs:484-485` and the cross-file
     selftest count.
   - Keep `--selftest` for its own rules.
3. Delete `scripts/gate-perf.mjs`, `scripts/measure-parse.mjs`, `scripts/ci-summary.mjs` and their
   test files, if any (`git ls-files scripts | grep -E 'gate-perf|measure-parse|ci-summary'`). The
   parse number now comes from the harness as `parsed − file_read`.
4. `package.json`. Delete `gate:perf` and add `"perf": "node scripts/perf-harness.mjs"`.
   `scripts/gates-by-path.json`: delete the `fixtures/perf-budgets.json` entry.
5. `fixtures/perf-budgets.json`. Keep only `bundle_installed_mb`, which `scripts/gate-bundle.mjs:144`
   reads, and a one-line `note` naming ADR-0032 and the nightly record. Delete `product` and `ci`.
6. `.github/workflows/ci.yml`. In the `gates` job, delete six steps: "Startup measurement", "Perf
   gate rules selftest", "Perf budgets are unchanged", "Parse measurement", "Perf gate" and
   "Startup numbers in the job summary" (`ci.yml:240-264`). Leave every other step; A-09 rewrites
   the job.
7. `.github/workflows/nightly.yml`. Add two jobs, each with `timeout-minutes`:
   - **`perf-harness`** runs on `ubuntu-latest` in the same Playwright container as
     `aesthetics-determinism`. Steps: install, `pnpm --filter @marxy/desktop build:web`, then
     `pnpm perf --files <every corpus .md except 11-empty> --large 256k,1m --reload --open-second --palette --record results/perf-nightly.json`.
     Upload `results/` as an artifact and append a short table to `$GITHUB_STEP_SUMMARY`.
   - **`startup-macos`** runs on `macos-latest`. Steps: mise, install, `Swatinem/rust-cache`,
     `build:web`, then
     `cargo build --locked --profile ci --features tauri/custom-protocol` in
     `apps/desktop/src-tauri`, then `node scripts/measure-startup.mjs` with
     `MARXY_PERF_REQUIRED=1`. Upload `results/`.
8. `apps/desktop/src/palette/search-perf.test.ts`. Delete the timing assertion at lines 97-100.
   Keep the run and add one correctness check: a query known to match returns hits. The number now
   lives in `pnpm perf --palette`.
9. Update the comments in `parse.test.ts` and `budget.test.ts` that name the deleted scripts.

**Acceptance.**
- `pnpm perf --build --files 01-long-technical.md --large 256k --reload --open-second --palette --record <tmp>`
  writes a record that holds `first_text`, `typeset_viewport`, `live_reload`, `open_render` and
  palette p95 at three sizes. `scripts/perf-harness.test.mjs` asserts the record's shape on a
  canned mark list.
- `git grep -n -E 'gate-perf|measure-parse|ci-summary|gate:perf' -- ':!docs' ':!CHANGELOG.md' ':!changelog.d' ':!orchestration'`
  (*amended 2026-10-02 by the lead*: `orchestration/` is frozen and holds only fixture text; the stale
  comment at `scripts/ci-changes.mjs:145` belongs to A-09)
  prints nothing. The output is pasted in the pull request.
- `fixtures/perf-budgets.json` has no `product` and no `ci` key, and `pnpm gate:bundle` still
  passes.
- The `gates` job in `ci.yml` runs no measurement; `nightly.yml` has the two new jobs. Both pass
  `pnpm check` (the `check-workflows` rules from A-08: actions pinned, `timeout-minutes` on every
  job, no `continue-on-error`).
- `node scripts/measure-startup.mjs --selftest` is green, and one real run on the author's machine
  writes a record with every mark. The record is pasted in the pull request.
- `pnpm test` is green, and `search-perf.test.ts` asserts no time.

**Tests.**
- Stay green: `pnpm test`, `pnpm check`, `pnpm gate:bundle`.
- New: the extended `scripts/perf-harness.test.mjs`.
- Run: `pnpm precheck`, and the `pnpm perf` command above.

**Do not.**
- Add a timing assertion anywhere, or make a nightly job fail on a number.
- Touch `scripts/gate-bundle.mjs`, the `bundle_installed_mb` key, or any non-measurement step of the
  `gates` job.
- Delete `measure-startup.mjs`; the nightly macOS job uses it.
- Edit `docs/hygiene.md` or `docs/ci-contract.md`; A-11 rewrites them.
- Touch `apps/desktop/test/palette.test.mjs`. Its keystroke sample may keep writing to `results/`.

**Risks and open questions.**
- Playwright WebKit on a Linux runner is a different engine build and a slower machine than the
  author's Mac. The nightly numbers are a trend, not a comparison with `05`. Say so in the record's
  `note`.
- `smoke-cli-open.mjs` and `measure-startup.mjs` share `MARXY_BIN`. If removing the gate changes
  how the binary is found, report rather than rename.

### A-04 — Give the index an owner: one index per root, published to the palette

**Model:** opus · **Size:** M · **Depends on:** A-07 · **Parallel with:** A-01, A-08, A-12

**Outcome.** The two search defects a reader hits at once are gone. Launch Marxy from the Dock with
no document, open a file, and the palette searches that file's repository. Open a file in a second
repository, and the palette searches both, not only the first. Behind that, the index becomes a
service keyed by repository root. It walks each root once per session, publishes the entries of
every root opened so far to whoever subscribes, and refreshes when the open document's directory
changes. Ticking a checkbox, folding a Source edit, granting trust or reloading from disk no longer
walks the whole repository and throws the result away. Index reads no longer leave a copy of every
markdown file in the shell's stale-write table, and the recent-roots list records repository roots
instead of directories.

**Why now.** `01-codebase-audit.md` §1.3 reproduces both defects and the re-walk on every render, and
§8.1 and `12-recommendation-codebase.md` step 1 put this first: it is a bug fix today and the
foundation of collections (Phase C). `06-feature-collection-and-search.md` §1.2 finds recent roots
keyed by `dirname`.

**Decision on the walker.** It stays in TypeScript. The Rust indexer
(`apps/desktop/src-tauri/src/index/mod.rs`, 573 lines, no `mod index;` in `main.rs:3-8`) is not
wired here, and Phase B deletes it with the other dead code (`12` step 4). The collection study
measures the TypeScript matcher at 6.6 ms p95 at 20k entries
(`06-feature-collection-and-search.md` §6.2), and A-05 cuts the walk's shell calls. Revisit only if
A-03's nightly record shows a walk of the author's largest root above one second.

**Paths.**
- `apps/desktop/src/index/service.ts` (new)
- `apps/desktop/src/index/walk.ts` (new; `loadIndex` and its helpers moved out of `startup/idle-work.ts`)
- `apps/desktop/src/startup/idle-work.ts`
- `apps/desktop/src/app.ts`
- `apps/desktop/src/main.ts`
- `apps/desktop/src/palette/history.ts`, `trackDocumentOpen` and `notePaletteOpen` only
- `apps/desktop/test/index-service.test.mjs` (new)
- `apps/desktop/test/palette-index.test.mjs`
- `changelog.d/A-04.md` (new)

**Build order.**
1. Move the walk into `apps/desktop/src/index/walk.ts` without changing its behaviour.
   - The functions to move are `loadIndex`, `detectIndexRootAsync`, `pathHasGit`, `pathIsDirectory`
     and `prefetchDirectoryReader` (`startup/idle-work.ts:142-270`), together with the
     `IndexLoadShell` interface and `LOAD_INDEX_EMPTY_MUTATION`.
   - Export `rootFor(shell, path): Promise<string>`, built from `detectIndexRootAsync`.
   - Re-point the imports in `test/palette-index.test.mjs`.
2. Delete the `index` step from `runDeferredStartup` (`idle-work.ts:106-116`) and
   `onIndexLoaded` from `DeferredStartupContext` (`idle-work.ts:55`). Images, KaTeX, highlighting
   and table scrollers stay where they are.
3. `apps/desktop/src/index/service.ts`:
   ```ts
   export interface IndexService {
     rootFor(path: string): Promise<string>;   // cached per directory
     ensureFor(path: string): Promise<void>;  // root of path; walk once per session; publish
     refresh(root: string): void;             // coalesced re-walk on the idle queue
     entries(): readonly IndexEntry[];         // every indexed root, most recently ensured first
     subscribe(cb: (entries: readonly IndexEntry[]) => void): () => void; // called now and on change
   }
   export function createIndexService(shell: IndexLoadShell & { mark?: (...) => Promise<void> }): IndexService;
   ```
   - Two calls to `ensureFor` for the same root share one walk.
   - Every walk emits the existing `index_loaded` mark with `entries=N root=…`.
   - The ceiling notice (`idle-work.ts:109-114`) moves here unchanged.
4. `apps/desktop/src/app.ts`:
   - In `startApp` (`app.ts:1304-1399`), create one service per launch. Give it a shell whose
     `readFile` is `shell.peekFile ?? shell.readFile`. Through `peekFile`, index reads no longer
     land in `lastRead` (`shell/tauri.ts:93-97`), and `tauri.ts` itself does not change.
   - Expose the service as `AppHandle.index` (`app.ts:124-163`).
   - Delete `deliverIndex` (`app.ts:366-367`), the `onIndexLoaded` option (`app.ts:1309`) and its
     use in `deferredStartupContext` (`app.ts:379`).
   - In `finishDocumentOpen`'s idle block (`app.ts:1125-1129`), call
     `void index.ensureFor(file)`.
   - In `handleDocumentWatch` (`app.ts:823-866`), call `index.refresh(root)` when an event names a
     markdown file. The watch is the document's directory only; recursive watching is Phase C.
   - Pass the root to `trackDocumentOpen` (`app.ts:1175`):
     `void index.rootFor(file).then((root) => trackDocumentOpen(file, root))`.
5. `apps/desktop/src/main.ts`. Replace the one-shot hand-off (`main.ts:11-14`) with
   `handle.index.subscribe((entries) => palette.setIndexEntries(entries))` after the palette is
   mounted.
6. `apps/desktop/src/palette/history.ts`. `trackDocumentOpen(path, root)` and
   `notePaletteOpen(shell, path, session, root)` record the given root instead of `dirname(path)`
   (`history.ts:160-164`, `222-227`).
7. Tests (step 8).

**Acceptance.**
- `apps/desktop/test/index-service.test.mjs` reproduces the three scenarios of `01` §1.3 [C9]. It
  runs in WebKit on `test/palette-boot.html` over a memory shell with repositories `/a` and `/b`,
  and types `notes` in the palette each time:
  - Launch with `/b/README.md`: the query finds Notes. This is the control.
  - Launch with **no document**, then `handle.open('/b/README.md')`: the query finds Notes. It
    finds nothing today.
  - Launch with `/a/README.md`, then open `/b/README.md`: the query finds `/b`'s document and still
    finds `/a`'s. Today it finds neither.
- Three `handle.commitEdit` calls leave the `index_loaded` mark count and the `readDir` call count
  unchanged. This is `01` §1.3 [C10]. Same test file.
- `ensureFor` twice on the same root walks once, and two roots publish the union of their entries.
  This runs in Node with `createMemoryShell` in the same test file.
- No `readFile` call made by the index appears in the Tauri shell's `lastRead`. The test is a Node
  unit test with a fake `invoke`, in the style of `test/tauri-stale-write.test.mjs`, asserting that
  index reads go through `peekFile`.
- `history.json` records `/a` and `/b` as roots, not `/a/docs`. Covered in
  `index-service.test.mjs`.
- `test/palette-index.test.mjs` is green with its imports moved.

**Tests.**
- Stay green, with WebKit required: `palette-index.test.mjs`, `palette.test.mjs`, `app-harness.test.mjs`,
  `open-path.test.mjs`, `live-reload.test.mjs`, `operations-edit.test.mjs`, `post-passes.test.mjs`,
  and `src/startup/static-import-graph.test.mjs`. That last one checks what the startup path
  imports; keep the new `index/` modules off the critical path.
- New: `apps/desktop/test/index-service.test.mjs`.
- Run: `pnpm precheck`, `pnpm gate:bundle`, `MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test`.

**Do not.**
- Wire, edit or delete the Rust indexer.
- Change `packages/core/src/contracts/index-entry.ts`. It is hash-frozen, and nothing here needs it.
- Change the ranking in `palette/search.ts`; A-06 does that.
- Edit `palette/view.ts`.
- Add a recursive watch.
- Remove the `MARXY_196_MUTATION` hook. It moves with `loadIndex`, and Phase B removes all of them.
- Walk before `first_text` (`INDEX_SCHEDULE.precedesFirstPaint` is false).

**Risks and open questions.**
- How should the union order roots? The service puts the most recently ensured root first, and
  `searchPrepared` already prefers `session.currentRoot` (`search.ts:85-108`). The palette session's
  `currentRoot` is fixed in A-06. Until then, ranking across roots works as it does today, by the
  accident `06` §1.2 describes.
- A root whose `.gitignore` excludes the opened file still indexes that file today. Keep that
  behaviour.

### A-05 — Walk a root in fewer shell calls, from a snapshot

**Model:** sonnet · **Size:** M · **Depends on:** A-04 · **Parallel with:** A-02, A-03, A-06

**Outcome.** The palette has results the moment a known repository is opened, because the
service serves the last session's index from disk and then checks it in the background. The check
reads only what changed: one directory listing per directory, the `.gitignore` and `.ignore` files
that actually exist, and the headings of markdown files whose size or modification time moved. On
this repository a warm walk drops from about 975 shell calls (`05` §7.2) to about 160. A cold walk
still reads every markdown file once.

**Why now.** `05-performance-audit.md` §7.2: the walk makes 975 IPC calls for this repository (155
`readDir`, 312 ignore probes, 508 heading reads), and §11.1 rank 2. `06` §6.4 story 3: persist and
validate the snapshot that `packages/core/src/index-model/persist.ts` already defines.

**Paths.**
- `apps/desktop/src/index/walk.ts`
- `apps/desktop/src/index/service.ts`
- `apps/desktop/test/index-service.test.mjs`
- `apps/desktop/test/app-harness.test.mjs`, `close-guard.test.mjs`, `live-reload.test.mjs`,
  `persist-reading.test.mjs`: only to leave the snapshot's `/data/index-*` read and write out of
  their exact shell-call assertions (*added 2026-10-02 by the lead*)
- `changelog.d/A-05.md` (new)

**Build order.**
1. In `walk.ts`, change `prefetchDirectoryReader` so it no longer probes `.gitignore` and `.ignore`
   for every subdirectory before listing it (`idle-work.ts:245-255` before the move). After listing a
   directory, it reads an ignore file only if that listing contains one.
2. Give `loadIndex` an optional `previous?: IndexSnapshot`. For a markdown candidate whose
   `mtimeMs` and `size` equal the snapshot entry, reuse that entry's headings and title; read bytes
   only for new or changed files.
3. In `service.ts`, persist one snapshot per root at `<data>/index/<sha1(root)>.json`. The data
   directory comes from `shell.configPaths()`, and the hash from `crypto.subtle.digest('SHA-1', …)`.
   - Use `serializeSnapshot`, `parseSnapshot` and `invalidateByMtime` from
     `packages/core/src/index-model/persist.ts`.
   - On `ensureFor`, read the snapshot through `peekFile` and publish its entries at once, with the
     mark `index_loaded` and detail `source=snapshot`.
   - Then walk with `previous`, publish (`source=walk`) and write the new snapshot with
     `writeFileAtomic`.
   - A snapshot that does not parse is ignored and overwritten. Use the quarantine rule of
     `docs/design/11-config-and-storage.md` "Data files" only if this is cheap.
4. Add `calls=N` to the `index_loaded` detail: the shell calls this walk made.
5. Extend `test/index-service.test.mjs` with a counting memory shell (`createMemoryShell`'s `calls`).

**Acceptance.**
- A cold walk of a fixture tree makes exactly `readDir` × directories + `readFile` × ignore files
  present + `readFile` × markdown files + the root probes. The test asserts the exact count for a
  fixture with three directories, one `.gitignore` and four markdown files
  (`index-service.test.mjs`).
- A second service in a fresh session, over the same tree with the snapshot present, publishes
  entries **before** its first `readDir` resolves, and makes zero markdown `readFile` calls when
  nothing changed (`index-service.test.mjs`).
- Changing one file's bytes and modification time leads to exactly one markdown `readFile` and
  updated headings for that entry (`index-service.test.mjs`).
- The snapshot file is written under `/data/index/` in the memory shell (`index-service.test.mjs`).
- The pull request reports the `calls=` detail for a cold and a warm launch on this repository,
  using the built app or the app harness pointed at a copy of the tree.

**Tests.**
- Stay green: `test/palette-index.test.mjs`, the A-04 cases in `test/index-service.test.mjs`, and
  `packages/core/src/index-model/*.test.ts`.
- Run: `pnpm precheck`, and `MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test`.

**Do not.**
- Change `persist.ts`'s on-disk shape or `INDEX_SNAPSHOT_VERSION`.
- Change `index-entry.ts`.
- Add a Rust command.
- Serve a snapshot entry whose file is gone after the walk. The walk's publish replaces the
  snapshot's.

**Risks and open questions.**
- If `write_file_atomic` does not create missing parent directories, write the file flat as
  `<data>/index-<sha1>.json` and say so in the pull request. Do not add a shell member.
- `.git` is on the deny list, so a listing never shows it. Root detection keeps its two `readFile`
  probes per level, and that count is part of the expected total.

### A-06 — Make the palette's ranking fields honest

**Model:** sonnet · **Size:** M · **Depends on:** A-04, A-12 · **Parallel with:** A-02, A-03, A-05

**Outcome.** The palette remembers when the reader actually opened each document, across restarts.
A document read an hour ago outranks one read last week when their matches are otherwise equal, and
the history survives a crash because it is written on every open, not only at quit. Opening a
document from the palette also tells the session which repository it is in, so the current
repository's hits come first.

**Why now.** `06-feature-collection-and-search.md` §1.2 and §6.4 story 2 find the dead fields:
`entry.lastReadMs` is read in two places (`palette/search.ts:184,195`) and set nowhere;
`historyFromSession` rewrites every open's time as `now − n` (`palette/history.ts:111-129`);
`history.json` is written only at quit (`history.ts:209-220`); and `activateHit` records an open
without its root (`palette/view.ts:391-400`), so `session.currentRoot` never moves off `'/'`.

**Paths.**
- `apps/desktop/src/palette/session.ts`
- `apps/desktop/src/palette/history.ts`
- `apps/desktop/src/palette/search.ts`
- `apps/desktop/src/palette/view.ts`, `activateHit` and `setIndexEntries` only
- `apps/desktop/src/palette/session.test.ts`
- `apps/desktop/src/palette/search.test.ts`, new cases only; leave lines 1-35
- `apps/desktop/src/palette/history.test.ts` (new; the glob `src/palette/*.test.ts` picks it up)
- `changelog.d/A-06.md` (new)

**Build order.**
1. `session.ts`.
   - `PaletteSession` gains `readAt: Readonly<Record<string, number>>`, the epoch milliseconds of
     the last open per path.
   - `recordOpen(session, path, root?, now = Date.now())` sets it, and so do `goBack`/`goForward`
     through `touchMru`, because going back is a read.
   - `emptySession` starts it empty.
2. `history.ts`.
   - `historyFromSession` writes each open's `at` from `readAt`. It falls back to the current
     synthetic value only for a path with no recorded time.
   - `sessionFromHistory` fills `readAt` from the opens' `at`.
   - `trackDocumentOpen` records the time.
   - **Write on open.** `loadPaletteHistory` remembers its I/O. `trackDocumentOpen` and
     `notePaletteOpen` schedule one debounced `savePaletteHistory`, 1 s after the last open. The
     quit flush stays.
3. `search.ts`. `prepareIndex(entries, readAt?)` copies `readAt[entry.path]` into each prepared
   row's `lastReadMs`. `frecencyBonus` and `compareHits` read the prepared value. The keystroke path
   (`searchPrepared`) gains no work.
4. `view.ts`.
   - `activateHit` calls `recordOpen(session, jump.path, hit.entry.root)`.
   - `setIndexEntries` and every session change that alters `readAt` re-prepare with
     `prepareIndex(entries, session.readAt)`. That is once per open, never per keystroke.

**Acceptance.**
- A restart keeps relative recency. Two opens an hour apart under an injected clock, serialised and
  parsed back, give the same order and the same `at` values (`history.test.ts`).
- With two entries that score equally, the one read more recently ranks first
  (`search.test.ts`, a new case).
- `activateHit` on a hit in root `/b` sets `session.currentRoot` to `/b`, and `/b`'s hits then come
  before `/a`'s (`session.test.ts` for the session; `search.test.ts` for the order).
- After `trackDocumentOpen` and 1 s of fake time, the memory shell records one `writeFileAtomic` to
  `/data/history.json` (`history.test.ts`).
- With a single root and no history, the typed results of the existing tests do not change
  (`search.test.ts`, `palette.test.mjs`).

**Tests.**
- Stay green: `src/palette/*.test.ts`, `test/palette.test.mjs` and `test/palette-input-guards.test.mjs`,
  and the mutation re-run in `apps/desktop/package.json`'s `test` script, which must still fail as
  designed.
- New: `history.test.ts`.
- Run: `pnpm precheck`, and `pnpm --filter @marxy/desktop test`.

**Do not.**
- Change `index-entry.ts`. `lastReadMs` already exists there.
- Change the scoring weights in `search.ts:176-187`; they are taste (ADR-0031's rule).
- Add an mtime tie-break; that is Phase C.
- Touch `searchPrepared`'s loop or `search.test.ts:20-34`, which A-10 rewrites.
- Persist anything beyond `history.json`'s existing shape (version, opens with `at`, pins,
  recent roots).

**Risks and open questions.**
- `flushPaletteHistoryFromApp` merges two sessions (`history.ts:166-220`). If the debounced write
  races the quit flush, the quit flush wins. Test that, or report it.

### A-07 — Pause the fleet and unlock the conventions job

**Model:** sonnet · **Size:** S · **Depends on:** — · **Parallel with:** none (Wave 0, lands alone)

**Outcome.** A reader of the repository sees at once that the fleet is paused, why, and the five
measurable conditions for resuming it. Work no longer needs a Jira key, a board row or an enforced
pull-request body to merge. A commit subject may end in a story id such as `(A-07)`, in a
`MARXY-nnn` key, or in nothing. The orchestrator's 440 tests leave the product's `pnpm test` and run
as `pnpm test:fleet`. The Jira project stays as a historical record that nothing writes to.

**Why now.** `13-recommendation-orchestrator.md` §3.1 (stop) and §4 (the five resume conditions);
ADR-0051. Every later story in this plan depends on branches without a `MARXY` key being able to
merge.

**Paths.**
- `orchestration/PAUSED.md` (new)
- `commitlint.config.mjs`
- `package.json`, the `test` script and a new `test:fleet`
- `.github/workflows/ci.yml`, the `conventions` job and one step in `fast`
- `scripts/check-story.test.mjs`, delete the "MARXY-153: the CI story-boundary step runs unguarded"
  test only (`check-story.test.mjs:118-122`)
- `AGENTS.md`, a pointer paragraph at the top only
- `docs/ci-contract.md`, a banner at the top only
- `changelog.d/A-07.md` (new)

**Build order.**
1. `orchestration/PAUSED.md`. One page, in this order:
   - the fleet is paused since 2026-09-29, under ADR-0051 (proposed);
   - why, in two sentences from `13` §1;
   - what not to run (`loop.sh`, `cycle.mjs`, the planner, `jira.mjs push`/`sync`);
   - that the Jira project MARXY is a historical record and nothing mirrors to it;
   - where the plan now lives (`docs/plan/roadmap-2026-10/`);
   - the five resume conditions of `13` §4, each with its command;
   - the pilot shape and stop rules of `13` §4.

   Nothing else in `orchestration/` changes.
2. `commitlint.config.mjs`.
   - Replace the rule `marxy-key-in-subject` (`commitlint.config.mjs:25-33`) with
     `marxy-ref-in-subject`. A subject may end in `(MARXY-n)`, a story id `(A-nn)` (the pattern
     `[A-E]-\d{2}(\.\d)?`), or neither, each optionally followed by ` (#n)`. A trailing parenthesis
     that looks like a key but is malformed, for example `(MARXY-)` or `(a-01)`, is an error.
   - Update `selftest()` (`commitlint.config.mjs:98-`). The "bare key" case becomes a pass, and add
     cases for `(A-07)`, `(MARXY-12) (#3)`, `(A-07.1)` and a malformed key.
3. `package.json`. Make `test` the same minus `orchestration/*.test.mjs orchestration/test/*.test.mjs`,
   and add `"test:fleet": "node --test orchestration/*.test.mjs orchestration/test/*.test.mjs"`.
4. `.github/workflows/ci.yml`.
   - In `conventions` (`ci.yml:49-76`), delete the steps "Commit messages follow
     docs/conventions.md" (the commit-range lint; a squash keeps only the title), "PR body follows
     the template…" (`check-pr`), and "Story boundary over the whole branch" (`check-story --strict`).
   - Keep "PR title is a valid squash subject" verbatim. `orchestration/pr-mark.test.mjs:30-32`
     asserts that it calls `pr-mark.mjs --bare`.
   - In `fast`, add a step `pnpm test:fleet` after `pnpm test`. A-09 path-filters it later.
5. `scripts/check-story.test.mjs`. Delete the test that asserts the `--strict` step exists
   (`check-story.test.mjs:118-122`).
6. `AGENTS.md`. Add a paragraph under the title saying that the fleet is paused (link
   `orchestration/PAUSED.md`), that `MARXY` keys, board rows and the enforced pull-request body are
   no longer required, and that the rest of this file is being rewritten in A-11.
   `docs/ci-contract.md` gets a two-line banner saying the same.

**Acceptance.**
- `node commitlint.config.mjs --selftest` is green, with the new cases.
- `printf 'perf(typeset): one read pass (A-01)\n' | pnpm exec commitlint`,
  `printf 'docs: a note\n' | pnpm exec commitlint` and
  `printf 'fix(core): x (MARXY-12) (#3)\n' | pnpm exec commitlint` all exit 0;
  `printf 'fix(core): x (MARXY-)\n' | pnpm exec commitlint` exits non-zero. The output goes in the
  pull request.
- `pnpm test` runs no file under `orchestration/`, and `pnpm test:fleet` runs them and is green.
  Show the `ℹ tests` lines of both.
- This pull request, on a branch named `chore/a-07-pause-the-fleet` with the subject
  `chore(repo): pause the fleet and unlock the conventions job (A-07)`, is green in CI. It is its
  own proof.
- `orchestration/PAUSED.md` lists five conditions, each with a runnable command copied from `13` §4.
  A reviewer reads it.

**Tests.**
- Stay green: `pnpm test`, `pnpm test:fleet` (including `orchestration/pr-mark.test.mjs` and
  `orchestration/docs.test.mjs`), and `pnpm check:story` locally (not strict).
- Run: `pnpm precheck`.

**Do not.**
- Change any file under `orchestration/` other than adding `PAUSED.md`. Leave `loop.sh`,
  `fleet.mjs` and `models.json` as they are.
- Delete `scripts/check-story.mjs`, `scripts/check-pr.mjs`, `scripts/done.mjs` or `scripts/open-pr.mjs`.
  They stay as optional local tools.
- Touch the `fast`, `browser` or `gates` steps beyond the one added step.
- Edit the rest of `AGENTS.md` or `docs/ci-contract.md`.
- Change branch protection. The one required check stays `ci`.

**Risks and open questions.**
- `orchestration/docs.test.mjs` checks that every orchestration file a live document names exists.
  `PAUSED.md` names only real files; run `pnpm test:fleet` to confirm.
- The pre-commit hook runs `check-story --staged` without `--strict`. With no key, it prints a note
  and passes, and that is intended.

### A-08 — Make one `pnpm check`, and delete the checks of CI's own shape

**Model:** sonnet · **Size:** M · **Depends on:** A-07 · **Parallel with:** A-01, A-04, A-12

**Outcome.** One command, `pnpm check`, runs the eight hygiene checks (boundaries, registry,
dependencies, deferrals, one parser, theme tokens, font attributes, workflows). It reports each in
one line and gives a fix line for each failure. CI runs that one command. Two meta-checks that
protect nothing a reader needs are deleted: the branch-protection gate, which is stale against
ADR-0040, wired to nothing and red today, and the inline biome-contract script, which takes 20 s
locally once a Rust `target/` exists. The gate scripts stop asserting what `ci.yml` looks like.
One rule, "no `continue-on-error`, no `|| true`", lives in `check-workflows`, where today nine
files each hold a copy. After this, editing a workflow means editing the workflow. The desktop unit
test that launched the real app binary when one had been built no longer does.

**Why now.** `04-tests-and-gates.md` §5 (ten files each assert their own idea of `ci.yml`) and §6.1,
the "Merge", "Delete" and "Fix" rows. The later CI stories (A-03, A-09, A-10) cannot change a job
without this.

**Paths.**
- `scripts/check.mjs` (new), `scripts/check.test.mjs` (new)
- `package.json`: `check` added; `check:boundaries`, `check:registry`, `check:deps`, `check:deferrals`,
  `check:one-parse`, `check:workflows`, `gate:font-attrs` and `lint:biome-contract` removed;
  `lint` and `test` adjusted
- `.github/workflows/ci.yml`, the hygiene step of `fast` only (`ci.yml:94`)
- `scripts/gate-protection.mjs` (delete), its fixtures directory and its test files (find them with
  `git ls-files | grep gate-protection`)
- `scripts/check-workflows.mjs` and its test file
- `scripts/gate-licences.mjs`, the workflow checks only (`gate-licences.mjs:390-430`, `439-443`, `707-712`)
- `scripts/gate-fidelity.mjs`, the workflow check only (`gate-fidelity.mjs:605-635`)
- `scripts/specimen/verify.mjs`, the workflow checks only (`verify.mjs:29-36`)
- `packages/core/scripts/commonmark-spec.ts`, the `continue-on-error`, `|| true` and conditional-step
  checks only (`commonmark-spec.ts:80-91`); keep the checks that the spec step exists and takes its
  URL from the script
- `apps/desktop/scripts/smoke-verdict.test.mjs`
- `scripts/precheck.mjs`, `scripts/gates-by-path.json`
- `scripts/check-deferrals.test.mjs` (lines 123-127) and `scripts/gate-bundle.test.mjs` (line 126): they
  name scripts this story removes (*added 2026-10-02 by the lead*)
- `packages/core/src/buffer/buffer.test.ts` (the `gateFidelityAllowed` guard, which fails any branch that
  edits `gate-fidelity.mjs`) and `fonts/README.md` (names `gate:font-attrs`) (*added 2026-10-02 by the lead*)
- `changelog.d/A-08.md` (new)

**Build order.**
1. `scripts/check.mjs`. It runs `check-boundaries`, `check-registry`, `check-deps`, `check-deferrals`,
   `check-one-parse`, `check-tokens`, `gate-font-attrs` and `check-workflows` in turn, each as a
   child process (do not refactor the scripts into modules). It prints `✓ name` or `✗ name`, then
   the last six lines of each failure (the same shape as `scripts/precheck.mjs:24-29`), and exits
   non-zero if any failed. `--staged` is passed through to `check-registry`.
2. `package.json`:
   - add `"check": "node scripts/check.mjs"`;
   - remove the per-check scripts listed under Paths;
   - `lint` becomes `biome check . && pnpm -r lint`;
   - `test` loses `node scripts/gate-protection.mjs --selftest && node scripts/check-tokens.mjs`
     (tokens now run in `check`);
   - keep `check:story` and `check:pr`, which `done.mjs` and `open-pr.mjs` use;
   - keep `test:contracts-frozen`; Phase B removes it.
3. `ci.yml` `fast`. Replace
   `pnpm check:boundaries && … && pnpm check:deferrals` (`ci.yml:94`) with `pnpm check`.
4. Delete `scripts/gate-protection.mjs`, its fixtures and tests. `lint:biome-contract` goes with the
   `package.json` edit.
5. `scripts/check-workflows.mjs`:
   - Add one rule across every file in `.github/workflows/`: no `continue-on-error`, and no
     `|| true` in a `run:` step.
   - Make its Linux-dependency checks (`check-workflows.mjs:105-122`: the `pkg-config` probe for
     glib, `dbus` in the apt line) apply to every job in `ci.yml` and `nightly.yml` that runs
     `cargo` on Linux, instead of to a job by name. A-09 moves those steps.
   - Extend its test with a fixture workflow for each new rule.
6. Delete the workflow-shape assertions from `gate-licences.mjs`, `gate-fidelity.mjs`,
   `specimen/verify.mjs` and the three checks in `commonmark-spec.ts` named under Paths. Each gate
   keeps checking its own subject.
7. `apps/desktop/scripts/smoke-verdict.test.mjs`:
   - Delete "CI verify:cli requires smoke on both runner classes without continue-on-error"
     (`smoke-verdict.test.mjs:47-60`).
   - Stop spawning `smoke-cli-open.mjs` against a real binary in the "afterPaint neutralised" case
     (`smoke-verdict.test.mjs:107-112`). Test the verdict function only, or skip the spawn unless
     `MARXY_SMOKE_REQUIRED=1`.
8. `scripts/precheck.mjs` and `scripts/gates-by-path.json`. The `always` list becomes `["check"]`
   plus `check:story`. Replace every reference to a removed script name.

**Acceptance.**
- `pnpm check` runs eight checks and is green; breaking one of them (for example adding
  `import fs from 'node:fs'` to `packages/core/src/index.ts`) makes it exit 1 with that check's fix
  line. `scripts/check.test.mjs` does this with a temp copy or the scripts' own selftests.
- `git grep -n -E 'gate-protection|lint:biome-contract|check:boundaries|check:registry|check:deps|check:deferrals|check:workflows|gate:font-attrs' -- ':!docs' ':!CHANGELOG.md' ':!changelog.d'`
  prints nothing.
- `git grep -n -E "continue-on-error|\\|\\| ?true" -- scripts packages apps ':!**/node_modules/**'`
  finds the rule only in `scripts/check-workflows.mjs` and its test.
- A fixture workflow with `continue-on-error: true` fails `check-workflows`; one without passes
  (its test).
- `pnpm lint` takes under 5 s locally with a populated `apps/desktop/src-tauri/target/`. Time it
  before and after in the pull request.
- `pnpm --filter @marxy/desktop test` passes on a machine with a built release binary. That is the
  red test of `04` §2.

**Tests.**
- Stay green: `pnpm test`, `pnpm lint`, `pnpm typecheck`, each gate's own `--selftest`
  (`gate-licences`, `gate-fidelity`, `commonmark-spec`, `specimen/verify`), and
  `apps/desktop/scripts/*.test.mjs`.
- New: `scripts/check.test.mjs`, and the new cases in the `check-workflows` test.
- Run: `pnpm precheck`, `pnpm check`.

**Do not.**
- Change what any hygiene check checks.
- Touch `scripts/gate-perf.mjs` or `scripts/measure-parse.mjs`; A-03 deletes them.
- Change any job in `ci.yml` other than the one `fast` step.
- Delete `test:contracts-frozen`; that is Phase B, under ADR-0045.

**Risks and open questions.**
- `check-one-parse` is also spawned by its own test inside `pnpm test`
  (`check-one-parse.test.mjs:73`). Running it twice is cheap; leave both.
- If a gate's workflow assertion turns out to guard something real, for example the order of the
  two licence-gate runs around the Rust build, move it into `check-workflows` with a comment rather
  than drop it, and say which.

### A-09 — Path-filter the Rust and typography jobs, move the dual-OS build to nightly, run only `fast` on `main`

**Model:** opus · **Size:** M · **Depends on:** A-03, A-08 · **Parallel with:** A-13, A-15, A-16

**Outcome.** A pull request that touches no Rust no longer builds the app on two operating systems.
A change to Rust, `tauri.conf.json` or the Vite config gets one Ubuntu job: clippy, the build, the
command-line smoke test, the Rust unit tests and the bundle gate. Typography checks run when
typography paths change. A merge to `main` runs only the classifier and `fast`, instead of paying
the full price a second time for a tree its pull request already proved. Everything that left the
pull-request path, including the macOS build and smoke, runs nightly. The cache-key machinery that
skipped `gates` (MARXY-105) is deleted. The required check is still `ci`.

**Why now.** `04-tests-and-gates.md` §4.3, §4.6 and §6.1: the dual-OS `gates` job is 34 % of a
product pull request's job-seconds and can fail only on Rust changes, and every merge repeats
1,333 job-seconds on `main`. ADR-0046 makes Linux a release criterion, not a pull-request gate.

**Paths.**
- `.github/workflows/ci.yml`
- `.github/workflows/nightly.yml`
- `scripts/ci-changes.mjs`
- `scripts/ci-changes.test.mjs` (new; the classifier's cases moved out of `--selftest`)
- `scripts/ci-verdict.mjs` and `scripts/ci-verdict.test.mjs` (new): the `ci` job's verdict, out of `ci.yml`
  and under test, since `ci` is the only required check (*added 2026-10-02 by the lead*)
- `scripts/check-workflows.mjs` and its test, if the job names it reads change
- `apps/desktop/scripts/smoke-verdict.mjs`: delete `workflowCliSmokeIsRequired` and
  `cliSmokeStepFromWorkflow`, unused since A-08 (*added 2026-10-02 by the lead*). In `ci-changes.mjs`,
  remove its own copy of the `continue-on-error` / `|| true` rule (`ci-changes.mjs:179`); A-08 put
  that rule in `check-workflows` alone
- `changelog.d/A-09.md` (new)

**Build order.**
1. `scripts/ci-changes.mjs`:
   - It now only classifies a diff and writes these outputs: `docs_only`, `web` (as today),
     `typography`, `rust`, `fleet` and `lockfile`. The path sets are:
     - `typography`: `packages/theme/`, `packages/typeset/`, `packages/core/src/render/`,
       `packages/core/src/sanitize/`, `packages/core/src/parse/`, `fixtures/`, `fonts/`,
       `apps/desktop/index.html`, `scripts/gate-aesthetics.mjs`, `scripts/specimen/`.
     - `rust`: `apps/desktop/src-tauri/`, `apps/desktop/vite.config.ts`,
       `apps/desktop/scripts/smoke*`, `mise.toml`.
     - `fleet`: `orchestration/`.
     - `lockfile`: `pnpm-lock.yaml`, any `package.json`, `Cargo.lock`.
     - A change under `.github/workflows/` sets every output to true.
   - Delete the gates-hash, `--resolve` and record logic, and every selftest case about `ci.yml`'s
     shape.
   - Move the classifier cases to `scripts/ci-changes.test.mjs`.
2. `ci.yml`, job by job:
   - **`changes`**: checkout and classify. No cache, no resolve, no selftest step.
   - **`conventions`**: as A-07 left it.
   - **`fast`**: as A-08 left it. The `pnpm test:fleet` step runs only
     `if: needs.changes.outputs.fleet == 'true'`.
   - **`browser`**: unchanged except `pnpm gate:aesthetics` moves to `typography`, and the job runs
     only when `web == 'true' && github.event_name != 'push'`. A-10 replaces it.
   - **`typography`** (new): runs in the Playwright container when
     `typography == 'true' && github.event_name != 'push'`. Steps: install, `pnpm gate:aesthetics`,
     `pnpm gate:specimen`.
   - **`rust`** (new): Ubuntu only, when `rust == 'true' && github.event_name != 'push'`. It
     carries over the Ubuntu half of `gates`: the apt step with `dbus`, the `pkg-config` glib
     probe, `Swatinem/rust-cache`, install, `pnpm lint:rust`, `build:web`,
     `cargo build --locked --profile ci --features tauri/custom-protocol`,
     `node scripts/gate-licences.mjs --require-registry`,
     `pnpm --filter @marxy/desktop verify:cli`, `cargo test --locked --profile ci …` and
     `pnpm gate:bundle`.
   - **Delete** `gates`, `gates-skip` and `gates-record`.
   - **`ci`**: `needs: [changes, conventions, fast, browser, typography, rust]`, with the same
     summary script.
3. `nightly.yml`:
   - Extend A-03's `startup-macos` job, renamed `build-macos`, with `verify:cli`, `cargo test` and
     `gate-licences --require-registry` after the build.
   - Add `rust-linux`: the same steps as the pull-request `rust` job, run every night.
   - Add `fleet`: `pnpm test:fleet`.
4. `check-workflows.mjs`, only if a rule names a job that no longer exists.

**Acceptance.**
- `scripts/ci-changes.test.mjs` asserts the outputs for about twelve representative diffs: a CSS
  change gives `web` and `typography`; `src-tauri/src/main.rs` gives `rust`; `orchestration/x.mjs`
  gives `fleet`; `docs/x.md` gives `docs_only`; `.github/workflows/ci.yml` gives everything.
- `pnpm check` passes on the new workflows (pinned actions, `timeout-minutes` on every job, the
  Linux dependency probes on every Linux `cargo` job, no `continue-on-error`).
- In the pull request's own CI run, which counts as a workflow change and runs every job, `ci`
  is green. Paste the job list with durations.
- After merge, a docs-only pull request and a TypeScript-only pull request show the expected jobs.
  The lead checks this with `gh run view --json jobs` on the next two pull requests and records it
  in `progress.md`.
- After merge, a push run on `main` has only `changes`, `fast` and `ci` (`gh run list --branch main`).
- A manual dispatch of `nightly.yml` from the branch is green, and the run URL is in the pull request.

**Tests.**
- Stay green: `pnpm test` (which now includes `ci-changes.test.mjs`), `pnpm check`, and
  `scripts/smoke-built-app.test.mjs`, which asserts the nightly built-app smoke.
- Run: `pnpm precheck`, then `gh workflow run nightly --ref <branch>`, which the author or lead
  runs because it needs push rights.

**Do not.**
- Change branch protection or the name of the `ci` job.
- Add a third-party action that `check-workflows` does not already allow. Plain path classification
  in `ci-changes.mjs` is the mechanism.
- Change `browser`'s desktop-suite step; that is A-10's.
- Change any gate script.
- Use `continue-on-error` anywhere.

**Risks and open questions.**
- `verify:cli` needs a display on Linux. The `gates` job ran it with `xvfb` and `dbus` installed.
  Keep exactly those packages, and if the smoke skips with "frameless", report it rather than
  weaken `MARXY_SMOKE_REQUIRED`.
- `merge_group` is not enabled (AGENTS.md). Treat it like `pull_request` so nothing breaks if it is
  turned on.

### A-10 — Run `browser-lite` on pull requests, and visual comparison and the full WebKit suites nightly

**Model:** opus · **Size:** M · **Depends on:** A-06, A-09 · **Parallel with:** A-14

**Outcome.** The browser job on a pull request runs the fifteen desktop test files that guard save,
trust, data loss, close, reload, open, selection and persistence, plus the index and progressive
tests this phase adds, instead of all 57 files serially. It drops from about 700 s to about 270 s.
The typography job keeps the mechanical checks (grid, measure, contrast, layout shift, heading
colour, overflow) and stops comparing screenshots and rag against baselines. That comparison runs
nightly. The full desktop suite runs nightly with WebKit required, and so do the sixty-odd WebKit
tests of the typesetter, theme and KaTeX that today run in no CI job. The desktop mutation check
becomes its own script and fails on a named test instead of on exit status 1.

**Why now.** `04-tests-and-gates.md` §4.3 (the desktop suite is 30 % of a pull request's
job-seconds and the critical path), §3 (seven WebKit test files run nowhere; the mutation trick),
and §6.1. ADR-0047 makes visual comparison nightly while the mechanical checks stay on pull
requests.

**Paths.**
- `.github/workflows/ci.yml`, the `browser` and `typography` jobs, and the `ci` job's `needs`
- `.github/workflows/nightly.yml`
- `apps/desktop/package.json`, the `test` scripts
- `apps/desktop/scripts/mutations.mjs` (new)
- `apps/desktop/src/palette/search.test.ts`, lines 1-35 (the script-text assertion)
- `scripts/gate-aesthetics.mjs`, a `--mechanical` flag only
- `changelog.d/A-10.md` (new)

**Build order.**
1. `apps/desktop/package.json`:
   - **`test`** is today's command without the mutation re-run (`apps/desktop/package.json`,
     the `( MARXY_86_MUTATION=… ; test $? -eq 1 )` part). It still runs every file, and the WebKit
     files skip where no browser is installed.
   - **`test:lite`** is
     `node --test --test-concurrency=1 --experimental-strip-types` over exactly these files:
     `app-harness, close-guard, data-loss, explicit-save, links, live-reload, open-path,
     operations-edit, persist-reading, save, save-close-r5, save-trust-r4, selection,
     single-instance, trust` (`04` §4.3) plus `palette-index, index-service, progressive`, under
     `test/`, each `.test.mjs`.
   - **`test:mutations`** is `node scripts/mutations.mjs`.
2. `apps/desktop/scripts/mutations.mjs`. It runs the four palette test files with
   `MARXY_86_MUTATION=search-prepared-body` using `--test-reporter=tap`. It passes only if the named
   tests that must fail did fail (list them by name) and every other test passed. A crash or a
   syntax error is a failure.
3. `search.test.ts:20-34`. Assert that `test:mutations` exists and that `mutations.mjs` names the
   mutation constant. Drop the `test $? -eq 1` text check.
4. `scripts/gate-aesthetics.mjs`. Add `--mechanical`, which skips `screenshotCombo` and the rag
   baseline comparison (`gate-aesthetics.mjs:575-700`, and the rag block near `:969`) and keeps
   every other check and `--selftest`.
5. `ci.yml`:
   - Rename `browser` to `browser-lite`. Its steps: container, install, `pnpm gate:no-network`, the
     C linker step, then `pnpm --filter @marxy/desktop test:lite` with
     `MARXY_BROWSER_TESTS_REQUIRED=1`.
   - In `typography`, run `node scripts/gate-aesthetics.mjs --mechanical`.
   - Update `ci.needs`.
6. `nightly.yml`. Add `browser-full` in the Playwright container with WebKit required. It runs
   `pnpm --filter @marxy/desktop test`, `pnpm --filter @marxy/desktop test:mutations`, and
   `pnpm --filter @marxy/theme test`, `pnpm --filter @marxy/typeset test` and
   `pnpm --filter @marxy/core test`, all with `MARXY_BROWSER_TESTS_REQUIRED=1`.
   `aesthetics-determinism`, which runs the full gate with screenshots and `--repeat 3`, stays as
   it is.

**Acceptance.**
- `MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test:lite` runs exactly 18 files and
  is green. Paste its `ℹ tests` line.
- `pnpm --filter @marxy/desktop test:mutations` passes on `main`'s code, and fails when one of the
  named palette tests is weakened to always pass. Show both.
- `pnpm --filter @marxy/desktop test` output contains no `✖` from the mutation run (`04` §3, point 1).
- `node scripts/gate-aesthetics.mjs --mechanical` takes no screenshot. Count the
  `page.screenshot` calls through its `--selftest` or a log line, and paste the time against the
  full gate.
- `layout-shift-window.test.mjs` is green: the nightly still passes `--repeat 3`, and nothing
  implies a repeat pass.
- In the pull request's own CI run, `browser-lite` is green, and its duration is pasted beside
  `browser`'s 708 s median.
- A dispatch of `nightly.yml` from the branch shows `browser-full`. If WebKit tests that never ran
  in CI fail, list them by file and test name in the pull request (see Risks).

**Tests.**
- Stay green: `src/palette/search.test.ts`, `test/layout-shift-window.test.mjs`, the
  `gate-aesthetics --selftest`, and `pnpm check`.
- New: `apps/desktop/scripts/mutations.mjs`, exercised by `test:mutations`.
- Run: `pnpm precheck`; `pnpm gate:aesthetics` and `node scripts/gate-aesthetics.mjs --mechanical`.

**Do not.**
- Delete any desktop test file.
- Change `fixtures/baselines/`.
- Drop `gate:no-network` from pull requests. It is the no-phone-home commitment.
- Add retries.
- Remove the `MARXY_*_MUTATION` hooks from product source; Phase B does that.

**Risks and open questions.**
- The typeset, theme and core WebKit tests have never run on Linux WebKit in CI (`04` §3). If
  `browser-full` is red on them, do not delete or skip them. List the failures in the pull request
  and leave the job red. The author rules on run-or-delete (`04` §6, the last paragraph).
- If the 18-file set misses a regression class the full suite catches, the nightly will show it.
  Name the file to add, rather than adding it in this story.

### A-10.1 — Make the no-network gate's control page deterministic in Chromium

**Model:** sonnet · **Size:** S · **Depends on:** A-10 · *Added 2026-10-02 by the lead.*

**Outcome.** `pnpm gate:no-network` never fails on its own control page. On a B-06 pull-request run
(37103394026, attempt 1) the `browser-lite` job failed with "chromium: the control page's
un-allow-listed element was not seen in the live DOM, so the element half of the allow-list check
cannot fail and proves nothing", and the same for "the block inside an anchor"; the re-run passed. The
gate read the control page's live DOM before the page had rendered it. AGENTS.md: a flaky check is
fixed or deleted, never re-run until green. This one guards commitment 3, so it is fixed.

**Paths.** `scripts/gate-no-network.mjs` (the control-page wait only) and its test; `changelog.d/A-10.1.md`.

**Acceptance.** The control page is read only after a deterministic signal that it has rendered (a
load event, a marker the page sets, or `waitForSelector` on the very elements the check needs), never a
timer. Running the gate's Chromium leg 30 times in a row, locally and under load, gives 0 failures;
the gate still fails when the control element is genuinely absent (mutation-checked).

### A-11 — Rewrite the CI contract and the process documents

**Model:** sonnet · **Size:** M · **Depends on:** A-03, A-07, A-08, A-09, A-10 · **Parallel with:** A-17

**Outcome.** A person or an agent who reads `AGENTS.md` and `docs/ci-contract.md` before pushing
learns exactly what can turn a pull request red today, and the local command for each. The
documents stop describing the fleet, the board, Jira keys, `pnpm done`, the enforced pull-request
body and the dual-OS `gates` job as requirements. The six places where `docs/hygiene.md` and
`docs/ci-contract.md` disagree with the code are fixed.

**Why now.** `04-tests-and-gates.md` §1.7 lists six disagreements between these documents and the
code. AGENTS.md says it wins over every other document, so it has to be right. ADR-0051 suspends
the process the documents describe.

**Paths.**
- `AGENTS.md`
- `docs/ci-contract.md`
- `docs/hygiene.md`
- `docs/conventions.md`
- `docs/sdlc.md`
- `docs/plan.md` and `docs/roadmap.md`, a pointer paragraph at the top only
- `docs/adr/0032-*.md`, an "Amended 2026-10" paragraph only (the product tier deleted, numbers
  recorded nightly)
- `scripts/check-story.test.mjs`, only if the `- Frozen:` lines it reads from `docs/hygiene.md`
  (`check-story.test.mjs:81`) move
- `changelog.d/A-11.md` (new)

**Build order.**
1. `docs/ci-contract.md`. Rewrite it from the workflows as merged:
   - one table row per job of `ci.yml` (`changes`, `conventions`, `fast`, `browser-lite`,
     `typography`, `rust`, `ci`) with when it runs, what it does and the local command;
   - one table for `nightly.yml`, marked as monitoring;
   - "Before you push" as `pnpm precheck`, `pnpm check`, a conventional subject with an optional
     story id or key, and a fragment in `changelog.d/`;
   - the pull-request template described as a suggestion;
   - "Editing CI itself" listing the one place a workflow rule lives (`check-workflows.mjs`).
   Keep the sentence that names the built-app smoke as monitoring;
   `scripts/smoke-built-app.test.mjs:62` asserts it.
2. `docs/hygiene.md`. Each tool, the failure it answers, and when it runs, for the tools that
   exist after A-08 and A-03. Fix the six items of `04` §1.7: the timings, the apt cache, which job
   fails most, `strict`, the timing checks, and `gate-protection`.
3. `AGENTS.md`. Keep the spirit, the four commitments, the architecture paragraph and the module
   map verbatim. Rewrite:
   - "Where the project actually is": the fleet paused, the plan in `docs/plan/roadmap-2026-10/`,
     and `progress.md` as the ledger;
   - "Working rules": branches `type/<id>-slug`, a key or story id optional, no board row, and a
     definition of done of tests plus gates plus a fragment plus one review, with the taste queue
     voluntary;
   - "The three commands": `pnpm precheck`, `pnpm check`, and `gh pr create` with the template;
   - "Verification": visual comparison and performance are nightly (ADR-0047, ADR-0032).
   Mark ADR-0045 as proposed where "Contracts are frozen" stands; the freeze test stays until
   Phase B.
4. `docs/conventions.md`. The key in the subject is optional, and the story id form is `(A-nn)`.
   `docs/sdlc.md`: a banner on the fleet-only sections ("suspended by ADR-0051") and a pointer to
   `docs/plan/roadmap-2026-10/00-orchestration.md`.
5. A pointer paragraph at the top of `docs/plan.md` and `docs/roadmap.md`, and the ADR-0032
   paragraph.

**Acceptance.**
- `pnpm test:fleet` is green. `orchestration/docs.test.mjs` checks that every orchestration file and
  `fleet.mjs` command a live document names exists.
- `node --test scripts/smoke-built-app.test.mjs scripts/check-story.test.mjs` is green.
- Every command in `docs/ci-contract.md`'s tables runs from the repository root. The pull request
  pastes a shell loop that runs each one with `--help` or a dry flag, or else the last line of a
  real run.
- `git grep -n -E 'pnpm done|open-pr\.mjs|check-story --strict|check-pr|gate-protection|gates-skip|gate:perf' -- AGENTS.md docs/ci-contract.md docs/hygiene.md docs/conventions.md`
  prints only lines that describe these as optional or historical. A reviewer checks the output.
- Each of the six disagreements in `04` §1.7 has a matching line in the new `docs/hygiene.md` or
  `docs/ci-contract.md`, listed in the pull request.

**Tests.**
- Stay green: `pnpm test`, `pnpm test:fleet`, `pnpm check`.
- Run: `pnpm precheck`.

**Do not.**
- Change any code or workflow.
- Edit `docs/research/`, `docs/design/` or another ADR.
- Delete fleet documentation in `orchestration/`. It is frozen.
- Restate the plan inside `AGENTS.md`; point to it.

**Risks and open questions.**
- `docs/sdlc.md` carries a release runbook. Point it at `docs/design/14-release.md`, which A-17
  updates, rather than duplicating the steps.

### A-11.1 — Let deferral markers name a story id

**Model:** sonnet · **Size:** S · **Depends on:** A-07 · **Parallel with:** anything outside these paths
*Added 2026-10-02 by the lead, from the A-11 review.*

**Outcome.** `check-deferrals` accepts a deferral marker that names a roadmap story id (`A-07`, `B-13`,
`A-14.1`) as well as a `MARXY-nnn` key, so new work no longer has to mint a retired Jira key to leave
an honest "later" marker. `docs/conventions.md` stops describing the limitation.

**Paths.**
- `scripts/check-deferrals.mjs` and its test (`scripts/check-deferrals.test.mjs`)
- `docs/conventions.md` (the sentence about deferral markers only)
- `changelog.d/A-11.1.md` (new)

**Acceptance.**
- A marker naming `B-13` (or `A-14.1`) is accepted when allow-listed the same way a `MARXY-` key is;
  a malformed id (`b-13`, `B-1`) is rejected; existing `MARXY-` behaviour is unchanged. Each case
  is a test that fails on today's script.
- `pnpm check` green.

### A-11.2 — Bring the gates design document up to date

**Model:** sonnet · **Size:** S · **Depends on:** A-09, A-10, A-11, B-02 · **Parallel with:** anything else
*Added 2026-10-02 by the lead, from the A-11 review.*

**Outcome.** `docs/design/10-gates-and-testing.md` describes the CI that exists: the `changes`,
`conventions`, `fast`, `browser-lite`, `typography` and `rust` jobs and the `ci` verdict on pull
requests, the nightly jobs, and the aesthetics gate driving the real app (B-02). It points at
`docs/ci-contract.md` for the commands rather than repeating them. Nothing in it contradicts the contract.

**Paths.**
- `docs/design/10-gates-and-testing.md`
- `changelog.d/A-11.2.md` (new)

**Acceptance.** Every job, script and command the document names exists on `main`; a reviewer
checks each one. No counts that will rot.

### A-12 — Make the palette list every command whose `when` holds

**Model:** sonnet · **Size:** M · **Depends on:** A-07 · **Parallel with:** A-01, A-04, A-08

**Outcome.** Typing `>` in the palette lists every command that applies right now, each with its
key: save, undo and redo, revoking trust, line numbers in Source, jump to source, and the
operations. Text after `>` filters the list by title. With no document open, the palette still
works and lists only the commands that make sense. This one change makes five built commands
reachable, and it prepares the registry for the app-level commands the next stories add: a command
can run while focus is in Source mode's editor, and can have more than one chord.

**Why now.** `01-codebase-audit.md` §1.1 and §8.3: the `>` mode lists only `op.*` commands
(`palette/view.ts:91-95`), so a command with no key is reachable from no interface, and
`buildAppContext` returns `null` with no document (`selection/bind.ts:41-43`). `12` step 3.

**Paths.**
- `apps/desktop/src/palette/view.ts`
- `apps/desktop/src/palette/commands.ts` (new), `apps/desktop/src/palette/commands.test.ts` (new)
- `apps/desktop/src/selection/bind.ts`
- `apps/desktop/src/commands/registry.ts`
- `apps/desktop/src/commands/document.ts`, the `when` of save and save-as
- `apps/desktop/src/commands/app-handle.ts` (new)
- `apps/desktop/src/commands/index.ts`
- `apps/desktop/src/commands/navigation.ts`, `appearance.ts`, `outline.ts`, `editor.ts` (new, empty;
  for A-13, A-14, A-15 and A-16)
- `apps/desktop/test/palette.test.mjs`
- `apps/desktop/src/commands/source-view.ts` and `apps/desktop/test/operations-copy.test.mjs`
  (*added 2026-10-02 by the lead*: jump-to-source reads the app handle, as the Risks below ask; the
  copy test typed Enter on a bare `>`, and the group order moved the first row)
- `changelog.d/A-12.md` (new)

**Build order.**
1. `commands/registry.ts`. `Command` gains `readonly global?: boolean`, which runs even when focus
   is in an editable such as Source mode, and `readonly keys?: readonly string[]` for alternate
   chords. `AppContext` is unchanged.
2. `commands/app-handle.ts`:
   `setAppHandle(h: AppHandle): void`, `appHandle(): AppHandle | null`, and the same pair for the
   palette controller (`setPalette`, `palette()`).
3. `palette/commands.ts`, pure, with no DOM:
   - `paletteCommands(all, ctx, query): readonly Command[]` keeps the commands whose `when(ctx)`
     holds, filters by `fuzzyScore` on the title when `query` is not empty (import from
     `search.ts`), and orders by group (`document`, `view`, `app`, `selection`) and then by title.
   - `keyLabel(spec: string, mac: boolean): string` turns `Mod+Shift+S` into `⇧⌘S` or
     `Ctrl+Shift+S`.
   - `commandForKey(event, cmds, ctx, opts: { inEditable: boolean }): Command | undefined` is the
     dispatcher's choice: it checks `key` and `keys`, skips a non-`global` command when
     `inEditable`, and checks `when`. It is pure, so a Node test can cover it.
4. `selection/bind.ts`:
   - `buildAppContext()` returns a context with `selection: { kind: 'none' }` and
     `operationInput: () => null` when no selection runtime exists (no document). It takes `shell`
     from `appHandle()?.shell`.
   - `installCommandKeys` (`bind.ts:66-94`) uses `commandForKey`, and moves the `inEditable` early
     return into it so that `global` commands get through. The `Mod+C` copy path stays as it is.
5. `commands/document.ts`. Save and save-as hold only with an open document whose path does not
   start with `marxy:` (today `when: () => true`, `document.ts:111,121`).
6. `commands/index.ts`. Spread `navigationCommands()`, `appearanceCommands()`, `outlineCommands()`
   and `editorCommands()` from the four new files. Each returns `[]` and carries a one-line comment
   naming the story that fills it.
7. `palette/view.ts`:
   - `operationCommandsForPalette` (`view.ts:91-95`) becomes
     `paletteCommands(commands(), ctx, queryAfterChevron)`.
   - Rows show the title and a key label in a separate element, both through `textContent`.
   - The empty notice reads "No commands here".
   - `mountPaletteFromHandle` (`view.ts:502-529`) calls `setAppHandle(handle)` and
     `setPalette(controller)`.

**Acceptance.**
- `palette/commands.test.ts` (Node) checks:
  - `when` filtering; the query filter; group order; key labels on Mac and on Linux;
  - `commandForKey` runs a `global` command from an editable and skips a non-global one;
  - an alternate chord in `keys` matches.
- `test/palette.test.mjs` (WebKit) checks these, each listed under `>`:
  - with a document open, "Save" with its key label;
  - "Toggle line numbers in Source";
  - "Revoke …" after a trust grant (reuse the grant setup of `test/trust.test.mjs`);
  - "Jump to source" after a block is selected;
  - with no document (frontispiece launch), the list has no "Save", and opening `>` throws nothing;
  - running "Toggle line numbers in Source" from the palette shows the gutter.
- `test/palette.test.mjs`'s existing tab-bar check is green (ADR-0011, `TAB_BAR_DOM_MUTATION`).

**Tests.**
- Stay green, with WebKit required: `src/palette/*.test.ts`, `test/palette.test.mjs`,
  `test/palette-input-guards.test.mjs`, `test/selection.test.mjs`, `test/operations-copy.test.mjs`,
  `test/operations-edit.test.mjs`, `test/source-gutter.test.mjs`, `test/jump-to-source.test.mjs`,
  `test/trust.test.mjs`.
- New: `palette/commands.test.ts`.
- Run: `pnpm precheck`, and `MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test`.

**Do not.**
- Move `Mod+E` or the history listeners; that is A-13.
- Add any new command of its own beyond the four empty files.
- Add chrome. The key label appears only inside the summoned palette.
- Change the operations' `when` or the copy shortcut.
- Use `innerHTML` in the palette.

**Risks and open questions.**
- `view.jump-to-source` reads `window.__marxyHandle`, which only tests set
  (`commands/source-view.ts:66-68`). Point it at `appHandle()` in this story, since it is one line
  in a command that now becomes reachable, and say so in the pull request.

### A-13 — Send `Mod+E`, back and forward through the registry

**Model:** sonnet · **Size:** M · **Depends on:** A-02, A-06, A-12 · **Parallel with:** A-09, A-15, A-16

**Outcome.** The mode toggle and history navigation behave exactly as they do today, with the same
chords, the same precedence and the same exceptions in Source and in text fields. They are now
registry commands, so they appear in the palette with their keys, and the native menu's replayed
chords go through the same dispatcher. Three private keyboard listeners in three modules are gone.

**Why now.** `01-codebase-audit.md` §1.1 (four separate keyboard listeners) and §8.3; `12` step 3.

**Paths.**
- `apps/desktop/src/app.ts`
- `apps/desktop/src/palette/view.ts`, the history branch of the window `keydown` listener and the
  controller's methods only
- `apps/desktop/src/selection/view.ts`, `installLinkHistoryKeys` only
- `apps/desktop/src/commands/navigation.ts`
- `apps/desktop/test/navigation-keys.test.mjs` (new), `apps/desktop/test/scroll-persistence.test.mjs`
  (new, optional)
- `changelog.d/A-13.md` (new)

**Build order.**
1. `app.ts`:
   - Delete `installKeyDispatcher` (`app.ts:314-323`), its call (`app.ts:1093`) and `keysInstalled`
     (`app.ts:188`).
   - Add `toggleMode(): Promise<void>` to `AppHandle`, calling `toggleViewMode` (`app.ts:289-300`).
2. `selection/view.ts`. Delete `installLinkHistoryKeys` (`selection/view.ts:108-122`) and its call.
   Export `linkBack(): boolean`, which navigates one step back in the link history and returns
   `true` when it did.
3. `palette/view.ts`. Delete the history branch of the window listener (`view.ts:457-469`) and keep
   `Mod+P` and `Mod+.`. `PaletteController` gains `back(): boolean` and `forward(): boolean`,
   moving through the session history as today.
4. `commands/navigation.ts`:
   - **`view.toggle-mode`**: "Toggle Rendered / Source", key `Mod+E`, `global: true`, holds when a
     document is open.
   - **`nav.back`**: key `Mod+[`, `keys: ['Alt+ArrowLeft', 'BrowserBack']`. It tries `linkBack()`
     first, then `palette()?.back()`.
   - **`nav.forward`**: key `Mod+]`, `keys: ['Alt+ArrowRight', 'BrowserForward']`.
   - The back and forward commands are not `global`. To keep today's Source behaviour,
     `when(ctx)` returns `false` when `historyKeyBelongsToEditor` (`palette/keys.ts`) says the chord
     belongs to the editor. Pass the event through, or check the visible Source host the way
     `view.ts:460-461` does.
5. `test/navigation-keys.test.mjs` (WebKit, `palette-boot.html`).
6. *Added 2026-10-02 by the lead, from the A-15 review.* `app.ts` `installScrollPersistence`
   (around `app.ts:1036-1047`) listens for scroll on `readingScroller()`, which is
   `document.documentElement`. WebKit fires the viewport `scroll` at the `Document`, not at
   `documentElement` (probed: document 1, documentElement 0, window 1, body 0), so scrolling never
   calls `positionPersistence.note()`. Positions survive only through the flushes on a document
   switch, on quit and on entering Source; a crash, force-quit or a window close that skips
   `shell.quit` loses every scroll since the last open. Listen on `document` (keep
   `readingScroller()` for sampling), confirm the note is throttled or debounced, and flush on
   `pagehide` as well. Test it in `navigation-keys.test.mjs` or a new
   `test/scroll-persistence.test.mjs`: scroll, then read the pending note without a flush.

**Acceptance.**
- `Mod+E` from Rendered opens Source at the reading position, and `Mod+E` with focus inside
  CodeMirror returns to Rendered (`navigation-keys.test.mjs`).
- Scrolling in Rendered records the reading position without a flush (step 6).
- After following a relative link, `Mod+[` returns to the first document, and `Alt+←` does the same
  (`navigation-keys.test.mjs`).
- `Alt+←` with the caret in Source mode's text does not navigate (`navigation-keys.test.mjs`).
- After opening two documents through the palette, `Mod+[` and `Mod+]` move through the session
  history (`navigation-keys.test.mjs`).
- `>` in the palette lists "Toggle Rendered / Source", "Back" and "Forward" with their keys
  (`navigation-keys.test.mjs`).
- `git grep -n "addEventListener('keydown'" apps/desktop/src` shows no listener in `app.ts` and no
  history listener in `selection/view.ts`. Paste the output.
- `src/menu/*.test.ts` is green; the menu replays chords through the registry.

**Tests.**
- Stay green, with WebKit required: `test/links.test.mjs`, `test/source-mode-shell.test.mjs`,
  `test/jump-to-source.test.mjs`, `test/palette.test.mjs`, `src/palette/keys.test.ts`,
  `src/menu/*.test.ts`, `test/persist-reading.test.mjs`.
- New: `test/navigation-keys.test.mjs`.
- Run: `pnpm precheck`, and `MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test`.

**Do not.**
- Change any chord, merge the two history stacks, or change what `toggleViewMode` does.
- Touch `commands/registry.ts` or `selection/bind.ts`; A-12 made them ready.
- Add a menu item.

**Risks and open questions.**
- The link history listener ran in the capture phase with `stopImmediatePropagation`
  (`selection/view.ts:111-121`), so link-back always won over palette-back. `nav.back` must keep
  that order. If any key or listener ordering changes behaviour, report it rather than adapt the
  tests.

### A-14 — Apply the light variant and text size from config, and change them by command

**Model:** sonnet · **Size:** M · **Depends on:** A-04, A-12, A-13 · **Parallel with:** A-10

**Outcome.** `variant = "light"` (or `"auto"`) and `size = 24` in `config.toml` take effect on
launch, before the first text appears, so there is no dark flash. In the palette, "Use light
variant" and "Use dark variant" switch at once and are remembered in `config.toml`. `Mod+=`,
`Mod+-` and `Mod+0` make the text larger, smaller, or 20 px again. The page re-sets on the grid
and the reader stays on the same line. Every other byte of `config.toml` is untouched.

**Why now.** `01-codebase-audit.md` §1.2 and §1.4: the light variant and text size are built and
unreachable. Config parses `variant` and `size` (`packages/theme/src/config.ts:68-74`), but only
the headless render applies them (`apps/desktop/src/render/headless.ts:306-320`). This is part of
the screen criterion ("toggle light").

**Paths.**
- `apps/desktop/src/theme/reader-config.ts` (new)
- `apps/desktop/src/app.ts`
- `apps/desktop/src/commands/appearance.ts`
- `apps/desktop/test/reader-config.test.mjs` (new)
- `docs/design/11-config-and-storage.md`, the sentence "Marxy writes to the config file in exactly
  two cases" only
- `changelog.d/A-14.md` (new)

**Build order.**
1. `theme/reader-config.ts`:
   ```ts
   export async function readReaderConfig(shell: Pick<AppShell, 'readFile' | 'configPaths'>): Promise<Config>; // defaults on any failure
   export function lineBoxFor(sizePx: number): number;            // 2 × round(0.75 × size): 16→24, 20→30, 24→36, 28→42
   export function applyReaderConfig(root: HTMLElement, cfg: Pick<Config, 'variant' | 'size'>): () => void; // returns an unsubscribe for 'auto'
   export async function writeReaderKey(shell, key: 'variant' | 'size', tomlValue: string): Promise<void>; // setTopLevelKey + writeFileAtomic
   ```
   - The variant goes through `resolveVariantPreference` and `applyVariant` from `@marxy/theme`.
     For `auto`, listen to `matchMedia('(prefers-color-scheme: dark)')`.
   - Size sets `--marxy-size-body` and `--marxy-line-box` on the root, and removes both at 20, as
     `headless.ts:312-320` does.
   - `setTopLevelKey` is `packages/theme/src/config.ts:199`.
2. `app.ts`:
   - In `boot()` (`app.ts:1232-1297`), after the `args` mark and before
     `openDocumentThroughRenderMark`, call `applyReaderConfig(document.documentElement, await readReaderConfig(shell))`
     inside a `try`. A failure keeps the defaults.
   - Add `relayout(): Promise<void>` to `AppHandle`. It reads the current position, calls
     `typeset.relayout('theme')` or `snap` (`app.ts:630-636`), and restores the position with
     `restoreScrollToPosition`.
3. `commands/appearance.ts`:
   - "Use light variant" and "Use dark variant": no key, `global`, each holds when it is not the
     current variant. Each applies the variant, writes `variant`, then calls `appHandle()?.relayout()`.
   - "Larger text" `Mod+=`, "Smaller text" `Mod+-` and "Default text size" `Mod+0`: `global`,
     ±1 px clamped to 15–50 (the config's own clamp), applied, written as `size`, then relayout.
4. `docs/design/11-config-and-storage.md`. Writes to the config file are now three: `size`, `theme`
   and `variant`.
5. `test/reader-config.test.mjs`:
   - in Node, `lineBoxFor`;
   - in WebKit on `palette-boot.html`, with the memory shell's `/config/config.toml` holding
     `variant = "light"`, `size = 24` and a comment line.

**Acceptance.**
- `lineBoxFor(16|20|24|28)` returns `24|30|36|42`, and odd sizes give even line boxes
  (`reader-config.test.mjs`, Node).
- With `variant = "light"` in config, `html[data-marxy-variant]` is `light` before the `file_read`
  mark. A `MutationObserver` timestamp is compared with the mark's `t` (`reader-config.test.mjs`).
- With `size = 24`, the article's computed `line-height` is 36 px and every block sits on an 18 px
  grid. Use the top-mod-unit check of `packages/theme/test/grid.test.mjs`
  (`reader-config.test.mjs`).
- "Use dark variant" from the palette switches at once and rewrites only the `variant` line of the
  memory shell's `config.toml`; the comment and every other byte are unchanged
  (`reader-config.test.mjs`).
- `Mod+=` three times gives `size = 23` in the file, keeps the reading block within one block of
  where it was, and keeps every block on the grid (`reader-config.test.mjs`).
- A missing or unparsable `config.toml` launches dark at 20 px, with no notice beyond the existing
  config warnings (`reader-config.test.mjs`).

**Tests.**
- Stay green, with WebKit required: `test/variant-render.test.mjs`, `test/user-theme.test.mjs`,
  `test/theme-config-paths.test.mjs`, `test/app-harness.test.mjs` (its call record: the config
  read must not add an unrecorded `readFile`, see `memory.ts:36-39`), `test/persist-reading.test.mjs`.
- Run: `pnpm precheck`, `pnpm gate:aesthetics`.

**Do not.**
- Change any token value or the default theme's light palette; those are taste (ADR-0031).
- Hard-code `data-marxy-variant` elsewhere.
- Add a settings surface or a key for the variant.
- Watch `config.toml` for live changes. The design wants it, and it is not this story.

**Risks and open questions.**
- Reading the config adds a `configPaths` and a `readFile` call before first text, a few
  milliseconds. Design §05 step 4 refused two pre-paint reads for the user theme. Here the
  alternative is a dark-to-light flash. Report the measured cost from the start-up marks
  (`args → file_read`) in the pull request. If the author finds it unacceptable, the fallback is to
  apply the config after `first_text`.
- Source mode's CodeMirror reads the variant when the editor is created
  (`docs/design/09-app-shell.md` §Source mode). A toggle while Source is open may leave the editor
  on the old variant until it is re-created. Note what happens; do not fix it here.
- A reader size of 15–50 px goes past the 13–24 px clamp a user theme gets
  (`docs/design/05-theme.md` §loading). The clamp applies to themes, not to the reader's own
  setting. The aesthetics gate covers only 16–28 px.

### A-14.1 — Keep every byte of the edited config line except the value

**Model:** sonnet · **Size:** S · **Depends on:** — · **Parallel with:** anything outside `packages/theme`
*Added 2026-10-02 by the lead, from the A-14 review.*

**Outcome.** When Marxy writes a key to `config.toml` (`size`, `variant`, `theme`), the only bytes that change
are the value's. Today `setTopLevelKey` rebuilds the edited line and collapses the whitespace before a
trailing comment to one space: `variant = "light"   # c` becomes `variant = "dark" # c`, and tabs
become a space. That breaks the commitment "never touch a byte the user did not ask to change".

**Paths.**
- `packages/theme/src/config.ts` (`setTopLevelKey` only)
- `packages/theme/src/config.test.ts`
- `changelog.d/A-14.1.md` (new)

**Build order.** Splice the new value into the existing line between the key's `=` (and the
whitespace after it) and the end of the old value, keeping everything after the old value (spaces,
tabs, the comment, the line ending) byte for byte.

**Acceptance.**
- `config.test.ts`: multiple spaces, tabs and a mix before a trailing comment survive an edit byte for
  byte; spacing around `=` survives; CRLF, a BOM, a missing trailing newline, a key in a `[table]`, a
  commented-out key and duplicate keys behave as today (the A-14 reviewer's probes, now pinned).
- Each new case fails on the old `setTopLevelKey`.

**Do not.** Change the parser, the config schema or any caller.

### A-15 — Summon the outline

**Model:** sonnet · **Size:** M · **Depends on:** A-12 · **Parallel with:** A-09, A-13, A-16

**Outcome.** `Mod+Shift+O`, or "Outline" in the palette, opens a narrow list of the document's
headings at the right edge, indented by level, with the current heading marked. The arrow keys move
through it, `Enter` lands that heading on the reading line, and `Esc` closes it and returns focus
to the article. While it is open, the mark follows the reader's scrolling. Nothing is on screen
until it is summoned. The view takes its document, position and landing from a small interface, so
Phase D can bind it to the focused pane.

**Why now.** `01-codebase-audit.md` §1.2: `outlineFrom` is built and tested in core and imported by
nothing in the app, and `#marxy-outline` (`apps/desktop/index.html:28`) is empty. This is part of
the screen criterion ("summon the outline"). `14-roadmap-proposal.md` Phase D says find and outline
were "re-scoped in phase A to take a view".

**Paths.**
- `apps/desktop/src/outline/view.ts` (new)
- `apps/desktop/src/commands/outline.ts`
- `apps/desktop/test/outline.test.mjs` (new)
- `changelog.d/A-15.md` (new)

**Build order.**
1. `outline/view.ts`, following `docs/design/09-app-shell.md` §Outline and
   `docs/design/12-outline.md`:
   ```ts
   export interface OutlineSource {
     document(): { readonly path: string; readonly ast: Document } | null; // handle.openDocument()
     position(): number;                                                   // reading byte offset
     land(path: string, byte: number): Promise<void>;                      // handle.open(path, { at })
   }
   export function openOutline(source: OutlineSource): void;
   export function closeOutline(): void;
   export function outlineIsOpen(): boolean;
   ```
   - Entries come from `outlineFrom(ast)`, imported from `@marxy/core`, which exports it
     (`packages/core/src/index.ts:9`). Each entry is one row of plain text, indented by level, with
     the current entry being the last whose `src.start ≤ position()`.
   - The dialog is `dialog#marxy-outline`, created if absent, as in `palette-boot.html`. Its width
     is `min(320px, 40vw)` at the right edge, styled through `adoptRuntimeSheet` with `--marxy-*`
     tokens the way `palette/view.ts:154-` styles the palette, and classes prefixed `marxy-outline-`.
   - It handles `↑`, `↓`, `Enter` and `Esc`. On open it scrolls the current row into view.
   - While open, a passive scroll listener on `document.documentElement`, throttled to one update
     per animation frame, moves the mark. It is removed on close.
   - Opening the outline closes the palette (`appHandle`'s palette), since overlays are exclusive.
2. `commands/outline.ts`. Command `view.outline` ("Outline"), key `Mod+Shift+O`, `global: true`,
   holds when a document is open. It builds the `OutlineSource` from `appHandle()`, using
   `sourceHarness()?.byteOffset` for `position()` and `open(path, { at })` for `land`.
3. `test/outline.test.mjs` (WebKit, `palette-boot.html`), using `fixtures/corpus/01-long-technical.md`.

**Acceptance.**
- At rest the DOM shows no outline (`dialog#marxy-outline` is not `[open]`), as ADR-0011 and
  ADR-0050 require (`outline.test.mjs`).
- `Mod+Shift+O` opens a list whose rows equal `outlineFrom(ast)` in order, text and level
  (`outline.test.mjs`).
- The marked row is the last heading at or above the reading position, and it updates after a
  scroll (`outline.test.mjs`).
- `↓ ↓ Enter` lands the third heading's block on the reading line (the same check
  `test/palette-index.test.mjs` uses for a heading jump) and closes the outline
  (`outline.test.mjs`).
- `Esc` closes it and `document.activeElement` is the article (`outline.test.mjs`).
- From Source mode, `Mod+Shift+O`, a row and `Enter` return to Rendered at that heading
  (`outline.test.mjs`).
- `>` in the palette lists "Outline" with its key (`outline.test.mjs`).

**Tests.**
- Stay green: `packages/core/src/outline/outline.test.ts`, `test/palette.test.mjs`,
  `test/palette-index.test.mjs`.
- Run: `pnpm precheck`, `pnpm check` (registry).

**Do not.**
- Change `packages/core/src/outline/` or `index.html`.
- Read module state from `app.ts`; use the handle.
- Add the section selection on `Enter` that design §09 mentions; landing is enough for Phase A.
- Add anything visible at rest.

**Risks and open questions.**
- The design says the outline takes "no second scroll listener" (§09) and reuses the per-frame
  position sample of §08, which the app does not expose. The listener here is passive, throttled
  and exists only while the outline is open. Name the departure in the pull request.

### A-16 — Open the document in an external editor, and open a file by dragging it onto the window

**Model:** opus · **Size:** M · **Depends on:** A-12 · **Parallel with:** A-09, A-13, A-15

**Outcome.**
- **External editor.** `Mod+Shift+E`, or "Open in external editor" in the palette, opens the
  document in the reader's editor at the current line: the reading position's line in Rendered
  mode, the cursor's line in Source. The editor comes from `external_editor` in `config.toml`, for
  example `code --goto {file}:{line}`. With none set, the platform opener is used. The command is
  never run through a shell, so a path with spaces or quotes cannot become a command. If it fails,
  one notice says why.
- **Drag to open.** Dropping a file onto the window opens it the way Finder or a second launch
  does, and this works on Linux too, where there is no menu.

**Why now.** `01-codebase-audit.md` §1.2 and §1.4: both are v1 scope items that are missing
(`revealInExternalEditor` is unimplemented in `shell/tauri.ts`, and there is no drag-drop listener).
`docs/design/09-app-shell.md` §Open in external editor, and D-A31 in
`docs/design/00-architecture.md:134`.

**Paths.**
- `apps/desktop/src-tauri/src/commands/os.rs`
- `apps/desktop/src-tauri/src/main.rs`
- `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/Cargo.lock`
- `scripts/allowlists/dependencies.json`, the `cargo` list only
- `apps/desktop/src/shell/tauri.ts`
- `apps/desktop/src/commands/editor.ts`
- `apps/desktop/test/external-editor.test.mjs` (new)
- `changelog.d/A-16.md` (new)

**Build order.**
1. `commands/os.rs`:
   - `pub fn editor_argv(template: Option<&str>, file: &str, line: u32, os: &str) -> Vec<String>`
     is a pure function.
     - With a template, split it on ASCII whitespace with no quoting rules, and substitute `{file}`
       and `{line}` inside each token. If no token contains `{file}`, append the file as the last
       argument.
     - With no template, use `open -t <file>` on macOS and `xdg-open <file>` on Linux.
   - `#[tauri::command] pub fn reveal_in_editor(app: tauri::AppHandle, path: String, line: Option<u32>) -> Result<(), ShellError>`
     reads `external_editor` from `config.toml` with the `toml` crate, on every call (design §09).
     It refuses a `path` that is not an existing absolute file, then runs
     `std::process::Command::new(argv[0]).args(&argv[1..]).spawn()`, detached and never through
     `sh -c`. Errors map to `ShellError` (`unsupported` or `io`).
   - Remove `#![allow(dead_code)]` (`os.rs:2`) if nothing in the file is dead any more.
2. `Cargo.toml`. Add `toml` at a version already in `Cargo.lock`, for example `0.9`, which is
   `0.9.12` at `Cargo.lock:4119`, so that no new crate enters. Add `toml` to the `cargo` list in
   `scripts/allowlists/dependencies.json`.
3. `main.rs`:
   - Register `commands::os::reveal_in_editor` in `generate_handler!` (`main.rs:815-834`). The
     config path comes from the same place `config_paths` resolves it.
   - Add `fn document_paths_from_drop(paths: &[PathBuf]) -> Vec<String>`: existing regular files
     only, through `absolute_document_path`.
   - In the `run` closure (`main.rs:837-863`), handle
     `RunEvent::WindowEvent { event: WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }), .. }`
     with `deliver_open_files(app, document_paths_from_drop(&paths))` (`main.rs:466`).
4. `shell/tauri.ts`. Add `revealInExternalEditor: (path, line) => invoke('reveal_in_editor', { path, line: line ?? null })`
   and add the member to the `Pick` list (`tauri.ts:56-72`). The memory shell already implements it
   (`shell/memory.ts:194`).
5. `commands/editor.ts`. Command `document.open-in-editor` ("Open in external editor"), key
   `Mod+Shift+E`, `global: true`. It holds when `appHandle()?.currentPath()` is set and does not
   start with `marxy:`.
   - **The line.** In Source, it is the CodeMirror cursor's line
     (`activeSourceEditor()?.view.state`, `doc.lineAt(selection.main.head).number`). In Rendered, it
     is `lineOf(buffer, byteOffset)` from `@marxy/core`'s buffer (`packages/core/src/buffer/buffer.ts:174`),
     where `byteOffset` comes from `sourceHarness()`.
   - **The shell call.** It calls `shell.revealInExternalEditor` when the shell has it, reaching the
     member through a type check the way `selection/view.ts:141` reaches `openExternal`.
   - **A failure** raises one notice: "Could not open <name> in the external editor: <reason>."
6. Tests:
   - Rust unit tests in `os.rs` for `editor_argv` and in `main.rs` for `document_paths_from_drop`;
   - `test/external-editor.test.mjs` in WebKit with the memory shell.

**Acceptance.**
- `editor_argv` has a Rust unit test for each of these:
  - `code --goto {file}:{line}` with a path containing a space gives
    `["code","--goto","/a b/c.md:12"]`;
  - a template with no `{file}` appends the path;
  - `;`, `$(…)` and quotes in the template or the path stay literal tokens;
  - no template gives `open -t` on macOS and `xdg-open` on Linux.
  Run with `cargo test --locked` in `apps/desktop/src-tauri`.
- `document_paths_from_drop` keeps files and drops directories and missing paths (a Rust unit test).
- In WebKit, `Mod+Shift+E` in Rendered with the reading block at line 40 records
  `revealInExternalEditor(path, 40)` on the memory shell, and in Source with the cursor on line 7
  records `7` (`external-editor.test.mjs`).
- A rejected call shows exactly one notice with the reason (`external-editor.test.mjs`).
- `pnpm gate:licences` and `pnpm check` are green: no new crate, and the dependency is allow-listed.
- Manual, on the built app. These go in the pull request with the author's or lead's confirmation:
  - dragging a `.md` file from Finder onto the window opens it;
  - dragging a folder does nothing;
  - `Mod+Shift+E` with `external_editor = "open -a TextEdit {file}"` opens TextEdit.

**Tests.**
- Stay green: `cargo test --locked`, `pnpm lint:rust`, `test/single-instance.test.mjs` and
  `test/open-path.test.mjs` (the open-files path the drop reuses), and
  `test/shell-boundary.test.mjs` (raw `invoke(` only under `src/shell`).
- Run: `pnpm precheck`, `pnpm gate:licences`, and `cd apps/desktop/src-tauri && cargo clippy --locked -- -D warnings`.

**Do not.**
- Pass the template or the path through `sh -c`, `cmd /C` or any shell.
- Read `external_editor` in the webview and send it to Rust. The webview never chooses the program
  (D-A31).
- Add a Tauri capability or touch `tauri.conf.json` (drag and drop is on by default).
- Change `packages/shell-api/src/index.ts`; `revealInExternalEditor` is already in the contract
  (`index.ts:35`).
- Add a drop overlay or any other chrome.

**Risks and open questions.**
- `toml`'s default features may pull in a crate that is not in `Cargo.lock` today. If `Cargo.lock`
  gains a crate, record its licence in `scripts/allowlists/crate-licences.json` as the gate
  requires, and list it in the pull request.
- On macOS the window may not report drops until the webview's drag handling is configured. If
  `WindowEvent::DragDrop` never fires, report it. Do not switch to the JS `onDragDropEvent` API
  without the lead, because that would add a capability.

### A-17 — Make the release workflow complete on a tag, for v0.1.0

**Model:** sonnet · **Size:** S · **Depends on:** A-01 … A-16 · **Parallel with:** A-11

**Outcome.** The release workflow has never completed: its three runs in history failed before any
job, and there is no tag. After this story, a manual dry run of the workflow builds an unsigned
macOS DMG and offers it as an artifact. When the author pushes the tag `v0.1.0`, the same workflow
creates a pre-release with that DMG attached. The app reports version 0.1.0, the changelog has a
0.1.0 section, and the README says how to install an unsigned build.

**Why now.** `04-tests-and-gates.md` §1.3, §4.5 and §6.1 ("Fix, not remove: `release.yml`, which
has never completed") and `00-executive-summary.md` §7 item 4. ADR-0046 makes Linux a release
criterion only when hardware exists, so v0.1.0 is macOS only.

**Paths.**
- `.github/workflows/release.yml`
- `apps/desktop/src-tauri/tauri.conf.json`, the `version` field only
- `apps/desktop/src-tauri/Cargo.toml` and `Cargo.lock`, the `marxy` package version only
- `apps/desktop/package.json`, the `version` field only
- `CHANGELOG.md` and `changelog.d/`, folded by `scripts/changelog.mjs`
- `README.md`, an "Install" section
- `docs/design/14-release.md`
- `changelog.d/A-17.md` (new, folded with the rest)
- *Added 2026-10-02 by the lead:* `scripts/gate-bundle.mjs` (the installer `katex` grep becomes an
  entry-chunk check: KaTeX is lazy-loaded on purpose, so the installer always holds its chunk) and,
  minimally, `orchestration/prompt-handshake.test.mjs` and `orchestration/review-order.mjs` (they look
  for two lines under `## Unreleased`, which the release fold moves under `## 0.1.0`)

**Build order.**
1. `release.yml`:
   - Triggers: `push: tags: ['v*']` and `workflow_dispatch`.
   - `permissions: { contents: write }`, which a release needs.
   - `timeout-minutes` on the job.
   - The matrix is `macos-latest`, `aarch64-apple-darwin`, `dmg` only, with a comment citing
     ADR-0046 for the Linux row's removal.
   - Steps:
     1. checkout and `jdx/mise-action`;
     2. `pnpm install --frozen-lockfile`;
     3. `pnpm --filter @marxy/desktop build:web`, because `tauri.conf.json`'s `beforeBuildCommand`
        is `""`, so the bundle would ship without a frontend;
     4. `tauri-apps/tauri-action` (already allowed), with `tagName`, `releaseName` and
        `prerelease: true` only when the event is a tag push, and `args` keeping `-- --locked`;
     5. `pnpm gate:bundle` with `MARXY_BUNDLE_REQUIRED=1`;
     6. on `workflow_dispatch`, `actions/upload-artifact` of
        `apps/desktop/src-tauri/target/**/bundle/dmg/*.dmg`.
   - Delete the "Import signing certificate" step that only echoes (`release.yml:27-30`), and keep
     the `APPLE_*` variables for later.
2. Versions. Set `0.1.0` in `tauri.conf.json`, the `[package]` of `Cargo.toml` (then
   `cargo update -p marxy --offline` or the minimal `Cargo.lock` edit) and `apps/desktop/package.json`.
3. Run `node scripts/changelog.mjs --release 0.1.0 --date <today>`. It folds every
   `changelog.d/*.md` into `CHANGELOG.md`.
4. `README.md` "Install": download the DMG from Releases, drag it to Applications, run
   `xattr -dr com.apple.quarantine /Applications/Marxy.app` (the build is unsigned), then open a
   README with it.
5. `docs/design/14-release.md`. State what v0.1.0 is (unsigned, macOS arm64, a pre-release) and
   the author's steps:
   1. a dispatch dry run;
   2. download and open the DMG;
   3. `git tag v0.1.0 && git push origin v0.1.0`;
   4. check the release.

**Acceptance.**
- `pnpm check` is green on the new `release.yml` (`check-workflows`: actions pinned or allowed,
  `--locked`, `timeout-minutes`).
- A `workflow_dispatch` run on the branch is green and its artifact holds `Marxy_0.1.0_aarch64.dmg`.
  The lead or author triggers it (`gh workflow run release --ref <branch>`), and the URL is in the
  pull request.
- `CHANGELOG.md` has a `## 0.1.0 - <date>` section, `changelog.d/` holds only its `README.md`, and
  `node --test scripts/changelog.test.mjs` is green (if that file exists; otherwise the fold
  script's own tests).
- The built app's About panel or `Info.plist` reports 0.1.0 (from the dispatch artifact).
- After the author's tag, the release run is green and the pre-release has the DMG. The author
  checks this; it is the phase's last step.

**Tests.**
- Stay green: `pnpm check`, `pnpm test`, and `pnpm gate:bundle` (which reads `bundle_installed_mb`).
- Run: `pnpm precheck`.

**Do not.**
- Tag, push a tag, or create a release; that is the author's.
- Add signing or notarisation.
- Add Linux to the release matrix without the author.
- Change `beforeBuildCommand`. Building the web assets in the workflow is enough, and the change
  would alter `pnpm --filter @marxy/desktop build` for everyone.

**Risks and open questions.**
- `tauri-action` finds the Tauri CLI through the package manager in `projectPath`. If it cannot
  find `pnpm`, set `tauriScript: pnpm tauri`.
- If stories merge after the fold, re-run `scripts/changelog.mjs --release 0.1.0` before tagging,
  or let those fragments wait for 0.2.0. The author decides.

---

## Verification at the end of the phase

Run on the author's machine from a clean `main` after A-17 merges.

```bash
pnpm install --frozen-lockfile && pnpm exec playwright install webkit
pnpm check && pnpm typecheck && pnpm lint && pnpm test && pnpm test:fleet
pnpm gate:golden && pnpm gate:fidelity && pnpm gate:no-network && pnpm gate:licences
pnpm gate:aesthetics && node scripts/gate-aesthetics.mjs --mechanical
MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test:lite
MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test          # the full suite
pnpm --filter @marxy/desktop test:mutations
(cd apps/desktop/src-tauri && cargo test --locked && cargo clippy --locked -- -D warnings)

# Performance: the 1 MB criterion, and no regression on the corpus
pnpm perf --build --runs 5 --files 01-long-technical.md,15-prose-volume.md,32-long-reference.md --large 256k,1m
#   expect: 1m first_text median < 1,000 ms; 256k < 300 ms; corpus within ±10 % of A-01's "before" table

# CI shape
gh run list --workflow ci --limit 10 --json event,conclusion,createdAt,updatedAt
#   expect: push runs on main have changes + fast + ci only; a product PR's run wall time ≈ 5 min or less
gh run list --workflow nightly --limit 3      # expect: green, with perf-harness, startup-macos/build-macos, rust-linux, browser-full, fleet
gh workflow run release --ref main            # the dry run; download the DMG artifact
```

**Manual check by the author.** Install the dispatch DMG, then run
`xattr -dr com.apple.quarantine /Applications/Marxy.app`.

1. **Launch from the Dock.** The frontispiece shows, with no chrome.
2. **Two repositories.** Open a README in repository A through File › Open…, then drag a file from
   repository B onto the window. `Mod+P` and a word from each repository finds documents in both.
3. **Light.** `Mod+P`, then `>light`, then `Enter`: the page turns light at once. Quit and
   relaunch, and it is still light.
4. **The outline.** `Mod+Shift+O`, then `↓`, then `Enter`: the heading lands on the reading line,
   and `Esc` returns.
5. **A 1 MB transcript.** Generate it with `node scripts/perf-harness.mjs --write /tmp --large 1m`
   and open `/tmp/big-1m.md` from the Dock app. The first screen is visible well under a second
   later. For a number:
   `MARXY_QUIT_AFTER_PAINT=1 /Applications/Marxy.app/Contents/MacOS/marxy /tmp/big-1m.md | grep -E 'MARK (main_start|first_text)'`
   prints the two marks.
6. **The external editor.** `Mod+Shift+E` opens the document at the reading line.
7. **The rest of the palette.** `>` lists Save, Undo, Toggle Rendered / Source, Back, Forward,
   Outline, the size commands and the trust commands where they apply.

Then the author tags: `git tag v0.1.0 && git push origin v0.1.0`, and checks that the release run
is green and the pre-release carries the DMG.

## What this phase deliberately leaves out

| Left out | Where it goes | Why not here |
| --- | --- | --- |
| The N-document store and per-article view (ADR-0037 as amended); `app.ts` under 300 lines | Phase B | A-02's `render/progressive.ts` and A-04's `index/service.ts` are written to be lifted into it unchanged |
| Deleting the Rust indexer, the legacy palette model, `source/mode-toggle.ts` and the `MARXY_*_MUTATION` hooks (`12` step 4) | Phase B | Deletions are safer after the store refactor settles the module graph |
| Retiring `render/headless.ts` and pointing the aesthetics gate at the app harness (`12` step 5) | Phase B | A-10 changes only what the gate compares, not what it renders |
| Unfreezing the contracts (`test:contracts-frozen`, ADR-0045) and making `Shell` the real interface | Phase B | Nothing in Phase A needs a contract change |
| Remote images as a setting (ADR-0044), the Linux weight table, `typeset = false` | Phase B | Half-features waiting on a decision |
| Incremental live reload by block (`05` §11.2 rank 9); the first-IPC stall (rank 3); palette incremental filtering (rank 7); installed weight (rank 6); parse in a worker | Phase B or later | A-03's nightly record will show whether each still matters after A-01 and A-02 |
| The remaining timing assertions (`highlight.test.ts:102,133`, `marxy-337.test.ts:37`, `user-theme.test.mjs:146`, `typeset.test.mjs:104`) | Phase B | Only `search-perf.test.ts`, which the harness replaces, is changed here |
| Recursive watching of collection roots, `collection.toml`, the empty state | Phase C | A-04 indexes roots a document was opened in, and that is all |
| Find in Rendered mode (`Mod+F`, design §09) | Not in any phase of the roadmap | A missing v1 scope item; see the questions below |
| A signed and notarised DMG; Linux AppImage and deb releases; Flatpak | After E (ADR-0046) | No Apple account or Linux desktop yet |
| About document, window controls hidden at rest (ADR-0038) | Not scheduled | Not in the roadmap's Phase A |
| Deleting `orchestration/state.json`, `results/` or `canvases.mjs` (`13` §3.4) | Author's call | The orchestrator stays frozen as it is |

## Questions only the author can answer

1. **Is a variant toggle remembered?** A-14 assumes yes: it writes `variant` to `config.toml`, a
   third write case beside `size` and `theme` in design §11.
2. **Is a pre-paint config read acceptable?** A-14 reads `config.toml` before first text, a few
   milliseconds, to avoid a dark-to-light flash. If not, the variant is applied after `first_text`.
3. **v0.1.0 is macOS only (A-17).** Is that right, or should the Linux AppImage and deb stay in the
   release workflow on a best-effort basis?
4. **The WebKit tests that never ran.** Sixty-odd WebKit tests of the typesetter, theme and KaTeX
   run nightly from A-10. If they fail on Linux WebKit, are they fixed or deleted?
   (`04-tests-and-gates.md` §6, last paragraph)
5. **Find in Rendered mode** (`Mod+F`) is a v1 scope item, and no phase of the roadmap builds it. Which
   phase gets it?
6. **Should `orchestration/loop.sh` refuse to start while `PAUSED.md` exists?** A-07 adds only the
   file, because the orchestrator is frozen.
