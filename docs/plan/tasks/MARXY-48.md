---
key: MARXY-48
design: [09-app-shell, 03-selection-and-operations, 08-position-and-watching, 06-shell]
depends: [MARXY-42, MARXY-38, MARXY-23, MARXY-95, MARXY-198]
verify: [pnpm precheck, pnpm done MARXY-48]
---
# MARXY-48 — Outline, find at the reading position, keyboard completeness, open in external editor

**Design:** [09-app-shell](../../design/09-app-shell.md) §Outline, §Find, §Open in external editor, §Keyboard completeness · [03-selection-and-operations](../../design/03-selection-and-operations.md) §The command registry (sections) · [08-position-and-watching](../../design/08-position-and-watching.md) (reading line) · [06-shell](../../design/06-shell.md) `revealInExternalEditor` · **Depends on:** MARXY-42 (registry), MARXY-38 (position), MARXY-23 (typesetter split records, which find must stay in sync with), MARXY-95, MARXY-198 (changes `main.rs`'s command list, `shell/tauri.ts` and the palette; rebase on it) · **ADRs:** ADR-0011, ADR-0018. · **Sequencing:** labelled `cross-phase` (delta 2026-09-23). MARXY-193 and MARXY-194 have merged. `ready.mjs` still holds this story by path against MARXY-195 and MARXY-196 (`src-tauri/src`, `app.ts`) while either is in progress, and against MARXY-78's worktree until MARXY-220 lands.

**Outcome.** `Mod+Shift+O` shows the headings and follows the reader as they scroll; `Enter` lands a section at the reading line. `Mod+F` finds text even across smart quotes and the typesetter's line breaks and puts each match where the eye already is. Every action works from the keyboard, proven by a test over the command list. `Mod+Shift+E` opens the file in the reader's editor at the line they are reading.

This story is the largest in Phase 3. MARXY-191 removed the branch-size budget, so length does not split it. If a reviewer returns it, the next planner splits along the seam already in the files below: **48a** outline + find, **48b** keyboard audit + external editor. Do not split on the first attempt.

## Files and signatures
- 48a: `apps/desktop/src/outline/outline.ts` (pure: `outlineEntries(doc): { level, text, start }[]`, `currentEntry(entries, byteOffset)`), `outline/view.ts`; `apps/desktop/src/find/text-index.ts` (pure), `find/query.ts` (`compileQuery(q): RegExp`), `find/view.ts`; `commands/view.ts` entries `outline.open`, `find.open`, `find.next`, `find.previous`; tests `outline.test.ts`, `text-index.test.ts`, `query.test.ts`, `apps/desktop/test/outline-find.test.mjs`.
- 48b: `apps/desktop/src/commands/app.ts` entry `editor.reveal`; `apps/desktop/src/palette/keys.ts` → bind through the registry (§03 last paragraph); Rust `reveal_in_editor` in `commands/os.rs` (or `main.rs` if the split does not exist) with the `toml` crate; `src/shell/tauri.ts` `revealInExternalEditor`; `apps/desktop/test/keyboard.test.mjs`; the manual accessibility checklist in the PR body.

## Do this, in order
1. Outline model + tests (setext and ATX headings, inline markup flattened, frontmatter `title` first when no h1, `currentEntry` at every heading boundary).
2. Outline view: dialog, keys, current mark following scroll while open, `Enter` → select section (§03) and scroll its start to the reading line.
3. Text index before typesetting + split-record sync; `.katex` excluded.
4. `compileQuery` with the §09 substitution table; highlights (Custom Highlight API, `<mark>` fallback); count; reading-line landing; `find_first_match` mark.
5. Keyboard audit test over `commands()`; migrate `keys.ts`.
6. External editor (Rust + shell + command), no shell interpretation of the template.

## Tests → expected
| Check | Expect |
| --- | --- |
| `query.test.ts` | `don't` matches `don’t`; `"quoted"` matches `“quoted”`; `a--b` matches `a–b`; `wait...` matches `wait…`; `a b` matches `a` U+00A0 `b`; `a.b` does not match `axb` |
| `text-index.test.ts` | offsets map back to the right text node and offset after a simulated split |
| harness: in `01-long-technical.md` after typesetting, find a word the typesetter hyphenated across a line (pick it from the typeset DOM in the test and hard-code it) | a match highlighted; its rect top within ±2 px of 40 % of the viewport; `3 of 41`-style count correct against a count computed from the source |
| harness: delete `CSS.highlights` | `<mark class="marxy-find">` wrapping; all removed on `Esc`; article bytes/DOM text unchanged afterwards |
| harness: outline open, scroll | current mark moves to the heading above the reading line |
| `keyboard.test.mjs` | every command with a `key` runs from a synthetic event; every command appears in the palette when `when` holds; `Tab` order per §09; `Esc` returns focus to the article from every overlay |
| Rust: template `code --goto {file}:{line}` with a path containing a space and a `;` | argv is `["code", "--goto", "/a b;c.md:12"]`; no shell spawned |
| perf | `find_first_match` < 50 ms reference tier (recorded in `results/perf.json`) |

## Acceptance → check
CSV: outline tracks the current heading → outline scroll case; find highlights inside typeset paragraphs and lands at the reading position → find case; every action reachable without a pointer → `keyboard.test.mjs` + the checklist; external editor opens at the line → Rust argv test + harness call recorded with `line`.

## Do not
Add a visible find bar or outline at rest. Search the source bytes in Rendered mode. Run the editor template through `sh -c`. Add single-letter bindings.
