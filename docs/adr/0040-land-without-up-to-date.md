# ADR-0040 — Land green pull requests without bringing them up to date first

- **Status:** accepted by the repo owner's instruction on 2026-09-28
- **Date:** 2026-09-28
- **Amends:** ADR-0025 §4 (one BEHIND branch updated per cycle is now conditional on
  `requireUpToDate`) and ADR-0034 §7 (the review pipeline's BEHIND handling). Nothing else in
  either ADR is contradicted.

## Context

Branch protection on `main` requires the `ci` status check and, until now, `strict=true` —
every pull request must be up to date with `main` before it can merge. `docs/sdlc.md` and
`orchestration/models.json` `mergeQueue: false` describe the consequence: `cycle.mjs` refreshes
one BEHIND pull request per cycle (MARXY-106, ADR-0025 §4), oldest-at-the-head-of-the-order
first, because updating every BEHIND branch at once would re-run CI for each of them and move
every head, voiding signed approvals faster than reviewers can re-sign (ADR-0025's original
livelock).

That serial refresh is the bottleneck this ADR removes. Every merge makes every other open PR
BEHIND again; the queue drains at one CI cycle per merge no matter how many PRs are already
green and ready. Path-disjoint stories — the norm here, since `docs/sdlc.md`'s "one issue, one
branch, one PR, one owner" rule and CI's own boundary check keep stories from touching the same
files — make a semantic conflict between two ready PRs rare: a PR that was green against an
older `main` is almost always still correct against a newer one that changed unrelated files.
Refusing to land it until it is literally rebased is paying a real, serialised cost (CI minutes
and queue depth) against a small, mostly theoretical risk.

The repo owner's decision: turn `strict` off in branch protection, so GitHub no longer requires
a PR to be up to date with `main` before merging. A PR that is green, mergeable,
non-conflicting and signed then lands as soon as the cycle sees it, regardless of position in
the review order. The risk this trades away — a PR merging against a `main` it was not tested
against — needs a replacement safety net, because CI already told us the PR was correct against
some `main`; what it cannot tell us is whether `main` itself, right now, still builds.

## Decision

**1. `orchestration/models.json` gains `requireUpToDate`, default `false`.** Read the way
`mergeQueue` is read (`m.requireUpToDate`, not run through `machine.mjs` `timing()`, since it is
a switch, not a duration), and added to `MODEL_KEYS` so `unknownModelKeys` and `fleet.mjs
doctor` still catch a typo.

- **`false` (the default, matching `strict=false`):** `cycle.mjs` never runs `gh pr
  update-branch`. A PR whose `mergeStateStatus` is `BEHIND` is treated exactly like one that is
  `CLEAN` for merge purposes — GitHub may report either, depending on what protection is left,
  and the cycle no longer cares which. A PR that is BEHIND but otherwise clears every other
  clause of the merge bar (`docs/sdlc.md`'s nine) merges in the same cycle it goes green.
- **`true` (what `strict=true` needs):** today's behaviour is unchanged — one BEHIND pull
  request is refreshed per cycle, the one at the head of the review order whose only hold is
  pending CI (ADR-0025 §4, ADR-0034 §7).

This is a two-line change in `cycle.mjs`'s `reviewStep`: `behind` is computed as
`requireUpToDate && pr.mergeStateStatus === 'BEHIND'` instead of unconditionally. Every
downstream branch — the `update` step, the "behind main; CI will rerun" wait case — already
existed and needed no further change; they simply never fire when `behind` is always `false`.

**2. The main guard replaces "tested against the `main` you are merging into" with "`main`
itself is known-good right now".** Before any merge decision, the cycle reads the latest
*completed* `ci` run on `main`:

```sh
gh run list --branch main --workflow ci --status completed --limit 1 --json conclusion,url,headSha
```

one call, injected through `io.mainCiRun()` exactly like every other GitHub read `cycle.mjs`
makes, so `cycle.test.mjs` stays offline. If that run's conclusion is red (failure, cancelled,
timed out, action-required, startup-failure), the cycle merges nothing this cycle — no `merge`,
no `auto-merge` — for any PR, and lists `main is red` under **Needs you** with the run's URL. A
run still in progress does not count (only *completed* runs are read), and no completed run at
all is not evidence of red, so a brand-new repository is never blocked by this guard. Once a
later completed run on `main` is green, the guard clears itself the very next cycle — nobody
resets it by hand, matching every other state in ADR-0034: an owner (the reconciler) and a way
out (a green run) that fires without a person.

Everything else the cycle does — reviewing, dispatching implementors, resolving conflicts,
pushing to Jira — carries on while the guard holds. Only landing stops.

**3. Path-disjoint stories are why this is safe enough to ship without a merge queue.** A real
merge queue (GitHub's, on an organization-owned repo, still gated behind `mergeQueue`) tests
each candidate on top of the ones ahead of it before landing it — the strongest guarantee, and
the one this repo cannot have while User-owned (`docs/sdlc.md`, `AGENTS.md`). Dropping strict
up-to-date protection without a queue accepts a narrower guarantee: CI has tested the PR
against *some* recent `main`, and the boundary check that CI and the merge bar both run
(`scripts/check-boundaries.mjs`'s scope, `docs/sdlc.md`'s "one issue, one branch, one PR, one
owner") keeps two ready PRs from editing the same file, which is the shape of conflict a
missing rebase would actually catch. The main guard catches the case that check cannot: a merge
that was fine on its own broke something structural (a contract, a boundary, a build) once
combined with something that landed just before it. Reading main's own CI, rather than trying
to re-simulate the merge, is cheap (one `gh run list` call) and exact (it is the same `ci` job
this repo already trusts everywhere else).

## Consequences

- Landing throughput is no longer capped at one merge's worth of BEHIND-refresh CI per cycle.
  A cycle can land every PR that is already green, mergeable, non-conflicting and signed, in
  review order, in one pass.
- A PR can now merge against a `main` newer than the one its CI ran against. The main guard
  bounds the blast radius: if that combination breaks `main`, the very next completed `ci` run
  says so and the cycle stops landing anything else until a person (or a fix PR) makes `main`
  green again. Nothing merges silently onto a broken `main`.
- `docs/ci-contract.md`'s `gh api` example for `required_status_checks` changes from
  `-F strict=true` to `-F strict=false`; the required status itself (`ci`) is unchanged.
- Turning `requireUpToDate` back on (independent of the GitHub setting) is a one-line
  `models.json` edit, not a code change, if the repo owner ever wants the old serial refresh
  back without re-enabling `strict` in GitHub — though the two are meant to move together.
- The review order (ADR-0025 §2, disturbance-descending) still decides which PR is *read* and
  signed first; it no longer decides which one is *allowed* to merge first, since a BEHIND PR
  merges without waiting its turn. A PR still cannot be signed while conflicted (ADR-0025 §5),
  and disturbance still measures real risk — two PRs whose files overlap — which this ADR does
  not touch.

## Rejected

- **Leave `strict=true` and just widen `reviewLanes` or the refresh count.** Refreshing more
  than one BEHIND branch per cycle reintroduces the exact livelock ADR-0025 exists to prevent:
  every refresh invalidates approvals elsewhere in the queue.
- **Drop the main guard and rely on CI alone.** CI having passed on the PR's own branch says
  nothing about the `main` it is about to land onto, which is precisely the guarantee `strict`
  was providing. Removing `strict` without a replacement trades a slow safety net for none.
- **Re-simulate the merge (a local `git merge --no-commit` check) instead of reading main's CI.**
  A clean textual merge does not mean the result builds or passes tests; only running CI proves
  that, and re-running CI per candidate is the cost this ADR is trying to avoid paying serially.
  Reading main's own already-scheduled `ci` run is free by comparison.

## How we would know this was wrong

1. The main guard fires often — `main` goes red from ordinary landings more than rarely. Then
   path-disjointness is not protecting as much as this ADR assumes, and either `requireUpToDate`
   goes back to `true` or a real merge queue (post org-transfer) replaces this mechanism
   entirely.
2. A red main run sits unaddressed for a long time with pull requests piling up unmerged behind
   it. Then the guard needs its own grace period or escalation, the way `redGraceMinutes` gives
   a returned PR one, rather than blocking indefinitely.
3. `requireUpToDate false` merges a PR that turns out to have silently depended on ordering
   with another PR merged after its own CI ran, and the main guard did not catch it because both
   halves individually kept `ci` green. Then the boundary check is not sufficient evidence of
   independence and needs a stronger signal than disjoint paths.
