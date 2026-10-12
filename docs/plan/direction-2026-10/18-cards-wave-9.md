# Cards for wave 9: more themes, five kinds read properly, and the sidebar's trees

**In short.** Wave 9 cards the eight stories `roadmap-2026-10/waves.md` left under "Not yet carded": the themes
(H-05), five kinds read as their kind (K-20 article byline and dek, K-08 log, K-09 diff, K-10 data, K-11 Markdown
transcript), and the rest of the sidebar (W-08 Repositories and Folders, Q-07 smart collections). K-10 is two cards,
K-10a (the depth lens, small) and K-10b (the table lens, large, with an ADR amendment), so nine cards in all. Each card
was written against `origin/main` at `9cc0fcac`: every Path was checked with `git ls-files` (*new* marks a file that does
not exist) and every function named was found with `git grep`. The source lines are in [05-plan.md](05-plan.md); the
reading defaults are `docs/research/reader-artifacts/10-spec.md` and `docs/research/reader-typography/10-spec.md`.

| Id | What | Model / effort | Size | Review | Mock screen (ADR-0070 pair) |
| --- | --- | --- | --- | --- | --- |
| H-05 | Ink made reachable; Dusk and Sepia, Fjord, HC dark and HC light | sonnet / high | M | lead; contrast gate | `01-unfolded`, `03-code` in each new theme |
| K-20 | An article's byline and dek, from its front matter | opus / medium | M | lead | `03-article` (*new screen*) |
| K-11 | A Markdown transcript: speakers outdented, turns spaced | sonnet / medium | M | lead | `03-transcript` (*new screen*) |
| K-08 | A log: opens in Read, level words, timestamps, escapes shown, level filter | opus / high | M | lead | `03-log` (*new screen*) |
| K-09 | A diff: opens in Read, unified as authored, tinted | sonnet / medium | S | lead | none: the mock has no diff page (question) |
| K-10a | Data: the depth lens in Source | sonnet / medium | S | lead | none: the mock has no JSON page (before/after instead) |
| K-10b | Data: the table lens for CSV and TSV | opus / high | L | lead; the ADR-0061 amendment first | `03-data` (*new screen*) |
| W-08 | The sidebar's Repositories and Folders, as lazy trees | opus / medium | M | lead | `01-unfolded` |
| Q-07 | Smart collections in the sidebar; Save as smart collection | sonnet / high | M | **adversarial** (writes `collection.toml`) | `01-unfolded`, `05-library` |

**What `main` already has, and what it constrains.**
- **Kinds.** `detectKind` (`packages/core/src/kind/detect.ts:290`, K-03) already decides `log`, `diff`, `data` and
  `transcript` from extension and shape, and `article` from a byline (tier 5: `author` with `published` or `source`).
  The fourteen kinds are a contract (`packages/core/src/contracts/kinds.ts`); no card here adds one.
- **Opening mode.** The mode is the file-type table's, not the kind's: `defaultModeForPath`
  (`apps/desktop/src/source/default-mode.ts`) reads `fileTypeOf` (`packages/core/src/index-model/file-types.ts`), and its
  comment says no file's opening mode changes until its kind's own story lands. `.log` is `src()` there (opens in Source);
  `.diff` and `.patch` have **no row at all**. `03-kinds-and-the-look.md` says log and diff open in Read and data in
  Source. K-08 and K-09 are the stories that change those rows.
- **Rendered of a non-Markdown file is the Markdown parse of its bytes.** `parsed()` in `apps/desktop/src/document/store.ts`
  calls `parseMarkdown` for every path, so a log line starting `#` becomes a heading in Read. V-10 (carded in
  `13-code-view.md`, ready, not merged) adds `parseCode` and builds a code file as code blocks of at most 200 lines. **K-08
  and K-09 build on V-10** and do not invent a second builder.
- **Fence-level work exists.** `packages/core/src/highlight/line-classes.ts` gives a diff fence its line tints
  (`lineClassForFenceLine`), a `log` fence weight 700 on its level words (`logLevelClassForToken`), and a diff row its 1ch hang
  (`diffMarkerIndentCh`); `base.css:482` styles `.marxy-diff-*` and gives them a border under forced colours. The research
  spec's "Diff colour: Open, renders monochrome" is stale on this point. C0 controls, ESC among them, are already flagged by
  `isC0C1Control` (`packages/core/src/render/invisibles.ts:28`) with a hex label.
- **Profiles.** `packages/theme/default/theme.css` has `[data-marxy-kind]` profiles for `article`, `readme` and `report`
  only (K-05b). Every kind card here adds its own block there.
- **The strip.** `STRIP_TOOLS` (`apps/desktop/src/workspace/strip.ts`) lists each kind's tools with `command: null` until a
  story registers the command; `toolsFor` draws only registered ones (U-09 merged the look). K-08 and K-10b fill rows; no card
  draws a tool whose command it does not build.
- **Themes.** The app ships one theme: `defaultThemeCss()` (`packages/theme/scripts/inline.mjs`) is inlined by
  `apps/desktop/vite.config.ts`. `packages/theme/ink/` exists (H-04) but **no build step bundles it**, so a reader cannot
  choose Ink today except by pointing `theme =` in `config.toml` at a copy. `theme` is a directory path
  (`resolveThemeDir`, `apps/desktop/src/theme/user-theme.ts`); `writeReaderKey` (`apps/desktop/src/theme/reader-config.ts:184`)
  writes `variant`, `size`, `line_numbers` and `chrome_size` faithfully, and `commands/appearance.ts` already offers *Use light
  variant* and *Use dark variant*. `gate-contrast.mjs` audits every `packages/theme/<dir>` with a `theme.css` (`findThemes`),
  so a new directory is gated with no wiring. V-13 (merged) set every code role in the default theme and Ink.
- **The sidebar.** W-07 and U-06 (merged) draw Recent and Pinned · Changed (`sidebarSections`, `mountSidebar` in
  `apps/desktop/src/workspace/sidebar-view.ts`); collapsed ids live in `workspace.json` (`SIDEBAR_SECTION_IDS`,
  `packages/core/src/layout/workspace-storage.ts:31`). The shell already has what a tree needs: `readDir` (one level, deny list
  applied, symlinks omitted), `repositoryRoot`, and C-15's checkout grouping (`checkoutOf`, `gitGroupKey`;
  `IndexService.checkoutKey`, `roots()`, `isWatched`).
- **The library.** Q-03 and U-10 (merged) give `libraryFor(handle).open({ scope, query })` (`apps/desktop/src/library/view.ts`).
  Q-01's `appendQuery` (`packages/core/src/index-model/collection.ts:265`) appends a `[[query]]` byte-faithfully and **still
  has no caller**. `is:dup` and `is:broken` parse but match nothing until Q-06 (`UNAVAILABLE_STATUSES`,
  `packages/core/src/index-model/query-eval.ts:181`).
- **ADR-0061 admits exactly one deriver** (`jsonl-transcript`, K-12). A table lens that shows a CSV field decoded (`"a ""b"""`
  as `a "b"`) is a second derived view and needs the record amended. That is why K-10 splits.

**The rules every card keeps.** A fact a surface shows is read from live state and changes when the state does. A control
with nothing behind it is not drawn (W-05's door rule). Nothing is inserted into the document's flow (the author, 2026-10-12):
a kind's look restyles the blocks the bytes make. Reshaping in Rendered is marked, and Source is one action away
(commitment 4). Every UI card ships the app-beside-mock pair (ADR-0070) through `scripts/mock-pair.mjs` and adds any new surface
to `SURFACES` in `apps/desktop/test/no-displacement.test.mjs`. Every acceptance line names a test or gate that fails on `main`.

---

### H-05 — More themes: Ink made reachable; Dusk and Sepia, Fjord, HC dark and HC light

**Model:** sonnet (high) · **Size:** M · **Review:** lead; `gate:contrast` is the floor · **Depends on:** H-04, V-13 (merged)
· **Parallel with:** W-08 (no shared file)

**Outcome.** The reader can choose any bundled theme from the palette, and the choice is remembered in `config.toml`. Four
directories ship: `ink` (exists: Ink dark, its old light), `warm` (Dusk dark, Sepia light), `fjord` (Fjord, dark only) and
`high-contrast` (HC dark, HC light), with the values of `mock-v2/shared/tokens.css` (`[data-theme="dusk"]` and the others)
carried into every contract-2 role, the code roles V-13 added included. Each set of colours passes `gate:contrast`; the
high-contrast pair passes a stricter floor (question 3). The palette offers *Theme: Night and Paper*, *Theme: Ink*,
*Theme: Dusk and Sepia*, *Theme: Fjord*, *Theme: High contrast*; the current one is not offered. A user theme directory
keeps working exactly as today.

**Paths.**
- New: `packages/theme/warm/theme.css`, `packages/theme/warm/theme.toml`, `packages/theme/fjord/theme.css`,
  `packages/theme/fjord/theme.toml`, `packages/theme/high-contrast/theme.css`, `packages/theme/high-contrast/theme.toml`,
  `apps/desktop/src/theme/bundled-themes.ts` (the bundled CSS by name, imported `?inline` so only the chosen one is applied;
  nothing is fetched).
- Edit: `apps/desktop/src/theme/user-theme.ts` (`resolveThemeDir`, `startUserTheme`: a bundled name resolves to the bundled
  CSS), `apps/desktop/src/theme/app-config.ts` (`themeDir`), `apps/desktop/src/theme/reader-config.ts` (`writeReaderKey` takes
  `theme`), `apps/desktop/src/commands/appearance.ts` (the theme commands, beside the variant ones: no edit to
  `commands/index.ts`), `scripts/gate-contrast.mjs` (`FLOORS`: the high-contrast rows) and `scripts/gate-contrast.test.mjs`,
  `scripts/mock-pair.mjs` (`THEMES`: the six new ids, the app side writing `theme =`) and `scripts/mock-pair.test.mjs`,
  `packages/theme/test/palettes.test.mjs` (its `['default', 'ink']` list), `docs/design/05-theme.md` (§Bundled themes).
- Read: `packages/theme/src/loader.ts` (`loadTheme`, `applyTheme`, the `variants` manifest), `packages/theme/scripts/inline.mjs`,
  `packages/theme/ink/theme.css`, `docs/plan/direction-2026-10/mock-v2/shared/tokens.css`, `03-kinds-and-the-look.md` §The look.

**Acceptance.**
- `pnpm gate:contrast` audits five theme directories and passes; a value lowered below its floor in `warm/theme.css` fails
  it (`gate-contrast.test.mjs`, a fixture theme).
- *Theme: Dusk and Sepia* from the palette applies Dusk on a dark system and Sepia on a light one, and writes only the
  `theme` line of `config.toml` (a node test over `writeReaderKey`: every other byte of a commented config is unchanged).
  Fails on `main`: no such command.
- A launch with `theme = "warm"` paints the first text in Dusk with no flash of Night (the existing first-paint test, one
  new case).
- A `theme` that names a user directory still loads it (the user-theme tests, unchanged and passing).
- Fjord under `variant = "light"` does what question 2 rules, and says so in the command's title.
- The release bundle grows by the four CSS files only (`pnpm check`'s bundle import graph names them).
- **Pair:** `01-unfolded` and `03-code`, in Ink, Dusk, Sepia, Fjord, HC dark and HC light, each beside the mock's theme.

**Do not.** Build the theme page, Compare or import (K-16); add the system's Increase contrast as a trigger (W-22); edit
`default/theme.css` (Night and Paper are ruled); bundle a font no theme uses.

**Questions for the author.**
1. How does `config.toml` name a bundled theme, given `theme` is a path today and a relative path resolves beside the
   config file? *Recommended:* a bare name with no `/` that matches a bundled directory (`ink`, `warm`, `fjord`,
   `high-contrast`) is the bundled theme; a directory of that name beside `config.toml` still wins, and the notice says which
   was used.
2. Fjord has no light variant. What happens when the reader's variant is light? *Recommended:* Fjord applies as dark
   whatever the variant, and the command reads *Theme: Fjord (dark only)*.
3. What floor does high contrast hold? *Recommended:* 7:1 for every text role and code role on every ground it meets, 4.5:1
   for edges, against today's 4.5:1 and 3:1.
4. Do Ink's light block and Sepia both ship, when `03-kinds-and-the-look.md` lists Ink as dark only? *Recommended:* yes; Ink
   keeps the light block H-04 gave it, unchanged.

---

### K-20 — Read an article: the byline and the dek, from its front matter

**Model:** opus (medium) · **Size:** M · **Review:** lead · **Depends on:** K-05b (merged); the answers to questions 1 and 2
· **Parallel with:** V-10, Q-07

**Outcome.** An `article` whose front matter names an author shows a **byline** (author, date, the source's host) and,
when there is one, a **dek**, set in the article profile's voice instead of the quiet key and value head. Both are the
front-matter block's own rendering, in its own place: nothing is inserted into the flow, every key the head showed is still
shown (the byline's keys as the byline, the rest in the head beneath it), and values are the bytes as written apart from
question 3. The source's host is a link whose real target shows as every link's does. Other kinds' heads are unchanged.

**Paths.**
- Edit: `packages/core/src/render/frontmatter.ts` (`frontmatterRows`, `renderFrontmatterHead`: each row gains
  `data-marxy-fm-key`, and the byline keys are grouped first; no change for a document with no byline keys) and
  `packages/core/src/render/frontmatter.test.ts`, `packages/core/src/render/contract.test.ts` (the `frontmatter` row of the render
  contract), `packages/theme/default/theme.css` (`[data-marxy-kind="article"]`: the byline and dek), `scripts/registry.json`
  (`dataAttributes`: `data-marxy-fm-key`), `scripts/mock-pair.mjs` (`SCREENS`: `03-article`, the mock's `#doc=ragged-right`),
  `docs/design/02-render.md` (§Front matter).
- New: `fixtures/corpus/33-article-byline.md` and its golden under `packages/core/goldens/`.
- Read: `packages/core/src/kind/detect.ts` (tier 5's keys), `apps/desktop/src/render/link-dest.ts`, `mock-v2/03-content-modes.md`
  §Article, `mock-v2/TYPOGRAPHY.md` (article), `docs/research/reader-artifacts/10-spec.md` (Front matter is shown).

**Acceptance.**
- The fixture's head renders with `data-marxy-fm-key` on each row and its byline keys first; the golden and
  `pnpm gate:fidelity` pass. Fails on `main`: no key attribute.
- In WebKit, an `article` with `author`, `published` and `source` shows one byline line and no `author:` label, and the
  count of keys shown (byline plus head) equals the count in the bytes (a new case in the render test).
- A `report` with the same front matter keeps today's head (the same test).
- Copying the byline copies the values as the bytes hold them (question 3 decides the quotes).
- **Pair:** `03-article`, Night and Paper.

**Do not.** Add reading time (W-16 owns the one measure formatter); add pull quotes, margin notes or the progress line (W-23);
reorder blocks; parse a date into another format.

**Questions for the author.**
1. Where do the byline and dek sit? The front matter precedes the title in the bytes, and the mock draws headline, dek,
   then byline. *Recommended:* where the front matter is, above the title, so the page reads in the bytes' order; the mock's
   order would be a visual reorder that selection and Source would disagree with.
2. Ruling 21 keeps the front-matter head as it is until W-17. Is restyling the byline keys as a byline within that ruling?
   *Recommended:* yes, for `article` only; the keys stay on the page and the head keeps every other row.
3. A quoted YAML value (`author: "M. Ellery"`) shows its quotes in the head today. In the byline? *Recommended:* drop one
   pair of matching outer quotes in the byline only; everything else verbatim.
4. Which keys make the dek? The mock's article has no dek key; its dek is an opening italic paragraph. *Recommended:* a
   `description`, `dek` or `subtitle` key; an opening paragraph wholly in emphasis directly after the title gets the dek's
   style as a block restyle; never both on one page (the key wins).

---

### K-11 — Read a Markdown transcript: speakers outdented, turns spaced

**Model:** sonnet (medium) · **Size:** M · **Review:** lead · **Depends on:** K-05b (merged) · **Parallel with:** Q-07

**Outcome.** In a `transcript` (Markdown with speaker headings, as `detectKind` decides), each speaker heading is set as an
**outdented label** in small capitals left of the turn, the turn's text keeps the 66-character measure (76 with the speaker
column), exchanges are 30 px apart and paragraphs within a turn 15 px (research, "Speaker labels"). Your turns are slightly
heavier. Colour never carries the speaker: the label is the heading's own text. Nothing is folded at rest.

**Paths.**
- Edit: `packages/core/src/kind/detect.ts` (export one `speakerOf(headingText)` built on today's `SPEAKERS` and `headingText`, so
  detection and rendering share one rule) and `packages/core/src/kind/detect.test.ts`, `packages/core/src/render/render-html.ts`
  (a heading whose text `speakerOf` names gains `data-marxy-speaker="<role>"`, in every kind; only the transcript profile styles
  it), `packages/core/src/render/contract.test.ts`, `packages/theme/default/theme.css` (`[data-marxy-kind="transcript"]`: the
  profile and the label), `scripts/registry.json` (`dataAttributes`: `data-marxy-speaker`), `scripts/mock-pair.mjs` (`SCREENS`:
  `03-transcript`, the mock's `#doc=indexer-chat`), `docs/design/02-render.md`.
- New: `fixtures/corpus/34-chat-transcript.md` (You, Assistant and Tool turns; `18-agent-transcript.md` has no speaker headings)
  and its golden.
- Read: `mock-v2/03-content-modes.md` §Transcript, `03-kinds-and-the-look.md` (the transcript profile row).

**Acceptance.**
- `speakerOf` is one table test that `detectKind`'s goldens also pass through (the K-03 corpus goldens unchanged, or changed
  only as question 1 rules, regenerated in the PR).
- In WebKit the label's left edge sits left of the turn's text and the text column's left edge equals an article's (a
  geometry test). Fails on `main`: no attribute, no rule.
- The fixture renders with its headings still `h2` elements with their own text; the outline lists them as today.
- Under `forced-colors: active` the labels remain distinguishable (the existing forced-colours case, one more page).
- **Pair:** `03-transcript`, Night and Paper.

**Do not.** Fold tool output (question 2); read JSONL (K-12); add the prompts rail (K-14); change what `detectKind` decides
beyond question 1.

**Questions for the author.**
1. The mock's transcript heads tool turns `### Tool · bash`; `detectKind` counts a speaker heading only when its whole text is
   the word. Does `Tool · bash` count? *Recommended:* yes: a speaker word alone, or followed by ` · `, `: ` or ` — ` and a name,
   in both detection and rendering.
2. Do *Collapse tools*, *Only you* and *Only assistant* (the strip's transcript row) come in this card? They hide text, so
   each needs a marked placeholder. *Recommended:* not in K-11; a follow-up K-11.1 once the author has seen the labels.

---

### K-08 — Read a log: Read by default, level words, timestamps, escapes shown, and a level filter

**Model:** opus (high) · **Size:** M · **Review:** lead · **Depends on:** **V-10** (`parseCode`; merges first), K-05b (merged)
· **Parallel with:** K-10a

**Outcome.** A `.log` or `.out` file opens in **Read**. It reads as mono at 15 on 24, as authored, wrapping with the 2ch
hang (ADR-0033), with line numbers hung in a faint gutter (V-10's). The level word is weight 700, never a hue; the leading
timestamp is in the comment colour; a line at ERROR or above carries a rule at its left edge; stack frames and other
continuation lines stay where they are, never folded. ESC shows as a visible `␛` in the comment colour and is never
interpreted; copy takes the real byte. Two strip tools work: **Filter by level** (All, Info, Warn, Error; a level shows itself and
everything above, and an error keeps its continuation lines) and **Jump to first error**. While a filter is on, each run of
hidden lines is one text line, "14 lines below Warn", which a click shows; the filter is never remembered.

**Paths.**
- Edit: `packages/core/src/index-model/file-types.ts` (`log`, `out`: mode `rendered`) and `file-types.test.ts`,
  `apps/desktop/src/source/default-mode.test.mjs`, the parser choice V-10 adds in `apps/desktop/src/document/store.ts` (`log` to
  `parseCode` with language `log`), `packages/core/src/highlight/line-classes.ts` (a timestamp class from `detect.ts`'s
  `TIMESTAMP`, exported rather than copied; an error-line class) and its test, `packages/core/src/render/invisibles.ts` (ESC as
  `␛`, question 2), `packages/theme/default/theme.css` (`[data-marxy-kind="log"]`), `packages/theme/src/base.css` (the error rule,
  the hidden-run line), `apps/desktop/src/workspace/strip.ts` (`filter-by-level`, `jump-to-first-error`: their commands),
  `apps/desktop/src/commands/index.ts`, `scripts/registry.json` (the classes and `data-marxy-log-hidden`), `scripts/mock-pair.mjs`
  (`SCREENS`: `03-log`, the mock's `#doc=build-log`).
- New: `apps/desktop/src/commands/log.ts` (`log.filter-level`, `log.first-error`), `apps/desktop/src/kinds/log-filter.ts`
  (pure: the lines a level keeps, continuation lines with their head), its node test, `apps/desktop/test/log.test.mjs` (WebKit),
  `fixtures/corpus/35-build.log` and its golden.
- Read: `packages/core/src/highlight/index.ts`, `apps/desktop/src/render/highlight.ts`, `mock-v2/03-content-modes.md` §Log,
  `docs/research/reader-artifacts/03-structured-output.md`.

**Acceptance.**
- `x.log` opens in Read with no `h1` painted from a `# ` line (sampled every frame, as V-11's test does). Fails on `main`: it
  opens in Source, and Read shows a heading.
- The fixture's ERROR word is weight 700 and the same colour as the line's text; its timestamp has the comment colour; its
  stack frames are present and unfolded (`log.test.mjs`).
- An ESC byte shows `␛`; copying that line puts `0x1b` on the clipboard (the memory shell's clipboard).
- *Filter by level: Warn* on the fixture leaves only WARN and ERROR lines with their frames, plus text lines naming the hidden
  counts, which sum to the hidden lines; a reload while filtered recounts (live state). `log-filter.test.ts` is the table.
- The strip shows exactly the two tools (`strip.test.ts`); *Wrap* and *Follow tail* are not drawn.
- A 20 MB log's first text arrives without waiting for the last chunk (record the number, as V-10 does).
- **Pair:** `03-log`, Night and Paper.

**Do not.** Follow the tail (P-01); draw the log bar with counts (question 1); add a `log` grammar to Source; colour a level.

**Questions for the author.**
1. The mock draws a bar above the log: name, line count, error and warning counts, the level toggles. Draw it here, or leave
   the strip as the only door until K-14's per-kind layouts? *Recommended:* the strip only, here.
2. ESC as `␛` (research, mock) where every other C0 control shows its hex label. *Recommended:* `␛` for ESC everywhere in
   Rendered, the hex label kept for the rest.
3. Default mode for `.out`, which is often not a log. *Recommended:* Read, as `.log`; `detectKind` already falls back from its
   shape.

---

### K-09 — Read a diff: Read by default, unified as authored, tinted

**Model:** sonnet (medium) · **Size:** S (smaller than 05-plan's M: the fence work exists) · **Review:** lead · **Depends on:**
**V-10**, K-05b (merged) · **Parallel with:** K-10b

**Outcome.** A `.diff` or `.patch` opens in **Read** (and is offered by the open dialog and the index, as other table rows
are). It is set mono at 16 on 26, one column, exactly as authored: `+`, `-` and space stay in column one and in the clipboard,
added and removed lines take the theme's tints as a second channel, hunk headers and `\ No newline at end of file` stay in
the code colour, and a wrapped row hangs past the marker column. All of this is what a ```` ```diff ```` fence already gets
(`lineClassForFenceLine`, `diffMarkerIndentCh`), now for a whole file.

**Paths.**
- Edit: `packages/core/src/index-model/file-types.ts` (rows `diff`, `patch`: mode `rendered`, indexed) and its test, the parser
  choice in `apps/desktop/src/document/store.ts` (language `diff`), `packages/theme/default/theme.css`
  (`[data-marxy-kind="diff"]`), `apps/desktop/src/source/default-mode.test.mjs`.
- New: `fixtures/corpus/36-change.diff` (two files, three hunks, a `\ No newline`) and its golden,
  `apps/desktop/test/diff-file.test.mjs` (WebKit).
- Read: `packages/core/src/highlight/line-classes.ts`, `docs/research/reader-artifacts/05-diffs-provenance.md`.

**Acceptance.**
- `x.patch` opens in Read; on `main` it is not in the table (`file-types.test.ts`, `default-mode.test.mjs`).
- Every `+` line has `marxy-diff-add`, every `-` line `marxy-diff-del`, `@@` lines neither; copying a hunk returns its bytes
  exactly (`diff-file.test.mjs`).
- A wrapped `+` row's second line starts right of the marker column (a geometry case).
- Under `forced-colors: active` added and removed rows differ by border style (base.css's rule, now reached by a file).
- **Pair:** none from the mock (it has no diff page); the PR attaches Read of the fixture in Night and Paper and the
  reviewer judges it against the research spec's tints.

**Do not.** Compute a diff, convert to split, or add word tints (question 2); edit `line-classes.ts`.

**Questions for the author.**
1. A diff of many files: should the outline list its files? Today the outline reads headings and a code file has none, so it
   shows nothing (V-10's rule). *Recommended:* not in K-09; K-14's per-kind layouts.
2. Word-level tints exist as tokens (`--marxy-color-diff-*-word`) but are computed, not authored. *Recommended:* off; render
   what was authored.

---

### K-10a — Read data: the depth lens in Source

**Model:** sonnet (medium) · **Size:** S · **Review:** lead · **Depends on:** V-12 (merged) · **Parallel with:** K-08 (no
shared file)

**Outcome.** In Source, a JSON or YAML file can be folded **to a depth**: palette commands *Fold to depth 1* to *4* and
*Unfold all*, offered only when the file has a syntax tree and folding is on (not for TOML, whose mode has no tree, nor for a
file over `LARGE_FILE_BYTES`, which gets no folding). A fold's placeholder is text naming what it hides, "… 42 lines", in place of
today's bare `…`, for every fold in Source. Nothing is folded at rest and no fold is remembered (research: view-only, never
persisted).

**Paths.**
- New: `apps/desktop/src/source/depth-fold.ts` (the ranges at a depth from the syntax tree; pure over a `state`), its node
  test, `apps/desktop/test/depth-fold.test.mjs` (WebKit, the Source harness).
- Edit: `apps/desktop/src/source/editor.ts` (`foldingExtensions`: the counted placeholder),
  `apps/desktop/src/commands/source-view.ts` (the five commands, beside *Toggle line numbers*: no edit to `commands/index.ts`).
- Read: `apps/desktop/src/source/language.ts` (which languages have trees), `docs/research/reader-artifacts/03-structured-output.md`.

**Acceptance.**
- A 544-line pretty-printed JSON at depth 2 shows 64 lines or fewer, each fold says its count, and the buffer's bytes are
  unchanged (`depth-fold.test.mjs`; fails on `main`: no command).
- *Fold to depth* is absent for a `.toml` and for a file over the large-file limit (`depth-fold.test.ts`).
- Saving after folding writes the bytes read (the store walk's invariants hold; one case).
- **Pair:** none from the mock (no JSON page); before-and-after renders of the fixture at depth 2 in Night and Paper.

**Do not.** Fold fences in Rendered (question 1); add a key (question 2); change the fold gutter.

**Questions for the author.**
1. The research's lens is for a data **fence** in Rendered over 60 lines. Data files open in Source. *Recommended:* Source
   only here; a fence can be opened in Source in place (E-04).
2. Keys for depth 1 to 4? *Recommended:* none until W-20's menu bar checks conflicts; the palette only.

---

### K-10b — Read data: the table lens for CSV and TSV

**Model:** opus (high) · **Size:** L · **Review:** lead; **the ADR-0061 amendment is ruled before code** · **Depends on:**
V-10 (both edit `base.css`), the answer to question 1 · **Parallel with:** K-09

**Outcome.** On a `.csv` or `.tsv`, the strip's **Table** tool (and a palette command) swaps the pane's Source for a
**grid**: row numbers, a sticky header row, numbers right-aligned in tabular figures, identifiers in mono, each column sortable by
its header (the order is the view's, never written). **Column stats** (min, max, mean, count, empty) show for a column on
request. Esc or the tool again returns to Source at the same row. The first rows show before the file is read to its end
(commitment 5), and a malformed row (an unclosed quote) shows as its raw line, marked, never dropped. The lens never writes.

**Paths.**
- New: `docs/adr/0061-derived-views.md` amendment (or ADR-0071, question 1) admitting a second deriver,
  `delimited-table`; `packages/core/src/data/delimited.ts` (pure: RFC 4180 fields with byte ranges, the delimiter by extension,
  incremental) and its test; `apps/desktop/src/kinds/table-lens.ts` (the grid, virtualised); `apps/desktop/src/commands/data.ts`
  (`data.table-lens`, `data.column-stats`); `apps/desktop/test/table-lens.test.mjs`; `fixtures/corpus/37-results.csv` and an
  awkward twin (quotes, embedded newlines, a ragged row, a BOM).
- Edit: `apps/desktop/src/workspace/strip.ts` (`column-stats` and a `table` tool: the data row has four slots, question 3),
  `apps/desktop/src/commands/index.ts`, `packages/theme/src/base.css` (`.marxy-table-lens`), `scripts/registry.json`,
  `scripts/mock-pair.mjs` (`SCREENS`: `03-data`, the mock's `#doc=bench-csv`), `apps/desktop/test/no-displacement.test.mjs`
  (`SURFACES`), `docs/design/03-selection-and-operations.md` (a `cell` selection, if question 1 is (a)).
- Read: `docs/adr/0061-derived-views.md` (items 2 to 7), `mock-v2/03-content-modes.md` §Data, `apps/desktop/src/library/view.ts`
  (the header-sort pattern U-10 made).

**Acceptance.**
- `delimited.test.ts`: every field's byte range is exact, the fields of a row tile its line, a quoted field's decoding is
  checked by the amended invariant, and an unclosed quote yields one marked raw row (the accounting rule).
- In WebKit the fixture shows a grid whose header stays put on scroll, whose numeric column is right-aligned, and whose sort by
  `cold_ms` orders the rows numerically; the buffer is unchanged and Esc returns to Source at the row (`table-lens.test.mjs`;
  fails on `main`).
- A 50 MB CSV draws its first rows before its last byte is parsed (record the number).
- The stats of a column are recomputed after an external change reloads the file.
- **Pair:** `03-data`, Night and Paper.

**Do not.** Filter, Transpose or Chart (not drawn); Copy as Markdown table or JSON beyond the existing Copy as; edit a cell;
infer a type for anything but alignment and sort.

**Questions for the author.**
1. A quoted field is not a substring of the file. Does the grid show the decoded value (`a "b"`), which amends ADR-0061 with a
   second deriver and a `cell` selection, or the raw field (`"a ""b"""`), which needs no amendment? *Recommended:* decoded,
   with the amendment written and ruled in this story before any grid code.
2. Is the first row a header? *Recommended:* yes when every field in it is non-numeric and distinct; the grid says "Row 1 used
   as header", and one click makes it a data row.
3. The data strip has four slots (Column stats, Filter, Transpose, Chart; at most four). Where does *Table* go? *Recommended:*
   first; Chart drops off the list until it has a story.

---

### W-08 — The sidebar II: Repositories and Folders, as lazy trees

**Model:** opus (medium) · **Size:** M · **Review:** lead · **Depends on:** W-07, U-06, C-15 (merged) · **Parallel with:**
H-05 (no shared file)

**Outcome.** Two sections join the sidebar under Pinned. **Repositories**: every indexed root that is a git repository, by
name, with a branch glyph and a quiet count of its files changed since you read; the worktree checkouts of one repository are
one row (C-15's grouping), with a quiet count of checkouts. **Folders**: every other indexed or declared root. Each row opens
inline as a tree to any depth: chevrons, indentation guides, children read with `readDir` only when a folder opens, folders
first, then files by name, each file with its kind glyph and the changed mark. A file row opens in the focused pane (`⌘`-click
beside). ← and → collapse and expand; the tree is one tab stop with arrow roving. An open folder relists when the index reports
a change under it, so what it shows is the disk. Both sections fold and are remembered like W-07's.

**Paths.**
- New: `apps/desktop/src/workspace/sidebar-tree.ts` (pure: the roots split into repositories and folders, checkout groups,
  sorting, the expanded set) and `apps/desktop/src/workspace/sidebar-tree.test.ts`.
- Edit: `apps/desktop/src/workspace/sidebar.ts` (`SIDEBAR_SECTIONS`), `apps/desktop/src/workspace/sidebar-view.ts`
  (`mountSidebar`: the two sections and the tree rows), `packages/core/src/layout/workspace-storage.ts` (`SIDEBAR_SECTION_IDS`
  gains `repos` and `folders`) and its test, `packages/theme/src/base.css` (the tree rows and guides inside U-06's sidebar block),
  `scripts/registry.json` (`data-marxy-sidebar-tree`, `data-marxy-sidebar-depth`), `apps/desktop/test/sidebar.test.mjs`,
  `docs/design/09-app-shell.md` (§Sidebar), `docs/design/11-config-and-storage.md`.
- Read: `apps/desktop/src/index/service.ts` (`roots`, `checkoutKey`, `isWatched`, `subscribe`), `packages/core/src/index-model/checkout.ts`,
  `apps/desktop/src/palette/fold.ts`, `apps/desktop/src/palette/empty-state.ts` (`changedSinceRead`), `packages/shell-api/src/index.ts`
  (`readDir`, `repositoryRoot`), `mock-v2/01-workspace.md` (Sidebar row and §Collapsible sidebar sections).

**Acceptance.**
- Over the memory shell with a repository, two worktrees of it and a plain folder: one Repositories row with "2 checkouts",
  one Folders row (`sidebar-tree.test.ts`, `sidebar.test.mjs`; fail on `main`).
- Opening a folder calls `readDir` for it and for nothing deeper; a file written into an open folder appears without a click.
- A file changed since its read carries the changed mark, named in its accessible name, never colour alone.
- A collapsed Repositories survives fold, unfold and launch; an unknown id in `workspace.json` is dropped.
- The tree has `role="tree"`, `aria-level` and `aria-expanded`; ← and → act as the mock says.
- **Pair:** `01-unfolded`, Night and Paper.

**Do not.** Draw *New file here* (W-14 registers it; the row appears when it exists); show the branch's name (W-18's git
facts, question 1); read a file to draw a row; remember which folders are open across a launch (question 2).

**Questions for the author.**
1. The branch glyph without the branch's name, until W-18 reads git facts through the shell? *Recommended:* yes; the glyph only
   says "repository", which is true now.
2. Remember which folders are open? *Recommended:* only while the window lives; a launch starts collapsed.
3. `readDir` omits symlinks and deny-listed names without saying how many. *Recommended:* accept it in W-08 and write it in
   `09-app-shell.md`; a count needs a `shell-api` field and is its own small story.

---

### Q-07 — Smart collections in the sidebar, and *Save as smart collection*

**Model:** sonnet (high) · **Size:** M · **Review:** **adversarial** (the first caller of a writer to `collection.toml`) ·
**Depends on:** Q-01, Q-03, U-10, W-07 (merged); **W-08** (both edit the sidebar's files; W-08 lands first) · **Parallel with:**
K-11, K-20

**Outcome.** A **Smart collections** section in the sidebar lists the `[[query]]` tables of `collection.toml`, by name,
each with a quiet count of what it matches now (evaluated from the index on each change, only while the section is open). A row
opens the library with that query (`libraryFor(handle).open({ query })`). In the library, a query with at least one term offers
**Save as smart collection**: a name field, then `appendQuery` writes the table at the end of the file and the row appears.
Each row's menu has *Edit in collection.toml*, which opens the file in Source at that table. A hand edit to the file updates
the section (`loadCollection`'s watch). The built-ins (near-duplicates, broken paths) are not drawn until Q-06 makes `is:dup` and
`is:broken` match.

**Paths.**
- Edit: `apps/desktop/src/workspace/sidebar.ts`, `apps/desktop/src/workspace/sidebar-view.ts`,
  `packages/core/src/layout/workspace-storage.ts` (`smart`) and its test, `apps/desktop/src/library/view.ts` (the Save control,
  reusing Q-03's and U-10's classes and attributes), `apps/desktop/src/collection/load.ts` (the queries alongside the roots, from
  the same read), `packages/core/src/index-model/collection.ts` (a `queryRange(bytes, name)` for *Edit in collection.toml*) and
  `collection.test.ts`, `apps/desktop/test/sidebar.test.mjs`, `apps/desktop/test/library.test.mjs`, `docs/design/09-app-shell.md`,
  `docs/design/07-index-and-palette.md`.
- Read: `packages/core/src/index-model/query-eval.ts` (`evaluateQuery`, `UNAVAILABLE_STATUSES`), `packages/core/src/index-model/query.ts`,
  `apps/desktop/src/library/scopes.ts`, `mock-v2/05-collections.md` §Smart collections.
- No edit to `base.css` or `registry.json` (a section and rows as W-07 draws them); if review finds a name is needed, it waits
  for the kinds lane's story in flight to land.

**Acceptance.**
- Saving "Big plans" with `kind:report words:>2000` appends exactly one `[[query]]` table and changes no earlier byte of a
  commented, CRLF `collection.toml` (`collection.test.ts` over `appendQuery`'s caller; `library.test.mjs`). Fails on `main`:
  no caller.
- The file changed on disk between read and save: the save is refused with a notice and nothing is written (the stale-write
  guard; an adversarial case).
- A duplicate name, an empty query and a file that is not TOML are each refused with a notice naming why, and the file is
  unchanged.
- A row's count equals the library's result count for the same query, and changes when a matching file is added.
- With no `[[query]]` the section is not drawn; no built-in row appears (`sidebar.test.mjs`).
- **Pair:** `01-unfolded` (with two saved queries in the harness) and `05-library` (the Save control), Night and Paper.

**Do not.** Build the rule builder (question 1); delete or rename a saved query (question 2); write anything but through
`appendQuery`.

**Questions for the author.**
1. The rule builder (fields, All or Any, a running count) is a new surface; every rule is one query token. *Recommended:* not
   in Q-07; saving from the query field covers the same set, and the builder becomes Q-07.1 if wanted.
2. Delete and rename rewrite the reader's file. *Recommended:* not in Q-07; *Edit in collection.toml* opens the table, and a
   byte-faithful `removeQuery` with Undo is its own adversarially reviewed story.

---

## Dependencies and the dispatch order

**Outside this wave.** V-10 (`13-code-view.md`, ready) must merge before K-08 and K-09; the ledger's note on it ("does not
reproduce on main") is wrong for logs and diffs, which `parsed()` sends to `parseMarkdown` today. W-14, W-16, W-17, W-18, W-22,
K-12, K-14, K-16, Q-06 and P-01 are named above as where cut work goes; none blocks a card.

**Two lanes, at most two UI stories in flight, never two on one file.** Every card here is a UI story. Lane A owns the sidebar
and Source files; lane B owns the theme package, the kind profiles, `strip.ts`, `commands/index.ts` and `scripts/mock-pair.mjs`.
Each step names the pair that may run together; a story starts only when the one before it in its lane has merged.

| Step | Lane A | Lane B | Files the pair shares |
| --- | --- | --- | --- |
| 1 | W-08 | H-05 | none |
| 2 | Q-07 (after W-08) | K-11 (after H-05) | none |
| 3 | V-10 (after Q-07; not carded here) | K-20 (after K-11) | none (V-10's `base.css` against K-20's `default/theme.css`) |
| 4 | K-10a (after V-10) | K-08 (after K-20 and V-10) | none |
| 5 | K-09 (after K-10a and K-08) | K-10b (after K-08) | none |

Inside lane B, K-11, K-20, K-08 and K-10b all edit `registry.json` and `mock-pair.mjs`, and the first three
`default/theme.css`, so they are strictly one after another. K-09 waits for K-08 because both edit `file-types.ts`, the parser
choice in `store.ts` and `default/theme.css`. A story that finds it must touch a file the other lane's running story owns stops
and waits for it, rather than editing in parallel.

**The author's questions, in one place.** H-05: 1 to 4; K-20: 1 to 4; K-11: 1, 2; K-08: 1 to 3; K-09: 1, 2; K-10a: 1, 2;
K-10b: 1 to 3; W-08: 1 to 3; Q-07: 1, 2. Each card proceeds on its recommended default unless the author says otherwise,
except K-10b, whose question 1 changes an ADR and is ruled before its code starts, and K-20, whose questions 1 and 2 are taste and
are answered before it is dispatched.
