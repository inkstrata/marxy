# Plan delta — 2026-09-18 (relax macos/linux gates when they cannot change)

> Trigger: Ian asked for a story that skips the macos and linux CI checks when they have
> already run and nothing that would change their result has changed, or when the PR has
> nothing those checks would see. Not a cadence planner pass. Previous delta:
> `2026-09-18-in-review-occupies.md`. No product code.

## Tripwires checked (`docs/roadmap.md`)

| Tripwire | State |
| --- | --- |
| Cold start > 500 ms after Phase 2 | Fired early, still Ian's. Unchanged. |
| Weight-harness residual > 25 on real Linux | No data. |
| `justif/core` cannot set ragged text | Not fired. |
| Reviewer fails the palette task at review #2 | Not reached. |
| Authoring re-enters scope; WebKitGTK < 2.50; single Tauri engine; first reaction about a feature | Not fired. |

Taste review: nothing visual. No ADR. No scope cut. Standing decisions from the
low-compute / parse-on-gates / in-review-occupies deltas are not reopened: 90 owns
the apt restore; 91 waits on 90 and on `ci.yml` being free; 36 stays blocked; 59
stays escalate; CSV uses 86/87 only.

## Why this story

The `gates` matrix is the only job that spends a macos runner. It builds the
desktop binary and measures startup. `scripts/ci-changes.mjs` already skips it
when every changed file is `docs_only`, but `web` is broad: a `scripts/check-pr.mjs`
or `CHANGELOG.md` line on a branch that also has rust still diffs as needing
gates against `main`, and workflow `concurrency: ci-${{ github.ref }}` with
`cancel-in-progress: true` then kills the nearly-finished macos job.

Branch protection (MARXY-6 / MARXY-82) requires the check names
`gates (macos-latest)` and `gates (ubuntu-latest)`. A skipped matrix job leaves
those names pending, so a honest skip today blocks the merge. The aggregator
`ci` job already treats skipped as fine; it is not the required check.

`scripts/gate-perf.mjs` `checkWorkflow` forbids `if:`, `continue-on-error`, and
`|| true` on the measurement / selftest / `gate:perf` steps. Skip must be
job-level, not step-level, and that file is not in this story's paths.

## Decision — one Phase 0 story, after 91, no ADR

One mechanism: classify gates-relevant files, skip the expensive job when the
PR has none of them or when a real matrix run (not the stand-in) has already
succeeded — or is still running — for the same relevant tree, and post the
required check names from a cheap sibling job.

Reuse is only a *real* success: a job named `gates (macos-latest)` that ran on
a macos runner, and the ubuntu cell on ubuntu. The stand-in must not count as
evidence. An in-progress real run is mirrored, not replaced by a green stand-in
and not cancelled by a docs push.

91 still owns the next `ci.yml` edit (parse measurement). This story depends on
91. 62 / 65 / 90 are path collisions, not deps.

## Story changes

### New (Phase 0, `gates`, `agent-loop`)

- **MARXY-105** (was `MARXY-NEW-relax-os-gates`) — skip or reuse the macos/linux
  `gates` jobs when they cannot change result; still satisfy the required check names.

### Dependencies

| Edge | Why |
| --- | --- |
| `MARXY-105 → MARXY-91` | 91 lands the parse step on both gates runners first; one owner of `ci.yml` at a time. |

No drop. No edit to 82 (required names stay). No edit to 55 / 63 / 70
(`gate-perf.mjs` stays theirs).

## How we would know I was wrong

1. **The PR skips `gates` and merge-bar / branch protection stay red.** Then
   the sibling job did not reuse the required names, or it was `skipped`
   instead of `success`.
2. **A CHANGELOG push cancels a running macos build and starts another.** Then
   workflow-level cancel is still keyed only on `github.ref`.
3. **`pnpm gate:perf --selftest` goes red.** Then a measurement step grew an
   `if:` and this story edited the wrong file — revert and keep skip at job
   level.
4. **This story is dispatched while #23, #28, #39, or 91 still own `ci.yml`.**
   Then the 91 dep or path occupancy is missing.
