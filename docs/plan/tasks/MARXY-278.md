---
key: MARXY-278
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-278]
---
# MARXY-278 — Land the 2026-09-27 parked plan delta

**Delta:** [2026-09-27-parked](../deltas/2026-09-27-parked.md)

**Outcome.** The board on `main` matches the work three blocked stories actually have to do, and
the two changelog conflicts are named rather than split.

## Files and signatures
- `docs/plan/deltas/2026-09-27-parked.md` — what changed, what was re-sequenced, tripwires, escalation risk.
- `docs/plan/jira-issues.csv` — MARXY-195 narrowed, MARXY-262 added, MARXY-49 and MARXY-239 widened.
- `orchestration/deps.json` — MARXY-262 in phase 2, depending on MARXY-195.
- `docs/taste-review/queue.md` — a row for MARXY-258, and one for MARXY-241's media-query blocks.

## Do not
Split MARXY-254 or MARXY-255. Split MARXY-48 again. File MARXY-276. Edit `packages/*/src/contracts/**`.
