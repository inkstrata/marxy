---
key: MARXY-289
design: [07-index-and-palette]
depends: []
verify: [pnpm precheck, pnpm done MARXY-289]
---
# MARXY-289 — Fix or guard index-model relativePath's directory assumption

**Design:** [07-index-and-palette](../../design/07-index-and-palette.md) · **Delta:** [2026-09-28-bugcatch](../deltas/2026-09-28-bugcatch.md) · **Depends on:** nothing.

**Outcome.** relativePath never produces a wrong path because a file path was passed where a directory was assumed.

## Why
`relativePath` treats both its `from` and `to` arguments as directories, splitting on `/` and walking whole segments. If `from` is actually a file path (e.g. a document's own path rather than its `dirname`), the file's basename is treated as a path segment to walk 'up' through, producing a wrong relative path whenever the basename happens to match part of `to`'s structure. No test file exists for this module today.

## Files and signatures
- `packages/core/src/index-model/paths.ts`: confirm every call site passes a directory, or change the function to accept and correctly resolve a file path for `from`.

## Tests → expected
| Check | Expect |
| --- | --- |
| A directory `from`, and, if a file path is meant to be supported, a case where the file's basename could be mistaken for a path segment | packages/core/src/index-model/paths.test.ts (new file) covers both |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
