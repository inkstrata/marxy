---
key: MARXY-306
design: [10-gates-and-testing]
depends: []
verify: [pnpm precheck, pnpm done MARXY-306]
---
# MARXY-306 — Make check-registry's innerHTML/outerHTML route regex catch compound assignment

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · **Delta:** [2026-09-28-bugcatch-3](../deltas/2026-09-28-bugcatch-3.md) · **Depends on:** nothing.

**Outcome.** A `+=` write to innerHTML/outerHTML outside an allowed route is caught by CI, not invisible to it.

## Why
`HTML_ROUTE_TABLE`'s regexes require `=` immediately after the property (`/\.innerHTML\s*=/`); `el.innerHTML += x` doesn't match, since `\s*` doesn't allow the literal `+`. Verified: `/\.innerHTML\s*=/.test("el.innerHTML += x;")` is `false`.

## Files and signatures
- `scripts/check-registry.mjs`: widen the route regex (or equivalent check) to also catch `+=` alongside `=`.

## Tests → expected
| Check | Expect |
| --- | --- |
| A fixture using `el.innerHTML += x` outside an allowed route | the gate flags it (and did not before the fix) |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
