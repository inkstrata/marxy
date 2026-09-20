---
key: MARXY-79
design: []
depends: [MARXY-81, MARXY-111]
verify: [node --test orchestration/prompt-handshake.test.mjs, pnpm done MARXY-79]
---
# MARXY-79 — Reviewer prompt writes the approval file (prompt slice)

**Depends on:** MARXY-81 (done) · **ADRs:** ADR-0025 (review order already on `main`).

**Outcome.** The reviewer prompt tells the reviewer to write and sign
`orchestration/results/KEY.approved`. The implementor prompt forbids writing that
file. `docs/sdlc.md` says the same. Cycle and approve stay with MARXY-106.

After-8 replan 2026-09-19: Paths dropped `cycle.mjs`, `approve.mjs`, and
`package.json` so this row no longer collides with 106 or 65.

## Files and signatures
- `orchestration/prompts/reviewer.md` — on a merge verdict: write
  `orchestration/results/KEY.approved`, run `node orchestration/approve.mjs KEY`,
  do not `gh pr merge`
- `orchestration/prompts/implementor.md` — forbids writing `KEY.approved`
- `orchestration/prompt-handshake.test.mjs` — reads those two files; fails if
  any of the three obligations is absent
- `docs/sdlc.md` — one sentence: reviewer writes and signs; implementor never writes

`CHANGELOG.md` is an implicit extra.

## Do this, in order
1. Add the three obligations to the two prompts.
2. Write the test that reads the prompt files as text.
3. Mirror the rule in `docs/sdlc.md`.
4. CHANGELOG line under Unreleased.

## Tests → expected
| Check | Expect |
| --- | --- |
| reviewer.md missing `results/KEY.approved` or `approve.mjs` | test fails |
| reviewer.md names `gh pr merge` as something the reviewer should run | test fails |
| implementor.md missing a forbid on `KEY.approved` | test fails |
| both prompts as specified | test passes |

## Acceptance → check
CSV criteria 1–6. Criterion 6 is the boundary: no `cycle.mjs` / `approve.mjs` /
`merge-bar.mjs` / `package.json` in the three-dot diff.

## Do not
Edit `orchestration/cycle.mjs`, `approve.mjs`, `merge-bar.mjs`, or `package.json`.
Reopen a discarded PR. Implement auto-merge (MARXY-106). Review your own implementation.
