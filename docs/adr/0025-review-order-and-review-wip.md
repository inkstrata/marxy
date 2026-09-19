# ADR-0025 — Review order and a WIP limit on review

- **Status:** accepted
- **Date:** 2026-09-18
- **Amends:** ADR-0017 (trunk-based agent workflow). Nothing in ADR-0017 is contradicted; this
  adds the ordering and the cap that ADR-0017 left to judgement.
- **Numbering:** 0023 and 0024 are claimed by the `docs/design-runway` branch (PR #14) and are not
  on `main`. This ADR takes 0025 so the two can land unmoved.

## Context

Eight merges into Phase 0, review is the constraint and implementation is not. Nine stories sit in
In Review against a backlog that dispatch can fill without limit, because Ian ruled the dispatch WIP
cap off and path overlap is the only parallelism limit (`models.json` `lanes` is `null`). At the time
of writing, six of the nine pull requests are BEHIND `main`, three are in conflict, and only two are
green and clean.

Two mechanisms, each individually correct, combine into something neither intends.

1. `cycle.mjs` runs `gh pr update-branch` on **every** BEHIND pull request it finds, so one merge
   re-runs the full CI suite across the whole queue. CI cost per merge grows with queue depth.
2. An approval is signed against the commit it was read at (`orchestration/approve.mjs`), and a
   pull request whose approval names a different commit is held. This is right: a push after a
   review is an unreviewed tree wearing a reviewed one's name.

Together: every merge rewrites the head of every other open branch, and therefore voids every
signed approval in the queue. The window in which an approval stays valid shrinks as the queue
grows. Past some depth — and nine is past it — the queue cannot be drained by reading faster,
because reading is not what invalidates the work. This is a livelock, not a backlog.

## Decision

**1. Review gets its own WIP limit, and dispatch takes back-pressure from it.**
`lanes` stays `null`; Ian's ruling on dispatch stands. A separate `reviewLanes` caps how many
stories may be in In Review at once, and `ready.mjs` dispatches nothing while the count is at or
above it. `reviewLanes` is **4**: one merge then disturbs at most three other branches, which is
the number that can plausibly be re-read between merges.

Implementation is throttled by review rather than review being asked to keep up, because the
alternative — dispatching into a queue that cannot drain — produces branches whose value decays to
zero while consuming CI.

**2. The review order is computed, not chosen. Three keys, in this order.**

| Key | Direction | Why |
| --- | --- | --- |
| Phase, from `deps.json` | ascending | The plan is sequenced to de-risk in phase order; a phase-1 pull request read before a phase-0 one inverts the plan for the sake of convenience. |
| Disturbance — the number of other open pull requests whose changed files intersect this one's | **descending** | The branch that will invalidate the most approvals must land *before* those approvals are signed, not after. |
| Age | oldest first | The tiebreak, so nothing starves. |

Disturbance descending is the counter-intuitive one and it is the load-bearing one. The intuition
says merge the small independent change first because it is easy. But the cost in this system is not
merge effort, it is the approvals a merge destroys, and merging the least disturbing branch first
leaves the most disturbing one to destroy a full queue of fresh signatures later.

**3. A conflicted pull request is returned, not queued.** `cycle.mjs` cannot resolve a conflict and
a reviewer reading a conflicted tree is reading nothing. The story goes back to In Progress, and
**`attempts` does not move**: a conflict is a consequence of queue depth, not a failed attempt, and
counting it against the attempt cap would spend an implementor's two lives on the queue's problem.

**4. `cycle.mjs` updates one branch per cycle, the one at the head of the order.** Every other
BEHIND pull request is left BEHIND with its position printed. O(N) CI re-runs and O(N) voided
approvals per merge become one of each.

**5. `approve.mjs` refuses to sign a pull request that is not at the head of the order, or that is
BEHIND or DIRTY.** Sign last. This makes the livelock structurally impossible rather than a thing
the loop warns about: a signature can only be taken at a moment when nothing is scheduled to
invalidate it.

**6. A returned story does not count against `reviewLanes`.** It leaves In Review when it is
returned, so the lane is freed by construction, and it consumes one again when it comes back. A
return is the same unit of work, not a new one; charging it twice would make returning a story more
expensive than abandoning it, which is the wrong incentive to put in front of a reviewer. It
re-enters the order at its own phase, disturbance and **original** age, so a story cannot be
starved by being returned. This settles the question recorded in `orchestration/needs-human.md`.

## Consequences

- Throughput is capped by the slowest reviewer rather than by the fastest implementor. That is the
  honest shape of the constraint; hiding it produced the current queue.
- Some implementors will sit idle with ready stories. Accepted: an idle lane costs nothing, a
  branch decaying in a queue costs CI minutes and a reviewer's attention twice.
- The order is deterministic and printable, so a stalled queue can always be explained. Every hold
  reason `cycle.mjs` prints today keeps printing.
- `reviewLanes` is a number in `models.json`, so it is changed by an edit in a pull request, never
  inferred.

## Rejected

- **Order by age alone.** Starves nothing and fixes nothing: the oldest pull request is often the
  most entangled, so the queue keeps re-running CI behind it.
- **Order by disturbance ascending (easy ones first).** Drains the queue's count quickly and its
  value slowly, and concentrates the approval destruction at the end.
- **Stop signing approvals against a commit.** This would make the symptom vanish and the
  guarantee with it. The signing rule is the more valuable of the two mechanisms.
- **Stop updating BEHIND branches at all and merge on stale green.** A branch tested against a
  `main` that no longer exists has not been tested.
- **Raise the dispatch cap instead and hire more reviewers.** There is one human and the reviewer
  agent is Opus; the cost is real and the queue is the thing to shorten.

## How we would know this was wrong

1. `reviewLanes: 4` leaves implementors idle for more than half of a cycle's wall time with ready
   stories and a queue that is draining. Then 4 is too low and the number moves on evidence.
2. Disturbance is near-uniform across the queue in practice — every pull request touches
   `CHANGELOG.md`, so the metric must exclude the always-shared files or it says nothing. If
   excluding them leaves most pull requests at 0, the key is dead weight and age should decide.
3. A story is returned three times for conflicts without a failed attempt. Then not counting
   conflicts has removed the pressure that would have split it.
