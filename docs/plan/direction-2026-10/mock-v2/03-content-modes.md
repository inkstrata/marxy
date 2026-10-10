# 03 Content modes

The special interface Marxy gives each kind of text. Open [03-content-modes.html](03-content-modes.html), pick a type on the left (or press ⌥↓ and ⌥↑ to step through them), and use the typography panel beside the list (left to right: type list, its typography, then the sample document, the widest region; the ruler button in the toolbar hides the panel). Use the right-hand panel to see and adjust the typography. The typography itself is specified in [TYPOGRAPHY.md](TYPOGRAPHY.md); this document covers layout, tools and behaviour.

## Purpose

A reader that treats every document the same serves one genre and damages the rest. Marxy detects what a file is and changes three things together: the **layout** around the text (rails, headers, page model), the **tool strip** above it, and the **typography** of the text itself. The type is always visible in the toolbar chip, with the reasons for the choice in its menu, and can be overridden per file or per folder.

## The page

| Region | Contents |
|---|---|
| Type list | Twelve types with a short description each, plus a note on types handled later |
| Tool strip | The quick tools for the selected type, and Open in Workspace |
| Frame | The type's own layout around a real sample document |
| Typography panel | A one-line rationale; a spec table with defaults and live measured values (and, for Log and Terminal, the reasons the type was detected); sliders for size, leading, measure and letter spacing that obey the coupling rules; what the type must preserve and what the reader may adapt; sources |
| Status bar | Type, face, size and leading, measured characters per line, words and reading time, theme and type set |

The toolbar has a **Narrow / Full** switch that squeezes the preview to 720 px, to show how each layout degrades: rails collapse first (left rail before right), books drop to one page per spread, and margin notes fall back to pop-ups.

## Detection

| Signal | Points to |
|---|---|
| Source file extension (`.rs`, `.ts`, `.py`, `.go`, …) | Code |
| Data extension (`.csv`, `.json`, `.yaml`, …) | Data |
| `.log` extension; most lines open with a timestamp and a level word (INFO, WARN, ERROR); indented stack frames after an error | Log |
| Prompt lines (`user@host dir %`, `$ `) each followed by output; ANSI escapes | Terminal |
| File named `README` or `CHANGELOG` | README, Changelog |
| Headings such as Summary, Risks, Next steps, Open questions, Verified, Recommendation | Report |
| Task checklists | Report (weak) |
| `## You` / `## Assistant` speaker headings | Transcript |
| A "Chapter" heading and long paragraphs, or chapter-numbered file names | Book |
| Byline front matter (author with published or source) | Article |
| Admonitions with Parameters, Returns, Errors or Example sections | Docs |
| A dated file name or a notes folder | Notes |
| No strong signal | Article (prose default) |

Signals add up and the strongest wins; the chip shows only the type's name, and its menu lists the reasons. Each sample document is detected as its own type.

## The types

### Report

Plans, handoffs, audits, research and specs.

- **Left rail:** the outline (H2 and H3). Tasks get no emphasis of their own: no progress bar, no n of m count, no Tasks tool.
- **Right rail, the report panel:** open questions, risks, next steps and every file path mentioned with found or missing, collected from the document's own sections.
- **In the text:** path chips, admonitions, task checkboxes that write back to the file.
- **Tools:** Paths, Changes, Split by H2 (Extract lives in the verb menu and the palette).

### Article

- Reading-progress hairline at the top; byline with author, date, reading time and source domain; dek; pull quotes.
- Margin notes when the window holds the column plus a 15 em margin; pop-ups otherwise; **Endnotes** forces the list.
- **Tools:** Focus (dims all but the paragraph under the pointer), Highlight, Quote with link, Margin notes, Read aloud, Endnotes.

### Book

- **Paged:** each page is a column exactly one measure wide; one or two per spread depending on the window; arrow keys, space, Page Up and Down, or a click on either half turn pages; footer with page number, chapter progress, book progress, location and time left in the chapter.
- **Scroll** is available as a tool.
- Running head (book title, chapter n of m), centred chapter title, small-caps opening line, scene-break asterisms.
- **Tools:** Paged, Contents, Justify (refused with an explanation below 45 characters), Bookmark, Highlight, Initial (drop cap), Scroll.

### README

- **Repository header:** name, branch, description, an install command with a method switch (brew, cargo) and Copy, and facts (licence, language, version, folder, last commit, docs count).
- Section chips under the header jump to each H2.
- Badges drawn locally.
- **Tools:** Copy install, All commands (as a script), Badges, Outline, Config table, Open repo.

### Docs

- **Three columns:** the docs-set tree with search; the page with breadcrumbs, version chip and previous and next links; "On this page" with scroll-spy and a list of the page's examples.
- The signature block after the title is emphasised; headings show an anchor on hover.
- **Tools:** On this page, Copy section, Copy link, Examples only, Search docs set, Prev / next.

### Code

- Breadcrumbs (folder, file, current symbol), the language name with a small dot in the language's brand colour, line count and a changed marker.
- **Language switcher** in the breadcrumb bar (Rust, TypeScript, Python, Go) shows the same short sample in each language, so the per-language tint is visible: definitions and keywords take the language's colour from `shared/lang-colors.css`, everything else stays in the theme's syntax colours.
- Gutter with line numbers; scroll by default; **Wrap** indents continuation lines.
- **Symbols rail:** functions, types, impls, modules and tests, indented by nesting; click to highlight and scroll.
- **Literate:** doc comments set as prose beside the code they introduce.
- **Tools:** Wrap, Literate (Rust doc comments only in the prototype), Symbols, Copy fenced (tagged with the current language), Go to line.

### Transcript

- Turns as rows with the speaker (you, assistant, tool) outdented in small capitals; your prompts slightly heavier.
- Tool calls folded to one line naming the tool and output length; expand one, or all.
- **Prompts rail:** filter chips (All, Prompts, Answers, Tools), every prompt as a jump link, every tool call listed.
- **Tools:** Collapse tools, Only you, Only assistant, Last reply (copies the last answer), Export as doc (keeps the assistant's turns, drops the conversation), Expand tools.

### Log

Build and app logs.

- **Bar:** file name, line count, error and warning counts, and a level filter as text toggles: All, Info, Warn, Error. A level shows that level and everything above it; an error keeps its stack trace with it.
- **Lines:** line numbers hung in a faint gutter; timestamps in the comment colour; level words in weight 700, so the level reads without colour; the line of an error is set slightly apart with a rule at its left edge; stack frames and other continuation lines stay, indented under the line they belong to; ANSI escape sequences appear as a visible ␛ in the comment colour and are never interpreted.
- **Tools:** Copy as (the lines currently shown), Filter by level (a menu with the same four choices and a shortcut for each), Wrap (continuation lines hang under the line), Jump to first error, Follow tail (pins the view to the end; the prototype appends a line every couple of seconds to show it).
- **Typography:** mono, size only. Spacing, measure and alignment are replaced by the same note as Code and Data, because they would change what a log says.

### Terminal

Shell sessions and console captures.

- **Groups:** each prompt with its command, followed by the command's output, with half a line between one group and the next. Prompts in the punctuation colour, commands in the strong colour at weight 600, output in the normal text colour. Blank lines inside output are kept.
- **Escapes:** ANSI escape sequences are shown as a visible ␛ in the comment colour, never interpreted.
- **Tools:** Copy commands only (prompts stripped), Copy output only, Wrap.
- **Typography:** mono, size only, as for Log.

The prototype draws both types itself from the corpus documents `build-log` and `shell-session`, and falls back to embedded samples when they are absent.

### Data

- Bar with file name, shape, delimiter detection and a row filter.
- Grid with row numbers, typed sticky headers that sort, numbers right-aligned with tabular figures, identifiers in monospace, and a statistics footer (min, max, mean).
- **Tools:** Copy as (Markdown table, CSV, TSV, JSON), Column stats, Filter, Transpose, Chart.

### Notes and Changelog

- **Notes:** daily navigation and backlinks rail; Tasks, Backlinks, Append clipboard, Daily.
- **Changelog:** version rail; Versions, Copy release notes, Compare.

## Typography panel controls

| Control | Range | Behaviour |
|---|---|---|
| Size | 12 to 28 px (12 to 20 for code, data, log and terminal) | Recomputes the column so the character count holds |
| Leading | 1.3 to 2.0 | Prose types only |
| Measure | 40 to 90 characters | Prose types only; below 45, justification switches off and the panel says so |
| Letter spacing | 0 to 0.12 em | Word spacing rises by the same amount; the panel says so |
| Reset | | Back to the type's defaults |
| Save for this type | | Makes the adjusted values the type's default (Settings › Content types) |

For code, data, log and terminal the panel replaces the sliders other than size with a note: only size and face apply, because spacing and alignment would change meaning.

## Overrides

| Where | What |
|---|---|
| Toolbar chip, Show as | This file only |
| Chip, Always open this folder as | A glob rule, editable in Settings › Content types |
| Settings › Content types | Per-type defaults, tool strip contents and order, detection on or off, detection sensitivity |

## Accessibility

- Type list and tool strip are toolbars and tabs with labels; ⌥↑ and ⌥↓ step through types.
- Book pages are a focusable region; arrow keys turn pages; a screen reader reads the text in order regardless of columns.
- Scrolling code, data, log and terminal containers are focusable with names.
- The level filter and the language switcher are button groups with pressed state; the filter menu is keyboard operable (arrows, Enter, Escape, number keys). Level words are text, so a log reads without colour.
- Speaker labels are real text, not decoration, so they are read.

## Open questions

- Should Report become several types (plan, handoff, audit, research) with different panels, or stay one type with panels that fill only when their sections exist? The prototype does the latter.
- Two-page spreads need a window about 1,400 px wide at 20 px text; is a single page with generous margins better than a cramped spread in between?
