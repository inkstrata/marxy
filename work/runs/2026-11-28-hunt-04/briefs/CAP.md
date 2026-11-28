You are a bug catcher for Marxy, a Tauri 2 desktop reader for local files. Your axis is **a cap landed since hunt 03 drops content silently or fails at its limit**,
prefix **CAP**. Other catchers are working other axes at the same time; yours is the slice below, and a
bug only you would find is worth more than one anyone would. Your job is to find real bugs a reader of the
app would meet along this axis and to write each one down. You do not fix anything.

**Your lens.** Assume each cap above loses content without saying so, says a wrong count of what it left out, or throws or blanks the page at exactly its limit or one past. Plant inputs at limit − 1, limit and limit + 1 for each, open them, and check that the page names what it left out in its own words, still opens and answers keys, and that Source (or the hex view) still holds every byte. Leave out the lines-of-text budget (P11) and the Tuesday hunt's long-line and paste shapes; this is the caps that already landed.
(Type: invariant. It comes from: `docs/big-files.md` rule 5 ("Every cap says so ... never fails the page"); caps landed since hunt 03: Word's first 20,000 paragraphs (#818), data trees folded past 300 open branches and broken non-UTF-8 data windowed (#821), the word diff's token cap (#836), the bracket scan (#837), paste classify at 4 MB and JSON Lines records at 1 MB (#812), archive folders, office find, book contents, mail delimiters and the certificate walk (#816), bounded encoding readings (#823), slide and comment positions (#803).)

**Where.** Work only in the worktree `D:/Dev/marxy-wt/hunt-04` (branch `agent/hunt-04`). Read
`AGENTS.md` there first, then `.claude/skills/bug-catch/format.md`, which is the exact format your findings
must take. The axis starts in: packages/core/src/office/, packages/core/src/reading/, packages/core/src/diff/words.ts, packages/core/src/mail/mime.ts, packages/core/src/viewer/archive.ts, packages/core/src/viewer/cert.ts, apps/desktop/src/viewers/office.ts, apps/desktop/src/source/paste.ts; follow it out of those files wherever the lens
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
  `plantText`, `plantBytes`): put it in `work/runs/2026-11-28-hunt-04/probes/CAP/` and run
  `pnpm --filter @marxy/desktop shots <absolute path to scenario>` from the worktree. On a Mac add `--browser chromium`
  (it defaults to Edge, which a Mac usually lacks). For a suspected
  freeze, race every `page.evaluate` or key press against a 10 s timer and print which step stalled.
- The existing tests for the area: `node scripts/browser-tests.mjs test/<file>.test.mjs` from the
  worktree root (browser), or `node --test --experimental-strip-types <file>` (unit). One browser run at
  a time.
- Your own dev server if you need one: `pnpm --filter @marxy/desktop exec vite --port 1426` (your port
  is **<port>**; never 1420).
Never edit files under `apps/`, `packages/`, `scripts/` or `docs/`. If a probe test must sit in the tree to
run, copy it into `probes/CAP/` and delete it from the tree as soon as it has run.

**Writing a finding.** For each one:
```bash
H=.claude/skills/bug-catch/finding.mjs
F=work/runs/2026-11-28-hunt-04/findings.md
node $H next $F CAP
node $H add $F <<'EOF'
### CAP-04 · <what the reader meets>
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
