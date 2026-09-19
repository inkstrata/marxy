---
key: MARXY-119
design: [10-gates-and-testing]
depends: []
verify: [node --test orchestration/overlap.test.mjs, node --test orchestration/*.test.mjs]
---
# MARXY-119 — Make path overlap understand globs

**Depends on:** nothing · **ADRs:** none.

**Outcome.** Two stories are serialised exactly when they could touch the same file: a glob in one
story's paths overlaps what it can match in the other's, and a shared string prefix alone
(`parse` and `parser`) no longer counts.

## Files and signatures
- `orchestration/lib.mjs` — rewrite `overlap(a, b)` on top of `pathMatches`. Two paths overlap when
  either matches the other as a file-or-directory prefix, treating `*` as one segment in either.
  Delete the clause that compares first segments and string prefixes.
- `orchestration/overlap.test.mjs` — the four CSV cases plus the existing literal cases (equal paths,
  directory contains file).

## Tests → expected
| a | b | overlap |
| --- | --- | --- |
| `packages/*/package.json` | `packages/core/package.json` | true (both orders) |
| `packages/core/src/parse` | `packages/core/src/parser` | false |
| `packages/core` | `packages/*/src/x.ts` | true |
| `apps/desktop/src/palette/session.ts` | `apps/desktop/src/palette/search.ts` | false |
| `docs/adr` | `docs/adr/README.md` | true |

## Do not
Change `pathsOf`, `pathMatches`, `ready.mjs`, or any existing test. If an existing test fails, the
new `overlap` is wrong, not the test.
