# Reader Artifacts Handbook: the research Marxy's non-prose presentation follows

This is a handbook on how a reader should present content that is not prose: the transcripts, tool output, plans and instruction files that AI agents produce; source code and diffs read rather than edited; logs and structured data; and READMEs. It asks the same three questions of every unit of content: what the evidence says a reader needs, what Marxy does by default, and what the operation layer should expose. Every empirical claim carries an evidence grade: **[A]** replicated or meta-analysed, **[B]** one good study, **[C]** small or mixed, **[D]** expert convention or convergence of tools, **[X]** contested. It was researched and measured for Marxy's author on 2026-09-25.

**It is a sibling of the [Reader Typography Handbook](../reader-typography/README.md), not a replacement.** That one governs how any text is *set*; this one governs how a non-prose unit is structured, marked, folded, trusted and operated on. Where they overlap, [ADR-0035](../../adr/0035-artifact-presentation-follows-the-research.md) (proposed) says which decides.

**Read this first: almost everything here is [D].** The evidence on how people read code, logs and agent transcripts is narrow, and none of it tests the choices a reader has to make. The handbook says so on every line and does not borrow authority from studies of a different task. Its most solid findings are measurements of Marxy itself, not of readers.

## Read it

If you want the answers, start with [10 · Spec](10-spec.md): every default with its grade, the chapter that argues for it, and whether Marxy does it today.

| Chapter | What it settles |
| --- | --- |
| [00 · Orientation](00-orientation.md) | What the handbook covers, how claims are graded, what was measured, and six findings about what Marxy renders today |
| [01 · Reading tasks](01-reading-tasks.md) | Skim, verify, locate, copy exactly, compare, and what code-reading, log and AI-assistance studies say about each |
| [02 · Agent artifacts](02-agent-artifacts.md) | Transcripts, turns, tool output, plans, instruction files and prompts, as formats and as things to read |
| [03 · Structured output](03-structured-output.md) | JSON, YAML, TOML, front matter, logs, terminal sessions and ANSI; folding without touching a byte |
| [04 · Code as read](04-code-typography.md) | Monospace against the grid, tabs, wrap, line numbers, colour budget, and code inside Knuth–Plass paragraphs |
| [05 · Diffs and provenance](05-diffs-provenance.md) | How changes are reviewed and shown, and what byte provenance makes possible |
| [06 · READMEs](06-readmes.md) | Badges, heroes, tables, alerts, collapsibles, diagrams, links and install commands |
| [07 · Trust and safety](07-trust-safety.md) | Untrusted agent output, hidden instructions, invisible characters, remote images and links |
| [08 · Teardown](08-teardown.md) | Twelve tools, cited from their own documentation |
| [09 · Colour and access](09-colour-access.md) | Diff, alert and marker colours measured for contrast and colour-vision deficiency |
| [10 · Spec](10-spec.md) | **The answers** |
| [11 · Source ledger](11-sources.md) | Every source, graded, with what it does and does not show |
| [Gap list](gaps.md) | What the frozen contracts cannot express, as [17 draft ADR proposals](proposals/) |
| [Story list](stories.md) | Twenty-five stories ordered by reader impact, in the board's format ([CSV](stories.csv)) |
| [Limits](limits.md) | What would change my mind, what remains taste, and where the method is weakest |
| [Coverage](coverage.json) | Every unit above with one disposition (filed, applied, deferred, declined) and its board keys; `tools/coverage.mjs` reports it against the live board |

## Files

| Path | What it is |
| --- | --- |
| `NN-*.md`, `gaps.md`, `stories.md`, `limits.md`, `10-spec.md` | Written by hand; the chapters were researched by parallel agents and each was attacked by a separate skeptic pass |
| `11-sources.md` | **Generated** from the chapters' source records by `tools/build-ledger.mjs`; do not edit |
| `data/NN.json` | Each chapter's sources, spec rows, operations, gaps and stories, as structured data |
| `data/skeptic-NN.md` | The skeptic pass on each chapter: what was attacked and what survived |
| `data/ledger-notes.md` | Hand-written notes appended to the ledger |
| `lab/probe.mjs`, `lab/data/probe-results.json` | 31 artifact cases run through Marxy's real render pipeline and highlighter |
| `proposals/P01-*.md` … `P17-*.md` | Draft ADR proposals, none accepted |
| `stories.csv` | The story list in the board's nine columns, keyed `MARXY-NEW-ra-<slug>` until filed |
| `tools/check.mjs` | The mechanical half of the handbook's own standard: every footnote defined and cited, every spec row graded and linked, every source with a URL and an access date, every story acceptance naming a test or gate, and every unit in `coverage.json` exactly once with keys that are board rows |
| `coverage.json` | **Hand-kept ledger** of what the board did with each spec row, operation, coupling rule, verification check, draft, declined item, taste item and draft story (MARXY-228). Add a unit here whenever the handbook grows |
| `tools/coverage.mjs` | Reports the ledger against the live fleet board: how much is filed, landed, applied, deferred or declined, and what is still open |

Reproduce the measurements from the repository root (Node 24 or later):

```sh
node docs/research/reader-artifacts/lab/probe.mjs
node docs/research/reader-artifacts/tools/build-ledger.mjs
node docs/research/reader-artifacts/tools/check.mjs
node docs/research/reader-artifacts/tools/coverage.mjs
```

The probe and the checks describe one commit of Marxy and the engine builds of one week. The colour and copy measurements were made in headless WebKit and Chromium under Playwright on local pages, not in the shipped webview; each chapter says where that matters.
