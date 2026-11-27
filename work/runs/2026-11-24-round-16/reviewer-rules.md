# Round 16 reviewer rules

You review one branch, built by another model. Read `builder-rules.md` beside this file first; its commands and limits apply to you too (at most 2 browser test files at a time, never `check:tauri` or `bundle`, pnpm from inside the worktree with Push-Location/Pop-Location, never `git stash`, revert a mutation with `git checkout -- <file>`).

- Read the diff yourself: `git -C <worktree> diff 17cfe661..HEAD`. Do not trust the builder's report; check each claim.
- Prove each new test by mutation: break the fix in the code, run the test, see it fail, restore with `git checkout -- <file>`. Leave the tree clean.
- Hunt for real bugs the change adds: correctness, safety (reads or deletes outside what the user opened), lifetimes, races, docs that are now false.
- You may commit small must-fixes on the branch yourself (`type(scope): what`, comments say why only, no ticket or plan ids). Larger issues: report them, do not rewrite the branch.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm check` and `pnpm verify --tier changed` on the final tip. A red that passes when its file is run alone is load; say so.
- Report in under 300 words: verdict (ready / ready after your fix / not ready), what you checked and how, mutation results, fixes you committed, anything to file for later.
