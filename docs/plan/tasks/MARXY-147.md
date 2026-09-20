---
key: MARXY-147
design: []
depends: [MARXY-91]
verify: [pnpm precheck, pnpm done MARXY-147]
---
# retire measure-parse's three-dot diff guard now that MARXY-59 is its sanctioned user

**Depends on:** MARXY-91 (done — wrote the guard) · **Reference:**
`docs/plan/deltas/2026-09-19-marxy-137-hang-check.md`, `orchestration/results/MARXY-59.json`.

**Outcome.** `scripts/measure-parse.mjs --selftest` stops failing every commit on MARXY-59's PR
#100 for touching the three files MARXY-59 exists to touch.

## Why this is a story
MARXY-91 (PR #79) added a guard to `--selftest`: `UNTOUCHED_PATHS`, `forbiddenInDiff` and
`threeDotNames()` read the live `origin/main...HEAD` diff and fail if it contains
`scripts/gate-perf.mjs`, `fixtures/perf-budgets.json` or `packages/core/src/parse/parse.test.ts`.
`.github/workflows/ci.yml:182` runs this step unconditionally, on every pull request, in the
`gates` job. The guard was right the day it was written — it stopped some other story from
touching the two-tier perf mechanism before `measure-parse.mjs` existed to feed it. It is wrong
now: MARXY-59's own `Paths` are exactly those three files, and PR #100 fails
`gates (macos-latest)` and `gates (ubuntu-latest)` on every commit with

```
selftest FAIL: diff: the three-dot range must not contain gate-perf, budgets, or parse.test.ts
  — scripts/gate-perf.mjs, fixtures/perf-budgets.json, packages/core/src/parse/parse.test.ts
```

MARXY-91 is done. The guard did its job (nothing landed early); it now permanently forbids the
one PR it was written to make possible. `scripts/` outside `measure-parse.mjs` is not in
MARXY-59's `Paths`, so the fix belongs here, not there.

## Files
- `scripts/measure-parse.mjs` only. Delete `UNTOUCHED_PATHS`, `forbiddenInDiff`, `threeDotNames`
  and the one `selftest()` block that calls them (the `report(planted..., SELFTEST_CASE_NAMES[8], ...)`
  case, around lines 236–243). Remove `SELFTEST_CASE_NAMES[8]`'s string from the array. Everything
  else — `FIXTURE_REL`, `SNAPSHOT_REL`, `SNAPSHOT_KEY`, `FORBIDDEN_WRITE_REL`, `WARMUP_N`,
  `RUNS_N`, `median`, `snapshotProblems`, `writeTargetProblems`, `checkWorkflow`, the other eight
  selftest cases, and the live measurement code below `if (isMain) { ... }` — is untouched.

## Do this, in order
1. Delete the constant, the two helper functions, and the selftest case and its `report(...)` call.
2. Remove the now-eighth string from `SELFTEST_CASE_NAMES` (it drops from 9 entries to 8).
3. `node scripts/measure-parse.mjs --selftest` — confirm it prints `measure-parse selftest ok: 8
   named cases` and exits 0, on this branch and again after rebasing MARXY-59's branch (or an
   equivalent diff) on top of it, to prove the guard no longer looks at the live diff at all.
4. `git diff origin/main -- scripts/measure-parse.mjs` — confirm the diff is exactly the deletion
   described above.

## Tests → expected
| Check | Expect |
| --- | --- |
| `node scripts/measure-parse.mjs --selftest` | `measure-parse selftest ok: 8 named cases`, exit 0 |
| the same command, run with MARXY-59's branch changes present | still exit 0 — the guard is gone, not satisfied |
| `git diff origin/main -- scripts/measure-parse.mjs` | only the guard's declarations, one selftest block and its call site removed |
| `.github/workflows/ci.yml` | byte-identical to `main` |

## Acceptance → check
1 is the deletion plus the `--selftest` proof against a diff that touches the three files; 2 is the
`git diff` scope check; 3 is the `ci.yml` byte-identity; 4 is the `CHANGELOG.md` line.

## Do not
Touch `.github/workflows/ci.yml` — the step already runs unconditionally. Touch
`scripts/gate-perf.mjs`, `fixtures/perf-budgets.json` or `packages/core/src/parse/parse.test.ts` —
those are MARXY-59's own files. Change any other exported name, selftest case, or the live
measurement path in `scripts/measure-parse.mjs`. Start MARXY-59's own work in this branch.
