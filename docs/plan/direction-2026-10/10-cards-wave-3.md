# Cards: the direction's third wave

**Date:** 2026-10-10 · **For:** the implementors the lead dispatches beside Phase D · **Read with:**
[07-cards-wave-1.md](07-cards-wave-1.md) (the shared rules, which apply here unchanged),
[09-cards-wave-2.md](09-cards-wave-2.md), [05-plan.md](05-plan.md), [06-reconciliation.md](06-reconciliation.md)

**In short.** Five cards that wave 2's merges unblocked: the Night and Paper defaults (H-04), the
measured character width (H-06), the kind scope and the first three profiles (K-05), the workspace
shell (W-02) and structural selection in Source (V-01). `05-plan.md` marks H-04, H-06, K-05 and W-02
Opus, because each changes a seam; each says **Try Sonnet first** (author, 2026-10-10: be
cost-effective), and the lead escalates only on a return. Phase E's E-01 (the transform helpers and test
kit, `roadmap-2026-10/05-phase-e.md`) already has its card, so it is not carded again; **J-03 still waits
on it** (see [09](09-cards-wave-2.md#j-03--the-transform-library-in-core)) and E-01 is not started.

State of what these wait on, as of 2026-10-10 evening: **merged**: H-01 (#490), H-02 (#506), H-03 (#515),
K-01 (#500), K-03 (#510), K-04 (#517), K-06 (#518), K-18 (#520), D-11 (#496), D-13 (#497). **Open**: W-01 (#513,
reviewed, merge pending), H-03.1 (#523), B-24 (#521). **Not started**: D-14 (and D-09, D-10, D-12), E-01.

| Card | Model | Size | Depends on | Ready |
| --- | --- | --- | --- | --- |
| H-04 | opus (Sonnet first) | M | H-02, H-03 merged | now |
| H-06 | opus (Sonnet first) | M | H-03 merged | now |
| K-05 | opus (Sonnet first) | M | H-03, K-03, K-04, K-06, K-18 merged; H-04 not merged | after H-04 |
| W-02 | opus (Sonnet first) | L | W-01 #513 open; H-03 merged; **D-14 not started** | after W-01 and D-14 |
| V-01 | sonnet | M | D-11 merged | now |

---

### H-04 — Night and Paper become the default theme; Ink gets its own directory

**Model:** opus · **Size:** M · **Depends on:** H-02, H-03 (both merged) · **Parallel with:** H-06, V-01
**Try Sonnet first** (author, 2026-10-10: be cost-effective); escalate if a value cannot pass the gate without a new role.

**Outcome.** The default theme sets every contract-2 role: **Night** (dark, true black, body weight 370) and **Paper** (light, 400). Today's dark moves to `packages/theme/ink/` as a theme of its own. The default type set (Literata for books, Source Serif 4 for articles, Atkinson Hyperlegible Next and Inter as sans, JetBrains Mono) is bundled with a licence line per face. A before-and-after artifact is the author's taste review.

**Why now.** H-05, K-05, K-16 and K-19 need real values; W-04 needs a real surface and shadow. The ADRs reserved names (0059) and the gate exists (H-02); this story supplies the values, which are taste (ADR-0031).

**Paths.**
- Edit: `packages/theme/default/theme.css` (every role in `:root` and the light variant; today only light is here and dark lives in `tokens.css`), `packages/theme/default/theme.toml` (`contract = 2`), `apps/desktop/src/fonts/fonts.css` and `files.mjs`, `fonts/README.md`, `docs/design/05-theme.md` §Palettes, `docs/theme-contract.md`, `packages/theme/test/palettes.json` and `palettes.test.mjs` (they read the default theme's colours).
- New: `packages/theme/ink/theme.css` and `theme.toml` (today's `tokens.css` dark values and the light block, `contract = 2`), `fonts/atkinson-hyperlegible-next/` and `fonts/inter/` (the font files and their `LICENSE`, unmodified).
- Read: ADR-0059 items 2, 3, 5, 6 and 10; `mock-v2/shared/tokens.css` and `07-themes.md` (the values); `scripts/gate-contrast.mjs`, `gate-licences.mjs`, `gate-bundle.mjs`, `gate-font-attrs.mjs`; ADR-0006, ADR-0015.

**Build order.**
1. Take Night, Paper and Ink values from the mock's `tokens.css`, not from memory. If `#151412` matches none (03 calls it `warm`'s reference), keep it as Ink's ground and say so in the PR.
2. Ink: copy today's resolved values into `ink/`; `gate:contrast` walks it by directory with no new code.
3. Night and Paper: set all 27 roles per variant; `gate:contrast` must report "0 not yet declared" for `default` and `ink`.
4. Fonts: add each face with its licence, one `@font-face` each (`font-display: block`, only the roman preloaded), each licence listed in `fonts/README.md`.
5. The face roles point at the faces (ADR-0059 item 5). The measure moves with the face: set `--marxy-avg-char` per face from H-06's number if it has landed, else leave 0.463 and say so.
6. `changelog.d/H-04.md`, `docs/taste-review/queue.d/H-04.md`, the before-and-after artifact.

**Acceptance.**
- `pnpm gate:contrast` over `default` and `ink`: zero failing pairs and zero undeclared roles (it fails on today's `text-secondary` #8a867f, 3.41:1, so a value that reuses it fails).
- A theme-less launch renders Night; `variant = "light"` renders Paper; `theme =` pointing at `packages/theme/ink` renders Ink.
- `gate:licences`, `gate:bundle` (the bundle's growth is named in the PR) and `gate-font-attrs` pass; every vendored face has a `LICENSE` byte for byte from upstream.
- `loader.test.ts` and `palettes.test.mjs` pass with the new defaults; a contract-1 fixture theme still renders as before.

**Tests.** `packages/theme/src/loader.test.ts`, `palettes.test.mjs`, `apps/desktop/test/fonts.test.mjs`. Gates: `pnpm check`, `gate:contrast`, `gate:licences`, `gate:bundle`, `gate:aesthetics` (its baselines change; list them).

**Do not.** Add a role (ADR-0059's list is closed; a needed one is a return); edit `tokens.css` fallbacks; edit a font file; set `data-marxy-kind` (K-05); ship `warm`, `fjord`, `high-contrast` (H-05); build the theme page (K-16).

**Risks.** Taste: the author judges Night and Paper in the app; the PR waits for that. Font weight: Night's 370 needs a variable face; a static face cannot be tuned (`fonts/README.md`). A face with no OFL text is not bundled.

---

### H-06 — Measure the average character width per face and size, in the app

**Model:** opus · **Size:** M · **Depends on:** H-03 (merged) · **Parallel with:** H-04, V-01
**Try Sonnet first** (author, 2026-10-10: be cost-effective); escalate if the measurement needs more than a canvas and the loaded face.

**Outcome.** The app can say a face's average character advance, in em, at a size, from the face it actually loaded, so a type-set change (H-04's faces, K-15's panel) keeps the character count of the measure instead of widening it. ADR-0033 item 1: "a theme that changes the text face must set `--marxy-avg-char` for it"; this story is the instrument, not a new token.

**Why now.** H-04 ships four text faces and one default number (0.463, Literata); K-15 and K-21 wait on this. A wrong number makes a 66-character column 60 or 72 characters wide, silently.

**Paths.**
- New: `apps/desktop/src/theme/measure-face.ts` and `measure-face.test.mjs` (a fixed English sample, `document.fonts.load` then a canvas `measureText`, memoised per face and size), `packages/core/src/layout/average-advance.ts` and its test (the pure mean over a sample's advances).
- Edit: `packages/theme/src/loader.ts` (a warning when a theme's declared `--marxy-avg-char` is more than 3 % from the measured value for its face; never a rewrite), `docs/theme-contract.md` (how to measure), `docs/design/04-typeset.md` if it names the number.
- Read: `packages/typeset/scripts/font-metrics.mjs` (advances from `hmtx`, no kerning: the build-time cross-check), `packages/core/src/layout/geometry.ts` (reads `avgChar`), `pane/divider.ts:20`, `rendered-view.ts:793-808` (the font-loading hooks), ADR-0033, ADR-0059 item 7.

**Build order.**
1. The pure mean and the sample (English prose letters, spaces and punctuation by frequency, recorded in the file with its source).
2. The in-app measurement for a face and size, after the face loads; never on the first-text path (commitment 5).
3. The cross-check: for each bundled face, the measured value is within 1 % of `font-metrics.mjs`.
4. The loader warning for a declared value far from the measured one.

**Acceptance.**
- Literata measures within 1 % of 0.463; each other bundled face matches its `hmtx` mean within 1 % (a test that fails if the sample or the canvas path changes).
- Two sizes of one face give the same em value within 0.5 % (it is a ratio).
- A theme declaring 0.463 for a face that measures 0.52 warns once, naming theme, face and both numbers; a theme within 3 % does not.
- `measure-startup` shows no change in time to first text.

**Tests.** `measure-face.test.mjs`, `average-advance.test.ts`, `loader.test.ts`. Gates: `pnpm check`, `gate:aesthetics` (the page must not move).

**Do not.** Add a token or change a default value (H-04 sets values); size the column in `ch`; measure on the first-text path; rewrite a theme's value.

**Risks.** A canvas in WebKit measures with hinting off where the typesetter lays out with it on; the 1 % bound is the check. *For the lead:* a build-time table from `hmtx` is cheaper and needs no browser; the plan says "in the app", so the card does that and keeps the table as its cross-check. If the cross-check alone suffices, say so and stop.

---

### K-05 — `data-marxy-kind` on the pane root, and the `article`, `readme` and `report` profiles

**Model:** opus · **Size:** M · **Depends on:** H-04, K-03 (merged), K-04 (merged) · **Parallel with:** H-06, V-01
**Try Sonnet first** (author, 2026-10-10: be cost-effective); escalate if opening-mode changes touch more than the files ADR-0060 item 8 names.

**Outcome.** Every pane's root carries `data-marxy-kind="<kind>"`, decided once when the file opens by `detectFileKind` with the reader's rules and *show as*; the default theme gives `article`, `readme` and `report` their profiles through the kind scope; a theme may style any of the fourteen. The palette row reads the kind recorded in the index. An extension-less `README`, `CONTRIBUTING`, `CHANGELOG`, `CHANGES` or `HISTORY` opens Rendered (ADR-0060 item 8).

**Why now.** K-08 to K-13, K-17, K-20 to K-22 and K-14 all wait on the attribute; nothing in the app calls `detectKind` yet, and K-04's rules and *show as* take effect only here.

**Paths.**
- Edit: `apps/desktop/src/document/open.ts` (`:224` and `:294` call `defaultModeForPath`; decide the kind once at open, keep it through live reloads), `apps/desktop/src/pane/dom.ts` and `pane/pane-set.ts` (set the attribute on `section.marxy-pane`), `apps/desktop/src/source/default-mode.ts` (the mode from the kind for the text family; the rest as today), `apps/desktop/src/palette/view.ts` (`:530` detects from the path alone: read `entry.readerKind` when present, the path only as the fallback), `packages/theme/default/theme.css` (three `[data-marxy-kind]` profiles), `docs/design/09-app-shell.md`, `docs/design/05-theme.md`.
- Read: ADR-0060 items 6 to 9; ADR-0059 item 7; `packages/core/src/kind/show-as.ts` (`detectFileKind`), `commands/kind.ts` (loads `kinds.json`), `packages/theme/src/config.ts` (`kindRules`), `03-kinds-and-the-look.md` §Profiles.

**Build order.**
1. At open, read `KIND_HEAD_BYTES`, load `kinds.json` and the rules, call `detectFileKind`; set the attribute on the pane before first text; the kind never changes on a reload.
2. Mode: the text family opens Rendered, so the extension-less README family moves from Source to Rendered; every other file opens exactly as today (a test over the corpus).
3. Palette row: the recorded kind (K-18 note: path-only detection ignores a reader's rule or a shape-decided kind).
4. Profiles in the default theme's kind scopes, in `:root` and the light variant alike, as multiples of the reader's sizes (ADR-0059 item 7). `readme` is 80 characters, the clamp's edge, not 84 (ADR-0060's last Consequence); say so in the PR.
5. H-03's note: the `[data-marxy-kind] { --marxy-measure: … * 1em }` repeat in `base.css:25`: check its `1em` is the body size, as on `:root`, in the pane scope; and that the 45 to 80 clamp holds for every kind.

**Acceptance.**
- A fixture per kind sets the attribute to that kind; a `[[kind]]` rule and a *show as* entry each win over detection, in that order (a test that fails if the open path calls the path-only detector).
- A reload of a growing file keeps its kind; reopening it re-detects.
- With one `[data-marxy-kind="report"] { --marxy-measure-chars: 120 }` the column is 80 characters at the body size, and at two reader sizes the width in characters is equal (fails if the repeat's `em` is wrong).
- An index entry whose `readerKind` is `transcript` shows the transcript icon; the same path with no field falls back.
- No other file's opening mode changes; `gate:aesthetics` is unchanged for the corpus except the three profiles' declared differences (listed).

**Tests.** `open` and `default-mode` tests, `pane-set.test.mjs`, a palette test, `loader.test.ts`. Gates: `pnpm check`, `gate:golden`, `gate:aesthetics`, `gate:contrast` (each profile's pairs pass).

**Do not.** Give a log, diff, data or code kind a Read treatment (K-08 to K-13) or change its mode; re-detect on a reload; read any front-matter key but the three of ADR-0060 item 5; add a chip or a settings page (K-07, W-12).

**Risks.** Detection reads up to 80 KB before first text; the budget is the existing one, and K-06 measured detection at about 2 µs a call from the path alone. A profile that moves the page is taste: the author reviews it.

---

### W-02 — The workspace shell: folded and unfolded, and the grid of regions around the panes

**Model:** opus · **Size:** L · **Depends on:** W-01 (#513 open: merge it first), D-14 (**not started**: the split's gate and cost bounds), H-03 (merged) · **Parallel with:** nothing that edits `app.ts`
**Try Sonnet first** (author, 2026-10-10: be cost-effective); escalate if the grid moves the column or `app.ts` needs a design.

**Outcome.** The window has two states (ADR-0058 items 1 to 4, 6): folded, today's page exactly; unfolded, six empty, named regions (sidebar, toolbar, tabs, strip, inspector, status bar) laid out in a grid around the panes, with the column in the panes never moving unless the measure no longer fits. A command folds and unfolds; the panels last unfolded are remembered; a window opens folded. The regions hold no content: W-03 to W-11 fill them.

**Why now.** Every W story, K-07, K-14 and Q-03 wait on it. W-01 made the gate ready for a state; this is the first thing that sets one.

**Paths.**
- New: `apps/desktop/src/workspace/` (`state.ts`, `regions.ts`, `workspace.test.mjs`), `packages/core/src/layout/workspace-storage.ts` and its test (a plain file beside `layout.json`, same envelope, version guard and quarantine as `storage.ts`), `apps/desktop/src/commands/workspace.ts`.
- Edit: `apps/desktop/src/app.ts` and `app-types.ts` (a seam: keep the diff small), `apps/desktop/src/pane/pane-set.ts` and `pane/fit.ts` (the room the panes get), `packages/theme/src/base.css` (the grid, only under `[data-marxy-workspace="unfolded"]`), `scripts/gate-aesthetics.mjs` (the `WORKSPACE` constant from W-01, #513), `scripts/registry.json`, `docs/design/09-app-shell.md`.
- Read: ADR-0058 in full, ADR-0057 items 2 and 3 (the 929 px floor), `02-fold-up-workspace.md` §Folded, §Unfolded and §Keys, `pane/keys.ts`.

**Build order.**
1. W-01's provisional names (`data-marxy-workspace`, `-region`, and the six region names) are this story's to keep or change, in `WORKSPACE` and `registry.json` in one change. Change the gate so it **reads the attribute from the page** instead of being told the state, and add a case that pins **no attribute means folded** (W-01 review: no case holds it, and the gate never reads the attribute).
2. State and storage: windows open folded; the open panels are read at unfold and written at fold, never at launch.
3. The grid: unfolded only; `#marxy-main` keeps its size when the regions are empty; a region is absent from the page when folded, not hidden by style.
4. The command and its palette entry. **The key is not `⌘\`**: `pane/keys.ts` binds `Mod+\` to *Open beside* (D-07, shipped) and the plan's fold key collides with it. Register the command with no key and ask the lead for one; `Esc` folding the workspace waits for W-03.

**Acceptance.**
- A fresh profile opens folded, and `gate:aesthetics` folded is unchanged for the corpus (the existing cases pass unmodified).
- Unfolding shows the six regions and no other visible element; the unfolded gate case passes, and a stray element outside a region fails it.
- The article's left edge and width in a one-pane window are identical folded and unfolded when the window is wider than the measure needs (a geometry test); at the 929 px floor the column holds its 45 characters.
- A page with no `data-marxy-workspace` is judged as folded by the gate (the new case; removing the default makes it red).
- Fold, unfold, quit and relaunch: opens folded; unfolding restores the last panels; a corrupt workspace file is quarantined and the app opens folded.

**Tests.** `workspace.test.mjs`, `workspace-storage.test.ts`, `pane-set.test.mjs`. Gates: `pnpm check`, `gate:aesthetics` (both states), `gate:fidelity`, the desktop browser suite one file at a time.

**Do not.** Put content, a button or a peek in a region (W-03 to W-11); edit `tokens.css` or a theme; bind `⌘1` to `⌘3` or change `⌘E` (W-19); add a second window; draw a tab bar folded.

**Risks.** L and `app.ts` is the busiest file: if the grid and the state outgrow one PR, split the storage and the command as W-02.1. Decide with the lead whether the remembered panels join `layout.json` (D-12 persists it, not started) or stay a file of their own.

---

### V-01 — Structural selection and line operations in Source

**Model:** sonnet · **Size:** M · **Depends on:** D-11 (merged) · **Parallel with:** H-04, H-06, K-05
**Outcome.** In a pane's Source editor the reader can select a line, a block or a section, grow the selection one step (word, line, block, section, document), add the next occurrence or every occurrence of the selection, and use the line operations: move, duplicate, delete, join, sort, toggle task, toggle quote, toggle comment. As palette commands and on keys; no toolbar, no panel, no mark on the text (`01-galley-keep-knead-leave.md`, Source table; `02-fold-up-workspace.md` §Split and Source).

**Why now.** D-11 gave each pane its own Source editor; V-02, V-05 and V-08 build on one place for Source commands. It touches nothing the K and W stories touch.

**Paths.**
- New: `packages/core/src/source-edit/` (`select.ts`, `lines.ts` and tests: pure functions from text and a range to a range or a splice, never the DOM), `apps/desktop/src/source/structure.ts` (the CodeMirror glue: `EditorView` commands from those functions), `apps/desktop/src/commands/source-edit.ts`.
- Edit: `apps/desktop/src/source/editor.ts` (`baseExtensions`: add the keymap beside `defaultKeymap` and `searchKeymap`), `apps/desktop/src/commands/index.ts`, `docs/design/09-app-shell.md` (the key table).
- Read: `packages/core/src/sourcemap/section.ts` (`sectionRange`), `operations/toggle-task.ts`, `mock-v2/09-macos.md` (the Select menu: `⌘L` line, `⌃⇧B` block, `⌃⇧S` section, `⌃⇧→` expand, `⌘D` next, `⇧⌘L` all), `02-source.md`.

**Build order.**
1. Check what CodeMirror's default and search keymaps already give (select line, next occurrence, all occurrences, move, copy and delete line) and reuse it; write only what is missing: block, section, expand, join, sort, toggle task, quote and comment.
2. Pure functions with tests; a section is `sectionRange` over a parse of the buffer's text, a block the parse's node, both in bytes and converted at the seam.
3. The glue as CodeMirror transactions, so undo is the editor's; commit to the store by the existing Source fold (`buffer-commit.ts`), never a second path.
4. Commands and keys. `⌘/` is the transforms key (06 row 2): toggle comment has no `⌘/`. Every chord is checked against `pane/keys.ts` and the registry's table.

**Acceptance.**
- Select block and section on a fixture return the exact byte ranges of the parse; expand walks word, line, block, section, document and stops at the end.
- Move, duplicate, join and sort keep a CRLF file CRLF, a BOM a BOM and a missing final newline missing (a test per operation, mutated to fail).
- Toggle task and toggle quote on several lines act as one undo step; toggle task on a line with no list marker does nothing and says nothing.
- Two panes in Source: an operation in one changes only its own document's pane until folded; no key changes Rendered.
- No new element appears in the Source frame (`gate:aesthetics`, the source-looks tests).

**Tests.** `packages/core/src/source-edit/*.test.ts`, `apps/desktop/test/source-structure.test.mjs`. Gates: `pnpm check`, `gate:fidelity`, `gate:golden`.

**Do not.** Add a toolbar, a menu bar item or a panel (V-05, W-20); change the find panel (V-03); touch Rendered's `Alt+↑/↓` block moves; format or reflow the reader's text beyond the one operation.

**Risks.** A chord that works in CodeMirror but is eaten by the pane listener (it runs in the capture phase): test from inside the editor. Sorting is locale-sensitive; use a byte-wise order and say so in the command's title.
