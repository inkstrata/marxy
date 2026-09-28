---
key: MARXY-309
design: [10-gates-and-testing]
depends: []
verify: [pnpm precheck, pnpm done MARXY-309]
---
# MARXY-309 — Close two gaps in the memory-shell/dev-harness production-exclusion check

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · **Delta:** [2026-09-28-bugcatch-3](../deltas/2026-09-28-bugcatch-3.md) · **Depends on:** nothing.

**Outcome.** The check that production never bundles the memory shell/dev harness can't be silently bypassed by a dynamic import, or silently skipped on a pre-build CI run.

## Why
The static import walk only matches `from '...'` imports, missing a dynamic `import('./shell/memory.ts')`. The bundle-string backstop only runs `if (existsSync(distHtml))`, so a pre-build invocation of this gate skips both checks entirely.

## Files and signatures
- `scripts/gate-bundle.mjs`: match dynamic imports in the static walk too, and make sure every CI invocation of this gate (pre- and post-build) actually performs at least one of the two checks.

## Tests → expected
| Check | Expect |
| --- | --- |
| A dynamic import of the memory shell reachable from main.ts | the gate flags it |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
