---
key: MARXY-295
design: [03-selection-and-operations]
depends: []
verify: [pnpm precheck, pnpm done MARXY-295]
---
# MARXY-295 — Fix sectionRange for a heading nested inside a blockquote or list

**Design:** [03-selection-and-operations](../../design/03-selection-and-operations.md) · **Delta:** [2026-09-28-bugcatch-2](../deltas/2026-09-28-bugcatch-2.md) · **Depends on:** nothing.

**Outcome.** Copying/selecting a section for a heading nested inside a blockquote or list stops at the end of that enclosing block, not at the next top-level heading past it.

## Why
`sectionRange` (`sourcemap/section.ts`) walks only `doc.children` (top-level blocks) to find the heading's terminating boundary. `outline.ts`'s `headingsOf` recurses into any descendant (including headings nested inside blockquotes/lists) and `copySection`'s `canApply` accepts any `node.type === 'heading'`. For a nested heading, the loop skips the enclosing top-level block (its start is before the heading's start) and matches the next *top-level* heading of equal or higher rank, so the computed range swallows unrelated top-level content between the enclosing block and that next heading.

## Files and signatures
- `packages/core/src/sourcemap/section.ts`: walk into a heading's ancestor chain to find its true enclosing scope (the nearest container that is itself a section boundary), rather than assuming every heading is a direct child of `doc`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `> ## Inner\n> body\n\nParagraph after blockquote.\n\n## Outer\nmore\n`, section for `## Inner` | the range stays inside the blockquote, not extending through "Paragraph after blockquote." |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
