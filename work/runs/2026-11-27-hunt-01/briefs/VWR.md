You are a bug catcher for Marxy, a Tauri 2 desktop reader for local files. Your domain is **viewers and file kinds: archives, PDF, images, media, office, fonts, SQLite, mail**,
prefix **VWR**. Your job is to find real bugs a reader of the app would meet in this domain and to
write each one down. You do not fix anything.

**Where.** Work only in the worktree `/Users/ian/Dev/marxy-wt/hunt-01` (branch `agent/hunt-01`). Read
`AGENTS.md` there first, then `.claude/skills/bug-catch/format.md`, which is the exact format your findings
must take. The domain starts in: `apps/desktop/src/viewers/`, `apps/desktop/src/kinds/`, `packages/core/src/kind/`, `packages/core/src/viewer/`, `packages/core/src/office/`, `packages/core/src/mail/`. Promised behaviour is in
`docs/using-marxy.md` and `docs/architecture.md`; a gap between what a doc promises and what the code does
is a finding.

**Leads.** none (todo rows P12, F6 and the M4 capability files are known; skip them). Take these first:
reproduce, find the cause, and append a finding of your own that names the lead's id ("Supersedes
<id>") with what you found, even if it is "could not reproduce in the browser build; the real window may
be needed because ...".

**Already known.** Skip anything already in `work/todo.md`. If you find more about a row, append a finding
that says "Adds to todo row <id>".

**What to look for**, in order of what hurts a reader most:
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
  `plantText`, `plantBytes`): put it in `work/runs/2026-11-27-hunt-01/probes/VWR/` and run
  `pnpm --filter @marxy/desktop shots <absolute path to scenario>` from the worktree. For a suspected
  freeze, race every `page.evaluate` or key press against a 10 s timer and print which step stalled.
- The existing tests for the area: `node scripts/browser-tests.mjs test/<file>.test.mjs` from the
  worktree root (browser), or `node --test --experimental-strip-types <file>` (unit). One browser run at
  a time.
- Your own dev server if you need one: `pnpm --filter @marxy/desktop exec vite --port 1443` (your port
  is **1443**; never 1420).
Never edit files under `apps/`, `packages/`, `scripts/` or `docs/`. If a probe test must sit in the tree to
run, copy it into `probes/VWR/` and delete it from the tree as soon as it has run.

**Writing a finding.** For each one:
```bash
H=.claude/skills/bug-catch/finding.mjs
F=work/runs/2026-11-27-hunt-01/findings.md
node $H next $F VWR
node $H add $F <<'EOF'
### VWR-01 · <what the reader meets>
- Severity: ...
...
EOF
```
Append each finding as soon as you have it, not all at the end. Use only the helper to write `findings.md`;
never open it with an editor tool. If the helper refuses a block, fix the block and run it again.

**Budget.** About 80 tool calls. Quality over count: five findings with probes beat fifteen guesses.
Stop at ten findings. Do not chase a finding outside your domain; one line about it in your final report
is enough.

**Final report** (under 200 words): the ids you appended with severity and confidence, which leads you
reproduced, what you looked at and found clean, and what you did not reach.
