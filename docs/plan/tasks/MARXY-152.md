---
key: MARXY-152
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-152]
---
# land the MARXY-138 path widening on main

**Depends on:** nothing · **Reference:** `docs/plan/deltas/2026-09-20-marxy-138-paths.md`, and
MARXY-131, MARXY-135, MARXY-140, MARXY-144, MARXY-146 and MARXY-148 for the same shape.

**Outcome.** The planner's board edits are on `main` in one commit that touches no source file, so
`scripts/check-story.mjs` — which reads `docs/plan/jira-issues.csv` from the working tree on the
implementor's branch — sees MARXY-138's widened `Paths` cell. PR #115 attempt 2 does not start (or
does not land) until this is on `main`.

## Why a story at all
No story may edit its own board row: an implementor that fixes its boundary by editing the boundary
check's own input is indistinguishable from one that found its paths inconvenient — which is exactly
what PR #115 attempt 1 did (`orchestration/results/MARXY-138.notes.md`, review verdict `return`). The
planner writes the edit into the working tree; a landing story commits it. This pass carries one
change only — MARXY-138's `Paths` cell — because MARXY-149 is in flight on an unrelated branch and no
other row needs a board edit this pass.

## Files
- `docs/plan/jira-issues.csv` — MARXY-138's `Paths` cell gains `scripts/allowlists/crate-licences.json`,
  `scripts/gate-fidelity.mjs`, `packages/core/goldens`, `packages/core/src/buffer/buffer.test.ts` and
  `packages/core/src/buffer/splice.property.test.ts`; its `Description` cell gains one sentence
  recording why and pointing at this landing story. **MARXY-138's `Paths` cell must not contain
  `docs/plan/jira-issues.csv`** — that is the exact defect this story exists to fix.
- `orchestration/deps.json` — this landing key placed in the `ops` lane with no deps. MARXY-138's own
  dependency list (`MARXY-26`, `MARXY-25`, `MARXY-95`, `MARXY-137`) is untouched.
- `orchestration/jira-map.json` — the placeholder→key entry for this landing key (`jira.mjs sync`
  writes this; carry it verbatim).
- `docs/plan/deltas/2026-09-20-marxy-138-paths.md` — the delta behind the change.
- `docs/plan/tasks/MARXY-138.md` — the revised card naming the five widened paths, the AC11 wording
  restatement, and the new "do not edit the CSV" line.

`node orchestration/jira.mjs sync` has already run, so the placeholder is already a real key in the
CSV, in `deps.json`, in `jira-map.json` and in this card's own filename. Carry what is in the working
tree; do not re-slug or renumber anything.

## Do this, in order
1. Branch `chore/MARXY-152-land-138-paths` off `main`.
2. Stage exactly the files above plus `CHANGELOG.md`. Check `git status` first: the tree carries
   unrelated edits under `orchestration/` belonging to other stories — leave every one alone.
3. `node --test --test-name-pattern 'the committed board' orchestration/phases.test.mjs`,
   `node scripts/check-deps.mjs`, `node scripts/check-story.mjs --strict`,
   `node orchestration/phases.test.mjs` whole-file.
4. Paste the boundary one-liner from criterion 5 and its output into the PR body.
5. `pnpm precheck`, then `pnpm done MARXY-152`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `node --test --test-name-pattern 'the committed board' orchestration/phases.test.mjs` | green, zero failures |
| `node orchestration/phases.test.mjs` (whole file) | green |
| `node scripts/check-deps.mjs` | green |
| `node scripts/check-story.mjs --strict` | green |
| the boundary one-liner | `allowedByPaths` true for `scripts/gate-fidelity.mjs`, `scripts/allowlists/crate-licences.json`, `packages/core/goldens`, `packages/core/src/buffer/buffer.test.ts` and `packages/core/src/buffer/splice.property.test.ts` under `MARXY-138` |
| MARXY-138's `Paths` cell | does not contain `docs/plan/jira-issues.csv` |
| the diff | nothing under `packages/`, `apps/`, `scripts/`, `.github/` or `fixtures/`; no change to `orchestration/state.json` or `orchestration/phases.test.mjs` |

## Acceptance → check
The row's nine criteria in order: 1 is the CSV cell and the CSV-self-reference check, 2 is `deps.json`
and `check-deps.mjs`, 3 is the card and `check-story.mjs --strict`, 4 is `jira-map.json`, 5 is the
boundary one-liner, 6 and 7 are the diff, 8 is the whole-file phases run, 9 is `CHANGELOG.md`.

## Do not
Change a single acceptance criterion, path, label or dependency the planner wrote — if one is wrong,
say so in the PR and stop; the planner corrects it, not you. Add a row. Touch
`orchestration/state.json` (untracked by design) or `orchestration/phases.test.mjs`. Edit any file
under `packages/`, `apps/`, `scripts/` or `fixtures/`. Start MARXY-138's own work in this branch.
Close, reopen or push to PR #115.
