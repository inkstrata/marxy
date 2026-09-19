# Plan delta — 2026-09-19: the review's recommendations as stories

The 2026-09-18 whole-project review made recommendations; this pass turns the ones that are not
yet on the board into stories (MARXY-116). No product scope changes, and no story is reopened.

## Already done or already on the board

| Recommendation | Where it stands |
| --- | --- |
| Loop merge-gate fixes (pinned merges, one refresh, merge-tree approvals, liveness, dispatch, reviewer family) | MARXY-106, PR #70 |
| Ops lane so Phase 1 is not held; board committed; state.json local | MARXY-107, merged |
| Theme, fonts, Knuth–Plass, provenance in the DOM | MARXY-20, 21, 23, 75, merged |
| Headless render and the aesthetics gate; screenshot baselines; taste review #1 | MARXY-25, 30, 31 — next in Phase 1 |
| The one shell-api amendment that unblocks the browser harness | MARXY-94 (human-gated) → MARXY-95 |
| Park the Phase 3 and 4 design runway; close the orphaned palette PR | PR #42 draft; PR #30 closed |

## New stories, all in the ops lane

| Key | Story | Depends on |
| --- | --- | --- |
| MARXY-117 | Name board drift every cycle and hold dispatch while the orchestrator checkout is stale | 106 |
| MARXY-118 | Remove a story worktree when its PR merges or closes, and report strays | 106, 117 |
| MARXY-119 | Make path overlap understand globs | — |
| MARXY-120 | Fire the planner when process work outnumbers product work | — |
| MARXY-121 | One command from green to In Review | — |
| MARXY-122 | Land pull requests through the GitHub merge queue (human-gated) | 106, 117, 118 |

MARXY-117 exists because of what happened today. The orchestrator checkout sat fourteen commits
behind `origin/main` with uncommitted board edits, so the fleet dispatched from a board without
the ops lane. The planner's own after-79 delta noticed and could not act.

## Sequencing

The ops lane never holds a phase, and a phase story wins a contested path (MARXY-107). None of
these six compete with MARXY-25, 30 or 31 for a path. MARXY-117, 118 and 122 edit `cycle.mjs` and
serialise behind MARXY-106. MARXY-119, 120 and 121 can start now.
