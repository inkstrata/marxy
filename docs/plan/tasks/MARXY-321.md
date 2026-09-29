---
key: MARXY-321
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-321]
---
# MARXY-321 — Land the 2026-09-29 plan delta

**Delta:** [2026-09-29](../deltas/2026-09-29.md) · **Depends on:** nothing.

**Outcome.** The next attempt on the hidden-character story and the Cargo-table story rebases onto main, and the key-cap hyphen is queued for taste review.

## Files and signatures
- `docs/plan/deltas/2026-09-29.md` — the rulings.
- `docs/plan/tasks/MARXY-236.md` — rebase; take main's `fs.rs`; keep markers and unsmartered code-like HTML.
- `docs/plan/tasks/MARXY-308.md` — rebase; do not edit `fs.rs`.
- `docs/plan/tasks/MARXY-240.md` — keep heading ids and MARXY-230's unsmartered text when the goldens conflict.
- `docs/taste-review/queue.md` — one row for MARXY-230.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. The delta.
2. The three cards.
3. The queue row.
4. `node scripts/check-cards.mjs`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `node scripts/check-cards.mjs` | exits 0 |
| `docs/plan/tasks/MARXY-236.md` | tells the attempt not to edit `apps/desktop/src-tauri/src/commands/fs.rs` |
| `docs/taste-review/queue.md` | has a row whose story cell is MARXY-230 |

## Acceptance → check
The CSV row's four checks.

## Do not
Implement product code. Split MARXY-236 or MARXY-308. Touch `packages/*/src/contracts/**`. Widen any other story's Paths.
