---
key: MARXY-318
design: [03-selection-and-operations, 01-buffer]
depends: []
verify: [pnpm precheck, pnpm done MARXY-318]
---
# MARXY-318 — Land the 2026-09-28 links and copy delta

**Design:** [03-selection-and-operations](../../design/03-selection-and-operations.md) · [01-buffer](../../design/01-buffer.md) · **Delta:** [2026-09-28-links-copy](../deltas/2026-09-28-links-copy.md) · **Depends on:** nothing.

**Outcome.** The board on main lets the copy story update the test that still appends a newline, and lets the links and save stories keep the files their branches already edit.

## Files and signatures
- `docs/plan/deltas/2026-09-28-links-copy.md` — the rulings.
- `docs/plan/jira-issues.csv` — path widens for MARXY-230, MARXY-240 and MARXY-49, and MARXY-230 acceptance criterion 6.
- `docs/design/03-selection-and-operations.md` — copy-code-clean copies `node.value` and does not append a newline.
- `docs/design/01-buffer.md` — save and close live beside `title.ts`, and call `onCloseRequested` and `confirmClose`.
- `docs/plan/tasks/MARXY-230.md` — the desktop assertion.
- `docs/plan/tasks/MARXY-240.md` — the five ripple files, and drop the CSV hunk.
- `docs/plan/tasks/MARXY-49.md` — restore `RunEvent`, keep the shell members.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. The delta.
2. The row edits.
3. The design sentences.
4. The cards the in-review stories will read.
5. `node scripts/check-cards.mjs`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `node scripts/check-cards.mjs` | exits 0 |
| MARXY-230 Paths | include `apps/desktop/test/operations-copy.test.mjs` |
| design 03, copy-code-clean | copies `node.value` and does not append a newline |

## Acceptance → check
The CSV row's six checks.

## Do not
Implement product code. Split a story whose branch already contains the change. Touch `packages/*/src/contracts/**`. Edit `orchestration/deps.json` in this pass: the dependency edges from MARXY-313 still hold.
