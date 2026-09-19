---
key: MARXY-104
design: []
depends: []
verify: [pnpm test, node scripts/check-pr.mjs]
---
# MARXY-104 — Refuse a PR whose body is missing the house template

**Depends on:** none · **ADRs:** none. Extends the PR checker MARXY-74 landed.

**Outcome.** A Cursor-style PR body cannot be published. `open-pr.mjs` is the only create path; `check-pr` fails the other body mistakes reviewers keep catching (attribution, leftover TODO, foreign headings).

## Files and signatures
- `scripts/check-pr.mjs` — export `lintPrBody`, `lintPrRange`, `checkPr`. House sections stay required. New: foreign H2s (`## Test plan`, `## Why`, `## Acceptance`), `ATTRIBUTION_RE`, Checked-by may not be `TODO` or empty.
- `scripts/open-pr.mjs` — export `planOpenPr`. `argv` is null when `lintPrBody` fails; otherwise `gh pr create --title … --body-file`. Never `--body`.
- `scripts/done.mjs` — print leftover `lintPrBody` problems; next step is `node scripts/open-pr.mjs KEY`.
- `orchestration/pr-body.test.mjs` — the named cases below. `pnpm test` already runs `orchestration/*.test.mjs`.
- `docs/hygiene.md`, `orchestration/prompts/implementor.md` — the create path is `open-pr.mjs`.
- `docs/plan/jira-issues.csv` — this row.

Do not edit `package.json` (85/90), `.github/workflows/ci.yml` (62/90), or `orchestration/review.mjs` (81).

## Do this, in order
1. Export the body linter and add the three new failure classes.
2. Add `open-pr.mjs` so `gh` is unreachable on a failing body.
3. Point `done` / hygiene / the implementor prompt at it.
4. CHANGELOG line under Unreleased.

## Tests → expected
| Check | Expect |
| --- | --- |
| Cursor-style body | `lintPrBody` names missing house sections, foreign headings, and a `fix:` line for the template |
| `Made with Cursor` on a house body | attribution failure |
| `| criterion \| TODO |` | Checked by unfilled |
| House body with filled table | `[]` |
| `planOpenPr` on Cursor body | `argv === null` |
| `node scripts/check-pr.mjs` on stdin Cursor body | exit 1 |

## Acceptance → check
CSV criteria 1–6, all in `orchestration/pr-body.test.mjs`.

## Do not
Edit `package.json`, the CI workflow, or `review.mjs`. Call `gh pr create` from a test. Treat a filled house body as a failure.
