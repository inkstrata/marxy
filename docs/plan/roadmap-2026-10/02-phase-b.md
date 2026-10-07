# 02 — Phase B: the shell refactor

**Date:** 2026-10-02 · **Phase:** B of A–E · **Ends with:** v0.2.0 · **Source:**
`docs/research/audit-2026-10/14-roadmap-proposal.md` "Phase B", `12-recommendation-codebase.md`
steps 2, 4, 5, 6 and 8, `01-codebase-audit.md` §2.3, §2.4, §3.2, §6, §8,
`07-feature-split-view.md` §2.2, §2.3, §5, §6, and `docs/adr/0037-one-document-store.md`.

**Abstract.** Phase B changes almost nothing a reader can see. It rebuilds the top of the
desktop app so that two documents can later sit side by side, undo and save stop depending on a
content hash, and the gates measure the page a reader actually gets. The work comes in four
lanes. First, the aesthetics gate is moved off its private render pipeline and onto the real
app (B-01, B-02), so the refactor that follows is checked by the gate. Second, there is a strict
chain of eight stories on `apps/desktop/src/app.ts` (B-08 to B-15, with B-04 built beside them): start-up
measurement, the image-grant deletion, trust, the N-document store, selection, the per-article
view, live reload and persistence, and the open path. At the end, `app.ts` is a composition root
under 300 lines with no module-level `let`. Third, deletions and the theme fix run beside that
chain wherever their paths are disjoint (B-03, B-05, B-06, B-07). Fourth, there is clean-up that
needs the chain finished first: test hooks, the typesetter switch, the `Shell` interface and the
package boundaries (B-16 to B-19). B-20, remote-image loading by setting, was ruled by the
author. The large-document levers have moved to Phase A. Phase B carries a duty not to undo them,
and that duty is stated once, in the section "Carried over from Phase A".

Line references below are to `origin/main` at `bc05670f` (the audit's tree). Phase A and the
earlier stories of this phase move code, so a story locates code by the **function name** it
cites and treats the line number as a hint.

---

## Phase goal and screen criterion

From `14-roadmap-proposal.md`, Phase B:

> **Ends with:** v0.2.0; nothing new on screen, everything the same, and the code ready for two
> documents.
>
> **Screen criterion:** a 1 MB transcript shows its first screen in well under a second (today
> 4–5 s); otherwise nothing visible changes, by design, and the gates and the desktop suite prove
> nothing moved. The undo-after-failed-save and undo-after-Source defects from ADR-0037 are fixed
> and tested.

On 2026-10-02 the author moved the first half of that criterion into Phase A, which now lands the
grid-pass rewrite, first text from the first two screens, and partial-layout support. Phase B must
**not regress** the 1 MB number (see "Carried over from Phase A"). Phase B owns everything else in
the criterion.

## Preconditions (on `main` before wave 1 starts)

Phase A's document was being written at the same time as this one. These are the Phase A results
this plan assumes. If one is missing when wave 1 is due, the lead checks with the Phase A
document and adjusts the named story. The lead does not start that story unchanged.

1. **Fleet paused and PR path pruned** (`04-tests-and-gates.md` §6). Every story here passes the
   pruned path: conventional subject, `changelog.d/<id>.md`, green product gates, one review.
   Until the pruning lands, stories pass the current CI (`00-orchestration.md` §6).
2. **ADR-0037 accepted with the per-document amendment.** The store holds what is true of the
   bytes (`path`, `disk`, `buffer`, `ast`, `nodeMap`, `history`, `version`). A view holds `mode`,
   `anchor`, the scroller, the typesetter, the resize observer, the Source editor and the
   selection. A store is keyed by canonical path, and many views may subscribe
   (`07-feature-split-view.md` §2.3). ADR-0044 (remote content is a setting), ADR-0045 (contracts
   change by PR), ADR-0046 (Linux is a release criterion) and ADR-0047 (visual comparison nightly)
   are recorded as proposed or accepted.
3. **The index has an owner** (`12` step 1): `apps/desktop/src/index/service.ts` exists, the
   one-shot hand-off in `main.ts:11-14` and `startApp`'s `onIndexLoaded` / `deliverIndex`
   (`app.ts:367`) are gone, and the walker decision is made (TypeScript or the Rust module).
   B-05 reads that decision.
4. **What was built is wired** (`12` step 3). The palette lists every command whose `when` holds.
   `Mod+E` and both history listeners are registry commands. Config `variant` and `size` are
   applied in the app. The outline, open-in-external-editor and drag-to-open are reachable.
5. **The large-document lane has landed**: a one-read-pass, one-write-pass grid in
   `packages/typeset/src/grid.ts`, deferred first paint, the reading-position restore working on a
   partial layout, and a harness measurement test (see "Carried over from Phase A").
6. **v0.1.0 is tagged.**

## Carried over from Phase A

The large-document levers (`05-performance-audit.md` §9, §11.1 rank 1, §11.2 rank 8) are Phase A
stories. Phase B moves the code they changed, so it carries three obligations:

- **Deferred first paint survives the move.** When B-13 lifts the per-article view into
  `apps/desktop/src/view/rendered-view.ts`, the view keeps Phase A's order. It puts the first two
  screens of blocks in the DOM, emits `first_text`, and appends the rest in idle chunks (or keeps
  `content-visibility: auto`, whichever Phase A chose). No step of the move may force a
  whole-document layout before `first_text`.
- **One-pass grid scheduling survives the move.** The view keeps Phase A's grid scheduling: one
  read pass, then one write pass, with background passes coalesced. Today's coalescing of
  background passes to one snap per `SNAP_INTERVAL_MS` (`app.ts:692-721`) becomes per view, never
  per window.
- **The number is checked.** Phase A adds a harness measurement test of `first_text` at 256 KB and
  1 MB. This plan expects it at **`apps/desktop/test/large-document.test.mjs`**, generating its
  inputs from `fixtures/corpus/gen-long-reference.mjs` or by repeating
  `fixtures/corpus/01-long-technical.md` as the audit did (`05` §13.3, `webkit-app.mjs`). If Phase A
  named or placed it differently, every story below that cites it uses Phase A's file instead and
  says so in its PR. B-11, B-13, B-14 and B-15 run it before and after and quote both numbers in
  the PR body. A rise of more than 10 % at 1 MB is a `return`.

## The three ADR-0037 defects

ADR-0037 reproduced three defects at `ee33feb`. Two later stories patched their symptoms:
MARXY-49 made save explicit and MARXY-337 pushed history only after a render succeeds. The cause
is still there, though. Undo history lives in `commands/edits.ts` module globals and stays valid
only while a content hash matches (`historyFor`, `edits.ts:39-45`). It runs on its own queue
(`mutationChain`, `edits.ts:181-186`), separate from `app.ts`'s `serially`. Phase B removes the
cause.

| # | Defect (ADR-0037 §Context) | State on `main` today | Fixed structurally by | Test that proves it |
| --- | --- | --- | --- | --- |
| 1 | **A failed write poisons undo** | Symptom covered: `apps/desktop/test/data-loss.test.mjs:163` ("a failed save leaves no phantom history") | **B-11**: history lives in the store; a transition commits only after its effects succeed (ADR-0037 §4) | New `apps/desktop/src/document/store.test.ts` (B-04): "a failed save leaves the snapshot identical and the next undo stays inside the history"; `data-loss.test.mjs:163` stays green |
| 2 | **Undo is dead after Source** | The one-entry case is covered by `save-close-r5.test.mjs:232`. The ADR's exact sequence (toggle a task, type in Source, return, `Mod+Z` twice) has **no test**. Reload and rename still drop history by hash | **B-11**: `commitSource` pushes exactly one entry and history follows the buffer, not a hash | `store.test.ts` (B-04) and the new browser test `apps/desktop/test/store-undo.test.mjs` (B-11) with the ADR's sequence |
| 3 | **Operations write to disk; Source edits do not** | Fixed by MARXY-49: `explicit-save.test.mjs:128`; `data-loss.test.mjs` asserts "an operation alone does not write the file" | **B-11** keeps it structural: the store's `apply`/`commitSource` have no writer; `dirty` is derived (`buffer ≠ disk`) | `store.test.ts` (B-04): "apply and commitSource never call writeFileAtomic; dirty is buffer ≠ disk" |

## Dependency graph and waves

The chain on `app.ts` is serial by rule: "a wave that touches `apps/desktop/src/app.ts` has
exactly one story on that file" (`00-orchestration.md` §5). Waves respect the cap of four
implementors, at most two on Opus.

```
B-01 ─▶ B-02
B-04 ───────────────────────────────┐
B-08 ─▶ B-09 ─▶ B-10 ─▶ B-11 ─▶ B-12 ─▶ B-13 ─▶ B-14 ─▶ B-15 ─▶ ┬ B-16 ─┐
                                                                  └ B-17 ─┴▶ B-18 ─▶ B-19 ─▶ (B-20)
B-03, B-05, B-06, B-07: independent, early
```

| Wave | Stories (model) | Touches `app.ts` | Why these together |
| --- | --- | --- | --- |
| 1 | B-01 (opus), B-04 (opus), B-03 (sonnet), B-05 (sonnet) | B-01 only | The gate entry first, so the refactor is measured. The store is new files only. Theme and deletions are disjoint |
| 2 | B-02 (opus), B-08 (sonnet), B-07 (sonnet) | B-08 only | The gate switches to the app. Measurement leaves `app.ts`. The weight table is theme only |
| 3 | B-09 (sonnet), B-06 (sonnet) | B-09 only | The grant deletion shrinks what B-10 lifts. Unfreezing touches only root and docs |
| 4 | B-10 (opus) | yes | Trust controller |
| 5 | B-11 (opus, L) | yes | Store wired: history, dirty, save; the ADR-0037 defects |
| 6 | B-12 (opus) | yes | Selection and commands read the store |
| 7 | B-13 (opus, L) | yes | Per-article view |
| 8 | B-14 (opus) | yes | Live reload and reading persistence leave `app.ts` |
| 9 | B-15 (opus) | yes | Open path leaves; `app.ts` < 300 lines, no `let` |
| 10 | B-16 (sonnet), B-17 (sonnet) | no | Test hooks; the typesetter switch |
| 11 | B-18 (opus) | types only | `Shell` becomes the real interface |
| 12 | B-19 (sonnet) | imports only | Package exports, `core/paths.ts` |
| 13 | B-20 (opus), conditional | no | Only after the author rules on the loading mechanism |

Twenty stories (B-20 conditional): nine Sonnet and eleven Opus; at most one L per wave.

## Verification at the end of the phase

Commands, run on `main` after B-19 merges (B-20 if ruled in):

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test            # or the pruned equivalent Phase A names
pnpm precheck --all
pnpm gate:golden && pnpm gate:fidelity && pnpm gate:no-network
pnpm gate:aesthetics                                 # now measures the app (B-02)
pnpm check:boundaries                                # rejects @marxy/*/src/ deep imports (B-19)
MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test
node --test --experimental-strip-types apps/desktop/test/large-document.test.mjs   # 256 KB and 1 MB first_text
cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --locked -- -D warnings && cargo test --locked
wc -l apps/desktop/src/app.ts                        # < 300
grep -c '^let ' apps/desktop/src/app.ts               # 0
node --test apps/desktop/test/module-state.test.mjs   # B-15's gate
```

The Linux aesthetics run happens in CI's Playwright image (`mcr.microsoft.com/playwright:v1.63.0-noble`).
Nightly visual comparison against the v0.1.0 tag produces a before/after sheet, and the author
looks at it.

**The author's manual check** on a built app (`pnpm --filter @marxy/desktop bundle`, open the DMG):

1. Launch from the Dock. The frontispiece shows. Open a README from the palette. It looks as it did in v0.1.0.
2. Open a 1 MB agent transcript. The first screen appears in well under a second. Scroll to the end.
3. Tick a task, press `Mod+E`, type a word, press `Mod+E`, then `Mod+Z` twice. The word goes, then the tick. `Mod+S` writes, and the title loses its dot.
4. Make the file read-only (`chmod -w`), tick, `Mod+S`: a notice. Undo twice: nothing else in the file changes.
5. Append a line to the open file from a terminal. It reloads in place, at the same reading position.
6. Quit with unsaved edits. You are asked once.
7. Open a README with badges. A plain "images not loaded" notice appears, with no per-host button (B-09).

Then tag **v0.2.0**.

---

## Stories

### B-01 — Give the app harness a render entry the aesthetics gate can drive

**Model:** opus · **Size:** M · **Depends on:** Phase A preconditions 4 and 5 · **Parallel with:** B-03, B-04, B-05

**Outcome.** A Playwright page can ask the real app, started with `startApp` over a memory shell,
to render a corpus file at a given width, variant and text size. It gets back the same
layout-shift report the headless entry returns today. The app emits a new `typeset_done` mark
when the typesetter has considered every paragraph. Nothing a reader sees changes, and the gate
does not use this entry yet; B-02 switches it.

**Why now.** `render/headless.ts` re-implements parse → render → typeset for the gate and skips
highlighting, KaTeX, notices and the frontispiece, so the gate judges a page no reader sees
(`01-codebase-audit.md` §2.4, `12` step 5). Moving the gate first means every later refactor
story in this phase is checked against the real app.

**Paths.**
- `apps/desktop/src/app.ts`: in `typesetDocument` only (`app.ts:965-970`)
- `scripts/registry.json`: the `marks` list
- `apps/desktop/src/harness/layout-shift.ts` (new)
- `apps/desktop/src/harness/gate-entry.ts` (new)
- `apps/desktop/gate.html` (new)
- `apps/desktop/test/gate-entry.test.mjs` (new)

**Build order.**
1. `scripts/registry.json`: add `"typeset_done"` to `marks` (names come from the registry first).
2. `app.ts` `typesetDocument(article)`: after the existing `typeset_viewport` mark, add
   `void controller.done.then(() => shell.mark('typeset_done', Date.now(), \`set=${controller.stats.typeset}\`))`.
   It must not be awaited: first text and `ready` must not wait for it. A destroyed controller
   never resolves `done` (`packages/typeset/src/index.ts`, `restoreAll`), so no mark is emitted
   for a superseded document. That is correct.
3. `harness/layout-shift.ts`: copy the measurement helpers from `render/headless.ts`, with their
   types: `assertCanObserveShift` (`:58`), `snapshotBlocks` (`:75`), `unionArea` (`:124`),
   `movedFraction` (`:162`), `awaitArticleFonts` (`:195`), `awaitReservedImages` (`:208`) and
   `finishShift` (`:266`). This is a copy, because B-02 deletes the original. Export them
   unchanged.
4. `gate.html`: the `index.html` skeleton (`#marxy-main` > `#marxy-notices` + `article#doc.marxy-article`,
   `#marxy-source[hidden]`, `dialog#marxy-palette`, `dialog#marxy-outline`, `#marxy-find[hidden]`)
   and the same inline style block as `index.html`, with
   `<script type="module" src="./src/harness/gate-entry.ts">`. The `<!-- marxy:fonts -->` and
   `<!-- marxy:default-theme -->` placeholders stay, so `vite.config.ts` inlines the fonts and
   the theme as it does for `index.html`.
5. `harness/gate-entry.ts`: `window.marxyGate = { render(source: string, opts: { variant: 'dark'|'light'|'auto'; width: number; size?: number; theme?: string }): Promise<{ stats: LayoutShift }> }`.
   - Encode `source` to bytes at `/corpus/document.md`, and put `fixtures/corpus/image.png`'s bytes
     (passed in by the caller as base64, or fetched from the gate server) at `/corpus/image.png`,
     so relative images resolve.
   - Write `/config` (the memory shell's `configPaths().config`, `shell/memory.ts:204-206`) as
     TOML with `variant` and `size`. This relies on Phase A applying them in the app.
   - Set `#marxy-main`'s width to `opts.width` px. If `opts.theme` is set, call `adoptRuntimeSheet`
     (`@marxy/theme/src/loader.ts`) with it, as `headless.ts:330-332` does.
   - `startApp(createMemoryShell(files), { argv: ['/corpus/document.md'] })`, then `await handle.ready`.
     `ready` settles after `finishDocumentOpen`, which awaits the idle deferred start-up: images,
     KaTeX, highlighting, theme.
   - Then `awaitArticleFonts` + `awaitReservedImages`, then snapshot. Then `document.fonts.ready`,
     then snapshot. Then wait until `shell.calls` holds a `typeset_done` mark (poll per animation
     frame, 10 s cap → throw). Then two frames and a snapshot, two frames and a snapshot. Return
     `{ stats: finishShift(snaps) }`.
   - If Phase A's deferred first paint appends blocks after `ready`, also wait for the mark
     Phase A emits when the whole document is in the DOM. If Phase A emits none, stop and report:
     do not invent one here.
6. `test/gate-entry.test.mjs`: build `gate.html` with Vite as `test/app-harness.test.mjs` does,
   render `fixtures/corpus/01-long-technical.md` at 960 dark 20, and assert:
   - `stats.observed === true` and `stats.snapshots >= 4`;
   - `#doc h1` has text and the article's computed `font-family` matches `/Literata/`;
   - `[data-marxy-variant]` is `dark`;
   - a `typeset_done` mark is in `shell.calls`.
   A second case uses `variant: 'light'` and asserts the attribute is `light`.

**Acceptance.**
- The app emits `typeset_done` once per document after `typeset_viewport` and never before
  `first_text`: `apps/desktop/test/gate-entry.test.mjs` (mark order from `shell.calls`).
- `window.marxyGate.render` returns an observed layout-shift report for a corpus file:
  `gate-entry.test.mjs`.
- Variant and size from the config file reach the page: `gate-entry.test.mjs` (light case, and
  a 24 px case asserting `getComputedStyle(#doc).fontSize === '24px'`).
- The production bundle contains no gate entry: `pnpm gate:bundle` (it already refuses
  `createMemoryShell` and `marxyApp` in the bundle; extend its forbidden list with `marxyGate`
  only if `gate:bundle` passes without it, and say so).
- `app-harness.test.mjs`'s recorded call list is unchanged except for the added mark (update its
  expected list if it pins every mark).

**Tests.** Keep green: the 15 guarding desktop files (`app-harness, close-guard, data-loss,
explicit-save, links, live-reload, open-path, operations-edit, persist-reading, save,
save-close-r5, save-trust-r4, selection, single-instance, trust`), `typeset-defaults.test.mjs`,
`paint-signal.test.mjs`, and `pnpm check:registry`. New: `test/gate-entry.test.mjs`. Run
`pnpm precheck` and `MARXY_BROWSER_TESTS_REQUIRED=1 node --test --experimental-strip-types apps/desktop/test/gate-entry.test.mjs`.

**Do not.** Touch `scripts/gate-aesthetics.mjs` or `render/headless.ts` (B-02). Await `controller.done`
on any path the reader waits for. Add any member to `AppHandle`. Import the gate entry from
`main.ts`.

**Risks and open questions.** If Phase A's config wiring applies `variant` and `size` only after
first paint, the first snapshot sees a 20 → 24 px reflow, and that is a real layout shift a reader
of a 24 px config sees too. Report it with the numbers; do not hide it with a pre-sized page.

---

### B-02 — Point the aesthetics gate at the app and delete the headless pipeline

**Model:** opus · **Size:** M · **Depends on:** B-01, B-03 · **Parallel with:** B-07, B-08

**Outcome.** `pnpm gate:aesthetics` renders every corpus file through the real app (highlighting,
KaTeX, notices, user-theme loading included) instead of a 412-line copy of it.
`render/headless.ts`, `render/stub.ts` and `render/vite.config.ts` are gone, along with the second
`attach()` call site the typeset-defaults test compared against. The screenshot and rag baselines
are regenerated on both engines, because the gate now measures a different page, and a queue
note says so.

**Why now.** `01-codebase-audit.md` §2.4 and §3.2 (497 lines), `12` step 5. After this, every
story in the `app.ts` chain is checked by the gate.

**Paths.**
- `scripts/gate-aesthetics.mjs`
- `apps/desktop/src/render/headless.ts` (delete)
- `apps/desktop/src/render/stub.ts` (delete)
- `apps/desktop/src/render/vite.config.ts` (delete)
- `apps/desktop/src/harness/gate-entry.ts` (adjustments only)
- `apps/desktop/test/variant-render.test.mjs`
- `apps/desktop/test/layout-shift-window.test.mjs`
- `apps/desktop/test/typeset-defaults.test.mjs`
- `packages/theme/test/grid.test.mjs` (the stale comment at `:4` only)
- `fixtures/baselines/webkit-macos/**`, `fixtures/baselines/webkit-linux/**`, `fixtures/baselines/rag/**`
- `docs/aesthetics-acceptance.md`
- `docs/design/10-gates-and-testing.md` (where it names the headless entry)
- `docs/taste-review/queue.d/B-02.md` (new)

**Build order.**
1. `gate-aesthetics.mjs` `buildRenderEntry()` (`:113-140`): build `apps/desktop/gate.html` with
   Vite (`root: desktop`, `rollupOptions.input: { gate: 'gate.html' }`, `outDir` a temp dir or
   `dist/gate`) instead of the lib build of `render/vite.config.ts`. `startHarness()` (`:143`)
   serves that output, with `/` → `gate.html`, and serves `fixtures/corpus/image.png`.
2. `renderCorpus(page, origin, source, opts)` (`:873-877`): wait for `window.marxyGate` and call
   `marxyGate.render(source, opts)`. Every other caller keeps its shape: the corpus matrix, the
   theme fixtures (`:1031-1052`), the reflow modes (`:1054-1080`) and `clsCorpusPass`.
3. The selftest smoke (`:974-990`): assert through `marxyGate`; rewrite the note text from
   "dist/render.js painted…" to "the app harness painted…".
4. `selftest()` (`:738`) and `craftedClsShift` (`:714-737`): wherever they use
   `window.marxyLayoutShift`, load `harness/layout-shift.ts` through `gate.html`. Expose it as
   `window.marxyGate.layoutShift` in `gate-entry.ts`.
5. Delete `render/headless.ts`, `render/stub.ts` and `render/vite.config.ts`. Then
   `git grep -n "headless.ts\|render/stub\|render/vite.config\|marxyRender\|render.js"` over
   `apps scripts packages .github` must print nothing.
6. Tests:
   - `variant-render.test.mjs` (MARXY-46): rewrite on `marxyGate.render` with `variant: 'light'`
     and `'auto'`. The assertions keep their meaning.
   - `layout-shift-window.test.mjs`: point its source-text assertions (`:44-70`) at
     `harness/gate-entry.ts` and `harness/layout-shift.ts`, and drop the build of
     `render/vite.config.ts` (`:82`).
   - `typeset-defaults.test.mjs`: delete the "app.ts and headless.ts pass attach() the same option
     set" case (`:72`) and `attachOptionsHeadless`; keep the `app.ts` cases (`:86` onward).
7. Baselines: on macOS run `pnpm gate:aesthetics --update`, then `pnpm gate:aesthetics`. For Linux,
   run the same pair inside the CI image on a copy of the worktree:
   `docker run --rm -v "$PWD":/w -w /w mcr.microsoft.com/playwright:v1.63.0-noble bash -lc 'corepack enable && pnpm install --frozen-lockfile && pnpm gate:aesthetics --update; pnpm gate:aesthetics'`.
   That is the procedure `11-corpus-additions.md` §4 records. If Phase A has moved screenshot
   comparison to a nightly script (ADR-0047), regenerate the baselines that script reads, the
   same way. Commit both engines' changes in this story only.
8. `queue.d/B-02.md`: one row. "The aesthetics gate now renders through the app: highlighting,
   KaTeX, notices and the frontispiece styles are in the baselines. Before/after: the v0.1.0
   baselines vs this commit's, under `results/diffs/<engine>/`." Attach the count of changed PNGs
   per engine.
9. Docs: `docs/aesthetics-acceptance.md` and `docs/design/10-gates-and-testing.md` say the gate
   renders through the app harness (`apps/desktop/gate.html`).

**Acceptance.**
- No file in the tree names `render/headless.ts`, `marxyRender` or `render.js`: a
  `git grep` line in the PR's Verification section, and `pnpm gate:aesthetics` builds without
  `src/render/vite.config.ts`.
- `pnpm gate:aesthetics` passes on macOS with the regenerated baselines, and the `--selftest` mode
  still fails each crafted page (`node scripts/gate-aesthetics.mjs --selftest`).
- `variant-render.test.mjs` and `layout-shift-window.test.mjs` pass against the app entry.
- The Linux baselines are regenerated in the pinned image and the CI aesthetics job (or nightly)
  is green: the PR's CI run.
- The PR body quotes the gate's wall time before and after.

**Tests.** As above, plus the 15 guarding desktop files. Gates: `pnpm gate:aesthetics`,
`node scripts/gate-aesthetics.mjs --selftest`, `pnpm precheck`.

**Do not.** Loosen a threshold, add an allow-list, or skip a corpus file to get green. A check
that now fails because the app does something the headless page did not (KaTeX boxes moving, a
notice above the article, highlight spans) is a finding: report it with the file, width and
number, and stop. Touch `app.ts` (B-01 is done and B-08 is running). Keep any baseline from a
`--update` run for a file whose page did not change in that engine. `11` §4 records drift between
two runs. Discard drift and keep only real changes, with a sentence in the queue row.

**Risks and open questions.**
- **Runtime.** A full `startApp` per page is heavier than the lib entry. If the gate's wall time
  more than doubles, report the number and the slowest files before optimising.
- **Path filter.** `scripts/gates-by-path.json` maps `fixtures/corpus` away from the aesthetics
  gate (`11` §5). If Phase A's pruned CI path-filters the gate, make sure `apps/desktop/src/app.ts`,
  `view/` and `document/` are in its trigger paths now that the gate measures them. Report if the
  file is outside this story's paths.

---

### B-02.1 — Keep a wrapped, line-split code fence on the grid

**Model:** opus · **Size:** S–M · **Depends on:** B-01 · *Added 2026-10-02 by the lead, from B-02's findings.*

**Outcome.** `28-artifact-fences.md` at 960 px, size 16, dark and light, passes the grid check. Today the
app splits a diff fence into per-line spans (`span.marxy-line`, `data-marxy-done="lines"`); a wrapped `+`
line makes the first `<pre>` 354 px (29.5 grid units at a 12 px unit), the grid pass leaves its
`padding-bottom` at 12 px, and every block after it is 6 px off (first failure `<h2> top 642.00`).
Size 20 passes. Code line-height is 30 px at every body size (16, 20, 24, 28) in the app — check whether
that is the theme's intent (docs/research/reader-typography/ on code) or part of the defect.

**Evidence.** B-02 switched the aesthetics gate from `render/headless.ts` to the real app (via B-01's
`marxyGate.render`) and the mechanical gate failed where the headless page never looked. B-02's
uncommitted work in `../marxy-wt/B-02` reproduces it: `node scripts/gate-aesthetics.mjs --mechanical`.
Fix the app, not the gate; do not loosen any bound; do not touch `fixtures/baselines/` (B-02 regenerates
them once these land). If the fix needs `apps/desktop/src/app.ts` (B-08 owns it this wave), stop and report.

**Paths.** `packages/typeset/src/grid.ts`, the code-line pass that adds `span.marxy-line`
(find it), `packages/theme/src/base.css` (code line-height only, if it is the cause), and a test that
fails today (WebKit, the real app via `marxyGate.render` or the app harness). `changelog.d/B-02.1.md`.

### B-02.2 — Keep inline math from growing a list item off the grid

**Model:** sonnet · **Size:** S · **Depends on:** B-01 · *Added 2026-10-02 by the lead, from B-02's findings.*

**Outcome.** `30-notebook-export.md` at 960 px, size 16, dark and light, passes the grid check. Today a list
item holding inline KaTeX (`\Delta T`, `0.33`) is 48.98 px tall instead of 48 (the KaTeX span sits at
`vertical-align: -1.53px`), and the next `<li>` lands at 8256.98. Inline math must not change the line box.

**Evidence.** B-02 switched the aesthetics gate from `render/headless.ts` to the real app (via B-01's
`marxyGate.render`) and the mechanical gate failed where the headless page never looked. B-02's
uncommitted work in `../marxy-wt/B-02` reproduces it: `node scripts/gate-aesthetics.mjs --mechanical`.
Fix the app, not the gate; do not loosen any bound; do not touch `fixtures/baselines/` (B-02 regenerates
them once these land). If the fix needs `apps/desktop/src/app.ts` (B-08 owns it this wave), stop and report.

**Paths.** `packages/theme/src/base.css` (the inline `.katex` rules only) or the KaTeX render
wrapper in `packages/core/src/render/` if the box is set there; a test that fails today; `changelog.d/B-02.2.md`.

### B-02.3 — Keep a hidden-character line inside a 320 px window

**Model:** opus · **Size:** S–M · **Depends on:** B-01 · *Added 2026-10-02 by the lead, from B-02's findings.*

**Outcome.** `29-hidden-characters.md` at 320 px and at 400 % zoom (dark) has no horizontal scroll. Today a
line-break span from the line breaker (`span.marxy-lb`) ends at 329.4 px (`horizontal scroll 329px >
320px viewport`); the headless page gave exactly 320. Likely the invisible-character markers and the line
breaker run in a different order in the app, so the breaker measures text without the markers' width.

**Evidence.** B-02 switched the aesthetics gate from `render/headless.ts` to the real app (via B-01's
`marxyGate.render`) and the mechanical gate failed where the headless page never looked. B-02's
uncommitted work in `../marxy-wt/B-02` reproduces it: `node scripts/gate-aesthetics.mjs --mechanical`.
Fix the app, not the gate; do not loosen any bound; do not touch `fixtures/baselines/` (B-02 regenerates
them once these land). If the fix needs `apps/desktop/src/app.ts` (B-08 owns it this wave), stop and report.

**Paths.** The invisible-character marking (find it: `invisibles`), `packages/typeset/src/` (the
breaker's measurement, if that is the fix), a test that fails today; `changelog.d/B-02.3.md`.

### B-02.4 — Re-grid only from the code fence that changed

**Model:** sonnet · **Size:** S · **Depends on:** B-02.1, B-08 · *Added 2026-10-03 by the lead, from the B-02.1 review.*

**Outcome.** When the code highlighter splits a fence into line spans (B-02.1), the grid pass runs
`from` the first changed block's top-level ancestor instead of over the whole article, and so does
the frontispiece's highlighter (its `startCodeHighlight` call in `app.ts` passes no callback today).
On a fence-heavy 528 KB document B-02.1 adds about 55 whole-article passes while scrolling (each about
100 ms at 1 MB with `buildBlocks`); after this story each is a tail pass.

**Paths.** `apps/desktop/src/render/highlight.ts` (`onLayoutChanged(from?: HTMLElement)`),
`apps/desktop/src/startup/idle-work.ts`, `apps/desktop/src/app.ts` (`snap(doc, from)` and the frontispiece
call only), `apps/desktop/test/code-fence-grid.test.mjs`, a one-line comment in `applyHighlightToCode`
noting that the split flag is set before its first await; `changelog.d/B-02.4.md`.

*Parked 2026-10-03 by the lead on its own measurement:* a whole pass on the fence-heavy document costs
2–3 ms, a pass `from` a block 8–11 ms (`driftedAbove` scans every island above it), and the forced layout
per split (8–12 ms) dominates either way. The premise (~100 ms per whole pass) did not hold.

**Acceptance.** The B-02.1 tests stay green; a test counts whole-article passes while fences split
(none after first text) and fails on B-02.1's whole-article callback; a fence in the frontispiece stays on
the grid; the reviewer measures the scroll on the fence-heavy document before and after.

### B-02.5 — Keep the reader's place when a paragraph above reflows

**Model:** sonnet · **Size:** S–M · **Depends on:** B-02.3 · *Added 2026-10-03 by the lead, from the B-02.3 review.*

**Outcome.** When a paragraph wholly above the viewport changes height after first text (the
typesetter's idle and observer passes, B-02.3's deferred re-set, A-02's chunked adoption), the reading
block does not move on screen. Today nothing compensates: `holdAnchor` holds only a position an open
or re-render set, and a wheel or key event releases it; the app sets `overflow-anchor: none`. The
B-02.3 review measured a 30 px shift when an idle re-set grew a far-above paragraph by one line, and a
120 px jump with many wide markers.

**Paths.** The typesetter's idle/observer paths in `packages/typeset/src/index.ts` (report height deltas
of paragraphs wholly above the viewport), the app's scroll-compensation hook (find where `onPass` is
handled; `app.ts` only if needed and no other story holds it), a WebKit test; `changelog.d/B-02.5.md`.

**Acceptance.** A test scrolls deep into the 1 MB document, grows a paragraph far above (by markers
and by an idle re-set), and asserts the reading block's top stays within 1 px; the same with A-02's
chunk adoption. No compensation while the reader is actively scrolling against it (no fighting the
wheel). Mutation-checked.

### B-02.6 — Settle the inline-matrix paragraph before the gate photographs it

**Model:** sonnet · **Size:** S · **Depends on:** B-02.5 · *Added 2026-10-07 by the lead, from B-02's second
stop. Dispatch only if `06-math` still moves after B-02.5 merges.*

**Outcome.** Two renders of `fixtures/corpus/06-math.md` at 960 px, both variants, first and last screen,
differ by 0 pixels. B-02's stop report saw the paragraph "Matrices: (inline matrix) inline, and a fenced math
block…" land at a different position between runs (0.6–0.8 %), the same family as B-02.2: something sets the
paragraph again after KaTeX, or the gate's `scrollAndSettle` photographs before the last re-set.

**Paths.** The KaTeX inline rules in `packages/theme/src/base.css` or the late re-set in
`packages/typeset/src/index.ts` (whichever the probe blames), and a repeat-render test beside B-02.2's.
`scripts/gate-aesthetics.mjs` only on B-02's branch, with the lead's say-so.

**Acceptance.** Ten consecutive renders of each `06-math` cell, identical (a test that renders twice and
compares, failing on the current code); no threshold raised.

---

### B-02.8 — Take the typesetter's input listeners off the 1 MB critical path

**Model:** opus · **Size:** S–M · **Depends on:** B-02.7 · *Added 2026-10-07 by the lead, from B-02.7's return
(B-02.5's second).*

**Outcome.** 1 MB `content_complete` is back within noise of `fedef091` (main before B-02.5), with the
reader's place still kept. Since B-02.5 it is +18–20 % (~+0.8 s on ~4.4 s); first text is unaffected. The
review's ablation pins it on the window-level capture listeners `attach` registers in
`packages/typeset/src/index.ts` (wheel, touchmove, keydown, mousedown, touchstart, mouseup, touchend,
touchcancel, blur, scroll), not on `keepPlace`'s 2–8 ms of work. Mechanism unknown: find it.

**Build order.** Find why the listeners cost time during idle setting (a non-passive wheel/touch listener,
capture at window, or something the handlers touch). Then make them passive, or register them lazily (on the
first `keepPlace` that finds scrollTop > 0), or both. Fix the PR wording "returns before any read at
scrollTop 0" (`placeAt` reads `scrollTop`).

**Acceptance.** Interleaved pairs, order rotated each round, ≥9 per batch, with an A/A control, against
`fedef091`: the median difference is inside the A/A spread; both numbers are in the PR. All keep-place tests
stay green.

---

### B-02.9 — Colour code the same however busy the machine is

**Model:** sonnet · **Size:** S · *Added 2026-10-07 by the lead, from B-02's third stop.*

**Outcome.** Shiki stops tokenising a line after `tokenizeTimeLimit` (500 ms by default). A fresh worker's first
line can take that long while it compiles its grammar, especially under load, and the rest of the line is then
one token with the grammar state wrong after it (`export function firstAtx(…` gives 5 tokens instead of 22). The
reader sees the same code coloured differently on a busy machine; the gate sees 18, 16 and 19 move between runs.
Tokenising no longer depends on elapsed time; long lines stay plain (`MAX_HIGHLIGHT_LINE_CHARS`) and the work
stays in the worker.

**Paths.** `packages/core/src/highlight/**` and its tests; the worker entry only if the option is set there.

**Acceptance.** A test forces a tiny time budget and still gets the full token count; the worst case under the
line cap is reported and bounded.

---

### B-21 — A slow code line cannot hold every other block's colour

**Model:** sonnet · **Size:** S · **Depends on:** B-02.9 · *Added 2026-10-07 by the lead, from the B-02.9 review.*

**Outcome.** With tokenising no longer cut off by time (B-02.9), one adversarial C-family line (2000 `"` in C++)
holds the single highlight worker for 4–8 s, and every later code block on the page, and in the next document,
waits uncoloured behind it (text shows at once, plain). Make the bound deterministic and local: a per-grammar
line cap (about 300–500 characters for the C family; consider 1000 globally for minified JS), still blanked and
put back as plain text; and drop queued jobs for an article that is gone (a token per article). Never a time
limit.

**Paths.** `packages/core/src/highlight/highlighter.ts` (the cap map) and its tests; `apps/desktop/src/render/highlight.ts`
and the worker entry (job tokens).

**Acceptance.** The worst measured line under each cap is recorded in a comment and the PR; a test shows a job for a
closed article is not run; colours stay identical for lines under the caps (goldens unchanged).

---

### B-22 — No sub-pixel drift off the grid at any text size

**Model:** opus · **Size:** S–M · *Added 2026-10-07 by the lead, from B-02's fourth stop.*

**Outcome.** At body sizes 16 and 28 WebKit lays many paragraphs out 1/64 px taller than a whole number of grid
units. `grid.ts` corrects a block only past 0.5 px and only among the article's direct children, so drift builds
to just under 0.5 px between corrections and list items inside it end 0.52–0.53 px off (`32-long-reference`,
960 px). The reader sees text off the baseline grid; B-02's gate (which checks every block) fails. Fix the
growth at its source if it is a line-box computation, or make the grid pass leave no block more than a small
epsilon off, at the same cost.

**Acceptance.** Every block, list items included, within the gate's tolerance at sizes 16, 20 and 28 on the
affected fixture; size 20 byte-identical; the 1 MB grid pass within noise.

---

### B-03 — Make `--marxy-room` relative to the column's container

**Model:** sonnet · **Size:** S · **Depends on:** — · **Parallel with:** B-01, B-04, B-05

**Outcome.** Wide code blocks and tables run into the margin of the box the article sits in, not
the window. With one document on screen nothing changes. In a half-width container, a
140-character code line stays inside its half instead of spilling 343 px into the neighbour. This
is the split view's one theme prerequisite.

**Why now.** `07-feature-split-view.md` §5 ("Two real problems", item 1): `--marxy-room` is
`max(0px, (100vw - var(--marxy-column)) / 2 - var(--marxy-gutter))` at
`packages/theme/src/base.css:100`, used at `:293` (code) and `:347` (tables). The gutter step is a
viewport media query at `:125`.

**Paths.**
- `packages/theme/src/base.css`
- `packages/theme/test/room.test.mjs` (new, Node-only)
- `scripts/gate-aesthetics.mjs` (one new crafted check; B-02 runs after this story and keeps it)

**Build order.**
1. `base.css`: give the article's containing block inline-size containment:
   `#marxy-main { container-type: inline-size; }`. Phase D adds `.marxy-pane` to that selector.
2. `base.css:100`: replace `100vw` with `100cqi`. Where no container exists (a theme test page,
   `app.html`), `cqi` falls back to the small viewport unit, so those pages behave as today.
3. `base.css:125`: keep `@media (min-width: 30em) { .marxy-article { --marxy-gutter: 24px; } }`
   for pages with no container, and add after it
   `@container (max-width: 30em) { .marxy-article { --marxy-gutter: 16px; } }`, so a narrow
   container wins over a wide window.
4. `test/room.test.mjs` (Node, reads the CSS text): `--marxy-room` contains `100cqi` and not
   `100vw`; `#marxy-main` declares `container-type: inline-size`; the `@container` rule exists.
5. `gate-aesthetics.mjs`: a crafted check `checkRoomInNarrowContainer` in the `selftest()`
   family. It is a page with `#marxy-main` at 735 px inside a 1,470 px viewport and a 140-character
   fenced code line, and it asserts the `pre`'s right edge ≤ `#marxy-main`'s right edge. Run it in
   the normal pass, not only under `--selftest`. Prove it can fail: with `100vw` restored it
   reports the spill (state the measured spill in the PR).

**Acceptance.**
- In a 735 px container in a 1,470 px window, a 140-character code block ends inside the
  container: `checkRoomInNarrowContainer` in `pnpm gate:aesthetics`.
- The CSS uses container units and keeps a no-container fallback: `packages/theme/test/room.test.mjs`.
- No macOS baseline changes: `pnpm gate:aesthetics` passes without `--update`.

**Tests.** `pnpm --filter @marxy/theme test`, `packages/theme/test/media-queries.test.mjs`,
`pnpm gate:aesthetics`, `pnpm check:tokens` (via `pnpm test`), `pnpm precheck`.

**Do not.** Change any token value or name (`tokens.css`, `tokens.contract.json`). Touch
`apps/desktop/index.html` (B-13 owns the skeleton later). Add `.marxy-pane`.

**Risks and open questions.** On Linux, `100vw` includes a classic scrollbar and `100cqi` does
not, so the room shrinks by half a scrollbar width (about 7 px), and Linux screenshots of wide code
blocks may move by that much. B-02 regenerates Linux baselines afterwards anyway; say in the PR
whether CI's Linux run moved. Container query units on the WebKitGTK floor are unverified (`07`
§5): note the WebKitGTK version CI's image runs.

---

### B-04 — Build the document store as a module with its own tests

**Model:** opus · **Size:** M · **Depends on:** Phase A precondition 2 · **Parallel with:** B-01, B-03, B-05

**Outcome.** A new module, `apps/desktop/src/document/store.ts`, owns one open document as
ADR-0037 (amended) describes. Every change is a named transition, history follows the buffer
rather than a hash, a failed effect leaves the store untouched, and `dirty` is derived. Node
tests cover it fully. Nothing uses it yet; B-11 wires it in.

**Why now.** `12` step 2, ADR-0037 §Decision. Building it as a pure module first lets it run
beside the first `app.ts` stories and gives B-11 a tested foundation.

**Paths.**
- `apps/desktop/src/document/store.ts` (new)
- `apps/desktop/src/document/store.test.ts` (new)
- `apps/desktop/package.json`: the `test` script glob only

**Build order.**
1. Types in `store.ts`:
   ```ts
   export interface StoreIo {
     writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>;
     /** Tauri's stale-write guard (shell/tauri.ts recordRead); optional in tests. */
     recordRead?(path: string, bytes: Uint8Array): void;
   }
   export interface DocumentSnapshot {
     readonly path: string;
     readonly disk: Uint8Array | null;   // last read or written; null for an untitled buffer
     readonly buffer: Buffer;            // @marxy/core
     readonly ast: Document;
     readonly nodeMap: NodeMap;          // ../render/post.ts buildNodeMap (DOM-free)
     readonly version: number;           // +1 on every committed transition
     readonly dirty: boolean;            // derived: disk === null || bytes differ
     readonly canUndo: boolean;
     readonly canRedo: boolean;
   }
   export type Transition =
     | { kind: 'open' } | { kind: 'reload' } | { kind: 'apply'; edit: Edit }
     | { kind: 'commitSource'; edit: Edit } | { kind: 'undo'; edit: Edit } | { kind: 'redo'; edit: Edit }
     | { kind: 'save'; path: string } | { kind: 'rename'; from: string; to: string } | { kind: 'close' };
   export interface DocumentStore {
     snapshot(): DocumentSnapshot;
     subscribe(cb: (snap: DocumentSnapshot, change: Transition) => void): () => void;
     apply(input: { range: Edit['range']; replacement: string; label: string }): Promise<boolean>;
     commitSource(docText: string): Promise<boolean>;
     undo(): Promise<boolean>;
     redo(): Promise<boolean>;
     /** New bytes from disk. 'kept' when the buffer has unsaved edits (nothing changes). */
     reload(bytes: Uint8Array): Promise<'reloaded' | 'unchanged' | 'kept'>;
     save(opts?: { to?: string }): Promise<{ result: 'saved' | 'unchanged' | 'failed'; error?: unknown }>;
     rename(to: string): Promise<void>;
     close(): void;
     /** One queue per store: transitions never interleave (ADR-0037 §2). */
     serially<T>(fn: () => Promise<T>): Promise<T>;
   }
   export function openDocumentStore(io: StoreIo, path: string, bytes: Uint8Array): DocumentStore;
   ```
   ADR-0037's seven transitions map like this: `open` is `openDocumentStore`; `reload`, `apply`,
   `commitSource`, `save` and `close` are as listed. `switchMode` moved to the view by the
   amendment. `undo`, `redo` and `rename` are the paths that exist today (`edits.ts:stepHistory`,
   `app.ts:retargetOpenDocument`). If the ADR as accepted in Phase A names them differently,
   follow the ADR and say so.
2. Implement with `History`, `splice`, `createBuffer`, `contentHash` and `parseMarkdown` from
   `@marxy/core`, `buildNodeMap` from `../render/post.ts`, and `leaveSourceMode` from
   `../source/buffer-commit.ts` (it pushes exactly one `edit in Source` entry). Every public
   mutator runs inside `serially`. Each one computes the next buffer, parses it, and only then
   assigns state, bumps `version` and notifies subscribers. A subscriber that throws is caught,
   logged with `console.warn`, and does not undo the commit.
3. `save`: write `buffer.bytes` (to `opts.to` or `path`) through `io.writeFileAtomic`. On success,
   set `disk`, call `io.recordRead?.(path, bytes)`, and if the path changed, apply `rename`. On
   failure, change nothing and return `{ result: 'failed', error }`. A save never touches history.
   If the buffer changed during the write (another transition queued behind it), `disk` becomes
   the bytes written and `dirty` stays true. That matches today's `documentUnchanged` handling in
   `save.ts:113-128`.
4. `reload`: if bytes equal the buffer, set `disk` and return `'unchanged'`. If dirty, return
   `'kept'` with nothing changed. Otherwise set `buffer` and `disk`, **clear** history (ADR-0037
   §3's mapping is out of scope; see "What this phase deliberately leaves out"), and return
   `'reloaded'`.
5. `apps/desktop/package.json` `test`: add `'src/document/*.test.ts'` to the first `node --test` glob.
6. `store.test.ts` (Node, `--experimental-strip-types`), with a recording fake `StoreIo`:
   - apply → `version` +1, one history entry, `dirty`, no `writeFileAtomic` call (ADR-0037 defect 3);
   - commitSource with unchanged text → `false`, nothing changes;
   - commitSource with a change → exactly one entry labelled `edit in Source`;
   - **ADR-0037 defect 2 sequence**: toggle `- [ ]` to `- [x]` via `apply`, `commitSource` with a
     word typed, `undo`, `undo` → buffer bytes equal the original;
   - **ADR-0037 defect 1**: apply, then `save` with a writer that throws → result `failed`,
     snapshot deep-equal to before the save; then apply again, `undo` twice → bytes equal the
     original, and the bytes after the table on `fixtures/corpus/03-ai-plan.md` are untouched;
   - save success → `dirty` false, `disk` equals the written bytes, history kept (undo still works);
   - a transition queued during a slow save → after both, `dirty` true and `disk` equals the first
     bytes;
   - reload clean → `'reloaded'`, history cleared; reload dirty → `'kept'`, nothing changed;
   - rename → `path` changes, history and `dirty` kept;
   - CRLF and BOM bytes survive apply + undo byte-for-byte (`fixtures/corpus/12-crlf-and-bom.md`);
   - two `apply` calls started without awaiting land in order on top of each other.

**Acceptance.**
- Each bullet of step 6 is a named test in `apps/desktop/src/document/store.test.ts` and passes
  under `pnpm --filter @marxy/desktop test`.
- `store.ts` imports nothing from `app.ts`, `selection/`, `commands/` or the DOM: a test in
  `store.test.ts` reads its import specifiers (`scripts/lib/imports.mjs` `importSpecs`) and checks
  them against an allowed list.
- `store.ts` has no module-level `let`: the same test, by regex on `^let `.

**Tests.** New: `store.test.ts`. Keep green: `pnpm --filter @marxy/desktop test`,
`pnpm typecheck`, `pnpm precheck`.

**Do not.** Wire the store into the app. Put `mode`, `anchor`, blocks, HTML or any DOM in it. Add
a re-render or trust policy to it: rendering is the view's job. Add a contract file.

**Risks and open questions.** `leaveSourceMode` imports `foldText` from core: confirm it is
DOM-free (it is used in Node tests today). If `buildNodeMap` cannot be imported in Node because of
`post.ts`'s DOM functions, move `buildNodeMap`, `nodeFor` and `NodeMap` into
`render/node-map.ts` with `post.ts` re-exporting them. That file is outside the paths, so report
and ask before doing it.

---

### B-05 — Delete the dead and unreachable code

**Model:** sonnet · **Size:** M · **Depends on:** Phase A precondition 3 · **Parallel with:** B-01, B-03, B-04

**Outcome.** About 1,200 lines that no reader can reach are gone: the legacy palette model and its
hand-written headless DOM, the unused Source barrel and toggle module, core's directory-snapshot
diff, six unused exports, two stale deferral rows with their markers, a duplicate dialog plugin
registration, and (unless Phase A wired it) the uncompiled 573-line Rust indexer. Nothing visible
changes.

**Why now.** `01-codebase-audit.md` §3.2 and §3.3, `12` step 4. Each deletion is local and
disjoint from the `app.ts` chain.

**Paths.**
- `apps/desktop/src/palette/palette.ts` (delete), `palette/index.ts` (delete),
  `palette/palette.test.ts` (delete), `palette/view.test.ts` (delete), `palette/view.ts` (lines 531–760 only),
  `palette/history.ts` (`notePaletteOpen` only)
- `apps/desktop/src/source/mode-toggle.ts` (delete), `source/index.ts` (delete),
  `source/harness-entry.ts`, `source/mode-switch.test.mjs`, `source/tab-width.ts` (`setTabWidthResolver` only)
- `apps/desktop/src/selection/bind.ts` (`setSelectionRuntime` and `runtime` only),
  `selection/selection.ts` (`sectionSelection` only)
- `packages/core/src/position/snapshot.ts` (delete), `position/index.ts` (its two export lines),
  `position/watch.test.ts` (its `diffSnapshots` cases)
- `scripts/allowlists/deferrals.json`; `apps/desktop/src/startup/idle-work.ts` (the comment at
  `:127` only); `packages/core/src/position/reload.ts` (the comment at `:23` only)
- `apps/desktop/src-tauri/src/main.rs` (the second `tauri_plugin_dialog::init()` and the comment
  at `:526-527`); `apps/desktop/src-tauri/src/index/mod.rs` (delete, conditional)
- `docs/design/07-index-and-palette.md` (only if it describes the Rust module as the indexer)

**Build order.**
1. Palette legacy: delete `palette/palette.ts`, `palette/index.ts`, `palette.test.ts`,
   `view.test.ts`, and `palette/view.ts` from `export interface PaletteViewState` (`:532`) to the
   end, including `LEGACY_TAB_BAR_SELECTOR`, `hasTabBar`, `createPaletteDocument`, `mountPalette`
   and `createHeadlessPaletteDocument`. **Keep** `documentHasTabBar`, `applyTabBarMutation` and
   `TAB_BAR_DOM_MUTATION` (`:26-28`, `:131-147`): `test/palette.test.mjs:143` uses them, and B-16
   moves them. Also delete `paletteKeystrokeP95` (`:321`) and `notePaletteOpen`
   (`palette/history.ts:222`).
2. Source: move `modeRoundTripWithoutEdits` and `byteOffsetRoundTrip` from `mode-toggle.ts` into
   `source/harness-entry.ts`, which is test-only and served by `harness-shell.html`. Point
   `mode-switch.test.mjs:7` at it, or inline the two functions in the test if importing the
   harness entry pulls in the DOM. Delete `mode-toggle.ts`, which takes `enteringSourceDoc` with
   it, and `source/index.ts`. Delete `setTabWidthResolver` (`tab-width.ts:13`).
3. Selection: delete `setSelectionRuntime` and the unused `runtime` variable (`bind.ts:11-16`), and
   `sectionSelection` (`selection.ts:102`).
4. Core: delete `position/snapshot.ts`, its two export lines in `position/index.ts:9-10`, and the
   `diffSnapshots` cases in `watch.test.ts` (keep every other case in that file).
5. Deferrals: delete both rows of `scripts/allowlists/deferrals.json` and the two marker comments
   they name (`idle-work.ts:127` "Placeholder until MARXY-34/MARXY-38", `reload.ts:23` "Typesetting
   is a later story"). Reword each comment to say what the code does now, or remove it. If Phase A
   already removed `idle-work.ts`'s marker, delete only its row.
6. Rust: remove the second `.plugin(tauri_plugin_dialog::init())` (`main.rs:794` and `:803`; keep
   the one that runs on every platform, and if both are inside `cfg` branches keep exactly one per
   platform). Then:
   - **If Phase A kept the TypeScript walker** (the expected case, per `06` and `12` step 1): delete
     `src-tauri/src/index/mod.rs` and fix the comment at `main.rs:526-527` that names it.
   - **If Phase A wired the Rust module** (`mod index;` exists in `main.rs`): leave it, and say so
     in the PR.
7. `git grep` each deleted name over `apps packages scripts`: no hits outside `docs/research` and
   `docs/plan`.

**Acceptance.**
- Each deleted file is absent and nothing imports it: `pnpm typecheck` and `pnpm test` pass.
- `pnpm check:deferrals` passes with an empty `deferrals.json` array.
- `cargo check --locked` and `cargo clippy --locked -- -D warnings` pass. Only one
  `tauri_plugin_dialog::init()` registration remains per platform, which the PR shows with a grep.
- The six named exports have no definition: a `git grep -w` line per name in the PR.
- The Source round-trip harness still works: `apps/desktop/src/source/source-browser.test.mjs`
  and `mode-switch.test.mjs` pass.

**Tests.** `pnpm test`, `pnpm --filter @marxy/desktop test`, `test/palette.test.mjs`,
`source-browser.test.mjs`, `cargo test --locked` in `src-tauri`, `pnpm precheck`.

**Do not.** Touch `app.ts`. Delete the tab-bar mutation hook (B-16). Remove `Selection` kinds
`section` or `document` from the type (`01` §3.2 says keep `document`). Delete
`core/position/blocks.ts`, `storage.ts`, `persistence.ts` or anything the barrel still exports
for live code. Edit `scripts/allowlists/dependencies.json` (a separate clean-up).

**Risks and open questions.** `source/harness-entry.ts` imports `mode-toggle.ts` for
`source-browser.test.mjs`'s `roundTrip`. Moving the function keeps that test's meaning: confirm
by running it. If `cargo` reports the Rust index's crates (`ignore`, `nucleo-matcher`) as
unused after deletion, they were never in `Cargo.toml` (`01` §4). Nothing to remove.

---

### B-05.1 — Retire the Rust walker

**Model:** sonnet · **Size:** S · **Depends on:** B-05 · **Parallel with:** anything outside these paths
*Added 2026-10-02 by the lead, from the B-05 review.* B-05 kept `apps/desktop/src-tauri/src/index/mod.rs`
because three core tests still read or compile it; the TypeScript walker (A-04, A-05) is the indexer.

**Paths.**
- `apps/desktop/src-tauri/src/index/mod.rs` (delete)
- `packages/core/src/index-model/walker.test.ts` (delete: it compiles the Rust walker with rustc)
- `packages/core/src/index-model/ceiling.test.ts` and `schedule.test.ts`: point them at the TypeScript
  constants (`ENTRIES_PER_ROOT`, `INDEX_SCHEDULE`) instead of source text in the Rust file
- `apps/desktop/src-tauri/src/commands/fs.rs` (the comments at `:13` and `:145`, and a `#[cfg(unix)]` test that
  `read_dir` omits symlinks pointing out of the directory: the only live guard against the walk
  leaving the root; *added by the lead from the B-05.1 review*),
  `apps/desktop/src-tauri/src/main.rs` (the comment naming `index/mod.rs` only)
- `docs/design/07-index-and-palette.md` (§Rust walker, §Headings scanner (Rust), and the
  `indexBuild`/`indexQuery` description)
- `changelog.d/B-05.1.md` (new)

**Acceptance.**
- `git grep -n "index/mod.rs\|walk_root"` prints nothing outside `docs/research`, `docs/plan`,
  `CHANGELOG.md` and `changelog.d`.
- `ceiling.test.ts` and `schedule.test.ts` fail if the TypeScript constant they guard changes.
- `cargo test --locked`, `cargo clippy --locked -- -D warnings` and `pnpm precheck` green.

**Do not.** Change the TypeScript walker or the index service.

### B-06 — Unfreeze the contracts

**Model:** sonnet · **Size:** S · **Depends on:** ADR-0045 recorded (Phase A) · **Parallel with:** B-09

**Outcome.** Changing a file under `packages/*/src/contracts/`, `packages/shell-api/src/index.ts`
or `tokens.css` is an ordinary pull request. The hash pin is gone from `pnpm test`, the
"FROZEN" banners say "reviewed contract", and AGENTS.md says contracts change by PR with goldens
regenerated. The invariants stay as tests.

**Why now.** `10-overfit-decisions.md` §3.2, `12` step 6. B-18 and B-19 change `shell-api` and
package boundaries, and must not each need an ADR plus a hash update.

**Paths.**
- `package.json` (root: `test` and `test:contracts-frozen` only)
- `AGENTS.md` (the "Contracts are frozen" bullet)
- `docs/ci-contract.md` (its `contracts-frozen` row)
- `scripts/check-story.mjs` (`:38`), `scripts/lib/repo.mjs` (`isFrozen`), `scripts/registry.json` (the `frozen` list)
- the banner comments in `packages/core/src/contracts/{ast,index-entry,operation,position}.ts`,
  `packages/shell-api/src/index.ts:2`, `packages/theme/src/tokens.css:1`
- `packages/core/src/contracts/contracts.test.ts` (the test name only)

**Build order.**
1. Root `package.json`: delete the `test:contracts-frozen` script, and its `pnpm run test:contracts-frozen && `
   prefix in `test`.
2. `check-story.mjs:38`: delete the frozen-file rule. Delete `isFrozen` from `scripts/lib/repo.mjs`
   if nothing else imports it. Delete `frozen` from `scripts/registry.json` and fix
   `check-registry` or its tests if they read it. If Phase A already took `check-story` out of CI
   entirely, still delete the rule so a local run agrees.
3. Banners: replace "FROZEN (ADR-nnnn). Changing anything here needs an ADR." with "Reviewed
   contract (ADR-nnnn, ADR-0045): changes by pull request; invariants are tested in …", naming
   the invariant test (`parse/invariants.ts`, the golden gate, `gate:fidelity`).
4. AGENTS.md: rewrite the "Contracts are frozen" bullet as "Contracts change by pull request
   (ADR-0045). A meaning change (a new node kind, a new selection granularity) still gets an ADR;
   adding a field does not. Goldens are regenerated in the same PR." Keep the token sentence
   about values being taste.
5. `docs/ci-contract.md`: remove the `contracts-frozen` row, or mark it removed with the ADR.
6. `contracts.test.ts`: rename "contracts are frozen constants" to "contract constants". The
   assertions stay.

**Acceptance.**
- `pnpm test` runs no hash comparison: `git grep -n "contracts-frozen" -- . ':!docs/research'
  ':!docs/plan'` prints nothing.
- A one-line comment change to `packages/core/src/contracts/position.ts` in a scratch branch
  passes `pnpm test` and `node scripts/check-story.mjs` (state the command and result in the PR;
  do not commit the scratch change).
- `pnpm check:registry` and `scripts/check-story.test.mjs` pass.

**Tests.** `pnpm test`, `node --test scripts/check-story.test.mjs scripts/check-registry.test.mjs`,
`pnpm precheck`.

**Do not.** Change any contract's types or values. Delete `contracts.test.ts`,
`parse/invariants.ts` or any golden. Change `tokens.contract.json` keys.

**Risks and open questions.** Phase A may have rewritten AGENTS.md. Edit the bullet wherever it
now lives; if it is gone, add one line under the module map.

---

### B-07 — Keep the Linux weight offset as one documented constant

**Model:** sonnet · **Size:** S · **Depends on:** ADR-0046 recorded (Phase A) · **Parallel with:** B-02, B-08

**Outcome.** The weight offset no longer pretends to read a WebKitGTK version it never gets.
Linux gets one documented constant (`+100`, as today), macOS and Windows `0`, and the config
override `linux.weight_offset`, which is parsed today and never applied, can be passed in. No
rendering changes on any platform.

**Why now.** `01-codebase-audit.md` §6.3: the table at `apps/desktop/src/theme/offset.ts:17-23`
is never consulted, because `webkitVersion` is unimplemented and `app.ts:1236` passes `null`. The
recommendation is "implement `webkitVersion` or delete the rows". ADR-0046 makes Linux parity a
release criterion that cannot be verified without a Linux desktop, so delete the rows. If the
author rules for implementing instead, see Risks.

**Paths.**
- `apps/desktop/src/theme/offset.ts`
- `apps/desktop/test/offset.test.mjs`
- `docs/design/05-theme.md` (§Weight offset)

**Build order.**
1. `offset.ts`:
   - `weightOffset(platform: Platform, configured: number | null): number` returns `0` off Linux,
     else `configured ?? LINUX_WEIGHT_OFFSET` with `export const LINUX_WEIGHT_OFFSET = 100`.
   - Comment it: unmeasured, chosen in D-A9, to be measured when a Linux desktop exists (ADR-0046).
   - Delete `WebkitVersion` and the version rows.
   - `applyWeightOffset(root, platform, configured: number | null)` keeps its arity, so the call
     at `app.ts:1236` still compiles and keeps today's behaviour with `null`. Rename the parameter
     only.
2. `offset.test.mjs`: replace the version-row cases with: linux null → 100, linux 60 → 60,
   macos → 0, windows → 0, `platformOf` unchanged.
3. `05-theme.md` §Weight offset: one paragraph stating the constant, the override, and that the
   version table was removed with ADR-0046.

**Acceptance.**
- `weightOffset('linux', null) === 100`, `weightOffset('linux', 60) === 60`,
  `weightOffset('macos', 60) === 0`: `apps/desktop/test/offset.test.mjs`.
- No reference to a WebKit version remains in `offset.ts`: `offset.test.mjs` reads the source text.
- `pnpm gate:font-attrs` and `pnpm gate:aesthetics` (macOS) unchanged.

**Tests.** `offset.test.mjs`, `pnpm gate:font-attrs`, `pnpm precheck`.

**Do not.** Touch `app.ts` (B-08 is on it this wave; wiring the config override into boot is
B-15's config step). Remove `webkitVersion` from `shell-api` (B-18 does, citing this story).

**Risks and open questions.** If the author prefers implementing `webkitVersion` (about 15 lines
of Rust plus a Tauri command), this story becomes Rust plus `shell/tauri.ts` and moves to wave 11
beside B-18. Ask the author before starting. Default: delete the rows.

---

### B-08 — Lift start-up measurement out of `app.ts`

**Model:** sonnet · **Size:** M · **Depends on:** B-01 · **Parallel with:** B-02, B-07

**Outcome.** The code that proves `first_text` honestly now lives in
`apps/desktop/src/startup/measure.ts`: the frame counter, render evidence, harness detection, the
paint wait and the finish-with-exit-code. Every mark keeps its name, order and data, and `app.ts`
loses about 90 lines and five of its module variables.

**Why now.** `01-codebase-audit.md` §2.3 (rows 334–386, 584–605, 1232–1297) and §6.6. It is the
smallest seam in the chain, and it shrinks every later diff.

**Paths.**
- `apps/desktop/src/app.ts`
- `apps/desktop/src/startup/measure.ts` (new)
- `apps/desktop/src/shell/marxy33-gate.mjs`
- `apps/desktop/test/paint-signal.test.mjs`
- `apps/desktop/test/app-harness.test.mjs` (only if it pins source text)

**Build order.**
1. `startup/measure.ts` exports:
   - `const t0` (module evaluation time, as `app.ts:165`);
   - `createLaunchMeasure(shell: Pick<Shell,'mark'|'quit'|'startupMarks'>, args: readonly string[])`
     returning `{ framesObserved(): number; stopObserving(): void; renderEvidence(doc): RenderEvidence; inHarness(): Promise<boolean>; waitForFirstText(doc, after, renderedAt): Promise<'painted'|'no_text'|'no_paint'>; finish(code): Promise<void>; ready: Promise<number> }`.
   - The frame counter (`app.ts:342-345`) starts in `createLaunchMeasure`, not at module scope.
     `startApp` calls it first, so the count still covers the whole launch.
2. Move `renderEvidence` (`:352-361`), `inHarness` (`:585-592`), `settleReady`/`finish`
   (`:599-605`) and the body of `boot` from `const framesAtRender` to the `first_text` mark
   (`:1263-1292`) into `waitForFirstText`. Keep the literal source text the pins read:
   `await shell.mark('first_text', paintedAt);`, `waitForEnginePaint`, `signal=${signal}`,
   `frames=${frames}`.
3. `app.ts`: `boot` calls the measure object, and `startApp` resolves `handle.ready` from
   `measure.ready`. Delete `framesObserved`, `observing`, `observeFrame`, `settleReady` and the
   `launchArgs` uses that only `inHarness` needed.
4. `marxy33-gate.mjs` (`:17-23`): look for each required `mark('name'` across `app.ts` +
   `startup/measure.ts` + any `view/` or `document/` file (glob the directory). B-13 and B-15 then
   only have to add nothing. Error text names the files searched.
5. `paint-signal.test.mjs` (`:107-118`): read `startup/measure.ts` instead of `app.ts` for the
   `first_text`, `waitForEnginePaint`, `signal=` and `frames=` pins.

**Acceptance.**
- `app.ts` has no `framesObserved`, `observing`, `settleReady`, `renderEvidence` or `inHarness`:
  `paint-signal.test.mjs` asserts their absence from `app.ts` and presence in `measure.ts`.
- The mark sequence of a launch is identical: `app-harness.test.mjs` (its recorded calls) and
  `apps/desktop/scripts/smoke-cli-open.mjs` via `pnpm --filter @marxy/desktop verify:cli` if a
  release build is available locally (say if not).
- The Vite build's MARXY-33 gate still fails when a required mark is missing: show it by
  temporarily renaming one mark in a scratch run (state the result; do not commit).

**Tests.** The 15 guarding desktop files, `paint-signal.test.mjs`, `frontispiece-boot.test.mjs`
(the `no_document` path), `large-document.test.mjs` (number unchanged within noise),
`pnpm precheck`.

**Do not.** Rename, reorder or drop a mark. Move the measurement into `main.ts`
(`shell-boundary.test.mjs` caps it at 30 lines). Change `paint-signal.mjs`.

**Risks and open questions.** Starting the frame counter inside `startApp` instead of at module
evaluation could drop the frames between script evaluation and `startApp`. Measure
`frames=` before and after in the harness; if it drops below the smoke check's minimum
(`smoke-verdict.mjs` `MIN_FRAMES_AFTER_RENDER`), keep the counter's start at module scope in
`measure.ts` and report.

---

### B-09 — Remove the per-host image grant

**Model:** sonnet · **Size:** M · **Depends on:** B-08, ADR-0044 recorded · **Parallel with:** B-06

**Outcome.** A document with remote images shows one plain notice ("4 images from img.shields.io
and github.com were not loaded.") with Dismiss. The "Load images from these hosts" button, the
per-host checkbox list, the "Images will load when Marxy can fetch them" summary and the "Stop
loading images" command are gone. They promised something nothing delivered. `trust.json`
keeps the HTML opt-in only. This is the phase's one deliberate visible change, and it has a
queue row.

**Why now.** `01-codebase-audit.md` §6.1 (the grant "persists a choice nothing acts on", about
250 lines), `10-overfit-decisions.md` §3.1 and §3.5, `12` step 8. Removing it before B-10 means
the trust controller is lifted without dead code.

**Paths.**
- `apps/desktop/src/app.ts` (`grantImageHostsForOpenDocument`, the image parts of `grantSummary`,
  `revokeTrustImages`, `showTrustNotices`'s `onGrantImages`)
- `apps/desktop/src/trust/trust.ts`, `trust/trust.test.ts`
- `apps/desktop/src/notices/blocked.ts`, `notices/trust-copy.ts`
- `apps/desktop/src/commands/trust.ts`
- `apps/desktop/test/trust.test.mjs`, `test/save-trust-r4.test.mjs`
- `docs/design/13-trust.md`
- `docs/taste-review/queue.d/B-09.md` (new)

**Build order.**
1. `trust/trust.ts`:
   - `DocumentGrants` becomes `{ html: boolean; at: number }`.
   - `parseTrustFile` reads a v1 file with `imageHosts` and ignores the field, so a reader's
     existing file keeps its HTML grants.
   - `serializeTrustFile` never writes `imageHosts`.
   - `grant(path, { html })` and `revoke(path, 'html')` only.
   - Delete `normalizeImageHost`.
   - Keep `TRUST_FILE_VERSION = 1`: an older Marxy reading the new file sees no `imageHosts` and
     treats it as empty.
2. `notices/blocked.ts`:
   - `trustBlockedNotices` no longer takes `onGrantImages`, and offers images nothing: delete
     the host checkbox list in `expandDetails` (`:140`) and the "Load selected hosts" path
     (`:174`).
   - Delete `imageGrantSummaryNotice` (`:203`).
   - `grantSummaryNotice(path, html)` loses `hostCount`.
   - The "both" row of `13-trust.md` §The notice becomes "4 images from 2 hosts were not loaded,
     and some HTML was simplified." with **Show this document's HTML** · Dismiss.
3. `notices/trust-copy.ts`: keep `blockedTrustNoticeText`'s image counting and host naming. Delete
   only what words a grant of hosts.
4. `commands/trust.ts`: delete the "Stop loading images for this document" command and its
   `revokeImages` wiring.
5. `app.ts`:
   - Delete `grantImageHostsForOpenDocument` (`:516-534`), `revokeTrustImages` (`:548`) and the
     `hosts` field and `imageGrantSummaryNotice` call in `grantSummary` / `grantSummaryFinished`
     (`:484-495`).
   - `trustGrantsFor` returns `{ html }`.
   - `wireTrustRevokeCommands` loses `revokeImages`.
6. Tests:
   - `trust.test.ts`: v1 file with hosts → hosts dropped on next write, HTML kept.
   - `test/trust.test.mjs` and `save-trust-r4.test.mjs`: delete the host-grant cases. Add: the
     `02-readme-real-world.md` notice has no "Load images" control, names the hosts, and Dismiss
     hides it.
7. `13-trust.md`: §Persistence drops `imageHosts`, §The notice loses the host actions, §Revoking
   loses the images command, §Fetching becomes "Not built; see ADR-0044 and B-20".
8. `queue.d/B-09.md`: before/after of the README notice (screenshots via `trust.test.mjs`'s page).

**Acceptance.**
- A README with remote images shows a notice naming hosts and counts, with no load action:
  `apps/desktop/test/trust.test.mjs`.
- A `trust.json` written by v0.1.0 with `html: true` and `imageHosts` still shows that document's
  HTML, and the next write drops `imageHosts`: `apps/desktop/src/trust/trust.test.ts` and
  `trust.test.mjs`.
- No palette or registry command mentions images: `trust.test.mjs` lists the commands from
  `handle.commands()`.
- Zero network requests over the corpus: `pnpm gate:no-network`.

**Tests.** `trust.test.ts` (run directly: it is in no glob today, `04` §1.5; add
`'src/trust/*.test.ts'` to `apps/desktop/package.json` only if B-04 has merged and the file is
free, otherwise run it by hand and say so), `trust.test.mjs`, `save-trust-r4.test.mjs`,
`pnpm gate:no-network`, `pnpm gate:aesthetics`, `pnpm precheck`.

**Do not.** Touch the sanitiser (`packages/core/src/sanitize/*`), the deferral of remote images in
`core/render/images.ts`, or the CSP in `tauri.conf.json`. Add a `remote_images` setting (B-20).
Change the HTML opt-in.

**Risks and open questions.** `docs/scope.md` lists "remote images blocked with a visible opt-in".
After this story the opt-in waits on B-20. Say so in the changelog fragment.

---

### B-09.1 — One wording for the blocked-images notice

**Model:** sonnet · **Size:** S · **Depends on:** B-09 · *Added 2026-10-03 by the lead, from the B-09 review.*

**Outcome.** A document with remote images says the same thing whether or not it also has HTML: today
the images-only notice (`blockedImageNoticeText` in `packages/core/src/render/images.ts`) reads "4 remote
images from X and Y were not loaded" (no full stop), while the mixed-document sentence from
`notices/trust-copy.ts` reads "4 images from X and Y were not loaded, and some HTML was simplified (…)."
Route both through one wording. `displayHost` in `trust-copy.ts` is dead since B-09 (only a test calls
it): delete it with its test, unless the new wording uses it for confusable hosts — then use it.
`docs/scope.md` (lines ~11 and ~26) still promises a per-document image opt-in; say images are blocked
and the opt-in waits on B-20 (ADR-0044).

**Paths.** `packages/core/src/render/images.ts` (`blockedImageNoticeText` only), `apps/desktop/src/notices/
trust-copy.ts`, the tests that pin either wording (`test/save-trust-r4.test.mjs`, the 10-hostile and
protocol-relative tests — find them), `docs/scope.md` (those two lines), `changelog.d/B-09.1.md`.

**Acceptance.** One sentence shape for both cases, with a full stop, naming hosts as today (the
hostile-host display rules still hold: a confusable or punycode host is shown in a form the reader can
recognise); goldens unaffected or regenerated with the reason; `pnpm gate:no-network` unchanged.

### B-10 — Lift trust into a controller and merge the two re-render paths

**Model:** opus · **Size:** M · **Depends on:** B-09 · **Parallel with:** —

**Outcome.** Everything about what a document may show (loading `trust.json`, the HTML grant,
revoke, the blocked and truncation notices, the late re-render when `trust.json` arrives after
first text) lives in `apps/desktop/src/trust/controller.ts`, one instance per app. `app.ts` keeps
one re-render function, not two that differ by a line. Behaviour is unchanged.

**Why now.** `01-codebase-audit.md` §2.3 (`app.ts:388-579`, "Trust: grant, revoke, summary
bookkeeping, two re-render paths, notices") and its note that `rerenderOpenDocument`
(`:550-572`) and `rerenderFromBuffer` (`:976-992`) are near-duplicates.

**Paths.**
- `apps/desktop/src/app.ts`
- `apps/desktop/src/trust/controller.ts` (new)
- `apps/desktop/src/commands/trust.ts` (its wiring signature only)
- `apps/desktop/test/trust-controller.test.mjs` (new, optional if covered below)

**Build order.**
1. `trust/controller.ts`: `createTrustController(deps: { shell: Pick<Shell,'readFile'|'writeFileAtomic'|'configPaths'>; currentPath(): string | null; rerender(at: { byteOffset: number; fraction: number }): void; position(): { byteOffset: number; fraction: number } })`
   returns `{ load(): Promise<void>; policyFor(path): SanitizePolicy; showNotices(removed, blockedImages, buffer): void; grantHtml(): Promise<void>; revokeHtml(): Promise<void>; grantsFor(path): { html: boolean }; maybeRerenderForLateTrust(): Promise<void> }`.
   Move `startTrustLoad` (`:399-416`), `trustGrantsFor`, `renderPolicyFor`, `showTrustNotices`
   (`:433-462`, including the truncation notice and `byteOffsetForLine`), `applyTrustChange`,
   `grantSummary`, `grantHtmlForOpenDocument`, `revokeTrust` and `maybeRerenderForLateTrust`
   into it. `trustStore` and `trustLoadPromise` become fields of the instance.
2. `app.ts`:
   - Delete `rerenderOpenDocument` (`:550-572`) and keep one
     `rerenderFromBuffer(doc, at?: ReadingPosition)` that also restores the position when given.
     Today `rerenderOpenDocument` = `rerenderFromBuffer` + `restoreScrollToPosition`.
   - Delete `deferredStartupContext`'s duplicate call sites, so there is one `whenIdle` call per
     render.
   - `startApp` creates the controller; `boot` calls `trust.load()` where it called
     `startTrustLoad`.
3. `commands/trust.ts`: `wireTrustRevokeCommands({ grantsForPath, revokeHtml })` from the controller.
4. Keep the late-trust timing exactly: `setTimeout(() => void trust.load().then(() => trust.maybeRerenderForLateTrust()), 0)`
   after `finishDocumentOpen` (`app.ts:1295`).

**Acceptance.**
- `app.ts` contains no `trustStore`, `trustLoadPromise`, `grantSummary` or `rerenderOpenDocument`:
  `apps/desktop/test/trust-controller.test.mjs` (source-text check), or the same assertion added to
  `trust.test.mjs`.
- Grant, revoke, the late re-render and the "newer trust.json" notice behave as before:
  `test/trust.test.mjs` and `test/save-trust-r4.test.mjs` unchanged and green.
- One render per edit: `test/palette-index.test.mjs` (or the re-walk probe it contains) shows no
  more renders per `commitEdit` than before.

**Tests.** The 15 guarding desktop files, `trust.test.mjs`, `save-trust-r4.test.mjs`,
`pnpm gate:aesthetics`, `pnpm gate:no-network`, `pnpm precheck`.

**Do not.** Change notice text. Change when the late re-render runs (it must stay after
`first_text`; design 13 §Persistence). Introduce the store (B-11).

**Risks and open questions.** The two re-render paths differ in one place: `rerenderOpenDocument`
restores scroll and `rerenderFromBuffer` leaves it to the caller. Check every caller of the
survivor passes a position when the deleted one did.

---

### B-11 — Move undo, the saved baseline and save into the store

**Model:** opus · **Size:** L · **Depends on:** B-04, B-10 · **Parallel with:** —

**Outcome.** The open document is a `DocumentStore` (B-04). Operations, Source commits, undo, redo,
save, rename and reload from disk are store transitions. `commands/edits.ts` holds no state,
`save.ts` has no host, `dirty` is `buffer ≠ disk`, and the three ADR-0037 defects are fixed at
their cause. Readers see no difference, except that undo now works across a Source round trip in
every sequence.

**Why now.** ADR-0037 §Decision 1–5, `12` step 2, "The three ADR-0037 defects" above.

**Paths.**
- `apps/desktop/src/app.ts`
- `apps/desktop/src/commands/edits.ts`, `commands/document.ts`, `commands/registry.ts`
- `apps/desktop/src/save.ts`, `close.ts` (host signature only)
- `apps/desktop/src/render/tasks.ts`
- `apps/desktop/src/selection/bind.ts` (`buildAppContext` adds `document`)
- `apps/desktop/src/document/store.ts` (fixes only)
- `apps/desktop/test/store-undo.test.mjs` (new)
- `apps/desktop/test/tauri-stale-write.test.mjs` (its `app.ts` slice, `:35-42`)

**The state map.** Every module-level variable in `app.ts` today (`grep -nE "^let " app.ts`:
33, at `bc05670f`), plus the module-level `const`s that hold mutable state, and the new owner of
each. B-11 owns the rows marked B-11. B-13, B-14 and B-15 own theirs and read this table. Phase A
may already have removed rows 7 and 19, and B-08 and B-10 removed theirs before this story.

| # | Line | Variable | Today means | New owner | Story |
| --- | --- | --- | --- | --- | --- |
| 1 | 169 | `openPath` | path of the open document | `DocumentStore.snapshot().path` | B-11 |
| 2 | 170 | `documentBuffer` | current bytes | `DocumentStore.snapshot().buffer` | B-11 |
| 3 | 184 | `bytesOnDisk` | bytes last read or written | `DocumentStore.snapshot().disk` | B-11 |
| 4 | 185 | `documentWatch` | the directory watch | one subscription per store, opened by `document/live-reload.ts` | B-14 |
| 5 | 186 | `viewMode` | Rendered or Source | `RenderedView.mode` | B-13 |
| 6 | 187 | `sourceEditor` | mounted CodeMirror | `RenderedView` (its Source editor) | B-13 |
| 7 | 188 | `keysInstalled` | `Mod+E` listener guard | gone: `Mod+E` is a registry command (Phase A); if still here, B-13 deletes it | Phase A / B-13 |
| 8 | 189 | `lastReadingByteOffset` | position carried across a mode switch | `RenderedView` | B-13 |
| 9 | 190 | `lastReadingFraction` | same | `RenderedView` | B-13 |
| 10 | 191 | `modeToggleBusy` | re-entrancy guard on `Mod+E` | `RenderedView` | B-13 |
| 11 | 192 | `positionPersistence` | `positions.json` writer | `ReadingPersistence` instance (`position/reading-persistence.ts`) | B-14 |
| 12 | 193 | `persistenceLoaded` | load-once guard | `ReadingPersistence` | B-14 |
| 13 | 194 | `scrollPersistenceInstalled` | scroll listener guard | `ReadingPersistence.attach(view)` | B-14 |
| 14 | 195 | `restoreAfterTypeset` | restore stored position after first typeset | option `restorePersisted` of the open path | B-15 |
| 15 | 307 | `chain` | the one `serially` queue | `DocumentStore.serially` for transitions; `RenderedView`'s queue for open-in-this-view and mode switches | B-11, B-13 |
| 16 | 342 | `framesObserved` | paint frame counter | `startup/measure.ts` | B-08 |
| 17 | 343 | `observing` | frame counter on/off | `startup/measure.ts` | B-08 |
| 18 | 364 | `launchArgs` | argv | a local of `boot`; `measure.inHarness(args)` | B-08, B-15 |
| 19 | 367 | `deliverIndex` | index hand-off to the palette | gone with Phase A's index owner; else B-15 deletes | Phase A |
| 20 | 386 | `shell` | the injected shell | a parameter closed over in `startApp`, passed explicitly | B-15 |
| 21 | 388 | `trustStore` | loaded `trust.json` | `TrustController` | B-10 |
| 22 | 389 | `trustLoadPromise` | load-once promise | `TrustController` | B-10 |
| 23 | 599 | `settleReady` | resolves `handle.ready` | `startup/measure.ts` `ready` | B-08 |
| 24 | 611 | `typeset` | the `TypesetController` | `RenderedView` | B-13 |
| 25 | 612 | `userThemeHandle` | user-theme watcher | held by the app instance in `startApp`, notifying every view | B-15 |
| 26 | 644 | `anchor` | byte held at the reading line | `RenderedView` | B-13 |
| 27 | 645 | `anchorListening` | input listener guard | `RenderedView` | B-13 |
| 28 | 700 | `lastSnapAt` | grid-pass coalescing | `RenderedView` (Phase A's scheduling) | B-13 |
| 29 | 701 | `snapTimer` | same | `RenderedView` | B-13 |
| 30 | 702 | `snapFrame` | same | `RenderedView` | B-13 |
| 31 | 723 | `resizeObserver` | article width watcher | `RenderedView` | B-13 |
| 32 | 727 | `liveResizeObservers` | `debugCounts` | summed over the app instance's views | B-13 |
| 33 | 1193 | `frontispiecePieces` | test pieces for the no-document launch | an option passed to the open path | B-15 |
| — | 165 | `const t0` | script start | `startup/measure.ts` | B-08 |
| — | 167 | `const state` | `{ document: { ast, html, nodeMap, blocks } }` | `ast`, `nodeMap` → store (B-11); `html`, `blocks` → view (B-13); `AppHandle.state` keeps its shape as a getter | B-11, B-13 |
| — | 171 | `const documentListeners` | `onDocumentChange` subscribers | `DocumentStore.subscribe` behind `AppHandle.onDocumentChange` | B-12 |
| — | 484 | `const grantSummary` | grant announcement counters | `TrustController` (image half deleted) | B-09, B-10 |
| — | 582 | `const scopedAssetRoots` | asset-protocol roots this session | one `Set` per app instance, passed to views | B-13 |
| — | 726 | `const liveTypesetters` | `debugCounts` | the views | B-13 |

The other modules' document state: `selection/view.ts`'s ten `let`s (`ctx`, `state`,
`lastClickTarget`, `pointerDrag`, `installedOn`, `appHandle`, `navHistory`, `navIndex`,
`linkHistoryKeysInstalled`, `pendingFragment`) go to a per-article selection controller in B-12.
`commands/edits.ts`'s `history`, `savedVersion`, `saved`, `historyBase` and `mutationChain` go to
the store **here**. `save.ts`'s `host` is deleted **here**.

**Build order.**
1. `app.ts` `openDocumentThroughRenderMark` (`:1079`): after `readFile`, create
   `openDocumentStore({ writeFileAtomic: shell.writeFileAtomic, recordRead: shell.recordRead }, file, bytes)`
   and hold it in one transitional `let store: DocumentStore | null` (B-15 removes it).
   - Replace every read of `openPath`, `documentBuffer`, `bytesOnDisk` and
     `state.document.ast/nodeMap` with `store.snapshot()`.
   - Keep `state.document` for `html` and `blocks`, with `ast` and `nodeMap` filled from the
     snapshot so `AppHandle.state` keeps its shape.
   - Delete `openPath`, `documentBuffer` and `bytesOnDisk`.
   - B-10's `TrustController` takes `buffer()` and `showSource(byteOffset)` as deps (the lead
     accepted that signature, 2026-10-07): point `buffer()` at `store.snapshot().buffer`.
2. Re-render on change: subscribe the page to the store. On `apply`, `undo`, `redo`,
   `commitSource` and `reload`, run `rerenderFromBuffer(doc, position)`. This replaces
   `commitEdit`'s body (`:908-921`) and the re-render callbacks in `leaveSourceForRendered` and
   `foldSourceIntoBuffer`.
3. `commands/registry.ts` `AppContext`: add `readonly document: DocumentStore | null`.
   `selection/bind.ts` `buildAppContext()` fills it from the app (pass a getter in through
   `installCommandKeys` or through the selection runtime). `applyBufferMutation` becomes
   `(input) => ctx.document!.apply(input)`.
4. `commands/edits.ts`: delete `history`, `savedVersion`, `saved`, `historyBase`, `rebaseline`,
   `ensureBaseline`, `historyFor`, `builtOn`, `markDocumentSaved`, `renameDocumentPath`,
   `syncSavedVersionFromOpenBuffer`, `syncSavedVersionOnce`, `mutationChain` and `inTurn`.
   - `documentIsDirty(buffer)` → `snapshot.dirty`.
   - `undoDocumentEdit` / `redoDocumentEdit` → `store.undo()` / `store.redo()`.
   - A refused change still notifies "Could not … The document is unchanged."
     (`reportFailedChange`).
   - `historyCanUndo` / `historyCanRedo` read `snapshot.canUndo` / `canRedo`.
   - Keep `harnessAlignFirstTable` and `documentEditState` for now (B-16 moves them). Read the
     `__marxyOrigBytes` override only where `documentEditState` and `documentIsDirty` are used by
     tests. Leave the override in place and note it for B-16.
5. `save.ts`: `export async function save(deps: { store: DocumentStore; shell: Pick<Shell,'saveDialog'|'setTitle'|'allowAssetScope'>; foldSource(): Promise<void>; onSaveAs(path): Promise<void> }, opts?: { as?: boolean })`.
   Delete `installSave` and `host`. The read-only `marxy:` check and the failed-save notice
   (`showSaveFailedNotice`) stay. `commands/document.ts` Save and Save-as call it with
   `ctx.document`.
6. `close.ts`: `isDirty` is `store.snapshot().dirty || view has unfolded Source edits`. The host
   object stays; only what `app.ts` passes changes.
7. Source: `leaveSourceForRendered` and `foldSourceIntoBuffer` call `store.commitSource(editor.docText())`.
   `foldSourceEditIfNeeded` is deleted.
8. Reload: `reloadOpenFromDisk` and `handleDocumentWatch`'s same-bytes branch call
   `store.reload(bytes)`. `'kept'` shows `diskChangedEditsKeptNotice`, as `hasLocalEdits` did.
   `retargetOpenDocument` calls `store.rename(newPath)`. Keep `shell.recordRead` on adoption: the
   store does it (B-04 step 3). Update `tauri-stale-write.test.mjs:35-42` to read the function
   that now holds `peekFile` and to assert `recordRead` is called by the store on reload.
9. `render/tasks.ts`: delete `rerenderOpenDocument(buffer)`. The task click applies through
   `attachDocumentEdits(base)` → `store.apply`.
10. `AppHandle.commitEdit(buffer)` (tests use it): implement as a `store.apply` of the single range
    by which `buffer` differs from the current one (`foldText`-style diff from `@marxy/core`),
    labelled `edit`. Keep its "refused if a different document is open" error.
11. `test/store-undo.test.mjs` (new, Playwright WebKit over `test/palette-boot.html`, shaped like
    `data-loss.test.mjs`):
    - **ADR-0037 defect 2 sequence**: click the first task box, `Mod+E`, type `X` at the top,
      `Mod+E`, `Mod+Z`, `Mod+Z`, then assert the buffer equals the original bytes.
    - **Rename keeps history**: emit a rename watch event with unsaved edits, `Mod+Z`, assert the
      edit is undone.
    - **Clean reload clears history** and `Mod+Z` does nothing.

**Acceptance.**
- `commands/edits.ts` and `save.ts` have no module-level `let` and no `History` instance: a
  source-text case in `test/store-undo.test.mjs` (Node half).
- ADR-0037 defect 1: `data-loss.test.mjs:163` green, plus `store.test.ts`'s failed-save case.
- ADR-0037 defect 2: `test/store-undo.test.mjs` "toggle, Source edit, two undos restore the
  original" green.
- ADR-0037 defect 3: `explicit-save.test.mjs:128` and `data-loss.test.mjs` "an operation alone
  does not write the file" green; `store.test.ts`'s no-writer case.
- Every existing desktop test passes with no edit except the named source-pin tests:
  `MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test`.
- First text at 1 MB within 10 % of before: `large-document.test.mjs`, both numbers in the PR.

**Tests.** All of `apps/desktop/test` with WebKit required, `store.test.ts`, `pnpm gate:fidelity`,
`pnpm gate:aesthetics`, `pnpm precheck`.

**Do not.** Move rendering, typesetting, the anchor or the mode into the store. Change
`AppHandle`'s member names. Map history through a reload (out of scope). Write the file on
`apply`. Change notice texts.

**Risks and open questions.**
- **Render failure.** Today, if the re-render after an operation throws, history is not pushed and
  the reader is told "the document is unchanged". With the store, the transition has committed
  before the view renders. The recommended semantics: the store keeps the change and the view
  shows the error in place of the page. If any test asserts the old behaviour, report it before
  choosing.
- **The harness baseline.** `__marxyOrigBytes` (set by `data-loss.test.mjs:65` and others) overrides
  dirty state. If tests now disagree with `snapshot.dirty`, the store is right. Report which tests
  rely on the override rather than editing them here; B-16 removes it.

---

### B-11.1 — Save as survives a document change; tighten B-11's checks

**Model:** sonnet · **Size:** S · **Depends on:** B-11 · *Added 2026-10-07 by the lead, from the B-11 review.*

**Outcome.** (1) If another document opens while the Save-as dialog is up, `store.save` rejects on the closed
store; `save.ts` catches the refused transition and returns `'cancelled'` instead of an unhandled rejection.
(2) `data-loss.test.mjs`'s defect-1 case asserts `afterUndos === orig` and `canUndo === false`, so a phantom
history entry fails it. (3) `store-undo.test.mjs`'s source-text case matches `/^(export\s+)?(let|var)\s/m`.
(4) Optional: `handleDocumentWatch`'s unfolded-Source branch applies the store's own-save echo rule (today a
false "edits kept" notice on save → edit → Source → type before the echo; never a loss).

**Paths.** `apps/desktop/src/save.ts`, `apps/desktop/test/data-loss.test.mjs`, `apps/desktop/test/store-undo.test.mjs`,
and for (4) only the watcher branch in `app.ts` (lead's say-so; B-12 owns `app.ts` otherwise).

**Acceptance.** A test opens a second document while Save-as is pending and asserts `'cancelled'` with no
unhandled rejection; each tightened check fails on a mutation that today survives (the review's M3 and the
phantom-entry mutation).

---

### B-12 — Make selection and commands read the store

**Model:** opus · **Size:** M · **Depends on:** B-11 · **Parallel with:** —

**Outcome.** The selection, link following, the task checkbox and every command read the open
document from the store through one per-article selection controller. Nothing keeps a copy that
can go stale. `selection/view.ts` has no module state, and `onDocumentChange` is the store's
subscription seen through `AppHandle`. No behaviour changes.

**Why now.** ADR-0037 Consequences ("`selection/view.ts`, `commands/edits.ts` and `render/tasks.ts`
lose their document state"), `07` §2.2 row 2, and the seven-module import cycle of
`01-codebase-audit.md` §2.4 ([C6]), which this breaks.

**Paths.**
- `apps/desktop/src/selection/view.ts`, `selection/bind.ts`, `selection/harness-entry.ts`
- `apps/desktop/src/commands/document.ts`, `commands/source-view.ts`, `commands/selection-nav.ts`, `commands/index.ts`
- `apps/desktop/src/render/tasks.ts`
- `apps/desktop/src/palette/view.ts` (`mountPaletteFromHandle` only)
- `apps/desktop/src/app.ts`
- `apps/desktop/test/import-cycles.test.mjs` (new)

**Build order.**
1. `selection/view.ts`: replace the ten module `let`s with
   `createRenderedSelection(opts: { article: HTMLElement; scroller: HTMLElement; store(): DocumentStore | null; shell: SelectionShell; open(path: string): Promise<void>; currentPath(): string | null })`
   returning `{ state(): SelectionState; runtime(): SelectionRuntime | null; clear(); moveDown(); moveUp(); moveParent(); afterRender(); destroy() }`.
   - The click, mouse and link handlers (`onClick`, `followLink`, `onPointerUp`) move inside it.
   - `navHistory`/`navIndex` and `pendingFragment` become fields.
   - If Phase A left the link-back listener here, it becomes the registry's back command reading
     the controller.
2. `app.ts` `startApp` creates the controller once `#doc` exists (it is in the skeleton) and
   exposes it as `AppHandle.selection` (a new, additive member).
   `installRenderedSelection(handle)` stays exported, as an idempotent wrapper that returns
   `handle.selection` (the harness entries and `palette/view.ts:507` call it).
3. `selection/bind.ts`: `buildAppContext(handle)` builds from `handle.selection.runtime()` and
   `handle.document()`; `installCommandKeys(handle)`.
4. Commands: replace every `getSelectionBufferContext()` with the `AppContext` they are given
   (`ctx.document`, `ctx.selection`), in `commands/document.ts`, `source-view.ts`,
   `selection-nav.ts` and `render/tasks.ts`. `startDocumentEditingWire`'s `MutationObserver` uses
   `handle.selection` too.
5. `AppHandle.onDocumentChange(cb)` subscribes to the current store and re-subscribes on open.
   `openDocument()` builds `OpenDocumentState` from the snapshot. Delete `announceDocument` and
   `documentListeners`.
6. `test/import-cycles.test.mjs`: a Node test that runs a strongly-connected-components pass over
   the static value imports reachable from `apps/desktop/src/main.ts`. Use `scripts/lib/imports.mjs`;
   the audit's `cycles.mjs` ([C6]) is the model. Assert there are no cycles.

**Acceptance.**
- `selection/view.ts` has no module-level `let`: `test/import-cycles.test.mjs` (source-text case).
- No static import cycle from `main.ts`: `test/import-cycles.test.mjs`.
- Selection, links, back navigation, jump-to-source and task clicks behave as before:
  `selection.test.mjs`, `links.test.mjs`, `jump-to-source.test.mjs`, `operations-edit.test.mjs`
  and `data-loss.test.mjs` green.
- A selection made in one document does not survive opening another: `selection.test.mjs`
  (existing case, or add one).

**Tests.** All of `apps/desktop/test` with WebKit required, `pnpm precheck`.

**Do not.** Add span selection (Phase E). Move notices. Change which keys do what.

**From the B-11 review (2026-10-07).** After a re-render throws, the selection context keeps the old buffer
and node map, and `applyDocumentMutation` sends no `baseVersion`; an operation from a selection held across the
failure would splice at stale offsets. When selection starts reading the store here, pass `baseVersion` on every
`apply` (the store already refuses a stale one, `store.test.ts:236`) and clear the selection in `showRenderFailure`.
Make `AppContext.document` required (`buildAppContext` always sets it).

**Risks and open questions.** `palette/view.ts:503-506` installs selection from the palette mount.
Moving that into `startApp` changes the order on the `app.html` harness, which has no palette.
Check `selection/harness-entry.ts`'s patch still works, or becomes unnecessary (then delete it
and say so).

---

### B-13 — Lift the per-article view into `view/rendered-view.ts`

**Model:** opus · **Size:** L · **Depends on:** B-12 · **Parallel with:** —

**Outcome.** One object per article owns everything about showing a store in it: the render into
the element, mode and the Source editor, the typesetter, grid scheduling, the anchor, the resize
observer, the block list and the asset roots it scoped. `app.ts` creates one view for `#doc` and
asks it to show a store. With one document the app behaves byte for byte as today, and a second
view could be created beside it with no other change.

**Why now.** `12` step 2 (`app.ts:607-780` lifted), `07-feature-split-view.md` §6.1 and §6.6 story 3,
`01-codebase-audit.md` §6.5 ("move the glue out of `app.ts` into a per-article `RenderedView`").

**Paths.**
- `apps/desktop/src/view/rendered-view.ts` (new)
- `apps/desktop/src/app.ts`
- `apps/desktop/src/theme/user-theme.ts` (`UserThemeContext` only)
- `scripts/registry.json` (`innerHtmlAllowedIn`: add `apps/desktop/src/view/`)
- `apps/desktop/test/typeset-defaults.test.mjs`, `test/source-mode-shell.test.mjs` (source-pin cases)
- `apps/desktop/test/view-lifecycle.test.mjs` (new)

**Build order.**
1. `view/rendered-view.ts`:
   ```ts
   export interface ViewHost { article: HTMLElement; scroller: HTMLElement; sourceHost: HTMLElement; modeHost: HTMLElement }
   export function createRenderedView(host: ViewHost, deps: { shell; trust: TrustController; assetRoots: Set<string>; measure: LaunchMeasure }): RenderedView;
   export interface RenderedView {
     show(store: DocumentStore, opts?: { at?: number; firstOpen?: boolean }): Promise<RenderEvidence>;
     rerender(at?: ReadingPosition): void;
     position(): ReadingPosition;
     restore(p: ReadingPosition): void;
     landOn(byte: number | undefined): void;
     readonly mode: 'rendered' | 'source';
     toggleMode(): Promise<void>;
     showSource(byte: number): Promise<void>;
     sourceHasUnfoldedEdits(): boolean;
     typeset(): Promise<void>;            // typesetDocument, including the typeset_viewport and typeset_done marks
     blocks(): BlockList;
     debugCounts(): { typesetters: number; resizeObservers: number };
     destroy(): void;                     // today's teardownDocument
   }
   ```
2. Move into it, keeping function bodies:
   - `readingScroller`, `sourceMount`, `setModeChrome`, `ensureSourceEditor`, `showSource`,
     `showRendered`, `enterSourceFromRendered`, `leaveSourceForRendered` and `toggleViewMode`
     (`:197-300`);
   - `assignHtml`, `sourceHarness` (`:325-350`);
   - `snap`, the anchor (`releaseAnchor`, `listenForReaderScroll`, `blockContaining`,
     `holdAnchor`, `landOn`), snap coalescing (`cancelScheduledSnap`, `scheduleSnap`),
     `destroyTypeset`, `disconnectResizeObserver`, `keepOnGrid` and `teardownDocument`
     (`:607-780`);
   - `startTypeset`, `typesetDocument` and `rerenderFromBuffer` (`:948-992`);
   - the render half of `openDocumentThroughRenderMark` (`:1095-1117`).
   All of it in **Phase A's form**: deferred first paint and one-pass grid scheduling (see
   "Carried over from Phase A").
3. The view writes `data-marxy-mode` on `host.modeHost`, which `app.ts` passes as `document.body`.
   The Source mount is `host.sourceHost`, which `app.ts` passes as `#marxy-source`. The scroller is
   `host.scroller`, which `app.ts` passes as `document.documentElement`. So the DOM is unchanged:
   `#doc` stays the article's id, and no `data-marxy-pane` or pane element is added (Phase D).
4. The view subscribes to the store it shows and unsubscribes on `show` of another store and on
   `destroy`. It re-renders on content transitions and maps its own anchor (ADR-0037 §6) where
   B-11 restored by position.
5. `app.ts`: one `view` for `#doc`. `AppHandle.debugCounts`, `sourceHarness` and `state` read from
   it. Delete rows 5–10, 24, 26–32 and the `scopedAssetRoots` / `liveTypesetters` consts of the
   state map in B-11.
6. `theme/user-theme.ts`: `UserThemeContext` takes `views(): readonly RenderedView[]` instead of
   `getTypeset`, `readingScroller`, `getOpenPath` and `getBlocks`, and relayouts each view on a
   theme change.
7. Source pins: `typeset-defaults.test.mjs` reads `attach()` options from `view/rendered-view.ts`.
   `source-mode-shell.test.mjs:65` checks both `app.ts` and `view/rendered-view.ts` have no
   static `@codemirror` import.
8. `test/view-lifecycle.test.mjs`:
   - N opens leave one typesetter and one resize observer (as `source-mode-shell.test.mjs:193`
     does, plus `debugCounts`);
   - two views created on two articles in one page (via a test-only entry) typeset independently,
     and destroying one leaves the other's counts;
   - `rendered-view.ts` has no module-level `let`.

**Acceptance.**
- `app.ts` has none of the state-map rows marked B-13: `test/view-lifecycle.test.mjs` (source text).
- Two views coexist and tear down independently: `test/view-lifecycle.test.mjs`.
- No visible change: `pnpm gate:aesthetics` (macOS) passes with **no** baseline change, and the
  desktop suite is green with only the two named source-pin edits.
- First text at 256 KB and 1 MB within 10 % of before: `large-document.test.mjs`, numbers in the PR.
- `innerHTML` reaches the DOM only from allowed paths: `pnpm check:registry`.

**Tests.** All of `apps/desktop/test` with WebKit required, `pnpm gate:aesthetics`,
`pnpm check:registry`, `pnpm precheck`.

**Do not.** Make the pane an `overflow: auto` container, move notices into the view, or change
`index.html` (Phase D). Change typeset options. Read `window.innerHeight` in new code (the
typesetter's own two reads stay; `07` §1 item 3).

**Risks and open questions.** `typeset-defaults.test.mjs:86` pins that `attach()` is called with
- *Added 2026-10-02 by the lead, from the B-04 review.* The store's `version` bumps on every committed
  transition, including `save`, `rename` and a disk-only `reload` that leave the buffer untouched. A
  view that captured `version` before a slow save finished and then edits with `baseVersion` gets
  `false`, and `false` also means "no-op", so a keystroke during a save is silently dropped. Either
  re-read `snapshot().version` and retry once on a refused edit, or give the store a buffer-only
  version that only buffer-changing transitions bump, and compare `baseVersion` against that.
no `hyphenate` or `hanging`. Keep the literal. B-17 changes the options.

---

### B-14 — Lift live reload and reading persistence out of `app.ts`

**Model:** opus · **Size:** M · **Depends on:** B-13 · **Parallel with:** —

**Outcome.** Live reload is `apps/desktop/src/document/live-reload.ts`: one watch per store, the
retry read through `peekFile`, rename follow, the deleted-file notice and reload at the view's
own position. Reading-position and palette-history persistence is
`apps/desktop/src/position/reading-persistence.ts`. Neither reaches for `window.__marxyPalette`.
No behaviour changes.

**Why now.** `01-codebase-audit.md` §2.3 (`782-905` live reload, `995-1077` persistence), state-map
rows 4, 11–13.

**Paths.**
- `apps/desktop/src/app.ts`
- `apps/desktop/src/document/live-reload.ts` (new)
- `apps/desktop/src/position/reading-persistence.ts` (new)
- `apps/desktop/src/main.ts` (one line: pass the palette's session getter)
- `apps/desktop/test/tauri-stale-write.test.mjs` (its source slice)

**Build order.**
1. `live-reload.ts`:
   `watchDocument(store: DocumentStore, views: () => readonly RenderedView[], deps: { shell; open(path, at): Promise<void>; serially })`
   returns `{ close() }`. It moves `readOpenFileWithRetry`, `reloadOpenFromDisk`,
   `handleDocumentWatch` and `registerDocumentWatch` (`:792-905`), keeping the `live_reload` and
   `watch_failed` marks. The position for `applyWatchToOpenDocument` comes from the first view
   (`views()[0]`), and every view restores to its own mapped position.
2. `reading-persistence.ts`:
   `createReadingPersistence(shell, paletteSession: () => PaletteSession | undefined)` returns
   `{ ensureLoaded(fallbackRoot): Promise<void>; attach(view): void; storedFor(path, length): StoredPosition | null; flush(): Promise<void> }`.
   It moves `flushReadingPersistence`, `flushPaletteHistory`, `flushAllPersistence`,
   `installScrollPersistence`, `optionalStatePresent`, `readOptionalState`,
   `ensurePersistenceLoaded` and `restorePersistedPositionIfNeeded`'s lookup.
3. `main.ts` `bootApplication`: after mounting the palette, call
   `handle.setPaletteSession(() => palette.session)`. That is an additive `AppHandle` member, and
   it replaces the two `window.__marxyPalette` reads at `app.ts:1002-1006` and `:1360-1363`. Keep
   `main.ts` ≤ 30 lines (`shell-boundary.test.mjs:105`).
4. `app.ts` wires both. The `shell.quit` wrapper calls `persistence.flush()`.
5. `tauri-stale-write.test.mjs:35-42`: slice `live-reload.ts`, not `app.ts`.

**Acceptance.**
- `app.ts` has no `documentWatch`, `positionPersistence`, `persistenceLoaded` or
  `scrollPersistenceInstalled`, and no `__marxyPalette`: the source-text case added to
  `test/view-lifecycle.test.mjs`.
- Live reload, rename follow, delete notice and the stale-write guard behave as before:
  `live-reload.test.mjs`, `tauri-stale-write.test.mjs`, `data-loss.test.mjs` (CRLF reload case),
  `save-close-r5.test.mjs`.
- Position and palette history persist across launches: `persist-reading.test.mjs`,
  `palette-index.test.mjs`.
- `large-document.test.mjs` within 10 %.

**Tests.** All of `apps/desktop/test` with WebKit required, `pnpm precheck`.

**Do not.** Diff ASTs for partial reload (`05` §11.2 rank 9; out of scope). Change the
positions.json format. Persist per view (Phase D's rule).

**Risks and open questions.** `handleDocumentWatch`'s "follow" branch calls the open path from
inside `serially` (comment at `:840-842`). Keep the non-queued call or the reload deadlocks. A
test for that exists in `live-reload.test.mjs`; name it in the PR.

---

### B-15 — Lift the open path; `app.ts` becomes the composition root

**Model:** opus · **Size:** M · **Depends on:** B-14 · **Parallel with:** —

**Outcome.** The open path (read, create the store, show it in the view, typeset, restore the
stored position, deferred start-up, theme, watch, title), the frontispiece and `boot` move to
`apps/desktop/src/document/open.ts` and `frontispiece/mount.ts`. `app.ts` is under 300 lines and
only builds and connects: shell wrapper, measure, trust, persistence, view, selection, open path,
close guard, commands, handle. It holds no module-level `let`, and a test keeps it that way.
`AppHandle.dispatch` reaches the store's transitions, as ADR-0037 §2 says.

**Why now.** `12` step 2 ("`app.ts` ends under 300 lines and resets no state by hand"; today
`startApp` resets about fifteen pieces by hand, `app.ts:1312-1330`), ADR-0037 Consequences (the
gate against module-level document state).

**Paths.**
- `apps/desktop/src/app.ts`
- `apps/desktop/src/document/open.ts` (new), `apps/desktop/src/frontispiece/mount.ts` (new)
- `apps/desktop/src/theme/app-config.ts` (new, only if Phase A applies `variant`/`size` inside `app.ts`)
- `apps/desktop/test/module-state.test.mjs` (new)
- `docs/design/09-app-shell.md` (§State), `docs/design/00-architecture.md` (module notes), `AGENTS.md` (module map row for `apps/desktop`)

**Build order.**
1. `document/open.ts`: `createOpenPath(deps)` returns
   `{ boot(args): Promise<void>; open(path, opts?): Promise<void>; currentPath(): string | null }`.
   - It moves `openDocumentThroughRenderMark`'s read and store creation, `finishDocumentOpen`,
     `replaceOpenDocument`, `hasUnsavedChanges` and `openReplacing` (`:1079-1190`), and `boot`
     (`:1232-1297`).
   - It holds the current store as a field.
   - `restoreAfterTypeset` becomes the `firstOpen` option.
2. `frontispiece/mount.ts`: `showFrontispiece(doc, pieces)` and `setFrontispiece(view)` (`:1192-1230`).
   Keep the dynamic import of `frontispiece/index.ts`: a launch with a document must carry none of
   it (`frontispiece/index.ts:2-3`).
3. If Phase A left the config application (`variant`, `size`) in `app.ts`, move it to
   `theme/app-config.ts` as `applyAppConfig(root, config)`, and pass `linux.weight_offset` to
   `applyWeightOffset` there (B-07's third argument).
4. `app.ts`: types (`AppHandle`, `OpenDocumentState`) and `startApp(shell, opts)`, which builds
   everything with closures. No `let` at module scope. `startApp` called twice in one realm (the
   tests do) starts clean, because nothing is module state.
   `dispatch(action: { type: 'apply' | 'undo' | 'redo' | 'save' | 'toggle-mode'; … })` routes to
   the focused view's store or view. Delete the `commands()` stub only if nothing calls it (grep
   the tests).
5. `test/module-state.test.mjs` (Node):
   - `app.ts`, `document/*.ts`, `view/*.ts`, `selection/view.ts`, `commands/edits.ts` (if it
     exists) and `save.ts` contain no `^let `;
   - no file under `apps/desktop/src` except `document/store.ts` constructs `new History(`;
   - `app.ts` has fewer than 300 lines.
   - The message names ADR-0037.
6. Docs:
   - `09-app-shell.md` §State: replace the `AppState` sketch and `state.ts` with the store
     (bytes and history), the view (mode, anchor, layout) and the app instance (focused view,
     overlays), linking ADR-0037.
   - `00-architecture.md`: one paragraph naming `document/`, `view/`, `trust/controller.ts` and
     `startup/measure.ts`.
   - AGENTS.md module map: the `apps/desktop` row says "composition root `app.ts`; document store
     `document/`; per-article view `view/`".

**Acceptance.**
- `app.ts` < 300 lines with no module `let`, and no other listed module holds document state:
  `apps/desktop/test/module-state.test.mjs`.
- `startApp` twice in one page leaves no state from the first (two harness boots in one page, as
  `single-instance.test.mjs` does): the suite is green.
- `AppHandle.dispatch({ type: 'undo' })` undoes the last operation: a case in `test/store-undo.test.mjs`.
- The frontispiece path is unchanged and still lazily loaded: `frontispiece-boot.test.mjs`,
  `frontispiece.test.mjs`, `source-mode-shell.test.mjs:70` (static import walk), `pnpm gate:bundle`.
- `large-document.test.mjs` within 10 %; `pnpm gate:aesthetics` with no baseline change.

**Tests.** Everything in "Verification at the end of the phase" except B-16 to B-19's own.

**Do not.** Rename `AppHandle` members the tests use (`state`, `ready`, `shell`, `open`,
`currentPath`, `sourceHarness`, `debugCounts`, `openDocument`, `onDocumentChange`, `commitEdit`,
`pinPaletteDocument`). Change marks. Move notices' module state (`notices/index.ts`,
`notices/blocked.ts`) or `close.ts`'s prompt state: they are UI singletons per window and
Phase D's.

*Added 2026-10-03 by the lead, from the B-08 review:* `startup/measure.ts` holds a module-scope frame counter; a new launch right after `finish()` in the same page can start a second rAF loop (a generation token in `observeFrame` fixes it), and `createLaunchMeasure`'s doc comment still says `startApp` starts the count. Absorb `app.ts`'s `let measure` too.

**Risks and open questions.** If 300 lines cannot be reached without splitting `AppHandle`'s
type out, put the types in `app-types.ts` and say so. The number is the audit's target; the
module-state test is the real gate.

---

### B-16 — Move test hooks into test-only entries

**Model:** sonnet · **Size:** M · **Depends on:** B-15 · **Parallel with:** B-17

**Outcome.** The shipped bundle carries no test plumbing. The `window.marxy*` and `__marxy*`
hooks that tests drive are installed by a harness module that only harness pages load. The three
`MARXY_*_MUTATION` switches no longer exist in product code. Two hooks that were really product
state (`__marxyJumpCarrier`, `__marxyHandle`) become fields of the objects that own them.

**Why now.** `01-codebase-audit.md` §2.4 (20 globals, three mutation switches, one of which inserts
a tab strip into the live DOM), `04-tests-and-gates.md` §3 (the hooks ship in the bundle) and §6.1
("Delete … the `MARXY_*_MUTATION` hooks"), `12` step 4.

**Paths.**
- `apps/desktop/src/harness/test-hooks.ts` (new)
- `apps/desktop/app.html`, `apps/desktop/test/palette-boot.html`, `apps/desktop/gate.html` (script lines only)
- `apps/desktop/src/commands/document.ts`, `commands/edits.ts`, `commands/source-view.ts`
- `apps/desktop/src/source/tab-width.ts`
- `apps/desktop/src/render/tasks.ts`
- `apps/desktop/src/selection/view.ts`, `selection/harness-entry.ts`
- `apps/desktop/src/palette/view.ts` (`documentHasTabBar` / `applyTabBarMutation` / `TAB_BAR_DOM_MUTATION`)
- `apps/desktop/src/palette/search.ts` (`:6`, `:75`)
- `apps/desktop/src/startup/idle-work.ts` (`:29`, `:151-153`; if Phase A has not already removed them)
- `apps/desktop/package.json` (`test` script)
- test files that read the moved names: `test/palette.test.mjs`, `test/palette-index.test.mjs`,
  `src/palette/search.test.ts`, and any `test/*.test.mjs` the grep below finds
- `scripts/gate-bundle.mjs` (the forbidden-strings list)

**Build order.**
1. Inventory: `grep -rnoE "__marxy[A-Za-z]+|window\.marxy[A-Za-z]+|w\.marxy[A-Za-z]+" apps/desktop/src`.
   On `bc05670f` these were `__marxyDocumentWire`, `__marxyHandle`, `__marxyJumpCarrier`,
   `__marxyOpenSynced`, `__marxyOrigBytes`, `__marxyPalette` (removed by B-14),
   `__marxySelectionHarnessPatched`, `__marxyTasksReady`, `marxyApp`, `marxyDocumentEdit`,
   `marxyHarnessAlignTable`, `marxyHarnessRedo`, `marxyHarnessSave`, `marxyLayoutShift` (removed
   by B-02), `marxyRefreshSourceTab`, `marxyRender` (removed by B-02), `marxyRunCommand`,
   `marxySelection`, `marxySourceHarness` and `marxySourceTabSize`.
2. `harness/test-hooks.ts`: `installTestHooks(handle: AppHandle)` sets every hook a test reads:
   `marxySelection`, `marxyDocumentEdit`, `marxyHarnessAlignTable`, `marxyHarnessRedo`,
   `marxyHarnessSave`, `marxyRunCommand`, `marxyRefreshSourceTab`, `marxySourceTabSize`,
   `__marxyTasksReady`, `__marxyOpenSynced`. Each is implemented against the handle (store,
   view, selection), not module state. `app-harness.ts`, `palette-boot.html`'s inline module
   and `gate-entry.ts` call it.
3. Product modules: delete the hook assignments from `commands/document.ts`
   (`startDocumentEditingWire`'s `w.*` lines; keep its `MutationObserver` task wiring),
   `selection/view.ts` (`w.marxySelection`), `render/tasks.ts` (`__marxyTasksReady`) and
   `commands/edits.ts` (`__marxyOpenSynced`, and the `__marxyOrigBytes` read in `documentIsDirty`).
   - Where a test relied on `__marxyOrigBytes`, the store's `dirty` is now right. Delete the
     test's override line, and report any test whose meaning that changes.
   - `__marxyJumpCarrier` becomes a field of the selection controller (`lastPointerCarrier()`).
   - `__marxyHandle` reads in `source/tab-width.ts:35-37` and `commands/document.ts` take the
     shell from the context passed in.
4. Mutation switches: delete `MARXY_86_MUTATION` (`search.ts:75`), `MARXY_87_MUTATION` with
   `applyTabBarMutation` (`view.ts:136-147`), and `MARXY_196_MUTATION` (`idle-work.ts:151-153`)
   if present.
   - Keep `documentHasTabBar` as a plain check if `test/palette.test.mjs` still asserts "no tab
     bar"; delete the mutation case at `:143`.
   - `apps/desktop/package.json` `test`: delete the `( MARXY_86_MUTATION=… ; test $? -eq 1 )`
     re-run.
   - If Phase A already replaced it with `pnpm test:mutations`, port that script to inject the
     mutation from the test side (an exported seam the test sets, never `process.env` read in
     product code), or delete it and say which.
5. `scripts/gate-bundle.mjs:129`: add `installTestHooks` and `marxyHarness` to the strings the
   release bundle must not contain.

**Acceptance.**
- The built `apps/desktop/dist` bundle contains none of the hook names or `MARXY_8`/`MARXY_19`
  strings: `pnpm gate:bundle` (with its extended list) and
  `grep -rl "MARXY_86_MUTATION\|marxyRunCommand\|__marxyOrigBytes" apps/desktop/dist` empty in
  the PR.
- No `process.env` read in `apps/desktop/src` outside tests and `*.mjs` build files: a case in
  `test/module-state.test.mjs`.
- The desktop suite passes, and the `pnpm test` log contains no designed failures (`04` §3 item 1):
  the PR quotes the `ℹ fail` lines (all zero).

**Tests.** All of `apps/desktop/test` with WebKit required, `src/palette/*.test.ts`, `pnpm gate:bundle`,
`pnpm precheck`.

**Do not.** Change a test's assertion to make it pass. If a test cannot be driven without a hook,
add the hook to `test-hooks.ts`. Remove `window.marxyApp` (it is the harness entry's own API).

**Risks and open questions.** `jump-to-source.test.mjs` failed three times in a row on one branch
in CI (`04` §3: "reads as a real bug"). If it fails here, report its history rather than retrying.

---

### B-17 — Honour `typeset = false` and take justif's engine off the critical path

**Model:** sonnet · **Size:** S · **Depends on:** B-15 · **Parallel with:** B-16

**Outcome.** `typeset = false` in `config.toml` (parsed today, `packages/theme/src/config.ts:85-87`,
ignored by the app) turns the Knuth–Plass pass off through the existing kill switch, so the engine
wraps lines. The unused `engine: 'justif'` path and its option are deleted. justif then provides
only hyphenation patterns and hanging-punctuation tables. With the default config nothing changes.

**Why now.** `01-codebase-audit.md` §4 (justif is young, one maintainer, and the app uses its
`breakTokens` only behind an option nothing sets, `typeset/src/index.ts:144`) and §8 item 9,
`12` step 8.

**Paths.**
- `packages/typeset/src/index.ts`, `packages/typeset/src/items.ts` (delete if unused after)
- `packages/typeset/scripts/measure-rendered.mjs`
- `apps/desktop/src/theme/app-config.ts` (or the module Phase A uses to apply config; B-15 named it)
- `apps/desktop/src/view/rendered-view.ts` (`attach()` options only)
- `apps/desktop/test/typeset-defaults.test.mjs`
- `apps/desktop/test/typeset-off.test.mjs` (new)
- `docs/design/04-typeset.md` (the engine option and the config switch)

**Build order.**
1. Config: where variant and size are applied, set
   `root.style.setProperty('--marxy-typeset', 'none')` when `config.typeset === false`, and remove
   the property otherwise. The typesetter checks it at `attach` (`index.ts:231`) and between
   chunks (`abortIfKilled`).
2. `typeset/src/index.ts`: delete `engine`, `glueStretchEm` and `raggedStretchEm` only if nothing
   else passes them (`measure-rendered.mjs:39,65` does: drop its justif rows and keep the ragged
   ones); delete `breakTokens`, `DEFAULT_BREAK` and `hyphenCosts`; and make `choose` ragged-only.
   Delete `items.ts` if nothing imports it.
3. `view/rendered-view.ts`: drop `glueStretchEm: 0.6` from `attach()`. Update
   `typeset-defaults.test.mjs:80,91` to the new option set, still asserting no `hyphenate` or
   `hanging`.
4. `typeset-off.test.mjs` (WebKit, palette-boot harness with `/config` = `typeset = false`):
   - no `.marxy-set` paragraph after `typeset_done`, or after 2 s if no `typeset_done`;
   - first text emitted;
   - with no config, `.marxy-set` paragraphs exist.

**Acceptance.**
- `typeset = false` leaves every paragraph engine-wrapped: `apps/desktop/test/typeset-off.test.mjs`.
- No import of `justif/core`'s line breaker remains: `git grep -n "breakTokens\|breakParagraph" packages/typeset/src` empty, in the PR.
- The default page is unchanged: `pnpm gate:aesthetics` with no baseline change, and the rag
  baselines unchanged.
- `pnpm --filter @marxy/typeset test` green.

**Tests.** As above, plus `pnpm precheck`.

**Do not.** Vendor justif's hyphenation patterns in this story. That needs a licence check of the
pattern files and is a question for the author (below). Change `ragged.ts`. Add a settings UI.

**Risks and open questions.** Vendoring `en-us`/`en-gb` patterns would remove justif entirely
(`01` §4), but TeX hyphenation patterns carry their own licences. Report the licence string of
each pattern file in justif's package; the author decides.

---

### B-18 — Make `Shell` the interface the app programs to

**Model:** opus · **Size:** M · **Depends on:** B-06, B-07, B-16 · **Parallel with:** —

**Outcome.** The app, the Tauri shell and the memory shell all use one type, `Shell`, from
`@marxy/shell-api`. It lists exactly what the Tauri shell implements, including `peekFile` and
`recordRead`. The ad hoc `AppShell` (`app.ts:80-105`) and the duplicate type on `shell/tauri.ts`'s
export (`:56-91`) are gone, and so are the members nothing implements.

**Why now.** `01-codebase-audit.md` §6.2 (20 of 29 members implemented; the app programs to an
ad hoc `Pick` with ten redeclared members), `10` §3.2, `12` step 6.

**Paths.**
- `packages/shell-api/src/index.ts`
- `apps/desktop/src/shell/tauri.ts`, `shell/memory.ts`
- `apps/desktop/src/app.ts` and every importer of `AppShell` (`main.ts`, `palette/history.ts`,
  `palette/view.ts`, `selection/view.ts`, plus any added since)
- `apps/desktop/test/shell-boundary.test.mjs`
- `docs/design/06-shell.md` (§Commands table), `docs/adr/0039-shell-stub-dedup.md` (a dated note
  only)
- `apps/desktop/src-tauri/src/**` only if a member is implemented (none is planned)

**Build order.**
1. Decide each unimplemented member (as of `bc05670f`; Phase A may have implemented
   `revealInExternalEditor` for "open in external editor"):

   | Member | Decision | Reason |
   | --- | --- | --- |
   | `stat` | delete | no caller |
   | `listRoot`, `fuzzy` | delete | deprecated by ADR-0026; the index service walks in TypeScript |
   | `repositoryRoot` | delete unless Phase A's index service calls it | root detection is in `core/index-model` |
   | `openDialog` | delete | Open File is a native menu in Rust (`main.rs:703-723`) |
   | `revealInExternalEditor` | keep if Phase A implemented it; else delete | |
   | `setWindowControls` | delete | ADR-0038 is accepted and unbuilt; the member returns with the feature |
   | `webkitVersion` | delete | B-07 removed the version table |
   | `fetchRemoteImage` | delete | ADR-0044: the fetcher is a hardened-mode feature, not built |

2. `shell-api/src/index.ts`:
   - delete those members and their `@ts-expect-error` stubs (`:105-111`);
   - add `peekFile(path): Promise<Uint8Array>` and `recordRead(path, bytes): void`, plus
     `args(): Promise<readonly string[]>`, `mark`, `quit`, `imageSize`, `allowAssetScope` and
     `assetUrl` with the signatures `tauri.ts` implements;
   - keep `onMenuCommand` off `Shell`, as a Tauri-only extra typed in `tauri.ts`, because a
     menu is platform UI;
   - update the stub shell.
3. `tauri.ts`: `export const shell: Shell & { onMenuCommand(cb: (id: string) => void): void } = { … }`.
   `memory.ts`: `MemoryShell = Shell & { calls; emit; queueSaveDialog; rejectNextWrite; lastTitle; emitCloseRequested; hasFile; hasGitMarker }`,
   with `peekFile` and `recordRead` implemented (recording calls).
4. Replace `AppShell` with `Shell` everywhere, and delete the type from `app.ts`. Optional
   chaining on `peekFile?.` and `recordRead?.` goes, because they are required now.
5. `shell-boundary.test.mjs`: add "`tauri.ts`'s `shell` satisfies `Shell`" (a type-level check
   through `tsc`, or the existing export allow-list plus a grep that `AppShell` exists nowhere).
6. `06-shell.md` §Commands: mark the deleted members removed with B-18 and the reason;
   `0039`: a dated note that stubs now track the real interface.

**Acceptance.**
- `AppShell` exists nowhere: `git grep -w AppShell` empty, asserted in `shell-boundary.test.mjs`.
- Every `Shell` member is implemented by both shells: `pnpm typecheck` (both shells typed as
  `Shell`) and a `shell-boundary.test.mjs` case that lists `Shell`'s members (parsed from the
  interface) and finds each as a property in `tauri.ts`'s object literal. The audit's [C21]
  one-liner is the model.
- Every `invoke('…')` still has a Rust handler: the existing MARXY-138 case in `shell-boundary.test.mjs`.
- The desktop suite and `cargo check` pass.

**Tests.** `pnpm typecheck`, `shell-boundary.test.mjs`, all of `apps/desktop/test` with WebKit
required, `cargo check --locked`, `pnpm precheck`.

**Do not.** Implement a member to avoid deleting it. Add `reqwest`, `hyper` or `ureq`. Change
IPC command names.

**Risks and open questions.** `setWindowControls` is in an accepted ADR. Deleting the member is a
contract change by PR (ADR-0045), but the ADR itself stays accepted and unbuilt. Ask the author
whether they prefer the member kept as a no-op until it is built.

---

### B-19 — Replace deep imports with package exports; move `paths.ts` to `core/paths.ts`

**Model:** sonnet · **Size:** M · **Depends on:** B-18 · **Parallel with:** —

**Outcome.** The desktop app imports `@marxy/core`, `@marxy/theme` and `@marxy/typeset` through
named entry points (`@marxy/core/paths`, `@marxy/core/render`, `@marxy/core/position`, …), never
through `@marxy/<pkg>/src/...`, and the boundary check refuses a new deep import. The general
path utility moves from `core/index-model/paths.ts` to `core/paths.ts`.

**Why now.** `01-codebase-audit.md` §2.4 ([C7]: 52 deep imports in 28 desktop files; 11 of
`index-model/paths.ts`, 10 of `render/images.ts`), §8 item 8, `12` step 6. It goes last because it
touches nearly every file the chain touched.

**Paths.**
- `packages/core/package.json`, `packages/theme/package.json`, `packages/typeset/package.json` (an `exports` map)
- `packages/core/src/paths.ts` (moved from `index-model/paths.ts`), and every importer of the old path
  (`git grep -l "index-model/paths"`, 14 files on `bc05670f` including `packages/core/src/render/images.ts`)
- every `apps/desktop/src/**` file with a `@marxy/*/src/` import
- `apps/desktop/src/render/highlight.worker.ts`, `apps/desktop/test/persist-reading.test.mjs`,
  `scripts/check-one-parse.test.mjs` (the three non-`src` deep importers)
- `scripts/check-boundaries.mjs`, `scripts/check-boundaries.test.mjs`
- `docs/plan/tasks/MARXY-289.md` is history: do not edit

**Build order.**
1. `git mv packages/core/src/index-model/paths.ts packages/core/src/paths.ts`. Leave no
   re-export at the old path. Fix imports inside core.
2. `exports` maps:
   - `@marxy/core`: `"."` → `./src/index.ts`, plus `./paths`, `./render` (`src/render/index.ts`),
     `./render/images`, `./render/pipeline`, `./render/punycode`, `./position`
     (`src/position/index.ts`), `./operations`, `./index-model`, `./index-model/deny`,
     `./highlight`, `./sanitize/policy` — one subpath per module the app imports today. Use
     `grep -rhoE "from '@marxy/[a-z-]+/src/[^']+'" apps/desktop/src | sort -u` for the list.
   - `@marxy/theme`: `"."` and `./loader`.
   - `@marxy/typeset`: `"."`.
   - Keep `"main"` for tools that ignore `exports`.
3. Rewrite every deep import to its subpath. Type-only imports of contracts go through `"."`.
4. `check-boundaries.mjs`: a rule for files outside `packages/<pkg>/`, refusing a specifier
   matching `^@marxy/[a-z-]+/src/`, with a fix line naming the `exports` map.
   `check-boundaries.test.mjs`: one passing case (`@marxy/core/paths`) and one failing case
   (`@marxy/core/src/paths.ts`).
5. Run `pnpm typecheck`, Vite builds and the Node tests: `moduleResolution: "Bundler"` honours
   `exports`, and Node's resolver does too. Confirm `node --experimental-strip-types` resolves `.ts`
   subpath targets through the workspace symlink, as it does for `"main"` today.

**Acceptance.**
- No `@marxy/*/src/` import outside its own package: `pnpm check:boundaries` and the new
  `check-boundaries.test.mjs` cases.
- `core/index-model/paths.ts` is gone and `core/paths.ts` is imported as `@marxy/core/paths`:
  `pnpm typecheck`.
- The bundle is no larger: `pnpm gate:bundle`, with before/after sizes in the PR.
- `pnpm test`, the desktop suite and `pnpm gate:golden` pass.

**Tests.** `pnpm typecheck`, `pnpm test`, `pnpm check:boundaries`, `pnpm gate:bundle`,
`pnpm gate:golden`, all of `apps/desktop/test`, `pnpm precheck`.

**Do not.** Re-export everything from `@marxy/core`'s index: Shiki and the index model must stay
out of the start-up chunk. Change any function. Touch contract types.

**Risks and open questions.** If Node refuses `.ts` targets in `exports` under a `node_modules`
path (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), the workspace symlink is resolving to a
`node_modules` path, not the real one. Report it with the failing command before changing how
tests run.

---

### B-20 — Load remote images by the `remote_images` setting

**Model:** opus · **Size:** M · **Depends on:** B-09, B-18, B-19 · **Parallel with:** —

**Outcome.** `config.toml` takes `remote_images = "never" | "ask" | "always"`, default `ask`
(ADR-0044 §2). With `never`, the B-09 notice and nothing else. With `ask`, the notice gains one
action, **Load images for this document**, which loads them for this document for this session.
With `always`, remote images load as the page renders. No request leaves the machine without the
setting or that click.

**Why now.** `10-overfit-decisions.md` §3.1 amendment items 2–4, `12` step 8, `14` Phase B
("remote images as a setting"). It was conditional on the author choosing the loading mechanism, which they did
(`rulings.md`, question 9), and it is the one change in this phase a
reader would notice on every README.

**Paths:**
- `packages/theme/src/config.ts`, `config.test.ts` (the key)
- `apps/desktop/src/trust/controller.ts`, `notices/blocked.ts`, `notices/trust-copy.ts`
- `apps/desktop/src/render/images.ts` (a remote post-pass `applyRemoteImages`)
- `apps/desktop/src-tauri/tauri.conf.json` (CSP), and for mechanism (b) `apps/desktop/src-tauri/src/main.rs`
- `scripts/gate-no-network.mjs` (assert zero requests with the setting at `never` and at the default)
- `apps/desktop/test/remote-images.test.mjs` (new)
- `docs/design/13-trust.md`, `docs/design/11-config-and-storage.md`
- `docs/taste-review/queue.d/B-20.md`

**Build order.**
1. `config.ts`: parse the key (`remote_images`) into `remoteImages: 'never' | 'ask' | 'always'`,
   default `'ask'`, invalid value → `'ask'` with a warning.
2. The load path, ruled by the author on 2026-10-02: mechanism (b), ADR-0044 §4. Mechanisms (a) and (c) are rejected and kept here as the record:
   - **(a) static CSP:** add `https:` to `img-src` in `tauri.conf.json`. The sanitiser's deferral
     (`data-marxy-remote`, no `src`) stays the boundary, and `applyRemoteImages` sets `src` only
     when the setting or the click allows.
   - **(b) widened CSP on consent:** ADR-0044 §3, a webview reload with a widened policy. This
     needs Rust and a spike.
   - **(c) park:** the story stops here.
3. Reserve each box before load (one line box tall, full measure, unless width and height are
   given). On decode, run the view's grid pass. On error, keep the alt text and show one
   aggregated transient notice (design 13 §Fetching).
4. `remote-images.test.mjs` (memory shell, a local HTTPS stub or a route intercept in Playwright):
   - `never`: zero requests, notice without action;
   - `ask`: zero requests until the click, then one per image;
   - `always`: requests at render, no notice;
   - the setting does not persist per document.
5. `gate-no-network.mjs`: run the corpus at the default and at `never`, asserting zero requests in
   both.

**Acceptance.** One bullet per case in step 4, in `apps/desktop/test/remote-images.test.mjs`;
`pnpm gate:no-network` green at both settings.

**Tests.** As above, plus `pnpm gate:aesthetics`, `pnpm precheck`.

**Do not.** Build the Rust fetcher (ADR-0044: hardened mode only). Allow
`http:` images. Change the HTML opt-in (`html = narrow | ask | wide` is not in this phase).

**From the B-09.1 review (2026-10-07).** B-09.1 left the blocked-images notice naming every host,
uncapped, through `displayBlockedHost` in `packages/core/src/render/images.ts`, a line-for-line copy of
the private `displayHost` in `link-host.ts`. When this story replaces the wording with ADR-0044's count
(decision 8), delete `displayBlockedHost`; if any host is still shown, export `displayHost` from
`link-host.ts` and use it, so images and links cannot drift apart.

**Risks and open questions.** The author chose (b) over (a), which would make the sanitiser the only boundary between a
document and a read receipt, which ADR-0027 argued against. (b) needs Rust and a spike; if the
spike shows the reload cannot reopen at the reading position inside the open-document budget,
report it and stop rather than falling back to (a).

---

## What this phase deliberately leaves out

- **The large-document levers.** Phase A (grid pass, deferred first paint, partial layout,
  measurement). Phase B only preserves them.
- **Anything split-shaped.** The pane element, `data-marxy-pane`, per-pane scrollers,
  `overflow: auto` panes, per-pane notices, an in-pane Source mount, `layout.json`, focus, and
  the divider (Phase D). Views exist and can be created twice; the window still shows one.
- **ADR-0037 §3's history mapping through a clean reload.** The store clears history on reload,
  as today. Mapping ranges through the change is a later story once the split makes two views of
  one file common.
- **Partial re-render on live reload** (`05` §11.2 rank 9). Reload still re-renders the whole
  document.
- **Module state that is UI, not document:** `notices/index.ts` and `notices/blocked.ts`
  counters, `close.ts`'s prompt, `palette/history.ts`'s mirror. They are per window and become
  per pane in Phase D.
- **The HTML tri-state setting** (`html = narrow | ask | wide`, ADR-0044 §2): the HTML opt-in stays
  per document in `trust.json`.
- **The Rust image fetcher and the hardened mode** (ADR-0044 §3, "After E" item 4).
- **Implementing `webkitVersion` and measuring Linux weights** (ADR-0046; a Linux release
  criterion).
- **Vendoring justif's hyphenation patterns** (pending the licence check in B-17).
- **Window controls hidden at rest** (ADR-0038): unbuilt; the member leaves `Shell` until it is built.
- **The perf apparatus's product tier and the nightly perf run**: Phase A and `10` §5 item 10.
- **`scripts/allowlists/dependencies.json`'s aspirational entries** (`01` §4): a separate clean-up.
