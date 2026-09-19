---
key: MARXY-121
design: [10-gates-and-testing]
depends: []
verify: [node --test orchestration/done.test.mjs, pnpm done MARXY-121 --open --dry-run]
---
# MARXY-121 — One command from green to In Review

**Depends on:** nothing · **ADRs:** none.

**Outcome.** The implementor fills one table, the criterion → check table in `results/KEY.pr.md`,
and runs `pnpm done KEY --open`. That copies the table into the result file, opens the PR through
`open-pr.mjs`, records the PR number and moves the Jira issue to In Review. A table row still
TODO stops everything and names the row.

## Files and signatures
- `scripts/done.mjs` — `export function acceptanceFromBody(md): { criterion, checkedBy }[]`; `--open` and `--dry-run` flags.
  Keep the rule that done never overwrites an existing result file's fields other than `acceptance` and `pr`.
- `scripts/open-pr.mjs` — export the function that opens the PR and returns its number, so done can call it with an injected `gh`.
- `orchestration/done.test.mjs` — fixture bodies; injected `gh` and `jira` runners that record calls.
- `orchestration/prompts/implementor.md` — step 7 becomes the one command.

## Tests → expected
| Case | Expect |
| --- | --- |
| filled table | result `acceptance` equals the table rows |
| one row `TODO` | exit 1, names the criterion, no `gh` call |
| `--open --dry-run` | prints open-pr, record, jira pr; zero calls |
| check-pr rejects the body | zero `gh` calls |

## Do not
Call `gh pr create` directly. Write `results/KEY.approved`. Touch `package.json`.
