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

The hunt's `README.md` gains the counts: findings, verdicts, rows made, and per domain how productive it
was, so the next hunt can choose its domains.

## 4. Land the hunt

1. `pnpm verify --tier changed --base origin/main` in the hunt worktree (it touches only `work/`, so this is
   quick), and `pnpm work todo --check`.
2. Commit on `agent/hunt-<nn>`: `docs(work): bug hunt <nn>: <n> findings, <m> rows`. Push.
3. Open a pull request against `main`, never stacked on another open branch: a stacked pull request
   merges into its base, not into `main`, when the base lands first by squash. Open it: the rows made with their severities (S1 first), the counts, and what
   was not checked. Add a row to `work/ledger.md` in the same pull request.
4. The owner merges (Marxy's rule). Do not merge it.
5. Tell the owner the S1 rows by name in the final message: they are what to build next.
