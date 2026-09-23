---
slug: orientation
number: 0
title: Reader Typography Handbook
short: Orientation
h1: Reader Typography Handbook
lede: Groundwork for the typography of a text reader, an app people use to read books, articles, documentation, code and poetry for long stretches. It covers how type is set, which open-source faces to ship, how to space and break lines, how to colour code, how the rules change by genre and by script, and what the research can and cannot tell you. Every recommendation says how strong its evidence is.
description: The orientation page for a twelve-part handbook on typesetting, open-source fonts, spacing, line breaking, syntax highlighting and accessibility for a text-reader app.
icon: book
---

## What this handbook is for

A reader app makes one promise: that the text will get out of the way. Keeping it is harder than it looks, because typographic choices interact. A larger face wants a longer line; a longer line wants more space between lines; justified text is only as good as the line breaker and hyphenation underneath it; and a dark theme changes how heavy the same letters appear. These pages set out those interactions, and for each one they give a default, the range worth exposing to readers, and the evidence behind both.

The handbook is written for the people who will build the reader: engineers choosing a rendering stack, designers setting defaults, and whoever has to defend those defaults later. It assumes no background in typography. The first chapter introduces the vocabulary, and a term is explained in passing wherever it first matters.

It does not cover the reader's interface chrome (library views, toolbars), fixed-layout formats such as PDF and comics, or text-to-speech. It touches them only where they constrain the text itself.

## Three ways to read it

If you want **the answers**, go straight to the [Reader Typography Spec](@spec). It lists every default and user-adjustable range in one place, with a one-line reason for each and a link to the argument.

If you are **building a subsystem**, start with the chapter that owns it: line breaking and hyphenation in [Knuth-Plass Line Breaking](@line-breaking), fonts and licences in [Open Reading Fonts](@fonts), code blocks in [Code and Syntax Highlighting](@code), scripts other than Latin in [Multilingual Text Layout](@multilingual).

If you are **new to the subject**, read in order. Each chapter builds on the vocabulary of the ones before it, and the sequence runs from mechanics (how a page is built) through evidence (what helps readers) to decisions (what to ship).

## The chapters

<!--CHAPTER-MAP-->

## How claims are graded

Typography mixes three kinds of knowledge: experimental findings about reading, conventions refined by five centuries of printers, and engineering facts about software. They deserve different levels of trust, so every empirical claim in these pages carries a mark.

| Mark | Meaning | Example |
|---|---|---|
| {{A}} | Replicated findings or a meta-analysis | Comprehension is somewhat lower on screens than on paper for informational text |
| {{B}} | One well-designed study | A particular font-size effect in one controlled online experiment |
| {{C}} | Small, limited or mixed studies | Effects of syntax colouring on program comprehension |
| {{D}} | Expert convention without a direct test | Indent paragraphs or space them, never both |
| {{X}} | Contested or contradicted | Special "dyslexia fonts" improve reading |

Convention is not a lesser category. Most of typography is {{D}}, and a convention that has survived centuries of readers is good evidence of something, even when nobody has run the experiment. The mark exists so you know which argument you are making when you defend a choice. Engineering facts (what a browser supports, what an algorithm does) carry no grade. They are cited to specifications, source code or the implementers' own documentation, or they were measured here.

## How sources were chosen

The research behind these pages went to primary sources wherever they exist: the paper rather than a summary of it, the specification rather than a blog post about it, a font's own repository and licence file rather than a download site, and the engine team's own write-up of an implementation. Recognised authorities in the field (Bringhurst, Butterick, Legge, the Chicago Manual of Style) come next. Reputable secondary sources are used sparingly and labelled when they are. Wikipedia, listicles, content farms and vendor claims presented as evidence were excluded. Every citation sits in the margin next to the claim it supports. The [Typography Source Ledger](@sources) lists them all, with notes on what each source actually shows and what it does not.

Where the research contradicts popular advice, the handbook says so, and it says so too where the research simply runs out.

## What was measured for this handbook

Some questions have no published answer, so they were measured directly, in Chromium 152 on Windows 11, with scripts that save their raw results. Three findings recur throughout:

- **The `ch` unit is a poor proxy for line length.** It measures the width of the digit zero, which is wider than the average character of running text. Across 48 proportional open-source families, `max-width: 66ch` produced anywhere from 75 to 104 average characters per line. The handbook sets its own measure from each face's measured average character width instead ([Open Reading Fonts](@fonts)).
- **`line-height: normal` means something different in every font,** from 1.0 to 1.68 times the font size in the families measured. Always set line height explicitly.
- **Browsers break lines greedily, and `text-wrap: pretty` in Chromium only rescues short last lines.** Against the same text and the same font metrics, Knuth and Plass's total-fit algorithm cut the number of very loose justified lines by more than half at 66 characters per line and by four-fifths at 80. At phone widths no line breaker saves justified text ([Knuth-Plass Line Breaking](@line-breaking)).

## About this viewer

These pages follow their own advice, so they double as a working example. The text face is Literata, a variable serif designed for long-form reading on screens, with optical sizes that switch automatically between text and display cuts. Labels and captions use Atkinson Hyperlegible Next, and code uses Atkinson Hyperlegible Mono. The default theme is dark, with an off-black ground and off-white text rather than the harshest possible pair, and a slightly lighter text weight than the light theme, because light strokes on a dark ground look heavier than dark strokes on a light one. The line under each chapter title is measured live: it reports the face, size and leading you are actually getting and the characters per line on your screen.

**Reading settings**, at the top right of every page, change the size, line spacing, line length, typeface, alignment and theme. They exist because readers differ, in eyesight, in reading conditions and in what suits them, and because the research finds that what readers prefer is often not what serves them best. No single default fits everyone. The settings are stored in your browser only.
