---
key: MARXY-231
design: [01-buffer, 03-selection-and-operations]
depends: [MARXY-230]
verify: [pnpm precheck, pnpm done MARXY-231]
---
# MARXY-231 — Every task item keeps its checkbox, section ranges respect nesting, and splice refuses a bad range

**Design:** [01-buffer](../../design/01-buffer.md) · [03-selection-and-operations](../../design/03-selection-and-operations.md) · **Research:** [Reader Artifacts Handbook](../../research/reader-artifacts/10-spec.md) (ADR-0035) · **ADR:** [ADR-0036](../../adr/0036-artifact-units.md) · **Delta:** [2026-09-26-reader-artifacts](../deltas/2026-09-26-reader-artifacts.md) · **Depends on:** MARXY-230.
**Handbook units closed by this story** (`docs/research/reader-artifacts/coverage.json`): `agent.task-items`, `op.toggle-task`, `verify.copy-fidelity`, `hs.task-marker-code-span`, `hs.fidelity-property`, `hs.nested-source-map`.

**Outcome.** Every checkbox in a plan can be ticked, including `- [ ] \`pnpm test\` passes`; copying a section never cuts its container in half; and an edit with a bad range fails loudly instead of corrupting the file.

## What is wrong today
Measured on 7e0a280 (handbook [02](../../research/reader-artifacts/02-agent-artifacts.md), [05](../../research/reader-artifacts/05-diffs-provenance.md)). MARXY-78 (blocked) owns the fidelity *gate* and the lone-CR corpus fixture; this story stays in core tests and does not touch `scripts/gate-fidelity.mjs` or fixtures 20-22.

## Files and signatures
- `packages/core/src/parse/from-mdast.ts` — find the marker from the list item's source bytes, not from the first text child.
- `packages/core/src/sourcemap/` — `sectionRange` walks to the heading's parent container; `nodeAt` descends into inline children including `taskMarker`.
- `packages/core/src/buffer/buffer.ts` — `splice` validates `0 ≤ start ≤ end ≤ length` and code-point boundaries; `eol` detects bare CR.
- `packages/core/src/operations/copy-section.ts` — refuse (return no clipboard) when the range is not a section.
- `fixtures/corpus/23-task-openers.md` — new: one task item per opener kind, checked and unchecked, plus a heading inside a blockquote.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. Fixture and failing parse test.
2. Marker fix; goldens.
3. Nested section range and nodeAt.
4. splice validation and bare CR.
5. Property extension with negative control.

## Tests → expected
| Check | Expect |
| --- | --- |
| `- [ ] \`code\` first` | taskMarker `[ ]` |
| `> ## H\n> body\n\nafter` | section of H ends before `after` |
| `splice(5, 2, "x")` | throws |
| `"a\rb"` | eol `cr`; replacing `b` keeps `\r` |

## Acceptance → check
1. packages/core/src/parse/parse.test.ts asserts a task item opening with a code span, strong, emphasis or a link yields a taskMarker node whose range holds exactly `[ ]` or `[x]`.
2. packages/core/src/sourcemap tests assert a nested heading's section ends at its container's end, copySection refuses a range that is not its section, and nodeAt reaches a taskMarker by byte offset.
3. packages/core/src/buffer tests assert inverted, out-of-range and mid-UTF-8-character splice ranges throw, and a bare-CR file reports eol cr and an edit preserves it.
4. operations.test.ts extends the mutation property to every corpus file including non-markdown and to every node kind an operation applies to, with a negative control that corrupts one byte and is caught.
5. pnpm gate:golden (with fixtures/corpus/23-task-openers.md) and pnpm gate:fidelity green.
6. CHANGELOG.md has an Unreleased line for this key.

## Taste
**Taste, without a stop.** Ship the handbook's default exactly as written above; do not ask the reviewer to choose between options, and do not pause for a look mid-story. Add **one** row to `docs/taste-review/queue.md` with the before/after artifact below and a confirm-or-tune question. The value is already decided by the research; the row lets the author tune it at the end-of-phase review (AGENTS.md "Verification").

- Artifact: `23-task-openers.md` rendered, dark, 960 px, before/after (checkboxes appear).
- Question: Do the recovered checkboxes sit like the others? (Default: identical to every other task item.)

## Do not
- Edit `scripts/gate-fidelity.mjs`, `fixtures/corpus/20-*`, `21-*`, `22-*` or `apps/desktop/src-tauri` (MARXY-78, MARXY-44).
- Touch `packages/core/src/contracts/**`.
- Touch `packages/*/src/contracts/**`.
