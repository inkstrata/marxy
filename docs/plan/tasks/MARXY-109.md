---
key: MARXY-109
design: [12-outline]
depends: [MARXY-11, MARXY-111]
verify: [pnpm --filter @marxy/core test, pnpm done MARXY-109]
---
# MARXY-109 — Extract a document outline from the AST

**Design:** [12-outline](../../design/12-outline.md) · **Depends on:** MARXY-11 (done) ·
**ADRs:** ADR-0003 (provenance), ADR-0020 (shell-free).

**Outcome.** `outlineFrom(doc)` returns the heading list a later outline dialog
will render. No UI. No contract change.

## Files and signatures
- `packages/core/src/outline/outline.ts` — `outlineFrom(doc: Document): OutlineEntry[]`
- `packages/core/src/outline/outline.test.ts`
- `packages/core/src/index.ts` — export `outlineFrom`

Do **not** edit `packages/core/src/contracts/**`, `packages/core/package.json`,
`packages/core/scripts`, `packages/core/src/sanitize`, or `apps/desktop`.

## Do this, in order
1. Implement the walk and the visible-text flatten in §12.
2. Frontmatter `title:` prepend only when there is no h1.
3. Export from `index.ts`. Boundary test: no shell import.
4. CHANGELOG line under Unreleased.

## Tests → expected
| Check | Expect |
| --- | --- |
| `01-long-technical.md`, `09-gfm-everything.md` | one entry per AST heading; same order, level, `src` |
| `**bold**` / `` `code` `` in a heading | markers stripped |
| heading inside a blockquote | included, document order |
| frontmatter `title:` and no h1 | first entry is that title |
| frontmatter `title:` plus an h1 | title absent |
| empty / no headings | `[]` |
| import of `apps/desktop` or `packages/shell-api` | fails |

## Acceptance → check
CSV criteria 1–8. Criterion 8 is the boundary.

## Do not
Build the dialog (MARXY-47). Change the AST contract. Touch the sanitiser (Ian /
MARXY-75). Touch `packages/core/package.json` (MARXY-77). Add a YAML parser.
