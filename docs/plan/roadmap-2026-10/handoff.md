# Lead handoff: 2026-10-11, after the replan

**For:** the next lead session, and the author. **Read, in order:** this page, then
[`../direction-2026-10/12-replan-2026-10-11.md`](../direction-2026-10/12-replan-2026-10-11.md) (the replan: what exists,
the decisions, the wave order, the author list), `00-orchestration.md` §3 to §7, the cards for the wave you run
([`11-cards-wave-4.md`](../direction-2026-10/11-cards-wave-4.md), [`13-code-view.md`](../direction-2026-10/13-code-view.md)),
and [`harness-map.md`](harness-map.md) to drive the app headless. `progress.md` holds every story's detail.

## Where it stands

The replan session (2026-10-11, Opus lead, two Sonnet agents) surveyed `main` at `7b543931` and found most of the
direction's merged work has no surface: kinds are never read at open, the clipboard API and the transform library
have no caller, the query language and capture rules are parsed for nothing. The next waves wire those into the window
before building more parts. Nothing was dispatched or merged in this session.

**Stopped mid-work, uncommitted; resume in the worktree (read `git diff` first, never `git stash`):**

| Story | Worktree / branch | State | Resume with |
| --- | --- | --- | --- |
| D-15 | `../marxy-wt/D-15`, `perf/d-15-split-open-nonblocking` | Sliced parse (`parse/chunked.ts`) and sliced sanitised render (`renderDocumentSafeHtmlInSlices`), open/store/view wiring; 13 files, about 285 lines; uncommitted. The branch carries D-14's two pre-merge commits and tracks the deleted `test/d-14-close-phase-d`. | Delete `apps/desktop/src/pane/index.ts.bak`, commit the work in progress on the branch, then `git rebase --onto origin/main 7a9f7199` (replays only that commit; D-14's `7cacc512` and `7a9f7199` are in `main` as #552, squashed), `git branch --unset-upstream`; then the **amended card** (`04-phase-d.md`, "Amended 2026-10-11"): equivalence oracle, two-frame allowance, memory recorded only. Adversarial review (Sonnet, high). |
| W-02 | `../marxy-wt/W-02`, `feat/w-02-workspace-shell` | Workspace state, regions, commands, storage, gate-aesthetics, base.css; uncommitted; 4 behind `main`. | **`⌘\` folds and unfolds** (the lead's ruling by ADR-0058 and mock-v2; the author may veto before merge); D-07's Open beside moves to **`⌥⌘\`** in the same PR (`pane/keys.ts`, registry, `09-app-shell.md`). Then the card in `10-cards-wave-3.md`. |

**Held for the author (do not merge):** #545 (E-04, ADR-0048 clause 3), #551 (H-04, taste; Linux goldens to
regenerate in CI's image after the ruling; no font download without the author's OK). Code-owned: #494, #407, #450.

**Close as superseded** once the replan PR merges: #445 (lane K "code as read"), imported as V-09 to V-16 in
`direction-2026-10/13-code-view.md`. Comment on it with the link before closing.

## Next, in order

The wave table is in the replan. In short:

- **Wave 4 (now):** W-02 (resume, Sonnet high), D-15 (resume, Sonnet high), F-32 (Sonnet low) then J-04 (Sonnet medium),
  and X-11, the taste walk (Sonnet low; docs only, beside the three).
- **Wave 5:** K-05a (after D-15), W-19 (after W-02), J-05 (after J-04, Sonnet high).
- **Wave 6:** W-05 (high), F-33 (high), V-16 then V-09 (low). **Write the cards for waves 6 and 7 first** (W-03, W-04,
  W-05, W-21, J-06 and K-07 have none): an X-13 plan story, Sonnet medium, in wave 5, with the shape of
  `11-cards-wave-4.md`.
- **Waves 7 and 8, then the look track after H-04 is ruled:** as the replan says.

## Rules for this cycle (the replan's decisions)

- **A story that adds a core API names its caller**, in that story or the next queued one. No more parts without a door.
- **Before dispatch, check the card against `main`**: its Paths exist (`git ls-files`), the functions it names exist
  (`git grep`). A number the implementor cannot reproduce goes in the PR and the card is amended in the same PR.
- **Operation lists:** until F-32 merges, land E and J stories one at a time and resolve the lists by union, then diff
  the resolved file against both parents.
- **CI reds:** rerun once when the red test is outside the PR's paths; a second red is a finding, not a rerun.
- **Data-safety stories** (store, save, two panes, outside writes, paste) get an adversarial review with the
  reviewer's own probes, and, once F-33 lands, its walk at a higher seed count. A "nit" that breaks a commitment is a
  return.
- **Models:** every implementor and reviewer on Sonnet (medium; low for docs and XS; high for L or data-safety).
  Opus only where a card's rule names it after a Sonnet failure, and for F-21 only if the author says so.
- At most three implementors plus one or two reviewers at once. Set `model` and `effort` on every spawn.
- Brief implementors to run `pnpm gate:fidelity` when they touch `src/shell` or document code.
- Merge with `node scripts/lead-merge.mjs <pr> --verdict FILE --sha HEAD` after a verdict naming the current head.
  Never sign your own implementation; a lead verdict only for a clean merge-from-main or a trivial docs or test change.
- Agents using Docker stop only containers they started. No GUI windows from the session.
- End the session by updating this page and `progress.md` in a plan PR, and close the report with the readiness table.

## Lessons

- **browser-lite timeouts (7 times) were a boot stall, not the suite's size.** The same job takes 5 to 6 minutes on
  other runs and hits the 15 minute cap on others. F-30 named the hanging test (F-19.3) and F-30.1 bounded the boot.
  The residual is a product stall, F-31. Do not raise the timeout (#394) for this.
- **Append-only operation lists conflict between parallel E stories.** `MUTATING_OPERATIONS` and the catalogue list
  conflicted for E-06 and E-07, E-08 and E-10. Merge those stories serially, or expect a list-union merge.
- **The lead's regex conflict resolution once dropped ADR index rows** (#516 fixed it). Diff a resolved file against
  both parents before committing.
- **Cards can be wrong on a number.** B-27's 28 to 30 s, F-27's 1,300 px, H-06's "two sizes within 0.5 %" and E-16's
  CRLF rule did not hold; the implementors who measured and reported saved a round each time.
- **Adversarial reviews with an oracle still pay:** B-24 (KaTeX ran twice, Save as threw), D-10 (two silent-overwrite
  paths) and V-01 (Join, Delete line, mixed CRLF) were each found by a reviewer's probes, not the PR's tests.
- **A usage limit stops agents mid-work** (about 18:00: E-04, J-03, E-05). Their worktrees were intact; resume rather
  than restart.
- **Parts without a door pile up silently** (2026-10-11): 77 PRs in two days, and the reader's window barely changed.
  The survey (harness-map recipe, about 6 minutes on Sonnet) is cheap; run one at the end of each milestone.
- **Author-reported problems need a ledger row the day they arrive.** #445's code-view report sat three days as an
  unmerged plan PR with colliding ids.

## The running prompt

Paste this to start the next lead session (any model; the lead's own work is reading, deciding and merging):

```text
Continue the marxy lead cycle as the lead (repo ~/Dev/marxy). Be cost-effective: every subagent on Sonnet (medium; low for docs and XS stories; high for L or data-safety stories), at most 3 implementors plus 1–2 reviewers at a time, and set model and effort on every spawn. Opus only where a card's rule names it after a Sonnet failure.

Read first, in order: docs/plan/roadmap-2026-10/handoff.md ("2026-10-11, after the replan" is current), docs/plan/direction-2026-10/12-replan-2026-10-11.md, 00-orchestration.md §3–§7, then the cards for the wave you run (direction-2026-10/11-cards-wave-4.md, 13-code-view.md, 10-cards-wave-3.md for W-02) and roadmap-2026-10/harness-map.md. Pull main first; if the replan PR (X-12) is still open, review and merge it before anything else (lead verdict: docs only).

Then run the waves in the replan's order, landing each before starting work that depends on it:
- Wave 4: resume D-15 (~/Dev/marxy-wt/D-15) and W-02 (~/Dev/marxy-wt/W-02) exactly as handoff.md's table says (read `git diff` first, never `git stash`; D-15 rebases with `--onto origin/main 7a9f7199`; W-02 takes ⌘\ for fold/unfold and moves Open beside to ⌥⌘\). F-32, then J-04. X-11, the taste walk, beside them (docs only).
- Wave 5: K-05a (after D-15), W-19 (after W-02), J-05 (after J-04), and X-13 (write the cards for waves 6 and 7).
- Then waves 6 to 8 as the replan says. Before each dispatch, check the card against main (Paths exist, named functions exist).

Do not merge #545 (ADR-0048 clause 3) or #551 (H-04 taste) until the author rules; never download fonts without the author's OK. F-31 waits on the author's ADR-0013 ruling; F-21 (#470) waits on the author's choice of model. Close #445 as superseded by direction-2026-10/13-code-view.md, with a comment linking it. When the author answers an item on the replan's "For the author" list, record the ruling in progress.md and unblock what it names.

Rules:
- A story that adds a core API names its caller, in the same story or the next queued one.
- Merge with `node scripts/lead-merge.mjs <pr> --verdict FILE --sha HEAD`, only after a review verdict naming the current head. Never sign your own implementation; a lead verdict only for a clean merge-from-main or a trivial docs or test change, after diffing the resolved file against both parents.
- Until F-32 lands, E and J stories land one at a time; resolve the operation lists by union.
- Data-safety stories (store, save, two panes, outside writes, paste) get an adversarial review with the reviewer's own probes, and F-33's walk once it exists; a "nit" that breaks a commitment (faithful to the bytes, nothing lost silently) is a return.
- CI: rerun once when the red test is outside the PR's paths; a second red is a finding.
- Brief implementors to run `pnpm gate:fidelity` when touching src/shell or document code. Agents using Docker stop only containers they started. No GUI windows.
- End the session by updating handoff.md (including this prompt, if the order changed) and progress.md in a plan PR, and close your report with the readiness table.
```
