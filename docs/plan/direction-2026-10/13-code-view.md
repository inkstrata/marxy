# Code as read: V-09 to V-16 (was lane K of PR #445)

**Imported 2026-10-11 by the replan ([12-replan-2026-10-11.md](12-replan-2026-10-11.md)).** This is PR #445's
`09-code-view.md` (2026-10-08, never merged), renumbered: its K-01 to K-08 are **V-09 to V-16** here, because the
direction's Phase K now owns K-01 to K-22. Its ADR-0056 and ADR-0057 are written as **ADR-0067** and **ADR-0068**
(0056 and 0057 were taken). Its waves "K1 to K3" read as V-code waves; its notes about D-11 are history (D-11 merged).
Models: every story runs on Sonnet first (the author, 2026-10-10), medium, high for V-11 and V-15.

**What still holds on `main` 7b543931** (the survey of 2026-10-11, headless WebKit):

| Story | Problem | On main |
| --- | --- | --- |
| V-10 | `# comment` in a `.py` file becomes a heading in Rendered | **reproduces** (re-checked 2026-10-12 on `main` 57578662: Rendered of `inventory.py` has an `h1` per `# section` line, and the rest is set as prose with `marxy-lb` breaks and hanging punctuation). The first survey missed it; V-10 stays a story of its own |
| V-11 | A code file shows as a Markdown page before Source mounts; `⌘E` during the open lands in Rendered | **reproduces** (Rendered at the first 60 ms sample) |
| V-12 | Source wears 18 on 30 px, no hanging indent on a wrapped line | **reproduces** |
| V-13 | Highlighting gaps; the modes colour code differently | **reproduces** (checked 2026-10-12 against `main`) |
| V-09, V-14 | Four extension tables disagree; about nine grammars (no Go, shell, TOML, C) | **reproduces** |
| V-15 | Rendered typeset while hidden; stale editor after a reload | **partly**: a reload, a theme relayout and a trust change set the hidden article (reproduces); the round trip lands on a block start, not the line (reproduces); an open from Source shows an empty overlay for the frames of the open (reproduces). Already right on `main`: the edit shows in Rendered after Source, the CRLF reload leaves the document clean, a Show source and an immediate open leave no editor behind (opens and mode switches share one queue), the block under the reading line holds still after a Source scroll |
| V-16 | Tab width 4 in Source, 8 in Rendered | **reproduces** |

**Rulings.** K-R2 was ruled (generous). The lead proceeds on the recommended defaults of K-R1 (14 on 21 px), K-R3
(code scrolls, Markdown in Source wraps with a hang) and K-R4 (a notice and plain monospace); each is on the author's
taste list, and V-12's before-and-after artifact is where the author vetoes it.

---

**Date:** 2026-10-08 · **Status:** planned; nothing dispatched · **Runs:** as its own lane beside Phase C,
inside the four-agent cap (`00-orchestration.md` §5); V-11 and V-15 land before D-11.

**Abstract.** The author, reading code files in the installed app, reported five things:
- Code view drops formatting, and line numbers do not line up with their lines.
- Many file types are not supported.
- Highlighting is weak, Python especially.
- Source is too big and loose, where it should be tight and exact.
- The swap between Source and Rendered is unreliable, and sometimes the Source view never appears.

Four research passes (2026-10-08) read the code and checked it against both research handbooks; the repro
pass drove the app in WebKit. Every report has a cause in the tree, and one cause is worse than reported:

- **Rendered parses every file as Markdown.** In a `.py` file, `# comment` lines become headings.
- **A code file reaches Source last.** It is first rendered and shown as that Markdown page. Source mounts
  only after the typesetter, the idle work and the theme restart have run.

The lane has eight stories. Ids are `K-nn`, and commitlint takes `(V-09)` as a plain parenthetical. A
richer Rendered *overview* of a source file (symbols, docstrings as prose) is deferred; see the last section.

## Measured (2026-10-08)

Method: Playwright WebKit over the browser-lite boot of `source-looks.test.mjs`, at 1280×800 in dark. The
fixtures were thirteen real files (Python with tabs, a CRLF copy, TypeScript, Rust, Go, JSON, YAML, TOML,
shell, Makefile, Dockerfile, a log, a 2.2 MB Python file). The scripts are not committed; a story that needs
them rebuilds them from this description.

**Source**
- Every file opens in Source.
- The editor text equals the file bytes in every case, with tabs, CRLF and long lines kept.
- Gutter misalignment is **0 px** on every unwrapped row. What reads as misalignment is the wrap: the
  487-character Python line takes 6 rows, starting at column 0, with one number. There is also a 60 px gap
  between the numbers and the code.
- Only about 25 lines fit in an 800 px window.
- Fold chevrons sit against every block line's number, and the active line is tinted on open with no caret:
  both are chrome at rest.

**Colour**
- Python, Rust and TypeScript reach 4–5 distinct colours in their first 100 lines.
- Go, TOML, shell, the Makefile, the Dockerfile and the log reach 1.

**Rendered**

| File | What Rendered does to it |
| --- | --- |
| `server.ts` | `Promise<T>` opens raw HTML; only 163 of 976 characters stay visible, behind the trust notice |
| `deploy.sh`, `Makefile` | `$…$` and `$(CC)`, `$@` become KaTeX math |
| `.py`, `.yaml`, `.toml` | `#` comments become `h1`, and `__name__` becomes bold |
| every file | the typesetter adds smart quotes, turns `--` into an en dash, merges lines and hyphenates identifiers (`im-port`) |
| `app.log` | its 120 lines become one paragraph |

**Place across a round trip.** Scroll a code file, go Source → Rendered → Source, and the top line moves:

| File | Top line before | Top line after |
| --- | --- | --- |
| `inventory.py` | 45 | 32 |
| `lib.rs` | 24 | 6 |
| `server.ts` | 8 | 1 |
| `app.log` | 50 | 1 |

The place travels through the misparsed Rendered blocks.

**Toggles.** Presses made while the editor builds are dropped, so ten quick Mod+E presses end in a mode that
depends on timing, not on the count. No console error and no blank view appeared in any run.

**The 2.2 MB file** opens in Source in about 1.9 s. CodeMirror logged "Measure loop restarted more than 5
times" in one run of two. Its Rendered view builds about 2 M characters of typeset paragraphs.

## What is wrong, worst first

Sources (relative to `apps/desktop/src/` unless the path says otherwise):
- `document/store.ts:144`
- `app.ts:475-520` (`finishDocumentOpen`), `app.ts:617-626` (`bootDocument`)
- `view/rendered-view.ts`
- `source/*`
- `packages/core/src/index-model/kinds.ts`
- `packages/core/src/highlight/*`
- `packages/theme/src/tokens.css`
- `theme/reader-config.ts`

### 1. Faithfulness: a code file in Rendered is Markdown

`store.ts:144` calls `parseMarkdown` for every path. In Python, shell, YAML, TOML and Dockerfiles:
- `#` comments become headings;
- `*` and `_` become emphasis;
- indented code is reflowed.

This breaks commitment 3 (faithful) and the code chapter's first rule: code is verbatim and never "improved"
(`docs/research/reader-typography/06-code.md`, "Code is verbatim text"). Shiki runs only on fences inside
that parse. **V-10.**

### 2. Reliability: the open path shows the wrong page first, and Source can fail to mount

These are the causes of "the swap isn't good" and "it craps out":

- **The wrong page first.** `finishDocumentOpen` mounts Source at the end (`app.ts:490-491`), after:
  - the first typeset pass;
  - the idle callback (images, math, highlighting, the user theme);
  - an IPC mark.

  Until then the Markdown-mangled page is on screen.
- **A Mod+E during an open runs late.** It is queued behind the open, not dropped (`rendered-view.ts:435-446`
  checks `modeToggleBusy` before queuing). When the open finishes and Source mounts, the queued toggle flips
  the reader straight back to the mangled page.
- **Some boot paths never mount Source.** `bootDocument` returns `finish(1)` for `no_paint` or `no_text`
  with zero blocks (`app.ts:621-625`). Examples:
  - an empty `.py`;
  - an `.html` whose raw HTML the sanitiser removed.
- **Failures are invisible or destructive.**
  - A failed Source import on Mod+E is an unhandled rejection: nothing happens, with no notice
    (`selection/bind.ts:91`).
  - The same failure during an open replaces the document with an error string (`app.ts:539-549`).
  - Unguarded `shell.watch` and `shell.configPaths` calls in `theme/user-theme.ts:120,140` run before
    `showSource` and can produce that error.
- **Rendered is set while hidden.** These run on the `display:none` article:
  - the typeset pass, the grid pass and the landing anchor, when leaving Source after an edit
    (`rendered-view.ts:827-833`);
  - the same, after a reload in Source;
  - the same, when another document is opened from Source (`keepOnGrid` records width 0, `:680`;
    `holdAnchor` returns early, `:561`);
  - `relayoutForTheme`, which never checks the mode (`:501-510`).

  The page then reappears unset or misplaced.
- **Opening from Source shows an empty overlay.** `view.clear()` destroys the editor but leaves the overlay
  visible for the whole open.
- **The editor keeps its first configuration.** `replaceBuffer` swaps only the text (`source/editor-cm6.ts:35-47`).
  It keeps the language, `lineSeparator`, wrapping and the large-file mode. So:
  - a reload that changes line endings marks the document dirty;
  - a rename from `.txt` to `.py` keeps the old grammar.
- **A stale editor can load.** An off-queue "Show source" (`trust/controller.ts:138`) can finish after
  another open has started, and load the previous document's text (`rendered-view.ts:350-355`).

**V-11** (the open path), **V-15** (the swap).

### 3. Looks: Source wears Rendered's code metrics

Source has no metrics of its own:
- 18 px type on a 30 px line (1.667), the body-code size of Rendered (`source/theme-bridge.ts:37,43,52`;
  `tokens.css:14-15`);
- 60 px side padding (`:49`).

What the research says:
- Code leading should be **1.5–1.6** (`06-code.md`, "Line length, tabs and line height").
- The artifacts chapter keeps 30 px only to stay on the prose grid, graded **[D]**
  (`reader-artifacts/04-code-typography.md`, "Leading"). A code file in Source has no prose to share a grid
  with, so that argument does not reach it.
- Neither handbook sets an editor size.
- The cited incumbents are GitHub (13 px / 1.5) and VS Code (1.5 on macOS).

Line numbers:
- The gutter and the content share the font and the line box, so a short line aligns.
- Lines **wrap silently** below 2 MB (`source/editor.ts:169-171`), with no hanging indent and no
  continuation mark.
- A wrapped line gets one number, and its continuation starts at column 0. That reads as a misaligned
  number and as dedented Python.
- This breaks both handbook positions:
  - `06-code.md`: never wrap indentation-sensitive languages silently;
  - ADR-0033 §5: wrap only with a hang and a rule.
- Rows drawn in a fallback font (emoji, CJK, box drawing) also grow past 30 px. The text baseline then drops
  below the number's.

Gutter padding:
- CodeMirror's `.cm-lineNumbers .cm-gutterElement { padding: 0 3px 0 5px }` outranks Marxy's
  `.cm-gutterElement`, so the intended gutter padding never applies.
- The gap between number and code is the 60 px content padding: loose, not exact.

Weight: Source is 400 in dark, where Rendered code is 380, because `#marxy-source` sits outside
`.marxy-article`.

**V-12.**

### 4. Highlighting: deliberate restraint, plus real gaps

The restraint is deliberate:
- ADR-0033 follows the handbook's "Alabaster" school: colour strings, constants, comments and definitions,
  and leave keywords, calls and variables plain (`06-code.md`, "Fewer colours, reliably applied").
- Seven of the twelve roles fall back to the code-text colour, which leaves four hues.
- The evidence under highlighting is thin. The largest study (390 students) found no gain in comprehension.
  The palette choice is **[D]**, so its breadth is the author's taste call.
- **Ruled 2026-10-08 (K-R2): broadly generous highlighting,** including Markdown in Source (titles,
  headings and their marks, links, code, list and quote marks). Every role gets its own hue. The restraint
  above is reversed by ADR-0068, which V-13 writes.

The gaps break even the handbook's own rule:
- **Definitions.** Class definitions are uncoloured in Source. The handbook's sample says definitions carry
  "weight as well as colour", and nothing applies weight.
- **Unmapped tags.** `t.escape`, `t.macroName`, `t.labelName` and `t.attributeValue` match no rule
  (`source/highlight-style.ts`). Escapes inside strings go plain, as do Rust macros and HTML or JSX attribute
  values.
- **Decorators** are plain in Source and blue in Rendered.
- **The two modes disagree.** Shiki (Rendered) and Lezer (Source) colour the same Python differently:
  decorators, builtins left uncalled, escapes, f-string placeholders, Rust macros, attribute values
  (`packages/core/src/highlight/scopes.ts` against `highlight-style.ts`).

**V-13.**

### 5. Coverage: four tables, eight grammars

Four tables decide a file's kind, and they disagree:

| Table | Decides | File |
| --- | --- | --- |
| `RENDERED_EXT` | the mode | `source/default-mode.ts:5` |
| `BY_EXT` | the CodeMirror language | `source/language.ts:11-30` |
| the index allow-list | indexing and watching | `kinds.ts` |
| Shiki's aliases | Rendered colour | `languages.generated.ts` |

The disagreements:
- **`.mdown`, `.mkd` and `.text`** are Markdown or text to the index and the Open dialog, but open in Source
  with no language.
- **Source has eight grammars:** Markdown, JS/TS, Python, Rust, CSS, JSON, YAML, HTML. Everything else is
  plain in Source: Go, C/C++, Java, Kotlin, Swift, SQL, TOML, shell, XML, Ruby, PHP, Lua, Makefile,
  Dockerfile, diff, `.ini`, `.env`, `.mts`/`.cts`, `.pyi`.
- **Shiki colours some of these in Rendered** fences, so the same code is coloured in one mode and plain in
  the other.
- **Fences inside a `.md` in Source** are uncoloured: `markdown()` gets no `codeLanguages`.
- **Line endings.** A CR-only file shows as one line (`lineSeparator` is `\r\n` or `\n` only,
  `source/editor.ts:89-93,163`). A mixed file shows red `\r` placeholders in a colour that is not a Marxy
  token.

**V-09** (one table), **V-14** (grammars and line endings).

### 6. Tabs differ between the modes

- **Source** reads `.editorconfig`. **Rendered** is fixed at `tab-size: 4` (`base.css`) with `TAB = 4` in
  `render/highlight.ts`.
- `04-code-typography.md` warns that both must read one source, or the hang of a wrapped tab-indented line
  comes out wrong.
- The EditorConfig reader has bugs (`source/editorconfig.ts`):
  - a matching section with no tab keys still wins, and shadows `[*]`;
  - sections are not merged;
  - `root = true` is ignored;
  - `{a,b}` and `**` globs are not supported;
  - the search climbs to the first path component, `/Users`, over IPC on every Source build.

**V-16.**

## Rulings the lane needs

The plan assumes the answer in parentheses until the author rules.

- **K-R1. Source metrics.** At the default text size, what should Source's size and line be?
  - (a) **14 px on 21 px (1.5).** Recommended: inside the handbook's 1.5–1.6 and near the incumbents.
  - (b) 15 px on 23 px (1.53).
  - (c) Keep 18 on 30 and fix only the wrap and the gutter.

  Either (a) or (b) scales with the reader's text size, at a fixed ratio to the body. Either needs ADR-0067,
  because it adds `--marxy-*` tokens. Rendered's code blocks keep 18 on 30: they sit in prose and stay on its
  grid.
- **K-R2. Palette breadth. Ruled 2026-10-08: broadly generous.**
  - Keywords, types and classes, functions (defined and called), properties, decorators and attributes,
    builtins, `self`/`this`, escapes, macros and operators each get a colour.
  - Plain text is left for variables and punctuation.
  - The existing roles that fall back to the code-text colour (keyword, type, variable, operator, punctuation,
    attribute) get real values. That is a value change, and a story.
  - The roles that do not exist yet (builtin, property, decorator, self, escape) need new token names, so
    ADR-0068.
  - The handbook's floor still holds: every role at 4.5:1 or better on its ground in both variants, and
    neighbouring roles separated in lightness as well as hue (`06-code.md`, "Colour vision and non-colour
    cues").
- **K-R3. Wrapping in Source.**
  - (a) **Code files scroll horizontally; Markdown in Source wraps with a hang.** Recommended: the handbook's
    rule, and VS Code's default.
  - (b) Everything wraps, with the hang and a rule.

  Rendered's code blocks keep ADR-0033 §5 (wrap with hang and rule) either way.
- **K-R4. A failed Source mount.** What does the reader see?
  - (a) A notice that names the failure, with the file shown as plain monospace text in Rendered.
    Recommended.
  - (b) The error string as today.

## Stories

| Id | Title | Model | Size | Depends on | Wave |
| --- | --- | --- | --- | --- | --- |
| V-09 | One file-type table: mode, index kind, CodeMirror and Shiki ids from one place | sonnet | S | — | K1 |
| V-10 | Rendered shows a code file as code, never as Markdown | opus | M | V-09 | K2 |
| V-11 | A code file opens straight into Source, and a failed mount says so | opus | M | V-09, K-R4 | K2 |
| V-12 | Source has its own metrics: tighter type, an exact gutter, scroll for code (ADR-0067) | opus | M | K-R1, K-R3 | K1 |
| V-13 | Generous highlighting: a hue per role, every tag mapped, Rendered and Source agree (ADR-0068) | opus | M | V-12 (`tokens.css`) | K2 |
| V-14 | Source grammars for the common languages, fences in Markdown, every line ending | sonnet | M | V-09, V-12 | K3 |
| V-15 | The swap keeps Rendered right: nothing set while hidden, no stale editor | opus | M | V-11, V-10 | K3 |
| V-16 | One tab width for both modes, and a correct EditorConfig reader | sonnet | S | — | K1 |

**Waves.** Within a wave, paths are disjoint.
- **K1:** V-09, V-12 and V-16, as soon as the rulings they name are in. V-09 and V-16 need none.
- **K2:** V-10 and V-11, both after V-09; V-13 after V-12 (both edit `tokens.css`).
- **K3:** V-14 (after V-12, which owns `source/editor.ts`), then V-15 (after V-11, which owns
  `view/rendered-view.ts`).

V-11 and V-15 land before D-11, which moves `source/editor.ts` into panes. They also supersede L-07: V-12
takes its column and ground.

**Every story's PR** carries before/after screenshots of the same Python, TypeScript and Rust files, in both
modes and both variants, at 1280 px. A taste-queue entry is optional.

### V-09 — One file-type table

**Model:** sonnet · **Size:** S · **Depends on:** none

**Outcome.** One pure table in core maps a path (extension, or an exact name such as `Makefile` or
`Dockerfile`) to four things:
- its kind: markdown, text, source or theme;
- its default mode;
- its CodeMirror language id;
- its Shiki language id.

The mode rule, the index allow-list, the Source language loader and the line-number default all read it.
`.mdown`, `.mkd`, `.mdx` and `.text` open as the index already classes them. The Tauri file associations list
what the table calls source.

**Paths.**
- `packages/core/src/index-model/file-types.ts` (new) and its test
- `packages/core/src/index-model/kinds.ts`
- `apps/desktop/src/source/{default-mode,language,line-numbers}.ts`
- `apps/desktop/src-tauri/tauri.conf.json`
- `changelog.d/V-09.md`

**Acceptance.**
- A table test: every extension in `kinds.ts` and in `BY_EXT` resolves to the same kind and mode through the
  new module.
- `.mdown` opens Rendered (a WebKit test through `defaultModeForPath`).
- `scripts/check-boundaries.mjs` stays green: the module takes no DOM.

**Do not.**
- Add grammars (V-14).
- Change what Rendered does with a code file (V-10).

### V-10 — Rendered shows a code file as code

**Model:** opus · **Size:** M · **Depends on:** V-09

**Outcome.**
- For a path V-09 calls source, the store builds its AST with a new `parseCode(bytes, { file, lang })`, not
  `parseMarkdown`.
- The AST is a document whose children are code blocks of at most 200 lines each, in the file's language.
  Each block carries exact `{file, start, end}` provenance, and together they tile the bytes with no gap.
- Rendered draws the run as one visual block:
  - Shiki highlights each chunk lazily, as today;
  - the gutter of numbers follows `04-code-typography.md` "Line numbers": generated content, the file's line
    numbers, never selectable;
  - a language with no grammar falls back to plain monospace, never to a guess (`06-code.md`, "Choosing one
    for a reader").
- Text files (`.txt`, `.log`) stay as they are.

**Why chunks.** Commitment 5: first text never waits for the whole file. A-02's first-screens path then works
unchanged.

**Paths.**
- `packages/core/src/parse/code.ts` (new); the core index export
- `apps/desktop/src/document/store.ts`
- `packages/theme/src/base.css`, for the run's joins and the counter rule
- `fixtures/corpus/` (a real `.py` and `.rs`) and their goldens
- tests
- `changelog.d/V-10.md`

Uses the existing `code` node kind, so no contract change. If a field is needed, add it by ordinary PR
(ADR-0045).

**Acceptance.**
- A `.py` with `# comment` lines yields no heading node (core test).
- `pnpm gate:fidelity` covers the new fixtures.
- In WebKit, Rendered of the `.py` shows its text byte-for-byte, with tabs and long lines kept or marked as
  `highlight.ts` already marks them.
- Copying a chunk boundary copies the source bytes.
- The 2 MB Python file's first text arrives without waiting for the last chunk (record the number).

**Do not.**
- Build an overview of symbols (deferred).
- Touch the open path (V-11).

**Risks.**
- The outline and the palette's heading rows read the AST, and a code file now has none. Show nothing
  rather than a fake outline.
- Selection granularity on a chunk is "block". Check that Alt+Shift+Up from a line does something sensible.

### V-11 — A code file opens straight into Source

**Model:** opus · **Size:** M · **Depends on:** V-09; the author's K-R4

**Outcome.**
- For a file whose default mode is Source, `finishDocumentOpen` and `bootDocument` mount Source first. The
  Rendered pass for that file is deferred until the reader first asks for Rendered. Nothing Markdown-shaped
  is ever painted for it.
- Mod+E presses are never lost or reordered: each press is a request against the mode in force when it was
  pressed. Ten quick presses on any file end where ten flips would end (measured: they end by timing today).
- A Mod+E pressed during an open applies to the document that finished opening, as the reader meant it.
  Either drop it, or resolve it against the mode in force when it was pressed. Never flip the mode after the
  fact.
- The `no_paint` and empty-file paths still mount Source.
- A failed Source mount follows K-R4: a notice naming the failure, never a silent no-op and never a
  destroyed document. The two unguarded user-theme calls get guards.

**Paths.**
- `apps/desktop/src/app.ts` (`finishDocumentOpen`, `bootDocument`, `openReplacing`)
- `apps/desktop/src/view/rendered-view.ts` (`toggleViewMode`, `jumpToSource`, `showSource`)
- `apps/desktop/src/selection/bind.ts` (the command's rejection)
- `apps/desktop/src/theme/user-theme.ts`
- a new `apps/desktop/test/code-open.test.mjs`
- `changelog.d/V-11.md`

**Acceptance.** WebKit tests, each failing on `main`:
- Opening `x.py` never paints an `h1` in `#doc` before `.cm-editor` appears. Sample every frame until
  Source mounts.
- Mod+E pressed before `.cm-editor` exists leaves the reader in the mode they chose, once the queue drains.
- Ten `Meta+E` presses, sent as fast as Playwright sends them, end in the starting mode, on a `.md` and on a
  `.py`.
- An empty `.py` mounts Source.
- With `@codemirror/lang-python`'s import forced to fail:
  - Mod+E shows the notice;
  - opening `x.py` keeps the document and shows the notice.
- First text for a code file is no slower than on `main` (record it).

**Do not.**
- Change Rendered's handling of a code file (V-10).
- Touch the swap's hidden-article passes (V-15).

### V-12 — Source has its own metrics

**Model:** opus · **Size:** M · **Depends on:** the author's K-R1 and K-R3 · **Supersedes:** L-07

**Outcome.**
- **ADR-0067** (proposed in this PR) adds `--marxy-size-source` and `--marxy-line-box-source`, derived from
  the reader's text size at the ruled ratio. It records the departure: Source leaves the prose grid because
  it holds no prose.
- **Gutter.** One rule that outranks CodeMirror's base theme sets an exact padding, in units of the new line
  box. Numbers are right-aligned, tabular, in the secondary colour at 4.5:1 or better, and hung left of the
  content.
- **Wrapping** follows K-R3. Code files are unwrapped and scroll inside the editor. Markdown wraps with a
  hang: `text-indent` hanging past the line's own indent, as `base.css` does for `pre`.
- **Row height.** Every row keeps exactly one line box, including rows drawn in a fallback font:
  `line-height` on the inline runs, the way `base.css` holds prose.
- **Weight.** Source takes the article's weight variable, so it is 380 in dark.
- **Nothing at rest.** Fold chevrons appear on hover of the gutter, not on every block line, and the active
  line is tinted only while the editor has focus (ADR-0011).
- **Column and ground (L-07's outcome).** Markdown sits in a column as wide as Rendered's. Code files sit in
  a column of at most 100 characters at the new size. Both are centred and on the page ground.
- Update the stale rows of `docs/research/reader-artifacts/10-spec.md` (ligatures, tabs, gutter, folding).

**Paths.**
- `docs/adr/0056-source-metrics.md`
- `packages/theme/src/tokens.css`
- `scripts/registry.json`
- `apps/desktop/src/theme/reader-config.ts`
- `apps/desktop/src/source/{theme-bridge,editor}.ts`
- `apps/desktop/test/source-looks.test.mjs`, `apps/desktop/test/source-place.test.mjs` (new)
- `docs/research/reader-artifacts/10-spec.md`
- `changelog.d/V-12.md`

**Acceptance.** WebKit tests, each failing on `main`:
- `.cm-content` font size and line height equal the new tokens at sizes 16, 20 and 26.
- For the first 200 lines of a Python file with a 300-character line, an emoji line and a CJK line, every
  `.cm-gutterElement`'s top equals its `.cm-line`'s top within 0.5 px.
- No `.cm-line` is taller than one line box.
- A `.ts` line of 300 characters does not wrap (K-R3 a). A Markdown line wraps with its continuation indented
  past its first row.
- The gutter's computed padding is the token value, not 3 px / 5 px.
- In dark, the computed weight of `.cm-content` is 380.
- L-07's acceptance list: the axis, the column, the numbers outside the content, the ground.

**Do not.** Touch `rendered-view.ts` or the reading position (V-15, F-04).

**Risks.** CodeMirror lays out gutters and content as flex siblings, so centring the content with the numbers
hung outside needs care with selection painting (L-07's risk, carried over).

### V-13 — Generous highlighting: a hue per role, every tag mapped, the modes agree

**Model:** opus · **Size:** M · **Depends on:** V-12 (`tokens.css`, `scripts/registry.json`) · **Ruling:** K-R2,
broadly generous

**Outcome.**
- **ADR-0068** (proposed in this PR) records the departure from ADR-0033's minimal palette and its reason: the
  evidence is **[D]** either way, and the author reads code by its colours. It adds the new roles
  `--marxy-tok-{builtin,property,decorator,self,escape,heading,mark}`.
- **The default theme gives every role a value** in both variants:
  - the six that fall back to code text today;
  - the five new roles.

  Variables and punctuation stay near the text colour.
- **The palette is built in OKLCH, and these are tested facts:**
  - every role is at 4.5:1 or better on the code ground and on the page ground;
  - roles that sit next to each other in code (keyword and function, type and variable, string and escape)
    differ in lightness as well as hue;
  - comments stay readable, not dimmed.
- **One role table** names, for each role, the Lezer tags it covers (Source) and the TextMate scopes it covers
  (Rendered). Both modes are built from it, so the same token gets the same role in both.
- **Tags no rule matches today:**
  - `escape` maps to escape;
  - `macroName` to function;
  - `attributeValue` to string;
  - `labelName` to variable;
  - `definition(className)` to type;
  - Python decorators and Rust `#[...]` to decorator;
  - `self` and `this` to self;
  - `standard(variableName)` and Shiki's `support.function` / `support.type` to builtin.
- Definitions (`def`, `fn`, `class` names) also take a heavier weight. JetBrains Mono is fixed-width at every
  weight, so alignment is unchanged.
- **Markdown in Source is generous too** (the author, 2026-10-08). Today headings and strong are only bold,
  and everything else is plain. With this story, `@lezer/markdown`'s tags get roles:
  - headings, the `#` marks and the setext underline: the new `heading` role, with ATX levels kept by weight,
    not by size, so every row stays one line box;
  - emphasis and strong: italic and bold, in text colour;
  - link text: function;
  - URLs and link destinations: string;
  - inline code and fences: string, with fence info strings as keyword;
  - block-quote marks, list bullets and numbers, task boxes and the horizontal rule: the new `mark` role;
  - frontmatter delimiters: decorator, with the frontmatter body coloured as YAML (`markdown()` takes it as a
    nested language);
  - raw HTML: `tag` and `attribute`;
  - math delimiters: constant.

  `heading` and `mark` join ADR-0068's new roles. They are Source-only: Rendered sets
  headings as type, not colour, and draws no marks.
- **Status hues stay out of code.** Per `04-code-typography.md` "Colour budget", diff and log severity never
  take a token hue: generous applies to syntax, not to status.

**Paths.**
- `docs/adr/0068-generous-highlighting.md`, its row in `docs/adr/README.md`
- `packages/core/src/highlight/roles.ts` (the one role table), `apps/desktop/src/source/language.ts`,
  `packages/theme/ink/theme.css`, `packages/theme/src/loader.ts`, `packages/theme/tokens.contract.json`,
  `scripts/gate-contrast.mjs`, `scripts/gate-aesthetics.mjs`, `scripts/check-tokens.test.mjs`
  (the six new names reach each list that enumerates the tokens)
- `packages/theme/src/tokens.css`, `packages/theme/default/theme.css`
- `scripts/registry.json`
- `packages/core/src/highlight/scopes.ts`
- `apps/desktop/src/source/highlight-style.ts`
- `packages/theme/src/base.css` (`.marxy-tok-*` classes and weights)
- `packages/theme/test/palettes.test.mjs`
- a parity test
- `changelog.d/V-13.md`

The aesthetics baselines move. Regenerate them in this PR, alone in its wave (`00-orchestration.md`).

**Amended 2026-10-12 (V-13, against `main`).**
- ADR-0068 is written at `docs/adr/0068-generous-highlighting.md` (the card's path said 0057, a number taken by an older
  ADR). `heading`, `marker` and `link` were already contract 2's, so the new names are six, not seven:
  `-builtin`, `-property`, `-decorator`, `-self`, `-escape`, `-mark`.
- The parity test covers Python, TypeScript and Rust in both engines. Go and shell have no Lezer grammar until V-14, so
  their Rendered roles are tested alone. Where Lezer cannot tell what Shiki can (Python `self`, Python builtins, a
  Rust field access, a Rust string escape), the test names the gap and fails when it closes.
- Not done, with the reason in the ADR: Rendered's heavier weight on a definition, and Markdown frontmatter as a
  decorator with a YAML body. Link text keeps `-link` (ADR-0059's role) rather than `function`.

**Acceptance.**
- `palettes.test.mjs` asserts the contrast and the lightness separation for every role in both variants.
- A parity test tokenises one fixture per language (Python, TypeScript, Rust, Go, shell) with both engines and
  asserts the same role for each listed construct: keyword, decorator, class definition, `def` name, call,
  builtin, `self`/`this`, property, escape, f-string placeholder, macro, attribute value, number, comment.
- In WebKit, a Markdown fixture in Source shows every heading level, link, URL, inline code span, list
  marker and quote mark in a non-text token colour, and every row stays one line box.
- In WebKit, the Python fixture in Source uses at least nine distinct token colours in its first 100 lines,
  and no keyword, decorator, class name or escape is left in the code-text colour.

**Do not.**
- Add grammars (V-14).
- Colour status: diff, log severity.
- Change a token's meaning beyond what ADR-0068 says.

### V-14 — Source grammars, fences in Markdown, every line ending

**Model:** sonnet · **Size:** M · **Depends on:** V-09 (the table), V-12 (`source/editor.ts`)

**Outcome.**
- **Grammars.** Source loads a grammar, lazily, for every language V-09's table gives a Shiki id:
  - Go, C/C++, Java, SQL, XML, PHP: their `@codemirror/lang-*` packages;
  - TOML, shell, Dockerfile, Ruby, Swift, Kotlin, Lua, R, diff, properties/ini: `@codemirror/legacy-modes`
    through `StreamLanguage`;
  - `.mts`, `.cts` and `.pyi` map to their family.

  Every dependency is MIT and on the allowlist.
- **Fences.** `markdown()` gets `codeLanguages` from the same table, so fences in a `.md` are coloured in
  Source.
- **Line endings.**
  - A CR-only file shows its lines: `lineSeparator` from the buffer's `eol`, including `cr`.
  - A mixed file shows no CodeMirror-red placeholders. The CR mark, if shown, uses a Marxy token and is
    marked, per commitment 4.
- **Large files.** Above 2 MB, a file keeps its grammar if Lezer's incremental parse holds the budget
  (measure it). Otherwise it stays plain and says so, once, in a notice.

**Paths.**
- `apps/desktop/src/source/{language,editor}.ts`
- `apps/desktop/package.json`, `pnpm-lock.yaml`, `scripts/allowlists/dependencies.json`
- tests
- `changelog.d/V-14.md`

**Acceptance.**
- In WebKit, each listed language's fixture has at least one span in a non-text token colour.
- A CR-only fixture shows N lines.
- `pnpm gate:fidelity` and the byte-fidelity property test stay green for CR and mixed files through a
  Source round trip.
- The licence audit is green.

### V-15 — The swap keeps Rendered right

**Model:** opus · **Size:** M · **Depends on:** V-11 (`view/rendered-view.ts`), V-10 (for the round-trip place)

**Outcome.**
- **Nothing is set while hidden.** While Source is showing, Rendered is never typeset, gridded or anchored.
  Changes mark the article stale, and `showRendered` does the work once, visibly, holding the reader's place:
  - `commitSource` re-render;
  - reload;
  - theme relayout;
  - trust re-render.
- **The place survives a round trip.** Source → Rendered → Source keeps the top line of a code file (needs
  V-10's line-exact blocks).
- **No empty overlay.** Opening another document from Source never shows an empty overlay.
- **The editor follows the document.** `replaceBuffer` reconfigures the language, `lineSeparator`, wrapping
  and large-file mode when the path, `eol` or size class changes.
- **No stale editor.** `ensureSourceEditor` checks a per-open generation before installing, so a late editor
  for a closed document is discarded.

**Paths.**
- `apps/desktop/src/view/rendered-view.ts`
- `apps/desktop/src/source/editor-cm6.ts`
- `apps/desktop/src/document/live-reload.ts`, only if the reload hook moves
- `apps/desktop/test/mode-swap.test.mjs` (new)
- `changelog.d/V-15.md`

**Acceptance.** WebKit tests (`apps/desktop/test/mode-swap.test.mjs`). Checked against `main` on 2026-10-12: the
first, second and fourth already pass there and stay as guards; the others fail on `main`.
- Enter Source on a long `.md`, type a character, scroll far, press Mod+E. The block under the reading line is
  the same block one second later, and every paragraph carries the typeset class. *(Passes on `main`.)*
- In Source, write the file externally with LF changed to CRLF, then leave. The document is not dirty. *(Passes
  on `main`.)*
- In Source, open another `.md` with a stored position. No frame shows an empty `#marxy-source`, and the
  landing byte is at the reading line. *(Fails on `main` when the open's IPC is slow.)*
- "Show source", then an immediate open of another file: the next Mod+E commits nothing into the new store.
  *(Passes on `main`: an open and a mode switch share one queue, so the late editor cannot install. No per-open
  generation is needed.)*
- Scroll `inventory.py` to a line, then go Source → Rendered → Source: the line on the reading line is the same.
  *(Fails on `main`: the block's start. The card's "top line 45 against 32" assumed V-10's line-exact blocks; the
  view remembers the byte it left Source at instead, so it holds for every file, V-10 or not.)*
- While Source shows, a reload, a theme relayout and a trust change leave `#doc` untouched (no mutation, no
  repaint measure); Rendered, when it comes, is current and typeset. *(Fails on `main`.)*
- An edit typed in Source shows in Rendered for `.md` and `.py` with LF, CRLF, a BOM, both and stray bytes, and no
  other byte moves; for a `.py` before its Markdown parse was ever made, even with the switch made at once.

**Do not.** Change the reading-position model (F-04's), only when it runs.

### V-16 — One tab width, and a correct EditorConfig reader

**Model:** sonnet · **Size:** S · **Depends on:** none

**Outcome.**
- **One source for the tab width.** Rendered reads the same resolved tab width as Source, for the open file.
  `tab-size` comes from a custom property the app sets, and `TAB` in `render/highlight.ts` reads it. A fence
  inside Markdown keeps 4.
- **The EditorConfig reader follows the spec:**
  - matching sections merge in file order, later wins;
  - `root = true` stops the walk;
  - `{a,b}`, `{n..m}` and `**` globs are supported;
  - the walk stops at the indexed root or at a `.git`, never at `/Users`;
  - one walk per directory per session, cached.

**Paths.**
- `apps/desktop/src/source/{editorconfig,tab-width}.ts`
- `apps/desktop/src/render/highlight.ts`
- `packages/theme/src/base.css` (`tab-size: var(...)`)
- tests
- `changelog.d/V-16.md`

**Acceptance.**
- Unit tests for each spec case listed above. Each fails on `main` where `main` gets it wrong.
- In WebKit, a tab-indented `.go` under `[*.go] indent_size = 8` has the same tab width in both modes, and
  its wrapped row hangs at the right column.

## Deferred: a Rendered overview of a source file

The author's idea: Rendered could later give a source file more than a highlighted listing:
- an outline of its symbols;
- module and function docstrings set as prose;
- comments set as marginalia.

It is deferred until after V-10 ships and has been read with for a while. It needs:
- a symbol outline, from the Lezer tree V-14 loads;
- a rule for which comments become prose;
- an answer to commitment 4 for every place the overview reshapes the file.

When the author wants it, it becomes a design note and an ADR, not a story card.
