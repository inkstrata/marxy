# 06 — Story index

**Date:** 2026-10-02. Every story of the five phase documents on one page, generated from their `###` headings and `Model` lines; the phase documents are the source of truth. Waves are the ones each phase document proposes; the lead runs at most four agents at once, at most two on Opus (`00-orchestration.md` §5).

## Phase A — performance lane, pause, prune, wire (17 stories; `01-phase-a.md`)

| Id | Title | Model | Size | Depends on |
| --- | --- | --- | --- | --- |
| A-01 | Put the grid pass in one read and one write per round, and commit the large-document harness | opus | M | A-07 |
| A-02 | Put first text on screen after the first screens and append the rest in idle chunks | opus | L | A-01, A-04 |
| A-03 | Measure nightly, not on pull requests, and delete the product tier | opus | L | A-01, A-08 |
| A-04 | Give the index an owner: one index per root, published to the palette | opus | M | A-07 |
| A-05 | Walk a root in fewer shell calls, from a snapshot | sonnet | M | A-04 |
| A-06 | Make the palette's ranking fields honest | sonnet | M | A-04, A-12 |
| A-07 | Pause the fleet and unlock the conventions job | sonnet | S | — |
| A-08 | Make one `pnpm check`, and delete the checks of CI's own shape | sonnet | M | A-07 |
| A-09 | Path-filter the Rust and typography jobs, move the dual-OS build to nightly, run only `fast` on `main` | opus | M | A-03, A-08 |
| A-10 | Run `browser-lite` on pull requests, and visual comparison and the full WebKit suites nightly | opus | M | A-06, A-09 |
| A-11 | Rewrite the CI contract and the process documents | sonnet | M | A-03, A-07, A-08, A-09, A-10 |
| A-12 | Make the palette list every command whose `when` holds | sonnet | M | A-07 |
| A-13 | Send `Mod+E`, back and forward through the registry | sonnet | M | A-02, A-06, A-12 |
| A-14 | Apply the light variant and text size from config, and change them by command | sonnet | M | A-04, A-12, A-13 |
| A-15 | Summon the outline | sonnet | M | A-12 |
| A-16 | Open the document in an external editor, and open a file by dragging it onto the window | opus | M | A-12 |
| A-17 | Make the release workflow complete on a tag, for v0.1.0 | sonnet | S | A-01 … A-16 |

Waves:

- Wave 0 — A-07 (pause the fleet and unlock the conventions job; lands first and alone)
- Wave 1 — A-01 grid pass + harness · A-04 one index per root · A-08 one `pnpm check` · A-12 palette lists every command
- Wave 2 — A-02 first text from the first screens · A-03 measure nightly, delete the product tier · A-05 snapshot and fewer shell calls · A-06 honest ranking fields
- Wave 3 — A-09 path filters, dual-OS build to nightly, only `fast` on main · A-13 `Mod+E` and history through the registry · A-15 outline · A-16 external editor and drag to open
- Wave 4 — A-10 `browser-lite` on PRs, visual comparison and full WebKit suites nightly · A-14 light variant and text size
- Wave 5 — A-11 rewrite the CI contract and process documents · A-17 release workflow and v0.1.0; then the author verifies and tags

## Phase B — the shell refactor (20 stories; `02-phase-b.md`)

| Id | Title | Model | Size | Depends on |
| --- | --- | --- | --- | --- |
| B-01 | Give the app harness a render entry the aesthetics gate can drive | opus | M | Phase A preconditions 4 and 5 |
| B-02 | Point the aesthetics gate at the app and delete the headless pipeline | opus | M | B-01, B-03 |
| B-03 | Make `--marxy-room` relative to the column's container | sonnet | S | — |
| B-04 | Build the document store as a module with its own tests | opus | M | Phase A precondition 2 |
| B-05 | Delete the dead and unreachable code | sonnet | M | Phase A precondition 3 |
| B-06 | Unfreeze the contracts | sonnet | S | ADR-0045 recorded (Phase A) |
| B-07 | Keep the Linux weight offset as one documented constant | sonnet | S | ADR-0046 recorded (Phase A) |
| B-08 | Lift start-up measurement out of `app.ts` | sonnet | M | B-01 |
| B-09 | Remove the per-host image grant | sonnet | M | B-08, ADR-0044 recorded |
| B-10 | Lift trust into a controller and merge the two re-render paths | opus | M | B-09 |
| B-11 | Move undo, the saved baseline and save into the store | opus | L | B-04, B-10 |
| B-12 | Make selection and commands read the store | opus | M | B-11 |
| B-13 | Lift the per-article view into `view/rendered-view.ts` | opus | L | B-12 |
| B-14 | Lift live reload and reading persistence out of `app.ts` | opus | M | B-13 |
| B-15 | Lift the open path; `app.ts` becomes the composition root | opus | M | B-14 |
| B-16 | Move test hooks into test-only entries | sonnet | M | B-15 |
| B-17 | Honour `typeset = false` and take justif's engine off the critical path | sonnet | S | B-15 |
| B-18 | Make `Shell` the interface the app programs to | opus | M | B-06, B-07, B-16 |
| B-19 | Replace deep imports with package exports; move `paths.ts` to `core/paths.ts` | sonnet | M | B-18 |
| B-20 | Load remote images by the `remote-images` setting (conditional) | opus | M | B-09, B-18, B-19, **and the author's ruling below** |

Waves:

- W1 — B-01 gate render entry + `typeset_done` mark · B-04 store module with tests · B-03 `--marxy-room` container-relative · B-05 dead-code deletions
- W2 — B-02 gate on the app, headless deleted, baselines regenerated · B-08 measurement out of `app.ts` · B-07 weight constant
- W3 — B-09 remove the per-host image grant · B-06 unfreeze contracts
- W4 — B-10 trust controller, one re-render path
- W5 — B-11 store wired in: undo, dirty, save; the ADR-0037 defects fixed (L)
- W6 — B-12 selection and commands read the store; no import cycles
- W7 — B-13 per-article `view/rendered-view.ts` (L)
- W8 — B-14 live reload and reading persistence out of `app.ts`
- W9 — B-15 open path out of `app.ts`; `app.ts` under 300 lines
- W10 — B-16 test hooks into test-only entries · B-17 `typeset = false`, justif engine path dropped
- W11 — B-18 `Shell` becomes the real interface
- W12 — B-19 package exports, `core/paths.ts`, boundary rule
- W13 — B-20 remote-images setting and loading, only after the author's ruling

## Phase C — collections and copy (17 stories; `03-phase-c.md`)

| Id | Title | Model | Size | Depends on |
| --- | --- | --- | --- | --- |
| C-01 | Record the collection and verb-surface decisions, and reserve the phase's names | sonnet | S | none |
| C-02 | Prepare the operation catalogue for three packs, and let toggle-task apply to a list item | sonnet | S | none |
| C-03 | Parse `collection.toml`, and append a folder to it without touching another byte | sonnet | S | none |
| C-04 | Keep the palette under 16 ms at 50,000 entries: filter the last result when the query grows, and patch rows instead of rebuilding | sonnet | M | none |
| C-05 | Watch a collection folder recursively, without rescanning the tree on every event | opus | M | Phase B's contract unfreeze (for one optional parameter on `Shell.watch`) |
| C-06 | Give every selection kind an explicit default verb, and copy a drag selection as rich text | opus | M | C-01 (merge order only: the test glob) |
| C-07 | Copy pack: plain text, rich text and exact markdown for any block or section | sonnet | S | C-02 |
| C-08 | Copy a table as TSV, CSV or JSON, ready for a spreadsheet | sonnet | S | C-02 |
| C-09 | Copy a shell command without its prompts; extract every code block, unchecked task and link | sonnet | M | C-02 |
| C-10 | Load `collection.toml` into the index: declared folders join the palette's scope | opus | M | C-03, C-04, Phase A's index service |
| C-11 | Keep the collection fresh: a watch event patches one entry, never the whole index | opus | M | C-05, C-10, C-04 |
| C-12 | The empty palette shows Pinned, Changed since you read, and Recent, each with its age | sonnet | M | C-10, C-04 |
| C-13 | One verb menu: right-click, the context-menu key, or Enter on a selection | opus | L | C-06 |
| C-14 | Two palette commands: Edit collection, and Add this folder | sonnet | S | C-03, C-10 |
| C-15 | Fold duplicate copies that come from worktrees of one repository | sonnet | M | C-10, C-11 |
| C-16 | Search the collection's file contents in one shell call | opus | M | C-05 (same shell files, serial), Phase B's contract unfreeze |
| C-17 | `/` in the palette searches file contents and lands at the match | sonnet | M | C-16, C-10, C-12 (`view.ts`, serial), C-13 (`selection/view.ts`, serial) |

Waves:

- Wave 0 — C-01 decisions, registry names, test glob (merge first) · C-02 operation-pack scaffolding, toggle-task · C-03 `collection.toml` parser · C-04 palette incremental filter · C-05 recursive tree watch in Rust · C-06 default-verb table and rich copy
- Wave 1 — copy lane C-07, C-08, C-09, C-13 (verb menu) · collection lane C-10, C-16
- Wave 2 — C-11 watch events patch one entry · C-12 empty state · C-14 edit collection, add this folder; screen criterion checkable
- Wave 3 — C-15 fold worktree duplicates · C-17 `/` content search lands at the match

## Phase D — the split (14 stories; `04-phase-d.md`)

| Id | Title | Model | Size | Depends on |
| --- | --- | --- | --- | --- |
| D-01 | Build the pane model and the DOM skeleton for two panes | opus | L | Phase B (P1 to P5) |
| D-02 | Write the layout geometry and the `layout.json` format | sonnet | S | nothing |
| D-03 | Write the pure half of Rendered find: the text index and the query compiler | sonnet | S | nothing |
| D-04 | Draw the hairline divider, add its theme tokens, and make it resizable | sonnet | M | D-01, D-02 |
| D-05 | Make each pane its own scroller, with its own reading position and anchor | opus | M | D-01 |
| D-06 | Move focus between panes by key and click, and bind selection to the focused pane | opus | L | D-01 |
| D-07 | Open beside from the palette, split with recent, and refuse a second pane that cannot fit | sonnet | M | D-01, D-02, D-05, D-06, D-08 |
| D-08 | Close a pane, and make save, the title and quit know about two documents | opus | M | D-01 |
| D-09 | Follow a link into the neighbour pane | sonnet | M | D-06, D-07, D-08 |
| D-10 | Show the same file twice, share one store and one watch, and keep notices in their own pane | opus | L | D-01, D-05, D-07 |
| D-11 | Let each pane be Rendered or Source | opus | M | D-01, D-05, D-06 |
| D-12 | Remember the layout and each pane's place, and restore them on launch | sonnet | M | D-02, D-06, D-07, D-11 |
| D-13 | Make Rendered find, and the outline, work on the focused pane | opus | L | D-03, D-05, D-06 |
| D-14 | Close the phase: the split in the aesthetics gate, the screen-criterion test and the cost bounds | sonnet | M | D-07, D-09, D-10, D-11, D-12, D-13 |

Waves:

- W1 — D-01 pane model and skeleton (L) · D-02 layout geometry and `layout.json` · D-03 pure find index and query
- W2 — D-04 divider and tokens · D-05 scroll per pane · D-06 focus and selection binding (L) · D-08 close pane and guards
- W3 — D-07 open beside, split with recent, narrow refusal · D-11 Source or Rendered per pane · D-13 find and outline on the focused pane (L)
- W4 — D-09 follow a link into the neighbour · D-10 same file twice, one watch per store (L) · D-12 persist and restore layout
- W5 — D-14 aesthetics gate split case, screen-criterion test, cost bounds

## Phase E — adept at both (18 stories; `05-phase-e.md`)

| Id | Title | Model | Size | Depends on |
| --- | --- | --- | --- | --- |
| E-01 | Build the transform helpers and the shared test kit | opus | M | — |
| E-02 | Reach `toggle-task` and `align-table-pipes` from the selections a reader makes | sonnet | S | — |
| E-03 | Build the pure core of block editing: the edit range and the slice fold | opus | S | — |
| E-04 | Edit one block in Source, in place | opus | L | E-03, Phase B (store), Phase A (ADR-0048) |
| E-05 | Select a run of blocks in Rendered mode; first span operation: dedupe lines | opus | L | E-02, E-01 (for the kit) |
| E-06 | Unwrap a `markdown`-fenced document | sonnet | S | E-01 |
| E-07 | Promote and demote headings | sonnet | S | E-01 |
| E-08 | Renumber a list, convert bullets and numbers, turn glyph bullets into a list | opus | M | E-01 |
| E-09 | Sort list items | opus | M | E-01 |
| E-10 | Pretty-print JSON and re-indent YAML inside fences | opus | M | E-01 |
| E-11 | Plain-text copy, and the guard that no operation strips markdown as a splice | sonnet | S | E-01, Phase C |
| E-12 | Spike: how does the clipboard's HTML reach Rendered mode? | sonnet | S | — |
| E-13 | Open a scratch (untitled) document that writes nothing until Save As | opus | M | Phase B |
| E-14 | Turn a clipboard payload into markdown | opus | M | — |
| E-15 | Paste in Rendered mode opens the clipboard as a scratch document | opus | M | E-12, E-13, E-14 |
| E-16 | Compute a line diff in core | opus | M | — |
| E-17 | Show what changed in a regenerated file | opus | M | E-13, E-16, Phase B |
| E-18 | Prove the screen criterion and sync the documents | opus | M | E-04 to E-11, E-15, E-17 |

Waves:

- W1 — E-01 helpers and test kit · E-02 reach for toggle-task and align-table · E-03 pure core of block editing · E-12 paste-delivery spike · E-13 scratch document · E-14 clipboard payload to markdown · E-16 line diff in core
- W2 — E-04 edit one block in Source · E-05 multi-block selection + dedupe · E-06 unwrap fence · E-07 promote/demote · E-08 renumber, bullets · E-09 sort · E-10 JSON/YAML · E-11 plain-text copy + strip guard
- W3 — E-15 paste opens a scratch document · E-17 show what changed
- W4 — E-18 phase-screen test and document sync

## Totals

| Stories | Opus | Sonnet | S | M | L |
| --- | --- | --- | --- | --- | --- |
| 86 | 44 | 42 | 20 | 55 | 11 |

Taking S as half a day, M as a day and a half and L as four days of one agent's work, the plan is roughly 136 agent-days, run up to four at a time within each wave; wall time is bounded by the serial waves of Phase B.

## Open questions for the author

Each phase document lists the questions its stories cannot settle. They are gathered here so the author can rule on them in one sitting; the plan assumes the answer in parentheses until told otherwise.

**Across phases**

1. Are the ten amendments in `docs/research/audit-2026-10/10-overfit-decisions.md` §5 accepted as proposed in ADR-0044 to ADR-0051 and the ADR-0037 amendment? (Yes; Phase A's second wave depends on it.)
2. Is a searchable list of folders, never browsed, consistent with the brief's "library browsing" exclusion (`docs/brief.md`)? (Yes; C-01 records the reading; the copy lane does not depend on it.)
3. Find in Rendered mode is a v1 item no earlier phase builds; Phase D builds it (D-03 pure, D-13 bound to the focused pane). (Accept that placement, or pull D-03 into Phase A.)

**Phase A**

4. Should the light/dark toggle be saved to `config.toml`? (Yes; a third config write beside `size` and `theme`.)
5. May the config be read before first text, a few milliseconds, to avoid a dark-to-light flash? (Yes.)
6. Is v0.1.0 macOS only (ADR-0046), or do the Linux AppImage and deb stay in `release.yml` as best effort? (Best effort, unverified.)
7. About 64 WebKit tests that have never run in CI start running nightly in A-10; if they fail on Linux WebKit, fix or delete? (Fix if under an hour each, else delete and note it.)
8. Should `loop.sh` refuse to start while `orchestration/PAUSED.md` exists? (A-07 only adds the file.)

**Phase B**

9. Remote-image loading (B-20): permanent `img-src https:` with the sanitiser as the one boundary, ADR-0044's widened CSP with a webview reload on consent, or park loading and ship only the blocked notice? And is the key `remote-images` or `remote_images` to match `line_numbers`? (ADR-0044's reload; `remote_images`.)
10. The Linux weight table (B-07): delete the version rows and keep a documented +100 constant, or implement `webkitVersion` in Rust? (Delete the rows.)
11. `setWindowControls` (B-18): delete the unbuilt member or keep it as a no-op? (Delete until built.)
12. Vendor `justif`'s hyphenation patterns once B-17 reports their licences? (Yes if MIT-compatible.)

**Phase D**

13. Does a plain click on a link open in the neighbour pane? (No; Cmd/Ctrl-click does; plain click replaces in place.)
14. A file launched while a layout is saved: restore the layout and put the file in the focused pane, or drop the layout? (Restore.)
15. May a link open a non-Markdown source file in Source beside? (Cmd-click only.)
16. Three taste calls, each behind one constant: focus moving on scroll-wheel; the dirty dot only for the focused document; the 150 ms accent fade on the divider. (As planned; revisit on the built app.)

**Phase E**

17. Is `Mod+Enter` the edit key (keeping `Enter` for the verb menu), and `Alt+Shift+Down` the multi-block extend key? (Yes.)
18. E-12 needs the author for a few minutes to press `Mod+V` in the running app; if no webview route delivers the clipboard, E-15 needs a Rust command and a new capability. (Approve the spike; decide the capability on its result.)
19. Does a scratch document the reader only read close without a prompt? (Yes; dirty only after an edit.)
20. Is the YAML re-indenter worth keeping, or ship JSON alone? (JSON alone unless the structure check is tight.)
21. "Show what changed": against the version before the last reload (built) or against what the reader last read (needs a persisted snapshot)? (Before the last reload.)
