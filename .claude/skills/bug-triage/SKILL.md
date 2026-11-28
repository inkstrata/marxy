---
name: bug-triage
description: Use after bug-verify has given every finding of a Marxy hunt a verdict, or when the owner asks to triage a hunt. The orchestrating session (not a subagent) turns confirmed findings into ready rows in work/todo.md, records every finding's outcome in triage.md, and lands the hunt as one pull request.
---

# Bug triage: the last step of the bug cycle

Triage is judgement, so the orchestrating session does it, not a subagent. It reads `findings.md` and
`verification.md` (format in [../bug-catch/format.md](../bug-catch/format.md)) and decides what becomes
work.

## 1. Decide each finding

| Verdict | Outcome |
| --- | --- |
| `CONFIRMED` | a tracker row, or merged into another row with the same fix |
| `PLAUSIBLE` | a row under **To try in a real window** when a person or the real window can drive it; a row under **Later** when only more time can; dropped if its severity is S3 |
| `DUPLICATE` of a todo row | the row's `Why` gains the finding's id and anything new it showed |
| `DUPLICATE` of a finding | follows the finding it duplicates |
| `NOT-REPRODUCED`, `BY-DESIGN` | dropped, with the reason in `triage.md` |

Where catcher and verifier disagree on severity, take the verifier's unless the probe shows otherwise.
Read the probe output of every S1 before it becomes a row.

## 1a. Causes, before the rows

Group the confirmed findings by mechanism: the same owner module (`docs/principles.md`, one owner per
concern), the same missing guard, or the same data path. A group of two or more findings, or any finding whose
real fault is a missing guard, becomes one **cause row**:

- **What**: the mechanism as the reader meets it.
- **Why**: starts `Covers: <finding ids and/or row ids>;`, then where the cause is.
- **The fix** (in the row): made at the concern's single owner, plus a guard that fails on the whole class (a
  test, a `pnpm check` rule or a gate).
- **The symptoms**: each finding's reproduction becomes one of the row's acceptance tests.

Symptoms a cause row covers get no rows of their own; `triage.md` says "merged into <cause row>". An existing row
that is the real cause (a planned structural row) absorbs its symptoms instead: its Why gains them and it moves
up. A finding with no group stays an ordinary row. Rows are ordered by "Order of work" in `scripts/auto/README.md`.

## 2. Write the rows

Ready to tackle means a builder can start without hunting again. Each row:

- **Id**: `B<n>`, the next number not used in `work/todo.md` (ids are never reused; check
  `git log -p work/todo.md` for `| B`).
- **What**: what the reader meets, as in the finding's title.
- **Why**: severity, then where the cause is (`path:line`), then the proof:
  `S1 freeze; export/page.ts:88; hunt-01 EXP-03, probe probes/EXP/pdf-freeze.verify.mjs`.
- **Size**: S, M or L, from the fix hint and the code.
- **Branch**: empty.

Placement: S1 rows at the top of **Next**; S2 under **Next** after them; S3 under **Later**. Findings that
one change would fix share one row (name every id in `Why`). If **Next** has more than about fifteen rows,
put S2 rows that touch no promised behaviour under **Later** and say so in `triage.md`.

`pnpm work todo --check` must pass after the edit.

## 3. Write triage.md and the account

`triage.md`: one table row per finding, in id order: id, title, catcher's severity, verdict, outcome
(`B4`, `merged into B4`, `adds to R10`, `dropped: not reproduced in 3 runs`). Below it, what no catcher
reached.

The hunt's `README.md` gains the counts: findings, verdicts and rows made, and the yield per axis from
`node .claude/skills/bug-catch/finding.mjs yield <run>/findings.md <run>/verification.md`, with a column
for the rows each axis's findings became. The next hunt's planner reads this table first.

It ends with **For the next hunt**, in three short lists the planner can act on:
- **Extend**: axes that found bugs alone, and the variant to try (narrower, a sibling area, the same cause
  elsewhere).
- **Drop**: axes that found nothing alone, and why (no bugs there, or a lens the model could not use).
- **Converged**: areas two or more axes covered and found clean, and which way each went (an Opus catcher,
  the real window or WebKit, or closed).

## 4. Land the hunt

1. `pnpm verify --tier changed --base origin/main` in the hunt worktree (it touches only `work/`, so this is
   quick), and `pnpm work todo --check`.
2. Commit on `agent/hunt-<nn>`: `docs(work): bug hunt <nn>: <n> findings, <m> rows`. Push.
3. Open a pull request against `main`, never stacked on another open branch: a stacked pull request
   merges into its base, not into `main`, when the base lands first by squash. Open it: the rows made with their severities (S1 first), the counts, and what
   was not checked. Add a row to `work/ledger.md` in the same pull request.
4. Merge it once CI is green and you are confident in it (Marxy's rule), unless it needs the owner's approval.
5. Tell the owner the S1 rows by name in the final message: they are what to build next.
