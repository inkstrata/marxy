# Plan delta — 2026-09-18 (paths that could not contain their own checks)

> Follow-up: [`2026-09-18-parse-on-gates.md`](2026-09-18-parse-on-gates.md). MARXY-59 escalated
> at attempt 2; do not re-split 36; Jira 88/89 remain duplicates and stay out of the CSV.

> Sixth delta of the day. Previous: `2026-09-18-review-throughput.md`. Board at the time of
> writing: 12 merges, last plan at 15:32, MARXY-66 already In Review on the widened Paths,
> MARXY-36 and MARXY-77 returned at attempt 1, MARXY-59 approved and held only on a
> CHANGELOG-shaped conflict.

Two prior planner attempts died on a usage limit after widening MARXY-66. This pass keeps that
edit and finishes the rest. No product code.

## Tripwires checked (`docs/roadmap.md`)

| Tripwire | State |
| --- | --- |
| Cold start > 500 ms after Phase 2 | Fired early, still Ian's (decision 4 of the review-throughput delta). Unchanged. |
| Weight-harness residual > 25 on real Linux | No data. MARXY-22 has not run. |
| `justif/core` cannot set ragged text | Not fired. MARXY-19 stands. |
| Reviewer fails the palette task at review #2 | Not reached. The palette itself is what this pass splits. |
| Authoring re-enters scope; WebKitGTK < 2.50; single Tauri engine; first reaction about a feature | Not fired. |

Taste review: nothing visual merged without a queue entry. The view slice of the palette is the
first time a reader will see one; that story carries the queue row.

## Decision 1 — MARXY-66 Paths stay widened; do not re-dispatch

Already In Review (PR #13). Paths are

`.gitattributes, docs/conventions.md, fonts/README.md, scripts/gate-font-attrs.mjs, package.json`

The reviewer escalated because the row's own criteria demanded a readable `fonts/README.md`
hunk and a check that runs, and neither was reachable from `.gitattributes, docs/conventions.md`.
Nothing on `feat/MARXY-66-stop-marking-text-files-under-fonts-as-b` is to be reverted. The
orchestrator does not start a second attempt.

## Decision 2 — MARXY-77 Paths named a file that has never existed

Returned at attempt 1, PR #21, `fe660e5`. The work is the right shape. Criterion 5 is unmet
because `Paths` listed `docs/adr/0020-shell-boundary.md`, which is not a file, and the
implementor correctly refused to invent a second ADR-0020. The file on disk is
`docs/adr/0020-core-is-shell-free.md`. Paths now name that file. Status stays `todo`.

The accepted ADR is not edited here. MARXY-77 lands a dated amendment that records reality;
the Decision is unchanged. Proposed amendment text (copy into the ADR, do not rewrite the
Decision):

> **Amendment 1 — how a gate may test shell-owned code (2026-09-18, MARXY-77)**
>
> The Decision stands: `packages/core` and `packages/typeset` never import from
> `apps/desktop`, `@tauri-apps/*`, or `packages/shell-api` implementations.
>
> The Why sentence that "golden files, byte-fidelity and no-network tests run in Node without
> a shell" is no longer true of fidelity. Byte-fidelity is a property of the shipped save
> path, which is Rust in `apps/desktop`. The gate that proves it lives at
> `scripts/gate-fidelity.mjs`, beside the other gates: it may compile and drive
> `apps/desktop` source, and it must not live under `packages/core` or import the shell from
> there. Golden files and the no-network sanitiser path still run in Node without a shell.

Attempt 2 also needs `--nocapture` (and `--test-threads=1`) on the compiled `rustc --test`
binary so the Linux xattr markers reach the gate. That is implementor rework, not a story
change. `scripts/gates-by-path.json` is still outside Paths; register the new home in a
follow-up if the rebase does not already have a legal way to touch it.

## Decision 3 — MARXY-36 splits: model vs mounted view

Returned at attempt 1, PR #30, 936 insertions. The session/search/keys work is good and the
eleven tests pass when someone remembers to run them. Three things the implementor cannot fix
inside `apps/desktop/src/palette`:

1. `apps/desktop/package.json` globs `test/**/*.test.mjs`; the tests are `src/palette/*.test.ts`.
   `pnpm test` never sees them. The file was outside Paths.
2. The no-tab-bar assertion inspects a `MiniNode` tree the PR itself built. ADR-0011 is a
   claim about the app. `main.ts` is untouched.
3. `view.ts` ships a hand-written DOM and CSS-selector engine in production source.

Split, not a second attempt at the same row. MARXY-36 is **dropped** (not deleted). Two new
rows, disjoint files:

| Key | Slice | Paths (the ones that must be listed) |
| --- | --- | --- |
| `MARXY-86` | session, search, keys, their tests | those files plus `apps/desktop/package.json` so CI actually runs them |
| `MARXY-87` | view mounted from `main.ts` | `view.ts`, `main.ts`, `index.html`, `apps/desktop/test`, the taste-review queue |

The directory `apps/desktop/src/palette` is **not** a path on either row. A directory would
make the two slices collide and would recreate the story this split exists to kill.

**The 16 ms budget.** ADR-0013 and design §07 mean keystroke → rows painted. That is the view
slice, measured with the palette summoned. The model slice proves the query half:
`searchPrepared` on an already-`prepareIndex`-ed 20k array. `prepareIndex` is excluded because
it runs when the index updates, not per keystroke. The model assertion scales 16 ms by a
measured machine factor so a rented runner cannot flake it; it does not edit
`fixtures/perf-budgets.json` (MARXY-70 owns that file).

Reuse PR #30's session/search/keys on the model slice. Delete `MiniNode` on the view slice;
do not ship it. MARXY-36 stays `blocked` so today's `ready.mjs` (which does not yet skip a
`dropped` label) cannot re-dispatch it. After MARXY-9, the label should be enough.

Jira grew a duplicate pair, MARXY-88 / MARXY-89, with the same summaries — a raced `sync`
from a dying planner attempt. The CSV, deps, cards and map use 86 / 87. Close 88 and 89;
do not dispatch them.

MARXY-39 now depends on the view slice, not on the dropped row.

## Decision 4 — MARXY-79 waits on MARXY-81

`orchestration/deps.json` did not have the edge the review-throughput delta already argued
for. Added: `"MARXY-79": ["MARXY-81"]`. Auto-merge into the unsigned-approval livelock is
still the reason. Hold any in-flight MARXY-79 branch until 81 is done; re-dispatch after.

## Decision 5 — MARXY-70 also re-derives parse baselines

MARXY-59 is approved (PR #15, `f9a6efa`) and is not changed. Its own reviewer asked that
MARXY-70 re-derive `parse_long_technical_ms` with the startup classes: ubuntu observations
sit at 13–27 ms against a 21.5 ms ceiling (samples 13.03, 19.58, 20.25, 27.61), so one in
four runs would have failed, while macOS has ~160 % slack. Criterion 11 on MARXY-70 now
says so. Until 70 lands, an occasional ubuntu re-measure on parse is expected, not a reason
to reopen 59.

## Story changes

### Dropped

- **MARXY-36** — split; reason in decision 3. Label `dropped`. Blocked on the board.

### New (phase 2, `speed`)

| Key | Summary | Deps |
| --- | --- | --- |
| `MARXY-86` | Palette model: MRU, fuzzy search, pinning, back/forward | MARXY-35 |
| `MARXY-87` | Palette view mounted from main.ts with a real no-tab-bar assertion | the model slice |

### Edited

- **MARXY-66** — Paths already widened (kept).
- **MARXY-77** — Paths: `docs/adr/0020-shell-boundary.md` → `docs/adr/0020-core-is-shell-free.md`.
  Amendment text in the description. Still todo.
- **MARXY-70** — description and a new criterion: re-derive parse CI baselines too.
- **MARXY-39** — dep retargeted to the view slice.

### Dependencies

| Edge | Why |
| --- | --- |
| `MARXY-79 → MARXY-81` | Auto-merge after the review order and the review WIP cap exist, not before. |
| `MARXY-86 → MARXY-35` | The index is what the palette queries. |
| `MARXY-87 → the model slice` | The view renders the model. |
| `MARXY-39 → the view slice` (was MARXY-36) | Taste review #2 needs a palette the reader can see. |

Lane note: the model slice shares `apps/desktop/src/…` as a prefix with MARXY-61
(`apps/desktop/src`). It waits until 61 leaves In Progress even though the files are
disjoint. That is `pathsOf` being coarse, not a missing dep.

No ADR file added. No scope cut. No taste-queue row from this pass (the view story will write
one when it lands).

## How we would know I was wrong

1. **The model slice still cannot get its tests into CI** because widening the desktop test
   glob pulls in unrelated `src/**/*.test.ts` files that are red. Then the glob should name
   `src/palette/*.test.ts` only.
2. **MARXY-61's prefix collision starves the model for a week.** Then `pathsOf` needs the
   MARXY-9 fix before the split pays off.
3. **Ubuntu parse spread after five jobs is still > 1.20×.** Then parse takes
   `baseline_waived` under the same rule as macos cold-start, and that is a measurement, not
   a wider tolerance.
