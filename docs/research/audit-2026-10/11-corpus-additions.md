# Corpus additions: five fixtures the corpus was missing

**Date:** 2026-10-01. **Task:** `corpus`, part of the project audit (MARXY-346). The five files are
written and verified but sit in the agent's scratch directory, not in `fixtures/corpus/`; the lead
moves them in. Nothing in the repository other than this document was changed.

*Abstract.* Marxy's fixture corpus has 23 markdown files and nearly all of them are tidy: well-formed
documents that a person wrote on purpose. The content Marxy exists for (READMEs, then AI and agent
artifacts, then source, then prose) mostly arrives in a worse state: pasted out of a chat window,
exported from an issue tracker or a notebook, or generated at a size nobody reads in one sitting.
This document describes five new original fixtures that cover that gap, says what each one
exercises, gives the provenance text for `fixtures/corpus/README.md`, and lists what a maintainer
must do when adding them. Running the five through the real pipeline and the real gates, in a
scratch copy of the repository, found four things worth the lead's attention (next section). One of
them changed the design of the largest fixture.

## Findings

1. **Heading anchors are generated and then thrown away.** In `32-long-reference.md`, 340 of 395
   heading `id`s do not survive sanitising, so all 123 in-document links
   (`[see §4.2](#42-...)`) point at nothing in Rendered mode. The cause is the id pattern
   `/^[A-Za-z][A-Za-z0-9_.:-]{0,64}$/` at `packages/core/src/sanitize/policy.ts:106`, applied to
   `h1` to `h6` at `policy.ts:168-173`. Any id that starts with a digit, an emoji, or is longer than
   65 characters is removed. GitHub slugs of numbered headings (`42-retry-policy`) start with a
   digit, so every numbered reference manual loses its anchors. `docs/research/reader-artifacts/10-spec.md`
   still says "headings carry no id"; the ids exist (`packages/core/src/render/heading-ids.ts`) and
   are removed afterwards.
2. **A 195 KB document is the ceiling for the aesthetics grid check, not a 241 KB one.** The first
   version of the scale fixture (241,463 bytes) failed `gate:aesthetics` on its own, before any
   baseline question: `<li> top 163848.52 (unit 12)` at 960 px and 16 px type, three list items in
   dark and one in light, about 164,000 px down the page, 0.02 px past the gate's 0.5 px tolerance
   (`scripts/gate-aesthetics.mjs:181`). A 213 KB variant failed the same way at 144,756 px, and a
   199 KB variant passed at 16 px but failed at 28 px (`<li> top 208425.52 (unit 21)`). The shipped
   fixture (194,997 bytes) passes at every size. Element tops drift off the grid by fractions of a
   pixel and the drift becomes visible past roughly 140,000 to 200,000 px of page height. The gate
   has no way to say "this document is too tall for the check". The gate renders through the
   app's own render entry, so a reader with a very long document very probably gets the same
   drift; I did not check the app itself. See "Gate consequences".
3. **Pandas-style HTML output leaks its CSS into the page.** A notebook export puts a
   `<style scoped>` block with a blank line inside it at the top of every DataFrame. CommonMark ends
   an HTML block at a blank line, so the first half of the rule is a raw HTML block, the second half
   becomes an indented code block, and `</style>` starts another HTML block (golden AST lines
   35 to 37 of the new `30-notebook-export` golden). Marxy then drops the `<style>` elements
   (two `element:style` and two `truncation:style` removals) and shows the stray CSS as code. This
   is what the export really does, so it is the right thing to have in the corpus.
4. **Smaller facts the fixtures pin.** `<details>` and `<summary>` are removed with their contents
   kept (`24-issue-thread`); 38 ESC bytes reach the rendered HTML (spec line "ANSI escapes:
   Contradicted"); the base64 PNG in `30-notebook-export` has its `src` removed with no visible
   trace; the two remote images in `24-issue-thread` become `data-marxy-remote` placeholders and
   zero requests. Details are in the per-file tables.

Two housekeeping facts for the lead:

- The corpus already has `29-hidden-characters.md`. The brief names the new issue thread
  `24-issue-thread.md`. Nothing breaks (every gate keys on the full file name, and the two sort
  apart), but two files sharing a prefix breaks the "numbered files are the cases" convention.
  Prefixes 20 to 22, 24 and 25 are free; `24-issue-thread.md` would avoid the clash. I kept the
  requested name.
- The `fixtures/corpus/README.md` rule is "numbered files are the cases". `32-long-reference.md` is
  a generated file; the generator must live beside it (below).

## The five files

All five are LF, UTF-8 without BOM, end with a newline, and are original text. No real person, real
secret, or resolving URL appears in any of them.

```sh
cd /private/tmp/claude-501/-Users-ian-Dev-marxy/846bd58f-e5cb-4052-8d36-5ad2cf9af740/scratchpad/corpus
wc -c 28-llm-answer.md 24-issue-thread.md 30-notebook-export.md 31-essay.md 32-long-reference.md
grep -c $'\r' 28-llm-answer.md 24-issue-thread.md 30-notebook-export.md 31-essay.md 32-long-reference.md
shasum -a 256 28-llm-answer.md 24-issue-thread.md 30-notebook-export.md 31-essay.md 32-long-reference.md
```

| File | Bytes | Lines | Requested size | Headings (AST) |
| --- | ---: | ---: | --- | ---: |
| `28-llm-answer.md` | 9,517 | 251 | 8 to 12 KB | 14 |
| `24-issue-thread.md` | 8,560 | 239 | 8 to 12 KB | 13 |
| `30-notebook-export.md` | 12,598 | 432 | 10 to 15 KB | 9 |
| `31-essay.md` | 30,171 | 190 | 25 to 40 KB | 12 |
| `32-long-reference.md` | 194,997 | 4,205 | 180 to 260 KB | 395 |

The scratch directory also holds `gen-long-reference.mjs` (the generator for file 32),
`build-29-30.mjs` and `sources/` (placeholder sources for the two files that carry bytes that are
awkward to type: the real ESC bytes and the 300-character line in 29, and the PNG and the
2,000-character line in 30). The final texts are what matters; the build script is only for
regenerating them.

SHA-256 of the delivered files, so the lead can check nothing changed in transit:

```text
6dc757e2cf87651241e8ee88543ae65eb26723669627e9e05fc8ce6f2b7f035b  28-llm-answer.md
b415ce7617430f3d19e1c98e3504baa91722b94b8019a36fd5ec8c201b9c3544  24-issue-thread.md
c51ba4aa6478a626935626615edf35d12a323ac0dd1f1fa574a377818ecdd24c  30-notebook-export.md
13aa1a4759a41acb2b5f9d4c70dfedeed30df1b73e2ecd3b91276fba9d459f82  31-essay.md
035869557e5ff9dffa6cddd22a9b5584dbebcd491f7bb154c286f3b23131552d  32-long-reference.md
```

## Why these five

`docs/brief.md` ranks the content Marxy serves: READMEs, then AI and agent artifacts, then source
files, then prose. The existing corpus is shaped like that ranking but only at its tidy end.

| Priority | What exists | What is missing | New file |
| --- | --- | --- | --- |
| 1. READMEs | `02-readme-real-world.md` (1.6 KB), `09-gfm-everything.md` (1.8 KB), `16-api-reference.md` (4.0 KB) | A document at README scale that mixes tables, fences and anchors at volume; the reference manual people actually scroll | `32-long-reference.md` |
| 2. AI and agent artifacts | `03-ai-plan.md`, `18-agent-transcript.md`, `26-skill-front-matter.md`, `27-alerts.md`, `23-task-openers.md`: all clean, all under 3 KB | What a person pastes out of a chat window; a tracker thread an agent was asked to summarise; a notebook an agent produced. Nothing contains pasted-text damage, ANSI bytes, log lines of 300 characters, or a notebook's HTML | `28`, `29`, `30` |
| 3. Source | `04-source.{css,py,rs,ts}`, `19-source-file.md` | Source mode is covered; the markdown that *wraps* source (logs, tracebacks, diffs, outputs) is not | `29`, `30` (their fences and indented outputs) |
| 4. Prose | `15-prose-volume.md` (53 KB, one long essay) | A second long-form text with different structure: dialogue, verse, a foreign-language paragraph, footnotes with several paragraphs, tables of dates, unhyphenatable tokens | `31-essay.md` |

The corpus also has no document above 53 KB that is not the hostile fixture, and
`10-hostile.md` (266 KB) is mostly repeated vectors that sanitise to almost nothing (4,473 bytes of
HTML). There is no large document that renders to a large page.

```sh
cd /Users/ian/Dev/marxy-wt/MARXY-346
ls -l fixtures/corpus/*.md | awk '{print $5, $9}' | sort -n | tail -6
cat fixtures/corpus/*.md | wc -c        # 376,917 bytes over 23 files
```

### The point of each

- **`28-llm-answer.md`** is an answer from a chat assistant, pasted into a file, with every habit
  such text has. The risk to Marxy is not that the markdown is invalid; it is that the markdown is
  valid and means something other than what the writer meant (a setext heading made from a
  sentence, a "list" made of `•` characters that is a paragraph, a numbered list that restarts).
  A reader that is faithful to the bytes shows these mistakes; that is the correct behaviour, and
  the fixture is how it is checked.
- **`24-issue-thread.md`** is an issue and a pull-request review exported to markdown. It is the
  AI-artifact shape an agent leaves behind when it is asked to summarise or relay a thread, and it
  is dense in the three things the spec says Marxy handles badly today: raw HTML (`<details>`,
  `<img>`), ANSI escapes in a fence, and remote images.
- **`30-notebook-export.md`** is an `nbconvert` markdown export, modelled on the structure of that
  template (fenced code, then four-space-indented outputs, HTML tables, image references). It
  puts a notebook's outputs, which are not markdown, into markdown, and it contains the one place
  where real exports break an HTML block (finding 3).
- **`31-essay.md`** is for the typesetter. It is original prose about tide tables (a subject
  chosen to be neither software nor AI), written to carry a side-by-side comparison with
  `15-prose-volume.md` without being a second copy of it: dialogue, two verse forms, French,
  footnotes with more than one paragraph, a table, and two tokens that cannot hyphenate.
- **`32-long-reference.md`** is the scale fixture: 395 headings, 120 fences, 60 tables, 123 anchor
  links, a 9,616-byte hand-written prose
  introduction, a 200-line changelog and 30 footnotes. It is generated, so it can be regrown.

## `28-llm-answer.md`: what it contains and what it exercises

Parts of Marxy: **P** parser, **S** sanitiser, **T** smart typography, **Y** typesetter, **O** outline,
**M** Source mode, **C** copy operations, **F** performance. "Seen" gives what was measured when the
file went through `parseMarkdown` and `renderDocumentSafeHtml` in a scratch copy.

| Construct | Exercises | Seen |
| --- | --- | --- |
| A conversational preamble paragraph before the title, and a closing "Let me know if you'd like me to..." line | P (content before the first heading), O (no heading yet), C (copy-section of the first block) | Preamble is a paragraph at byte 0 |
| Title with an emoji (`# 🚀 Migrating ...`) | O (label), Y (emoji face fallback, line box), S (id) | The heading's `id` is removed by the sanitiser (finding 1) |
| Bold-label bullets (`- **Step 1:** ...`) | P, Y (run-in label in a tight list) | Tight list, one item per step |
| A block of lines that start with `•` and `–` | P (not a list: one paragraph with soft breaks), Y (the lines run together as prose) | Paragraph, not `list` |
| Numbered lists: `1. 1. 1.`; `4.` after a code block; `1.` after a code block | P (list start numbers), Y (marker numbering) | `start=1`, then `start=4` that swallows the following `1. 2. 3.` into one loose list, then a fresh `start=1` after the unindented fence |
| Nested list that mixes `-` and `*` with 3-space indents | P (nesting rules), Y (marker hang depth) | Nested bullets, two levels |
| Table with misaligned pipes and a row with a missing cell; a second table with `:--`, `:-:`, `--:` | P (table row shorter than the header), Y (cell wrap), C | Two `table` nodes; alignments `-,-,-,-` and `left,center,right` |
| `mermaid` fence | S/Y (no grammar, plain code), M | Plain code block; the spec's diagram caption is not built |
| A `markdown` fence written with five backticks that contains a mini-document, its own `#` headings, and a four-backtick fence holding a three-backtick fence | P (fence length matching), O (headings inside a fence must not appear), M | 14 headings, none of them from inside the fence |
| `json` fence with a trailing comma | Highlighter on invalid input, C (a future `format-json` must not parse) | Fence kept verbatim |
| Curly quotes, an em-dash and an en-dash next to straight quotes, `--` and `---` | T (idempotent on already-curly text; converts the straight ones), C (rendered text for prose) | Not asserted here; `typography.test.ts` owns the rules |
| `&amp;` and `&nbsp;` | P (entity decoding), S, C | Decoded in text |
| `<br>` and a line ending in two spaces | P (hard break), S (`br` allowed) | Two `<br>` in the output |
| A paragraph directly followed by `---` | P (setext heading), O (a sentence becomes a 155-byte heading) | `heading level=2 [8825,8980)` |
| A line `***` after a blank line | P (thematic break) | `thematicBreak` |
| `#migration #runbook #queues` | P (not an ATX heading: no space), T | Paragraph |
| Bare `https://*.example.invalid` URLs in a Sources list | P (GFM autolink literal), S, no-network (never fetched), trust (link host) | 7 occurrences of `example.invalid` in the HTML, no requests |

## `24-issue-thread.md`: what it contains and what it exercises

| Construct | Exercises | Seen |
| --- | --- | --- |
| `# ... (#412)` title, a metadata line of bold labels and code spans, `**@handle** commented on 2026-09-29:` per comment | P, O (comments are not headings, so the outline cannot jump between them) | 13 headings |
| `### Steps to reproduce`: an ordered list whose items hold indented fences | P (fences inside list items, 3-space indent), C (copy-command) | Fences inside `listItem` |
| Environment table; a CI checks table with code spans in cells | P, Y | Two tables |
| `<details><summary>Logs</summary>` around a fence | S (`details` is not allowed), P (HTML block, fence, HTML block) | `element:details` and `element:summary` removed, contents kept |
| The log fence: 38 real ESC bytes (0x1B), a line of exactly 300 characters (line 60), a 371-character query line | S/Y (no-wrap policy, 2ch hang), M (`highlightSpecialChars`), C (strip-ansi), fidelity (bytes), aesthetics reflow at 320 px | 38 ESC reach the HTML (spec: "Contradicted"); gate stays green at 320 px and 400 % zoom |
| Seven `---` rules between comments | P (thematic break after a blank line, never a setext heading) | 7 `thematicBreak` |
| `> quoted` replies and a `> > nested` reply, with `>` blank lines | P (nested blockquote), Y (quote rule at depth 2) | Nested `blockquote` |
| A `suggestion` fence, a `diff` fence | Highlighter (unknown language, diff grammar), spec "diff colour: Open", C (copy-diff-after) | Plain code blocks |
| `- [x]` and `- [ ]` task lists, one nested | P (task markers), C (toggle-task) | 11 `taskMarker` |
| Emoji reactions line (`👍 3 · 🎉 1 · 👀 2`) | Y (emoji fallback), T (middle dot) | Paragraph |
| `<img width="600" alt="screenshot" src="https://example.invalid/shot.png">` and a markdown badge image | S (remote image policy, `width`), no-network, trust (blocked-image details) | `src` removed, `width` removed, both become `data-marxy-remote`; 2 blocked images, host `example.invalid` |
| `@mentions`, `#123` references, commit hashes in code spans | P (no auto-linking, deliberately), T | Text only |
| A quoted squash commit message with two `Co-authored-by:` trailers (fake names, `example.invalid` addresses) | P (blockquote with trailer lines), C | Blockquote |
| Final line "Merged via squash into `main` as `5be01f3` ..." | O (last block), M | Paragraph |

## `30-notebook-export.md`: what it contains and what it exercises

| Construct | Exercises | Seen |
| --- | --- | --- |
| Title cell and a markdown cell with `$\alpha$`, `$\Delta T$` and `$0.02\,^{\circ}\mathrm{C}$`; math in a list item and a table cell | P (inline math inside other blocks), Y (math baseline), perf (KaTeX) | 11 inline math spans; none inside a fence |
| `<div class="alert alert-block alert-info">` and `alert-warning` | S (`div` and `class` removed, children kept) | 4 `div` removals |
| Python cells followed by four-space-indented outputs | P (indented code with no language, directly after a fence), Y, M | Output blocks are `codeBlock` with no `lang` |
| `!pip install` cell, `%%time` cell | Highlighter on notebook syntax; copy-command must not treat `!` or `%%` as a shell prompt | Python grammar, no special casing |
| Pandas `<style scoped>` plus `<table border="1" class="dataframe">` with `<thead>`, `<tbody>`, `<th>` and `style` on `tr`; second table with `align` on `th` and `td` | P (HTML block ended by a blank line), S (`style`, `border`, `class`, `style` on `tr` removed), Y (table) | CSS leaks as an indented code block; 2 `style` elements removed; `border`, `class` and `tr` `style` dropped |
| `text/plain` repr of a `Series`, a `stderr` warning block, a `DeprecationWarning` block | Y (code wrap), M | Indented code blocks |
| Python traceback with `^^^^^` carets and a `KeyboardInterrupt` cell | Y (a caret line only means something if the line above it is not wrapped), M, spec "stack traces never folded" | Indented code blocks |
| `![png](output_7_0.png)`, a file that does not exist | Image resolution failure, reserved box, CLS | Aesthetics gate green with the file absent |
| `![png](data:image/png;base64,...)`, a valid 69-byte 1×1 PNG, 114 characters of URI | S (`data:` URI), no-network (nothing to request) | `src` removed, recorded in `removed` |
| A single 2,000-character output line (a list repr) | Y (`overflow-wrap`), M (CodeMirror long line), perf, aesthetics reflow | One `codeBlock` of 2,004 bytes of value |
| A markdown table with `$\alpha$` and `$\sigma$` in cells | P (math in a cell), Y | One `table` node |

## `31-essay.md`: what it contains and what it exercises

| Construct | Exercises | Seen |
| --- | --- | --- |
| Epigraph in a blockquote with an attribution line starting with an em-dash | P, Y (quote rule, hanging dash) | `blockquote` |
| Ten sections headed `## I` to `## X`, then `## Notes` | O (roman numerals sort as text), Y (heading stack), spec heading ids | 12 headings, all with ids |
| Long paragraphs of varied sentence length (5,627 words in all) | Y (Knuth-Plass line breaking, rag, hyphenation), F | `rag` baseline cv 0.022 on macOS in the scratch run, 0 % short lines |
| Dialogue in curly double quotes with nested curly single quotes; apostrophes both ways | T (idempotence, apostrophe vs closing quote) | Not asserted here |
| Em-dashes and en-dash ranges (`1899–1901`, `14–21 February`, `12–18`) | T, Y (no break after an en dash) | Not asserted here |
| Twelve footnotes `[^1]` to `[^12]`; six of them have two or three paragraphs | P (footnote definition with indented paragraphs), Y, C (copy-section keeps definitions) | 12 `footnoteDefinition`; 24 fragment links, none dead |
| Verse with a hard break by trailing backslash, verse with two trailing spaces | P (both break forms), Y (stanza set without justification), C | 10 `<br>` in the output |
| A paragraph in French with `« »` and accented letters (`é`, `ê`, `à`, `Ç`) | Y (hyphenation language is English), T (guillemets must not be turned into curly quotes), C | Not asserted here |
| A 30-letter German compound (`Wasserstandsvorhersagezentrale`) and a 168-character URL-like token plus a 56-character underscore identifier | Y (unbreakable tokens, `overflow-wrap`), aesthetics reflow at 320 px | No page-level horizontal scroll at 320 px |
| An acronym run (`LAT`, `MSL`, `HAT`, `MHWS`, `MLWS`, `UTC`, `M2`, `S2`, `N2`) | Y (small-caps candidate, letter-spacing) | Plain text |
| `...` once and `…` once | T (three dots become one ellipsis, an existing one is left alone) | Not asserted here |
| A two-column table of dates and events | P, Y (table next to prose) | One `table` |

## `32-long-reference.md`: what it contains and what it exercises

The file is generated by `gen-long-reference.mjs`. The generator uses a seeded PRNG (mulberry32, seed
`0x4d415258`), no clock, no environment, no network and no dependency. It never calls `Math.random`
(`grep -c "Math.random" gen-long-reference.mjs` prints 0). Two runs on different working directories
produced the same SHA-256, and `--large` regenerates the 241,463-byte first version
(`314dd69285d9e007...`) that produced finding 2.

```sh
node gen-long-reference.mjs                 # writes 32-long-reference.md beside the script, prints a summary
node gen-long-reference.mjs --large out.md  # the 241 KB variant, which fails the grid check
```

The summary the script printed for the delivered file (it also verifies that every anchor link
resolves against the headings as written, and exits non-zero if one does not):

```text
bytes 194,997    lines 4,205        seed 0x4d415258
headings   H1 1   H2 23   H3 176   H4 195   (H2 to H4: 394; all: 395)
fences     120 (json 24, typescript 24, yaml 24, python 24, bash 24)
tables     60 (9 are 8 columns wide)
changelog  200 lines (20 releases of 10)
footnotes  30 references, 30 definitions
anchor links 123, broken 0
bold-term lists 64, Pandoc-style definition blocks 113
introduction prose 9,616 bytes
```

| Construct | Exercises | Seen |
| --- | --- | --- |
| 395 headings in four levels, numbered (`## 4.`, `### 4.2`, `#### 4.2.1`) | O (outline of 395 entries, jump, filter), P, F | AST of 9,172 lines |
| 123 in-document links (`[see §4.2](#42-retry-policy)` and a 22-entry contents list) | Anchor resolution, heading ids, jump | 123 dead in Rendered (finding 1) |
| 53 unnumbered `#### Example`, `Errors`, `Compatibility`, `Notes` headings | Duplicate-slug suffixes (`example-1`, `example-2`) | Ids kept for all 53 |
| A 14-paragraph, 9.6 KB hand-written introduction | Y (a long run of prose before any table), F | Typeset before the tables |
| 120 fences in five languages | Highlighter (five grammars, idle highlight), M, F | All five grammars allowed |
| 60 tables, 9 with 8 columns and `:---:`, `---:` alignment | P, Y (wide-table policy, wrap, 320 px reflow), F | Aesthetics reflow green at 320 px |
| 64 bold-term bullet lists and 113 Pandoc-style `term` / `:   definition` blocks | P (GFM has no definition lists; the second form is plain paragraphs with a leading colon), Y | 113 stray `:   ` paragraphs |
| 200-line changelog with `**Added:**`-style labels | P, Y (a 200-item tight list), F | 20 `###` release headings |
| 30 footnotes, some with a second paragraph | P, Y, C | 30 `footnoteDefinition` |
| Inline code in nearly every paragraph, table cell and list item | T (no smart typography in code), Y (code spans never break) | Not asserted here |

Cost on the pure-Node path, median of seven runs (see "Runtime cost"): parse 62.8 ms and render
20.8 ms for this file, against 7.7 ms and 1.9 ms for `01-long-technical.md`.

## Provenance text for `fixtures/corpus/README.md`

Append this block, verbatim, after the `15-prose-volume.md` section. It follows that section's
style. Replace `MARXY-346` with the story key under which the files land if that is not the audit
story.

```markdown
## 28-llm-answer.md

Original text written for MARXY-346: the kind of answer a person pastes from a chat assistant
into a file, with the habits that survive the paste (an emoji title, hand-typed bullet characters,
numbering that restarts after a code block, a sentence that a following `---` turns into a
heading, a fence that contains a whole other document). Every name, address and value is invented;
hosts use `example.invalid` (RFC 2606). One line ends in two spaces on purpose. It does not
vendor CommonMark or GFM specification examples (CC-BY-SA-4.0; ADR-0006).

## 24-issue-thread.md

Original text written for MARXY-346: an issue and a pull-request review thread exported to
markdown, with raw HTML, a collapsed log, ESC bytes (0x1B, thirty-eight of them, on purpose) and
two remote images. Handles, names and addresses are invented; the `Co-authored-by:` trailers name
invented people and are fixture content, not attribution for this repository. Do not let an
editor or formatter strip the ESC bytes: `.gitattributes` marks `fixtures/corpus/**` as `-text`
so that they, and every other byte in this directory, are stored as written.

## 30-notebook-export.md

Original text written for MARXY-346, modelled on the structure of a Jupyter notebook exported
with `nbconvert --to markdown`: fenced code, indented outputs, pandas-style HTML tables, a
traceback, a long single-line output, one image referenced by a file that is absent on purpose
(`output_7_0.png`) and one inline `data:image/png;base64,` image that is a valid 69-byte 1x1 PNG
generated for this file. The data are synthetic. No notebook, output or CSS from any third party
is vendored.

## 31-essay.md

Original long-form prose written for MARXY-346 as a second sample for typesetting comparisons
beside `15-prose-volume.md`. The harbour, the keeper and the verses are invented; the facts
about tides are general knowledge stated in the author's own words. It names no real person and
quotes no published text; the epigraph and the French paragraph are original. Five lines of
verse end in two spaces and five end in a backslash on purpose, to test both hard-break forms.

## 32-long-reference.md

Generated by `gen-long-reference.mjs` in this directory for MARXY-346: a reference manual for an
invented product ("Brindle"), built to be large (about 195 KB, 395 headings, 120 fences, 60
tables, 123 anchor links, a 200-line changelog, 30 footnotes). Run `node gen-long-reference.mjs`
to regenerate it byte for byte; the generator has a fixed seed, uses no clock or random source
and has no dependencies. `--large` writes a 241 KB variant, which is not part of the corpus
because its page is taller than the aesthetics grid check can hold (list items about 164,000 px
down drift 0.52 px off the grid, past the 0.5 px tolerance). The introduction is hand-written prose in the generator; everything else is
assembled from short templates. Nothing is third-party text.

Licence: MIT, same as the rest of this repository, for all five files and the generator.
`pnpm gate:licences` is unaffected because nothing copyleft entered the lockfile or the corpus.
```

## Gate consequences

What a maintainer must do, in order, when these files go into `fixtures/corpus/`. Every claim marked
"measured" came from running the gate in a scratch copy of the repository (rsync of the worktree
without `.git`, `node_modules` symlinked), so the worktree itself was not touched.

### 1. Goldens (`gate:golden`, job `fast`)

```sh
pnpm --filter @marxy/core test:golden -- --update
git status --short packages/core/goldens        # ten new files
pnpm gate:golden                                 # must now pass
```

(Measured with the equivalent `node --experimental-strip-types packages/core/scripts/golden.ts
--update`; the script is what both commands call.) It writes one `.ast.txt` and one `.html.txt` per
file. Invariants held for every new file.

| File | `.ast.txt` bytes | `.html.txt` bytes |
| --- | ---: | ---: |
| `28-llm-answer` | 19,428 | 19,944 |
| `24-issue-thread` | 19,766 | 21,277 |
| `30-notebook-export` | 10,641 | 17,992 |
| `31-essay` | 22,832 | 40,869 |
| `32-long-reference` | 469,144 | 480,382 |
| **Total** | **541,811** | **580,464** |

The new goldens are 1,122,275 bytes. The 23 existing goldens pair to 504,720 bytes
(`cat packages/core/goldens/* | wc -c`). The new goldens are 2.2 times the existing ones, and 85 % of them
are one file. Any later parser or renderer change that moves a node moves a line in
`32-long-reference.ast.txt`, which a reviewer must scroll through. The plan: keep the file, and
accept that golden diffs on it are reviewed by `git diff --stat` and a spot check rather than line
by line.

### 2. Fidelity (`gate:fidelity`, job `fast`)

`scripts/gate-fidelity.mjs:67` takes every non-dot file in the corpus except `image.png` and
round-trips its bytes through the save path. Nothing needs updating, and nothing should fail: ESC
bytes, trailing spaces, a 2,000-character line and a 195 KB file are bytes like any other.
**Not run here**: the gate compiles `apps/desktop/src-tauri/src/atomic_write.rs`, which the scratch
copy leaves out. The generator `gen-long-reference.mjs` is also a non-dot file in the corpus and
will be round-tripped as a document, exactly as `check-prose-volume.mjs` already is.

### 3. No network (`gate:no-network`, job `browser`)

No edit needed. Measured: green, "28 corpus files and 33 vectors × 2 engines, 0 remote requests, 0
requests outside the document's directory", 30.3 s before and 35.7 s after (one run each, one
machine). What it did with each risky construct:

- `https://example.invalid/...` images in `24-issue-thread.md` are rewritten by the sanitiser to
  `data-marxy-remote` placeholders with no `src`, so the engine never sees a URL to request. The
  `.invalid` TLD is reserved by RFC 2606 and cannot resolve in any case. Links to
  `example.invalid` are anchors, which no engine fetches.
- The `data:image/png;base64,...` image in `30-notebook-export.md` loses its `src` in the default
  and in the wide policy, so the gate has nothing to classify.
- `output_7_0.png` is a relative path. `classifyRequestUrl` calls it `contained`, and
  `isReferenceInSource` finds it in the source, so it is clean; the gate's router aborts the
  request because no such file is served (`packages/core/scripts/gate-checks.ts:39-51`).

### 4. Aesthetics (`gate:aesthetics`, job `browser`): baselines

On macOS, from the repository root:

```sh
pnpm gate:aesthetics --update        # writes baselines, then exits 1 by design
pnpm gate:aesthetics                 # must now print "aesthetics gate ok"
git status --short fixtures/baselines
```

Measured in the scratch copy: the first command created 20 PNGs (4 per document: 960 px, dark and
light, first and last viewport) totalling 3,301,725 bytes under `fixtures/baselines/webkit-macos/`,
and five rag files under `fixtures/baselines/rag/webkit-macos/`. It always exits non-zero when it
writes a baseline, because `scripts/gate-aesthetics.mjs:1083-1085` pushes `baseline created; add a
queue entry` onto the failure list. The second command passed. Without `--update`, a missing baseline
is itself a failure (`rag baseline missing for ...`), so there is no way to add a corpus file and
stay green without a baseline commit.

The same gate runs on a Linux engine in CI (`container: mcr.microsoft.com/playwright:v1.63.0-noble`,
`.github/workflows/ci.yml:128`), and its baselines live under `fixtures/baselines/webkit-linux/`
and `rag/webkit-linux/`. Expect another 20 PNGs and five JSON files, about 3.3 MB, written by that
job. **Caveat on how they reach the repository.** The brief says they come from the `browser-results`
artifact. Reading the workflow, that artifact uploads `path: results/` only (`ci.yml:154-159`), and
the gate writes created baselines to `fixtures/baselines/<engine>/` (`gate-aesthetics.mjs:566`) and
diffs to `results/diffs/<engine>/` (`gate-aesthetics.mjs:580`). On my reading, the Linux PNGs
created on a runner are not in that artifact. I could not run CI to confirm. If that is right, the
way to get Linux baselines is to run `pnpm gate:aesthetics --update` inside the same pinned image
locally (`docker run --rm -v "$PWD":/w -w /w mcr.microsoft.com/playwright:v1.63.0-noble ...`) or to
add the baselines directory to the artifact. Check this before promising a one-pass merge.

**The taste-review queue row.** `docs/ci-contract.md:136` and `docs/aesthetics-acceptance.md` say a
queue entry is optional. The gate's own
message still says "add a queue entry", and `scripts/check-pr.mjs` validates a fragment only when
one exists. A row (as `docs/taste-review/queue.d/KEY.md`) is welcome because baselines were created
and no human has looked at these pages. It should say: five new corpus pages; first screenshots;
question "do these five read as their own formats rather than as prose?"

**Finding 2, the grid check, and the size of file 32.** The shipped 194,997-byte file passes every
check at every size on webkit-macos (measured). The first version (241,463 bytes, `--large`) does
not: `<li> top 163848.52 (unit 12)` at 960×16 dark, and the same at 960×16 light. If the lead would
rather have the 241 KB file, the options are to fix the drift (the first off-grid element in that
file is paragraph 32, 1,788 px down, 0.031 px off, and the offset then wanders by up to about half
a pixel), to give the check a page-height cap, or to accept a red gate. I recommend keeping the
195 KB file and filing the drift as its own issue; it is a defect that readers of very long
documents already have.

**Observed while landing them (lead's note).** The Linux baselines for the five files were produced by
running `pnpm gate:aesthetics --update` inside the CI image (`mcr.microsoft.com/playwright:v1.63.0-noble`)
on a copy of the worktree; the macOS ones by the same command on this Mac. In both engines the
`--update` run also rewrote baselines of files this change does not touch (macOS: both
`26-skill-front-matter` last-screen shots; Linux: eight PNGs across `09-gfm-everything`,
`26-skill-front-matter` and `29-hidden-characters`). Those rewrites were discarded and only the new
files' baselines were kept, but a PNG baseline that drifts between two runs of the same code is
evidence for `10-overfit-decisions.md` §3.4.

### 5. Other places the corpus is read

| Reader | Effect of five new files |
| --- | --- |
| `packages/typeset/scripts/measure-rag.mjs` (`--verify`) | It reads every corpus file and checks `RESEARCH.md` against a fresh measurement, so the table in `RESEARCH.md` goes stale. Nothing wires `--verify` into CI or `package.json` (I searched both), so no gate fails. Refresh with `node packages/typeset/scripts/measure-rag.mjs --write` if the study matters. |
| `10-hostile.md`-specific tests | Unaffected: they name that file. |
| `scripts/measure-parse.mjs` | Unaffected: it names `01-long-technical.md`. |
| `fixtures/corpus/README.md` | Add the provenance block above. |
| `.gitattributes` | `fixtures/corpus/** -text` already preserves ESC bytes, trailing spaces and the absence of CRLF conversion. |
| `scripts/gates-by-path.json` (local `pnpm precheck`) | `fixtures/corpus` maps to `gate:golden`, `gate:fidelity` and `gate:no-network`, not to `gate:aesthetics`. So a local precheck of a corpus-only change will not warn about missing screenshot baselines. CI will: `scripts/ci-changes.mjs:38` counts `fixtures/` as a `web` change, which starts the `browser` job and the aesthetics gate. |

## Runtime cost

**Method.** The question is how much longer the corpus gates run. The aesthetics gate dominates, so I
measured it directly. I copied the worktree to a scratch directory (without `.git`, `node_modules`
or the Rust crate; `node_modules` symlinked), set the scratch corpus to chosen files, and timed
`node --experimental-strip-types scripts/gate-aesthetics.mjs` with `--workers 1` so that each file's
cost is separate. `11-empty.md` stays in every run so the corpus is never empty; it measures the
fixed cost. The first run on a cold machine took 152 s for `01-long-technical.md` alone and is
discarded as cold-start noise (build of `dist/render.js`, first WebKit launch, cold file cache); all
numbers below are warm. Other agents were running gates on the same machine, so the numbers carry
that noise, and each is one run.

```sh
# in the scratch copy, corpus set per row, baselines present:
( time node --experimental-strip-types scripts/gate-aesthetics.mjs --workers 1 )
```

| Corpus in the scratch copy | Wall time | Marginal over `11-empty.md` |
| --- | ---: | ---: |
| `11-empty.md` only (the fixed cost) | 8 s | 0 |
| plus `01-long-technical.md` (20,378 B) | 17 s | 9 s |
| plus `28-llm-answer.md` (9,517 B) | 15 s | 7 s |
| plus `31-essay.md` (30,171 B) | 18 s | 10 s |
| plus `32-long-reference.md`, 241 KB variant (red on the grid check) | 108 s | 100 s |
| plus `32-long-reference.md`, 194,997 B (shipped) | 100 s | 92 s |
| all 23 existing files (this run also re-created four baselines I had deleted from the scratch copy) | 141 s | 133 s |
| all 23 existing plus the five new files, baselines present | 125 s for `11-empty` plus the five alone | 117 s for the five |

At the gate's default worker count (4 on this 10-core machine, `Math.min(4, cpus)`):

| Corpus | Wall time |
| --- | ---: |
| existing 23 files | 37 s |
| existing 23 plus the five new files | 71 s |

So the five files add 117 s sequentially and 34 s with four workers; the corpus's aesthetics time
roughly doubles (+90 %). Scaling is linear in bytes: `01-long-technical.md` costs about 0.44 s per
KB of markdown (9 s for 20.4 KB) and `32-long-reference.md` about 0.47 s per KB (92 s for 195 KB). An
estimate from `01` alone predicts 195 KB x 0.44 = 86 s, 6 s under what was measured, which is inside
the noise. The 230 KB figure in the brief would predict 101 s from the same ratio. The Linux CI
engine is not measured here and will differ; the `browser` job has a 25-minute timeout
(`ci.yml:129`) and a baseline run of this size is far inside it.

Other gates, measured or bounded:

| Gate | Cost of the five new files | How known |
| --- | --- | --- |
| `gate:golden` | seconds; 1.1 MB of new golden files | measured: 28 fixtures written and compared in one run |
| `gate:no-network` | +5.4 s (30.3 s to 35.7 s) | measured, one run each |
| Pure-Node parse and sanitise, `32-long-reference.md` | 62.8 ms parse, 20.8 ms render | median of 7 runs |
| Pure-Node parse and sanitise, `01-long-technical.md` | 7.7 ms parse, 1.9 ms render | same |
| `gate:fidelity` | not measured; negligible next to the compile it already does | needs the Rust crate |

```sh
# the Node parse and render timing, from the worktree root
node --experimental-strip-types <scratch>/probe.mjs fixtures/corpus/01-long-technical.md <scratch>/32-long-reference.md
```

## Five further candidates (not written)

1. **`33-readme-hero-badges.md`**: a README with a centred `<div align>` hero, a `<picture>` with
   dark and light sources, a badge row of five image links, `<details>` folds and a language
   switcher; priority 1, and the spec lists badge rows, `align`, `<picture>` and fold state as open
   or contradicted.
2. **`34-agent-instructions.md`**: an `AGENTS.md`-shaped file with `<instructions>` XML-style tags,
   block HTML comments that carry content, `@path` imports and a front-matter header; the spec's
   "content that must not vanish" cases, and the trust question of what an agent reads that a person
   does not.
3. **`35-unified-diff.md`**: a multi-file unified diff in a fence and as prose, with `\ No newline
   at end of file`, hunk headers, `---`/`+++` lines that look like rules, tabs, and one very long
   changed line; covers diff markers, tints and wrap-in-diff (all spec "Open").
4. **`04-source.jsonl`** (not markdown, so it exercises Source mode only): an agent session log of
   a few hundred lines, one of them a 5,000-character tool result; covers very-long-line handling
   and the derived-transcript idea without the markdown gates.
5. **`36-vault-note.md`**: a note in the style of a personal knowledge vault: wikilinks, `==marks==`,
   `%% comments %%`, `^block-ids`, callouts with folds, inline tags and nested task lists; those
   tools' output is a likely source of "AI artifact" files and none of its syntax is in the corpus.

## Commands for every number in this document

```sh
# sizes, line counts, line endings, hashes
cd /private/tmp/claude-501/-Users-ian-Dev-marxy/846bd58f-e5cb-4052-8d36-5ad2cf9af740/scratchpad/corpus
wc -c 28-llm-answer.md 24-issue-thread.md 30-notebook-export.md 31-essay.md 32-long-reference.md
tr -cd '\033' < 24-issue-thread.md | wc -c           # 38
node gen-long-reference.mjs | tr -d '\n '            # the generator summary
# goldens: copy packages/core and fixtures/corpus to a scratch directory, add the five files, then
node --experimental-strip-types packages/core/scripts/golden.ts --update
# existing corpus and goldens
cat fixtures/corpus/*.md | wc -c                     # 376,917
cat packages/core/goldens/* | wc -c                  # 504,720
# gates in a scratch copy
node --experimental-strip-types scripts/gate-aesthetics.mjs --workers 1 [--update]
node --experimental-strip-types scripts/gate-no-network.mjs
```

## For the synthesis

- The corpus's AI-artifact fixtures are all clean, small documents; the five new files add the
  damaged, pasted and exported forms (a chat answer, an issue thread, a notebook export) that
  priority 2 content really arrives in, plus a second long essay and a 195 KB reference manual.
- Heading anchors do not work for numbered headings: 340 of 395 ids in the new reference fixture
  are stripped by `packages/core/src/sanitize/policy.ts:106`, so all 123 in-document links are dead
  in Rendered mode, and the reader-artifacts spec's "headings carry no id" is out of date.
- The aesthetics grid check cannot hold a very tall page: a 241 KB document failed it on its own
  at about 164,000 px (0.02 px over a 0.5 px tolerance), and a 199 KB one failed at 28 px type; the
  shipped fixture is 195 KB for that reason, and the drift is a real defect for readers of long files.
- Real notebook exports break an HTML block at a blank line inside pandas' `<style scoped>`, so CSS
  shows up as a code block; Marxy has no handling for it.
- Adding the five files roughly doubles the aesthetics gate's corpus time (37 s to 71 s at four
  workers, measured) and the new goldens are 2.2 times the existing ones (+1.1 MB), 85 % of it
  from the one big file.
- `gate:aesthetics --update` always exits non-zero when it writes a baseline, its message still asks
  for a taste-queue entry that the project's own rules now call optional, and Linux baselines may
  not be recoverable from the `browser-results` artifact as the workflow is written; check that
  before promising a one-pass merge.
- The no-network gate stays green on all five: remote images become `data-marxy-remote`
  placeholders, `data:` images are stripped, and a missing local image is a `contained` request
  that is aborted.
- Naming: `24-issue-thread.md` shares its number with `29-hidden-characters.md`; `24-` is free.
