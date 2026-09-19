---
key: MARXY-102
design: []
depends: [MARXY-9]
verify: [pnpm test, pnpm done MARXY-102]
---
# MARXY-102 — Treat in_review as occupying paths

**Depends on:** MARXY-9 · **ADRs:** none. Extends the ready rule MARXY-9 landed.

**Outcome.** `ready.mjs` will not offer a todo whose Paths overlap a story that is `in_review`. The orchestrator no longer has to refuse MARXY-8 / MARXY-80 / MARXY-100 by hand.

## Files and signatures
- `orchestration/ready.mjs` — `busy` is every story whose status is `in_progress` **or** `in_review`. `inProgress` in the JSON output stays `in_progress` only (do not rename the field).
- `orchestration/ready.test.mjs` — new file next to `lib.test.mjs`. Import `selectReady` the way `orchestration/test` does. `pnpm test` already runs `orchestration/*.test.mjs`.

Do not touch `orchestration/test`, `docs/sdlc.md`, `orchestration/README.md`, `package.json`, or the CSV.

## Do this, in order
1. Change the `busy` filter in `selectReady`.
2. Add the three named cases below.
3. CHANGELOG line under Unreleased.

## Tests → expected
| Check | Expect |
| --- | --- |
| A `in_review` on `package.json`; B todo on `package.json` | B in `blockedByPaths`, not in `ready` |
| A `in_review` on `docs/adr/README.md`; B todo on that file plus `orchestration/review-order.mjs` | B in `blockedByPaths` |
| A `blocked` on `apps/desktop/src/palette`; B todo on `apps/desktop/src/palette/session.ts` | B still `ready` (36 must not starve 86) |
| Same shape with A `escalate` or `done` | B still `ready` |
| `pnpm test` | `orchestration/ready.test.mjs` runs without editing `package.json` |

## Acceptance → check
CSV criteria 1–5. Criterion 3 is the one that keeps the palette split dispatchable after Phase 0 clears.

## Do not
Edit `orchestration/test` (80/81), `docs/sdlc.md` (80), `orchestration/README.md` (81), `package.json` (85), or `docs/plan/jira-issues.csv` (85). Treat `blocked` / `escalate` / `done` as occupying. Change `earlierPhaseOpen` so `in_review` keeps a phase open — Phase gating stays `todo` / `in_progress` only (MARXY-9). Re-open 36 or 59. Add `cross-phase` to 86/87.
