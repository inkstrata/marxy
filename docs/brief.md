# The brief, distilled

**Status:** the product as decided at handoff, 2026-09-18, restated by ADR-0052 on 2026-10-07.
This is the specification; ADR-0052 holds the spirit it serves.

## What Marxy is

A **reader** for source of any kind: Markdown, HTML, code, logs, data, and what people and AI
agents write as text. It opens anything at once, gives you an index you can flip through, sets
text like a well-made book, shows you exactly what a file contains, and lets you operate on what
you read. Reading leads; Source is a real editor, sized to the work of reading.

It exists because reading in existing tools feels wrong — not feature-poor, wrong in *feel*.
Every markdown application is a writing tool with a preview pane bolted on. An independent 2026
survey reached the same conclusion: *"surprisingly few tools exist just for reading."* On Linux
the reader shelf is empty.

## The name is an instruction

Marx and Banksy. Free and open source (MIT, no paid tier, no accounts), respectful of art, and
private by default: no telemetry ever, nothing leaves the machine without a reader action, and
the file is never touched beyond what the reader asked. See ADR-0006, ADR-0044 and ADR-0052.

## Content

Every kind of text is first-class: READMEs with their badges, raw HTML and tables; AI and agent
artifacts (plans, reports, transcripts), regenerated constantly, so the file changing under you
without losing your place is a defining interaction; source files; logs and data; prose.

## Values

**Free, private, faithful, fast, beautiful, honest, accessible**, held together. When two pull
apart, the resolution favours the reader and is written down. Each value hardens into tests,
gates and commitments as development reaches it (ADR-0052).

## Two modes (ADR-0005)

**Rendered**, the default: fully typeset, no caret, selection and operations. **Source**: a
real plain-text editor (CodeMirror 6) that doubles as the code viewer. Markdown opens
Rendered; everything else opens Source. One key toggles; reading position survives.

## Editing is transformation (ADR-0004)

In Rendered: select something → the source map gives a byte range → a pure text function
transforms it → the buffer is spliced. Undo is free, byte fidelity is structural, operations are
testable without a UI. Built in and curated, plus a reader-configured command as an operation
(ADR-0049). A plugin API, if one is wanted, is decided by ADR.

## Rendered reshapes in the open; Source is exact (ADR-0052)

Rendered may fold frontmatter, set comments aside and restyle, and marks every place it does,
with Source one action away. A link's real target, bidi controls and zero-width characters are
visible in Rendered. Source shows the file exactly as it is.

## Speed (ADR-0032, ADR-0052)

First readable text never waits for the whole file, whatever its size. Switching
indexed documents under 50 ms and palette keystrokes under 16 ms are the sphere of concern;
the numbers are recorded, not CI failures.

## Typography (ADR-0014, ADR-0033)

Marxy must look demonstrably better set than Typora, Marked 2 and Obsidian — the way a
well-made book is better set than a web page. The look comes from the bundle (a measure in `ch`, a baseline grid
with zero drift, hanging punctuation, a bundled typeface, owned line breaking), not from any one
of them; the test is in `aesthetics-acceptance.md`.

## Chrome at rest is zero

No toolbar, no tab bar, no sidebar. The palette, outline, find and the mode switch are
summoned and dismissed. The palette carries recency instead of a tab bar (ADR-0011).

## Themes are documents (ADR-0008)

User CSS is a headline feature. A theme is a CSS file you can open in Marxy, working against a
published token contract, with no network access, ever.

## Platforms

macOS first; Linux becomes a release criterion once it can be verified (ADR-0046); Windows later.

## Out of scope

Sharing, hosting, publishing, sync, accounts, mobile, a managed library that owns or copies the
reader's files, a plugin API (unless an ADR adds one), Mermaid, composed documents. Library browsing (ADR-0062) and local export from the unfolded
workspace (`docs/plan/direction-2026-10/`) were lifted from this list on 2026-10-10. The parse-and-render pipeline stays shell-free
(ADR-0020) so none of these is foreclosed.
