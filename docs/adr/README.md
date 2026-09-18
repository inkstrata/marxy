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
| [0015](0015-typeface.md) | Literata and JetBrains Mono, confirmed by the first taste review | proposed until review #0 |
| [0016](0016-verification-split.md) | Machine gates for everything checkable; a scheduled taste-review queue for the rest | accepted |
| [0017](0017-trunk-based-agent-workflow.md) | Trunk-based, one issue one branch one PR, CODEOWNERS for the sensitive paths | accepted |
| [0018](0018-reading-position-coordinate.md) | Reading position is a source-map coordinate, never a scroll offset | accepted |
| [0019](0019-scope-v1.md) | The v1 cut | accepted |
| [0020](0020-core-is-shell-free.md) | `packages/core` and `packages/typeset` never depend on the desktop shell | accepted |
