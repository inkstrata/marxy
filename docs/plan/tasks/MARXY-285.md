---
key: MARXY-285
design: [06-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-285]
---
# MARXY-285 — De-duplicate the two hand-written stub Shell implementations (ADR)

**Design:** [06-shell](../../design/06-shell.md) · **ADRs:** ADR-0010 (shell-api is frozen), ADR-0026 (every addition after the v1 amendment needs its own ADR) · **Delta:** [2026-09-28-bugcatch](../deltas/2026-09-28-bugcatch.md) · **Depends on:** nothing.

**Outcome.** A new Shell member added to the frozen interface can no longer be forgotten in one of the two stub shells without the build failing.

## Why
`packages/shell-api/src/index.ts` is documented as a types-only interface package ('depends on: none'), but it contains two full runtime object literals — a memory/null shell and a test shell — each implementing every `Shell` member as a hand-written no-op stub, duplicated between the two. A future member added to one stub and forgotten in the other degrades silently instead of failing the way the file's own comment implies. `packages/shell-api/src/` is in `scripts/registry.json`'s `frozen` list, so this needs its own ADR-only PR that touches nothing else, as MARXY-94 and MARXY-268 did.

## Files and signatures
- `packages/shell-api/src/index.ts`: share one implementation between the two stub shells (a shared factory, or a single base object each extends) so a new `Shell` member needs updating in one place.
- `docs/adr/README.md`: one index row for the new ADR.

## Tests → expected
| Check | Expect |
| --- | --- |
| pnpm typecheck, pnpm test | green with no call-site edits outside packages/shell-api |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.

## Do not
- Implement anything outside packages/shell-api in this PR.
- Change the Shell interface itself — this is an internal-implementation refactor, not a contract change.
