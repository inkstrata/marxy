---
key: MARXY-87
design: [07-index-and-palette, 09-app-shell]
depends: [MARXY-86]
verify: [pnpm precheck, pnpm done MARXY-87]
---
# MARXY-87 — Palette view mounted from main.ts

**Design:** [07-index-and-palette](../../design/07-index-and-palette.md) §Palette; [09-app-shell](../../design/09-app-shell.md) §DOM skeleton, §Keyboard · **Depends on:** MARXY-86 · **ADRs:** ADR-0011, ADR-0013.

**Outcome.** `Mod+P` summons `dialog#marxy-palette` in the real app document. There is no tab bar. A reader can see this, so the taste-review queue gets a row.

## Files and signatures
- `apps/desktop/src/palette/view.ts` — the `<dialog>` with input + list; the empty / typing / operations states (§07). No `MiniNode`.
- `apps/desktop/src/main.ts` — mounts the palette. Chrome at rest is still zero.
- `apps/desktop/index.html` — only if the skeleton needs `dialog#marxy-palette`.
- `apps/desktop/test` — the no-tab-bar assertion and the mount test, against the real document.
- `docs/taste-review/queue.md` — one row.

## Do this, in order
1. Mount from `main.ts`. Summon with `Mod+P`. Delete any `MiniNode` / `walk` / `splitSelectors` left from PR #30.
2. Assert ADR-0011 against `document` with the palette summoned: no `[role=tablist]`, `[role=tab]`, `.tab-bar`, `#marxy-tabs`. Prove the check by inserting a tab strip in a named mutation.
3. Empty query = pins then MRU; `Tab` toggles documents/headings; `Enter` on a heading lands it at the reading line (40 % of the viewport); `Mod+[` / `Mod+]` walk history.
4. Measure keystroke → rows painted, p95 < 16 ms on a 20k index at the reference tier (`results/perf.json` `palette_keystroke_ms`). This includes painting the list, not only `searchPrepared`.
5. Queue row. CHANGELOG line.

## Tests → expected
| Check | Expect |
| --- | --- |
| Boot `main.ts` / Playwright | `dialog#marxy-palette` present when summoned |
| Real `document` query | no tab-bar selectors; mutation inserting one fails the check |
| grep `apps/desktop/src` | no `MiniNode`, `walk`, `splitSelectors` |
| Headless session | p95 paint < 16 ms reference; pins then MRU; heading jump |
| `docs/taste-review/queue.md` | a row naming this PR |

## Acceptance → check
CSV criteria 1–7. Criterion 2 is the one that made MARXY-36's tab-bar test tautological; if the assertion still builds its own tree, the slice has failed.

## Do not
Ship `MiniNode`. Edit `apps/desktop/package.json` (the model slice owns the test glob). Edit `session.ts` / `search.ts` / `keys.ts`. Add a persistent tab bar under any name. Skip the queue row.
