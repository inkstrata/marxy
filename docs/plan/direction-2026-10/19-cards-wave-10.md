# Cards for wave 10: the inspector fills, Source gets its editing tools, new files and the menu bar

**In short.** Wave 10 cards nine stories in three lanes:

- **The inspector and status bar:** W-11 (the status bar), W-10 (the Outline tab with section moves), V-06 (the Versions
  tab).
- **Source:** V-08 (formatting commands and two Source settings), V-03 (find and replace with a preview), V-04 (quiet notes
  about a file).
- **New files, the library and the menu bar:** Q-06 (broken paths and near-duplicates in the library), W-14 (New file,
  New file here, Fork this file), W-20 (the native menu bar).

Each card was written against `origin/main` at `ddfdb69c`. Every Path was checked with `git ls-files` (*new* marks a file
that does not exist) and every function named was found with `git grep`. The plan lines are in [05-plan.md](05-plan.md);
the reading defaults come from `docs/research/reader-artifacts/10-spec.md` and `docs/research/reader-typography/10-spec.md`.

## What a reader gains, and why these first

Waves 4 to 9 built the unfolded window's frame: toolbar, tabs, sidebar, inspector shell, Source frame, kinds and themes.
Several of its doors still open onto nothing:

- the inspector has one tab (Links);
- the status bar's 26 px band is not drawn, because nothing fills it (U-01);
- the toolbar's **+** door is declared but has no command, so it is not drawn (W-05);
- Source has a frame but no formatting commands, no replace, and nowhere to see what Marxy noticed about the file;
- the library's *Near-duplicates* and *Broken paths* have no matches, because `is:dup` and `is:broken` match nothing yet
  (`UNAVAILABLE_STATUSES`, `packages/core/src/index-model/query-eval.ts:181`);
- the macOS menu lists seven items.

Wave 10 fills those doors. When it is done, a reader can:

- see where they are and what the file is, at a glance;
- move a whole section of a document up or down from its outline;
- go back to an earlier version of a file and restore it beside the original;
- bold, italicise and insert in Source from keys and the palette;
- replace across a file after seeing exactly what will change;
- be told, quietly, about an unclosed fence or a skipped heading level;
- start a new file or fork one;
- find the copies and the dead links in their folders;
- find any command in the menu bar.

**Why these before the rest.** Each story here fills a surface that already exists and is reviewed, with a design that
02 and the mock give whole. None needs a new kind, a new theme role or a typesetter change. Seven need no ADR. Two wait
on one each:

- **V-06** stores copies of the reader's documents in Marxy's data folder, which is a new kind of state. It needs
  ADR-0072 and the author's ruling under commitment 3. It is placed last in its lane, so the ruling has time to arrive.
- **W-20** puts document commands in the menu, which ADR-0011's menu note forbids today. It too is placed last in its
  lane.

Both were ruled on 2026-10-12, as recommended: ADR-0072 (local versions) and ADR-0073 (the menu lists commands) are
accepted, and neither card waits any longer.

**Left for wave 11, and why:**

- **W-12 (settings, with the Privacy page).** Large, Opus, and the foundation of W-16, W-22, H-07's control, J-10 and
  K-15. It deserves a wave that has room for it and the stories it unlocks.
- **W-23 (focus mode).** It is underspecified: 02 gives it one line, the mock gives a key and a dim, and the reading
  progress line needs `book` (K-21). It needs a short design first.
- **W-17 and W-18 (metadata).** W-17 settles ruling 21 on the front-matter head, and K-20, still in flight, edits the
  same `frontmatter.ts`. W-18 needs ADR-0064 and new shell capabilities.
- **K-12, K-13, K-14, K-17, K-21, K-22 (kinds).** The kinds lane is still finishing wave 9 (K-08, K-20, K-09, K-10b), and
  it holds `default/theme.css`, `file-types.ts`, the parser choice in `store.ts` and `strip.ts`. K-14 needs K-08 to K-13
  merged.
- **W-13, W-15, W-16, W-22, Q-04, Q-05, Q-08, Q-09.** W-16 and W-22 wait for W-12. W-15's export formats need a licence
  review of new dependencies. Q-05 and Q-08 write and move the reader's files and should follow Q-06's read-only
  groundwork. Q-09 needs Q-06.

| Id | What | Model / effort | Size | Review | Mock screen (ADR-0070 pair) |
| --- | --- | --- | --- | --- | --- |
| W-11 | The status bar: kind, a measure, where you are, encoding, theme and size; items open their inspector tab | sonnet / medium | S | lead | `01-unfolded` |
| W-10 | The inspector's Outline tab: jump, words per section, move a section up or down, promote and demote | sonnet / high | M | lead; `gate:fidelity` | `09-inspector-outline` (*new screen*) |
| V-06 | The inspector's Versions tab: local snapshots, a diff, restore beside the original | opus / high | M | **adversarial**; ADR-0072 accepted | `09-inspector-versions` (*new screen*) |
| V-08 | Formatting commands and inserts in Source; show whitespace and the column guide as settings | sonnet / medium | M | lead | `02-source` |
| V-03 | Find and replace in Source with a preview of every change before it is made | opus / medium | M | **adversarial** (rewrites the buffer) | none: the mock has no replace page (before/after instead) |
| V-04 | Notes about a file (unclosed fence, skipped heading level, missing path) as right-edge marks; go to next note | sonnet / medium | M | lead | `02-source` |
| Q-06 | Broken paths and near-duplicates in the library; the two built-in smart collections | opus / medium | M | lead | `05-library` |
| W-14 | New file, New file here, Fork this file: the + menus, the sidebar and the palette, folded or not | sonnet / high | M | **adversarial** (writes beside the reader's files) | `01-unfolded` (+ menu open; hand capture, question 4) |
| W-20 | The native menu bar: every command with a key or a menu row, conflict-checked; **ADR-0011's menu note amended first** | sonnet / medium | M | lead | none: a native menu (the mock's `09-macos` table instead) |

**What `main` already has, and what it constrains.**
- **The inspector.** `registerInspectorTab({ id, title, mount })` (`apps/desktop/src/workspace/inspector.ts`) adds a tab;
  the shell keeps the selected tab in a module-private `selected` and exports nothing to select one from outside. `fill.ts`
  (`installWorkspaceFills`) is where every region's content is registered, and its comment already names the Outline,
  Metadata and Versions slots. `app.ts` is not touched for a fill. Links (`LINKS_TAB`, `links-tab.ts`) is the pattern:
  `linksModelOf(store)`, a `tabindex` of -1 on each row, the shell roving them.
- **The status bar region exists** (`WORKSPACE_REGIONS` in `packages/core/src/layout/workspace-storage.ts:21` has
  `status-bar`). `workspace/state.ts` hides it until something fills it (U-01). V-05's helpers in
  `apps/desktop/src/source/frame-facts.ts` already say a file's facts in words: `formatCount`, `bytesLabel`, `linesLabel`,
  `encodingFact`, `lineEndingFact`, `indentFact` and `characterReadout`. No second formatter is written: W-16 is the one
  that later unifies them.
- **Outline and section operations.** `outlineFrom(doc)` (`packages/core/src/outline/outline.ts`) gives the headings. The
  folded outline (A-15, `apps/desktop/src/outline/{view,pane}.ts`, `view.outline` on `Mod+Shift+O`) stays as it is. E-07's
  `promote-heading` and `demote-heading` (`packages/core/src/operations/heading-level.ts`) move a section's levels. **No
  operation moves a section**: only `copy-section.ts` exists.
- **Diff and "what changed".** `unifiedDiff(a, b, opts)` (`packages/core/src/diff/unified.ts`) returns null past its
  limits. `diffLines` and `diffLinesDetailed` are in `packages/core/src/diff/lines.ts`. E-17's `commands/compare.ts`
  (`changesDocument`, `NO_DIFFERENCE`, `TOO_LARGE`) diffs the disk against the buffer and opens the result as a scratch
  document (`openScratch`, `document/scratch.ts`). "Changed since you read" today is timestamps only (`changedSinceRead`,
  `palette/empty-state.ts`). **No copy of a document's bytes is kept anywhere.**
- **Writes beside a file.** V-07's `conflictCopyPath` and `writeCopy` (`apps/desktop/src/document/store.ts:239`, `:621`)
  write `name (mine).ext` at the first free name, checking with `io.exists` before `writeFileAtomic`. **`writeFileAtomic`
  renames over an existing path**, so "never over" is a check-then-write, not an exclusive create. `shell-api` has no delete
  and no create-new (`packages/shell-api/src/index.ts`). Marxy's own files (`positions.json`, `trust.json`,
  `workspace.json`) live under `configPaths().data` and are written with `writeFileAtomic`.
- **Find in Source** is CodeMirror's own panel: `commands/find.ts` (`view.find`, `Mod+F`) calls `openSearchPanel`, and
  `searchKeymap` is wired in `apps/desktop/src/source/editor.ts`. **Nothing Marxy owns replaces.** The stock panel's
  replace fields have no preview. V-05's frame (`apps/desktop/src/source/frame.ts`) draws marks of two kinds,
  `'invisible' | 'find'`, in `.marxy-source-marks`. It scans in slices of `SLICE_LINES` (4,000) and caps what it walks
  (`FIND_CAP`, `INVISIBLE_CAP`).
- **Source commands and settings.** `SOURCE_EDIT_ENTRIES` in `commands/source-edit.ts` is the table of Source edits (`op`
  or `table`, `id`, `title`, `key`), run by `runStructure` (`source/structure.ts`). `commands/source-view.ts` has
  `view.toggle-line-numbers`, the template for a Source setting: `writeReaderKey` plus a CodeMirror compartment.
  `writeReaderKey` (`apps/desktop/src/theme/reader-config.ts:184`) takes only `variant`, `size`, `line_numbers`,
  `chrome_size` and `theme`. **No bold, italic, link or code wrapper exists**, and no whitespace or column-guide setting.
- **Keys.** `apps/desktop/test/keys-table.test.mjs` checks every chord on both platforms: the registry's `key` and `keys`,
  `PANE_CHORDS`, `PALETTE_CHORDS`, `FOLD_KEYS` and the menu's accelerators (`MENU_OWNERS`). It reads `main.rs` by regex,
  so a new command with a key needs no edit to it. A new menu item does.
- **The menu.** `mod app_menu` in `apps/desktop/src-tauri/src/main.rs` is the whole macOS menu as data: `MENU`, `Entry`
  and `action_for`. A `ToWebview` click emits `marxy:menu` with the item's id. `apps/desktop/src/menu/menu-commands.ts`
  replays the item's chord as a `keydown` on `document`, which CodeMirror never receives. ADR-0011's note (MARXY-342)
  says "no tab list or document-specific command is added to the menu".
- **The library and the index.** `IndexEntry` (`packages/core/src/contracts/index-entry.ts`) is a reviewed contract whose
  comment says "never contents" (ADR-0012). `resolveMentioned` (`links-tab.ts`) calls a path missing only when every
  folder above it is real and was listed; otherwise it says "not checked". `checkoutOf` and `IndexService.checkoutKey` fold
  worktree copies through an app-side map, leaving `IndexEntry` unchanged: that is the model for folding duplicates. The
  sidebar's built-in rows for near-duplicates and broken paths wait for Q-06 (`docs/design/09-app-shell.md` §Sidebar).
- **The + door.** `TOOLBAR_ITEMS` (`workspace/toolbar.ts:41`) declares `{ id: 'new', commands: ['document.new-menu'] }`,
  drawn only once that command is registered; `toolbar-items.test.ts` already covers it with a stub. `⌘N` and `⇧⌘N` are
  unbound. The tab bar's **+** (`workspace/tabs-view.ts`) has no menu yet (17-design-pass-chrome.md, "a + at the end opens
  the New menu").
- **Mock screens** in `scripts/mock-pair.mjs` `SCREENS`: `01-folded`, `01-unfolded`, `02-source`, `02-source-folded`,
  `03-split`, `03-code`, `03-transcript`, `04-palette`, `04-palette-commands`, `05-library`, `06-transform-sheet`,
  `07-notice`, `07-notice-folded`, `08-narrow`. The mock takes only `#doc=` and `#line=` in its hash, so a screen with the
  inspector on a given tab clicks that tab in its `run`.

**The rules every card keeps.**
- A fact a surface shows is read from live state and changes when the state does.
- A control with nothing behind it is not drawn (W-05's door rule).
- Marxy never decorates the reader's text to correct or judge it (02, "Split and Source"). Notes are marks at the edge
  and lists, never squiggles, underlines or gutter icons.
- Every edit is a splice of exactly the bytes asked for, with one undo step, under `pnpm gate:fidelity` (commitment 3).
- Nothing is written over a reader's file that they did not ask to save.
- Every UI card ships the app-beside-mock pair (ADR-0070) through `scripts/mock-pair.mjs`, and adds any new
  command-opened surface to `SURFACES` in `apps/desktop/test/no-displacement.test.mjs`.
- Every acceptance line names a test or gate that fails on `main`.
- No card edits `apps/desktop/src/commands/index.ts`: each story's commands go in a module it already registers.

---

### W-11 — The status bar: what the file is and where you are, one click from its inspector tab

**Model:** sonnet (medium) · **Size:** S · **Review:** lead · **Depends on:** W-09, U-01, V-05 (merged); wave 9's kinds
lane merged (it holds `base.css` and `registry.json`) · **Parallel with:** V-03

**Outcome.** When the window is unfolded, a 26 px status bar runs along its foot. On the left it shows:
- the file's **kind** ("Report", "Log", "Code · Rust");
- **one measure** for that kind: words for prose kinds, lines for code, data and logs;
- **where you are**: `Ln 23, Col 14` in Source, or the heading of the section under the reading line in Read;
- the file's **encoding and line endings** ("UTF-8 · LF").

On the right it shows the **theme** and the **text size**.

Each item that has an inspector tab is a button that docks the inspector on that tab: *where you are* opens Outline once
W-10 has registered it, and the theme opens the palette on `>Theme`. Every other item is plain text, never a button with
nothing behind it. Every value is read from the focused pane's document and changes with it. Folded, there is no bar.
While the window is unfolded, slow work (the first walk of a newly declared folder) shows its progress in the bar instead
of as a pill, and becomes the outcome notice when it ends (ruling 8).

**Paths.**
- New: `apps/desktop/src/workspace/status-bar.ts` (pure items from a document snapshot plus the DOM mount),
  `apps/desktop/src/workspace/status-bar.test.ts`, `apps/desktop/test/status-bar.test.mjs` (WebKit).
- Edit: `apps/desktop/src/workspace/inspector.ts` (export `selectInspectorTab(id)`, which docks the region and selects the
  tab), `apps/desktop/src/workspace/fill.ts` (the `status-bar` fill), `packages/theme/src/base.css` (`.marxy-status-bar`, on
  the chrome spec), `scripts/registry.json` (the classes and `data-marxy-status-item`), `docs/design/09-app-shell.md` (§DOM
  skeleton, §State).
- Read: `apps/desktop/src/source/frame-facts.ts`, `apps/desktop/src/workspace/kind-chip.ts`, `apps/desktop/src/notices/`
  (the progress pill), `mock-v2/01-workspace.md` (Status bar row), `rulings-x21.md` ruling 8.

**Acceptance.**
- `status-bar.test.ts` is a table of items over snapshots: a report gives words, a Rust file gives lines, a CRLF file
  says `CRLF`, a mixed one says `mixed`. The labels come from `frame-facts.ts`, with no second formatter. Fails on `main`:
  no module.
- In WebKit, unfolding draws the bar; switching panes or documents changes every item; folding removes the element
  (`status-bar.test.mjs`).
- Clicking *where you are* with no Outline tab registered does nothing, because the item is not a button. With a stub tab
  `outline` registered, the click docks the inspector on it (the same test, both cases).
- A walk started while unfolded shows its progress in the bar and no pill; folded, the pill shows as today (the notices
  test, one more case).
- The at-rest gate (`checkChrome`) still passes folded; unfolded, `status-bar` is no longer an empty region (U-01's test,
  updated).
- **Pair:** `01-unfolded`, Night and Paper.

**Do not.**
- Add the reader's choice of measures, the token estimate or a measure formatter (W-16).
- Add a setting to hide the bar (W-12).
- Count notes (V-04 adds its count when it lands).
- Show a clip count, a live dot or anything about an agent.

**Questions for the author.**
1. What does *where you are* say in Read, where there is no caret? *Recommended:* the heading of the section under the
   reading line (ADR-0018's coordinate), or nothing above the first heading. `Ln, Col` is for Source.
2. Which single measure while W-16 is unbuilt? *Recommended:* words for `article`, `report`, `readme`, `docs`, `notes`,
   `transcript` and `book`; lines for every other kind. W-16 replaces this with the reader's choice.
3. Does slow work's progress move into the bar now (ruling 8)? *Recommended:* yes, for the first walk of a declared
   folder, the only slow work today. Folded keeps the pill.

---

### W-10 — The inspector's Outline tab: jump, words per section, move a section

**Model:** sonnet (high) · **Size:** M · **Review:** lead; `pnpm gate:fidelity` is the floor · **Depends on:** W-09, E-07
(merged); **W-11** (both edit `fill.ts`, `base.css` and `registry.json`) · **Parallel with:** W-14

**Outcome.** The inspector gains an **Outline** tab. It lists the focused document's headings, indented by level, each with
the quiet word count of its section. The section under the reading line (Read) or the caret (Source) is marked. A row
jumps there on click or Enter.

Each row moves its **whole section**, the heading and everything under it up to the next heading of the same or a higher
level:
- *Move up* (`⌥↑`) and *Move down* (`⌥↓`) swap it with the sibling section before or after it;
- *Promote* and *Demote* use E-07's operations.

Each move is one splice and one undo step. The moved bytes are the section's bytes exactly, and the file keeps its line
endings and its final-newline state (question 2). A table in the document is listed under its section as "Table: first
header cells". *Copy outline* copies the headings as a Markdown list. A document with no headings says so. The tab follows
the document live: an external change or an edit relists it.

**Paths.**
- New:
  - `packages/core/src/operations/move-section.ts` (`move-section-up`, `move-section-down`: pure, over a `section`
    selection, the result a splice) and its test;
  - `apps/desktop/src/workspace/outline-tab.ts` (`OUTLINE_TAB`) and `apps/desktop/src/workspace/outline-tab.test.ts`;
  - `apps/desktop/test/outline-tab.test.mjs` (WebKit);
  - `fixtures/corpus/38-sections.md` (setext and ATX headings, a CRLF twin, a last section with no final newline) and
    its golden.
- Edit:
  - `packages/core/src/operations/index.ts` (the two ids, one entry per line in id order, F-32) and
    `operations/registry.test.ts`;
  - `apps/desktop/src/commands/outline.ts` (the move commands, offered when a section is selected or the Outline tab has
    focus);
  - `apps/desktop/src/workspace/fill.ts` (`registerInspectorTab(OUTLINE_TAB)`);
  - `packages/theme/src/base.css` (the rows, inside the `.marxy-inspector` block);
  - `scripts/registry.json`;
  - `scripts/mock-pair.mjs` (`SCREENS`: `09-inspector-outline`, both sides docking the inspector and clicking Outline)
    and `scripts/mock-pair.test.mjs`;
  - `docs/design/12-outline.md`.
- Read: `packages/core/src/outline/outline.ts`, `packages/core/src/operations/heading-level.ts` (its section rule, and how
  it declines setext), `packages/core/src/operations/copy-section.ts`, `apps/desktop/src/workspace/links-tab.ts` (a tab's
  rows and roving), `mock-v2/01-workspace.md` §Inspector.

**Acceptance.**
- `move-section.test.ts`:
  - moving the second of three sibling sections up yields the bytes of 2, 1, 3, with every byte of each section
    unchanged;
  - a CRLF file keeps CRLF;
  - a last section with no final newline, moved up, leaves the file still ending without one;
  - the first section's *Move up* is not offered.
  - Fails on `main`: no operation.
- `pnpm gate:fidelity` runs the two new operations under the property test.
- In WebKit: the tab lists the fixture's headings with word counts; `⌥↓` on a row moves its section and one `Mod+Z` puts
  back the original bytes; the list relists after an external change (`outline-tab.test.mjs`).
- The tab's rows rove with the arrows inside the inspector's one tab stop (the inspector test, one case).
- **Pair:** `09-inspector-outline`, Night and Paper.

**Do not.**
- Drag to reorder (question 1).
- Change the folded outline (A-15).
- Move a section across a heading of a higher level; move setext sections if E-07 declines them (question 3).
- List a log's warnings or a terminal's commands (K-14).

**Questions for the author.**
1. Drag, which the mock draws, or keys and buttons only? *Recommended:* keys (`⌥↑`, `⌥↓`) and a row menu here. Drag
   becomes W-10.1 once the moves are proved, because a drop target between rows is a new surface with its own pair.
2. Moving the last section when the file has no final newline: what is written? *Recommended:* the moved section gains
   the file's own line ending, and the section that becomes last loses its one, so the file's ending is unchanged. The
   operation's test states the bytes.
3. Setext headings (`Title` over `===`): E-07 declines to promote them. Do moves? *Recommended:* moves work on setext
   sections, because a move does not rewrite a heading; promote and demote keep E-07's rule.

---

### V-06 — The inspector's Versions tab: what changed, earlier copies, restore beside the original

**Model:** opus (high) · **Size:** M · **Review:** **adversarial** (it keeps copies of the reader's documents and writes
beside them) · **Depends on:** E-17, W-09 (merged); **W-10** (`fill.ts`, `base.css`, `registry.json`, `mock-pair.mjs`);
ADR-0072 (accepted 2026-10-12) · **Parallel with:** W-20

**Outcome.** The inspector gains a **Versions** tab for the focused file. At the top is **Changed since you read**,
present when the bytes on disk differ from the copy kept when you last read the file: a count of lines added and removed,
and a click that opens the diff. Below it, the file's **earlier versions**, newest first, each with its time, its size and
the reason it was kept:
- *read*: the bytes you read when you opened it;
- *before save*: what was on disk before Marxy saved over it;
- *before reload*: what was on disk before an outside change replaced it.

Choosing a version opens the diff from it to the current buffer, as E-17's diff does (a scratch document, nothing
written). **Restore to a copy** writes that version's bytes beside the file as `name (version 14.32).md`, at the first
free name and never over a file, then opens it. It never replaces the original.

Copies are plain files in Marxy's data folder, never beside the reader's files, kept to a stated limit (question 2), and
cleared by *Clear versions of this file* and *Clear all versions*. A file under a deny rule, or one larger than the large-file
limit, is never copied, and the tab says why. Nothing leaves the machine.

**Paths.**
- New:
  - `docs/adr/0072-local-versions.md`: written and accepted by X-28 (2026-10-12); V-06 reads it and changes it only if
    the build finds it wrong;
  - `apps/desktop/src/versions/store.ts` (the slots, the manifest and the limits: pure over an injected read and write)
    and its node test;
  - `apps/desktop/src/versions/recorder.ts` (subscribes to each document store's transitions: `open`, `save` and
    `reload`);
  - `apps/desktop/src/workspace/versions-tab.ts` (`VERSIONS_TAB`) and its node test;
  - `apps/desktop/test/versions-tab.test.mjs` (WebKit).
- Edit:
  - `apps/desktop/src/app.ts` (one line beside `createReadingPersistence`: install the recorder; the only story in this
    wave on that file);
  - `apps/desktop/src/workspace/fill.ts` (`registerInspectorTab(VERSIONS_TAB)`);
  - `apps/desktop/src/commands/compare.ts` (*Show changes since you read*, the two Clear commands, a diff from a stored
    version through `changesDocument`);
  - `packages/theme/src/base.css`;
  - `scripts/registry.json`;
  - `scripts/mock-pair.mjs` (`SCREENS`: `09-inspector-versions`);
  - `docs/design/11-config-and-storage.md` (§Data files: the `versions/` row; §What is never stored, amended as ADR-0072 rules);
  - `docs/adr/README.md`.
- Read: `apps/desktop/src/document/store.ts` (`Transition`, `conflictCopyPath`, `writeCopy`),
  `apps/desktop/src/document/live-reload.ts`, `apps/desktop/src/position/reading-persistence.ts` (how Marxy's own files
  are written), `packages/core/src/diff/unified.ts`, `docs/research/reader-artifacts/05-diffs-provenance.md`,
  `04-capture.md` (the regenerated-file case).

**Acceptance.**
- `versions/store.test.ts`:
  - a read, a save and a reload of one file keep three versions with their reasons;
  - identical bytes are kept once;
  - the limit drops the oldest first;
  - *Clear* leaves no version's bytes readable through the store;
  - a path under a deny rule is never written.
  - Fails on `main`: no module.
- In WebKit, over the memory shell: open, edit, save, then change the file outside. The tab shows *Changed since you read*
  with the right counts, and three versions. Restore to a copy writes `x (version HH.MM).md` and leaves `x.md`'s bytes
  unchanged (`versions-tab.test.mjs`).
- Restore when `x (version HH.MM).md` exists writes `(version HH.MM 2)` and never calls `writeFileAtomic` on an existing
  path (an adversarial case, with the shell's write log).
- Every write the recorder makes is under `configPaths().data` (the same test, asserting every path written).
- The no-network assertion still passes. A file over `largeFileBytes` gets no version and the tab says so.
- **Pair:** `09-inspector-versions`, Night and Paper.

**Do not.**
- Add a `shell-api` capability without ADR-0072 saying so (question 3).
- Restore over the original.
- Mark changed lines in Source's right edge (a later card, once the store is proved).
- Snapshot on every keystroke or on a timer.
- Read the reader's folders for anything but the file in front of them.

**Questions for the author.**
1. Where do versions live? Commitment 3 allows Marxy's state "in plain
   files in the platform's config and data directories, apart from the reader's documents". Copies of the documents
   themselves are a new kind of that state. `docs/design/11-config-and-storage.md` §What is never stored lists "Document
   contents" first, and the research spec's "Changed since last read" line says "Local snapshot only, never written".
   - (a) In memory for the session only: no ADR, but nothing survives a quit, which defeats *earlier versions*.
   - (b) Plain files under `<data>/versions/`, one folder per file keyed by a hash of its path, with a readable
     `manifest.json` naming the path, times and reasons.

   *Recommended:* (b), written as ADR-0072. It amends §What is never stored and the research line, and the Privacy
   page (W-12) gains a line saying what is kept and how to clear it.
2. What limits? *Recommended:* 20 versions per file, 30 days, 200 MB in all, the oldest dropped first. Files under a deny
   rule or over `largeFileBytes` are never copied. A `versions = false` key in `config.toml` turns it off.
3. `shell-api` has no delete, so pruning cannot remove a file. *Recommended:* no new capability. Each file's versions are
   a ring of fixed slots that are overwritten, and *Clear* overwrites slots with zero bytes and rewrites the manifest. A
   delete inside the data folder would be a new privileged capability (ADR-0045), argued in ADR-0072 only if the ring
   proves wrong. The shell's own startup pruning of `index/` files is the precedent for such a delete.
4. Is *Changed since you read* the copy made at your last read, or the one at the last time the window showed the file?
   *Recommended:* the last read, recorded when a document is opened or reloaded while in front of you, as ADR-0018's
   last-read time is.

**Ruled 2026-10-12:** all four as recommended (the author: "recommended approved"). Versions are plain files under
`<data>/versions/` (ADR-0072, accepted); 20 per file, 30 days, 200 MB in all, oldest first, never a denied or large file,
`versions = false` turns it off; fixed slots and no new `shell-api` capability; *Changed since you read* is the last read.
The card no longer waits on a ruling.

---

### V-08 — Formatting commands and inserts in Source; show whitespace and the column guide

**Model:** sonnet (medium) · **Size:** M · **Review:** lead · **Depends on:** V-05, V-01 (merged) · **Parallel with:** Q-06
(no shared file), beside wave 9's kinds lane (no shared file)

**Outcome.** In Source, in a Markdown file:
- **Bold** (`⌘B`), **Italic** (`⌘I`), **Inline code** (`` ⌃` ``), **Strikethrough** and **Link** (palette only, because
  `⌘K` is the palette) wrap the selection or the word at the caret. Run again on wrapped text, each unwraps, so twice
  gives back the bytes.
- **Insert** commands put a table, a fenced block, a horizontal rule, a details block or a footnote at the caret, from
  the palette (`>Insert`).

Each command is one splice and one undo step in the file's own line endings. None is offered in a non-Markdown file. There
is no formatting toolbar and no slash menu.

Two Source settings join line numbers:
- **Show whitespace** draws tabs and trailing spaces faintly, as decorations only: the text and the clipboard are
  unchanged. It is off by default.
- **Column guide** draws a hairline at a column. It is on at 80 for code, logs and terminal output, and off for Markdown
  unless chosen.

Both are palette toggles, written to `config.toml` as `line_numbers` is, without touching another byte.

**Paths.**
- New: `apps/desktop/src/source/format-ops.ts` (pure: wrap and unwrap over a selection, the inserts, line endings kept) and
  `apps/desktop/src/source/format-ops.test.ts`, `apps/desktop/test/source-format.test.mjs` (WebKit, the Source harness).
- Edit:
  - `apps/desktop/src/commands/source-edit.ts` (`SOURCE_EDIT_ENTRIES`: the wrap commands and their keys; the inserts);
  - `apps/desktop/src/commands/source-view.ts` (*Show whitespace*, *Column guide*);
  - `apps/desktop/src/source/editor.ts` (two compartments, as `lineNumbersCompartment`);
  - `apps/desktop/src/source/ruler.ts` (the guide, on the ruler's character grid);
  - `apps/desktop/src/source/theme-bridge.ts` (the faint whitespace and the guide, on CodeMirror's own classes, so no
    `base.css` or registry edit);
  - `apps/desktop/src/theme/reader-config.ts` (`writeReaderKey` takes `show_whitespace` and `column_guide`) and its test;
  - `apps/desktop/src/theme/app-config.ts`;
  - `docs/design/09-app-shell.md` (§Source mode, §Keyboard map).
- Read: `apps/desktop/src/source/structure.ts` (`runStructure`), `apps/desktop/src/source/structure-ops.ts`,
  `mock-v2/02-source.md`, `01-galley-keep-knead-leave.md` (formatting as commands, no toolbar), `docs/adr/0067-source-metrics.md`,
  `docs/adr/0069-source-text-holds-every-byte.md`.

**Acceptance.**
- `format-ops.test.ts`:
  - bold twice returns the bytes;
  - bold on an empty selection takes the word at the caret;
  - every insert in a CRLF file contains only CRLF;
  - a selection crossing a fence is declined with a reason.
  - Fails on `main`: no module.
- `keys-table.test.mjs` passes with `Mod+B`, `Mod+I` and `` Ctrl+` `` owned once on both platforms (the test unchanged;
  it reads the registry).
- In WebKit, `Mod+B` in a Markdown file wraps and one `Mod+Z` restores. In a `.rs` file `Mod+B` does nothing and *Bold*
  is not in the palette (`source-format.test.mjs`).
- *Show whitespace* on: a tab shows its mark, copying the line gives `0x09`, and the buffer is unchanged. The toggle
  writes only the `show_whitespace` line of a commented `config.toml` (the reader-config test).
- The column guide sits at column 80 in a code file and is absent in Markdown by default (a geometry case on the ruler's
  grid).
- **Pair:** `02-source`, Night and Paper, with the guide shown.

**Do not.**
- Add a formatting toolbar, a slash menu, or a key for Link (`⌘K` is the palette).
- Add *Go to next note* (V-04 owns notes and their commands).
- Draw anything on the text but CodeMirror's whitespace decorations.
- Add a settings page (W-12).

**Questions for the author.**
1. Slash inserts, as the plan names them: typing `/` at a line's start opens a menu? *Recommended:* no. In a source editor
   `/` must type a slash. The inserts are palette commands under `>Insert`, which gives the same reach with no popup in the
   text.
2. Keys. *Recommended:* `⌘B` bold, `⌘I` italic, `` ⌃` `` inline code (the mock's), and none for strikethrough, link or the
   inserts until W-20's menu shows them.
3. Should the column guide's column follow `.editorconfig`'s `max_line_length` when there is one? *Recommended:* yes;
   otherwise 80.

---

### V-03 — Find and replace in Source, with a preview of every change

**Model:** opus (medium) · **Size:** M · **Review:** **adversarial** (it rewrites the buffer) · **Depends on:** D-13
(merged); **V-08** (both edit `editor.ts`) · **Parallel with:** W-11

**Outcome.** In Source, `⌥⌘F` (and *Replace* in the palette) opens find with its replace field.
- **Replace** changes the current match and moves to the next, one undo step each.
- **Replace all…** never changes anything at once. It opens a **preview**: every change as a before-and-after line with
  its line number, the count ("37 replacements on 21 lines"), and *Apply* (`⌘↩`) or *Cancel* (Esc).
- *Apply* makes every change in one transaction, one undo step, in the file's own line endings.
- Regular expressions with `$1` groups work.
- A match that spans a line ending is shown as such in the preview.
- If the document changed while the preview was open, *Apply* refuses and says so (the transform sheet's stale rule).

Past what a preview can show (`unifiedDiff` returns null, or more than 2,000 changes), the preview shows the count and the
first 200 changes, and says how many more. *Apply* is still offered, and its notice repeats the count. Rendered's find is
unchanged.

**Paths.**
- New: `apps/desktop/src/source/replace.ts` (pure: the matches and the change set for a query, a replacement and the
  text; the preview rows) and `apps/desktop/src/source/replace.test.ts`, `apps/desktop/src/source/replace-sheet.ts` (the
  preview, a modal on the transform sheet's classes: no new class or `base.css` edit), `apps/desktop/test/replace.test.mjs`
  (WebKit).
- Edit: `apps/desktop/src/commands/find.ts` (`view.replace`, `⌥⌘F`; Replace all through the preview),
  `apps/desktop/src/source/editor.ts` (the search panel's Replace all routed to the preview: `search({ createPanel })`, or
  the panel's command overridden), `apps/desktop/test/no-displacement.test.mjs` (`SURFACES`: the preview),
  `docs/design/03-selection-and-operations.md` (§Replace, an edit as a transformation).
- Read: `apps/desktop/src/transform/sheet.ts` (the dialog, `STALE_NOTICE`, `PREVIEW_LIMIT`), `packages/core/src/diff/unified.ts`,
  `apps/desktop/src/source/language.ts` (`LARGE_FILE_BYTES`), `docs/adr/0055-find-edge-token.md` (find's colours).

**Acceptance.**
- `replace.test.ts`:
  - the change set for a regex with `$1` is the expected splices;
  - applying it to a CRLF text keeps CRLF;
  - zero matches gives an empty set and the preview is not opened;
  - a replacement producing the same text is not counted.
  - Fails on `main`: no module.
- In WebKit: *Replace all…* on 37 matches shows 37 rows and leaves the buffer unchanged; *Apply* changes all 37, and one
  `Mod+Z` restores the exact bytes (`replace.test.mjs`).
- An outside change while the preview is open makes *Apply* refuse with the stale notice, and nothing changes.
- The preview opening and closing moves no line of the page (`no-displacement.test.mjs`, the new surface).
- `pnpm gate:fidelity` passes with replace-all as one of the walk's operations (the store walk's seeds, one op).
- **Pair:** none from the mock (it has no replace page); before-and-after renders of the preview over the fixture, in
  Night and Paper.

**Do not.**
- Replace in Rendered (question 1).
- Replace across files (the library's job, later).
- Write to disk: *Apply* changes the buffer, and saving is the reader's.
- Add a class or a `base.css` rule (if review finds one is needed, it waits for W-11 to merge).

**Questions for the author.**
1. Replace in Rendered too? *Recommended:* no. Rendered has no caret, and a replacement there would reshape what the
   reader is reading. Replace is Source's, one key away.
2. Should *Replace all* preview always, even for two matches? *Recommended:* always. The preview is the promise that
   nothing changes unseen. A reader who wants speed presses `⌘↩` straight away.

---

### V-04 — Notes about a file: quiet marks at the edge, a count, and go to next note

**Model:** sonnet (medium) · **Size:** M · **Review:** lead · **Depends on:** K-03, V-05 (merged); **V-03** (lane order),
**V-06** (both edit `base.css` and `registry.json`) · **Parallel with:** none (the wave's last step)

**Outcome.** In Source, Marxy says what it notices about a Markdown file without touching the text:
- a **fence that is never closed** (so everything after it is code);
- a **heading that skips a level** (an `h2` followed by an `h4`);
- a **path that does not exist**, by `resolveMentioned`'s rule, so a path Marxy cannot check is never called missing.

Each note is a faint mark in the right-edge strip at its line, in its own shape so colour never carries it alone.
Hovering a mark names it ("Fence opened at 41:1 is never closed"), and a click jumps there. The bottom bar shows "2 notes"
only when there are any. *Go to next note* and *Go to previous note* (palette) move the caret from note to note.

Read draws nothing. Nothing is underlined, squiggled or highlighted, and nothing goes in the gutter. Notes are recomputed
as the text changes, in slices, and capped like V-05's marks.

**Paths.**
- New: `packages/core/src/notes/notes.ts` (pure: unclosed fences and skipped levels from the source and its AST, each
  note with a byte range and its words) and `packages/core/src/notes/notes.test.ts`, `apps/desktop/src/source/notes.ts`
  (runs the core notes and the missing-path check, in slices), `apps/desktop/test/source-notes.test.mjs` (WebKit).
- Edit: `apps/desktop/src/source/frame.ts` (`Mark.kind` gains `'note'`; the bottom bar's count),
  `apps/desktop/src/commands/source-view.ts` (`source.next-note`, `source.previous-note`), `packages/theme/src/base.css`
  (`.marxy-source-mark-note`), `scripts/registry.json`, `docs/design/09-app-shell.md` (§The Source frame).
- Read: `apps/desktop/src/workspace/links-tab.ts` (`resolveMentioned`, `linksOf`), `packages/core/src/transforms/extract.ts`
  (`pathMentions`), `02-fold-up-workspace.md` ("Marxy never decorates the reader's text").

**Acceptance.**
- `notes.test.ts` is a table:
  - an unclosed fence at EOF gives one note at its opener;
  - `##` then `####` gives one note at the second heading;
  - `#` then `##` gives none;
  - a fence closed by a longer run gives none.
  - Fails on `main`: no module.
- In WebKit: a fixture with one of each shows three note marks and "3 notes"; *Go to next note* visits them in order. The
  editor's content has no added class or decoration on any line (`source-notes.test.mjs`, asserting the line DOM is that
  of `main`).
- A path under a folder that was not listed gives no note (the "not checked" case).
- A 2 MB Markdown file's first text in Source is no later than on `main`, because notes run after it (record the number).
- **Pair:** `02-source`, Night and Paper, with a note mark shown.

**Do not.**
- Draw anything on the text or in the gutter.
- Show notes in Read.
- Note prose, style or anything an AI lint would.
- List notes in the inspector (W-17's Metadata tab lists them, question 1).

**Questions for the author.**
1. Where is the list of notes, given 02 puts it "under Metadata" and W-17 is in a later wave? *Recommended:* the marks,
   the count and the two commands now. The list arrives with W-17's Metadata tab. Missing paths are already listed in
   Links.
2. Do notes run for kinds other than Markdown? *Recommended:* missing paths for every text kind (Links already does);
   fences and heading levels for Markdown only.

---

### Q-06 — Broken paths and near-duplicates in the library

**Model:** opus (medium) · **Size:** M · **Review:** lead · **Depends on:** Q-03, Q-07 (merged) · **Parallel with:** V-08,
beside wave 9's kinds lane (no shared file)

**Outcome.** In the library, `is:broken` and `is:dup` match, and the sidebar's Smart collections section gains its two
built-ins: **Broken paths** and **Near-duplicates**, each drawn only when it has matches.
- **Broken paths** lists the files that mention a path that does not exist, judged by `resolveMentioned`'s rule. Each row
  says which paths, and a click opens the file with its Links tab.
- **Near-duplicates** groups files that are nearly the same: `plan.md`, `plan v2.md`, `plan (copy).md` and two worktree
  copies that have drifted. The group shows the newest, with the others folded under it ("2 near copies"), and offers
  *Compare* (E-17's diff between two of them).

Both are computed **on request**, when a query or a built-in asks, from the index and then from reading only the
candidate files, off the main thread, with progress in the status bar. Nothing new is stored in the index snapshot.
Nothing is moved, merged or deleted.

**Paths.**
- New:
  - `packages/core/src/index-model/near-dup.ts` (pure: candidate pairs from the index's names, titles and sizes, then a
    shingle similarity over their texts, with a threshold) and its test;
  - `packages/core/src/index-model/broken-paths.ts` (pure: the mentions of a text and their resolution through an
    injected `stat`) and its test;
  - `apps/desktop/src/library/checks.ts` (runs both for a scope, cancellable, reading through `shell.readFile`).
- Edit:
  - `packages/core/src/index-model/query-eval.ts` (`UNAVAILABLE_STATUSES` loses `dup` and `broken`; the evaluator takes
    the checks' result sets) and `query-eval.test.ts`;
  - `apps/desktop/src/library/view.ts` and `apps/desktop/src/library/rows.ts` (the grouped rows, the folded copies, the
    paths named; on U-10's classes, so no `base.css` edit);
  - `apps/desktop/src/workspace/sidebar-view.ts` (the two built-ins);
  - `apps/desktop/test/library.test.mjs`;
  - `docs/design/07-index-and-palette.md` (§Query: `is:dup`, `is:broken`).
- Read: `apps/desktop/src/workspace/links-tab.ts` (`resolveMentioned`), `packages/core/src/transforms/extract.ts`
  (`pathMentions`), `packages/core/src/index-model/checkout.ts` (folding through an app-side map),
  `mock-v2/05-collections.md` (near-duplicates, broken paths, the banner), `docs/adr/0012-index-root-and-search-scope.md`.

**Acceptance.**
- `near-dup.test.ts`: `plan.md` and `plan v2.md` differing in one paragraph group at the default threshold; two unrelated
  files of equal size do not; a group's newest is first. `broken-paths.test.ts`: a missing file under a listed folder is
  broken; one under an unlisted folder is not checked and never broken. Fails on `main`: no modules.
- `query-eval.test.ts`: `is:dup` and `is:broken` no longer answer "not available yet".
- In WebKit over the memory shell: the library's `is:broken` lists the fixture file with its missing path named; the
  sidebar shows *Broken paths* and *Near-duplicates* only when each has matches (`library.test.mjs`, `sidebar.test.mjs`).
- `IndexEntry` and the snapshot format are unchanged (`packages/core/src/contracts/contracts.test.ts` and
  `packages/core/src/index-model/persist.test.ts` unchanged and passing).
- Running `is:dup` over 5,000 files reads only candidate files (the shell's read log in the test), and the palette keeps
  answering while it runs.
- **Pair:** `05-library` (the run types `is:dup`), Night and Paper.

**Do not.**
- Add a field to `IndexEntry` or store a hash or a text in the snapshot (question 1).
- Keep newest, merge, archive or delete (Q-05, Q-08).
- Add the per-file path base (Q-09).
- Compute anything at index time.

**Questions for the author.**
1. ADR-0012 says the index holds "not contents". *Recommended:* keep it so. The checks read files only when asked and keep
   their results in memory for the session. A persisted content signature would amend ADR-0012 and would block this card;
   this answer does not.
2. The similarity threshold? *Recommended:* the mock's 85 out of 100 by default, adjustable in the banner for the session.
   A setting comes with W-12.

---

### W-14 — New file, New file here, Fork this file

**Model:** sonnet (high) · **Size:** M · **Review:** **adversarial** (it writes beside the reader's files) · **Depends on:**
E-13, W-05, W-08 (merged); **Q-06** (both edit `sidebar-view.ts`) · **Parallel with:** W-10

**Outcome.** Three ways to start a file, folded or unfolded, from the toolbar's **+**, the tab bar's **+** and the
palette:
- **New file** (`⌘N`) opens an untitled scratch document that writes nothing until *Save As* (E-13).
- **New file here**, from a folder row's menu in the sidebar, does the same, and its *Save As* opens in that folder.
- **Fork this file** (`⇧⌘N`) writes the open file's bytes, as on disk plus any unsaved edits, beside it as
  `name (fork).md`, then `(fork 2)`, never over an existing file. It opens the fork in a new tab, and the notice says where
  it was written and offers *Reveal in Finder*.

The **+** menus list the three, plus *Open File…*, and each item that cannot run now is not drawn. For example, *Fork*
needs an open file. Once `document.new-menu` exists, the toolbar's declared `new` door is drawn.

**Paths.**
- New: `apps/desktop/src/document/fork.ts` (`forkPath`, beside `conflictCopyPath`; the write through the same
  check-then-write as `writeCopy`) and `apps/desktop/src/document/fork.test.ts`, `apps/desktop/test/new-file.test.mjs`
  (WebKit).
- Edit:
  - `apps/desktop/src/commands/document.ts` (`document.new`, `document.new-here`, `document.fork`, `document.new-menu`;
    the menu on the verb menu's component, `selection/verb-menu.ts`);
  - `apps/desktop/src/workspace/tabs-view.ts` (the **+**);
  - `apps/desktop/src/workspace/sidebar-view.ts` (a folder row's menu with *New file here*);
  - `apps/desktop/test/no-displacement.test.mjs` (`SURFACES`: the New menu);
  - `docs/design/09-app-shell.md` (§Keyboard map, §Sidebar).
- Read: `apps/desktop/src/document/store.ts` (`conflictCopyPath`, `writeCopy`), `apps/desktop/src/document/scratch.ts`,
  `apps/desktop/src/document/save-as-guard.ts`, `apps/desktop/src/workspace/toolbar.ts` (`TOOLBAR_ITEMS`),
  `02-fold-up-workspace.md` §New and fork, `mock-v2/01-workspace.md` (the + menus).

**Acceptance.**
- `fork.test.ts`:
  - `notes.md` gives `notes (fork).md`, then `(fork 2)` when that exists;
  - a dotfile and a name with no extension take the tag last;
  - the fork's bytes equal the buffer, BOM and line endings included;
  - a failed write leaves nothing.
  - Fails on `main`: no module.
- Adversarial: with `x (fork).md` present, *Fork* never calls `writeFileAtomic` on it (the shell's write log), and the
  original's bytes are unchanged.
- In WebKit, `⌘N` folded opens a scratch document, and closing it writes nothing. *New file here* on a sidebar folder
  opens *Save As* in that folder. The toolbar's **+** is drawn once its command exists (`new-file.test.mjs`;
  `toolbar-items.test.ts` with the real command in place of its stub).
- `keys-table.test.mjs` passes with `Mod+N` and `Mod+Shift+N` owned once.
- The New menu opening and closing moves nothing (`no-displacement.test.mjs`).
- **Pair:** `01-unfolded` with the toolbar's **+** menu open beside the mock's tab-bar menu, Night and Paper (question 4).

**Do not.**
- Delete a fork as an *Undo* (question 2).
- Write a file for *New file* before *Save As*.
- Add a `shell-api` capability.
- Name a file from its first heading (question 3).

**Questions for the author.**
1. `⇧⌘N` is *Fork* in 02 and *New Window* in the mock's menu bar. *Recommended:* *Fork*. Marxy is one window (main.rs's
   Close Window comment), so *New Window* has nothing to do.
2. 02 promises "undo in the confirmation" for a fork. Undoing a written file means deleting it, and `shell-api` has no
   delete; adding one is a new privileged capability (ADR-0045). *Recommended:* no undo. The notice names the file and
   offers *Reveal in Finder*, and the fork is an ordinary file the reader can remove.
3. Should *New file here* name the file from its first heading at save? *Recommended:* no. *Save As* opens in the folder
   with `Untitled.md`, and the reader names it.
4. The New menu has no screen in `mock-pair.mjs`. *Recommended:* capture the pair with the menu opened by hand on
   `01-unfolded`; W-10 adds a screen to the harness in the same lane step, and this card does not edit it.

---

### W-20 — The native menu bar: every command findable, every shortcut checked

**Model:** sonnet (medium) · **Size:** M · **Review:** lead; ADR-0011's menu note amended by ADR-0073 (accepted 2026-10-12) · **Depends
on:** W-19 (merged); **W-14** (lane order; its keys appear here); **V-08** (its keys appear here)
· **Parallel with:** V-06

**Outcome.** The macOS menu bar grows from seven items to the mock's menus, cut to the commands that exist:
- **Marxy:** About, Hide, Quit.
- **File:** New File, Fork This File, Open File…, Add This Folder to the Collection, Save, Save As…, Close Window.
- **Edit:** Undo to Select All, plus Find, Replace…, Copy As…, Transform….
- **Format:** V-08's commands, offered in Source on Markdown.
- **View:** Read, Split, Source, Toggle Rendered / Source, Sidebar, Inspector, Outline, Fold or Unfold the Workspace,
  Show Whitespace, Line Numbers, Column Guide.
- **Go:** Back, Forward, Open Quickly…. *Go to Next Note* joins when V-04 lands, one line in the table.
- **Window:** Minimize, Zoom.
- **Help:** Keyboard Shortcuts, which opens the palette on commands.

Each item shows the command's own key, and a click runs that command on the focused pane, the same as its key or its
palette row. An item that cannot run now is disabled, never hidden, so the menus do not jump. No two items share a key,
and none takes a system-wide macOS shortcut: a test fails if one does. Linux keeps no menu bar, as today.

**Paths.**
- Edit:
  - `apps/desktop/src-tauri/src/main.rs` (`mod app_menu`: the `MENU` table; an `Action::Command` whose id names a
    registry command; `action_for`) and its Rust test;
  - `apps/desktop/src/menu/menu-commands.ts` (a click with a command id runs that command through the registry with the
    focused pane's context, rather than replaying a chord; the four chord items keep working) and
    `apps/desktop/src/menu/menu-commands.test.ts`;
  - `apps/desktop/test/keys-table.test.mjs` (`MENU_OWNERS`: every item, each accelerator equal to its command's key);
  - `docs/adr/0011-palette-not-tabs.md`: its menu note is already amended by ADR-0073 (X-28, 2026-10-12); read, not
    written;
  - `docs/design/06-shell.md` (§The native menu, a new section);
  - `docs/design/09-app-shell.md` (§Keyboard map: the menu column).
- Read: `apps/desktop/src/commands/registry.ts`, `apps/desktop/src/palette/chords.ts`, `apps/desktop/src/pane/keys.ts`,
  `mock-v2/09-macos.md` §2 Menu bar.

**Acceptance.**
- The Rust test checks that every `Own` item's id resolves to an action and that no two items share an accelerator. Fails
  on `main` for the new ids.
- `keys-table.test.mjs`: each menu item's accelerator equals its registry command's key on macOS; none is in the test's
  list of system-wide shortcuts (`⌘Space`, `⌃⌘Q`, `⌘⇥` and the others it names); no chord has two owners.
- `menu-commands.test.ts`: a click on *Bold* with a Source pane focused wraps the selection, which a replayed chord on
  `document` could not do. A click on an item whose `when` is false runs nothing.
- The built app's menu matches the table (the Rust test reads `MENU`, the menu built from it, as today).
- **Pair:** none from the mock's pages (the menu is native). The PR attaches a screenshot of each menu beside the mock's
  `09-macos.md` table rows it implements.

**Do not.**
- List open documents, tabs or windows in the menu.
- Add Open Recent, Export, Share, Services entries or the mock's items whose commands do not exist.
- Add keys a command does not already have (depth folding keeps none, K-10a).
- Build a menu on Linux.

**Questions for the author.**
1. ADR-0011's menu note (MARXY-342) says "no tab list or document-specific command is
   added to the menu". The mock's menus are mostly document commands. *Recommended:* amend the note so the menu may list
   any registry command with the key the registry gives it, and still never a list of documents, tabs or windows. The
   palette stays the document manager, and ADR-0011's decision and reversal criterion are untouched.
2. Close Window: `⌘W` today, `⇧⌘W` in the mock (where `⌘W` closes a tab). *Recommended:* keep `⌘W` for Close Window until
   tabs have their own close command and key. Closing the one window quits, as today.
3. Disabled or hidden when an item cannot run? *Recommended:* disabled, as the Mac does, so the menus keep their shape.

**Ruled 2026-10-12:** all three as recommended (the author: "recommended approved"). ADR-0073 (accepted) amends ADR-0011's
menu note: any registry command with its registry key, never a list of documents, tabs or windows. Close Window keeps
`⌘W` until tabs have their own close; an item that cannot run is disabled, not hidden. The card no longer waits on a
ruling.

---

## Dependencies and the dispatch order

**Outside this wave.** Wave 9's kinds lane (K-08 running; K-20, K-09, K-10b after it) holds `packages/theme/src/base.css`,
`packages/theme/default/theme.css`, `scripts/registry.json`, `scripts/mock-pair.mjs`, `apps/desktop/src/commands/index.ts`,
`apps/desktop/src/workspace/strip.ts`, `packages/core/src/index-model/file-types.ts`, the parser choice in
`apps/desktop/src/document/store.ts`, and (K-10b) `SURFACES` in `no-displacement.test.mjs`. Wave 10's first step uses none
of them. The steps from 2 on start when that lane has merged. K-10b's ADR is ADR-0071, so V-06's record is ADR-0072.

**Three lanes; at most three wave-10 stories in flight; never two on one file.** Lane A is the inspector and the status
bar. Lane B is Source. Lane C is the library, new files and the menu.

The lanes keep the approved order, with one change: lane C runs Q-06 before W-14. W-14 edits `09-app-shell.md`, the file
V-08 and W-11 edit in the first two steps, while Q-06 shares no file with V-08 or the kinds lane, so it can start at once.

A story starts only when the one before it in its lane has merged and nothing running shares a file with it. The hot files
are `base.css` with `registry.json` (W-11, W-10, V-06, V-04), `09-app-shell.md` (W-11, V-08, W-14, V-04, W-20),
`mock-pair.mjs` (W-10, V-06), `fill.ts` (lane A), `editor.ts` (V-08, V-03), `source-view.ts` (V-08, V-04),
`sidebar-view.ts` (Q-06, W-14), `SURFACES` (V-03, W-14) and `keys-table.test.mjs` (W-20 only).

| Step | Lane A | Lane B | Lane C | Starts when | Files the running stories share |
| --- | --- | --- | --- | --- | --- |
| 1 | — | V-08 | Q-06 | now, beside wave 9's kinds lane | none |
| 2 | W-11 | V-03 (after V-08) | — | the kinds lane and V-08 have merged | none (W-11 holds `base.css`, `registry.json`, `09-app-shell.md`; V-03 holds `editor.ts`, `find.ts`, `SURFACES`) |
| 3 | W-10 (after W-11) | — | W-14 (after Q-06 and V-03) | W-11 and V-03 have merged | none (W-10 holds `base.css`, `registry.json`, `mock-pair.mjs`; W-14 holds `09-app-shell.md`, `sidebar-view.ts`, `SURFACES`) |
| 4 | V-06 (after W-10; ADR-0072 accepted) | — | W-20 (after W-14; ADR-0073 accepted) | W-10 and W-14 have merged | none |
| 5 | — | V-04 (after V-03 and V-06) | — | V-06 has merged | — |

At most two Opus stories run at once, counting the kinds lane: Q-06 beside K-08 or K-20 in step 1, V-03 in step 2, and
V-06 in step 4. A blocked card does not hold its lane's other work: if ADR-0072 is not ruled by step 4, V-04 moves up into
step 4 beside W-20 (they share only `09-app-shell.md`, so W-20 waits for it), and V-06 runs last. A story that finds it
must touch a file another running story holds stops and waits, rather than editing in parallel.

**The author's questions, in one place.** W-11: 1 to 3; W-10: 1 to 3; V-06: 1 to 4; V-08: 1 to 3; V-03: 1, 2; V-04: 1,
2; Q-06: 1, 2; W-14: 1 to 4; W-20: 1 to 3. Each card proceeds on its recommended default unless the author says
otherwise. The two questions that blocked their cards were ruled on 2026-10-12, as recommended:
- **V-06 question 1:** where local versions live: ADR-0072, accepted.
- **W-20 question 1:** ADR-0011's menu note: ADR-0073, accepted.

Q-06 question 1 would block only if the author chose a persisted content signature, which would amend ADR-0012.
