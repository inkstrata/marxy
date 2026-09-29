# ADR-0043 — When main turns red, revert the first red commit and reopen its story with the work kept

- **Status:** proposed (MARXY-335); the repo owner has not read it yet
- **Date:** 2026-09-29
- **Amends:** ADR-0040 §2 (the main guard names a red `main` and waits for a person; it now also
  acts on it). Nothing else in ADR-0040 is contradicted.

## Context

ADR-0040 turned off strict up-to-date protection, so a green pull request can land on a `main` it
was never tested against, and `main` can go red after a merge. The guard it added stops every other
merge and names the red run under **Needs you**. That is a safe stop and a slow one: nothing lands
until a person finds which merge broke `main`, reverts or fixes it, and waits for a green run, while
every other ready pull request queues behind it. The repo owner's instruction (2026-09-29): revert
the merge that broke `main` first, and send its story back for fixes with its code kept, not
discarded.

Two facts make this mechanical. Pull requests are squash-merged, so one commit on `main` is one pull
request, and its subject ends `(MARXY-n) (#PR)`; the merge deletes the branch. And since MARXY-334
`ci` runs once per commit on `main`, so "the first red commit" is exact: the oldest red run in the
newest streak whose parent's completed run is green.

## Decision

**1. Find the first red commit** (`revert.mjs` `firstRedCommit`) from `gh run list --branch main
--workflow ci --status completed`, newest first. Cancelled runs say nothing and are skipped. The
answer is exact only when the green run before it belongs to the commit's parent; otherwise (no
green run in the list, or a commit with no completed run between) the cycle names the doubt under
**Needs you** and reverts nothing. It also refuses a commit with no story key in its subject, and a
revert commit itself, which a person handles: reverting a revert is how a loop starts.

**2. Open the revert** (`revert.mjs` `openRevert`), once. If no `revert/<KEY>-…` pull request is
open and `main` carries no `revert:` squash for that subject, a throwaway worktree off `origin/main`
gets `git revert --no-commit`, one commit titled `revert: <original subject minus (#n)>`, a push and a
`gh pr create` whose body is the house template. A revert that conflicts anywhere but the story's board
rows is aborted, nothing is pushed, and **Needs you** names the files. Two files differ from a plain
revert on purpose: the story's rows in `docs/plan/jira-issues.csv` and `orchestration/deps.json` stay
(the story must remain dispatchable), and `changelog.d/<KEY>.md` becomes one `Reverted: …` line,
because `check-pr` requires a changelog entry on every pull request and reads a deleted fragment as
none. The story's record gets `revert: { sha, pr, runUrl, jobs }`.

**3. Land it without a reviewer, only when it is exactly the inverse** (`merge-bar.mjs`
`verifyRevert`). The expected tree is the one `git revert` makes (`git merge-tree` with the named
commit as merge base); the head may differ from it only in the fragment (valid, one line) and the two
board files (byte-identical to the base). Then the pull request needs no signature, no result file
and no story paths, and the cycle merges it even though `main` is red. Red or pending checks and
CODEOWNERS still hold it. A revert that is not the exact inverse is an ordinary pull request: it
waits for a person, and the hold names why.

**4. Reopen the story with the work kept.** When the revert has merged, the story moves Done → todo
(`machine.mjs` `reopenEvents`; escalate once attempts are spent; blocked for a person when nothing
can dispatch it) with `returned.why` naming the red run's URL and its failing jobs, and the note the
next implementor reads says the same. Attempts are not reset. The implementor's worktree is cut from
`origin/main`, never from the merged branch, and the reverted change is applied again by reverting the
revert (else cherry-picking the original squash); if that no longer applies it is abandoned whole and
the prompt says where the work is. The story's old PRs are hidden from settling, and `mergedOnMain`
ignores a story whose newest subject is a revert, or it would settle straight back to Done.

## Consequences

- `main` is green again as soon as one revert pull request's CI passes, and other stories can land
  again without a person: the guard clears itself on the next green run, as before.
- A merged story can be un-merged by the cycle. The safety is that the inverse is verified, not
  trusted, so the only change it can make to `main` is undoing one commit that `ci` called red.
- The changelog carries a `Reverted:` line for a story until it lands again and its own entry
  replaces it. A release cut in between would show it.
- One extra `gh run list` and one extra `gh run view` per red cycle; nothing when `main` is green.
- Revert pull requests are invisible to adoption and review: they are not stories.

## Rejected

- **Fix forward, keep the guard as it is.** Waiting for a person is the cost this removes, and a
  fix that has to be written against a broken `main` is slower than a revert.
- **Revert the newest commit, or every red commit.** A later red commit is red because of the first
  one, or for a reason of its own that reverting the first will show; only the first is certain.
- **Exempt a revert from the changelog check.** That needs `scripts/check-pr.mjs` changed, which
  this story may not touch, and a missing entry would be silent forever.
- **A plain revert, board rows and all.** It deletes the row of an out-of-plan story and the story
  can then never be dispatched again.
- **Cherry-pick the original as the first choice.** It duplicates the story's board rows on top of
  the ones left on `main`; reverting the revert does not touch them.

## How we would know this was wrong

1. Reverts are opened for commits that were not the cause (flaky `ci`, an infrastructure failure), so
   good work is un-merged. Then a red run needs a retry before a revert, or a person's confirmation.
2. Reapplied work conflicts more often than it applies. Then the note is the only thing kept and the
   design should keep the branch instead.
3. A reopened story loops (merge, red, revert) past its attempt limits. Then the failure text is not
   enough for the implementor, and the story needs the planner rather than another try.
