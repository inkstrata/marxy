---
key: MARXY-41
design: [03-selection-and-operations, 02-render, 01-buffer]
depends: [MARXY-75, MARXY-93, MARXY-95]
verify: [pnpm precheck, pnpm done MARXY-41]
---
# MARXY-41 — Selection model in Rendered mode resolving to byte ranges

**Design:** [03-selection-and-operations](../../design/03-selection-and-operations.md) §Selection model, §Resolution · [02-render](../../design/02-render.md) post-pass 1 (node map) · **Depends on:** MARXY-75 (provenance and `buildNodeMap`), MARXY-93, MARXY-95 · **ADRs:** ADR-0004, ADR-0023.

**Outcome.** A reader can click a block and see it marked on its left edge; the outline (later) can select a section; `Alt+↑/↓` walks blocks and `Alt+Shift+↑` goes to the parent; `Esc` clears. Every such selection knows its exact bytes. A dragged text selection stays a plain copy.

**Acceptance as re-stated by the design pass** (§03 "Why `text` never resolves"): the CSV's "span … selections resolve to ranges whose bytes match the selected text" is replaced by the property over node, section and document selections below. The delta records the CSV edit.

## Files and signatures
- `packages/core/src/sourcemap/section.ts` — `sectionRange(doc, heading): Source`, `nodeAt(doc, byte): Block | null`.
- `packages/core/src/sourcemap/index.ts`; export from `packages/core/src/index.ts`.
- `packages/core/src/sourcemap/section.test.ts` — corpus property (Node).
- `apps/desktop/src/selection/selection.ts` — the `Selection` union (§03), `select(state, sel)`, `moveSibling(sel, dir)`, `parentOf(sel)`.
- `apps/desktop/src/selection/resolve.ts` — `resolve(el, map)`.
- `apps/desktop/src/selection/view.ts` — click handling (§03 bullet 1 rules), `.marxy-selected` class, keys `Alt+↑/↓`, `Alt+Shift+↑`, `Esc` registered as commands in the registry **if MARXY-42 has landed it; otherwise** as a `keydown` listener in this file that MARXY-42 migrates (note it in "For the reviewer").
- `apps/desktop/test/selection.test.mjs` (Playwright, app harness).

## Do this, in order
1. `sectionRange` and `nodeAt` in core with the §03 definition; table tests: h2→h3→h3→h2, last section, h1 with nested h2s, setext headings, heading inside a blockquote (not top-level → section ends per top-level scan).
2. Corpus property (Node, no DOM): for every heading in every corpus file, `sectionRange` starts at the heading and every heading strictly inside the range has a greater level.
3. `resolve(el, map)`: `el.closest('[data-marxy-s]')`, key `"${s}-${e}"`, map lookup; `null` if absent.
4. Click rules and the class; one selection at a time; re-resolve by `range.start` after any re-render (a hook the render path calls).
5. Playwright property over the app harness for every corpus markdown file: for every `[data-marxy-s]` element, `resolve` returns the node with that `src`; `textOf(buffer, range)` does not throw; re-parsing the slice yields a first node of the same `type` (blocks) or a paragraph whose only child has that type (inlines — skip `taskMarker`, `footnoteReference`, `hardBreak`, `softBreak`, which cannot stand alone).

## Tests → expected
| Check | Expect |
| --- | --- |
| `section.test.ts` table + property | pass for all corpus files |
| `selection.test.mjs` click | clicking a paragraph adds `.marxy-selected` to that `<p>` only; clicking a link does **not** select (it follows — assert `openExternal` recorded); `Alt+click` on the link selects it |
| keys | `Alt+↓` moves to the next block sibling; `Alt+Shift+↑` from a list item selects the list; `Esc` clears |
| property | zero failures over the corpus; neutralise `resolve` to return the parent → the property fails |
| re-render | trigger a re-render with unchanged bytes; the same element is selected afterwards |

## Acceptance → check
1. Node, section and document selections resolve to ranges whose re-parse matches the node type → Playwright property.
2. Section ranges are correct → `section.test.ts`.
3. Selection survives re-render → `selection.test.mjs` re-render case.
4. A text drag never resolves → Playwright: drag across two paragraphs, `state.selection.kind === 'text'`.

## Do not
Resolve a DOM text selection to bytes. Read offsets from anything but `data-marxy-s`/`-e`. Add operations (MARXY-42/43). Paint a fill on the selected block.
