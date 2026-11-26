# Handoff: orchestrating Marxy's waves from here

Written 24 November 2026 for an orchestrator on Opus. Everything needed is on disk; nothing depends on a conversation. Read this file, then the files it points to as you reach them. A cold reader on another model has walked through this package and its corrections are in.

## Words used in this package

- **The planning session**: the session that wrote these files on 24 November, started the first builders, and may or may not be the session you are.
- **Scouts**: read-only subagents the planning session sent to map code. Where a brief says how the code works "today", that is a scout's map, checked against master at `17cfe661`: about 105 references were spot-checked and the misses corrected, but line numbers drift, so find code by name.
- **Shift 1, 2, 3; step 1a, 2c and so on**: labels from the plan (`marxy-plan-harder-waves.md`) for the three changes of shape and their steps. **E1 to E9** are tracker rows; **X1 to X10** are experiments; **P, B, O, V numbers** are findings in the evaluation. All of these are names for talking about the work. None may appear in code, comments, test names, docs or commit subjects.
- **The measuring tool**: `scripts/measure-interactions.mjs`, written by the `perf-record` branch.
- **A cut file**: one Markdown file per group of branches (`work\wave1\wave1-cut.md` is the first): a table of the group's branches, the briefs or pointers to them, and a dated log.

## What this is

Marxy is a Tauri 2 desktop reader for local files (`C:\Dev\reader\app`, git, default branch `master`, no remote). An evaluation on 24 November found that its costs grow with the size of the document where they should grow with the size of the change, that it carries weight nobody uses, and that verifying a change is slow and flaky. A first wave of six small fixes is being built, and a plan for the harder work is written with a brief for every branch and a design for every experiment. Your job is to carry that through: review, integrate, verify and land wave 1, then run the experiments and the later branches in the order given, with builders and reviewers as subagents.

| Read | For |
| --- | --- |
| `C:\Dev\reader\app\AGENTS.md`, `docs\working.md`, `docs\testing.md` | the repository's rules and its work cycle; they outrank everything here |
| `C:\Dev\reader\work\evaluation-2026-11-24\marxy-evaluation-bloat-performance.md` | the findings and their evidence |
| `C:\Dev\reader\work\evaluation-2026-11-24\marxy-plan-harder-waves.md` | the plan, its table of waves (under "Order"), and the decisions taken |
| `C:\Dev\reader\work\wave1\wave1-cut.md` | the rules every builder and reviewer follows, wave 1's six briefs, its log |
| `C:\Dev\reader\work\wave2\wave2-cut.md` | the two wave-2 branches already running |
| `01-experiments.md` beside this file | ten experiments, each with its decision rule |
| `02` to `05` beside this file | a brief for every remaining branch |
| `C:\Dev\reader\work\todo.md` | the tracker; rows E1 to E9 are this work |

## Who does what

- **You orchestrate.** You cut branches, hand out briefs, read reports, send reviewers, integrate, run the full verify, measure, and report to Ian (the owner). You do not build, and you do not review a diff yourself as the review of record.
- **Builders are Sonnet**, one per branch, in the branch's own worktree. Four branches go to **Opus builders** with two reviewers: `definitions-index`, `footnote-splice`, `geometry-table`, `skipped-layout`. Experiments: X1 to an Opus builder, the rest as the table in `01-experiments.md` says.
- **Reviewers run on a different model from the builder** (the repository's rule): Opus reviews Sonnet's work; Sonnet reviews Opus's, followed by a second, fresh Opus reviewer told to try to break it.
- **Lookups and plain runs** (does this file exist, run this command and give the last lines) go to Haiku.
- A builder or reviewer is given the path of the rules file and of its brief, its worktree, and the folder for its logs. It is not given your conclusions. A reviewer is given the branch and the builder's report as claims to check.
- **You save the reports.** A subagent returns its report as text and is not allowed to write report files (the first builder to try was refused). When a builder reports, write its text to `<group folder>\<branch>\report.md`; when a reviewer reports, to `review.md` there; add your own notes for the next reader under a heading at the end. `work\wave1\first-click\report.md` is the pattern. Do it at once: the report exists nowhere else. The group folder is the folder of the cut file the branch is listed in (`work\wave1`, `work\wave2`, and `work\wave3` onward as you create them); experiments use `work\experiments\<id>-<name>\`.
- When a builder and a reviewer disagree after two rounds, you read the diff and both positions, decide, and write the decision and its reason in the cut file's log. If the disagreement is about what the reader should see, it goes to Ian.

## What Ian has said (his words carry the authority; nothing else does)

- "merge wave 1 into master when verified": you may fast-forward `master` to `agent/wave1` without asking again when all three hold: every wave-1 branch has a reviewer's verdict of ready; `agent/wave1` contains `master`'s current tip; `pnpm verify --tier full` is green on that exact tip (a red whose file passes when run alone is load: rerun it alone, record it, and only then count it green). This covers wave 1 and its `residue` branch. It does not cover any other branch.
- "use your recommended defaults for the decisions": far paragraphs may wait to be typeset until approached (export, print and the rag gate set everything); a kept store keeps its undo history across a tab switch; the skipped-layout spike (X1) runs beside wave 2; the hard steps go to the strongest builder with a second reviewer; the measuring tool and a smoke set of tests run in the shipped engine as well as WebKit.
- "suborchestrate with smaller models", "use main brain for planning and big picture work", "prioritize planning and writing the experiments and plans so we can hand off to opus": hence this package.
- Everything after wave 1 is built and verified on branches and brought to Ian before `master` moves. Ask him with the branch, what changed for the reader, the numbers before and after, and what is not verified.
- X7 installs a developer tool (`cargo install cargo-bloat`): ask first.

## Never

- Never touch another session's work. Other sessions own `agent/round16`, `budgets-4`, `budgets-5`, `teardown-2`, `web-shell`, `open-with`, and the merged-but-uncleared `round14`, `outline-rows`, `shell-destroy`, `budgets-1`, with their worktrees, plus `worktrees\exe*` and `worktrees\bisect`. **`pnpm work clean --apply` removes every merged `agent/` branch and worktree, not only yours**: never run it without `--keep` naming every branch that is not yours, or remove your own by name instead (see "Landing wave 1", step 6).
- Never `git stash` (it is shared by every worktree), never `git reset --hard` in the main checkout, never rebase a branch a builder is on, never push (there is no remote).
- Never move `master` except by `git merge --ff-only` under the words above.
- Never run two of `check:tauri`, `shots --exe`, `scripts/measure-startup.mjs` or `verify --tier full` at once. The first, second and fourth take one machine lock; `measure-startup.mjs` does not take it, so it is on you to run it only when none of the others is running.
- Never put a tracker id, a wave or step name, or anything from these plan files into code, comments, test names, docs or commit subjects. The repository describes the software, not the work.

## State at handoff

Check it rather than trust it: `pnpm work` (from inside `C:\Dev\reader\app`), `git -C C:\Dev\reader\app worktree list`, the verify logs in `C:\Dev\reader\work\wave1\`, and the report files.

| Branch | Group | State when written (24 Nov, about 15:20 local) | Next |
| --- | --- | --- | --- |
| `key-lookup` | wave 1 | built (`3df64d41`); verify turn running, green through the desktop unit suite | report, then Opus review |
| `first-click` | wave 1 | built (`e856fa9c`) and reported (`work\wave1\first-click\report.md`); verify green except `unit-scripts` 242 pass, 1 fail: `scripts/lib/perf-record.test.mjs`, a temp-file rename refused under load, passes alone 3 of 3 | Opus review started by the planning session; the reviewer reruns that file and the verify turn |
| `grammars-once` | wave 1 | built (3 commits, tip `d10fa885`), waiting for a verify slot | report, then Opus review |
| `dead-code` | wave 1 | built (5 commits, tip `373a5830`) | the same |
| `verify-defaults` | wave 1 | built (4 commits, tip `d70aa2c6`) | the same |
| `perf-record` | wave 1 | built (2 commits, tip `9bed3e34`) and reported; the plain document and `--doc` are in; verify on the first commit 12 of 13 (core's 10 MB notebook timing under load, passes alone 19/19) | Opus review started by the planning session; see "The measuring tool" below |
| `key-lookup` (update) | wave 1 | reviewed, ready, no change (`key-lookup\review.md`) | integration |
| `typeset-waste` | wave 2 | built (`10b8fa32`), waiting for a verify slot | report, then Opus review; goes to Ian, not into wave 1 |
| `definitions-index` | wave 2 | building (Opus), nothing committed yet | report, then a Sonnet review, then a second Opus review; goes to Ian |
| `residue` | wave 1 | not cut | cut from `agent/wave1` once the six are merged there |

The builders were started by the planning session. If you are that session continuing on another model, their reports arrive as messages (save each to disk as above) and you can send a builder follow-ups by its agent id. If you are a fresh session, you will not hear from them, and a report that arrived after the planning session stopped saving is lost: read each branch's `report.md` if there is one, its verify log and its commits; if a branch has commits and a finished verify log but no report, start a reviewer on it anyway with the brief and the diff; if a branch needs changes, start a new builder on the same worktree with the brief, the diff so far, and the review or the failing log.

**Round 16**, another session's, was running a full verify on `agent/round16` (tip `1f141eb1`) when this was written. It has landed when `git -C C:\Dev\reader\app merge-base --is-ancestor agent/round16 master` succeeds (or simply when `git -C C:\Dev\reader\app rev-parse --short master` is no longer `17cfe661`) and rows P11, P12 and F24 have left the tracker. When `master` moves, for whatever reason: merge it into your integration branch, verify again, and take a new baseline record with the measuring tool on the new `master` before comparing anything against it.

## Tools you will use

**Verify turns.** Several builders share the machine, so changed-tier verifies take turns, two at a time. Run with the Bash tool (Git Bash), in the background:

- wave 1 and 2 branches: `bash /c/Dev/reader/work/wave1/verify-turn.sh <name>` (log: `work\wave1\<name>-verify.log`);
- anything later: `bash /c/Dev/reader/work/plan/verify-turn.sh <name> /c/Dev/reader/work/<group> [verify arguments]`. A branch cut from an unlanded branch adds `--tier changed --base agent/<that branch>`, so only its own changes pick the tests.

Both scripts share the two slots (folders `a` and `b` under `work\wave1\locks`; a slot is reclaimed after 100 minutes if its run died). A changed-tier verify takes 15 to 45 minutes. A **full** verify must not overlap builders' turns: wait until `locks\` is empty, create both slot folders yourself (`mkdir` `a` and `b` there, with a file saying who), run it, and remove them after. The `verify-lock` branch will move all of this into `verify` itself; until it lands, these scripts are the arrangement.

**The measuring tool.** `node scripts/measure-interactions.mjs` (package script `perf:interactions`) exists only on `agent/perf-record` until wave 1 lands. Run `--help` there before relying on anything below. At `9bed3e34` it accepts `--runs N` (default 3), `--keys N` (default 20), `--docs` (a comma list of `long-reference`, `long-reference-plain`, `short-document`), `--doc <path>` (repeatable, any file), `--browser`, `--record <path>`, `--compare <record>`, and `--compare a.json --against b.json` to compare two saved records without running anything. `long-reference` is the 195 KB `fixtures/corpus/32-long-reference.md` (30 footnotes); `long-reference-plain` is the same with the opening bracket of every definition line escaped, so it has none (the in-place page update refuses on a document with footnotes, so this is the document that shows that path); `short-document` is the 25 KB demo document. Other sizes go in with `--doc`: 8 KB `fixtures/demo/reading/on-the-measure.md`, 53 KB `fixtures/corpus/15-prose-volume.md`, 1 MB written by `node scripts/perf-harness.mjs --write <dir> --large 1m`. A full run takes about ten minutes. Reviewed and fixed at `b6f8176a` (`work\wave1\perf-record\review.md`): the record is version 2, counts lead each table, top-level nodes taken out and put in are counted separately, and the record stores the app code's git trees. Three things to know when reading it: its durations run until the main thread has been idle about a second, so they include the typesetting that follows an action and are larger than the evaluation's figures (undo 7 to 9 s here against 4 to 5 s there); under load durations rose by half with identical counts, so compare counts first; and an undo or reload is accepted as done on any mutation inside the article, typesetting included, which is filed to fix before the tool judges `splice-all`. The baseline `work\wave1\interactions-master-17cfe661.json` (version 2, retaken after the review; the version-1 file is beside it with `-v1`) holds all three documents, taken on `master` `17cfe661` plus the tool. On it, for the long document: open 10,080 nodes, 567 layouts, 4.7 s of task time; cursor key 82 ms handler; first click 188 ms handler with 266 ms of style recalculation; undo 2,763 nodes out and in, 7.2 s; reload of one line 2,737 out and 2,739 in, 7.4 s (plain document: 0 out, 2 in, 0.87 s); tab switch 874 ms to show; Source to Read 519 ms. Take a new baseline whenever the tool's scenarios change or `master` moves, on `master`'s code, and name it by `master`'s commit.

**Pictures.** `pnpm --filter @marxy/desktop shots <scenario.mjs>` needs a scenario file (a module whose default export receives `boot`, `shot`, `plantText`, `plantBytes`, `open`; `apps/desktop/scripts/shots/window.mjs` is one to copy, and `docs\working.md` describes the tools). An experiment that takes pictures writes its scenario under its own work folder.

**Builds.** `pnpm --filter @marxy/desktop build:web` builds the front end into the worktree's `apps/desktop/dist`; `pnpm --filter @marxy/desktop build` also builds the release exe (minutes) and is what `measure-startup.mjs`, `shots --exe` and `check:tauri` need. `node scripts/bundle-report.mjs` reports chunks without writing; `node scripts/gate-highlight-bundle.mjs` checks the grammars in a built `dist`.

**Dev ports.** Each branch that may start a dev server by hand gets a port in its cut file, used with `--strictPort` so a clash fails loudly (this is deliberate, and stricter than `AGENTS.md`'s advice for a lone worktree). Ports 1491 to 1498 are taken; give out 1499 upward and check a port is free first (`netstat -ano | findstr :<port>` prints nothing).

**The tracker** (`work\todo.md`, format in `docs\working.md`): a row is `| id | What | Why | Size | Branch |` under a `##` heading. File a row when you cut a branch, with ids continuing from E10; experiments get no rows. A row leaves when its branch is in `master` (`pnpm work todo --check` names them). E8 and E9 stay until their branches land.

## The cycle for one branch

1. **Cut.** From inside `C:\Dev\reader\app`: `pnpm work start <name>` (or `--from agent/<branch>` for work stacked on an unlanded branch; say so in its row). List it in the group's cut file (create `work\wave<N>\wave<N>-cut.md` for a new group, modelled on `wave2-cut.md`: the table, a pointer to each brief's file and heading, a log) with its builder, reviewer and port, and file its tracker row. Give the builder: the rules file (`work\wave1\wave1-cut.md`, "Rules for every builder"), its brief (file and heading), its worktree, its report folder, its port, and the verify-turn command for its group.
2. **Build.** The builder works, commits on its branch, takes a verify turn, and reports.
3. **Review.** Start a reviewer on the other model with: the rules file ("Rules for every reviewer"), the worktree, the base to diff against (`git diff master...agent/<name>`; for a stacked branch, the branch it was cut from), the builder's report as claims to check, and the brief so it knows what was asked. Ask for a verdict of ready, ready after its own small fix, or not ready with what must change.
4. **Fix.** Not ready: send the findings to the builder (or a new builder on that worktree), then have the same reviewer read only what changed since.
5. **Log.** One line per event in the cut file's log (built, reviewed, fixed, merged), with commit hashes and test counts; `C:\Dev\reader\work\round16\round16-cut.md` shows the level of detail.

Check a report before you believe it: the commits exist (`git log master..agent/<name>`), the worktree is clean, the verify log ends green on the tip named, and the new tests are the kind the rules ask for (counts, not clocks; they fail without the change).

## Landing wave 1

1. When the six are ready: `pnpm work start wave1`, then in `C:\Dev\reader\worktrees\wave1` merge each in turn (`git merge --no-ff agent/<name>`), smallest first: `key-lookup`, `first-click`, `grammars-once`, `verify-defaults`, `perf-record`, `dead-code`. Expected seams: `scripts/verify-map.json` (three branches add a browser test, one removes several), `scripts/registry.json`, `scripts/README.md` and `docs/testing.md` (two branches add a tool or a section), `apps/desktop/package.json` (two branches edit scripts). Keep both sides; run `node --test scripts/verify.test.mjs scripts/readme-index.test.mjs` and `pnpm check` after each merge.
2. Cut `residue` from `agent/wave1` (`pnpm work start residue --from agent/wave1`; brief in `05-briefs-verification-and-cleanup.md`; Sonnet builder, Opus reviewer; its verify turn takes `--tier changed --base agent/wave1`), then merge it into `agent/wave1`.
3. If `master` has moved, merge `master` into `agent/wave1` and resolve; round 16 touched `docs/architecture.md`, `packages/core/src/util/text.ts`, readings, mail, archive, cert and the shell subscriptions.
4. Full verify. Hold both verify slots as described under "Verify turns", then from inside the worktree, in the background: `pnpm verify --tier full` (about an hour; it builds the release exe and runs `check:tauri` under the machine lock). Its step logs are named in its output. For each red step, rerun the failing file alone; if it passes alone, record it as load with the file's name in the log; if it fails alone, it is real: find which branch caused it (revert one merge at a time in a scratch worktree) and send it back.
5. Measure. In the worktree: `node scripts/measure-interactions.mjs --record C:\Dev\reader\work\wave1\interactions-wave1-<tip>.json --compare <the current baseline record>`. Expected on the 195 KB document: cursor key from 40-110 ms to about 10 ms; first click from 166-250 ms to under 30 ms; open's main-thread work down by about a second; undo and reload unchanged. For the build: `pnpm --filter @marxy/desktop build:web`, then `node scripts/gate-highlight-bundle.mjs` passes (no grammar twice), the JavaScript under `apps/desktop/dist/assets` is about 7.7 MB smaller than `master`'s build (sum the `.js` file sizes in each), and no `checks-digest-*` chunk exists. If a number has not moved, the fix did not do what its builder said: find out before landing.
6. Land. Check `git -C C:\Dev\reader\app status` is clean and there is no `.git\MERGE_HEAD`, then `git -C C:\Dev\reader\app merge --ff-only agent/wave1`. `pnpm work todo --check` names the rows to remove from the tracker (E1 to E7); remove them. Clear only your own worktrees and branches, by name: for each of the six, `residue` and `wave1`, `git -C C:\Dev\reader\app worktree remove C:\Dev\reader\worktrees\<name>` then `git -C C:\Dev\reader\app branch -d agent/<name>`, and delete any `node_modules` folder left behind. Do not use `pnpm work clean --apply` here.
7. Tell Ian: the commit, what changed for the reader, the table of numbers before and after, the verify result with any load reds named, and what was not checked in a real window (nothing in wave 1 was seen in an installed build; `pnpm work installer` is his to ask for).

## After wave 1: what to start, in order

The plan's table of waves (in `marxy-plan-harder-waves.md`, under "Order") is the authority; this is the same thing as a queue. Start a step when what it depends on has landed in `master`, or cut it `--from` the unlanded branch it needs and say so in its row.

**One at a time on shared files.** `apps/desktop/src/view/rendered-view.ts` is edited by `splice-all`, `source-return`, `drop-floor`, `typeset-view` and `geometry-table`, each of which also moves code out of it. They run strictly in that order, each cut from the one before or from `master` once it has landed. `drop-floor` is a one-constant change gated by X10; if X10 is not done when its turn comes, let `typeset-view` go ahead and do `drop-floor` after `geometry-table`. `apps/desktop/src/render/post.ts`: `typeset-view` before `geometry-table`. Test files: `quiet-waits` before `timings-out`. Tauri command lists: `read-tree` and `scope-keys` before `one-source`.

1. At once: **X9** (what the test engine supports; an hour, read-only in effect), and reviews of `typeset-waste` and `definitions-index` as they report. Bring those two to Ian when reviewed and verified.
2. When wave 1 is in `master`: **X1** (Opus; the spike), **`splice-all`**, **`verify-lock`**, and from the shell briefs **`one-listing`**, **`search-handle`**, **`scope-keys`** (different files from everything else). Not more than four builders at a time on this machine, fewer if verify runs start timing out.
3. **X4 and X5** time things under controlled load and need the machine otherwise quiet: run each alone, when no builder is in a verify turn (for example while a group waits on Ian). They are allowed to exceed the two-browser-files rule for their loaded runs; nothing else is.
4. After `splice-all`: **`source-return`**, **X10** then **`drop-floor`**, **`footnote-splice`** (Opus), **`block-cache`**, **`warm-store`**. After X1: **X2** (it needs X1's bounded-queue variant, nothing else).
5. After `typeset-waste` has landed and `rendered-view.ts` is free: **`typeset-view`**, then **`geometry-table`** (Opus). After `geometry-table`, X1 and X2: **`near-typeset`**. After that, and only if X1 said go: **`skipped-layout`** (Opus).
6. When their experiments report: **`harness-bundle`** (X4), **`quiet-waits`** (X5), **`read-tree`** (X8, which needs an exe build), **`startup-split`** (X6, likewise; brief in `05`), the decoder trims (X7, with Ian's OK to install the tool).
7. Last, because they touch many files or wait on Ian: **`timings-out`**, **`one-source`**, **`core-sweeps`**, **`helpers-one`**, **`shell-one`**, **`rust-trims`**, **`watch-ignore`**.

Group what lands together into integration branches as wave 1 does: `agent/wave2`, `agent/wave3` and so on, each with its cut file, a full verify, and a measurement against the last baseline, and bring each to Ian.

An experiment's branch (`agent/x-<name>`) is never merged, so nothing clears it. Once its report is saved and Ian has seen the result, remove its worktree and delete the branch by name (`git branch -D agent/x-<name>`).

An experiment's report can change this queue. When one does (X1 says no-go, X2 finds nothing holds the page still, X4 shows no gain), write what changed and why at the top of the plan file under a dated heading, and tell Ian in the next report; do not quietly build the planned thing anyway.

## What to bring Ian, and how

- He reads pages, not Markdown: a report for him is a static HTML file in the reader's own Night theme. Write the Markdown into `C:\Dev\reader\work\evaluation-2026-11-24\` (the build script reads only that folder) and run `node --experimental-strip-types C:\Dev\reader\work\evaluation-2026-11-24\build\build-page.mjs <basename> "<title>"`, which writes `<basename>.html` beside it using the repository's theme and renderer. Plain prose and tables; no badges, pills, tinted tags, icons or emojis. Lead with the conclusion; numbers before and after in a table; what is not verified said plainly.
- Markdown is for agents: briefs, logs, reports between you and subagents.
- A question that needs his call can go on a question page (`pnpm work ask`, described in `docs\working.md`).
- Put at the top of every reply the links to documents created or changed.
- When the plan turns out wrong, say so first.

## Machine notes

- Windows 11, PowerShell first. In the Bash tool: never a bare `cd` (use `git -C`, absolute paths, or `bash -c "cd X && ..."`); run `eval "$(fnm env --shell bash)"` before node.
- Run pnpm from inside the tree it acts on (`Push-Location <tree>; pnpm ...; Pop-Location` in one PowerShell call). The repository pins pnpm 11.18.0 and a pnpm pointed in with `-C` refuses.
- A command that takes more than two minutes runs in the background; wait for its completion notice, do not poll.
- Write files with the file tools, not shell heredocs (backslashes are mangled). PowerShell 5.1 `*>` writes UTF-16 logs.
- The browser tests run in Playwright WebKit and serve the source live: nothing edits a tree while its tests run. Under load, 30-second `page.goto` timeouts and wall-clock assertions fail; rerun the file alone before believing a red. Known load-sensitive tests: the 10 MB notebook timing in core, `progressive-large` (the widening precondition), `startup/measure.test.ts`, `transform-sheet`, `no-displacement`, `large-open-panel`.
- `git worktree remove` leaves `node_modules` behind; delete it after.
- The in-app browser pane and a hidden window schedule idle work differently from a visible browser: measure with the tool (headless Edge), not by hand in the pane.

## Numbers that look inconsistent and are not

- The 195 KB document has 1,245 top-level blocks by a scout's count; a profiler counted about 2,700 child nodes of the article added and removed when the whole page was rebuilt (its count includes nodes that are not blocks). Treat neither as exact: the measuring tool reports its own count, and the claim is "a handful replaced, not all".
- "Undo, 3 to 5 s" is the family (a ticked checkbox 3.0 to 5.0 s, undo 4.0 to 5.2 s, depending on whether the document has definitions); "4 to 5 s" is undo alone.

## If something is not covered

Prefer the smaller step: a branch that does less and is proved, an experiment before a redesign, a fallback to today's behaviour when a new path cannot be shown equal. When two rules pull apart, the repository's own documents win, then Ian's words above, then the plan, then the briefs.
