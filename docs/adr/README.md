# Architecture decision records

One short record per decision that constrains implementation, starting from the decisions made
at handoff. Append-only: to change one, add a new ADR that supersedes it.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-reader-not-editor.md) | Marxy is a reader, not an editor with a preview | accepted, amended by 0052 |
| [0002](0002-webview-shell.md) | A webview shell; native toolkits are out | accepted |
| [0003](0003-one-buffer-one-ast.md) | One buffer, one AST with byte provenance, two layout paths | accepted |
| [0004](0004-editing-is-transformation.md) | Editing is transformation over byte ranges; no plugin or scripting API | accepted, amended by 0049 and 0052 |
| [0005](0005-two-modes.md) | Two view modes: Rendered (default) and Source | accepted |
| [0006](0006-mit-and-licence-hygiene.md) | MIT for the whole tree; OFL fonts isolated; grammar and pattern allow-lists | accepted |
| [0007](0007-own-line-breaking.md) | Own paragraph line breaking (Knuth–Plass) as the demonstrable differentiator | accepted, amended by 0052 |
| [0008](0008-themes-are-declarative-documents.md) | Themes are declarative CSS documents under a system-owned typography contract | accepted |
| [0009](0009-security-posture.md) | Always sanitise; block remote content; no telemetry; strict CSP | accepted, amended by 0044 and 0052 |
| [0010](0010-stack-tauri.md) | Tauri, decided by a pre-committed rule; privileged work behind `shell-api` | accepted |
| [0011](0011-palette-not-tabs.md) | The palette is the tab manager; no tab bar | accepted, with a reversal criterion |
| [0012](0012-index-root-and-search-scope.md) | The indexed root is the enclosing repository; search covers titles, headings and paths | accepted |
| [0013](0013-speed-budgets-are-gates.md) | Speed budgets are CI gates; single-instance always; resident mode opt-in | accepted |
| [0014](0014-aesthetics-acceptance.md) | "Aesthetics paramount" has a two-tier acceptance test | accepted |
| [0015](0015-typeface.md) | Literata and JetBrains Mono, confirmed by the first taste review | accepted 2026-09-19; the pair confirmed and its "68 `ch` stays" superseded by 0033 |
| [0016](0016-verification-split.md) | Machine gates for everything checkable; a scheduled taste-review queue for the rest | accepted |
| [0017](0017-trunk-based-agent-workflow.md) | Trunk-based, one issue one branch one PR, CODEOWNERS for the sensitive paths | accepted, amended by 0028 (the CODEOWNERS list) |
| [0018](0018-reading-position-coordinate.md) | Reading position is a source-map coordinate, never a scroll offset | accepted |
| [0019](0019-scope-v1.md) | The v1 cut | accepted |
| [0020](0020-core-is-shell-free.md) | `packages/core` and `packages/typeset` never depend on the desktop shell | accepted |
| [0021](0021-parser-mdast-micromark.md) | The parser is mdast/micromark, not markdown-it | accepted |
| [0022](0022-perf-budgets-two-tier-enforcement.md) | Product budgets on reference hardware; CI enforces an envelope and a baseline | accepted, amended (1: the metric split; 2: no product cold-start ceiling; 3: cross-run CI numbers; 4: timing numbers are recorded, not CI failures, ADR-0032) |
| [0023](0023-provenance-in-the-dom.md) | Byte provenance rides into the DOM on attributes a document cannot forge | accepted (MARXY-75) |
| [0024](0024-dark-is-primary.md) | Dark is the primary variant; light is designed second | accepted |
| [0025](0025-review-order-and-review-wip.md) | Review order and a WIP limit on review | accepted, amended by 0034 (§1: review load no longer holds dispatch; §5: sign whenever not in conflict) |
| [0026](0026-shell-api-v1-surface.md) | The shell-api surface for v1, amended once | accepted 2026-09-22 (MARXY-94) |
| [0027](0027-remote-content-through-the-shell.md) | Remote images reach the page through the shell, only on consent; the webview never touches the network | proposed (MARXY-97, MARXY-45) |
| [0028](0028-codeowners-is-a-floor.md) | CODEOWNERS is a security floor, not a taste gate | proposed |
| [0029](0029-no-product-cold-start-ceiling.md) | There is no product cold-start ceiling | accepted |
| [0030](0030-grid-unit-is-half-a-line.md) | The grid unit is half the body line box | accepted, amended (1: a table is an island the grid pass pads, 2026-09-19) |
| [0031](0031-token-values-are-taste.md) | The token contract is names and units; the default theme's values are taste | accepted 2026-09-19 |
| [0032](0032-speed-numbers-are-recorded.md) | Speed numbers are recorded; they are not CI failures | accepted 2026-09-20 |
| [0033](0033-typography-follows-the-research.md) | Typography follows the reader-typography research | accepted 2026-09-23 |
| [0034](0034-the-fleet-is-a-reconciler.md) | The fleet is a reconciler: every state has an owner and a way out | proposed |
| [0035](0035-artifact-presentation-follows-the-research.md) | Artifact presentation follows the reader-artifacts research; where two handbooks meet, the owner of the property decides | accepted 2026-09-26 |
| [0036](0036-artifact-units.md) | Artifact units: what the renderer keeps, reports, marks and copies (the handbook's 17 drafts: 8 adopted, 2 declined, 3 deferred, 4 need no decision) | accepted 2026-09-26 |
| [0037](0037-one-document-store.md) | One document store: the open document has one owner, and changes are transitions | proposed (MARXY-248); amendment 1 (audit 2026-10) accepted for implementation in Phase B |
| [0038](0038-window-controls.md) | Window controls hide at rest through the shell | accepted (MARXY-268) |
| [0039](0039-shell-stub-dedup.md) | One shared implementation for shell-api compile-time stub shells | accepted (MARXY-285) |
| [0040](0040-land-without-up-to-date.md) | Land green pull requests without bringing them up to date first; a main-red guard replaces strict branch protection | accepted by the repo owner's instruction on 2026-09-28 (MARXY-314) |
| [0041](0041-shell-close-confirmation.md) | The frozen `Shell` gains `onCloseRequested` and `confirmClose` | accepted 2026-09-28 (MARXY-49) |
| [0042](0042-plan-rows-per-story.md) | One plan file per story (`docs/plan/stories/KEY.json`) and one `epics.json` instead of the shared CSV and `deps.json` | accepted by the repo owner on 2026-09-29 (MARXY-327) |
| [0043](0043-revert-first.md) | When main turns red, revert the first red commit and reopen its story with the work kept; amends ADR-0040 | proposed (MARXY-335) |
| [0044](0044-remote-content-is-a-reader-setting.md) | Remote content is a reader setting: `remote_images` and `html` are three-value config, one notice per document, the Rust fetcher only under `hardened`; supersedes 0027's default path | accepted (author, 2026-10-02) |
| [0045](0045-contracts-change-by-pull-request.md) | Contracts change by pull request; `test:contracts-frozen` is deleted and the invariants stay as tests | accepted (author, 2026-10-02) |
| [0046](0046-linux-is-a-release-criterion.md) | Linux is a release criterion, not a pull-request gate; it builds in CI and ships as a pre-release | accepted (author, 2026-10-02) |
| [0047](0047-visual-comparison-is-nightly.md) | Visual comparison is nightly; the mechanical typography checks stay on pull requests; amends 0014 tier 1 and 0016 | accepted (author, 2026-10-02) |
| [0048](0048-source-for-one-block.md) | Source may be summoned for one block and splices back through the transformation path; amends 0005 | accepted (author, 2026-10-02) |
| [0049](0049-user-defined-operations-are-configuration.md) | User-defined operations are configuration, not plugins; recorded, not scheduled; amends 0004 | accepted (author, 2026-10-02); scheduled by 0052 |
| [0050](0050-at-rest-defined.md) | "At rest" is defined: the column of text; summoned surfaces may be any shape; amends 0011 and design constraint 6 | accepted (author, 2026-10-02) |
| [0051](0051-the-fleet-is-paused.md) | The fleet is paused and the process it needs is paused with it; suspends 0017, 0025, 0034, 0040 and 0043's mechanisms | accepted (author, 2026-10-02) |
| [0052](0052-the-restated-spirit.md) | The spirit: a reader for source of any kind; seven values that harden into five commitments | accepted (author, 2026-10-07) |
| [0053](0053-collection-roots.md) | Collection roots: a reader-owned `collection.toml` of folders, searched from the palette and never browsed; scan on demand, no persistent index; amends 0012 | proposed |
| [0054](0054-verb-menu-and-default-verbs.md) | One verb menu is the click surface; at most seven verbs per selection; `Mod+C` runs a default copy verb and never a splice; amends 0019's cap | proposed |
| [0055](0055-find-edge-token.md) | `--marxy-color-find-edge`: a find match carries a 2 px edge in a token, because a pale fill cannot be 3:1; amends 0024 | proposed |
| [0057](0057-two-column-split.md) | Two documents side by side: at most two columns in one window, no tree and no OS windows, independent scroll, `#doc` the first pane; amends 0005 and 0011 | proposed (D-01) |
| [0058](0058-the-fold-up-workspace.md) | The fold-up workspace: at rest is the folded window; unfolded, sidebar, tabs, toolbar, inspector and status bar may persist; windows open folded; reverses 0050 item 4 and 0011 inside the workspace | accepted (author, 2026-10-10) |
| 0059 | Token contract v2 (reserved for H-01) | — |
| 0060 | Kinds (reserved for K-01) | — |
| 0061 | Derived views (reserved for K-02) | — |
| [0062](0062-the-library.md) | The library: the collection can be browsed in a sidebar tree and a library view, with saved queries; amends 0053 and 0012 | accepted (author, 2026-10-10) |
| [0063](0063-capture-rules.md) | Capture rules: a standing, declared request to copy files byte-exact into a reader folder | accepted (author, 2026-10-10) |
| 0064 | File metadata capabilities in `shell-api` (reserved for W-18) | — |
| [0065](0065-the-clipboard.md) | The clipboard is essential: Copy as targets, multi-format writes, paste, Transform; clipboard read on reader action only; the studio waits for a design; amends 0026 and 0054 | accepted (author, 2026-10-10) |
