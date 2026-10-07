# 14 — Roadmap proposal

**Date:** 2026-10-01 · **Author:** the audit lead · **Inputs:** every other document in this
directory; `docs/plan.md` and `docs/roadmap.md` as the plan being replaced.

**Abstract.** The current plan has five phases to a v1 that is "a markdown reader" with Linux
parity, run by a fleet. This proposal re-sequences toward the restated spirit (free, beautiful,
minimal software to manage AI output; reader before writer, adept at both; the user owns their
data and tools), for one person with ad-hoc agents, in five short phases that each end with
something on screen. It replaces `docs/plan.md` phases 2 to 4 and the first horizon of
`docs/roadmap.md`; it keeps phase 0 and phase 1 as done. Estimates are for ordering, not promises,
and assume the author's time plus agents; a phase is done when its screen criterion is met, never
on a date.

## 0. What is already there

Phase 0 (foundations and gates) and phase 1 (the page) are done in substance: the page is
typeset to the research (`fixtures/baselines/webkit-macos/*.png` show it), goldens, fidelity,
sanitiser, licences and boundaries gate every PR, and the build is green. Of `docs/scope.md`'s
v1, 17 items are reachable, 4 built but unwired, 5 partial, 5 missing (`01-codebase-audit.md`
§1.4). There has never been a tagged release.

## Phase A — Pause, prune, wire (≈ 1–2 weeks)

**Ends with:** the fleet paused, the PR path pruned, v0.1.0 tagged and installable on macOS,
unsigned; everything that is built is reachable.

- `orchestration/PAUSED.md`; orchestrator tests off the product PR path; `check-story --strict`
  and `check-pr` out of CI; the Jira mirror stopped (`13-recommendation-orchestrator.md` §3).
- The pruned CI from `04-tests-and-gates.md`: product gates on every PR, visual comparison and
  Linux and perf to nightly.
- The ADR amendments in `10-overfit-decisions.md` §5 recorded as proposed, so later phases do not
  argue them again: remote content as a setting (0044), contracts by PR (0045), Linux as a
  release criterion (0046), visual comparison nightly (0047), Source for one block (0048),
  user-defined operations recorded (0049), "at rest" defined (0050), the fleet paused (0051);
  ADR-0037 accepted with the per-document amendment.
- Wire what is built: palette lists every command, light variant and text size from config,
  outline, open in external editor, drag to open (`12-recommendation-codebase.md` step 3).
- Fix the index ownership defects (step 1).
- Tag v0.1.0 from `main`. The release workflow runs; the DMG is unsigned; `xattr` it and open a
  README.

**Screen criterion:** launch from the Dock, open two files in two repositories, search finds both;
toggle light; summon the outline.

## Phase B — The shell refactor (≈ 2–3 weeks)

**Ends with:** v0.2.0; nothing new on screen, everything the same, and the code ready for two
documents.

- The N-document store and per-article view (step 2). `app.ts` under 300 lines.
- Delete the dead and parallel code (step 4); retire the parallel render path (step 5); unfreeze
  the contracts and make `Shell` real (step 6).
- Resolve the three half-features (step 7): remote images as a setting, the weight table, the
  typesetter switch.
- `--marxy-room` container-relative (the split's one theme prerequisite).
- The two large-document levers from `05-performance-audit.md` §11: the grid pass as one read
  pass and one write pass (today a quadratic write-then-read loop, 2.2 s of a 4–5 s first text at
  1 MB), and first text from the first two screens of blocks with the rest appended in idle time.
  Agent transcripts and logs routinely exceed 1 MB; today Marxy falls over between 256 KB and 1 MB.

**Screen criterion:** a 1 MB transcript shows its first screen in well under a second (today 4–5 s); otherwise nothing visible changes, by design, and the gates and the desktop suite prove nothing moved.
The undo-after-failed-save and undo-after-Source defects from ADR-0037 are fixed and tested.

## Phase C — Manage: collections and copy (≈ 3 weeks)

**Ends with:** v0.3.0, the first release that does something no other reader does.

- `collection.toml`: declared folders, watched or not; the palette's default scope; twelve recent
  roots kept (`06-feature-collection-and-search.md`).
- The empty state: Pinned, then **Changed since you read** (mtime newer than last-read), then
  Recent, each with a relative age.
- The copy and extract pack (`08-feature-text-operations.md`): copy as plain text, as rich HTML,
  as markdown; table as TSV, CSV, JSON; copy command from a shell fence; all code blocks; all
  unchecked tasks; all links. An explicit default verb per selection kind replaces the
  first-`copy-` prefix pick.
- The verb menu as the one click surface: right-click, context-menu key, Enter on a selection;
  drawn from the registry; at most seven rows; themed.
- Content search on demand (`/` prefix, ripgrep-style scan over the collection).

**Screen criterion:** a reader with three agent output folders in the collection opens Marxy,
sees what changed since they last read, jumps to one, right-clicks a table and pastes it into a
spreadsheet.

## Phase D — Cross-reference: the split (≈ 3 weeks)

**Ends with:** v0.4.0.

- Two columns, binary only, in one window (`07-feature-split-view.md`): "open in split" and
  "split with recent" from the palette; focus movement by key; hairline divider; independent
  scroll by default; a link followed into the neighbour; the same file twice at two positions;
  Source or Rendered per pane; layout restored on launch; refuse a second pane under 929 px.
- Find and outline bind to the focused pane (they were re-scoped in phase A to take a view).

**Screen criterion:** a plan and its result side by side, a README beside the source it
documents, a link clicked in one lands in the other.

## Phase E — Adept at both (≈ 3 weeks)

**Ends with:** v0.5.0, the restated spirit on screen.

- Edit one block in Source (ADR-0048): select a block, press the edit key, CodeMirror opens on its
  byte range in place, leaving splices it back through the transformation path.
- Transform operations: toggle task reachable by pointer, align table, promote and demote,
  renumber, sort, unwrap an LLM's `markdown`-fenced whole document, pretty-print JSON and YAML in
  fences, strip markdown. Each a pure function with the fidelity property and a minimal-diff
  property, CRLF rows in every table.
- Paste in Rendered opens the clipboard as an untitled scratch document (HTML sanitised, then
  converted to markdown), writing nothing until Save As.
- Diff of two versions of a regenerated file as its own feature, not a split.

**Screen criterion:** paste an assistant's answer, unwrap its fence, tick its tasks, fix one
paragraph in place, save; the bytes outside what was touched are identical.

## After E — the second horizon

In the order a reader would notice, each a release of its own, none scheduled:

1. A signed, notarized macOS release and a verified Linux release (ADR-0046), once an Apple
   account and a Linux desktop exist.
2. User-defined operations as configuration (ADR-0049): a command that receives the selected
   bytes on stdin.
3. Read-only spine (a `SUMMARY.md` read as one document), cheap on provenance.
4. The hardened mode: the Rust fetcher of ADR-0027 behind `hardened = true`.
5. A resumed fleet pilot, when the five conditions in `13-recommendation-orchestrator.md` §4
   hold; the orchestrator extracted to its own repository after the pilot succeeds.
6. Windows; Mermaid on the first substantial request; export and PDF as the typesetter's second
   target.

## What this drops from the old plan

| Old item | Where it goes |
| --- | --- |
| Linux at parity from the first release; Flatpak | After E, when verifiable |
| Per-host remote-image consent; the Rust fetcher as the default path | A setting (0044); fetcher to hardened mode |
| Screenshot baselines on every PR; rag baselines per engine | Nightly |
| Phase-end taste reviews with a queue | The author opens the app; the queue is notes |
| The planner, deltas, task cards, board rows | Paused with the fleet |
| "At most four new operations per release" | A per-selection verb limit (`08`, §9) |
| The byte-frozen contracts | Contracts by PR (0045) |

## Numbers worth watching

Cold start and typeset viewport from `05-performance-audit.md`, printed by one `pnpm perf`
script and recorded nightly; palette keystroke p95 at the collection's real size; lines in
`app.ts` (down); product share of commits (up); days since last tag (down). Nothing about users.
