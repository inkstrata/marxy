# Plan delta — 2026-09-18 (low-compute: who owns the apt restore)

> Eighth delta of the day. Previous: `2026-09-18-parse-on-gates.md`. Trigger: a Sonnet
> planner pass died on the usage limit before it wrote. Parse-on-gates already landed:
> MARXY-59 stays escalate; MARXY-91 exists; do not re-dispatch 59; do not flip
> `required:false`; CSV uses 86/87 only (not 88/89); MARXY-36 stays blocked. This pass
> answers the remaining open plan questions. No product code.

## Tripwires checked (`docs/roadmap.md`)

| Tripwire | State |
| --- | --- |
| Cold start > 500 ms after Phase 2 | Fired early, still Ian's. Unchanged. |
| Weight-harness residual > 25 on real Linux | No data. |
| `justif/core` cannot set ragged text | Not fired. |
| Reviewer fails the palette task at review #2 | Not reached. |
| Authoring re-enters scope; WebKitGTK < 2.50; single Tauri engine; first reaction about a feature | Not fired. |

Taste review: nothing visual merged without a queue entry. No ADR proposed. No scope cut.

## Decision 1 — MARXY-90 owns the apt restore; do not create a third story

Two open PRs restore Linux webview deps after MARXY-74 (`#29`) swapped `apt-get` for
`awalsh128/cache-apt-pkgs-action` and `glib-2.0.pc` vanished from the cache:

| PR | Labelled | Head | What it is |
| --- | --- | --- | --- |
| [#32](https://github.com/inkstrata/marxy/pull/32) | MARXY-74 | `1aef036`, fully green | Thin hotfix: `apt-get` again, `dbus` kept, CHANGELOG. No `check-workflows.mjs`, no glib probe. |
| [#39](https://github.com/inkstrata/marxy/pull/39) | MARXY-90 | `283fef2`, fully green | The CSV row: apt-get, dbus, glib probe, `scripts/check-workflows.mjs`, `pnpm check:workflows`. Cursor trailer on the only commit. CODEOWNERS. |

MARXY-74 is not a board row. It is the already-merged design-runway / hygiene squash (`#29`,
`a859f6b`). Putting it back in the CSV would fabricate a plan around landed work, which the
review-throughput delta already refused. PR #32's subject and `Refs: MARXY-74` are therefore
a label on a closed story, not a second issue.

**MARXY-90 is the board row.** Its Paths and acceptance already name the restore, the
allow-list, the probe, and dbus. PR #32 cannot close that row: criteria 1 and 4 would still
be false. A third story would be a third owner of `ci.yml`.

Orchestrator:

- Do not land #32 from the cycle as MARXY-74. Do not open a Jira row for 74. Do not retarget
  #32 to 90 (the tree does not meet 90).
- Prefer #39 as the close of MARXY-90 after Ian strips the trailer and approves on GitHub
  (CODEOWNERS: `.github/workflows`). Then close #32 as a duplicate.
- If Ian wants ubuntu green on `main` tonight, he may squash #32 himself as a **human
  hotfix that closes no board row**. #39 then rebases and still closes 90. Do not mark 74
  done again.
- Reviewer return on #39 (`orchestration/results/MARXY-90.notes.md`): trailer is blocking;
  dbus is on the apt line but nothing goes red if it is deleted. Criterion 3 now names that
  check. Do not re-dispatch 90 to an implementor — Ian authored #39.

## Decision 2 — MARXY-85 stays in review; Ian strips the trailer

PR #31 (`cf3bdb9` + `09ddf60`) is the merge-hook staged-set fix. Ian authored it. The second
commit carries `Co-authored-by: Cursor <cursoragent@cursor.com>`.
`orchestration/results/MARXY-85.notes.md` already says merge-bar will not land it.

Do not re-dispatch. Do not treat ubuntu `gates` red on this PR as a miss of 85: that is
glib-2.0 on `main`, which is 90 / #32. After the trailer is gone and 90 (or the #32 hotfix)
is on `main`, re-run ubuntu.

## Decision 3 — MARXY-9 is Ian on GitHub, not a re-dispatch

PR #37 is signed for `691112c` (`orchestration/results/MARXY-9.approved`) and CI is green
(orchestration-only jobs). `gh pr merge` failed because the base branch policy requires a
review and no GitHub review exists: `reviewDecision` is empty, so `merge-bar` cannot see
`REVIEW_REQUIRED`. This is the MARXY-6 hole (`required_approving_review_count` is 0 and
CODEOWNERS is not armed), not a defect in the diff.

Do not `--admin` merge. Do not re-dispatch. Ian approves on GitHub.

**After it lands, `ready.mjs` closes phase N+1.** Phase 2 (86, 87, and anything else in
`deps.json` phase 2) will not dispatch while phase 0 still has `todo` or `in_progress`,
unless the story carries `cross-phase`. MARXY-36 stays blocked; after 9, the `dropped` label
is enough to keep it off `ready`. Do not add `cross-phase` to the palette slices to sneak
them past the gate this story exists to install.

## Decision 4 — Do not dispatch MARXY-91 while 65, 68, or 90 own `ci.yml`

Unchanged from the invoke. Ubuntu glib is 90 / #32, not a miss of 91. 91's own ubuntu
`gates` job will die in `lint:rust` until 90 (or the #32 hotfix) is on `main`.

`MARXY-91 → MARXY-90` is now a dep, so `ready.mjs` will not offer 91 until 90 is `done`.
65 and 68 are **not** deps: they are path collisions. If either returns without merging, 91
may start once `ci.yml` is free and 90 is done. MARXY-62 also lists `ci.yml` (PR #23, in
review); path overlap covers it the same way. Do not add 62 as a dep.

Do not re-dispatch 59. After 91 merges, rebase PR #15 and re-review that new head.

## Story changes

### Edited (no new rows)

- **MARXY-90** — this row owns the apt restore; #32 is a duplicate labelled with a landed
  key; criterion 3 now names the dbus check.
- **MARXY-91** — depends on 90; do not dispatch while 65, 68, or 90 own `ci.yml`.
- **MARXY-85** — PR #31 exists; Ian authored; trailer on the second commit; do not re-dispatch.
- **MARXY-9** — PR #37 signed and green; Ian approves on GitHub; after land, phase N+1 closes.

### Dependencies

| Edge | Why |
| --- | --- |
| `MARXY-91 → MARXY-90` | Ubuntu `gates` cannot reach the new measure step until glib is findable. |

No new story. No drop. 86/87 unchanged. 88/89 stay out of the CSV. 36 stays blocked.

## How we would know I was wrong

1. **Ian lands #32 and the cycle marks MARXY-74 done.** Then we have invented a board row
   for a squash that already shipped. Revert that status; 90 is still the owner.
2. **91 is dispatched while #39 or #34 or #28 is still open.** Then `pathsOf` is not seeing
   `.github/workflows/ci.yml` as the same path, and that is a MARXY-9 bug, not a missing dep
   on 65/68.
3. **A second `jira.mjs sync` creates a row for 74 or a third apt story.** Then stop, and
   do not put 74 in the CSV.
