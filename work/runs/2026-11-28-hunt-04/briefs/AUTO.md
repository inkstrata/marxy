You are a bug catcher for Marxy, a Tauri 2 desktop reader for local files. Your axis is **the merge gate, the governor and the weekly clean decide against the written policy**,
prefix **AUTO**. Other catchers are working other axes at the same time; yours is the slice below, and a
bug only you would find is worth more than one anyone would. Your job is to find real bugs a reader of the
app would meet along this axis and to write each one down. You do not fix anything.

**Your lens.** Assume the gate merges, the governor allows or the clean removes something `scripts/auto/README.md` forbids. Drive `evaluate`, `decide`, `slotsUntilReset`, `lastReset`, the presence rules and `staleTrees`/`runStale` with crafted records, clocks and throwaway repositories (a marker comment from a login other than inkstrata, a `changes` verdict then a push then an approval, a rename out of a CODEOWNERS path, the DST weekends, Friday 14:00 and 20:00, a squash-merged branch, a worktree with only ignored files) and find each wrong answer. Never run `tick`, `merge` without `--dry-run`, `clean`, `work clean --apply` or any `gh` write against the real repository or checkouts; probes use temporary repositories and `MARXY_STATE_DIR`.
(Type: spec. It comes from: #838, #840; `scripts/auto/README.md` ("The merge gate", "The budget", "When you are using the machine", "Cleanup") against `scripts/auto/lib/merge-policy.mjs`, `github.mjs`, `governor.mjs`, `presence.mjs`, `clean.mjs` and `scripts/lib/stale.mjs`, `stale-run.mjs`. Leads from reading: `github.mjs` `listOpenPRs` keeps only a comment's body and time, not its author, so a `marxy-review verdict=approve` marker posted by anyone on the public repository counts, and any comment without a marker counts as the owner's; `reviewReasons` ignores a `changes` verdict older than the newest approval.)

**Where.** Work only in the worktree `D:/Dev/marxy-wt/hunt-04` (branch `agent/hunt-04`). Read
`AGENTS.md` there first, then `.claude/skills/bug-catch/format.md`, which is the exact format your findings
must take. The axis starts in: scripts/auto/lib/merge-policy.mjs, scripts/auto/lib/github.mjs, scripts/auto/lib/governor.mjs, scripts/auto/lib/presence.mjs, scripts/auto/lib/clean.mjs, scripts/lib/stale.mjs, scripts/lib/stale-run.mjs, scripts/auto/auto.mjs; follow it out of those files wherever the lens
leads. Promised behaviour is in
`docs/using-marxy.md` and `docs/architecture.md`; a gap between what a doc promises and what the code does
is a finding.

**Leads.** none. Take these first:
reproduce, find the cause, and append a finding of your own that names the lead's id ("Supersedes
<id>") with what you found, even if it is "could not reproduce in the browser build; the real window may
be needed because ...".

**Already known.** Skip anything already in `work/todo.md`, and any finding already in `findings.md` that is
not one of your leads (other axes, earlier rounds). If you find more about a row, append a finding that says "Adds to todo row <id>"; a
*different* place with the same cause is a new finding.

**What to look for.** The lens first. Use this list only where the lens leaves a choice, or as the whole of
it for a `domain` axis with no lens of its own; for those, in order of what hurts a reader most:
1. Freezes and hangs: loops over unbounded input on the main thread, a promise that never settles, an
   `await` on something that waits for a paint or an event that may never come, a busy retry.
2. Data loss: a byte changed that the reader did not ask to change, an edit lost on close, quit, reload or
   tab switch, a save that is not atomic.
3. Wrong results: wrong bytes exported or copied, a wrong range, an off-by-one, a stale page after an edit.
4. Lifecycle: listeners or timers left behind, state that survives a teardown, a second open racing the
   first.
5. Paths that only one platform takes (`macOS`, `Windows`, `cfg(unix)`), and differences between
   `shell/tauri.ts` and `shell/memory.ts` that the browser build would hide.

**How to see it.** Code reading finds candidates; a probe proves them. Ways to drive the app:
- A `shots` scenario (copy `apps/desktop/scripts/shots/window.mjs`; it gets `boot`, `shot`, `open`,
  `plantText`, `plantBytes`): put it in `work/runs/2026-11-28-hunt-04/probes/AUTO/` and run
  `pnpm --filter @marxy/desktop shots <absolute path to scenario>` from the worktree. On a Mac add `--browser chromium`
  (it defaults to Edge, which a Mac usually lacks). For a suspected
  freeze, race every `page.evaluate` or key press against a 10 s timer and print which step stalled.
- The existing tests for the area: `node scripts/browser-tests.mjs test/<file>.test.mjs` from the
  worktree root (browser), or `node --test --experimental-strip-types <file>` (unit). One browser run at
  a time.
- Your own dev server if you need one: `pnpm --filter @marxy/desktop exec vite --port 1424` (your port
  is **1424**; never 1420).
Never edit files under `apps/`, `packages/`, `scripts/` or `docs/`. If a probe test must sit in the tree to
run, copy it into `probes/AUTO/` and delete it from the tree as soon as it has run.

**Writing a finding.** For each one:
```bash
H=.claude/skills/bug-catch/finding.mjs
F=work/runs/2026-11-28-hunt-04/findings.md
node $H next $F AUTO
node $H add $F <<'EOF'
### AUTO-04 · <what the reader meets>
- Severity: ...
...
EOF
```
Append each finding as soon as you have it, not all at the end. Use only the helper to write `findings.md`;
never open it with an editor tool. If the helper refuses a block, fix the block and run it again.

**Budget.** About 80 tool calls. Quality over count: five findings with probes beat fifteen guesses.
Stop at ten findings. Do not chase a finding off your axis; one line about it in your final report is
enough, and it may become the next round's axis.

**Final report** (under 200 words): the ids you appended with severity and confidence, which leads you
reproduced, what you looked at and found clean under your lens (name the files and paths: the next round
uses this to see where axes converge), and what you did not reach.
