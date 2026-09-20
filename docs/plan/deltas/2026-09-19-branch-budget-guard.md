# Plan delta — 2026-09-19 (a gate that measured the wrong branch held the landing)

> Out-of-cadence planner pass, second of the evening. Trigger: MARXY-140 escalated on attempt 1
> (PR #101 at `9081422`, reviewer verdict `escalate`) because its criterion 2 and its own
> instructions cannot both be true. No phase moves, no scope cut, no ADR. One new story, one story
> amended, nothing dropped. This delta does **not** revisit
> `docs/plan/deltas/2026-09-19-marxy-26-split.md`: the MARXY-26 split stands exactly as written, and
> this is only about getting it onto `main`.

## What happened

MARXY-140 is a landing story: it commits the planner's working-tree board edits so that
`scripts/check-story.mjs`, which reads `docs/plan/jira-issues.csv` from the branch it is checking,
can see MARXY-26's narrowed paths and the four new rows. Its diff is +710 lines, all of it plan text,
and the story tells the implementor in its own Description to carry that text **verbatim**.

Criterion 2 says `node orchestration/phases.test.mjs` is green. It is 10 pass, 1 fail:

```
✖ the branch diff stays under 600 lines and omits the discarded extras
  AssertionError: diff is +710, want under 600
```

Both ways out are closed to the implementor. Trimming the text is forbidden by the story. Editing
`orchestration/phases.test.mjs` is outside the story's `Paths`. The reviewer was right to escalate
rather than return: a second attempt by the same implementor under the same instructions produces the
same tree. This is the same shape as the MARXY-26 escalation the landing exists to resolve — a row
whose acceptance lives outside its boundary — and it is a planner defect, not an implementor one.

## The real defect: a one-branch budget committed as a standing test

The failing assertion is **MARXY-107's acceptance criterion 7**, written for one branch after PR #52
was discarded at +1370, and committed to `orchestration/phases.test.mjs` as a permanent test. It has
three properties that make it wrong as a standing gate, and only the third is about MARXY-140:

1. **It does not know whose branch it is measuring.** `git diff --stat origin/main...HEAD` measures
   whatever is checked out. MARXY-107's budget was a statement about MARXY-107.
2. **It never runs in CI on the branches it now hits.** `pnpm test` runs `orchestration/*.test.mjs`
   inside the `fast` job, and `fast` is skipped when `scripts/ci-changes.mjs` reports `docs_only`. So
   on exactly the class of branch this fires on — a docs-only plan landing — the red test is
   invisible to the pipeline and shows up only in an implementor's worktree. `pnpm precheck` is green
   on PR #101 for the same reason. A gate that is red locally and absent in CI teaches the fleet to
   ignore local reds.
3. **It counts lines it cannot judge.** `docs/conventions.md`'s rule — "over ~600 changed lines or
   two concerns → split before review" — is about how much *work* a reviewer can hold in their head.
   Six hundred lines of TypeScript is two concerns. Six hundred lines of a board row and six task
   cards is one concern that happens to be verbose, and splitting it is worse than not splitting it.

Note that the second half of the same test — that no `docs/plan/deltas/2026-09-18-*.md` file comes
back — **is** a genuine repository invariant and stays unconditional. The two halves were written in
one criterion and have nothing to do with each other.

## The decision

The reviewer offered three resolutions. I am taking the third now and the first next, and rejecting
the second outright.

**Rejected: split the landing into rows-plus-deps (+258) and cards (+472).** It buys a number by
leaving `main` in a state the repository does not otherwise allow — board rows whose task cards are
not there — for however long the second PR takes. `check-story.mjs` reads the CSV, so the window is
one in which a story can be dispatched against a row with no card. Paying a correctness cost to
satisfy a gate that is itself wrong is the wrong trade twice.

**Now: MARXY-140's criterion 2 is restated to the two tests it always meant**, and the overrun is
accepted on the record. Criterion 2 now requires `node scripts/check-deps.mjs` green and
`node --test --test-name-pattern 'the committed board' orchestration/phases.test.mjs` green with zero
failures — the two committed-board invariants (`every CSV story is in exactly one phase`, `no story
depends on a story in a later numbered phase`) that the criterion was written to check and that the
reviewer has already verified pass at `9081422`. It also says, in the criterion itself, that exactly
one test in that file fails on this branch, which one, and at what number, so the next reviewer is
checking a stated expectation rather than deciding again. Precedent for the size: MARXY-131 landed at
+598 and MARXY-125 at +398, so no earlier landing reached this edge; this one did because the split it
carries is six cards rather than two. Widening `Paths` below takes the branch from `+710` to roughly
`+1050`, which is the honest number to state in the PR body and in the criterion: this pass makes the
overrun larger, not smaller, and says so rather than trading correctness for a number.

**Next: MARXY-142 fixes the guard** so that no landing story meets this again. It moves the decision
into a pure `orchestration/branch-diff.mjs` and counts insertions **only in files outside the plan
surface** — `docs/plan/`, `orchestration/deps.json`, `orchestration/jira-map.json`,
`orchestration/results/`, `CHANGELOG.md`. Everything else keeps the 600 limit. That is deliberately
not a docs-only exemption: a branch that puts +601 lines of `packages/` or `apps/` or
`orchestration/*.mjs` code alongside plan text is judged exactly as it is today, which is the half of
the PR #52 lesson worth keeping. Its acceptance is two-sided — 599 passes, 601 fails, in three
different source locations — so the story cannot be completed by deleting the assertion, which is the
obvious failure mode when a story is allowed to edit a test.

**MARXY-142 depends on MARXY-140, and that ordering is forced, not chosen.** MARXY-142's own CSV row
only reaches `main` inside MARXY-140's commit, and `check-story.mjs --strict` on MARXY-142's branch
reads the CSV from that branch. So the guard cannot be fixed before the landing it would unblock.
That is also why the fix is not simply folded into MARXY-140: a story that edits the test it is
judged by has no boundary, which is what PR #87 was returned for and what
`docs/plan/deltas/2026-09-19-marxy-83-paths.md` is about. The correct order is: land the board with
the overrun stated, then fix the gate under its own key with its own two-sided tests.

## The second blocking note: five keys would have landed unmapped

The reviewer's note 2 is a straightforward planner error and is fixed by widening `Paths`. My working
tree also edits `orchestration/jira-map.json` with the five placeholder→key entries for MARXY-137
through MARXY-141 (now six, with MARXY-142). That file was not in MARXY-140's `Paths`, so the
implementor correctly left it out — but `orchestration/jira.mjs` reads that map to know a placeholder
row already has an issue, and both landings MARXY-140 names as its template carried it (`4dd7ee0` for
MARXY-131, `389baec` for MARXY-125). Without it, a `bootstrap` or `sync` from a clean checkout has
nothing telling it these issues exist.

`Paths` gains three files in total: `orchestration/jira-map.json`, this delta, and
`docs/plan/deltas/2026-09-19-marxy-83-paths.md`, which has been sitting untracked in the working tree
since the MARXY-83 correction landed as `a815cea`/`681b6e1`. Leaving a planner's reasoning on a disk
somewhere is precisely the state a landing story exists to end, and it is 50 lines.

## Re-sequencing and dependency edits

| Story | Was | Now | Why |
| --- | --- | --- | --- |
| MARXY-140 | none | none | Unchanged. Still first; nothing may start before it |
| MARXY-142 | — | 140 | Its own board row only exists on `main` after the landing |

Phase: MARXY-142 is in the `ops` lane, so it never holds a numbered phase and is never held by one
(MARXY-107). Nothing else moves. MARXY-26, MARXY-137, MARXY-138, MARXY-139 and MARXY-141 keep the
dependencies the 26-split delta gave them.

## Risks that moved

- **Down:** a class of gate — one written as a per-branch acceptance criterion and then committed as
  a standing test — stops being able to hold an unrelated branch. MARXY-142 is the only member of the
  class I can find today; if a second appears, the rule to write down is that a criterion naming
  `origin/main...HEAD` belongs in the story's PR checklist, not in a committed test.
- **Down, slightly:** the five (now six) new keys stop being mapped only in one working tree.
- **Up, mildly:** MARXY-140's criterion 2 now permits a named red test. That is a precedent worth
  watching — the honest version of it is that the criterion names the failure, the number and the
  story that fixes it, so it expires. If MARXY-142 does not land, the tripwire below fires.
- **Unchanged:** no source file, no document byte, no network, no telemetry. MARXY-142 touches one
  new module, one test file and one documentation page.

## Tripwires checked (`docs/roadmap.md`)

None fired. Worth stating explicitly that this is **not** the "CI never writes a higher recorded
number to make a red gate green" tripwire, because it looks like it at a glance: nothing here raises
a budget to make a red gate pass. The 600 stays 600 for every line of code it was written about, and
the change is to what is counted, argued from what the reviewer can hold in their head rather than
from the convenience of the branch in front of us. If the fix had instead been "raise the limit to
800", that would have been the tripwire.

## How we would know I was wrong

1. **MARXY-142 does not land within two merges of MARXY-140.** Then "accepted overrun, fixed next
   story" was a way of not deciding, and the criterion-2 restatement is a permanent hole.
2. **A plan landing appears whose plan-surface diff really is too big to review.** Then the size of
   the thing, not its file extension, was the problem, and the plan surface needs its own budget —
   something like "no more than N new cards in one landing" — rather than an exemption.
3. **MARXY-142's two-sided tests pass with the guard deleted.** Then the acceptance was not two-sided
   enough, and any future story that edits its own check needs a mutation run rather than a pair of
   unit cases.
4. **A source change lands inside a plan landing.** Then `isPlanSurface` is too generous —
   `orchestration/deps.json` and `orchestration/jira-map.json` are the two non-`docs/` entries and
   they are the ones to reconsider first.
5. **The next landing story escalates on something else in its own instructions.** Then the problem
   is the landing-story pattern rather than this gate, and the answer is for the planner to commit
   its own board edits under a standing `plan` key instead of writing a story for each one.
