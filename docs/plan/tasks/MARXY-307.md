---
key: MARXY-307
design: [10-gates-and-testing]
depends: []
verify: [pnpm precheck, pnpm done MARXY-307]
---
# MARXY-307 — Make check-boundaries catch a template-literal dynamic import()/require()

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · **Delta:** [2026-09-28-bugcatch-3](../deltas/2026-09-28-bugcatch-3.md) · **Depends on:** nothing.

**Outcome.** A forbidden dependency imported via a template-literal dynamic import() is caught by the module-boundary gate, not invisible to it.

## Why
The spec-extraction regex only matches quoted specs (`['"]`); a backtick spec like `import(\`@tauri-apps/api/core\`)` isn't matched, so it never reaches the forbidden-dependency checks that police ADR-0020's module boundaries.

## Files and signatures
- `scripts/check-boundaries.mjs`: match a template-literal spec with no interpolation alongside the quoted forms; a spec containing `${...}` can stay a documented, unresolvable limitation.

## Tests → expected
| Check | Expect |
| --- | --- |
| A fixture using a template-literal dynamic import of a forbidden dependency in a disallowed location | the gate flags it |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
