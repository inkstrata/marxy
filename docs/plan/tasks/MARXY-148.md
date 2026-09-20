---
key: MARXY-148
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-148]
---
# land the MARXY-137 hang-check widening and the parse diff-guard retirement on main

**Depends on:** nothing · **Reference:** `docs/plan/deltas/2026-09-19-marxy-137-hang-check.md`, and
MARXY-131, MARXY-135, MARXY-140, MARXY-144 and MARXY-146 for the same shape.

**Outcome.** The planner's board edits are on `main` in one commit that touches no source file, so
`scripts/check-story.mjs` — which reads `docs/plan/jira-issues.csv` from the working tree on the
implementor's branch — sees MARXY-137's further-widened paths and the new parse-diff-guard row.
Neither MARXY-137's attempt 3 nor the parse-diff-guard story starts until this lands.

## Why a story at all
No story may edit its own board row: an implementor that fixes its boundary by editing the
boundary check's input is indistinguishable from one that found its paths inconvenient (that is
why PR #87 was returned). The planner writes the edits into the working tree; a landing story
commits them. This pass bundles two unrelated triggers into one landing commit — rather than two —
because both edit `docs/plan/jira-issues.csv`, `orchestration/deps.json`, `orchestration/jira-map.json`
and `docs/plan/tasks`, and two landing stories dispatched in the same round would collide on the
overlap guard for no reason. MARXY-140 is precedent for bundling unrelated deltas into one landing
pull request.

## Files
- `docs/plan/jira-issues.csv` — MARXY-137's `Paths` gain `scripts/gate-aesthetics.mjs` and its
  criterion 4 is rewritten; one new row, the parse-diff-guard story.
- `orchestration/deps.json` — the parse-diff-guard key placed in the `ops` lane with no deps; this
  landing key placed in the `ops` lane with no deps; `MARXY-59` gains a dependency on the
  parse-diff-guard key. `MARXY-137`'s existing dependency on `MARXY-143` is untouched.
- `orchestration/jira-map.json` — the placeholder→key entry for the new parse-diff-guard key
  (`jira.mjs sync` writes this; carry it verbatim).
- `docs/plan/deltas/2026-09-19-marxy-137-hang-check.md` — the delta behind both changes.
- `docs/plan/tasks/` — the new `MARXY-147.md` card and the revised
  `MARXY-137.md`.

`node orchestration/jira.mjs sync` has already run, so the placeholder is already a real key in the
CSV, in `deps.json` and in `jira-map.json`. Carry what is in the working tree; do not re-slug or
renumber anything.

## Do this, in order
1. Branch `chore/MARXY-148-land-hang-check-and-parse-guard` off `main`.
2. Stage exactly the files above plus `CHANGELOG.md`. Check `git status` first: the tree carries
   unrelated edits under `orchestration/` belonging to other stories — leave every one alone.
3. `node --test --test-name-pattern 'the committed board' orchestration/phases.test.mjs`,
   `node scripts/check-deps.mjs`, `node scripts/check-story.mjs --strict`,
   `node orchestration/phases.test.mjs` whole-file.
4. Paste the boundary one-liner from criterion 5 and its output into the PR body.
5. `pnpm precheck`, then `pnpm done MARXY-148`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `node --test --test-name-pattern 'the committed board' orchestration/phases.test.mjs` | green, zero failures |
| `node orchestration/phases.test.mjs` (whole file) | green |
| `node scripts/check-deps.mjs` | green |
| `node scripts/check-story.mjs --strict` | green |
| the boundary one-liner | `allowedByPaths` true for `scripts/gate-aesthetics.mjs` under `MARXY-137` |
| the diff | nothing under `packages/`, `apps/`, `scripts/`, `.github/` or `fixtures/`; no change to `orchestration/state.json` or `orchestration/phases.test.mjs` |

## Acceptance → check
The row's nine criteria in order: 1 and 2 are the board files with the committed-board test and
`check-deps.mjs`, 3 is the cards with `check-story.mjs --strict`, 4 is `jira-map.json`, 5 is the
boundary one-liner, 6 and 7 are the diff, 8 is the whole-file phases run, 9 is `CHANGELOG.md`.

## Do not
Change a single acceptance criterion, path, label or dependency the planner wrote — if one is
wrong, say so in the PR and stop; the planner corrects it, not you. Add a row. Touch
`orchestration/state.json` (untracked by design) or `orchestration/phases.test.mjs`. Edit any file
under `packages/`, `apps/`, `scripts/` or `fixtures/`. Start MARXY-137's or the parse-diff-guard
story's work in this branch. Close, reopen or push to PR #104 or PR #100.
