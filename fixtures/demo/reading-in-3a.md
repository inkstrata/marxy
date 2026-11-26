---
title: Reading in 3a
sample: constructed for prototype 3a
---

# Reading in 3a

This page was written for prototype 3a, to show what it adds to the way version 3 reads a file. The documents it links to sit among the lab's own files. Eight of them were constructed for the fourth design pass and this one for 3a; each is marked *constructed* wherever it appears, and everything else in `content` is the lab's, byte for byte.

## Links that go somewhere

A link opens its file in this page, and with Ctrl held, beside it. Rest the pointer on a link and it says where it goes before you follow it.

- [Incremental indexing](tidemark/docs/specs/incremental-indexing.md), a long design spec, and straight to [its open questions](tidemark/docs/specs/incremental-indexing.md#open-questions)
- [How tidemark works](tidemark/docs/architecture.md), with two diagrams drawn from their Mermaid source
- [Getting started](tidemark/docs/getting-started.md) and [ADR 0004](tidemark/docs/adr/0004-keep-the-index-beside-the-files.md)
- [On the measure](reading/on-the-measure.md), an essay with maths and six footnotes
- [[2026-10-15]], a daily note written with wikilinks, and the [tidemark folder](tidemark/) itself
- [The incremental indexing spike](transcripts/2026-10-14-incremental-spike.jsonl), a coding agent's session saved as JSON Lines
- [The tidemark README](tidemark/README.md), a link left pointing at a file the folder does not have
- [The CommonMark spec](https://spec.commonmark.org/0.31.2/), which opens in your browser; the reader itself never goes online

A path written as code opens the file it names: `plans/pg16-upgrade-plan.md`, or `src/indexer.rs:1-12` with those lines marked. A link to a heading [in this page](#zoom-out) stays in this page, and back returns.

## Zoom out

Press **Esc** in a Markdown file for its gist: every heading, and the first sentence of every paragraph. Press it again for the shape: the headings, and how long each part is. **Enter**, or a click on a line, goes back in at that line.

## A table in a fence

```csv
case,0.4.0 ms,incremental ms
"notes, nothing changed",148,21
"10k files, nothing changed",1040,118
"100k files, one save under watch",11300,74
```

The fence says `csv`, so it is read as a table.[^numbers] With the table in view, Ctrl+; opens its card, which offers it as written.

[^numbers]: The numbers are the spec's, from its benchmarks in [Incremental indexing](tidemark/docs/specs/incremental-indexing.md).
