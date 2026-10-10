# Typography by content type

Marxy sets each kind of text the way that kind of text is read. This document gives the typography for every content type, the type sets that supply the faces, the rules that couple settings together, and the line lengths the prototype actually measures. It applies the [Reader Typography Handbook](../docs/src/00-orientation.md) to a reader for source of any kind: Markdown, code, data, logs and prose. Where this document states a default without argument, the argument is in the handbook's [spec](../docs/src/10-spec.md) and [content types](../docs/src/07-content-types.md) chapters.

See it live in [03-content-modes.html](03-content-modes.html): pick a type and the right-hand panel shows the face, size, leading and characters per line you are getting, with sliders that obey the coupling rules.

## How the layers stack

Five layers decide how text looks, each overriding the one before:

1. **Theme** (`[data-theme]` in `shared/tokens.css`): colours for every surface, text role and code token, plus text weight, which is lighter on dark grounds.
2. **Type set** (`[data-typeset]`): which face fills each reading role. One choice restyles every view.
3. **Content type** (`.doc[data-kind]`): size, leading, measure, paragraph style, alignment, hyphenation and heading scale for that kind of text.
4. **Reader settings**: the user's size, measure, leading, spacing and justification choices, within the ranges below.
5. **Coupling and genre rules**: relationships the app enforces whatever the settings say, such as no justification under 45 characters and no spacing changes inside code.

Folding the workspace away (see [FEATURES.md](FEATURES.md#4-fold-up)) changes no typography: when the window is folded to the document column, the measure, size and leading are exactly those below, and the column is centred in the space the folded chrome gave back.

Interface chrome sits outside this stack. Toolbars, menus, lists and settings use the platform face at the platform size (SF Pro at 13 px on macOS, with 11 px section labels and 11.5 px status text), because reader choices style the text being read, not the controls around it.

## Type sets

A type set assigns a face to each of five reading roles. The average character width is what the measure is computed from (handbook chapter 3); Marxy measures it live for whatever face is in use and caches it per face and size.

| Type set | Book | Article | Sans (reports, docs, transcripts, notes) | README | Code | Use |
|---|---|---|---|---|---|---|
| Classic (default) | Literata | Source Serif 4 | Atkinson Hyperlegible Next | Inter | JetBrains Mono | Screen-designed faces with full feature sets |
| Plex | IBM Plex Serif | IBM Plex Serif | IBM Plex Sans | IBM Plex Sans | IBM Plex Mono | One coordinated family; wide script coverage |
| Hyperlegible | Atkinson Hyperlegible Next | same | same | same | Atkinson Hyperlegible Mono | Readers with low vision; distinct letterforms everywhere |
| System | New York | New York | SF Pro | SF Pro | SF Mono | Native macOS faces, nothing bundled |
| Typewriter | IBM Plex Mono | same | same | same | same | Drafting; the measure still holds in characters, so the column widens |

Average character widths, from the handbook's measurements across 48 families, and as the prototype measured them live at the reading size:

| Face | Handbook (em) | Live in prototype (em) | Note |
|---|---|---|---|
| Literata | 0.460 | 0.466 to 0.476 | Optical size switches with size, so the width is measured per size |
| Source Serif 4 | 0.455 | 0.454 | Probing at 100 px picked the display optical size and read 0.412; the probe must use the real size |
| Atkinson Hyperlegible Next | 0.433 | 0.444 | Different sample text |
| Inter | 0.463 | 0.475 | |
| IBM Plex Serif | 0.459 | – | |
| IBM Plex Sans | 0.440 | – | |
| JetBrains Mono, Plex Mono | 0.600 | 0.600 | Monospace |
| Atkinson Hyperlegible Mono | 0.632 | – | Wider than most monospace faces |

The app should measure with a long, representative English sample, as the handbook's lab does, rather than the short sentence the prototype uses; the small differences above come from that.

## The types at a glance

Sizes are defaults at 100 per cent text size and scale with the reader's size setting. Measure is in average characters.

| Type | Face role | Size | Leading | Measure | Paragraphs | Alignment and hyphenation | Page model | Spacing controls apply to |
|---|---|---|---|---|---|---|---|---|
| Report | Sans | 17 px | 1.55 | 74 | Space 0.85 em | Ragged, no hyphenation | Scroll | Prose only |
| Article | Article serif | 20 px | 1.58 | 66 | Space 0.75 em | Ragged, hyphenated | Scroll with progress | Everything |
| Book | Book serif | 20 px | 1.5 | 64 | Indent 1 em, no space, first paragraph flush | Ragged and hyphenated by default; justified with total-fit breaking as an option at 45+ characters | Paged | Everything |
| README | README sans | 16 px | 1.62 | 84 | Space 1 em | Ragged | Scroll | Prose only |
| Docs | Sans | 16.5 px | 1.62 | 74 prose; code and tables wider | Space 0.9 em | Ragged; hyphenate prose only | Scroll, three columns | Prose only |
| Code | Code | 13 to 14 px | 1.6 to 1.65 | None (never reflowed) | – | Never altered | Scroll both ways | Size and face only |
| Transcript | Sans | 16 px | 1.55 | 76 including the speaker column | Space 0.7 em | Ragged | Scroll | Prose only |
| Data | Sans, code for IDs | 13 px | 1.4 | None | – | Text left, numbers right | Grid | Size only |
| Notes | Sans | 16 px | 1.55 | 70 | Space 0.6 em | Ragged | Scroll | Everything |
| Changelog | Sans | 15.5 px | 1.55 | 80 | Space 0.5 em | Ragged | Scroll | Prose only |

Measured in the prototype at a 1440 × 900 window, Classic type set, Ink theme, with the content-modes page's panels open:

| Type | Target | Measured full-line average | Why the difference |
|---|---|---|---|
| Book | 64 | 64 | Paged columns are set exactly to the measure |
| Article | 66 | 64 | Ragged right leaves lines a little short |
| Report | 74 | 69 | Ragged right, and more short words in technical prose |
| Docs | 74 | 67 | As report |
| README | 84 | 82 | |
| Transcript | 76 | 67 | The speaker column takes part of the measure |

Lines averaging 90 to 100 per cent of the target are what ragged-right text should produce. The handbook's warning about `max-width: 66ch` applies here: that CSS would have given 75 to 104 characters depending on the face.

## Report (plans, handoffs, audits, research notes)

A report is one kind of text among many here, and the one most often scanned before it is read. People look for the summary, the risks, the commands and the open questions, and read prose only where it matters. So reports get documentation typography rather than book typography:

- **A sans face with distinct letterforms** for speed of recognition. Atkinson Hyperlegible Next in the Classic set.
- **17 px at 1.55 leading, 74 characters.** A little wider than the article measure, because report tables and inline code need the room.
- **Paragraph space, not indents.** Blocks are visually separate units; indent-only paragraphs suit continuous prose, which reports are not.
- **Ragged right, no hyphenation.** Hyphenating identifiers and paths would be actively harmful.
- **Modest headings.** 1.75, 1.32 and 1.08 em in a heavier weight; space above larger than below so headings bind to their text. Never more than three levels in the outline rail.
- **Inline code at 0.87 em** of the surrounding text with a faint inset, because monospace looks larger than proportional text at equal size.
- **Tables** with tabular lining figures, numbers right-aligned even when the author forgot the colon, sticky headers, and their own scroll container.
- **Admonitions** carry a label and an icon and differ in border style (solid, dashed, double), never by colour alone.

## Article

Read once, start to finish. Source Serif 4 at 20 px with optical sizing, 1.58 leading, 66 characters, paragraph space of 0.75 em, ragged right with hyphenation. The headline uses the display optical size and a tighter letter fit; the dek, an opening italic paragraph, is set larger and quieter. Pull quotes are centred, larger and italic, without quotation marks. Footnotes become margin notes when the window has room for the column plus a 15 em margin, and pop-ups otherwise; they never become endnotes the reader has to jump to.

## Book

Fiction wants to disappear. Literata at 20 px, 1.5 leading, 64 characters. Paragraphs are marked by a 1 em indent with no space between them; the first paragraph after a heading or scene break is flush. The opening line is set in small capitals; an initial letter is optional. Scene breaks are a centred asterism, because a blank line vanishes at a page boundary.

Books are paged by default. Each page is a CSS column exactly one measure wide, as many per spread as the window holds, with the viewport clipped to one spread so the next page never peeks in. Justification is available but off by default: browsers break lines greedily, which leaves loose lines, so the app justifies only with a total-fit line breaker (Knuth and Plass, handbook chapter 5) and only at 45 characters or more. Italic is preserved whatever face the reader chooses, so a face without a true italic is not offered for books.

## README

A README is a front door. Familiar forge conventions beat novelty: Inter at 16 px, 1.62 leading, 84 characters, ruled H1 and H2. The install command is lifted into a header strip with a method switch and a copy button; badges are drawn locally from their shields.io URLs so nothing is fetched.

## Docs

Documentation is navigated more than read. Prose stays at 74 characters at 16.5 px and 1.62 leading, while code blocks and tables may extend wider, up to about 100 characters, because example code has its own line-length conventions. Headings show an anchor on hover. The first code block after the title, usually the signature, is emphasised. UI names in bold, code in monospace and defined terms in italic, following the Google and Microsoft style guides.

## Code

Every character and space may carry meaning, so code is never reflowed, justified, hyphenated or given spacing changes, and copied text is always identical to the file.

- **JetBrains Mono, ligatures off** (`liga` and `calt` disabled), 13 to 14 px, 1.6 to 1.65 leading, tab width 4 by default and respected from `.editorconfig`.
- **Scroll, not wrap,** by default. Wrap is a toggle; wrapped lines indent past the original indentation, and indentation-sensitive languages are never wrapped silently.
- **Highlighting at import,** once per content hash, with an audited palette. Every token reaches 4.5:1 in every theme (the lowest in any Marxy theme is 5.9:1). Comments are italic and never dimmed below 4.5:1. A minimal mode colours only strings, constants, comments and definitions. Unknown languages get plain monospace, never guessed colour.
- **Line numbers stay out of the selection,** and every scrolling code container is keyboard-focusable with an accessible name.
- **Literate view** sets doc comments as prose in a docs face beside the code they introduce.

## Transcript

Chat logs share the drama problem: speakers must stay attached and distinct. Each turn is a two-column row with the speaker outdented in small capitals (You, Assistant), so the label survives any width and never sits inside the speech. Your prompts are a touch heavier than answers. Tool calls collapse to a single line naming the tool and its output length.

## Data

Tables are read in two directions, so alignment carries meaning: text left, numbers right, tabular lining figures, identifiers in monospace, a typed sticky header, row numbers in a faint gutter, and a statistics footer. Wide tables scroll inside their own focusable container rather than shrinking or turning into stacked cards, which would break the row relationships.

## Notes and changelogs

Notes are short and informal: the sans at 16 px, tighter paragraph spacing, tasks and links one click away. Changelogs are scanned by version: 15.5 px, version headings with dates, change-type subheadings, and a version rail.

## Types Marxy handles later

| Type | Typography |
|---|---|
| Verse | Every line break and indent preserved; hanging indent (`padding-left: 1em; text-indent: -1em`) so a turned-over line is visibly a continuation; never justified, hyphenated or balanced; stanzas kept together across pages; only size and face adjustable |
| Drama and screenplays | Speaker names in small capitals, never italic; stage directions italic; a faithful Courier Prime production format alongside a reflowed reading view |
| Math | MathML with a MATH-table font (Latin Modern Math or STIX Two Math); upright and italic distinctions preserved; no letter or word spacing inside formulas |
| Slides | One slide per screen at presentation sizes; the reading measure does not apply |

## Reader settings and their ranges

| Setting | Default | Range | Applies to |
|---|---|---|---|
| Text size | 100% (per-type defaults above) | 75 to 250% | All text, including code |
| Measure | Per type | 45 to 90 characters | Prose types |
| Line height | Per type | 1.3 to 2.0 | Prose types |
| Paragraph style | Per type | Indent, space, or the document's own; never both | Prose types |
| Justification | Off (ragged right) | Auto, off, on | Book, article, notes |
| Hyphenation | On for book and article prose | On, off | Prose types |
| Letter spacing | 0 | 0 to 0.12 em, word spacing follows | Prose types |
| Weight | Theme default (lighter on dark) | ±50 | All reading text |

## Coupling rules

The settings are not independent. Marxy enforces these relationships in the reading view and explains them in the settings and the content-modes panel (handbook chapter 10):

1. **The measure follows the face and size.** When either changes, the column is recomputed from the measured average character width so the character count holds.
2. **Justification needs width.** Below 45 characters per line, text is set ragged right whatever the setting says, and the panel says why.
3. **Letter spacing drags word spacing.** Raising letter spacing raises word spacing by at least the same amount; letter spacing alone slows reading.
4. **Leading has script floors.** CJK, Devanagari, Thai and others multiply the reader's leading by a script factor and never go below their floor (handbook chapter 8).
5. **Script rules beat user spacing.** No letter spacing on cursive or Indic scripts; no justification of Thai in a browser engine.
6. **Genre beats user spacing where meaning is at stake.** In verse, code, math and tables only size and face apply.
7. **Dark themes imply generous size.** The legibility cost of light text on dark grows as text shrinks, so dark defaults are never paired with small text, and text weight is lightened on dark grounds (380 against 400 in Ink).

## Colour and contrast in the reading view

Every theme is checked by `tools/audit_contrast.py` against WCAG 2.2 without rounding: body text at least 7:1 on the reading ground, secondary text and every code token at least 4.5:1 on every surface they appear on (including under a selection), control edges at least 3:1. Current results:

| Role | Paper | Ink | Sepia | Dusk | Night | Fjord | HC light | HC dark |
|---|---|---|---|---|---|---|---|---|
| Body text | 15.5 | 13.0 | 12.4 | 13.0 | 13.4 | 11.3 | 21.0 | 21.0 |
| Secondary text | 7.3 | 8.2 | 7.2 | 7.8 | 8.0 | 7.7 | 15.1 | 16.4 |
| Faint labels on sidebar | 4.9 | 5.8 | 4.8 | 5.6 | 5.7 | 5.7 | 9.5 | 11.9 |
| Accent and links | 6.8 | 9.1 | 6.5 | 8.7 | 10.1 | 7.6 | 10.6 | 14.9 |
| Lowest code token | 6.1 | 8.3 | 5.9 | 7.7 | 7.4 | 8.1 | 8.6 | 12.2 |
| Control edge | 4.2 | 3.9 | 3.8 | 3.8 | 4.3 | 4.2 | 10.9 | 13.6 |

The first audit failed eight pairs, all in the light themes and Fjord (comments under a selection, faint sidebar labels, a sidebar control edge at 2.97:1); each was fixed in the tokens before anything was built on them.

## Verifying an implementation

The handbook's verification list applies unchanged. For Marxy in particular:

- **Measure:** for each type and type set, render a long paragraph, count characters per full line per character (excluding last lines and inline code), and assert the average is within 10 per cent of the target when the window is wide enough.
- **Pagination:** the same settings give the same page count and page starts; no heading ends a page; the next page never shows in the current spread.
- **Code integrity:** copying any code block yields text byte-identical to the source.
- **Genre override:** applying every spacing setting at its maximum leaves code, data and verse unchanged.
- **Contrast:** the audit script passes in CI; a theme that fails cannot ship.
