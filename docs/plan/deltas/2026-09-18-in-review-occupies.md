# Plan delta — 2026-09-18 (in_review occupies paths)

> Ninth delta of the day. Previous: `2026-09-18-low-compute.md`. Trigger: six merges since
> `lastPlan` (cadence is 5). Planner-trigger also named escalate/blocked MARXY-36 and
> MARXY-59; those were already split/decided in the low-compute and parse-on-gates deltas.
> This pass does **not** re-split them, does **not** re-dispatch 59, and leaves 36
> blocked/dropped. No product code.

## What landed since lastPlan

`merges` 12 → 18. Latest: MARXY-9 (#37), MARXY-68 (#34), MARXY-60 (#18), MARXY-72 (#16),
plus MARXY-5 (#26) and MARXY-61 (#35) in the same window. Board is 18 done.

| Key | What it closed |
| --- | --- |
| MARXY-9 | Phase sequencing on `main`. `ready.mjs` now holds phase N+1 while phase N has `todo` or `in_progress`. |
| MARXY-68 | CommonMark spec in CI. `.github/workflows/ci.yml` is no longer held by 68. |
| MARXY-60 | Maths extension costs nothing when no maths is read. |
| MARXY-72 | `pnpm build` on a machine that cannot paint. `docs/sdlc.md` is free of 72. |
| MARXY-5 | Contracts frozen. |
| MARXY-61 | One parse through `@marxy/core`. |

## Tripwires checked (`docs/roadmap.md`)

| Tripwire | State |
| --- | --- |
| Cold start > 500 ms after Phase 2 | Fired early, still Ian's. Unchanged. |
| Weight-harness residual > 25 on real Linux | No data. |
| `justif/core` cannot set ragged text | Not fired. |
| Reviewer fails the palette task at review #2 | Not reached. |
| Authoring re-enters scope; WebKitGTK < 2.50; single Tauri engine; first reaction about a feature | Not fired. |

Taste review: nothing visual merged that owes a new queue row. MARXY-61 swapped the parse
pipeline; the unstyled render is the same document. Review #0 is still pending. No ADR
proposed. No scope cut — Phase 0 is review-bound, not behind.

## Standing decisions this pass does not reopen

From `2026-09-18-low-compute.md` and `2026-09-18-parse-on-gates.md`:

- **MARXY-90** owns the apt restore. #32 was a human hotfix that closes no board row.
  Prefer #39. Do not invent MARXY-74.
- **MARXY-85** PR #31 exists (Ian); Cursor trailer on a commit; do not re-dispatch.
- **MARXY-91** depends on MARXY-90. Do not dispatch 91 while 62/65/90 own `ci.yml`.
  Ubuntu glib is 90 / #32, not a miss of 91. 68 has landed, so it is no longer a
  `ci.yml` owner.
- CSV uses **86/87 only** (not 88/89).
- Do not add `cross-phase` to sneak palette slices past phase gating.
- Do not propose `--admin` merges. The `--no-merge` cycle is the MARXY-6 hole
  (`reviewDecision` empty, so merge-bar cannot see CODEOWNERS).

## Decision 1 — a small story makes `in_review` occupy paths

`ready.mjs` only treats `in_progress` as busy. This cycle it offered MARXY-8 and MARXY-80.
The orchestrator refused both because they overlap **in_review** paths:

| Offered | Collision |
| --- | --- |
| MARXY-8 | `package.json` on 62 / 66 / 85 / 90 |
| MARXY-80 | `docs/adr/README.md` on 58 (72 freed `docs/sdlc.md`) |
| MARXY-100 | `docs/conventions.md` on 66 |

Folding the fix into MARXY-81 would wait on 80, and 80 is itself path-blocked by 58.
That leaves the hole open for the rest of the review queue. A follow-up that waits
until 81 is done has the same delay.

A new story can start now. Paths are `orchestration/ready.mjs` and a **new**
`orchestration/ready.test.mjs`. `pnpm test` already runs `orchestration/*.test.mjs`,
so the check does not need `package.json` or `orchestration/test`.

| Story | Overlap with the new paths? |
| --- | --- |
| MARXY-80 | No (`review-order.mjs`, `orchestration/test`, `docs/sdlc.md`, ADR-0025) |
| MARXY-79 | No (`cycle.mjs`, `approve.mjs`, prompts, `docs/sdlc.md`, `package.json`) |
| MARXY-85 | No (scripts, `package.json`, the CSV) |
| MARXY-81 | Yes — `ready.mjs`. Sequenced: **81 depends on the new story**. 81 already waits on 80, so it does not start today either way. |

`blocked`, `escalate`, and `done` do **not** occupy. MARXY-36 is `blocked` with
`apps/desktop/src/palette`; if blocked occupied, 86/87 would starve after Phase 0
clears. Phase gating stays `todo` / `in_progress` only (MARXY-9). `in_review` is
finished work waiting to land; it occupies files, not the phase.

Until the new story merges, the orchestrator keeps refusing 8, 80, and 100 by hand.

## Decision 2 — MARXY-100 joins Phase 0; MARXY-75 joins the CSV

MARXY-100 is a live Phase 0 row in the CSV and in Jira, but it is missing from
`deps.json` `phases`. `phaseOf` returns null, so `earlierPhaseOpen` never holds it.
It is offered as if it had no phase. It is now in Phase 0. Path overlap with 66 is
enough; do not add 66 as a dep.

MARXY-75 exists in Jira, in `deps.json` Phase 1, and as `docs/plan/tasks/MARXY-75.md`,
but it was never a CSV row. `stories()` cannot see it, so it can never be dispatched,
and everything that waits on it (20, 23, 26, 34, 37, …) waits forever. The row is
added under the existing key. Do not create a second 75.

## Decision 3 — 36 and 59 stay as the prior deltas left them

- **MARXY-36** stays `blocked` / `dropped`. Acceptance lives on 86/87. Do not
  re-dispatch. Do not add `cross-phase` to 86/87.
- **MARXY-59** stays `escalate`. After 91 merges, rebase PR #15 and re-review that
  new head. Do not re-dispatch 59. Do not flip `required:false`.

## Story changes

### New (Phase 0, `agent-loop`)

- **MARXY-102** (was `MARXY-NEW-ready-in-review-busy`) — `in_review` occupies
  paths. Deps: MARXY-9 (done). 81 gains this as a dep.

### Added to the CSV (existing Jira key)

- **MARXY-75** — provenance in the rendered DOM. Phase 1. Deps already in
  `deps.json` (12, 61 — both done). Waits on the Phase 0 gate.

### Edited

- **MARXY-81** — depends on the occupancy story; still owns `reviewLanes` on
  `ready.mjs` after that story is done.
- **MARXY-91** — 68 has landed; do not dispatch while 62, 65, or 90 own `ci.yml`.
- **MARXY-100** — Phase 0 membership. Do not dispatch while 66 owns
  `docs/conventions.md`.

### Dependencies

| Edge | Why |
| --- | --- |
| `MARXY-102 → MARXY-9` | Occupancy is a one-line change to the `selectReady` 9 landed. |
| `MARXY-81 → MARXY-102` | 81 still edits `ready.mjs` for the count cap; it goes second. |

No drop. 86/87 unchanged. 88/89 stay out of the CSV. 36 stays blocked.

## How we would know I was wrong

1. **`pnpm test` does not run `orchestration/ready.test.mjs`.** Then the house
   glob in `package.json` changed, and the story has to say so — it still must not
   edit `package.json` (85).
2. **81 is offered while the occupancy PR is still open.** Then the new dep is
   missing or `ready.mjs` path overlap is not seeing the same file.
3. **A blocked MARXY-36 analogue puts 86 in `blockedByPaths`.** Then occupancy
   was written as "any non-todo status" instead of `in_progress` + `in_review`.
4. **A second `jira.mjs sync` creates another 75.** Then stop, and do not put a
   placeholder on a key that already exists.
