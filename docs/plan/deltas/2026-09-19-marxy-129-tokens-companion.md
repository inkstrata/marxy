# Plan delta — 2026-09-19 (the token test hard-codes the value it was built to let move)

> Narrow, out-of-cadence planner pass covering one trigger. No product scope changes, no phase
> re-sequencing, no ADRs, no split of MARXY-129.
>
> MARXY-129 (PR #107, head `397c425`) returned on attempt 1 —
> `orchestration/results/MARXY-129.notes.md`.

## The trigger

MARXY-129 is the product tune ADR-0031 exists to allow: seven criteria met, values-only, taste
artifacts present, `node scripts/check-tokens.mjs` prints `tokens-contract ok (49 tokens)` on the
PR head. The reviewer returned it anyway, correctly, for a gate break entirely outside its own
    10|`Paths`: `scripts/check-tokens.test.mjs` — which belongs to MARXY-133/MARXY-139's contract check,
not to `packages/theme` — has two cases that hard-code the literal string
`--marxy-size-code: 14px;`:

- `re-kinded token is red` splices it to `14;` to prove a length-to-number change is caught.
- `value-only change is green` replaces the same literal with `15px;` to prove a values-only tune
  stays green — which is *exactly* the mutation MARXY-129 already made to the committed file.

After MARXY-129's `tokens.css` lands, `14px;` is no longer a substring of the real file, so both
`String.replace` calls are no-ops (`mutated === css`). `value-only change is green` still happens
to pass, vacuously. `re-kinded token is red` asserts on an empty `found` array and fails for real:
    20|`pnpm test` and CI's `fast` job go red on a tree with nothing wrong in it. Reproduced locally —
green on `main` (7/7), red on the PR head (1/7) with exactly the `ERR_ASSERTION` the notes describe.

MARXY-129's implementor reported `"packages/theme test": "ok"`, which only ever ran the theme
package's own suite, not the root `pnpm test` CI's `fast` job runs — so nothing caught this before
the PR opened, and nothing in MARXY-129's own `Paths` can fix it: `scripts/` belongs to a different
story by AGENTS.md's one-issue-one-owner rule.

### Decision: a companion story, not a MARXY-129 rework, not a split

MARXY-129's PR is signed on every acceptance criterion that is actually its own. Splitting it,
widening its `Paths` into `scripts/`, or asking it to touch the check that gates every future
    30|values-only tune would all cost more than the fix: the test needs to stop hard-coding a literal
value, which is a five-line change in a file MARXY-129 was never allowed to open.

**MARXY-145 — derive `check-tokens.test.mjs`'s mutation literals from the live `tokens.css`
instead of hard-coding them.** Paths: `scripts/check-tokens.test.mjs` only. It reads the current
`--marxy-size-code`/`--marxy-weight-heading` declarations out of the live `css` constant already
in the test file (`declarations(css)` or an equivalent lookup) and builds both mutations from
whatever is actually committed, so the file passes regardless of which value is currently tuned.
A new case asserts the test file's own source carries no literal `--marxy-size-code: 1[45]px;` or
`--marxy-weight-heading: (600|560);`, so this exact regression cannot recur silently. It does not
touch `scripts/check-tokens.mjs` (the checker) or `packages/theme/src/tokens.css` (MARXY-129's own
    40|file) — see `docs/plan/tasks/MARXY-145.md`.

**MARXY-129 is not re-dispatched, not split, and PR #107 is not closed.** It stays `in_review`
exactly as the reviewer left it until MARXY-145 merges, then is restacked and re-reviewed as it
stands — no product rework, since every note the reviewer raised beyond the gate break was
"what was fine."

## Sequencing

`scripts/check-story.mjs` reads the CSV from the working tree on the implementor's branch, and the
orchestrator's own `ready.mjs` re-derives its dependency graph from this checkout every cycle after
a `git fetch` + `merge --ff-only origin/main` — an uncommitted working-tree edit to `deps.json` is
    50|one bad fast-forward away from disappearing. So the new MARXY-145 row, and the dependency it puts
on MARXY-129, need to reach `main` in their own commit before MARXY-145 is dispatched and before
MARXY-129 is ever moved back to `todo`. That is a landing story's job, the same shape as MARXY-131,
MARXY-135, MARXY-140 and MARXY-144.

| Key | Change |
| --- | --- |
| **MARXY-146** | new, ops lane, no deps: commits this delta, the MARXY-145 row and its card. **Dispatch first.** |
| **MARXY-145** | new, ops lane, no deps: the token-test fix. Dispatch after MARXY-146 lands. |
| MARXY-129 | row unchanged (no `Paths`, `Description` or `Acceptance` edit); `deps.json` gains an
edge from MARXY-129 to MARXY-145. Stays `in_review` on PR #107 until MARXY-145 merges, then
    60|restacks and goes back to the reviewer. |

`node orchestration/ready.mjs` on this working tree already shows MARXY-145 `ready` (no deps, no
path collision with anything currently busy) and MARXY-146 `blockedByPaths` — it collides with
MARXY-126, an unrelated already-`todo` board-hygiene story that also touches
`docs/plan/jira-issues.csv` and `docs/plan/tasks`. That is the ordinary lane-contention the overlap
guard is for, not a fault in this delta; MARXY-146 dispatches in a later round once the contest
clears.

Nothing else moves. MARXY-133, MARXY-128 and MARXY-139 — MARXY-129's own dependencies — are
untouched, done, and stay done. MARXY-143 (in progress) and PR #95/#104 are untouched by this pass.

## Risks that moved
    70|
- **The token-contract check's own tests were themselves undertested against the mechanism ADR-0031
  exists to enable.** `check-tokens.test.mjs` proved the four failure modes correctly but proved
  the values-only pass with a fixture indistinguishable from the specific tune it was written
  against. The new literal-survives case in MARXY-145 is the general fix; the same audit is worth
  a glance the next time a gate script's *test* fixture, not the gate itself, is the thing
  hard-coding a value ADR-0031 says is taste.

## Escalation risk

- **MARXY-145.** Low risk — five-line change to one test file, mechanism already proven (three
  prior instances of the read-the-live-value pattern exist in the same file via `declarations`).
   80|The only way this escalates is if the live-read helper accidentally changes what `re-kinded
  token is red` actually exercises; the acceptance criteria pin both assertions' text so a
  reviewer can check that directly.
- **MARXY-146.** Board-only, small diff, fifth instance of the same shape. Low risk.

## How we would know I was wrong

1. **MARXY-145's fix touches `scripts/check-tokens.mjs` or `tokens.css` after all.** Then the test
   file cannot express the live-read on its own and the real gate needs a helper exported from the
   checker — a `Paths` widening, decided then, not guessed now.
2. **A second hard-coded-value test surfaces elsewhere in `scripts/` on the next taste tune.** Then
   90|   this is not a one-off and the audit above becomes its own story rather than a note.
