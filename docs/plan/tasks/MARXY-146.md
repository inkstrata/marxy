---
key: MARXY-146
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-146]
---
# MARXY-146 — land the MARXY-129 token-test companion on main

**Depends on:** nothing · **Reference:** `docs/plan/deltas/2026-09-19-marxy-129-tokens-companion.md`,
and MARXY-131, MARXY-135, MARXY-140 and MARXY-144 for the same shape.

**Outcome.** The planner's board edits are on `main` in one commit that touches no source file, so
`scripts/check-story.mjs` — which reads `docs/plan/jira-issues.csv` from the working tree on the
implementor's branch — sees MARXY-145's new row and its `Paths`, and so that `ready.mjs`'s
    10|dependency edge from MARXY-129 to MARXY-145 survives the orchestrator's next `git fetch` +
`merge --ff-only origin/main` instead of sitting as an uncommitted, easily-lost working-tree edit.
Neither MARXY-145 can be dispatched, nor MARXY-129 re-dispatched, until this lands.

## Why a story at all
No story may edit its own board row: an implementor that fixes its boundary by editing the boundary
check's input is indistinguishable from one that found its paths inconvenient (that is why PR #87
was returned). The planner writes the edits into the working tree; a landing story commits them.

## Files
- `docs/plan/jira-issues.csv` — the new MARXY-145 row (the token-test companion) and the new
   20|MARXY-146 row (this one). MARXY-129's own row is untouched — the dependency lives only in
`orchestration/deps.json`.
- `orchestration/deps.json` — MARXY-145 and MARXY-146 placed in the `ops` lane (already done);
  MARXY-129 gains a dependency on MARXY-145 (already done).
- `orchestration/jira-map.json` — the two placeholder→key entries, already written by
  `jira.mjs sync` (`MARXY-NEW-tokens-test-live-values → MARXY-145`,
  `MARXY-NEW-land-129-tokens-companion → MARXY-146`).
- `docs/plan/deltas/2026-09-19-marxy-129-tokens-companion.md` — the delta behind both changes.
- `docs/plan/tasks/MARXY-145.md` and `docs/plan/tasks/MARXY-146.md` — this card and its sibling.

    30|`node orchestration/jira.mjs sync` has already run, so the placeholders are already real keys in
the CSV, in `deps.json` and in `jira-map.json`. Carry what is in the working tree; do not re-slug or
renumber anything.

## Do this, in order
1. Branch `chore/MARXY-146-land-the-129-tokens-companion-plan` off `main`.
2. Stage exactly the files above plus `CHANGELOG.md`. Check `git status` first: the tree carries
   unrelated edits belonging to other in-flight stories (several under `orchestration/`) — leave
   every one of them alone.
3. `node --test --test-name-pattern 'the committed board' orchestration/phases.test.mjs`,
   `node scripts/check-deps.mjs`, `node scripts/check-story.mjs --strict`,
    40|   `node orchestration/phases.test.mjs` whole-file.
4. `pnpm precheck`, then `pnpm done MARXY-146`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `node --test --test-name-pattern 'the committed board' orchestration/phases.test.mjs` | green, zero failures |
| `node orchestration/phases.test.mjs` (whole file) | green |
| `node scripts/check-deps.mjs` | green |
| `node scripts/check-story.mjs --strict` | green |
| the diff | nothing under `packages/`, `apps/`, `scripts/` or `fixtures/`; no change to `orchestration/state.json` or `orchestration/phases.test.mjs`; MARXY-129's own CSV row byte-identical |
    50|
## Acceptance → check
The row's eight criteria in order: 1 is the board files (the new row plus MARXY-129 unchanged) with
the committed-board test, 2 is `deps.json` and `check-deps.mjs`, 3 is the card with
`check-story.mjs --strict`, 4 is `jira-map.json`, 5 and 6 are the diff, 7 is the whole-file
`phases.test.mjs` run, 8 is `CHANGELOG.md`.

## Do not
Change a single acceptance criterion, path, label or dependency the planner wrote — if one is
wrong, say so in the PR and stop; the planner corrects it, not you. Add a row. Touch
`orchestration/state.json` (untracked by design) or `orchestration/phases.test.mjs`. Edit any file
    60|under `packages/`, `apps/`, `scripts/` or `fixtures/`. Start MARXY-145's work in this branch.
Touch, close, reopen or push to PR #107 (MARXY-129) — it stays `in_review` exactly as the reviewer
left it until MARXY-145 merges and it is restacked, with no product rework.
