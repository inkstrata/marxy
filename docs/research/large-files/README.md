---
format: corpus/1
title: Large files in a desktop reader
kind: corpus
status: active
created: 2026-11-27
question: How should a webview desktop reader open, render, search, edit and save text files of 1 to 50 MB without freezing, how do comparable apps do it, and which rules and checks keep new features from re-introducing whole-document work?
synthesis: SYNTHESIS.md
requested_works: []
---

# Large files in a desktop reader

Research behind Marxy's work on big files: best practices for 1–50 MB text in a webview app, how code
editors, Markdown apps, e-book readers and data viewers handle the same problems, and how projects keep
scale from regressing. Ten vectors, researched in parallel by a fleet on 2026-11-27.

**Start with [the synthesis](SYNTHESIS.md).** Then the chapters, in order:

| NN | Chapter | Prefix |
|---|---|---|
| 01 | [Code editors at scale](01-code-editors.md) | EDS |
| 02 | [Markdown apps and e-book readers](02-markdown-apps.md) | MDA |
| 03 | [Parsing big Markdown](03-parsing.md) | PRS |
| 04 | [Long documents in the DOM](04-dom-rendering.md) | DOM |
| 05 | [Typesetting long documents](05-typesetting.md) | TYP |
| 06 | [The main thread and moving bytes](06-main-thread.md) | THR |
| 07 | [Data, log and hex viewers](07-data-viewers.md) | DAT |
| 08 | [Search, regex and highlighting](08-search-highlight.md) | SRC |
| 09 | [Buffers, memory, undo, diff and save](09-buffers-memory.md) | BUF |
| 10 | [Guardrails against regressions](10-guardrails.md) | GRD |

Researched under [`BRIEF.md`](BRIEF.md); each chapter was checked against its saved sources by a separate verifier, in up to three passes (`verify/`), and the quoted pages are kept in `sources/`. Changes since: [`CHANGELOG.md`](CHANGELOG.md).
Related: [Big files](../../big-files.md), the rules and checks this corpus informs; [architecture](../../architecture.md);
[the October 2026 performance audit](../audit-2026-10/05-performance-audit.md).
