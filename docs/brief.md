# The brief, distilled

**Status:** the product as decided at handoff, 2026-09-18. History and argument live in
`~/Dev/marxy-brainstorm`; this is the specification.

## What marxy is

A markdown **reader**. A very fast document opener with an index you can flip through
instantly, that sets text beautifully, treats code and AI artifacts as first-class content,
and lets you operate on what you are reading without becoming a writing tool.

It exists because reading markdown in existing tools feels wrong — not feature-poor, wrong in
*feel*. Every markdown application is a writing tool with a preview pane bolted on. An
independent 2026 survey reached the same conclusion: *"surprisingly few tools exist just for
reading."* On Linux the reader shelf is empty.

## The name is an instruction

Marx and Banksy. Free and open source (MIT, no paid tier, no accounts), respectful of art,
and safe for people who dare speak: no telemetry ever, nothing phones home by default, and
the file is never touched beyond what the reader asked. See ADR-0006 and ADR-0009.

## Content, in priority order

1. **READMEs** — badges, raw HTML, nested lists, tables.
2. **AI and agent artifacts** — plans, reports, checklists; regenerated constantly, so the
   file changing under you without losing your place is the defining interaction.
3. **Source files and code snippets** — Source mode is a real code viewer.
4. General prose.

None of these are written in marxy.

## Two modes (ADR-0005)

**Rendered**, the default: fully typeset, no caret, selection and operations. **Source**: a
real plain-text editor (CodeMirror 6) that doubles as the code viewer. Markdown opens
Rendered; everything else opens Source. One key toggles; reading position survives.

## Editing is transformation (ADR-0004)

Select something → the source map gives a byte range → a pure text function transforms it →
the buffer is spliced. Undo is free, byte fidelity is structural, operations are testable
without a UI. Built in and curated; no plugin or scripting API.

## Speed is a promise (ADR-0013)

Cold start to first readable text under 500 ms; switching indexed documents under 50 ms;
palette keystrokes under 16 ms. CI fails on regression.

## Aesthetics are the differentiator (ADR-0007, ADR-0014)

marxy must look demonstrably better set than Typora, Marked 2 and Obsidian — the way a
well-made book is better set than a web page. A first-time user's first reaction must be about
how it looks. The mechanism: owned line breaking, hanging punctuation, a baseline grid with
zero drift, a measure in `ch`, a bundled typeface; the test is in `aesthetics-acceptance.md`.

## Chrome at rest is zero

No toolbar, no tab bar, no sidebar. The palette, outline, find and the mode switch are
summoned and dismissed. The palette carries recency instead of a tab bar (ADR-0011).

## Themes are documents (ADR-0008)

User CSS is a headline feature. A theme is a CSS file you can open in marxy, working against a
published token contract, with no network access, ever.

## Platforms

macOS first; Linux mandatory and at parity from the first release; Windows later.

## Out of scope

Sharing, hosting, publishing, sync, accounts, mobile, library browsing, plugins, scripting,
export, Mermaid, composed documents. The parse-and-render pipeline stays shell-free
(ADR-0020) so none of these is foreclosed.
