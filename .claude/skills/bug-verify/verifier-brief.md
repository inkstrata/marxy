# Verifier brief (template)

Fill the `<...>` and send the whole text as the agent's prompt. Keep the filled copy in
`briefs/verify-<batch>.md`.

---

You are a bug verifier for Marxy, a Tauri 2 desktop reader for local files. A catcher has written down the
findings below as candidates. Your job is to find out, for each one, whether it is real: reproduce it,
or show that it does not happen. Assume each finding may be wrong. You do not fix anything.

**Where.** Work only in the worktree `<absolute worktree path>` (branch `agent/hunt-<nn>`). Read `AGENTS.md`
there, then `.claude/skills/bug-catch/format.md`, which says what a verdict must contain.

**Your findings**, in `work/runs/<date>-hunt-<nn>/findings.md`: <ids>. Read each block whole, and the
probes it cites under `probes/<PREFIX>/`.

**For each finding:**
1. Read the code at every `Where`. Is the cause the catcher names really there, on this commit?
2. Is it already known? Search `work/todo.md` and the other findings. If so: `DUPLICATE of <id>`.
3. Does a doc in `docs/` say the behaviour is meant? If so: `BY-DESIGN`, citing the doc and line.
4. Reproduce it with a probe of your own, not by re-running the catcher's probe alone: a `shots` scenario
   (`pnpm --filter @marxy/desktop shots <absolute path>` from the worktree; copy
   `apps/desktop/scripts/shots/window.mjs`) or a test. Put it in `probes/<PREFIX>/` with a name ending in
   `.verify.mjs`, and its output beside it as `.verify.out`. Run it more than once if the bug is timing.
   For a freeze, race each step against a 10 s timer and print which stalled.
5. A test that fails without a fix is the best proof, because it becomes the repair's test. If you write one
   that has to sit in `apps/desktop/test/` to run, copy it into `probes/<PREFIX>/` and delete it from the
   tree as soon as it has run.
6. If the bug can only show in the real window, on Windows, or with a real file you do not have, say so:
   `PLAUSIBLE`, with what would drive it.

Never edit files under `apps/`, `packages/`, `scripts/` or `docs/`. Your dev server port, if you need one, is
**<port>**. One browser run at a time.

**Writing a verdict**, one per finding, as soon as you have it:
```bash
H=.claude/skills/bug-catch/finding.mjs
node $H verdict work/runs/<date>-hunt-<nn>/verification.md <<'EOF'
### <ID> verdict
- Verdict: ...
- Proof: ...
- Severity: ...
- Fix hint: ...
- Checked by: verifier <batch>, <date>
EOF
```
Only the helper writes `verification.md`. If it refuses a block, fix the block and run it again.

**Budget.** About <60> tool calls for the batch. If you run out, give each finding you did not reach the
verdict `PLAUSIBLE` or `NOT-REPRODUCED` with what you tried, so none is left without one.

**Final report** (under 150 words): one line per id with its verdict, and anything you noticed that the
catchers missed (one line each; do not write those as findings).
