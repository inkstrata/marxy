<!-- Generated from source/00-orientation.md by source/to-gfm.mjs; edit the source, then run the script. -->

# Reader Typography Handbook

*Groundwork for the typography of a text reader, an app people use to read books, articles, documentation, code and poetry for long stretches. It covers how type is set, which open-source faces to ship, how to space and break lines, how to colour code, how the rules change by genre and by script, and what the research can and cannot tell you. Every recommendation says how strong its evidence is.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention without a direct test · **[X]** contested or contradicted. Part of the [Reader Typography Handbook](README.md).

## What this handbook is for

A reader app makes one promise: that the text will get out of the way. Keeping it is harder than it looks, because typographic choices interact. A larger face wants a longer line; a longer line wants more space between lines; justified text is only as good as the line breaker and hyphenation underneath it; and a dark theme changes how heavy the same letters appear. These pages set out those interactions, and for each one they give a default, the range worth exposing to readers, and the evidence behind both.

The handbook is written for the people who will build the reader: engineers choosing a rendering stack, designers setting defaults, and whoever has to defend those defaults later. It assumes no background in typography. The first chapter introduces the vocabulary, and a term is explained in passing wherever it first matters.

It does not cover the reader's interface chrome (library views, toolbars), fixed-layout formats such as PDF and comics, or text-to-speech. It touches them only where they constrain the text itself.

## Three ways to read it

If you want **the answers**, go straight to the [Reader Typography Spec](10-spec.md). It lists every default and user-adjustable range in one place, with a one-line reason for each and a link to the argument.

If you are **building a subsystem**, start with the chapter that owns it: line breaking and hyphenation in [Knuth-Plass Line Breaking](05-line-breaking.md), fonts and licences in [Open Reading Fonts](03-fonts.md), code blocks in [Code and Syntax Highlighting](06-code.md), scripts other than Latin in [Multilingual Text Layout](08-multilingual.md).

If you are **new to the subject**, read in order. Each chapter builds on the vocabulary of the ones before it, and the sequence runs from mechanics (how a page is built) through evidence (what helps readers) to decisions (what to ship).

## The chapters

- **[1. The Typesetting Pipeline](01-pipeline.md)** — How text becomes a laid-out page: Unicode, segmentation, shaping, line breaking, justification, pagination and rasterization, with the vocabulary the rest of the handbook uses. *Read it when you are new to typesetting, or you are choosing a rendering stack.*
- **[2. The Reading Evidence](02-evidence.md)** — What vision science and reading research establish about size, line length, spacing, typefaces, contrast and polarity, and where the research is silent. *Read it when you need to defend a default with evidence, or judge a claim someone made.*
- **[3. Open Reading Fonts](03-fonts.md)** — Open-source typefaces for long-form reading, code and other scripts: licences, measured metrics, what to bundle and how to load it. *Read it when you are choosing or licensing typefaces.*
- **[4. Spacing and Page Layout](04-spacing-layout.md)** — Size, leading, measure, paragraphs, hierarchy, margins, notes, and the choice between scrolling and pages. *Read it when you are setting the page geometry and the vertical rhythm.*
- **[5. Knuth-Plass Line Breaking](05-line-breaking.md)** — Greedy versus optimal line breaking, how Knuth and Plass's algorithm works, what TeX, InDesign, Typst, Android and browsers actually do, hyphenation, microtypography and pagination. *Read it when you are implementing justification or hyphenation.*
- **[6. Code and Syntax Highlighting](06-code.md)** — Highlighting engines, what the research says about colour in code, theme design with measured contrast, and the typography of code blocks. *Read it when your reader shows source code.*
- **[7. Typography by Content Type](07-content-types.md)** — Fiction, non-fiction, documentation, poetry, drama, screenplays, math, tables, chat logs: what each asks of the page. *Read it when you need per-genre rules.*
- **[8. Multilingual Text Layout](08-multilingual.md)** — What changes for Chinese, Japanese, Korean, Arabic, Hebrew, Indic and Southeast Asian scripts, and for mixed-language text. *Read it when your content is not only English.*
- **[9. Color and Accessibility](09-color-access.md)** — Contrast, dark mode, themes, colour-vision deficiency, WCAG requirements, dyslexia and low vision. *Read it when you are designing themes or reviewing accessibility.*
- **[10. Reader Typography Spec](10-spec.md)** — The recommended defaults, the ranges users may change, and the reasoning and tests behind each decision. *Read it when you want the answer rather than the argument.*
- **[11. Typography Source Ledger](11-sources.md)** — Every source the handbook relies on, graded for quality, with what each one does and does not show. *Read it when you want to check a citation or judge a source.*

## How claims are graded

Typography mixes three kinds of knowledge: experimental findings about reading, conventions refined by five centuries of printers, and engineering facts about software. They deserve different levels of trust, so every empirical claim in these pages carries a mark.

| Mark | Meaning | Example |
|---|---|---|
| **[A]** | Replicated findings or a meta-analysis | Comprehension is somewhat lower on screens than on paper for informational text |
| **[B]** | One well-designed study | A particular font-size effect in one controlled online experiment |
| **[C]** | Small, limited or mixed studies | Effects of syntax colouring on program comprehension |
| **[D]** | Expert convention without a direct test | Indent paragraphs or space them, never both |
| **[X]** | Contested or contradicted | Special "dyslexia fonts" improve reading |

Convention is not a lesser category. Most of typography is **[D]**, and a convention that has survived centuries of readers is good evidence of something, even when nobody has run the experiment. The mark exists so you know which argument you are making when you defend a choice. Engineering facts (what a browser supports, what an algorithm does) carry no grade. They are cited to specifications, source code or the implementers' own documentation, or they were measured here.

## How sources were chosen

The research behind these pages went to primary sources wherever they exist: the paper rather than a summary of it, the specification rather than a blog post about it, a font's own repository and licence file rather than a download site, and the engine team's own write-up of an implementation. Recognised authorities in the field (Bringhurst, Butterick, Legge, the Chicago Manual of Style) come next. Reputable secondary sources are used sparingly and labelled when they are. Wikipedia, listicles, content farms and vendor claims presented as evidence were excluded. Every citation sits in the margin next to the claim it supports. The [Typography Source Ledger](11-sources.md) lists them all, with notes on what each source actually shows and what it does not.

Where the research contradicts popular advice, the handbook says so, and it says so too where the research simply runs out.

## What was measured for this handbook

Some questions have no published answer, so they were measured directly, in Chromium 152 on Windows 11, with scripts that save their raw results. Three findings recur throughout:

- **The `ch` unit is a poor proxy for line length.** It measures the width of the digit zero, which is wider than the average character of running text. Across 48 proportional open-source families, `max-width: 66ch` produced anywhere from 75 to 104 average characters per line. The handbook sets its own measure from each face's measured average character width instead ([Open Reading Fonts](03-fonts.md)).
- **`line-height: normal` means something different in every font,** from 1.0 to 1.68 times the font size in the families measured. Always set line height explicitly.
- **Browsers break lines greedily, and `text-wrap: pretty` in Chromium only rescues short last lines.** Against the same text and the same font metrics, Knuth and Plass's total-fit algorithm cut the number of very loose justified lines by more than half at 66 characters per line and by four-fifths at 80. At phone widths no line breaker saves justified text ([Knuth-Plass Line Breaking](05-line-breaking.md)).

## About this viewer

These pages follow their own advice, so they double as a working example. The text face is Literata, a variable serif designed for long-form reading on screens, with optical sizes that switch automatically between text and display cuts. Labels and captions use Atkinson Hyperlegible Next, and code uses Atkinson Hyperlegible Mono. The default theme is dark, with an off-black ground and off-white text rather than the harshest possible pair, and a slightly lighter text weight than the light theme, because light strokes on a dark ground look heavier than dark strokes on a light one. The line under each chapter title is measured live: it reports the face, size and leading you are actually getting and the characters per line on your screen.

**Reading settings**, at the top right of every page, change the size, line spacing, line length, typeface, alignment and theme. They exist because readers differ, in eyesight, in reading conditions and in what suits them, and because the research finds that what readers prefer is often not what serves them best. No single default fits everyone. The settings are stored in your browser only.
