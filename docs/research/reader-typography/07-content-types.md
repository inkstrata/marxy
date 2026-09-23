<!-- Generated from source/07-content-types.md by source/to-gfm.mjs; edit the source, then run the script. -->

# Typography by Content Type

*A novel wants to disappear; a manual wants to be scanned; a poem's line breaks are part of the poem; code must never be reflowed. A reader that treats every document the same will serve one genre and damage the rest. This chapter sets out, genre by genre, what the page must preserve, what it may change, and which conventions have authority behind them.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention without a direct test · **[X]** contested or contradicted. Part of the [Reader Typography Handbook](README.md).

## The principle: what may the reader change?

Every genre divides its typography into two parts: what the author meant, which the reader app must preserve, and what is merely presentation, which the reader may adapt to the device and the person. Getting that boundary right matters more than any individual rule.

| Genre | Must preserve | May adapt |
|---|---|---|
| Prose fiction | Paragraphing, italics for emphasis and titles, section breaks, chapter structure | Face, size, measure, leading, alignment, hyphenation |
| Non-fiction | As fiction, plus headings, lists, notes, figures, tables | As fiction; note presentation (margin, pop-up, end) |
| Technical documentation | Code verbatim, UI names, admonition types, heading hierarchy | Prose face, size, measure; code block wrapping (with care) |
| Poetry | Every line break, indentation, stanza breaks, spacing within lines | Face, size; how over-long lines turn over |
| Drama and screenplays | Speaker labels, stage directions, speech boundaries | Face, size; the industry format is for production, not reading |
| Code | Every character, all whitespace, line structure | Face, size, colours; wrap versus scroll |
| Math | Symbols, italic versus roman distinctions, structure | Size |
| Tables | Row and column relationships, alignment of numbers | Font size within the table; scrolling versus reflowing |

The "may adapt" column is where the reading settings from chapter 10 apply. Everything in the "must preserve" column should be immune to them. A reader who chooses ragged right should not have a poem's deliberate indentation reset. A reader who increases letter spacing should not have code realigned.

## Prose fiction

Book typography is the oldest and most settled of the conventions here **[D]**, and a reader for fiction should honour it.

**Paragraphs are marked by an indent, with no space between them.** Bringhurst sets the indent at no less than an en (half an em) and notes that one em is the most common value. The first paragraph after a heading or section break is set flush left, because an indent there marks a break that the heading already made.[^bringhurst-para] Butterick adds the rule most often quoted: indent *or* space paragraphs, never both.[^butterick-para] Standard Ebooks, whose manual is the most rigorous public guide to e-book typography, uses a 1em indent, no indent after headings, scene breaks and figures, and no paragraph spacing.[^se-para]

**Scene breaks need a visible mark.** A blank line vanishes when it falls at the bottom or top of a page, or at the top of a screen after scrolling. A centred rule, an asterism (⁂) or an ornament survives any page break. Standard Ebooks uses a short centred rule and sets the following paragraph flush.

**Chapter openings** can drop down the page, use a larger first line, or begin with an initial letter (CSS `initial-letter`, supported in Chrome and Safari but not Firefox). None of this is necessary. A plain heading with generous space above serves.

**Italic** marks emphasis, titles, foreign words and ships' names. These are the author's choices, and a reader must preserve them even when a user chooses a face whose italic they dislike. A face without a true italic is unsuitable for fiction.

**Dialogue** follows the language's quotation conventions (chapter 8). Preserve the author's marks; do not "correct" British single quotes to American double quotes.

## Non-fiction and essays

Non-fiction adds apparatus: headings, lists, block quotations, notes, figures and tables. The conventions are mostly about restraint.

**Headings.** Butterick's guidance is the most practical: at most three levels, preferably two; distinguish them with space above and below before size or weight, with less space below than above so the heading binds to the text it introduces; use bold rather than italic and only a modest size increase; avoid all capitals and centring; never hyphenate a heading.[^butterick-head] He rejects modular scales, preferring judgement ("when your headings look right, they are right"). Tim Brown's modular scale takes the opposite view and derives heading sizes from a ratio.[^brown] Both are defensible **[X]**. A reader should respect the book's own heading styles and only normalize grossly oversized ones.

**Block quotations** are indented, set slightly smaller, and carry no quotation marks. On screen, an indent of 2 to 5 ems works.[^butterick-bq]

**Notes.** This is where screens change the rules most. Bringhurst ranks sidenotes as the easiest notes to find, footnotes next, and endnotes last. He calls footnotes that run onto a second page a failure of design.[^bringhurst-notes] On the web, footnotes degrade into endnotes at the bottom of a scrolling page, the worst option. Three good screen patterns exist:

- **Margin notes** (Tufte CSS and these pages) put the note beside its reference on wide screens and behind a tap on narrow ones.[^tufte]
- **Pop-up notes** show the note in place on demand. EPUB reading systems do this for links marked with `epub:type="noteref"` (and the accessible DPUB-ARIA roles `doc-noteref` and `doc-footnote`).[^dpub]
- **Endnotes with return links** remain the fallback.

Standard Ebooks converts all footnotes to endnotes and assumes pop-ups. It also replaces "ibid." with the full reference, because a pop-up loses the context "ibid." relies on.[^se-notes] A reader should render any note reference as a pop-up or margin note, never force the reader to jump to the end of the book and find their way back.

**Figures** stay near the text that discusses them. Tufte's principle is the right one: a figure the reader cannot see while reading about it has failed.

## Technical documentation

Documentation is scanned more than it is read, and its typography exists to make structure visible.

**Code in running text** is set in a monospace face, as are filenames, commands, placeholders and HTTP status codes. UI labels are set in bold, and terms being defined in italic. Google's and Microsoft's style guides agree on this division, and both use sentence case for headings.[^styleguides]

**Admonitions** (note, caution, warning) should be few. Google's guide defines four types and tells writers not to stack them and not to put required steps or prerequisites inside notes, because readers skip notes.[^google-notices] A reader should render admonition types distinctly and never by colour alone (chapter 9).

**Code blocks** must never be reflowed, justified or hyphenated, and their whitespace must survive exactly. Chapter 6 covers them in detail.

**Hierarchy and navigation** matter more than in prose: a visible table of contents, anchored headings, and a way back to the top. Documentation is also where readers most often want a wider measure, because tables and code are wide. Allow it, but keep prose paragraphs at a comfortable measure even when the container is wide.

## Poetry

Poetry is the genre most damaged by generic reflowing. Its line breaks are part of the text.

**Preserve every line break and every indentation.** Standard Ebooks marks up each stanza as a paragraph and each line as its own element. It indents with classes rather than spaces (never with non-breaking spaces), and handles lines too long for the screen with a hanging indent, so that a turned-over line is visibly a continuation. The CSS is `padding-left: 1em; text-indent: -1em`.[^se-poetry] This is the single most important rule: on a phone, many lines of verse are longer than the screen, and a turnover without a hanging indent is indistinguishable from a new line.

**Stanza breaks** must survive page breaks for the same reason scene breaks must. A stanza that starts at the top of a new page looks identical to a continuation of the previous one. Readers that paginate should either keep a stanza's first lines with the rest or mark the break.

**Alignment.** Bringhurst says verse should be set flush left and ragged right in the form the poet chose, and that verse quotations can be centred on their longest line.[^bringhurst-verse] Never justify verse, never hyphenate it, and never apply `text-wrap: balance` or `pretty` to it.

The Chicago Manual of Style (18th edition, §§12.25–12.33) covers setting off poetry, uniform indents, runover lines and multiple stanzas.[^cmos] Omitted lines are marked with a vertical ellipsis (⋮).

> **Recommendation.** Detect verse from its markup (EPUB semantics such as `z3998:poem` and `z3998:verse`, line-level elements, or classes) and switch the reader into a verse mode. Keep lines and indents, use hanging indents for turnovers, suspend justification, hyphenation and the user's paragraph-spacing settings, and keep only size and face adjustable.

## Drama

Plays alternate speaker labels, speeches and stage directions. Standard Ebooks sets speaker names (personas) in small capitals, never italic, and stage directions in italic. Where a stage direction names a character, the name appears in small capitals, marked as bold in the markup. Dialogue is structured as a table of rows: speaker, then speech. Verse drama keeps verse line structure within speeches, with a class for lines spoken together.[^se-drama] CMOS §12.54–12.55 covers drama and shared lines in verse drama.

For a reader the essentials are:

- speaker labels must stay visually distinct from speech in every face and theme;
- a speech must not lose its speaker across a page break;
- stage directions keep their italic.

## Screenplays

Screenplays have a rigid industry format: 12-point Courier, strict margins and element indents. The Academy Nicholl Fellowships, for instance, require standard format in 12-point Courier at 80 to 125 pages and warn that "cheated" margins count against a script.[^nicholl] That format exists for production scheduling, not for reading. A reader can offer it faithfully, in Courier Prime (the OFL screenplay face), for users who want the page as the industry sees it, and a reflowed reading view for everyone else. The often-quoted rule that one page equals one minute of screen time is folklore as far as the sources checked here go; the Nicholl rules do not mention it.

## Letters, diaries and messages

Standard Ebooks treats letters as block quotations with a header (date line, salutation) and a footer (valediction, signature, postscript). It sets a salutation on its own line in small capitals, leaves the first line after the salutation unindented, and sets telegrams entirely in small capitals.[^se-letters] CMOS §12.50 covers text messages quoted as dialogue. Chat logs and transcripts share the drama problem: speaker labels must stay attached and distinct. A hanging indent, with the speaker label outdented and the message set as a block, reads well at any width.

## Mathematics

Mathematical typography has firm rules, set out in ISO 80000-2 and summarized in NIST's SP 811:[^nist]

- **Italic:** quantity symbols, variables and general functions f(x).
- **Roman (upright):** units, defined functions and operators (sin, log, exp, the d of a derivative), mathematical constants such as π, and numbers.
- **Numbers:** digits grouped in threes with a thin space, and a leading zero before a decimal point.

A reader should render MathML with a font that has an OpenType MATH table. Chromium defaults to Latin Modern Math; STIX Two Math is the usual open alternative. MathML Core is supported in all three engines.[^mathml] It should never let a user's face choice replace the math font, and never apply letter or word spacing inside formulas.

## Tables and numbers

Tables are read in two directions, so alignment carries meaning:

- Left-align text.
- Right-align quantities, or align them on the decimal point.
- Align each column heading with its data.
- Use tabular lining figures, so that digits line up column by column.
- Use as few rules and fills as possible, grouping by white space.[^rutter-tables]

In running text, the old-style versus lining figure question is contested. Bringhurst and Rutter want old-style figures in text, and Butterick leaves it optional **[X]**. In tables everyone agrees on tabular lining figures. CSS supports decimal alignment in the specification (`text-align: "."`), but no browser implements it.

On a phone, wide tables must scroll horizontally inside their own container rather than shrink to illegibility or reflow into stacked cards that break row relationships. The scrolling container needs keyboard focus (chapter 9).

## Children's and early readers

Research here is thin but real.

- **Size.** Wilkins and colleagues found that children aged 7 to 9 read and verified sentences faster at a 5 mm x-height than at 4.2 mm. Their measured reading age was four months higher when test text stayed at a 3.3 mm x-height instead of shrinking as tests usually do.[^wilkins] **[B]**
- **Letterforms.** A University of Reading study of six-year-olds found they read Gill Sans and Century equally well.[^walker] **[C]** The effect of single-storey ("infant") a and g was not confirmed from the full text.
- **Faces.** Andika (SIL), designed for literacy with unconfusable letterforms, is the obvious open face for early readers **[D]**.

The practical guidance is larger sizes, generous spacing, short lines, and never shrinking text as children get older.

## Punctuation that should be right everywhere

Some conventions apply to every genre, and a reader that imports plain text or badly produced files should repair them. The rules, from the Chicago Manual of Style (chapter 6) and Butterick:[^punct]

- curly quotation marks and apostrophes, with the apostrophe pointing down even at the start of a word (’tis, ’90s, rock ’n’ roll);
- an en dash for ranges;
- an em dash for breaks in American practice (Bringhurst prefers a spaced en dash) **[X]**;
- the ellipsis character, or three periods joined by non-breaking spaces;
- straight or prime marks, not curly quotes, for feet and inches;
- non-breaking spaces after § and ¶, between a number and its unit, and after abbreviations like "Fig.".

Automatic "smart quote" conversion has a documented failure. SmartyPants, the original tool, turns a leading apostrophe ('Twas) into an opening quote and cannot fix it in general; it special-cases only decade abbreviations such as '80s.[^smarty] Apply such conversion only to text that has straight quotes, never to text that is already typographically correct.

French spacing is a locale rule. Quebec's language office prefers no space, or a thin space, before ; ! ? and a no-break space before the colon and inside guillemets.[^oqlf] France's typographic tradition uses a narrow no-break space (U+202F) before high punctuation. That convention was not verified against a French authority for this handbook.

## A summary matrix

| Genre | Alignment | Hyphenation | Paragraph marker | Notes | User spacing controls |
|---|---|---|---|---|---|
| Fiction | Justified with total-fit breaking and hyphenation, otherwise ragged | Yes | Indent, no space | Pop-up | All apply |
| Non-fiction | As fiction | Yes | Indent or space (never both) | Margin or pop-up | All apply |
| Documentation | Ragged | Prose only | Space | Inline or pop-up | Prose only |
| Poetry | As set by the poet | Never | Stanza space | Pop-up | Size and face only |
| Drama | Ragged | Speeches only | Speaker label | Pop-up | Size and face only |
| Code | Never altered | Never | Not applicable | Not applicable | Size and face only |
| Math | Centred or as authored | Never | Not applicable | Not applicable | Size only |
| Tables | By column type | Never in numbers | Not applicable | Not applicable | Size only |

[^bringhurst-para]: Robert Bringhurst, *The Elements of Typographic Style*, §2.3.1–2.3.2. The minimum indent was "one em" in the 1992 first edition and "one en" from the 1996 edition. Verified against the 1992 and 1996 editions; wording in the 2012 version 4.0 not directly seen.
[^butterick-para]: Matthew Butterick, *Practical Typography*, "First-line indents" and "Space between paragraphs". [practicaltypography.com/first-line-indents.html](https://practicaltypography.com/first-line-indents.html).
[^se-para]: Standard Ebooks Manual of Style 1.9.1, §8.4, and the `core.css` stylesheet in the standardebooks/tools repository. [standardebooks.org/manual](https://standardebooks.org/manual).
[^butterick-head]: Butterick, *Practical Typography*, "Headings", "Hierarchical headings" and "Space above and below". [practicaltypography.com/headings.html](https://practicaltypography.com/headings.html).
[^brown]: Tim Brown, "More Meaningful Typography", *A List Apart* 327, 3 May 2011. [alistapart.com/article/more-meaningful-typography](https://alistapart.com/article/more-meaningful-typography/).
[^butterick-bq]: Butterick, *Practical Typography*, "Block quotations". [practicaltypography.com/block-quotations.html](https://practicaltypography.com/block-quotations.html).
[^bringhurst-notes]: Bringhurst, §4.3 (notes), 1996 edition.
[^tufte]: Dave Liepmann and Edward Tufte, *Tufte CSS*. [edwardtufte.github.io/tufte-css](https://edwardtufte.github.io/tufte-css/).
[^dpub]: W3C, Digital Publishing WAI-ARIA Module 1.1, Recommendation, 12 June 2025 (`doc-noteref`, `doc-footnote`, `doc-endnotes`; `doc-endnote` deprecated). [w3.org/TR/dpub-aria-1.1](https://www.w3.org/TR/dpub-aria-1.1/).
[^se-notes]: Standard Ebooks Manual of Style 1.9.1, §7.10 (endnotes).
[^styleguides]: Google developer documentation style guide, "Text-formatting summary" (January 2026); Microsoft Writing Style Guide, "Formatting text in instructions" (March 2026). [developers.google.com/style](https://developers.google.com/style/text-formatting).
[^google-notices]: Google developer documentation style guide, "Notices" (September 2025). [developers.google.com/style/notices](https://developers.google.com/style/notices).
[^se-poetry]: Standard Ebooks Manual of Style 1.9.1, §7.5 (poetry, verse and songs).
[^bringhurst-verse]: Bringhurst, §2.3.4.
[^cmos]: *The Chicago Manual of Style*, 18th edition (2024), chapter 12. Paragraph titles were verified from the official table of contents; the rule text is behind a subscription.
[^se-drama]: Standard Ebooks Manual of Style 1.9.1, §7.6 (drama).
[^nicholl]: Academy Nicholl Fellowships in Screenwriting, 2026–2027 rules, terms and conditions. [oscars.org/nicholl](https://www.oscars.org/nicholl).
[^se-letters]: Standard Ebooks Manual of Style 1.9.1, §7.7 (letters).
[^nist]: NIST Special Publication 811, *Guide for the Use of the International System of Units*, chapter 10. [nist.gov/pml/special-publication-811](https://www.nist.gov/pml/special-publication-811).
[^mathml]: W3C, MathML Core, Candidate Recommendation Snapshot, 24 June 2025; MDN browser-compat-data 8.1.2 (`<math>` in Chrome 109, Firefox and Safari); Chromium `web_preferences.cc` for the default math font. [w3.org/TR/mathml-core](https://www.w3.org/TR/mathml-core/).
[^rutter-tables]: Richard Rutter, *Web Typography* (2017), sample chapter "Numerals and tables". [book.webtypography.net](https://book.webtypography.net/).
[^wilkins]: Arnold Wilkins, Roanna Cleave, Nicola Grayson and Louise Wilson, "Typography for children may be inappropriately designed", *Journal of Research in Reading* 32(4):402–412, 2009 (read via the ERIC abstract, EJ860204).
[^walker]: Sue Walker and Linda Reynolds, "Serifs, sans serifs and infant characters in children's reading books", *Information Design Journal* 11(2/3):106–122, 2003 (abstract only). [doi.org/10.1075/idj.11.2.04wal](https://doi.org/10.1075/idj.11.2.04wal).
[^punct]: *The Chicago Manual of Style*, 18th edition, §6.79–6.100 (hyphens and dashes) and §6.123–6.130 (smart quotes, apostrophes, spaces); ellipses are in chapter 12 (§12.59–12.69) in this edition. Butterick, *Practical Typography*, pages on quotes, apostrophes, dashes, ellipses and non-breaking spaces.
[^smarty]: John Gruber, *SmartyPants* 1.5.1, "Algorithmic shortcomings" and version history. [daringfireball.net/projects/smartypants](https://daringfireball.net/projects/smartypants/).
[^oqlf]: Office québécois de la langue française, Banque de dépannage linguistique, spacing before and after punctuation. [vitrinelinguistique.oqlf.gouv.qc.ca](https://vitrinelinguistique.oqlf.gouv.qc.ca/22039/la-typographie/espacement/espacement-avant-et-apres-les-signes-de-ponctuation-et-les-symboles).
