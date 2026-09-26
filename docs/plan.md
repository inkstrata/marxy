# Implementation plan

Five phases. Each ends in something runnable and reviewable, and each ends with a scheduled
taste review. Risky and load-bearing work comes first: the typography path and the Linux
question before the index, and the index before operations, which are easy and endlessly
extensible. Stories with acceptance criteria are in `plan/jira-issues.csv`; this document is
the shape.

Estimates assume an agent fleet with one human reviewing; they are for ordering, not promises.

## Phase 0 — Foundations and a release (≈ 2 weeks)

**Ends with:** v0.0.1 installs on macOS and Linux, opens a markdown file passed on the command
line, renders it unstyled, and every CI gate exists (some as skeletons that pass trivially).
Taste review #0 chooses the typeface pair.

- Contracts frozen: AST + source map, operation, shell-api, theme tokens, index entry,
  reading position (`packages/*/src/contracts`). ADR needed to change.
- Corpus committed (`fixtures/corpus`) and golden files generated from the parser.
- `packages/core`: parser (mdast/micromark, CommonMark + GFM — ADR-0021) producing the AST with byte
  provenance; sanitiser; outline. Passes the CommonMark spec suite. Runs in Node.
- `apps/desktop`: Tauri shell implementing `shell-api` (read, atomic write, watch, dialogs,
  clipboard, single-instance). Loads the frontend; renders the AST to HTML with no theme.
- CI: build/typecheck/lint/test; golden files; licence audit (real); no-network gate (real,
  over the corpus in Playwright); byte-fidelity property (real, over open→save); perf gate
  reading budgets (cold start measured on the packaged app on both runners); bundle gate;
  screenshot diff and aesthetics gate wired with empty baselines.
- Release workflow: tag → macOS DMG (signing and notarization steps gated on secrets) and
  Linux AppImage; publish as pre-release. Branch protection and CODEOWNERS on.
- Taste review #0 artifact: the long corpus document set in Literata + JetBrains Mono and in
  Source Serif 4 + IBM Plex Mono, at the type scale, exported as PNG at 1× and 2×.

## The ops lane — beside the phases, never in front of them

Process, gate, CI and release work lives in the `ops` lane of `orchestration/deps.json`, not in a
numbered phase (MARXY-107). An ops story still waits on its own dependencies, but it is never held
by a phase and never holds one, and when an ops story and a phase story want the same path, the
phase story gets it. A phase story that is ready, or waits only on work already under way, reserves
its paths against ops, so an ops story that overlaps them waits even while the phase story is held
back by something else (MARXY-170). The loop may improve itself, but never at the cost of the page.

## Phase 1 — The page (≈ 4 weeks)

**Ends with:** v0.1 "reads a README beautifully". Rendered mode passes tier 1; taste review #1
is the first blind side-by-side.

- `packages/theme`: tokens, the default theme built as a theme, dark primary (ADR-0024); grid
  enforcement (all vertical spacing from `--marxy-line-box`); type scale.
- Bundled fonts with `@font-face`, `font-display`, preload; fonts on the critical path,
  everything else deferred; `--marxy-weight-offset` on Linux with a measured value.
- **Weight harness on a real Linux desktop** (the spike specimen + analyser moved into
  `scripts/`), run on GNOME at 1× and 2×; value recorded in ADR-0010's follow-up.
- `packages/typeset`: ragged-right Knuth–Plass through `justif/core` on paragraphs, list
  items and quotes; hanging punctuation and protrusion; allow-listed hyphenation; viewport
  first then background; re-layout triggers. Story includes the fallback decision.
- Images with reserved dimensions from the file's intrinsic size (via shell-api), remote
  blocked with the notice; code blocks highlighted at parse time from the grammar allow-list,
  hanging-indent wrap, copy clean; KaTeX lazy, on the grid.
- Smart typography render pass. Tier 1 aesthetics gate turned on with real baselines.
- Screenshot baselines committed for WebKit (Playwright) and WebKitGTK.

## Phase 2 — The opener (≈ 3 weeks)

**Ends with:** v0.2 opens under budget, watches, switches instantly, and has Source mode.
Taste review #2 includes the palette-vs-tabs criterion.

- Cold-start work against the gate: measured waterfall, lazy grammars and KaTeX, index off
  the critical path, position restore before first paint.
- Watching with position preserved; atomic-replace, delete and move tests.
- Index (Rust `ignore`) and matcher (`nucleo`) behind shell-api; root rule; deny list;
  ceiling; persistence and invalidation.
- Palette: MRU with no query, fuzzy over path/title/headings, heading jump, pinning, back and
  forward, keystroke budget.
- Source mode: CodeMirror 6, per-file-type default, mode switch preserving position, code
  viewer defaults (line numbers optional, large files).
- Reading position persistence per file.

## Phase 3 — Operations, safety, themes (≈ 3 weeks)

**Ends with:** v0.3 feature-complete for v1. Taste review #3 covers the light variant and the opt-in notices.

- Selection model in Rendered mode: span, block, section, document; resolves to byte ranges.
- The four operations with table-driven tests and the fidelity property over the corpus.
- Sanitiser allow-list opt-in with the discoverable notice; remote-image opt-in; CSP final.
- Light variant, designed not inverted (dark is primary, ADR-0024). User theme loading (`theme.toml` + `theme.css`) with
  contract version check and re-layout on change; a theme opens in Source mode.
- Outline; find landing at reading position in Rendered mode; keyboard completeness audit;
  "open in external editor"; save (explicit, byte-faithful, atomic).

## Phase 4 — Ship (≈ 2 weeks)

**Ends with:** v1.0 on both platforms. Tier 2 passed on a Linux laptop and a Mac.

- The taste-review backlog from phases 1–3, in priority order.
- Signed, notarized DMG; AppImage and Flatpak; `THIRD_PARTY_NOTICES.md`; about surface with
  attributions; README with the promises stated.
- Perf and bundle budgets tightened to the measured values minus headroom.

## After v1 (backlog, not planned)

Content search; the operations catalogue; theme linter; Mermaid; settings UI; read-only
spine; Windows; export.

## How the loop runs

plan → stories with executable acceptance criteria and listed paths → implement in parallel
where paths do not overlap → machine gates → PR with why, ADRs, artifacts → merge → queue
entry → phase-end taste review → ADRs and `AGENTS.md` updated. Context loss is handled by the
repo being the memory; drift by screenshot diffs and constraints-as-gates.

The board spec (`docs/plan/jira-issues.csv`, `orchestration/deps.json`, task cards, deltas) changes
only through a pull request, and the fleet reads it from `origin/main` only. The fleet's own record
of what is under way is an event log beside the git objects, shared by every worktree and never
tracked; Jira is pushed from it for people to read (ADR-0034).
