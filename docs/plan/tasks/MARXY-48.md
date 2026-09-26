---
key: MARXY-48
design: [09-app-shell, 03-selection-and-operations, 08-position-and-watching]
depends: [MARXY-42, MARXY-38, MARXY-23, MARXY-95, MARXY-198]
verify: [pnpm precheck, pnpm done MARXY-48]
---
# MARXY-48 — Outline and find at the reading position, mounted from the app's open path

**Design:** [09-app-shell](../../design/09-app-shell.md) §DOM skeleton, §Keyboard map, §Outline, §Find · [03-selection-and-operations](../../design/03-selection-and-operations.md) §The command registry (sections) · [08-position-and-watching](../../design/08-position-and-watching.md) §Computing the position · **Depends on:** MARXY-42 (registry), MARXY-38 (position), MARXY-23 (typesetter split records), MARXY-95 (harness), MARXY-198 · **ADRs:** ADR-0011, ADR-0018, ADR-0032 (perf recorded, not gated) · **Delta:** [2026-09-26](../deltas/2026-09-26.md) · **Sequencing:** `cross-phase`. `ready.mjs` holds it by path against MARXY-195, MARXY-196 and MARXY-44 (`app.ts`) while any of them is in progress. MARXY-244 waits for this story.

**Outcome.** `Mod+Shift+O` shows the headings and follows the reader as they scroll; `Enter` lands a section at the reading line. `Mod+F` finds text even across smart quotes and the typesetter's line breaks, and puts each match where the eye already is, even while the page is still being typeset.

**Split on 2026-09-26.** Attempt 1 (composer-2.5) wrote most of this, but its Paths did not include the three files the feature has to touch, so it mounted the overlays by polling and could not make the harness pass. The keyboard audit and `Mod+Shift+E` are now **MARXY-244**. Attempt 1's draft is in this story's worktree (uncommitted) and saved at the local ref `refs/wip/MARXY-48`. Read files from it with `git show refs/wip/MARXY-48:<path>`. Reuse `outline/`, `find/` and `commands/view.ts`. **Do not carry over** `commands/mount.ts` (polling), `commands/keys-wire.ts`, the `chordMatches` copy in `palette/keys.ts`, or the `commands/document.ts` hook. The files that belong to MARXY-244 are `commands/app.ts`, `src-tauri/**`, `shell/tauri.ts`, `palette/keys.ts`, `commands/registry.ts` and `test/keyboard.test.mjs`. Leave them out of this diff, because `check-story` fails anything outside Paths.

## Files and signatures
- `apps/desktop/src/outline/outline.ts` (pure): `outlineEntries(doc): { level, text, start }[]`, `currentEntry(entries, byteOffset)`. `outline/view.ts` owns `#marxy-outline`.
- `apps/desktop/src/find/text-index.ts` (pure), `find/query.ts` `compileQuery(q): RegExp`, `find/view.ts` owns `#marxy-find` and highlights.
- `apps/desktop/src/commands/view.ts`: `overlayCommands()` with `outline.open` (`Mod+Shift+O`), `find.open` (`Mod+F`), `find.next`, `find.previous`. Registered in `commands/index.ts`.
- `apps/desktop/src/app.ts`: two additions to `AppHandle`. `onDocument(listener: (doc: OpenDocument, article: HTMLElement) => void): () => void` is called after every open renders, including reloads and back/forward. `typesetDone(): Promise<void>` resolves when the current document's `TypesetController.done` resolves. Find lands through the existing anchor (`landOn`/`holdAnchor`) or re-lands its current match once `typesetDone()` resolves. It never runs a second scroll listener.
- `apps/desktop/src/main.ts`: `mountReadingOverlays(handle): { outline, find }`, called by `bootApplication` after the palette.
- `apps/desktop/src/harness/app-harness.ts`: calls the same `mountReadingOverlays` after `startApp`. `apps/desktop/app.html` gains `<dialog id="marxy-outline">` and `<div id="marxy-find" hidden>`, as in `index.html`.
- `apps/desktop/src/selection/bind.ts`: `keyMatches` compares a single-letter key case-insensitively (with Shift held, `event.key` is `"O"`). This is the only chord matcher; do not add a second.
- Overlay styles live beside their views, as the palette's do in `palette/view.ts`, using `--marxy-color-find` and `--marxy-color-find-current`. The current match is also told apart by an outline, never by colour alone (ADR-0033).

## Do this, in order
1. `keyMatches` case fix plus a unit test (`Mod+Shift+O` with `event.key === 'O'`).
2. `AppHandle.onDocument` and `typesetDone` in `app.ts`, then `mountReadingOverlays` in `main.ts` and the harness, and the hosts in `app.html`.
3. Outline model and tests: setext and ATX headings, inline markup flattened, front matter `title` first when there is no h1, and `currentEntry` at every heading boundary.
4. Outline view: dialog, keys, current mark following the §08 position sample while open, `Enter` selects the section (§03) and lands it at the reading line.
5. Text index built before typesetting and kept in sync by split records, with `.katex` excluded. Rebuild it from `onDocument`.
6. `compileQuery` with the §09 table. Attempt 1 escapes before substituting, so its `...` rule never matches; the `wait...` case must pass. Highlights use the Custom Highlight API with a `<mark>` fallback. Show the count, land at the reading line, and mark `find_first_match`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `query.test.ts` | `don't`→`don’t`; `"quoted"`→`“quoted”`; `a--b`→`a–b`; `wait...`→`wait…`; `a b`→`a` U+00A0 `b`; `a.b` does not match `axb` |
| `text-index.test.ts` | offsets map back to the right text node and offset after a simulated split |
| harness, `01-long-technical.md`, after `typesetDone()`: find a word the typesetter hyphenated across a line (pick it from the typeset DOM and hard-code it) | highlighted; rect top within ±2 px of 40 % of the viewport; count equals a count computed from the source |
| harness: start find before `typesetDone()`, then await it | current match still within ±2 px of the reading line |
| harness: delete `CSS.highlights` | `<mark class="marxy-find">` wrapping; all removed on `Esc`; article text unchanged |
| harness: outline open, scroll | current mark moves to the heading above the reading line |
| harness: keydown `Mod+Shift+O` (`key: 'O'`, `shiftKey: true`) / `Mod+F` | outline / find opens through `installCommandKeys` |
| `rg "setInterval\|MutationObserver" apps/desktop/src/outline apps/desktop/src/find apps/desktop/src/commands/view.ts` | no output |
| perf | `find_first_match` recorded in `results/perf.json` (< 50 ms is the concern, not a gate) |

## Acceptance → check
CSV 1 → outline scroll case. 2 → hyphenated-word case. 3 → find-before-typeset case. 4 → fallback case. 5 → `query.test.ts`, `text-index.test.ts`. 6 → keydown case. 7 → the `rg` line. 8 → perf record. 9 → `docs/taste-review/queue.md` row (outline dialog and find highlight, dark and light, one before/after pair) and `CHANGELOG.md`.

## Do not
Add a visible find bar or outline at rest. Search source bytes in Rendered mode. Poll, or observe the article for mutations, to decide when to mount. Add a second chord matcher. Add single-letter bindings. Touch `src-tauri`, `shell/tauri.ts` or `palette/keys.ts` (those belong to MARXY-244). Touch `packages/*/src/contracts/**`.
