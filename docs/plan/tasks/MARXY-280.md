---
key: MARXY-280
design: [04-typeset]
depends: []
verify: [pnpm precheck, pnpm done MARXY-280]
---
# MARXY-280 — Reset cached typeset font metrics on resize, not just on font/theme reload

**Design:** [04-typeset](../../design/04-typeset.md) · **Delta:** [2026-09-28-bugcatch](../deltas/2026-09-28-bugcatch.md) · **Depends on:** nothing.

**Outcome.** A resize that changes the actual computed font size (a fluid/responsive type scale) re-measures glue stretch and hyphen-glyph width instead of reusing stale, pre-resize metrics.

## Why
`FontSizes.of(el)` (`measure.ts`) caches `{key, size}` per-`Element` forever. `relayout(reason)` (`index.ts`) only calls `FontSizes.reset()` for `reason === 'fonts' || reason === 'theme'`, never for `'resize'`. A theme whose `--marxy-*` sizes use `clamp()`/viewport units changes the element's computed font size on a window resize without changing its identity, so the cached size (and everything derived from it: glue stretch in `items.ts`, ragged-fill stretch in `ragged.ts`, the hyphen-glyph width cache keyed by the stale `font.key`) is wrong until the next `'fonts'`/`'theme'` relayout.

## Files and signatures
- `packages/typeset/src/measure.ts`: either reset the cache on resize too, or key it on the current computed font size so a change invalidates the entry.
- `packages/typeset/src/index.ts`: `relayout('resize')` triggers whichever invalidation `measure.ts` implements.

## Tests → expected
| Check | Expect |
| --- | --- |
| A resize after a font-size change (simulated `clamp()`/viewport-unit style change) | glue stretch / hyphen-glyph width reflect the new size, not the cached one |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.

## Do not
- Reset the cache on every resize unconditionally if the font size did not actually change — that would defeat the point of caching.
