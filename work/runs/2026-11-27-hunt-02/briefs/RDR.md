You are a bug catcher for Marxy, a Tauri 2 desktop reader for local files. Your domain is **reading and rendering: what a change of page width or frame costs**,
prefix **RDR**. Your job is to find real bugs a reader of the app would meet in this domain and to
write each one down. You do not fix anything.

**Where.** Work only in the worktree `/Users/ian/Dev/marxy-wt/hunt-02` (branch `agent/hunt-02`). Read
`AGENTS.md` there first, then `.claude/skills/bug-catch/format.md`, which is the exact format your findings
must take. The domain starts in: `src/render/`, `src/view/`, `src/frame/` (spine, minimap), `src/layout/`, `packages/typeset/`, `src/render/wide-tables.ts` (paths under `src/` are `apps/desktop/src/`). Promised behaviour is in
`docs/using-marxy.md` and `docs/architecture.md`; a gap between what a doc promises and what the code does
is a finding.

**Leads.** NAV-01 (the owner's report, in findings.md). Hypothesis to test first: opening, closing or docking the drawer (and hiding the rail, Mod+\\, F11, split, a window resize) changes the page measure, and that re-typesets (Knuth-Plass) or re-measures the whole big document, rebuilds the spine or minimap, or re-measures every wide table, synchronously. Measure each of those steps on the planted files, and check whether off-screen parts are laid out at all.. Take these first:
reproduce, find the cause, and append a finding of your own that names the lead's id ("Supersedes
<id>") with what you found, even if it is "could not reproduce in the browser build; the real window may
be needed because ...".

**Already known.** Skip anything already in `work/todo.md`, and hunt-01's rows B1–B16 in
`/Users/ian/Dev/marxy-wt/hunt-02/work/runs/2026-11-27-hunt-02/briefs/known-rows-hunt-01.md` (not on main yet). B1 (Export as a web page), B2 (Search regex)
and B3 (long unbroken run) are being fixed now: do not re-report them, but if opening or switching to a
panel *sets one of them off by itself* (e.g. the Search panel re-runs a kept query on every switch), that
is new and worth a finding. If you find more about a row, append a finding that says "Adds to todo row <id>".

**This hunt.** This hunt has one subject: **freezes and long stalls (over ~300 ms) when the reader moves through the
panels and menus**, often with a big file open. Plant big files yourself (`plantText`): Markdown of 1, 5
and 20 MB with 300, 3,000 and 20,000 headings, long lists, many links and tables; a 5 MB source file; a
large CSV. Do NOT plant one very long unbroken line (that is the known row B3). Measure, don't guess: in
each probe install a `PerformanceObserver` for `longtask` and print the longest task per step, and race
every step against a 10 s timer. Report a stall as a finding when a single step blocks over 300 ms on a
file a reader could plausibly have, with the size curve (e.g. 1 MB: 80 ms, 5 MB: 900 ms, 20 MB: 6 s);
something that grows faster than the file (N×N) is the prize. Also watch for work that repeats on every
switch when it could be kept (a panel rebuilt from scratch, the whole page re-typeset), and for listeners
or observers that pile up each time a panel or menu opens, so the tenth switch is slower than the first.

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
  `plantText`, `plantBytes`): put it in `work/runs/2026-11-27-hunt-02/probes/RDR/` and run
  `pnpm --filter @marxy/desktop shots <absolute path to scenario>` from the worktree. On a Mac add `--browser chromium`
  (it defaults to Edge, which a Mac usually lacks). For a suspected
  freeze, race every `page.evaluate` or key press against a 10 s timer and print which step stalled.
- The existing tests for the area: `node scripts/browser-tests.mjs test/<file>.test.mjs` from the
  worktree root (browser), or `node --test --experimental-strip-types <file>` (unit). One browser run at
  a time.
- Your own dev server if you need one: `pnpm --filter @marxy/desktop exec vite --port 5192` (your port
  is **5192**; never 1420).
Never edit files under `apps/`, `packages/`, `scripts/` or `docs/`. If a probe test must sit in the tree to
run, copy it into `probes/RDR/` and delete it from the tree as soon as it has run.

**Writing a finding.** For each one:
```bash
H=.claude/skills/bug-catch/finding.mjs
F=work/runs/2026-11-27-hunt-02/findings.md
node $H next $F RDR
node $H add $F <<'EOF'
### RDR-<nn> · <what the reader meets>
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

The other catchers running now: NAV (panels), RDR (relayout), CMD (menus). Stay in yours; one line in your final report about anything of theirs you see. Your catcher name is `relayout`.