---
format: corpus/1
title: Windowed Markdown pages
kind: corpus
status: active
created: 2026-11-27
question: How should the reader make windowing the architecture of every Markdown page (one geometry table, a mounting policy that depends only on size), and is content-visibility viable with its typesetter on WebKit or should it mount only the blocks near the viewport?
synthesis: SYNTHESIS.md
requested_works: []
---

# Windowed Markdown pages

A delta on [Large files in a desktop reader](../large-files/README.md): how a Markdown page becomes windowed by
design, with one geometry table for every page and a mounting policy that depends only on size; whether
`content-visibility` alone holds up with the baseline-grid typesetter in WebKit; what the node budget is; and in
what order the geometry table, the scale record, typesetting by distance and windowed pages are built. Ten vectors,
two of them measurements, researched in parallel by a fleet on 2026-11-27.

**Start with [the synthesis](SYNTHESIS.md).** Then the chapters, in order:

| NN | Chapter | Prefix |
|---|---|---|
| 01 | [Code map: geometry readers and whole-page assumptions](01-code-map.md) | CMP |
| 02 | [Tier 1 measured: content-visibility with the grid](02-tier1-measure.md) | TIR |
| 03 | [The node budget, measured](03-node-budget.md) | NOD |
| 04 | [Height maps and viewports in other systems](04-height-maps.md) | HMP |
| 05 | [Engine support: WebKit by macOS release, WebView2](05-engine-support.md) | ENG |
| 06 | [Estimates and scroll anchoring](06-estimates-anchoring.md) | ANC |
| 07 | [Accessibility of windowed documents](07-accessibility.md) | ACC |
| 08 | [Find, select all and copy over a byte model](08-find-select-copy.md) | FSC |
| 09 | [Typesetting by distance and on demand](09-typeset-distance.md) | TBD |
| 10 | [Editing with windowing](10-editing.md) | EDW |

Researched under [`BRIEF.md`](BRIEF.md); each chapter was checked against its sources by a separate verifier
(`verify/`); quoted pages are kept in `sources/`, and the measurement probes with their outputs in `probes/`.
Changes since: [`CHANGELOG.md`](CHANGELOG.md).
Related: [Large files](../large-files/SYNTHESIS.md) (D-01 and D-04 are refined here), [Big files](../../big-files.md),
[architecture](../../architecture.md).
