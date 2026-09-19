# Plan delta — 2026-09-18 (parse measurement on both gates runners)

> Seventh delta of the day. Previous: `2026-09-18-paths-and-sequence.md`. Trigger: MARXY-59
> escalated at attempt 2 (PR #15, `4df85c4`). MARXY-36 is already split; this pass does not
> touch that split except to keep 86/87 in the CSV and 88/89 out of it.

## Tripwires checked (`docs/roadmap.md`)

| Tripwire | State |
| --- | --- |
| Cold start > 500 ms after Phase 2 | Fired early, still Ian's. Unchanged. |
| Weight-harness residual > 25 on real Linux | No data. |
| `justif/core` cannot set ragged text | Not fired. |
| Reviewer fails the palette task at review #2 | Not reached. |
| Authoring re-enters scope; WebKitGTK < 2.50; single Tauri engine; first reaction about a feature | Not fired. |

Taste review: nothing visual merged without a queue entry. No ADR proposed.

## Decision 1 — MARXY-59 stays escalate; a follow-up owns `ci.yml`

PR #15 kept `required: true`, `enforceTwoTier`, and main's 30 % band. Criterion 4 is now false
and cannot be restored inside

`fixtures/perf-budgets.json, scripts/gate-perf.mjs, packages/core/src/parse/parse.test.ts`

MARXY-74 moved `pnpm test` into the ubuntu-only `fast` job. The gates job never writes
`parse_long_technical_ms`. macos failed with the metric missing. Flipping `required` back to
`false` would re-open attempt 1. Inventing a second measurement site inside the gate is a
new design on a story that already has one.

**Do not re-dispatch MARXY-59. Do not ask its implementor to revert `required`.** After the
follow-up merges, rebase PR #15 and re-review that new head.

New row, phase 0, `speed`:

| Key | Paths | Deps |
| --- | --- | --- |
| `MARXY-91` | `.github/workflows/ci.yml`, `scripts/measure-parse.mjs`, `docs/design/10-gates-and-testing.md` | MARXY-11, MARXY-55 |

The script writes **only** `results/perf-parse.json`. MARXY-59 already merges that snapshot.
The three 59 files stay out of Paths so the stories cannot collide.

## Decision 2 — MARXY-70 still re-derives the ubuntu parse baseline

Unchanged ownership. Criterion 11 stands (13–27 ms vs 21.5 ms). The follow-up is now a
dependency so 70 waits for both-runner observations. Do not loosen 59 to make 70 easier.

## Decision 3 — CSV / deps / cards use 86/87; Jira 88/89 stay out of the CSV

Confirmed on the board: MARXY-86 and MARXY-87 are the palette slices (To Do). MARXY-88 and
MARXY-89 are Done duplicates of those summaries, already commented. They are not in the CSV,
not in `deps.json`, not in `jira-map.json` as live rows, and have no task cards. A raced
CSV row that tried to reuse MARXY-88 for the Linux apt fix is withdrawn from that key.
The Linux work, if it needs a board row, is MARXY-90 — not 88.

## Story changes

### New (phase 0, `speed`)

- **MARXY-91** — measure parse on both gates runners before `pnpm gate:perf`.

### Edited

- **MARXY-59** — description records the escalate and the follow-up. Paths and `required: true`
  unchanged. Status stays `escalate`.
- **MARXY-70** — depends on the follow-up; criterion 11 unchanged.

### Dependencies

| Edge | Why |
| --- | --- |
| `MARXY-91 → MARXY-11, MARXY-55` | Parser and two-tier gate exist. |
| `MARXY-59 → the follow-up` | Rebase and re-review after the workflow lands; do not re-implement. |
| `MARXY-70 → the follow-up` | Re-derive parse from both-runner observations. |

No scope cut. No taste-queue row. No new ADR.

## How we would know I was wrong

1. **`--selftest` cannot see the gates step** because `checkWorkflow` in `gate-perf.mjs` is
   the only parser and this story must not edit that file. Then the selftest reads `ci.yml`
   itself, which is what the card already says.
2. **Ubuntu still dies before the new step** on glib-2.0. That is MARXY-90, not a miss of
   this story; the workflow check still proves the step is unconditional.
3. **A second `jira.mjs sync` creates another palette pair.** Then stop, and do not put
   88/89 in the CSV.
