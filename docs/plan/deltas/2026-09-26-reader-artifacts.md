# Plan delta — 2026-09-26, the Reader Artifacts Handbook filed

> A filing pass, not a periodic one. The Reader Artifacts Handbook (MARXY-211, merged at `2f27802`)
> left 25 draft stories and 17 draft ADRs. The author asked for them to be filed in **grouped** stories
> (overriding one-item-per-ticket, because of the corpus's size), with as few requests for human taste
> as the research allows, and with **no rows added to a closed phase**. This pass ran in
> `../marxy-wt/MARXY-228`, cut from `origin/main` by `out-of-plan.mjs start`. The orchestrator checkout
> and its `state.json` were read and never written. Landing key **MARXY-228**, with its own `no-dispatch`
> row. The open plan PRs MARXY-224 (#208) and MARXY-226 touch none of these files or stories.

## What this pass does

1. **Thirteen stories in Phase 3** (epic MARXY-40), none in Phase 0 or Phase 1. The handbook's own
   CSV parented nine drafts to MARXY-18 (Phase 1). Phase 1 is closed, and a `todo` row there would
   hold every Phase 2 and Phase 3 dispatch (`earlierPhaseOpen`). Phase 3 is where operations, safety
   and themes already live. Two are `cross-phase` because they fix reproduced defects against the
   commitments: the reserved-id bypass (security) and copy rewriting bytes (commitment 4).
2. **One ADR instead of seventeen.** [ADR-0036](../../adr/0036-artifact-units.md) (proposed) gives
   every draft one outcome: 8 adopted, 2 declined (P11 scroller, P16 Mermaid), 3 deferred to v1.1
   (P04, P09, P10), and 4 needing no decision (P12, P13, P15, P17). It removes the three front-matter
   tokens the draft wanted; the head reuses `--marxy-size-caption`. The contract change shrinks to four
   diff colours.
3. **One human gate.** MARXY-232 is `human-gated`. The author accepts ADR-0035 and ADR-0036 by
   removing the label, and the story is then a contract-only PR. Three stories wait on it directly
   (MARXY-233, MARXY-234, MARXY-235) and two more through MARXY-233 (MARXY-237, MARXY-238). The
   other seven do not, so the fleet has work while the author reads.
4. **Two edits to existing rows**, as the handbook asked ("extend the existing story"):
   - **MARXY-44** hands its reserved `marxy-` id clause to `MARXY-229` and depends on it.
     Its own card already expected a core story to own that vector.
   - **MARXY-45** takes the rest of P17: `unsafe-eval` and `base-uri` in the CSP check, a `read_file`
     root check, and a test that an unmanifested command is refused.
5. **A coverage ledger.** `docs/research/reader-artifacts/coverage.json` gives all 140 units of the
   handbook one disposition each: the 54 spec defaults, 14 operations, 7 coupling rules, 8
   verification checks, 17 drafts, 5 declined items, 10 taste items and 25 draft stories.
   `tools/check.mjs` fails on a missing or doubled unit, a key that is not a board row, or a card
   whose "Handbook units" line disagrees with the ledger. `tools/coverage.mjs` reports it against the
   live board, so "how much of the handbook is done" is a command, not a number written here.

## The stories

| Story | Groups (handbook drafts) | Depends on | Human |
| --- | --- | --- | --- |
| MARXY-229 reserved names (cross-phase) | reserved-id-bypass, registry-hygiene | — | CODEOWNERS review |
| MARXY-230 exact copy (cross-phase) | copy-exactness, copy-section-html | — | — |
| MARXY-231 source-map fidelity | task-marker-code-span, nested-source-map, fidelity-property | MARXY-230 | — |
| MARXY-232 ADRs and diff tokens | ADR-0035, ADR-0036, four diff tokens | — | **accept the ADRs** |
| MARXY-233 sanitiser policy | keep-xml-tag-content, removal records, details and hero/picture policy | MARXY-232, MARXY-229, MARXY-44 | CODEOWNERS review |
| MARXY-234 front matter, alerts | front-matter-head, alerts-label-first, diagram caption, TOML titles | MARXY-232 | queue row |
| MARXY-235 diff, console, log marks | diff-tint, console-and-ansi, log weight, long lines | MARXY-232, MARXY-241 | queue row |
| MARXY-236 hidden characters, link hosts | invisible-char-marker, link-mismatch-label | MARXY-229 | queue row |
| MARXY-237 README badges, details | badge-hero-picture, details-honoured (fold and Find) | MARXY-233, MARXY-48, MARXY-97 | queue row |
| MARXY-238 removal notice | removal-notice, blocked-image details | MARXY-233, MARXY-239, MARXY-44, MARXY-97 | queue row |
| MARXY-239 code in Source | source-gutter, slash-break-and-tabs, folding, jump to source | — | queue row |
| MARXY-240 working links | heading-ids-links | MARXY-229 | — |
| MARXY-241 accessibility gates | contrast-gate-all-pairs, media-query-rules | — | — |

Keys were drafted as `MARXY-NEW-art-<slug>` and assigned by `jira.mjs sync --new`. The slugs are recorded in
`orchestration/jira-map.json`.

## How taste requests were minimised

- **Every default comes from the handbook.** The diff tints are measured (chapter 9). The front
  matter numbers, the 1,000- and 200-character long-line thresholds, the alert label and the
  invisible-character marker are the spec's values. No story asks "which of these?".
- **No story stops for a look.** Each visible story ships its default and adds **one**
  confirm-or-tune row to `docs/taste-review/queue.md`, reviewed at the end of the phase with the rest
  (AGENTS.md). Six rows in all, where the handbook listed thirteen.
- **Taste the handbook could answer is answered.** MARXY-23's open slash-break question is settled by
  the rule that only breaks a path wider than the measure, where the alternative is a mid-name break.
  The mono weight on dark belongs to the typography handbook (ADR-0035) and is not reopened. Alerts
  are label-only and the diff marker is the primary cue, both by the research.
- **Taste that needs a view that does not exist yet is deferred with the view**: truncation numbers
  for tool output and data folds, and transcript labels.

## Deferred to v1.1 (not filed)

`docs/scope.md` puts operations beyond the four, and anything like a derived view, after v1. They
are recorded in `coverage.json` as four bundles, so the v1.1 planner files them from the ledger:
**operations** (12 copy, extract, JSON, ANSI and invisible-character operations), **provenance**
(P04, P09, anchors, changed-since-last-read, lenses), **transcript** (P10 and everything in the
derived JSONL view) and **README extras** (emoji shortcodes).

## Re-sequencing

| Story | Change | Why |
| --- | --- | --- |
| MARXY-44 | + dep `MARXY-229`; reserved-id clause moved | one owner for the sanitiser vector |
| MARXY-45 | + P17 acceptance; + `src-tauri/src/commands`, `build.rs` paths | the handbook's CSP gate is this story's gate |
| 13 new | Phase 3, deps as above | Phase 1 is closed; Phase 2 still holds Phase 3 except for the two cross-phase stories |

## Escalation risk

- **`MARXY-233`** is the largest story and touches the CODEOWNERS path, the pipeline and a
  new pairing pass that has to carry provenance across sibling blocks. It is the one most likely to
  fail twice. The seam if a reviewer returns it: split into *removal records and instruction-class
  tags* and *layout HTML and details*. Their paths overlap only in `policy.ts`.
- **`MARXY-235`** adds three grammars. `shellsession`'s packaged licence was not checked (P13),
  and the licence gate may refuse it. If so, the console part lands with a hand-written prompt pass
  and no grammar.
- **`MARXY-239`** reads `.editorconfig` through the shell. It must stay inside the indexed
  root, which MARXY-45's new `read_file` root check will also enforce. Whichever lands second adapts.
- **MARXY-232** is human-gated, and nothing escalates until the label is removed.

## Tripwires checked

- **No closed phase gained a row:** `deps.json` phases 0 and 1 are unchanged, and `node --test
  orchestration/phases.test.mjs` passes.
- **No story crosses a later phase:** every new dependency is in Phase 3 or earlier (MARXY-44, 48,
  97 are Phase 3).
- **Contracts untouched here:** this PR edits no `packages/*/src/contracts/**` and no `tokens.css`.
  The token change is MARXY-232's own PR.
- **ADR-0006:** no dependency is added by this pass. Mermaid stays out, and `MARXY-240` vendors the
  github-slugger algorithm (MIT).
- **Commitments 2 and 3:** no story adds a network path. Badge and picture fetches go through
  MARXY-97 only, and `gate:no-network` is in six stories' acceptance.
- **Mechanism over catalogue:** the v1.1 operations stay unfiled. The stories fix defects and add
  units, not operations.
