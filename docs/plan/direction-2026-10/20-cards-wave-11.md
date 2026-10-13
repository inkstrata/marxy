# Cards for wave 11: settings you can see, kinds read as they are, front matter on demand, and writes that never replace

**In short.** Wave 11 cards eight stories and four small follow-ups in four lanes:

- **Settings and access:** W-22 (follow the system's *Increase contrast*), W-12 (Settings as a page, with Privacy).
- **Kinds:** K-17 (terminal sessions), K-22 (docs, notes and changelogs), K-12 (JSONL agent transcripts), after two
  follow-ups to wave 9's logs and diffs (K-08.1, K-09.1).
- **Finding and knowing a file:** W-13 (the palette's preview, and `@` headings everywhere), W-17 (front matter and the
  file's facts on demand, edited in place).
- **Data safety and fixes:** F-85 (a write that can never replace a file), F-86 (the word count), W-10.2 (a long outline
  stays quick).

Each card was written against `origin/main` at `d8f5475c`. Every Path was checked with `git ls-files` (*new* marks a file
that does not exist; *V-06's* or *W-10's* marks a file that story adds and has not merged yet), and every function named
was found with `git grep`. The plan lines are in [05-plan.md](05-plan.md); the reading defaults come from
`docs/research/reader-typography/10-spec.md` and `docs/research/reader-artifacts/10-spec.md`.

## What a reader gains, and why these first

Wave 10 gave the unfolded window its status bar, an outline you can move sections in, Source's formatting and replace,
new files and forks, and a full menu bar. What a reader still meets:

- every setting is a line in `config.toml` that they must find and type, and nothing says what Marxy keeps about them;
- a reader who turned on macOS *Increase contrast* gets the same faint secondary text as everyone else;
- a shell session, a docs page, a changelog and an agent's `.jsonl` session all read as plain Markdown or raw JSON;
- the palette names a file but cannot show it, so choosing between three `plan.md` files is a guess;
- front matter is folded away with no way to read or change it but Source;
- Fork, Keep mine as a copy and Restore to a copy each look for a free name and then write, so a file another program
  makes in those few milliseconds would be replaced;
- the status bar counts a line of Chinese as one word and counts a code fence's words.

When wave 11 is done, a reader can:

- open Settings with `⌘,`, find any setting by typing, see which ones they changed, and read on one page everything
  Marxy keeps on disk and everything that can leave the machine;
- have Marxy follow the system's *Increase contrast*;
- read a terminal session as commands and their output, and copy only the commands;
- read docs pages, notes and changelogs each in their own setting, and copy a release's notes in one action;
- read a Claude Code or other agent session (`.jsonl`) as a conversation, with the raw line one key away;
- see a file's first lines, a heading's section or a transform's result in the palette before opening anything, and
  search every document's headings with `@`;
- show a file's front matter and facts with `⌃⌘I`, and change a front-matter value without opening Source;
- trust that a fork, a conflict copy or a restored version never replaces a file, however unlucky the timing;
- get a word count that means words, in any script.

**Why these before the rest.** Each story here either fills a surface that already exists (the inspector, the palette,
the strip, the kinds table) or closes a known gap in a promise (commitment 3 for F-85, the accessible value for W-22).
Most carry a design that 02, 03 and the mock give whole. Two wait on a ruling, each placed late in its lane so the
ruling has time to arrive:

- **F-85** adds a privileged capability to `shell-api`, which ADR-0045 says needs a record (ADR-0074).
- **W-12** builds a settings UI, which ADR-0019 and `docs/scope.md` put out of v1 (ADR-0075).

The four follow-ups are small fixes found in today's reviews. They start at once, beside wave 10's last stories, because
they share no file with them.

**Left for wave 12, and why:**

- **W-23 (focus mode).** Still underspecified: 02 gives it one line, the mock a key and a dim, and its reading-progress
  line needs `book` (K-21). It needs a short design first; a design card for it is the first thing wave 12 should hold.
- **W-18 (file facts: created time, permissions, Finder tags, git status).** It needs ADR-0064 (reserved) and new shell
  capabilities, and it fills the File and Git sections of W-17's Metadata tab, so it follows W-17.
- **W-16 (measures and one formatter).** It needs W-12's page for the reader's choice; F-86 fixes the one count that is
  wrong now.
- **W-15 (export).** Its formats need a licence review of new dependencies (PDF, Word).
- **K-13, K-14, K-15, K-16, K-21.** K-13 (the code listing and symbols) is the next kinds story but the lane is full; K-14
  needs K-08 to K-13; K-15 and K-16 need W-12's page; K-21 (books) is large and needs H-06's measure work proved on a
  paged layout.
- **Q-04, Q-05, Q-08, Q-09.** Q-05 and Q-08 move and write the reader's files and should use F-85's create-only write.
  Q-04 and Q-09 are the next library lane, with no hot file of their own; they are the first candidates if a lane here
  stalls.

| Id | What | Model / effort | Size | Review | Mock screen (ADR-0070 pair) |
| --- | --- | --- | --- | --- | --- |
| F-86 | The status bar's word count: scripts without spaces counted by word, code and front matter not counted | sonnet / low | S | lead | none (a count; before/after numbers) |
| W-10.2 | The Outline tab stays quick on a document with thousands of headings | sonnet / medium | S | lead | none (no new look) |
| K-08.1 | A log's level filter answers its click at once; a very long line shows its text exactly once | sonnet / medium | S | lead | none (no new look) |
| K-09.1 | A combined diff (`@@@`, from a merge) is tinted like any other | sonnet / low | S | lead | `03-diff` |
| W-22 | Follow the system's *Increase contrast*; `contrast` and `reduce_transparency` in `config.toml` | sonnet / medium | S | lead; `gate-contrast` | `01-unfolded` under more contrast |
| F-85 | A create-only write in `shell-api`; fork, conflict copy and restore use it; **ADR-0074 first** | opus / high | M | **adversarial** | none (no new look) |
| W-13 | The palette's preview pane, and `@` headings across the collection | opus / medium | M | lead | `04-palette`, `04-palette-commands` |
| K-17 | Read a terminal session: commands and output grouped, copy commands only, copy output only | sonnet / medium | M | lead; **author merges** (`tauri.conf.json`) | `03-terminal` (*new screen*) |
| W-12 | Settings as a page (`⌘,`): search, changed values, reset, the Privacy page; **ADR-0075 first** | opus / high | L | lead | `08-settings` (*new screen*) |
| K-22 | Read docs, notes and changelogs: three profiles, and *Copy release notes* | sonnet / medium | M | lead | `03-docs`, `03-changelog` (*new screens*) |
| W-17 | Metadata on demand: `⌃⌘I`, the margin preview, the Metadata tab, front-matter values edited in place | opus / high | M | **adversarial** (edits bytes through a new operation); `gate:fidelity` | `09-inspector-metadata` (*new screen*) |
| K-12 | Read a JSONL agent transcript as a conversation: the derived view of ADR-0061 | opus / high | L | **adversarial** (a second tree beside the AST) | `03-transcript` (the JSONL twin) |

**What `main` already has, and what it constrains.**

- **Writes.** `writeFileAtomic` (`packages/shell-api/src/index.ts`, Rust `write_atomic` in
  `apps/desktop/src-tauri/src/atomic_write.rs`) stages a temporary file and **renames over** the destination. There is no
  create-only write and no delete. Three writes must never replace a file and do "look, then write":
  - V-07's `writeCopy` (`apps/desktop/src/document/store.ts:622`) looks with `io.exists`, which the app builds from
    `shell.stat` (`apps/desktop/src/document/open.ts:461`). `stat` answers `null` for a symlink, so **a symlink at the
    copy's name reads as free** and is renamed over (the link, not its target, is replaced);
  - W-14's `writeFork` (`apps/desktop/src/document/fork.ts`) looks with `stat`, `realPath` and `readHead`, and so skips a
    link, but keeps a 10 to 25 ms window between its last look and the rename (measured in #701's review, accepted by the
    author for v1 on 2026-10-12, held by a KNOWN LIMIT test);
  - V-06's *Restore to a copy* (running) uses the same look-then-write.
- **Settings.** `config.toml` is parsed by `packages/theme/src/config.ts` and written one top-level line at a time by
  `setTopLevelKey`. `writeReaderKey` (`apps/desktop/src/theme/reader-config.ts:188`) takes `variant`, `size`,
  `line_numbers`, `show_whitespace`, `column_guide`, `chrome_size` and `theme`. `docs/design/11-config-and-storage.md`
  lists every key and every data file. It also says "There is no settings UI in v1", as ADR-0019 and `docs/scope.md`
  ("Settings UI | v1.1") do.
- **Contrast.** `base.css` has `prefers-contrast: more` rules only for diff rows; `forced-colors` is handled across the
  chrome (`chrome-spec.test.ts`). `scripts/gate-contrast.mjs` audits every theme, variant and kind scope. H-05 shipped a
  `high-contrast` theme (`BUNDLED_THEME_NAMES`). Nothing reads `prefers-reduced-transparency`; the chrome has no vibrancy,
  and its translucency is the find fills (55 % `color-mix`) and the toolbar and tab fades.
- **Kinds.** `packages/core/src/kind/detect.ts` already detects `terminal` (`.term`, `.session`, prompt lines), `docs`,
  `notes`, `changelog` and a JSONL `transcript`. `packages/core/src/index-model/file-types.ts` decides how a file opens:
  `log`, `out`, `diff`, `patch` are `readSrc` rows (Read through `parseCode`); `jsonl` opens in Source; `.term` and
  `.session` are not rows, so they do not open as anything. A row must match `tauri.conf.json`'s file associations and
  `watch/tree.rs`'s `LISTED_EXTENSIONS` (`file-types.test.ts`, the Rust test). `strip.ts` lists each kind's tools; a tool
  with no command is not drawn. `default/theme.css` holds the `article`, `readme`, `report`, `transcript`, `log` and `diff`
  profiles.
- **Derived views.** ADR-0061 (accepted) admits one deriver, `jsonl-transcript`, in a new contract
  `packages/core/src/contracts/derived.ts`, with `DERIVED_INVARIANTS` and an accounting rule. ADR-0071 (K-10b, running)
  amends it with a second deriver, so K-10b may write `derived.ts` first; K-12 then extends it.
- **The palette.** `apps/desktop/src/palette/view.ts` reserves the preview column ("W-13 adds the preview as a second
  column here"). The chips are Everything, Commands, Headings, Content. `IndexEntry` holds every document's headings with
  byte offsets. Rendered markup may reach the DOM only under `innerHtmlAllowedIn` (`apps/desktop/src/render/` is on it).
- **Front matter.** `packages/core/src/render/frontmatter.ts` folds it with a marker (commitment 4). K-20 (#700, in review)
  edits it to set an article's byline and dek. The inspector names a Metadata slot (`fill.ts`), and V-04's notes list waits
  for it (V-04 question 1).
- **Counts.** W-11's `createWordCounter` (`apps/desktop/src/workspace/status-facts.ts`) counts whitespace-separated runs
  that hold a letter or a number, as the library's `measureText` does (`packages/core/src/index-model/query-eval.ts:89`).
  W-10's Outline uses the same counter for each section.
- **Logs and diffs.** K-08's filter is `apps/desktop/src/kinds/log-filter.ts` (pure) and `kinds/log-view.ts` (the page);
  the highlighter caps a line at `DEFAULT_LINE_CAP` (1,000 characters, `packages/core/src/highlight/highlighter.ts:62`).
  K-09's tints come from `packages/core/src/highlight/diff-lines.ts`, which reads one marker column.
- **Mock screens** in `scripts/mock-pair.mjs` `SCREENS`: wave 10's list plus `03-log`, `03-diff`, `03-transcript`. The
  mock's corpus has `shell-session` (terminal), `watch-docs` (docs), `notes-1008` (notes), `changelog` and `indexer-chat`
  (transcript); `08-settings.html` is the settings page.

**The rules every card keeps.**

- A fact a surface shows is read from live state and changes when the state does.
- A control with nothing behind it is not drawn (W-05's door rule).
- Every edit is a splice of exactly the bytes asked for, with one undo step, under `pnpm gate:fidelity` (commitment 3).
- Nothing is written over a file the reader did not ask to save.
- Nothing leaves the machine without a reader action, and the Privacy page names each such action.
- Every UI card ships the app-beside-mock pair (ADR-0070) through `scripts/mock-pair.mjs`, and adds any new
  command-opened surface to `SURFACES` in `apps/desktop/test/no-displacement.test.mjs`.
- Every acceptance line names a test or gate that fails on `main`.
- `apps/desktop/src/commands/index.ts` is edited by one story only, K-17, which adds `commands/kind-tools.ts` for the
  kinds' tool commands. Every other story's commands go in a module already registered.

---

### F-86 — The status bar's word count: words in every script, and only the reader's words

**Model:** sonnet (low) · **Size:** S · **Review:** lead · **Depends on:** W-11 (merged) · **Parallel with:** K-08.1,
W-10.2, and wave 10's V-06 and V-04 (no shared file)

**Outcome.** The status bar's word count, the Outline tab's words per section and the library's `words:` filter count the
same way, and the way means words:

- Text in a script written without spaces (Chinese, Japanese, Thai) is counted by word, as the system's word breaker
  finds them, not as one word per run. "我们今天去公园" is several words, not one.
- In a Markdown file, a fenced or indented code block, the front matter and an HTML comment are not counted. The bar's
  tooltip says so: "Words in the text, not counting code and front matter".
- Every other kind keeps its count of lines.

**Paths.**
- New: `packages/core/src/index-model/words.ts` (one streaming counter: word-like segments through `Intl.Segmenter` for
  the runs that need it, the whitespace rule for the rest) and `packages/core/src/index-model/words.test.ts`.
- Edit: `packages/core/src/index-model/query-eval.ts` (`measureText` counts through it) and `query-eval.test.ts`;
  `apps/desktop/src/workspace/status-facts.ts` (`createWordCounter` becomes the core counter, plus the Markdown skip of
  fences, front matter and comments over the parse the store holds); `apps/desktop/src/workspace/status-bar.test.ts`.
- Read: `apps/desktop/src/workspace/status-bar.ts` (the 64 KB quiet path), `docs/research/reader-typography/08-multilingual.md`.

**Acceptance.**
- `words.test.ts` is a table: "我们今天去公园" counts more than one; "hello world" counts two; a run split across two
  `feed` chunks counts the same as one `feed`; a lone surrogate at a chunk's end is carried. Fails on `main`: no module.
- `status-bar.test.ts`: a Markdown snapshot whose fence holds 50 words and whose front matter holds 10 reports the prose
  words only.
- `query-eval.test.ts`: `words:>3` matches a three-sentence Japanese paragraph that the old rule counted as one word.
- The 64 KB-and-up count still runs after typing stops (the existing quiet-path case passes unchanged).

**Do not.**
- Add a measure, a token estimate or a setting (W-16).
- Count by characters for a language and call them words.

**Questions for the author.**
1. How are scripts without spaces counted? *Recommended:* `Intl.Segmenter` word-like segments, which Node and WebKit
   both ship (ICU's dictionary breaker), only for runs of those scripts; the whitespace rule elsewhere. If `Intl.Segmenter`
   is missing, one word per character, which overcounts rather than hides.
2. Does the library's `words:` change with the bar? *Recommended:* yes, one counter, so a filter and the bar never
   disagree. Front matter and code are skipped in both.

---

### W-10.2 — The Outline tab stays quick on a document with thousands of headings

**Model:** sonnet (medium) · **Size:** S · **Review:** lead · **Depends on:** **W-10** (#703, in review) · **Parallel
with:** F-86, K-08.1

**Outcome.** A reference document with 5,000 headings opens its Outline tab as fast as one with fifty. The tab draws only
the rows in view and a few around them, keeps its scroll height true, and still marks the section you are in, jumps,
roves with the arrows and moves sections. A relist after an edit redraws only what changed in view. Nothing a reader sees
changes for a short outline.

**Paths.**
- Edit: `apps/desktop/src/workspace/outline-tab.ts` (*W-10's*: the rows windowed over the model) and
  `apps/desktop/src/workspace/outline-tab.test.ts` (*W-10's*); `apps/desktop/test/outline-tab.test.mjs` (*W-10's*).
- Read: `apps/desktop/src/workspace/links-tab.ts` (the roving pattern), `apps/desktop/src/workspace/inspector.ts`.

**Acceptance.**
- `outline-tab.test.mjs` (WebKit; `outline-tab.test.ts` runs in Node and has no DOM): over `fixtures/corpus/32-long-reference.md`
  repeated to 5,000 headings, the panel holds at most 200 row elements at the top, at a quarter, half, three quarters and the end
  of the list, and the row under the reading line is drawn, marked, where the outline is scrolled to it. *(W-10's merge already windows the rows — `WINDOW_AT` 300,
  `MARGIN` 25 — so this does not fail on it; the card's "every heading is a row" did not reproduce. The test is the guard.)*
- In WebKit, over the same document: `⌥↓` on a row near the end moves its section and one `Mod+Z` restores the bytes; Home
  and End rove to the first stop (the Copy button) and the last heading.
- The record of the tab's first draw for that document, beside one of fifty headings, is printed for the nightly run (no
  ceiling, ADR-0032).

**Do not.**
- Change W-10's rows, counts or moves.
- Add drag (W-10.1).

**Questions for the author.** None.

---

### K-08.1 — A log's level filter answers its click at once; a very long line shows its text exactly once

**Model:** sonnet (medium) · **Size:** S · **Review:** lead · **Depends on:** K-08, F-79, F-82 (merged) · **Parallel
with:** F-86, W-10.2, and wave 9's K-10b (no shared file)

**Outcome.** Two things a log reader meets today:

- **The click.** On a 20 MB log, choosing *Warn* in the level filter holds the page for about 30 ms before the first
  slice yields, so the menu closes late. After this, the click closes the menu and marks the choice in the same frame,
  and every slice of the work runs after it.
- **Long lines.** A line longer than the highlighter's 1,000-character cap shows stray pieces of the next line's
  timestamp ("…000Z2026-…"), filtered or not. After this, every line shows its own text once, in order, and copying it
  still gives the file's bytes.

**Paths.**
- Edit: `apps/desktop/src/kinds/log-view.ts` (the click's own work before the first slice), `apps/desktop/src/commands/log.ts`,
  `packages/core/src/highlight/line-classes.ts` or `packages/core/src/highlight/index.ts` (whichever splits a capped
  line; the build finds which) and its test, `apps/desktop/test/log.test.mjs`.
- Read: `apps/desktop/src/kinds/log-filter.ts`, `packages/core/src/highlight/highlighter.ts` (`DEFAULT_LINE_CAP`), the
  F-79 and F-82 notes in #699 and #702.

**Acceptance.**
- `log.test.mjs`: after the filter's click, the menu is closed and the choice marked before any slice's work starts
  (the test counts slices at the moment the click's handler returns: zero). Structural, not a wall-clock bound
  (ADR-0032). Fails on `main`: the first slice runs inside the click.
- A highlight test over a line of 1,500 characters followed by a timestamped line: the page's text for the first line
  equals the file's line, and the second line's timestamp appears once. Fails on `main`.
- The copy of a filtered log still gives the lines shown, each as the file has it (the existing case).

**Do not.**
- Change how the filter decides what to hide, or what it says.
- Raise the highlighter's cap.

**Questions for the author.** None.

---

### K-09.1 — A combined diff is tinted like any other

**Model:** sonnet (low) · **Size:** S · **Review:** lead · **Depends on:** K-09 (merged); **K-08.1** (both may edit
`line-classes.ts`) · **Parallel with:** W-22, W-13, F-85

**Outcome.** A diff with more than one parent (`git diff` on a merge, `@@@ -a -b +c @@@`) has two or more marker columns.
Today only the first column is read, so most of its lines are untinted. After this, a line with `+` in any marker column
is tinted as added, a line with `-` in any column as removed, and the rest stay plain. The markers stay in the text as
authored, and copying gives the file's bytes.

**Paths.**
- Edit: `packages/core/src/highlight/diff-lines.ts` (the marker width from the hunk header's `@` count) and
  `packages/core/src/highlight/diff-lines.test.ts`; a combined hunk in `fixtures/corpus/36-change.diff` and its goldens.
- Read: `packages/core/src/highlight/line-classes.ts` (`lineClassForFenceLine`), `apps/desktop/test/diff-file.test.mjs`.

**Acceptance.**
- `diff-lines.test.ts`: in a `@@@` hunk, `++x`, `+ x` and ` +x` are added, `--x` and ` -x` removed, `  x` plain. Fails on
  `main`.
- A two-parent hunk inside a `diff` fence in Markdown is tinted the same (the fence shares the code path).
- **Pair:** `03-diff`, Night and Paper, with the combined hunk in view.

**Do not.**
- Add a class or a colour: the added and removed tints are K-09's.
- Reorder or rewrite a marker column.

**Questions for the author.** None.

---

### W-22 — Follow the system's *Increase contrast*; contrast and transparency in `config.toml`

**Model:** sonnet (medium) · **Size:** S · **Review:** lead; `scripts/gate-contrast.mjs` (in `pnpm check`) is the floor · **Depends on:** H-05
(merged); wave 10 merged (`base.css`) · **Parallel with:** K-09.1, W-13, F-85

**Outcome.** When macOS *Increase contrast* is on, Marxy reads with more contrast, in whatever theme is chosen:
- secondary text (paths, counts, timestamps, the status bar) reaches at least 7:1 against its ground;
- rules, hairlines, row dividers and focus rings reach at least 3:1;
- the find fills and the toolbar and tab fades become solid.

Turning the system setting off puts everything back, live. The theme and the text stay as chosen, and the reader's text is
never recoloured beyond what the theme's own roles allow.

Two keys in `config.toml`, written one line at a time:
- `contrast = "system" | "more" | "normal"`, so a reader can have more contrast without the system setting, or keep
  Marxy normal under it;
- `reduce_transparency = true`, which makes the fills and fades solid on its own.

W-12 shows both on its Accessibility page.

**Paths.**
- New: `apps/desktop/test/contrast.test.mjs` (WebKit, with `prefers-contrast` emulated).
- Edit: `packages/theme/src/base.css` (the more-contrast block over the existing roles, under both the media query and
  `[data-marxy-contrast="more"]`, and the solid fills), `packages/theme/src/config.ts` and `config.test.ts` (the two keys,
  their clamps and notices), `apps/desktop/src/theme/reader-config.ts` (`applyReaderConfig` sets
  `data-marxy-contrast`; `writeReaderKey` takes the two keys), `apps/desktop/src/theme/app-config.ts`,
  `scripts/gate-contrast.mjs` and `gate-contrast.test.mjs` (a "more" pass with the 7:1 and 3:1 floors over every bundled
  theme), `scripts/registry.json` (`data-marxy-contrast`), `docs/design/11-config-and-storage.md` (the keys),
  `docs/aesthetics-acceptance.md` (the more-contrast row).
- Read: `docs/research/reader-typography/09-color-access.md`, `packages/theme/high-contrast/theme.css`,
  `mock-v2/08-settings.md` §Accessibility.

**Acceptance.**
- `gate-contrast.test.mjs`: the "more" pass fails on `main` (there is no such pass; the PR records which themes' secondary text was under 7:1) and passes with the
  block, for every bundled theme and variant.
- `contrast.test.mjs`: with `prefers-contrast: more` emulated, `data-marxy-contrast` resolves to `more` and the status
  bar's secondary text computes to at least 7:1; with `contrast = "normal"` in `config.toml` it stays as today.
- `reduce_transparency = true` makes the find fill opaque (the computed background has alpha 1).
- `config.test.ts`: an unknown `contrast` value falls back to `system` with one notice; writing `contrast` touches only
  its line.
- The at-rest gate and the existing `forced-colors` cases pass unchanged.
- **Pair:** `01-unfolded` with `prefers-contrast: more` emulated, Night and Paper, beside today's.

**Do not.**
- Add a `--marxy-*` token (that needs an ADR); raise the existing roles.
- Switch the reader's theme to High contrast on their behalf.
- Read the system's *Reduce transparency* through a new shell capability (question 2).

**Questions for the author.**
1. Under *Increase contrast*, raise the chosen theme's roles, or switch to the High contrast theme? *Recommended:* raise
   the roles in the chosen theme. The reader chose the theme; High contrast stays one palette command away.
2. *Reduce transparency* has no media query WebKit reports. *Recommended:* the `reduce_transparency` key only, and no new
   shell capability. Marxy's chrome has no vibrancy, so the key covers the little translucency there is.

---

### F-85 — A write that can never replace a file

**Model:** opus (high) · **Size:** M · **Review:** **adversarial** (the shell's write path) · **Depends on:** V-06 (its
restore is one of the callers); K-10b (both edit `store.ts`); **question 1 ruled** · **Parallel with:** W-22, K-09.1, W-13

**Outcome.** Every write Marxy makes beside a reader's file, rather than over it, is create-only: *Fork this file*, *Keep
mine as a copy* and *Restore to a copy*. If anything is at the name when the bytes land, a file, a folder, a symlink or a
dangling one, the write fails and nothing is replaced. The caller moves to the next free name, as today, so the reader
sees no change but the promise. The 10 to 25 ms window W-14 accepted, and the symlink a conflict copy would rename over,
are both gone.

A failed create-only write leaves no temporary file behind, and says why in the notice's words.

**Paths.**
- New:
  - `docs/adr/0074-create-only-write.md`: written first, from question 1's ruling (accepted by the ruling on this pull
    request);
  - `apps/desktop/src/document/write-new.test.ts` (the callers over the memory shell, with a racing creator).
- Edit:
  - `packages/shell-api/src/index.ts` (`writeFileNew(path, bytes)`: rejects `exists` when anything is at the path; the
    no-op shell);
  - `apps/desktop/src/shell/tauri.ts` and `apps/desktop/src/shell/memory.ts` (the memory shell can create a file at a
    name between a caller's look and its write, for the race test);
  - `apps/desktop/src-tauri/src/atomic_write.rs` (`write_new`: stage, flush, then an exclusive rename,
    `renamex_np(RENAME_EXCL)` on macOS and `renameat2(RENAME_NOREPLACE)` on Linux, falling back to `link` and `unlink`)
    and its Rust tests; `apps/desktop/src-tauri/src/main.rs` (the command beside `write_file_atomic`);
  - `apps/desktop/src/document/store.ts` (`writeCopy`), `apps/desktop/src/document/fork.ts` (`writeFork`; the KNOWN
    LIMIT test becomes a passing race test), `apps/desktop/src/document/open.ts` (`exists` no longer decides a write);
  - V-06's restore (`apps/desktop/src/versions/`, *V-06's*);
  - `scripts/gate-fidelity.mjs` (the new write compiled and driven over the corpus, as `write_atomic` is);
  - `docs/design/06-shell.md`, `docs/adr/README.md`.
- Read: ADR-0045, ADR-0026, `docs/design/11-config-and-storage.md`, #701's adversarial review (the measured window).

**Acceptance.**
- Rust: `write_new` onto a free name writes the bytes; onto an existing file, folder, symlink or dangling symlink it fails
  `exists` and every one of them is unchanged; no temporary file remains after either. Fails on `main`: no function.
- `write-new.test.ts`: with a creator that makes the fork's name between the look and the write, *Fork* writes
  `(fork 2)` and the creator's file keeps its bytes. The same for `writeCopy` and Restore. Fails on `main` (the rename
  replaces it).
- A symlink at `x (mine).md`: *Keep mine as a copy* writes `x (mine 2).md` and the link is unchanged. Fails on `main`.
- `pnpm gate:fidelity` runs `write_new` over the corpus, byte-exact.
- The no-network assertion and `scripts/check-boundaries.mjs` pass (no raw `invoke(` outside `src/shell`).

**Do not.**
- Change `writeFileAtomic` or Save, which replace on purpose.
- Add a delete, a rename or any capability but this one.
- Touch `apps/desktop/src-tauri/capabilities/` (custom commands need no capability entry; if the build finds otherwise,
  stop: that path is code-owned and the author merges).

**Questions for the author.**
1. **(Blocking: a new privileged capability, ADR-0045.)** Add `writeFileNew`, a create-only atomic write, to `shell-api`?
   *Recommended:* yes, as ADR-0074. It does strictly less than `writeFileAtomic` (it can never replace), it closes the
   window W-14's review measured and the symlink hole in `writeCopy`, and Q-05 and Q-08 (which write and move the
   reader's files) will need it.
2. When the exclusive rename is not supported (an old kernel, a network volume that refuses it)? *Recommended:* fall back
   to `link` then `unlink`, which is also exclusive; if both are refused, fail with "this volume cannot create a file
   without risk of replacing one", and write nothing.

---

### W-13 — The palette shows what you are about to open, and `@` finds any heading

**Model:** opus (medium) · **Size:** M · **Review:** lead · **Depends on:** U-04, K-05 (merged); wave 10 merged
(`registry.json`) · **Parallel with:** W-22, K-09.1, F-85

**Outcome.** When the palette is wide enough, a preview column sits beside the results and shows the highlighted row:
- a **file**: its kind, its words or lines, a "2 near copies" chip when Q-06 found some, then its first forty lines set
  in its own kind (a log as a log, code highlighted), with remote images never fetched;
- a **heading or section**: that section's text, set as the document sets it;
- a **command**: its description, its group and its key;
- a **transform**: its result on the selection, or on the first 1,400 characters of the document.

The preview follows the highlighted row after a short pause, never on the keystroke, so typing is exactly as fast as
today. A narrow palette has no column.

`@` searches the headings of every document in the collection ("@ install" finds every *Install* section), with the
document named under each. Enter opens the document at that heading. `#` stays headings in this document.

**Paths.**
- New: `apps/desktop/src/render/palette-preview.ts` (the preview's render, under `innerHtmlAllowedIn` through the path
  `render/` already has) and its node test; `apps/desktop/test/palette-preview.test.mjs` (WebKit).
- Edit: `apps/desktop/src/palette/view.ts` (the column and the pause), `apps/desktop/src/palette/search.ts` (`@`),
  `apps/desktop/src/palette/session.ts`, `apps/desktop/src/palette/search.test.ts`, `scripts/registry.json` (the
  column's classes), `docs/design/07-index-and-palette.md` (§Prefixes, §Preview).
- Read: `mock-v2/04-palette.md` §Previews, `apps/desktop/src/palette/content.ts` (a hit's preview text),
  `apps/desktop/src/transform/sheet.ts` (`PREVIEW_LIMIT`), `packages/core/src/contracts/index-entry.ts` (headings),
  `apps/desktop/src/palette/search-perf.test.ts`.

**Acceptance.**
- `search.test.ts`: `@install` over an index of three documents returns each document's *Install* heading with its
  document; `#install` still returns only this document's. Fails on `main`: `@` is plain text.
- In WebKit: highlighting a file row for 200 ms shows its first lines in the column; holding the arrow key down over
  fifty rows reads no file until the key is released (the shell's read log). Fails on `main`: no column.
- A file preview reads at most `readHead`'s 256 KB of the highlighted file and nothing else (the read log).
- `search-perf.test.ts` passes unchanged: no keystroke waits on a preview.
- A preview of a Markdown file with a remote image fetches nothing (the no-network assertion, one more case).
- **Pair:** `04-palette` and `04-palette-commands`, Night and Paper.

**Do not.**
- Search body text with `@` (question 1).
- Preview on hover while typing, or run a transform over more than 1,400 characters for a preview.
- Add a mode chip for `@` beyond the mock's chips (the chips follow U-04's list).

**Questions for the author.**
1. Does `@` search body text too? *Recommended:* headings only. Body text is `/` (C-17), and the library does the rest.
2. What does a file preview show for a file over the large-file limit? *Recommended:* its kind, size and "Too large to
   preview", read from the index, with no read of the file.

---

### K-17 — Read a terminal session: commands and their output, grouped

**Model:** sonnet (medium) · **Size:** M · **Review:** lead; **the author merges** (it edits `tauri.conf.json`, a
code-owned path) · **Depends on:** K-08, K-09.1 (lane order; `line-classes.ts`); wave 9 merged (`file-types.ts`,
`default/theme.css`, `strip.ts`) · **Parallel with:** W-12

**Outcome.** A `.term` or `.session` file, or one the reader shows as *Terminal*, opens in Read as a terminal session:
- each prompt and its command, then the command's output, with half a line between one command and the next;
- prompts in the punctuation colour, commands in the strong colour at weight 600, output plain, in mono, size only;
- blank lines inside output kept; ANSI escapes shown as `␛` and never interpreted, as in a log.

A `console`, `shellsession` or `sh-session` fence in Markdown reads the same way. The strip offers **Copy commands**
(every command, prompts stripped, one per line) and **Copy output** (the output only). Copying a selection gives the
file's bytes. Source shows the file exactly.

**Paths.**
- New:
  - `packages/core/src/highlight/terminal-lines.ts` (pure: prompt, command and output lines, the prompt patterns `$ `,
    `% `, `# `, `> ` and `PS …> ` as `detect.ts` reads them) and its test;
  - `apps/desktop/src/commands/kind-tools.ts` (`terminal.copy-commands`, `terminal.copy-output`; the home of the kinds'
    tool commands from here on);
  - `apps/desktop/test/terminal.test.mjs` (WebKit);
  - `fixtures/corpus/38-shell.session` and its goldens.
- Edit:
  - `packages/core/src/index-model/file-types.ts` (`term` and `session` as `readSrc('terminal')`) and
    `file-types.test.ts`;
  - `apps/desktop/src-tauri/tauri.conf.json` (the two extensions in the file associations: **code-owned**) and
    `apps/desktop/src-tauri/src/watch/tree.rs` (`LISTED_EXTENSIONS`);
  - `packages/core/src/highlight/index.ts` and `line-classes.ts` (the `terminal` tokenizer and the fences);
  - `packages/theme/default/theme.css` (the `[data-marxy-kind="terminal"]` profile, from 03's table: mono 15 on 24);
  - `apps/desktop/src/workspace/strip.ts` (the two tools);
  - `apps/desktop/src/commands/index.ts` (registers `kind-tools.ts`: the only edit to it this wave);
  - `scripts/registry.json`;
  - `scripts/mock-pair.mjs` (`SCREENS`: `03-terminal`, `#doc=shell-session`) and `scripts/mock-pair.test.mjs`.
- Read: `mock-v2/03-content-modes.md` §Terminal, `03-kinds-and-the-look.md` (the profile row),
  `packages/core/src/kind/detect.ts` (the prompt signal), `apps/desktop/src/kinds/log-view.ts` (escapes).

**Acceptance.**
- `terminal-lines.test.ts`: a session of three commands gives three groups; a `$` inside output is output; a multi-line
  command continued with `\` is one command. Fails on `main`: no module.
- In WebKit: `38-shell.session` opens in Read with three groups; *Copy commands* writes exactly the three commands with no
  prompt; *Copy output* writes the output lines, each as the file has it. A `console` fence in Markdown groups the same.
- `file-types.test.ts` and the Rust tree test pass with `term` and `session` in all three lists.
- `pnpm gate:golden` over the new fixture.
- **Pair:** `03-terminal`, Night and Paper.

**Amended at build (K-17).**
- `detect.ts` reads only `$ ` and `user@host path %`, not the five patterns the card lists; `terminal-lines.ts` reads those two as detection does
  (`PROMPT` is now exported and a test holds the two together) and adds `%`, `PS …>`, `[user@host dir]$`, and `#` / `>` only in a session with no other prompt.
- `apps/desktop/src/commands/kind-tools.ts` did not exist on main (K-08's log tools are in `commands/log.ts`); it is new here, as listed.
- Also edited, beyond the list: `packages/theme/src/config.ts` (the strip's known tool ids), `packages/theme/src/loader.test.ts` (the profile list),
  `highlight.test.ts` (the console fence test, whose `$`-as-punctuation reading this replaces), `fixtures/corpus/README.md`, and the goldens.
- `38-shell.session` shares its number with `38-awkward.csv`.
- The prompt's colour is `--marxy-tok-punctuation`, which the default theme sets equal to the code text colour, so a prompt differs from output by position only, not hue, unlike the mock's dimmer `--tk-punct`.
- The run styles are in `default/theme.css` (V-06 held `base.css`); they belong beside the log's in `base.css`.

**Do not.**
- Interpret an escape, or colour output by what it says.
- Run anything: Copy is the only action.
- Read a `.txt` as a terminal by detection (question 2).

**Questions for the author.**
1. Add `.term` and `.session` as file types, which edits the code-owned `tauri.conf.json`? *Recommended:* yes. `detect.ts`
   already names them, and without a row they do not open at all. The author merges this one.
2. A `.txt` or `.log` whose lines look like a session: read it as a terminal? *Recommended:* no, not in this card. The
   kind chip names it *Terminal* by detection, and *Show as Terminal* is offered, but the parser is still chosen by the
   path; choosing it by kind is K-14's.

---

### W-12 — Settings as a page: find any setting, see what you changed, read what Marxy keeps

**Model:** opus (high) · **Size:** L · **Review:** lead · **Depends on:** W-02, W-06 (merged); **W-22** (lane order;
`reader-config.ts`, `config.ts`, `base.css`); **F-85** (both edit `main.rs`); **question 1 ruled** · **Parallel with:**
K-17

**Outcome.** `⌘,` (and *Settings…* in the Marxy menu, and the palette) opens **Settings** as a page in the workspace,
unfolding the window if it is folded, as the library does. It is a view of `config.toml`, nothing more:
- **Categories** down the left: General, Appearance, Reading, Source, Content types, Collections, Accessibility, Privacy,
  Advanced. Each shows only the keys that exist today; a category with none is not drawn.
- **Search** at the top finds a setting by its name, its words or its key, across every category.
- **Changed values** carry a dot. Clicking the dot resets the value: the key's line is removed from `config.toml`, and
  nothing else in the file changes.
- **Coupling rules** disable a control and say why: *Measure* is disabled while *Typeset* is off; *Column guide*'s
  column follows `.editorconfig` when a file has one.
- Each change is written at once, one top-level line, by the same function every key uses today. An edit made to
  `config.toml` by hand shows on the page live, and unknown keys are kept.

**Privacy** is a computed page, not a promise in prose:
- **Stored on this Mac:** each of Marxy's files (`positions.json`, `history.json`, `trust.json`, `workspace.json`,
  `layout.json`, the index, versions), with its size and what it holds, and *Clear versions* where V-06 gave it a command;
- **What can leave this Mac:** each reader action that sends something (opening a link, allowing a remote image, copying
  to the clipboard), with what it sends and to whom; and the sentence "Nothing else leaves this Mac", tested.

**Advanced** opens `config.toml` itself in Source.

**Paths.**
- New:
  - `docs/adr/0075-settings-page.md`: written first, from question 1's ruling (accepted by the ruling on this pull
    request);
  - `packages/theme/src/settings-schema.ts` (pure: every key with its category, words, control, default, range and
    coupling rule, from `config.ts`'s own table) and its test;
  - `apps/desktop/src/settings/page.ts` (the page), `apps/desktop/src/settings/privacy.ts` (the computed lists) and
    their node tests;
  - `apps/desktop/test/settings.test.mjs` (WebKit).
- Edit:
  - `packages/theme/src/config.ts` (`removeTopLevelKey`, the reset) and `config.test.ts`;
  - `apps/desktop/src/theme/reader-config.ts` (`writeReaderKey` takes every key the page writes);
  - `apps/desktop/src/commands/workspace.ts` (`view.settings`, `Mod+,`);
  - `apps/desktop/src-tauri/src/main.rs` (`MENU`: *Settings…* under Marxy) and its Rust test;
  - `apps/desktop/test/keys-table.test.mjs` (`MENU_OWNERS`: the new item);
  - `packages/theme/src/base.css`, `scripts/registry.json`;
  - `scripts/mock-pair.mjs` (`SCREENS`: `08-settings`) and `scripts/mock-pair.test.mjs`;
  - `docs/adr/0019-scope-v1.md` (its status line points to ADR-0075), `docs/adr/README.md`, `docs/scope.md` (the
    settings row), `docs/design/11-config-and-storage.md` ("There is no settings UI in v1" replaced),
    `docs/design/09-app-shell.md` (§Keyboard map).
- Read: `02-fold-up-workspace.md` §Settings, `mock-v2/08-settings.md` (categories, search, coupling rules, §Privacy and
  data), `06-reconciliation.md` (no telemetry switch, no `settings.json`), `apps/desktop/src/library/view.ts` (a page in
  the workspace).

**Acceptance.**
- `settings-schema.test.ts`: every key `config.ts` parses has exactly one schema row, and every row names a key
  `config.ts` parses. Fails on `main`: no module. (A key added later without a row fails this test.)
- `config.test.ts`: `removeTopLevelKey` on a commented file removes one line and leaves every other byte; a key in a
  `[table]` is untouched.
- In WebKit: `⌘,` opens the page; typing "whitespace" shows *Show whitespace*; turning it on writes
  `show_whitespace = true` and the Source pane shows whitespace at once; the dot appears, and clicking it restores the
  file's bytes exactly (`settings.test.mjs`).
- Turning *Typeset* off disables *Measure* and the control says why.
- `privacy.test.ts`: the "What can leave this Mac" list equals the shell's network-capable calls (`openExternal`,
  `fetchRemoteImage`, the clipboard writes), so a new one without a row fails the test.
- The menu's *Settings…* runs `view.settings` (the Rust test and `keys-table.test.mjs`).
- **Pair:** `08-settings`, Night and Paper.

**Do not.**
- Add a setting that has no key in `config.toml`, a telemetry switch, or a `settings.json`.
- Write a key the reader did not change, or reorder the file.
- Build the per-kind typography panel (K-15), the theme editor (K-16) or measures (W-16).

**Questions for the author.**
1. **(Blocking: changes ADR-0019.)** ADR-0019 lists "a settings UI (a config file suffices)" as not in v1, `docs/scope.md`
   puts it at v1.1, and `docs/design/11-config-and-storage.md` says "There is no settings UI in v1". The direction (05,
   W-12) plans one. *Recommended:* amend ADR-0019 by ADR-0075: a settings page is in v1 as a view of `config.toml`, which
   stays the only store, and writes only the keys the reader changes. A config file still suffices for anyone who
   prefers it.
2. Folded, does `⌘,` unfold the window? *Recommended:* yes, as the library does; folding hides the page with the rest.
3. Does *Clear* appear for files other than versions (positions, history)? *Recommended:* not in this card: those Clears
   are new writes with their own questions. The page shows each file's size and path, and *Clear versions* where it
   exists.

---

### K-22 — Read docs, notes and changelogs, each in its own setting

**Model:** sonnet (medium) · **Size:** M · **Review:** lead · **Depends on:** **K-17** (lane order: `theme.css`,
`strip.ts`, `kind-tools.ts`, `mock-pair.mjs`); W-10 (the Outline tab) · **Parallel with:** W-17

**Outcome.** Three kinds Marxy already detects get their own reading:
- **docs** (a page of a docs set, with admonitions or *Parameters / Returns* sections): the README's sans, with the
  signature block after the title emphasised and admonitions set apart. The strip's *On this page* opens the inspector's
  Outline tab.
- **notes** (a dated file or a notes folder): today's prose setting with the date line quiet above the first heading.
- **changelog** (`CHANGELOG`, `CHANGES`, `HISTORY`): the report setting, with each version heading's date in the
  secondary colour. The strip's **Copy release notes** copies the newest version's section as Markdown (the bytes of that
  section), and *Versions* opens the Outline tab.

Tools with nothing behind them stay undrawn. Nothing is folded or hidden.

**Paths.**
- New: `apps/desktop/test/kinds-docs.test.mjs` (WebKit); `fixtures/corpus/39-changelog.md` and its goldens.
- Edit: `packages/theme/default/theme.css` (three profiles), `apps/desktop/src/workspace/strip.ts`,
  `apps/desktop/src/commands/kind-tools.ts` (`changelog.copy-release-notes`, through `copy-section`'s range),
  `scripts/mock-pair.mjs` (`SCREENS`: `03-docs` with `#doc=watch-docs`, `03-changelog` with `#doc=changelog`) and
  `scripts/mock-pair.test.mjs`, `apps/desktop/test/kind-profiles.test.mjs`.
- Read: `mock-v2/03-content-modes.md` §Docs, §Notes and Changelog; `03-kinds-and-the-look.md`;
  `docs/research/reader-typography/07-content-types.md`; `packages/core/src/operations/copy-section.ts`.

**Acceptance.**
- `kind-profiles.test.mjs`: a docs, a notes and a changelog file each compute their profile's face and size; on `main`
  they compute the article's. Fails on `main`.
- *Copy release notes* on `39-changelog.md` writes exactly the bytes of the first version's section (heading through the
  line before the next version heading); in a changelog with no version headings the tool is not drawn
  (`kinds-docs.test.mjs`).
- `pnpm gate:golden` and the aesthetics gate's mechanical half over the new fixture.
- **Pair:** `03-docs` and `03-changelog`, Night and Paper.

**Do not.**
- Build the docs-set tree, *Search docs set*, *Prev / next*, backlinks or *Daily* (K-14 and later).
- Change the `article`, `readme` or `report` profiles.

**Questions for the author.**
1. The three profiles' values? *Recommended:* docs takes the README's (Inter 16 on 26, measure 84), changelog the
   report's (17 on 26, 74), notes the default prose, each citing `07-content-types.md`. The taste review judges the
   rest.
2. Which version is "the newest" in a changelog? *Recommended:* the first version heading in the file (Keep a Changelog
   order), skipping one named *Unreleased*.

---

### W-17 — Metadata on demand: `⌃⌘I`, a quiet margin preview, and the Metadata tab

**Model:** opus (high) · **Size:** M · **Review:** **adversarial** (a new operation that edits bytes); `pnpm
gate:fidelity` is the floor · **Depends on:** K-20 (#700; `frontmatter.ts`), V-04 (its notes list here), W-12 (lane
order: `base.css`, `registry.json`, `mock-pair.mjs`, `09-app-shell.md`) · **Parallel with:** K-22

**Outcome.** A file's metadata is hidden by default and shown on request.
- **`⌃⌘I`** (or *Show metadata* in the palette) puts a quiet preview in Read's empty left margin, beside the first line:
  the front matter's keys and values, then the modified date and size, in small chrome type, sticky as you scroll, with
  *More…* opening the Metadata tab. Where the margin is too narrow, `⌃⌘I` opens the tab instead. Nothing is placed
  above or inside the text. With it off, folded front matter keeps its marker (commitment 4), and clicking the marker
  turns the preview on.
- The inspector's **Metadata** tab lists, each section only when it has something:
  - **File:** path, size, modified, encoding and line endings;
  - **Front matter:** each key and value, **editable**;
  - **Detection:** the kind, the reasons, *Show as*;
  - **Marxy:** last read, pinned;
  - **Hidden and reshaped:** the invisible characters and every place Read reshaped the file, each a jump;
  - **Notes:** V-04's notes, each a jump.
- **Editing a value** changes only that value's bytes: one splice, one undo step, the file's quoting style and line
  endings kept. A value Marxy cannot edit safely (a multi-line block, an anchor, a flow collection) is shown read-only,
  with the reason and *Edit in Source*.

Every value has *Copy*. Nothing is renamed, retagged or made executable here (W-18).

**Paths.**
- New:
  - `packages/core/src/operations/front-matter-value.ts` (`set-front-matter-value`: pure, a scalar's byte range from
    the YAML, the new value quoted as the old one was, or declined with a reason) and its test;
  - `apps/desktop/src/workspace/metadata-tab.ts` (`METADATA_TAB`) and its node test;
  - `apps/desktop/src/render/metadata-margin.ts` (the margin preview);
  - `apps/desktop/test/metadata.test.mjs` (WebKit).
- Edit:
  - `packages/core/src/operations/index.ts` (one id, one line, F-32) and `operations/registry.test.ts`;
  - `packages/core/src/render/frontmatter.ts` (the marker's click target; *K-20 edits it first*);
  - `apps/desktop/src/workspace/fill.ts` (`registerInspectorTab(METADATA_TAB)`);
  - `apps/desktop/src/commands/panels.ts` (`view.metadata`, `Ctrl+Mod+I`);
  - `packages/theme/src/base.css`, `scripts/registry.json`;
  - `apps/desktop/test/no-displacement.test.mjs` (`SURFACES`: the margin preview);
  - `scripts/mock-pair.mjs` (`SCREENS`: `09-inspector-metadata`) and `scripts/mock-pair.test.mjs`;
  - `docs/design/09-app-shell.md` (§Inspector, §Keyboard map), `docs/design/02-render.md` (§Front matter).
- Read: `02-fold-up-workspace.md` §Metadata on demand and the inspector table, `rulings-x21.md` ruling 21,
  `docs/research/reader-artifacts/proposals/P08-front-matter-head.md`, `apps/desktop/src/workspace/links-tab.ts`,
  `apps/desktop/src/workspace/status-facts.ts` (the file's facts in words).

**Acceptance.**
- `front-matter-value.test.ts`: changing `title: Old` to `New` changes only those bytes; a double-quoted value stays
  double-quoted and escapes a quote; a CRLF file keeps CRLF; a `|` block, an anchor and a flow list are declined with a
  reason. Fails on `main`: no operation.
- `pnpm gate:fidelity` runs the operation under the property test.
- In WebKit: `⌃⌘I` in Read on `26-skill-front-matter.md` shows the margin preview and moves no line of the page
  (`no-displacement.test.mjs`); at 760 px it opens the tab instead. Editing a value in the tab and pressing `Mod+Z` once
  restores the file's bytes (`metadata.test.mjs`).
- The tab's Notes section lists V-04's notes for a file with an unclosed fence, and a click jumps to it.
- `keys-table.test.mjs` passes with `Ctrl+Mod+I` owned once.
- **Pair:** `09-inspector-metadata`, Night and Paper, and `01-unfolded` with the margin preview on.

**Do not.**
- Add keys or remove them, rename the file, or edit anything but a scalar's value (question 2).
- Show git status, created time, permissions or Finder tags (W-18, ADR-0064).
- Change what Read shows at rest (question 1).

**Questions for the author.**
1. Ruling 21 left the front-matter head in Read to this card. *Recommended:* Read at rest stays as `10-spec.md` and K-20
   have it (the folded marker; an article's byline and dek). The full front matter is on demand, through `⌃⌘I`.
2. May the tab add or remove a key? *Recommended:* not in this card. Changing a scalar's value is one splice that cannot
   reshape the YAML; adding a key raises where and how, and is a follow-up once this is proved.

---

### K-12 — Read an agent's JSONL session as a conversation

**Model:** opus (high) · **Size:** L · **Review:** **adversarial** (a second tree beside the AST, ADR-0061) · **Depends
on:** K-11, K-02 (merged); K-10b (it may write `derived.ts` first); **K-22** (lane order: `theme.css`, `strip.ts`,
`kind-tools.ts`, `mock-pair.mjs`) · **Parallel with:** none in this wave (its last step)

**Outcome.** A `.jsonl` file whose lines are messages with roles (a Claude Code session, and others like it) can be read as
the conversation it records:
- your prompts and the agent's replies as turns, the speaker outdented as in a Markdown transcript (K-11), the reply's
  Markdown set as Markdown;
- each tool call and its result as one line naming the tool and the result's length, expanded on a click;
- thinking folded the same way;
- a line that is not JSON shown as "Unreadable line 412" with its bytes one click away, and an unfinished last line as
  "Still being written".

The file still opens in Source, as ADR-0060 decides, unless the reader's `[[kind]]` rule or *Show as Transcript* says
Read. `⌘E` toggles to the raw lines at the same place. The strip offers *Collapse tools*, *Only you* and *Only
assistant*, which hide turns and leave one line saying how many. Copying a turn gives its text as shown, and *Copy as*
offers the raw lines. No node knows a model, a session id, a cost or a token count, and nothing derived goes into the
index.

The first screen of a 20 MB session shows before the whole file is read (commitment 5).

**Paths.**
- New:
  - `packages/core/src/contracts/derived.ts` (if K-10b has not written it: `DerivedNode`, `DERIVED_INVARIANTS`,
    `checkDerivedInvariants`, exactly as ADR-0061 items 2 to 4 give them);
  - `packages/core/src/derive/jsonl-transcript.ts` (the deriver, in slices) and its test;
  - `packages/core/goldens/` derived serialisations for the new fixture, and their serialiser;
  - `apps/desktop/src/kinds/transcript-view.ts` (the page half) and `apps/desktop/test/transcript-jsonl.test.mjs`
    (WebKit);
  - `fixtures/corpus/40-session.jsonl` (prompts, replies, a tool call with a result three lines later, thinking, an
    escaped `‮`, a bad line, an unfinished last line).
- Edit: `apps/desktop/src/view/rendered-view.ts` (Read mounts the derived view for a JSONL transcript, as K-10b's lens
  mounts its grid), `apps/desktop/src/workspace/strip.ts`, `apps/desktop/src/commands/kind-tools.ts`,
  `packages/theme/default/theme.css` (the turn and tool-line rules inside the `transcript` profile),
  `scripts/registry.json`, `packages/core/scripts/golden.ts` (the derived goldens), `scripts/mock-pair.mjs` (`SCREENS`:
  `03-transcript-jsonl`) and `scripts/mock-pair.test.mjs`, `docs/design/02-render.md`.
- Read: ADR-0061 whole, ADR-0071, `docs/research/reader-artifacts/proposals/P10-derived-transcript-view.md`,
  `04-capture.md` (the transcript view), `apps/desktop/test/transcript.test.mjs` (K-11).

**Acceptance.**
- `jsonl-transcript.test.ts`: over the fixture, `checkDerivedInvariants` holds; every line is a leaf's source, in
  `dropped` or the one `pending` line (the accounting rule); the `‮` leaf's value is the one character and is marked
  as Read marks a bidi control; the tool call and its result are one `tool` node. Fails on `main`: no module.
- A differential over 1,000 generated sessions: the accounting rule and item 4.5 (each leaf's value is the decoding of
  its bytes) hold for every one.
- The type checker refuses a `DerivedNode` where an operation takes a `Node` (a `// @ts-expect-error` case in the
  test).
- In WebKit: with a `[[kind]]` rule for the fixture's folder, it opens in Read as turns; `⌘E` shows Source at the same
  line; *Only you* hides the agent's turns and says how many; copying a turn gives its text.
- A 20 MB session's first turn is on screen before the deriver reaches the file's end (the deriver's slice count at first
  paint is less than its total; the time is printed, no ceiling).
- **Pair:** `03-transcript-jsonl` beside the mock's `indexer-chat`, Night and Paper.

**Do not.**
- Add a field to `Node`, or edit through the derived view (ADR-0061 item 5: no operation edits it).
- Show or store a model, session id, cost, token count or per-event time.
- Open `.jsonl` in Read by default.
- Build the prompts rail or *Export as doc* (K-14).

**Questions for the author.**
1. Do the strip's filters remember their state? *Recommended:* no, as K-08's level filter: they reset when the file is
   reopened.
2. If K-10b has already written `derived.ts`, K-12 extends it. *Recommended:* yes, with K-12's node types added beside
   K-10b's, and no change to K-10b's.

---

## Dependencies and the dispatch order

**Outside this wave.** Wave 10's W-10 (#703, in review), V-06 and V-04 hold `packages/theme/src/base.css`,
`scripts/registry.json`, `scripts/mock-pair.mjs`, `apps/desktop/src/workspace/fill.ts`, `apps/desktop/src/app.ts`,
`apps/desktop/src/commands/compare.ts`, `apps/desktop/src/source/frame.ts`, `apps/desktop/src/commands/source-view.ts`,
`docs/design/09-app-shell.md` and `docs/design/11-config-and-storage.md`. Wave 9's K-20 (#700, in review) and K-10b hold
`packages/theme/default/theme.css`, `packages/core/src/render/frontmatter.ts`, `packages/core/src/index-model/file-types.ts`,
`apps/desktop/src/workspace/strip.ts`, `apps/desktop/src/document/store.ts`, `scripts/registry.json` and `scripts/mock-pair.mjs`.
Wave 11's first step uses none of them. The steps from 2 on start when they have merged.

**Four lanes; at most four wave-11 stories in flight, at most two on Opus; never two on one file.** Lane A is settings
and access. Lane B is kinds. Lane C is finding and knowing a file. Lane D is data safety and fixes.

The hot files are `base.css` (W-22, W-12, W-17), `registry.json` (W-22, W-13, K-17, W-12, W-17, K-12),
`mock-pair.mjs` (K-17, W-12, K-22, W-17, K-12), `default/theme.css` (K-17, K-22, K-12), `line-classes.ts` (K-08.1, K-09.1,
K-17), `strip.ts` and `kind-tools.ts` (K-17, K-22, K-12), `main.rs` (F-85, W-12), `store.ts` (F-85),
`reader-config.ts` and `config.ts` (W-22, W-12), `09-app-shell.md` (W-12, W-17), `docs/adr/README.md` (F-85, W-12) and
`SURFACES` (W-17).

`registry.json` and `mock-pair.mjs`'s `SCREENS` are lists each story appends one or two entries to. The table below runs
two stories that append to them at once (question 1 below); every other hot file has one holder at a time.

| Step | Lane A | Lane B | Lane C | Lane D | Starts when | Files the running stories share |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | — | K-08.1 | — | F-86; W-10.2 (when W-10 merges) | now, beside wave 10's V-06 and V-04 and wave 9's K-20 and K-10b | none |
| 2 | W-22 | K-09.1 (after K-08.1) | W-13 | F-85 (after V-06 and K-10b; question 1 ruled) | wave 10 and wave 9 have merged | `registry.json` appends (W-22, W-13) |
| 3 | W-12 (after W-22 and F-85; question 1 ruled) | K-17 (after K-09.1) | — | — | W-22, K-09.1 and F-85 have merged | `registry.json` and `SCREENS` appends (W-12, K-17) |
| 4 | — | K-22 (after K-17) | W-17 (after W-13, W-12, K-20, V-04) | — | W-12 and K-17 have merged | `SCREENS` appends (K-22, W-17) |
| 5 | — | K-12 (after K-22) | — | — | K-22 has merged | — |

At most two Opus stories run at once: W-13 and F-85 in step 2; W-12 in step 3; W-17 in step 4; K-12 in step 5. A blocked
card does not hold its lane's other work:
- if ADR-0074 (F-85) is not ruled by step 2, W-12 takes `main.rs` first and F-85 runs in step 4 beside K-22;
- if ADR-0075 (W-12) is not ruled by step 3, W-17 moves up into step 3 (it then holds `base.css`, `registry.json` and
  `09-app-shell.md` alone) and W-12 runs in step 4.

A story that finds it must touch a file another running story holds stops and waits, rather than editing in parallel.
K-17 is merged by the author (`tauri.conf.json`); every other story is merged by the lead when ready.

**The author's questions, in one place.** F-86: 1, 2; W-10.2, K-08.1, K-09.1: none; W-22: 1, 2; F-85: 1, 2; W-13: 1, 2;
K-17: 1, 2; W-12: 1 to 3; K-22: 1, 2; W-17: 1, 2; K-12: 1, 2; and the wave's own question below. Each card proceeds on its
recommended default unless the author says otherwise. Two questions block their cards until ruled, each because it
changes or adds a decision record:
- **F-85 question 1:** a create-only write in `shell-api`, a new privileged capability (ADR-0074, under ADR-0045).
- **W-12 question 1:** a settings page in v1, which ADR-0019 and `docs/scope.md` exclude (ADR-0075 amends ADR-0019).

**The wave's own question.**
1. May two running stories each append to `scripts/registry.json` and to `SCREENS` in `scripts/mock-pair.mjs`?
   *Recommended:* yes. Each addition is an entry at the end of a list; the second story to merge takes `main` and keeps
   both, and `check-registry` and `mock-pair.test.mjs` decide. Holding them one at a time would make this wave seven steps
   instead of five. `base.css`, `theme.css` and every other hot file keep one holder at a time. If the author says no,
   W-13 waits for W-22 (step 2 becomes two steps), and K-17 waits for W-12.
