# Direction: Galley's workspace, folded for reading

**Status:** accepted, 2026-10-10. The author approved the ADR changes, ruled clipboard-facing features
essential and asked for the mockup in `mock-v2/` to be built. Where the mockup and these pages disagree,
[06-reconciliation.md](06-reconciliation.md) says which wins; the plan is [05-plan.md](05-plan.md).

**In short.** *Galley* is an Opus-written interface prototype kept in `~/Dev/marxy-design`. It is the
comprehensive reader Marxy wants to grow into: audited themes and type sets, a typography for each
kind of text, a library of folders, a source editor with structural tools, an inspector, a palette
with previews, versions and a settings surface. This direction adopts Galley's design nearly whole,
changed in three ways:

1. **It folds up.** While you read, the whole workspace folds away and leaves one column of text on
   the page, as Marxy does today. One key (`⌘\`) unfolds Galley's full workspace: sidebar, tabs,
   toolbar, tool strip, inspector, status bar. Moving the pointer to an edge peeks one panel without
   unfolding the rest. The reader chooses how much machinery is on screen, and the default is none.
   [02-fold-up-workspace.md](02-fold-up-workspace.md)
2. **It is source first.** Galley is built around "the Markdown that AI agents write". In Marxy, AI
   prose is one kind, `report`, beside `log`, `data`, `code`, `readme`, `transcript` and the rest.
   Every kind gets Galley's per-kind typography and tool strip, and themes can restyle each one.
   [03-kinds-and-the-look.md](03-kinds-and-the-look.md)
3. **It does not track agents or tag files.** No session or model metadata, live dots, agent
   write-locks, "agent finished" notifications, confidence percentages or token counts. AI sessions
   are read where they land, in folders the reader declares, and can be captured into a folder the
   reader owns. No model calls are built in. [04-capture.md](04-capture.md)

The full surface-by-surface verdict, with the strip list of removed metadata, is in
[01-galley-keep-knead-leave.md](01-galley-keep-knead-leave.md). The mockup is in `mock-v2/`, an
adaptation of Galley's own prototype with these three changes applied.

## Where Marxy is

Marxy has the harder half of Galley already, and a better engine than Galley sketches:

- byte-provenance parsing, so every block maps to its exact source bytes;
- owned line breaking and a baseline grid with no drift;
- the measure computed from each face's average character width;
- Source in CodeMirror, with the split view (Phase D) landing now;
- the palette, with recents, pins and "Changed since you read";
- declared collections with indexing, watching and worktree folding;
- the copy pack, the verb menu, and edits as pure text functions with one undo step;
- live reload that keeps your place.

What the reader sees is much less than that: one theme, one face, no workspace, no library, no
inspector, and a single treatment (CodeMirror) for every file that is not Markdown. The gap is
mostly surfaces, plus a handful of decisions that currently forbid them.

| Galley area | Marxy today | Gap |
| --- | --- | --- |
| Themes, tokens, type sets, contrast audit | One theme | Small (Phase H) |
| Workspace: sidebar, tabs, toolbar, inspector, status bar | None, by ADR-0050 and ADR-0011 | ADR reversals, then medium (Phase W) |
| Content kinds with detection and per-kind typography | Markdown or Source | Medium (Phase K) |
| Library: collections, tree, query, preview | Index and watch, no view; brief excludes "library browsing" | Ruling, then large (Phase Q) |
| Source: structure panel, table tools, replace with preview, problems | Plain CodeMirror; Phase E adds some | Medium (Phase V) |
| Versions and diff | Phase E-16, E-17 planned | Small (Phase V) |
| Settings surface | `config.toml` only | Medium (Phase W) |
| Clipboard | Copy pack only | Copy as, paste, Transform: core (ADR-0065, Phase J); the studio needs a design first (J-D1) |
| AI summaries, macOS extensions | None | Later; not in this direction |

## What the author decided (2026-10-10)

All five questions are answered, and clipboard-facing features are core; the table is in
[06-reconciliation.md](06-reconciliation.md#the-rulings). ADR-0058 (workspace), ADR-0062 (library),
ADR-0063 (capture) and ADR-0065 (clipboard) are accepted.

## Documents

| File | What it holds |
| --- | --- |
| [01-galley-keep-knead-leave.md](01-galley-keep-knead-leave.md) | Galley surface by surface, and the strip list |
| [02-fold-up-workspace.md](02-fold-up-workspace.md) | Folded and unfolded; peeking; each panel; the library and settings |
| [03-kinds-and-the-look.md](03-kinds-and-the-look.md) | Kinds and profiles; token contract v2; themes as a playground |
| [04-capture.md](04-capture.md) | Reading AI sessions in place; live files without agents; capture rules |
| [05-plan.md](05-plan.md) | The ADRs, phases H, W, K, J, Q, V and P, order and milestones |
| [06-reconciliation.md](06-reconciliation.md) | The rulings; where mock-v2 overrides these pages; where the commitments override mock-v2; how Phase E is redistributed |
| [galley/](galley/README.md) | Reference copies of Galley's tokens, typography spec and contrast audit |
| `mock-v2/` | The mockup: Galley's prototype adapted to this direction |
