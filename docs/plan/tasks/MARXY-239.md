---
key: MARXY-239
design: [09-app-shell, 04-typeset]
depends: []
verify: [pnpm precheck, pnpm done MARXY-239]
---
# MARXY-239 — Read code in Source with line numbers, folding, the file's tab width and visible control characters, and break long paths after a slash

**Design:** [09-app-shell](../../design/09-app-shell.md) · [04-typeset](../../design/04-typeset.md) · **Research:** [Reader Artifacts Handbook](../../research/reader-artifacts/10-spec.md) (ADR-0035) · **ADR:** [ADR-0036](../../adr/0036-artifact-units.md) · **Delta:** [2026-09-26-reader-artifacts](../deltas/2026-09-26-reader-artifacts.md) · **Depends on:** nothing.
**Handbook units closed by this story** (`docs/research/reader-artifacts/coverage.json`): `code.ligatures`, `code.tab-width`, `code.gutter`, `code.line-numbers-copy`, `code.slash-break`, `code.source-folding`, `code.ansi`, `op.jump-to-source`, `op.lenses`, `verify.taste`, `taste.slash-break`, `hs.console-and-ansi`, `hs.source-gutter`, `hs.slash-break-and-tabs`.

**Outcome.** A source file reads like a well-set listing: numbers to locate `file:42`, folds for long functions, the author's indentation, and nothing hidden. In Rendered mode, a long path wraps after a slash instead of mid-name.

## What is wrong today
`apps/desktop/src/source/editor.ts` receives `lineNumbers: false`. Handbook [04](../../research/reader-artifacts/04-code-typography.md).

## Files and signatures
- `apps/desktop/src/source/editor.ts` — gutter on for non-markdown, folding, `highlightSpecialChars`, ligatures off, tab size.
- `apps/desktop/src/source/editorconfig.ts` — new: pure parser for the few keys used.
- `apps/desktop/src/commands/` — `toggle-line-numbers` and `jump-to-source` palette commands.
- `packages/typeset/src/` — the third-pass slash break.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. Gutter and toggle.
2. Folding, special chars, ligatures.
3. Tab width.
4. Jump to source.
5. Slash break.
6. Queue row.

## Tests → expected
| Check | Expect |
| --- | --- |
| `.editorconfig` `tab_width = 2` | Source tab size 2 |
| `/usr/local/lib/very/long/path…` wider than measure | breaks after `/` |

## Acceptance → check
1. apps/desktop/test/source-gutter.test.mjs asserts a non-markdown file opens in Source with line numbers and a copy across lines contains none, in the app harness, and a palette toggle turns them off.
2. source-gutter.test.mjs asserts codeFolding is installed with a text placeholder, highlightSpecialChars is installed, and font-variant-ligatures is none in the editor content.
3. apps/desktop/test/tab-width.test.mjs asserts the tab width comes from .editorconfig tab_width, else numeric indent_size, bounded 1 to 8, default 4, read under the document's indexed root.
4. apps/desktop/test/jump-to-source.test.mjs asserts the palette command opens Source at the selected element's data-marxy-s byte.
5. packages/typeset/test/slash-break.test.ts asserts a path wider than the measure breaks after a slash only in a third pass, never at a hyphen, and a path that fits never breaks; the gate:aesthetics rag report's overfull count over the corpus does not rise.
6. gate:aesthetics chrome-at-rest green in Rendered mode.
7. CHANGELOG.md has an Unreleased line for this key.

## Taste
**Taste, without a stop.** Ship the handbook's default exactly as written above; do not ask the reviewer to choose between options, and do not pause for a look mid-story. Add **one** row to `docs/taste-review/queue.md` with the before/after artifact below and a confirm-or-tune question. The value is already decided by the research; the row lets the author tune it at the end-of-phase review (AGENTS.md "Verification").

- Artifact: `04-source.rs` in Source with and without the gutter; `18-agent-transcript.md` before/after the slash break.
- Question: Confirm or tune: gutter quiet; slash break reads right. (Defaults: muted numbers; break after `/` only when wider than the measure.)

## Do not
- Show line numbers in Rendered at rest.
- Persist folds.
- Edit `app.ts` (MARXY-195/196 hold it); register commands through `commands/`.
- Read files outside the indexed root.
- Touch `packages/*/src/contracts/**`.
