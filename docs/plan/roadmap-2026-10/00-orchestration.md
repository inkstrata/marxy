# 00 — How the roadmap is implemented: the orchestration model

**Date:** 2026-10-02 · **Status:** the operating model for phases A to E · **Supersedes, while the
fleet is paused:** `orchestration/README.md`, `docs/sdlc.md` "The loop, per story", and the
dispatch half of ADR-0034 (suspended by ADR-0051, proposed).

**Abstract.** One lead session plans and reviews; Claude Opus and Claude Sonnet subagents
implement, one story each, in their own worktrees; the lead merges what is ready. Stories come from the five
phase documents beside this one, each written so an agent with no memory of the audit can start
from the story and the files it names. Parallelism is by disjoint paths within a wave; waves are
serial. Review is by an agent against the story's acceptance list; the lead merges a PR as soon as
its review says merge and every check is green (the author's ruling, 2026-10-07). The pull-request path is the pruned one Phase A lands; until it
lands, stories pass the current one. There is no board, no Jira mirror, no planner; progress is a
table in `progress.md` in this directory, kept by the lead. The author's first priority, stated
2026-10-02, is the large-document performance work, which is why Phase A's first wave is that
lane.

## 1. Roles

| Role | Who | Does | Never does |
| --- | --- | --- | --- |
| **Author** | the repository owner | rules on the open questions each phase names; may merge or hold any PR; tags releases; opens the app and judges taste | writes stories under time pressure; merges a PR a reviewer returned |
| **Lead** | one Claude Code session (Opus) that holds this plan | picks the next wave; spawns one implementor per story; spawns a reviewer per PR; reads reviews; merges ready PRs with `scripts/lead-merge.mjs`; rebases and retargets stacked PRs after their base merges; keeps `progress.md`; re-plans a story that failed twice | implements (beyond a one-line fix the reviewer named); merges a PR whose review returned it, or before its checks are green |
| **Implementor** | a subagent, Opus or Sonnet per the story's `Model` line | one story, in its own worktree, inside its `Paths`; opens a PR with the story id in the title | touches another story's paths; edits a contract the story did not name; changes a baseline without a queue row; merges |
| **Reviewer** | an Opus subagent | reads the diff against the story's `Acceptance` and `Do not` lists; runs the gates; writes a verdict with Conventional Comments | reviews its own implementation; approves on green CI alone |

Model assignment, which every story carries as `Model: opus | sonnet`:

- **Sonnet** for S and most M stories with a complete build order and tests to extend: wiring,
  deletions, documentation, configuration, one-file features, test additions.
- **Opus** for anything that changes a seam (the store, the view, the render path, the grid pass,
  the CI workflow), anything whose acceptance is a measurement, every story marked L, every
  review, and any story a Sonnet attempt returned.
- A story that fails twice on Sonnet is re-run on Opus with the two review notes prepended.
  A story that fails twice on Opus goes back to the lead to split.

## 2. The unit of work

A story is one section of a phase document (`01-phase-a.md` … `05-phase-e.md`), with the shape
every phase document uses: outcome, why now, paths, build order, acceptance, tests, do-not, risks.
A story is ready when its `Depends on` list is merged on `main` and nothing in flight touches its
`Paths`. The lead never dispatches a story that is not ready, and never widens a story's paths
from the lead session: an implementor that needs a path the story did not list stops and reports,
and the lead either adds the path (editing the phase document in the plan branch) or splits.

Ids are `A-01` … `E-nn`. Branch names are `type/<id-lowercase>-short-slug`, for example
`perf/a-01-grid-pass-one-write`. Commit subjects follow `docs/conventions.md` with the story id
in parentheses where the Jira key used to be: `perf(typeset): one read pass and one write pass in
the grid (A-01)`. If the author mints a Jira key for a story later, the key is appended to the
PR title; nothing else changes.

## 3. The implementor's briefing

Every implementor is spawned with the same prompt, filled per story. It is short on purpose: the
story and the repository carry the detail.

```
You are implementing one story of Marxy's October 2026 roadmap in the worktree at <path>, on
branch <branch>, cut from origin/main. Read, in this order:
  1. AGENTS.md (the project's rules; the "Where the project actually is" section is stale, the
     plan in docs/plan/roadmap-2026-10/ is current)
  2. docs/plan/roadmap-2026-10/00-orchestration.md §3 to §5 (this briefing's rules)
  3. docs/plan/roadmap-2026-10/<phase>.md, the section "### <id> — …" (your story), and the
     "Preconditions" and "Verification" sections of that document
  4. The design sections and audit sections your story cites
Then:
  - Implement inside the story's Paths only. If you need a file outside them, stop and report
    which file and why; do not widen.
  - Follow the Build order. Add or extend the tests the story names; every Acceptance bullet
    must be checked by a named test or gate in your diff.
  - Run `pnpm precheck` until green, then the gates the story names. Record the commands and
    their last lines; they go in the PR body under Verification.
  - Commit per docs/conventions.md with the story id in the subject. No attribution trailers.
  - Add changelog.d/<id>.md: one reader-facing line ending in (<id>). If a reader sees a change,
    add docs/taste-review/queue.d/<id>.md (one table row, before/after artifacts).
  - Push and open the PR with the house template (.github/pull_request_template.md): Summary in
    plain language first, then Changes, Verification, For the reviewer, the acceptance → checks
    table inside <details>, the checklist. Title = commit subject.
  - Report back: the PR URL, the acceptance table, any Risks you confirmed, and anything you
    did not do.
You have one session. If you are stuck after one different approach, report what you tried and
stop; a precise report is a good result.
```

The lead spawns with `isolation: "worktree"` where the harness supports it, or creates the
worktree itself (`git worktree add ../marxy-wt/<id> -b <branch> origin/main`) and passes the
path. Dependencies are installed once per worktree (`pnpm install --frozen-lockfile`); a Rust
build is needed only for stories whose paths include `src-tauri`.

## 4. The reviewer's briefing

```
Review PR <url> for story <id> in docs/plan/roadmap-2026-10/<phase>.md. Check out the branch in
<worktree>. In this order, stop at the first failure:
  1. Paths: every changed file is inside the story's Paths, or is changelog.d/<id>.md,
     docs/taste-review/queue.d/<id>.md, a lockfile, or a golden/baseline the story names.
  2. Acceptance: each bullet has a named check in the diff, and the check would fail without the
     change (look for tautologies). Run the tests the story names and `pnpm precheck`.
  3. Do-not: nothing the story forbids happened. Contracts touched only if the story says so.
  4. Spirit: no telemetry, no network by default, no byte of a document changed that was not
     asked to, no chrome at rest, no copyleft dependency, no attribution.
  5. Measurement: if the acceptance is a number, re-run the measurement and quote your number
     beside the implementor's.
Write: `verdict: merge | return`, then numbered Conventional Comments (blocking:, suggestion:,
question:, nitpick:), most severe first, each naming the acceptance bullet or rule it rests on.
A return says what would satisfy you. Never approve on green CI alone.
```

A `merge` verdict is posted on the PR by the lead, with the review's notes and the marker line
`lead-verdict: merge <head sha>` (`node scripts/lead-merge.mjs <pr> --verdict notes.md` posts both and merges
if the checks are already green; run it again once they are). A push after the verdict needs a new verdict:
the marker binds it to the head it judged. A follow-up commit the lead asked for is checked by the lead, then
re-verdicted.

## 5. Parallelism and waves

- Each phase document lists waves. A wave is a set of stories whose `Paths` are pairwise
  disjoint and whose dependencies are all merged. The lead runs a whole wave at once, one agent
  per story, and starts the next wave when the current one has merged (not when it has opened
  PRs: a merged story may move a file the next wave's story reads).
- Within a wave, a story that finishes early does not pull the next wave forward unless its
  successor's paths are disjoint from every story still running; the lead checks with
  `git diff --name-only origin/main` across the live worktrees.
- At most **four** implementors run at once, and at most **two** of them on Opus. This is the
  pilot size the audit recommends (`13-recommendation-orchestrator.md` §4) and it keeps the
  author's review queue readable.
- A wave that touches `apps/desktop/src/app.ts` has exactly one story on that file.
- Baselines (`fixtures/baselines/`) and goldens (`packages/core/goldens/`) are touched by at most
  one story per wave; that story regenerates both engines (macOS locally, Linux in the CI image as
  `docs/research/audit-2026-10/11-corpus-additions.md` records) and carries a queue row.

## 6. The pull-request path

Until Phase A's wave 0 (A-07) lands, every PR passes the current CI (`docs/ci-contract.md`),
which includes `check-story --strict`; A-07 itself passes because a pull request runs its own
branch's workflow and commitlint configuration, so it is the one story that opens with no board
row and no key, and it lands alone before anything else. From then on no story needs a row or a
key. Once A's pruning is on `main`, the path is:
Conventional subject, changelog fragment, green product gates, one review. Nothing else is
required of a PR, and `docs/ci-contract.md` is rewritten in the same phase to say so.

The lead merges by squash, through `node scripts/lead-merge.mjs <pr>`, as soon as a PR is ready: every check
green (`ci` among them), no conflicts, base `main`, and a merge verdict naming the head commit. The script
refuses otherwise and says why, and `--match-head-commit` refuses a push that lands mid-merge. The author may
merge or hold anything; a `lead-verdict: hold <sha>` comment holds a PR. Auto-merge stays off: the verdict is
a judgement GitHub cannot see.

Merge in dependency order. The repository deletes a head branch on merge, so GitHub retargets a stacked PR to
`main`; the lead then rebases it (`git rebase --onto origin/main <old base>`), force-pushes with lease, and the
PR needs fresh checks and its verdict renewed for the new head before it merges. Merge soon after the verdict,
so nothing stacks up and goes stale.

## 7. Progress, failure and re-planning

- `progress.md` beside this document is the only ledger: one row per story (id, title, model,
  state, PR, worktree, notes), updated by the lead when a story is dispatched, opened, returned,
  merged or split. States: `ready`, `running`, `in review`, `returned`, `merged`, `split`,
  `parked`. No machine writes it.
- A story returned twice is split by the lead into two stories appended to the phase document
  with a `.1`/`.2` suffix, and the original is marked `split`.
- A story the author rules out is marked `parked` with the ruling; it is never silently dropped.
- When a story reveals that the plan is wrong (a function it names does not exist, a dependency
  was missed), the implementor reports and stops; the lead fixes the phase document in the plan
  branch and re-dispatches. The plan is edited by pull request like any document; a plan edit
  travels in the story's own PR when it concerns only that story.
- The lead's context is finite. At the end of each wave the lead writes the wave's outcome into
  `progress.md` and, if a new session is needed, the next session starts by reading this
  document, `progress.md`, and the current phase document, in that order.

## 8. Verification per phase and release

Each phase document ends with "Verification at the end of the phase": the gate commands, the
measurement commands, and the manual check the author does on the built app. A phase is done
when all of them pass and the author has opened the app and seen the screen criterion. Then the
author tags (`v0.1.0` after A, `v0.2.0` after B, …); the release workflow builds the DMG and
the Linux artifacts; the changelog fragments fold with `node scripts/changelog.mjs --release`.

## 9. Order and priority

The phases are serial: A, B, C, D, E. Inside A, the first wave is the large-document performance
lane (the grid pass, first paint from the first two screens, the index owner), because the author
has put it at the top of the list: a 1 MB agent transcript takes four to five seconds to show its
first screen today and must take well under one. The process stories of A (pausing the fleet,
pruning CI) run beside that lane where paths are disjoint. Phases C and D each carry two
independent lanes (collections and the copy pack; the pane model and the per-pane bindings)
that the lead runs in parallel within the four-agent cap.

## 10. What this model is not

It is not the fleet. There is no reconciler, no event log, no signed approval file, no board
row, no planner, no Jira. Those stay frozen under `orchestration/` for a later pilot (ADR-0051).
This model is one person, one lead session, a few agents, and the gates that protect readers.
If it starts to need more than that, the resume conditions in
`docs/research/audit-2026-10/13-recommendation-orchestrator.md` §4 are the test for turning the
fleet back on.
