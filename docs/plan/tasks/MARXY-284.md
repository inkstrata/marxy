---
key: MARXY-284
design: [05-theme]
depends: []
verify: [pnpm precheck, pnpm done MARXY-284]
---
# MARXY-284 — Reject a theme manifest with zero declared variants

**Design:** [05-theme](../../design/05-theme.md) · **Delta:** [2026-09-28-bugcatch](../deltas/2026-09-28-bugcatch.md) · **Depends on:** nothing.

**Outcome.** A theme.toml that declares `variants = []` fails validation with a clear warning instead of silently becoming a 'valid' zero-variant theme.

## Why
`loader.ts`'s variant validation is `Array.isArray(variantsRaw) && variantsRaw.every(...)`, which is vacuously `true` for an empty array, so `variants = []` in `theme.toml` produces `manifest.variants = []` with no warning. Any UI that assumes at least one variant exists (a variant picker, code indexing `variants[0]`) breaks on such a theme.

## Files and signatures
- `packages/theme/src/loader.ts`: reject an empty `variants` array with a warning naming the theme and file, the same way other malformed-manifest cases are reported.

## Tests → expected
| Check | Expect |
| --- | --- |
| A theme.toml with `variants = []` | loader.ts rejects it and reports the warning |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
