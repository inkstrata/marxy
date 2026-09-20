# Architecture decision records

One short record per decision that constrains implementation. Seeded from the brainstorm's
decision log (D1–D18, `~/Dev/marxy-brainstorm/docs/01-decision-log.md`) and extended with
the decisions made at handoff. Append-only: to change one, add a new ADR that supersedes it.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-reader-not-editor.md) | marxy is a reader, not an editor with a preview | accepted |
| [0002](0002-webview-shell.md) | A webview shell; native toolkits are out | accepted |
| [0003](0003-one-buffer-one-ast.md) | One buffer, one AST with byte provenance, two layout paths | accepted |
| [0004](0004-editing-is-transformation.md) | Editing is transformation over byte ranges; no plugin or scripting API | accepted |
| [0005](0005-two-modes.md) | Two view modes: Rendered (default) and Source | accepted |
| [0006](0006-mit-and-licence-hygiene.md) | MIT for the whole tree; OFL fonts isolated; grammar and pattern allow-lists | accepted |
| [0007](0007-own-line-breaking.md) | Own paragraph line breaking (Knuth–Plass) as the demonstrable differentiator | accepted |
| [0008](0008-themes-are-declarative-documents.md) | Themes are declarative CSS documents under a system-owned typography contract | accepted |
| [0009](0009-security-posture.md) | Always sanitise; block remote content; no telemetry; strict CSP | accepted |
| [0010](0010-stack-tauri.md) | Tauri, decided by a pre-committed rule; privileged work behind `shell-api` | accepted |
| [0011](0011-palette-not-tabs.md) | The palette is the tab manager; no tab bar | accepted, with a reversal criterion |
| [0012](0012-index-root-and-search-scope.md) | The indexed root is the enclosing repository; search covers titles, headings and paths | accepted |
| [0013](0013-speed-budgets-are-gates.md) | Speed budgets are CI gates; single-instance always; resident mode opt-in | accepted |
| [0014](0014-aesthetics-acceptance.md) | "Aesthetics paramount" has a two-tier acceptance test | accepted |
| [0015](0015-typeface.md) | Literata and JetBrains Mono, confirmed by the first taste review | accepted 2026-09-19 |
| [0016](0016-verification-split.md) | Machine gates for everything checkable; a scheduled taste-review queue for the rest | accepted |
| [0017](0017-trunk-based-agent-workflow.md) | Trunk-based, one issue one branch one PR, CODEOWNERS for the sensitive paths | accepted, amended by 0028 (the CODEOWNERS list) |
| [0018](0018-reading-position-coordinate.md) | Reading position is a source-map coordinate, never a scroll offset | accepted |
| [0019](0019-scope-v1.md) | The v1 cut | accepted |
| [0020](0020-core-is-shell-free.md) | `packages/core` and `packages/typeset` never depend on the desktop shell | accepted |
| [0021](0021-parser-mdast-micromark.md) | The parser is mdast/micromark, not markdown-it | accepted |
| [0022](0022-perf-budgets-two-tier-enforcement.md) | Product budgets on reference hardware; CI enforces an envelope and a baseline | accepted, amended (1: the metric split; 2: no product cold-start ceiling; 3: cross-run CI numbers; 4: timing numbers are recorded, not CI failures, ADR-0032) |
| [0023](0023-provenance-in-the-dom.md) | Byte provenance rides into the DOM on attributes a document cannot forge | accepted (MARXY-75) |
| [0024](0024-dark-is-primary.md) | Dark is the primary variant; light is designed second | accepted |
| [0025](0025-review-order-and-review-wip.md) | Review order and a WIP limit on review | accepted |
| [0026](0026-shell-api-v1-surface.md) | The shell-api surface for v1, amended once | proposed (MARXY-94) |
| [0027](0027-remote-content-through-the-shell.md) | Remote images reach the page through the shell, only on consent; the webview never touches the network | proposed (MARXY-97, MARXY-45) |
| [0028](0028-codeowners-is-a-floor.md) | CODEOWNERS is a security floor, not a taste gate | proposed |
| [0029](0029-no-product-cold-start-ceiling.md) | There is no product cold-start ceiling | accepted |
| [0030](0030-grid-unit-is-half-a-line.md) | The grid unit is half the body line box | accepted, amended (1: a table is an island the grid pass pads, 2026-09-19) |
| [0031](0031-token-values-are-taste.md) | The token contract is names and units; the default theme's values are taste | accepted 2026-09-19 |
| [0032](0032-speed-numbers-are-recorded.md) | Speed numbers are recorded; they are not CI failures | accepted 2026-09-20 |
