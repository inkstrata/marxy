# Plan delta — 2026-09-18 (review is the constraint; two blocked reasons were false)

> Fifth delta of the day. Previous: `2026-09-18-cold-start-metric-falsified.md`. Board at the time
> of writing: 70 stories, 8 merges, 8 done, 9 In Review, 3 blocked, 10 open pull requests.
>
> The headline is not MARXY-61. It is that two mechanisms landed today, each correct on its own,
> and together they make the review queue unable to drain no matter how fast it is read. That is in
> decision 2. MARXY-61's blockage turned out to be two errors in its own row.

## Tripwires checked (`docs/roadmap.md`)

| Tripwire | State |
| --- | --- |
| **Cold start > 500 ms after Phase 2 on either platform** | **Fired, and early — in Phase 0, on both platforms.** 2844 ms on macOS, 1735 ms on Linux, against 500 ms. The roadmap's prescribed response is already written: font subsetting first, resident mode default on that platform second, never a bigger bundle. No story written for either, because which one is right depends on Ian's ruling on the budget (decision 4). |
| Weight harness residual > 25 after version-keyed offsets | Not fired. The spike measured ~70 lighter on WebKitGTK but that is before offsets and not on real desktops; it is an open taste-queue row, not a tripwire. |
| `justif/core` cannot set ragged text | Not fired. MARXY-19 merged: both engines beat greedy, modestly, and only at tight tolerance. Recommendation holds for reasons other than rag. |
| Reviewer fails the palette task at review #2 | Not reached (review #0 is still pending). |
| Authoring re-enters scope; WebKitGTK < 2.50; single Tauri engine; first reaction about a feature | Not fired. |

Taste review: nothing visual merged without a queue entry. MARXY-19 produced numbers, not images,
so no row is owed. Note that ADR-0024 on PR #14 ("dark is primary") would change every artifact in
review #0, which is the strongest argument for resolving PR #14 before the typeface decision is
taken — see decision 5.

## Decision 1 — the three blocked stories, and two reasons that were false

### MARXY-61 — re-scoped, not split, not dropped

Attempt 1 produced **no diff at all**. The two blockers are errors in the story row, not in the
work, and `orchestration/results/MARXY-61.json` states both precisely:

1. `apps/desktop/package.json` declares `markdown-it`, `dompurify`, `@types/markdown-it` and
   `@types/dompurify`, and was **outside Paths**. `pnpm-lock.yaml` was inside Paths, so criterion 1
   ("no dependency remains … asserted by a check") was unachievable by construction: the lockfile
   cannot drop a package that a manifest in the workspace still asks for. A check written to that
   criterion would have been red on every possible cut of this story.
2. `@marxy/core` exports `parseMarkdown` and nothing else on `main`. Criterion 2 says apps/desktop
   and every script "render through `@marxy/core`" — there was nothing to render through.
   `renderSafeHtml` arrives with **MARXY-12**, which is PR #11, in review. `deps.json` did not
   record that edge.

The implementor also tried the obvious alternative — walk the core AST to HTML inside
`apps/desktop/src` — and correctly rejected it: that is a *second* renderer, which is what the story
exists to delete, and it would have rewritten `scripts/gate-no-network.mjs`, a file MARXY-12 owns.

Fixed by data, not by splitting: `apps/desktop/package.json` joins Paths, `MARXY-61 → MARXY-12` is
added, and criterion 4 is reworded as the regression guard it actually is (`docs/plan.md` already
names mdast/micromark at `ba7ed37`; an implementor told to "make it name mdast/micromark" will invent
an edit). **Attempts reset to 0** and status `blocked → todo`, because the attempt was spent on a
story that could not be done as written and the cap exists to catch work that is too hard, not rows
that are wrong. No split: the diff is small and the blockage was never size.

### MARXY-5 — the recorded reason is discharged; the real blocker is different

The reason on record is that the `workflow`-scope push had not landed. **It has.** `origin/main` and
`main` are both at `ba7ed37`, `.github/workflows/ci.yml` is on `main`, and CI has run on every push
to `main` since 08:43. The first item in `needs-human.md` is stale and should be ticked.

The outstanding criterion — a green CI run — is still outstanding, for a reason nobody recorded:
**`main` is red, and has been since 11:33.** Last green: run `35340189174` (MARXY-11). Every run
since has failed on exactly one step, `Perf gate (CI envelope and baseline, ADR-0022)` on
`macos-latest`, with `ubuntu-latest` green throughout. That is MARXY-63's subject.

So MARXY-5 loses `human-gated` (nothing in it needs a person any more), goes `blocked → todo`, and
gains `MARXY-5 → MARXY-63`. Its acceptance now names the run id and the commit, and asks for a check
that the contracts diff against the handoff commit is empty, so "contracts unchanged" is asserted
rather than asserted-about.

That we merged eight stories onto a red `main` while `AGENTS.md` says `main` is always releasable is
worth saying plainly. The cause is known and tracked; the fact that nothing in the loop was shouting
about it is the part that should not repeat, and decision 2's story set is where that lands.

### MARXY-6 — the reason is false in the other direction: most of it is already done

Measured against the live repository rather than the record. `main` already has: strict required
status checks over `gates (macos-latest)` and `gates (ubuntu-latest)`; `require_code_owner_reviews`
true; `required_linear_history` true; `allow_merge_commit` and `allow_rebase_merge` false;
`allow_squash_merge` and `delete_branch_on_merge` true; `allow_force_pushes` and `allow_deletions`
false; and `.github/CODEOWNERS` on `main` covering `/packages/theme/`. Two of the three acceptance
criteria are satisfied in fact.

Two gaps remain, one setting each, and the second one matters much more than it looks:

1. **`enforce_admins` is false.** "Direct push to `main` is rejected" is therefore false for the
   admin account — which is the account the fleet pushes with.
2. **`required_approving_review_count` is 0 and no open pull request has ever reported
   `REVIEW_REQUIRED`.** Including **PR #11**, which edits `packages/core/src/sanitize/`, and **PR
   #10**, which amends an *accepted* ADR under `docs/adr/`. Both are CODEOWNERS paths.
   `cycle.mjs` holds on `REVIEW_REQUIRED`, so the fleet's CODEOWNERS safety net is wired to a signal
   GitHub is not sending. The security-posture path and the project's memory are both currently
   mergeable without their owner.

MARXY-6 stays `human-gated` and stays blocked — they are repository settings and only Ian can flip
them — but it is **split**, because it now contains two different kinds of work:

- **MARXY-6 (kept, narrowed):** Ian flips `enforce_admins`, settles the approval count, and
  demonstrates each criterion against a real pull request whose number goes on the issue.
- **MARXY-82 (new, phase 0):** `scripts/gate-protection.mjs` asserts the
  whole shape, so the settings cannot drift back and the next session does not have to remember to
  look. `--live` reads the API and is never run in CI, because reading branch protection needs admin
  and no gate may depend on a secret; what CI runs is the selftest over committed fixtures, one per
  condition flipped. Depends on MARXY-6.

## Decision 2 — review throughput, written as something the scripts can act on

### The mechanism, not the mood

Nine stories In Review. Six pull requests BEHIND `main`, **three** in conflict (#1, #14, #17 — the
count on record was two; #1, the approval-signing PR itself, is the third). Two clean and green.

Two things landed today, each right:

- `cycle.mjs` runs `gh pr update-branch` on **every** BEHIND pull request, every cycle.
- An approval is signed against the commit it was read at, and an approval naming a different commit
  holds the pull request.

Their product is the whole problem. **Every merge rewrites the head of every other open branch, and
therefore voids every signed approval in the queue.** An approval's validity window shrinks as the
queue lengthens. At nine, the window is shorter than the time it takes to read a pull request, so
the queue cannot drain by reading faster — reading is not what invalidates the work. It is a
livelock, not a backlog, and no amount of reviewer throughput fixes it.

### What changes, mechanically

Recorded as **ADR-0025 (proposed)** and landed by two stories with disjoint paths, because the order
and the loop's obedience to it are separable and the second one touches five scripts.

**MARXY-80** (phase 0, `agent-loop`; deps MARXY-9, MARXY-10) —
`orchestration/review-order.mjs` prints the order and the exclusions as JSON, with a selftest over
fixture boards and no network. The order is three keys:

| Key | Direction | Why |
| --- | --- | --- |
| Phase, from `deps.json` | ascending | The plan is sequenced to de-risk in phase order. |
| Disturbance — other open pull requests whose changed files intersect this one's | **descending** | The branch that will invalidate the most approvals must land *before* those approvals are signed. |
| Age | oldest first | Tiebreak, so nothing starves. |

Disturbance **descending** is the decision worth arguing about. Intuition says take the small
independent change first. But the cost here is not merge effort, it is the approvals a merge
destroys, and merging the least disturbing branch first leaves the most disturbing one to destroy a
full queue of fresh signatures later. `CHANGELOG.md`, the taste queue, `pnpm-lock.yaml` and the
result files are excluded from the intersection: every pull request touches them, and a metric that
scores every pull request alike is not a metric.

A conflicted pull request is **not in the order at all**. `cycle.mjs` cannot resolve a conflict and
a reviewer reading a conflicted tree is reading nothing.

**MARXY-81** (phase 0, `agent-loop`; deps the above, MARXY-10):

1. **`reviewLanes: 4`** in `models.json`. `lanes` stays `null` — Ian's ruling on *dispatch* stands
   and is untouched — but `ready.mjs` dispatches nothing while the In Review count is at or above
   `reviewLanes`, and prints `blockedByReviewWip`. Four, because one merge then disturbs at most
   three other branches. Implementation is throttled by review rather than review being asked to
   keep up; dispatching into a queue that cannot drain produces branches whose value decays to zero
   while spending CI.
2. **One `update-branch` per cycle**, on the head of the order only. Every other BEHIND pull request
   prints its position and waits. O(N) CI re-runs and O(N) voided approvals per merge become one
   of each.
3. **A DIRTY pull request is returned, not held.** In Review → In Progress, conflicting files named
   in the result file, and **`attempts` unchanged** — a conflict is a consequence of queue depth,
   not a failed attempt, and charging it would spend an implementor's two lives on the queue's
   problem.
4. **`approve.mjs` refuses to sign** a pull request that is BEHIND, DIRTY, or not at the head of the
   order, naming which of the three held it. Sign last. This makes the livelock structurally
   impossible instead of a thing the loop warns about: a signature can only be taken at a moment
   when nothing is scheduled to invalidate it. No escape-hatch environment variable is added.
5. **`review.mjs` exits non-zero when `state.json` has no `branch` for the story**, instead of
   printing "none" while four of its boundary checks silently do not run. This was the second
   finding in the MARXY-19 implementor notes and nobody had picked it up. `MARXY-17`, `MARXY-19` and
   `MARXY-57` were all reviewed in that state.

### The open question in `needs-human.md`, settled

**Does a returned story count against WIP? No.** It leaves In Review when it is returned, so the
lane is freed by construction, and it consumes one again when it returns. A return is the same unit
of work, not a new one; charging it twice makes returning a story more expensive to the reviewer
than abandoning it, which is precisely the wrong incentive to install in the thing we are trying to
speed up. It re-enters the order at its own phase, disturbance and **original** age, so a story
cannot be starved by being returned. In `docs/sdlc.md` and in ADR-0025.

## Decision 3 — MARXY-77 and MARXY-78: right order, wrong phase

**Order: correct, keep it.** MARXY-78's mutant cases are named against `scripts/gate-fidelity.mjs`,
which is a path MARXY-77 *creates*; written first, they would be written against a file MARXY-77
deletes. Both edit that file and `apps/desktop/src-tauri/src`, so they cannot share a lane anyway.

**Phase: wrong. Both move to phase 0.**

MARXY-77 is not a gate-tidying story, which is what its summary makes it look like. Criterion 3 is a
**byte-fidelity defect in shipped code**: a save on Linux silently drops extended attributes and,
where the filesystem supports them, POSIX ACLs. AGENTS.md's fourth non-negotiable is "never touch a
byte the user did not ask to change", and MARXY-16 ships v0.0.1 on macOS **and Linux** at the end of
phase 0. Shipping a Linux save that drops attributes a reader set is shipping the thing the project
says it will not do. Criterion 5 also corrects a line in an *accepted* ADR that is now false — that
byte-fidelity tests run in Node without a shell — and a false ADR misleads every cold session that
reads it as memory. Neither of those waits behind typography.

MARXY-78 follows it into phase 0 rather than staying behind. Its own description says correctly that
none of the three normalisations is a defect today, which argues for phase 1 — but two things
outweigh that. Splitting the pair across a phase boundary leaves two stories editing one file weeks
apart, on branches that go stale against each other, which is exactly the cost decision 2 exists to
stop paying. And the NFD case is the one a macOS reader actually meets, because decomposed content
arrives from the filesystem routinely; a guard added *after* the rewrite it was meant to protect is
a guard added late. MARXY-78 is small and every criterion is a mutation case in one file, so this
costs phase 0 very little.

**One real gap in MARXY-78, fixed here.** Its Paths include
`apps/desktop/src-tauri/src/atomic_write.rs` while its own description says nothing there is broken.
A mutant that lives in the diff is not a mutant, it is a defect. New criterion 6: `atomic_write.rs`
must be byte-identical to `main` at the end of the pull request, asserted by a check that reads both
revisions, and the harness must mutate a copy — with a named case proving the copy, not the tracked
file, is what was mutated. Without that, a story about catching normalisations could ship one.

Neither is split. MARXY-78 was the candidate — five criteria, two halves of a gate — but they are
five mutants in one file, which is one thing.

## Decision 4 — the cold-start set is coherent in three of four places

MARXY-63 (in review, PR #10) → MARXY-69 → MARXY-70, with MARXY-71 alongside. Three defects.

**a. A dependency in the wrong direction, and it is the important one.** MARXY-69 enforces 500 ms
against the median of five cold launches, and MARXY-70 writes adopted baselines and cold envelopes
into `fixtures/perf-budgets.json`. Both statistics are read from `MARK first_text`. **MARXY-71 says
that mark can be emitted by a build that renders nothing a reader can see** — with `#doc` set to
`visibility: hidden` the smoke check still reports 21 blocks and 919 chars and frames ticking,
because the evidence function reads `textContent`.

So 69 and 70 as sequenced would enforce a product budget, and bake adopted numbers into a tracked
file, against a mark that is known to be about to move. That is the same error as the one this whole
thread exists to correct: the name of the measurement doing the thinking instead of the measurement.
**MARXY-71 moves to phase 0 and ahead of both**: `MARXY-69 → [MARXY-63, MARXY-71]`, and MARXY-70
inherits it through 69. MARXY-71's paths are `apps/desktop` and 63's are `scripts/`, so it costs no
wall time — it can run beside MARXY-63 right now.

**b. `deps.json` placed MARXY-69 and MARXY-70 in phase 0 *and* phase 1.** The file's own `_note`
says every story appears in exactly one phase, and MARXY-9 is about to make `ready.mjs` read that
field. Fixed; the graph now verifies clean on duplicate membership, stories with no phase, dangling
targets, cycles and phase inversions.

**c. MARXY-15's dependencies were incomplete and its acceptance had become a duplicate.** Its
acceptance is textually the union of 63 + 69 + 70 and it says so — "the mechanism itself lands in
MARXY-55, MARXY-63 and the two stories that follow" — but its deps were `[13, 55, 63]`, so it was
dispatchable after MARXY-63 with `scripts/gate-perf.mjs` and `.github/workflows/ci.yml` in its
Paths, and would have re-implemented 69 and 70 in a story explicitly told not to re-decide them.
Deps gain 69 and 70, and the acceptance is narrowed to the residue that is genuinely only its own:
the 12-launch round, and the pull-request comment carrying the measured values, the rule that bound
each, the headroom and any confirmed-noise round. It stays as the closing story of the chain, and
its Done is the honest marker that cold start is measured and enforced.

**Nothing in the set waits on an unrecorded human decision.** Three things wait on a *recorded* one
or on a person, and one of them was not recorded:

- **The cold-start budget ruling is Ian's and is recorded.** I have not touched it. What it actually
  blocks, stated precisely: **MARXY-16 only.** MARXY-69 can be built and merged without it —
  criterion 3 lands a reference-mode gate that is red by design at 2844 ms against 500 ms, and
  reference mode runs before a tag rather than on pull requests, so it blocks a tag and nothing
  else. That is the correct thing to block. The work that is genuinely stopped until Ian rules is
  the *response*: the roadmap prescribes font subsetting first and resident-mode-by-default second,
  and which of those is written depends on whether 500 ms is still the commitment and whether it
  applies to a cold OS-level launch. No story written for either. Phase 0 cannot be released until
  he answers.
- **Not recorded, and now is:** MARXY-63, MARXY-69 and MARXY-70 all edit `docs/adr/`, a CODEOWNERS
  path, and MARXY-63's PR #10 **amends an accepted ADR** (ADR-0022, two sentences replaced and a
  premise reversed). GitHub is requesting no review on it — see decision 1's MARXY-6 finding — so
  the ADR owner is about to be bypassed on his own ADR by a mechanism that believes it is asking
  him. Added to `needs-human.md`.

## Decision 5 — board drift that is Ian's to resolve: PR #14

Recorded because it is the largest single source of drift on the board and no story can be
sequenced around it, not because the planner has a view on its content.

PR #14 (`docs/design-runway`, three commits, **76 files**, authored by Ian) is open, in conflict and
red. It carries: two new ADRs (0023 provenance-in-the-DOM, 0024 dark-is-primary); an edit to
`packages/theme/src/tokens.css`, which is a **frozen contract**; edits to `AGENTS.md`,
`.github/workflows/ci.yml`, `orchestration/prompts/planner.md` and `orchestration/review.mjs`; a
new `docs/design/` tree; a new `docs/plan/tasks/` card system; and a new script suite
(`scripts/check-*.mjs`, `registry.json`, `new.mjs`, `done.mjs`). It introduces MARXY-74, MARXY-75
and MARXY-76, none of which are in `docs/plan/jira-issues.csv` or `orchestration/state.json`.

Three consequences for planning, all of which need him and not me:

1. It cannot merge under the rules it is written alongside — one issue, one pull request; frozen
   contracts change only in a story whose paths name them and that carries an ADR; a story's diff
   may touch only its Paths.
2. `docs/plan/tasks/*.md` is a **second machine-readable spec** beside the CSV. `AGENTS.md` and
   `docs/sdlc.md` say the CSV is the spec and Jira is the board of record, and those documents win.
   Two specs is the failure mode this repository's own history warns about.
3. **ADR-0024 makes dark the primary variant**, which would invalidate every artifact in taste
   review #0 — all 20 light-mode PNGs — and review #0 is the decision that currently blocks
   MARXY-20 and MARXY-21. MARXY-76 on that branch exists precisely to re-render them. So the
   typeface decision should not be taken before PR #14 is resolved, or it will be taken twice.

I have left MARXY-74, 75 and 76 out of the CSV and `state.json` deliberately: adding rows for
another author's unmerged branch would fabricate a plan around work whose shape he has not settled.
The drift must close one way or the other, and which way is his call. In `needs-human.md`.
ADR-0025 takes number **0025** so 0023 and 0024 can land unmoved.

## Decision 6 — MARXY-79 arrived mid-pass and must not land first

MARXY-79, "Let agents merge a PR once the quality bar is met", was written into the CSV by the
orchestrator while this pass was running, and its branch already exists. It is the right story. It
must not merge before MARXY-81, and its Paths were wrong.

**The ordering is not a preference.** MARXY-79's criterion 2 enables GitHub auto-merge
(`gh pr merge --auto`) when the only remaining wait is pending CI and the approval is signed. Landed
into today's queue, that arms an auto-merge against a commit that is about to stop existing: every
merge rewrites the head of every other open branch, which voids its signed approval, and the next
`update-branch` retriggers the CI the auto-merge is waiting on. It automates the livelock. After
MARXY-81 the same change arrives into an ordered, capped queue where exactly one branch is being
updated per cycle and a signature can only be taken at the head — which is the configuration in
which auto-merge is simply correct. Edge added: `MARXY-79 → MARXY-81`.

**Paths narrowed.** MARXY-79 claimed `orchestration` as a whole, which collides with MARXY-80,
MARXY-81 and every future loop story, and would have frozen the directory for the duration. Narrowed
to `orchestration/cycle.mjs`, `orchestration/approve.mjs`, `orchestration/prompts`, `docs/sdlc.md`,
`CHANGELOG.md`, `package.json`. It still shares `cycle.mjs`, `approve.mjs` and `docs/sdlc.md` with
MARXY-80 and MARXY-81 — that is what the dependency edge is for.

For the orchestrator: if an implementor is already on `chore/MARXY-79-agent-merge-quality-bar`, the
work is not wasted, but the pull request is held until MARXY-81 is done, and the story text it was
dispatched with has changed underneath it. Re-dispatch it after MARXY-81, or hold the branch.

## Story changes

### New (phase 0, all three `agent-loop`)

| Placeholder | Summary | Deps |
| --- | --- | --- |
| `MARXY-80` | Make the review order a computed thing rather than a habit | MARXY-9, MARXY-10 |
| `MARXY-81` | Cap review WIP and make the loop act on the review order | the above, MARXY-10 |
| `MARXY-82` | Gate the repository settings so branch protection cannot drift back | MARXY-6 |

### Edited

- **MARXY-5** — `human-gated` removed, acceptance rewritten against the real blocker, dep on MARXY-63.
- **MARXY-6** — narrowed to the two settings that are actually unset, with the measurements; the
  standing check split out.
- **MARXY-15** — narrowed to its residue; deps gain MARXY-69 and MARXY-70.
- **MARXY-61** — `apps/desktop/package.json` added to Paths, dep on MARXY-12, criterion 4 reworded
  as a regression guard, attempts reset to 0.
- **MARXY-69, MARXY-70** — sequenced behind MARXY-71, with the reason in the description.
- **MARXY-71** — phase 1 → phase 0, ahead of 69 and 70.
- **MARXY-77, MARXY-78** — phase 1 → phase 0, order unchanged; MARXY-78 gains criterion 6.

### Dependencies

| Edge | Why |
| --- | --- |
| `MARXY-61 → MARXY-12` | `renderSafeHtml` does not exist until MARXY-12; also removes the collision on `scripts/gate-no-network.mjs`. |
| `MARXY-5 → MARXY-63` | Its only outstanding criterion is a green `main`, and `main` is red on one step that MARXY-63 owns. |
| `MARXY-69 → MARXY-71` | Do not enforce a budget against a mark that does not prove paint. |
| `MARXY-15 → MARXY-69`, `MARXY-15 → MARXY-70` | Its acceptance was the union of theirs; without the edges it could have re-implemented both. |
| `MARXY-82 → MARXY-6` | The gate asserts the shape MARXY-6 sets. |
| `MARXY-80 → MARXY-9, MARXY-10` | Needs phase data and a `pathsOf` that stops collapsing globs; and the cycle it feeds. |
| `MARXY-81 → the above, MARXY-10` | `cycle.mjs` and `approve.mjs` live on the MARXY-10 branch. |

Lane constraints, not edges: MARXY-71 (`apps/desktop`) is disjoint from MARXY-63/69/70 (`scripts/`)
and may run beside them. MARXY-77 and MARXY-78 share two paths and must be sequential. MARXY-80 and
MARXY-81 share only `orchestration/test` and `CHANGELOG.md`, and are sequential through their edge
in any case; the documentation is split between them (`docs/sdlc.md` in the first,
`orchestration/README.md` in the second) so neither waits on the other to describe itself. MARXY-79
shares `cycle.mjs`, `approve.mjs` and `docs/sdlc.md` with both and is sequenced behind MARXY-81.

No story dropped. Nothing split except MARXY-6.

## Scope pressure

None proposed. Phase 0 is not behind on work; it is behind on review, which decision 2 addresses
directly, and on one ruling, which decision 4 names. The cut list in `docs/scope.md` is not the
right instrument for either.

## How we would know I was wrong

1. **`reviewLanes: 4` leaves implementors idle while the queue drains.** Then the cap is too low
   and the number moves on measured wall time, not on argument.
2. **Disturbance turns out near-uniform** once the always-shared files are excluded — most pull
   requests at 0. Then the key is dead weight and age should decide; the selftest makes this
   observable rather than assumed.
3. **MARXY-77's Linux attribute test can only skip.** If no CI filesystem supports extended
   attributes, criterion 3 is unassertable there and the phase-0 argument weakens to the ADR
   correction alone — which would still justify phase 0, but less strongly.
4. **MARXY-71 finds no paint signal present in both WebKit and WebKitGTK.** Then 69 and 70 cannot
   wait on it, the ordering in decision 4a is wrong, and the honest move is to let them adopt
   against the frame count while recording in `fixtures/perf-budgets.json` that the numbers rest on
   a mark that does not prove paint.
5. **A returned story is returned three times for conflicts without a failed attempt.** Then not
   counting conflicts has removed the pressure that would have split it.
