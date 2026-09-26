# Resolve one merge conflict

You are resolving a pull request that conflicts with `main`. You are not re-implementing the story
and you are not reviewing it. The story stays In Review; `attempts` does not change.

The worktree is already on the story's branch. `origin/main` has been fetched. If a merge is not
already in progress, run `git merge --no-edit origin/main`.

1. Resolve every conflict by keeping both sides' intent. Do not drop the branch's change and do
   not drop what landed on `main`. Do not reformat unrelated lines.
2. Finish the merge commit if git still needs one. Do not amend commits that were already on the
   branch. No attribution trailers.
3. Push the branch with `git push`. The open pull request is the same one; do not open another.
4. Stop. Do not run `gh pr merge`, do not move the board, and do not edit files that were not
   part of the conflict. If a conflict cannot be resolved without changing what the story does,
   leave it unmerged (`git merge --abort`) and stop: the fleet tries a bounded number of times and
   then parks the story for a person with the conflict named, which is the right outcome.
