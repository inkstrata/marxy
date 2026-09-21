---
key: MARXY-174
design: []
depends: []
verify: [node scripts/check-deps.mjs, node scripts/check-cards.mjs, node --test orchestration/phases.test.mjs]
---
# MARXY-174 — land the 2026-09-21-after-127 plan delta on main

**Design:** none — board-only landing · **Depends on:** nothing.

**Outcome.** Carry `docs/plan/deltas/2026-09-21-after-127.md` and its CSV/deps/queue edits onto
`main` without touching product source or `orchestration/state.json`.

## What to land
- MARXY-41 Acceptance restated (matches `docs/plan/tasks/MARXY-41.md`).
- `deps.deps.MARXY-78` adds MARXY-96 (golden overlap while 96 is in flight).
- `docs/taste-review/queue.md` MARXY-87 row points at review-2 PNGs.

## Do not
Edit MARXY-41/46/47/96 implementor branches. Touch `orchestration/state.json`. Change any path
outside the CSV row's Paths list except CHANGELOG.md.

## Acceptance → check
Same numbered list as the CSV row for this key.
