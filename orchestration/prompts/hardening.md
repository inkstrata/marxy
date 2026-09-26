# You are hardening the marxy fleet

You pick up after MARXY-227, which rebuilt the orchestrator as a reconciler (ADR-0034). Your job is
**hardening, not redesign**: close the gaps listed below, one small pull request at a time, without
weakening any invariant. If a task seems to need a new idea rather than a fix, stop and report it
(see "When to stop").

## Read first, in this order (and nothing else until you have)

1. `AGENTS.md` — the project's rules; they win over this prompt.
2. `orchestration/README.md` — how the fleet runs, the status table, the store, the commands.
3. `docs/adr/0034-the-fleet-is-a-reconciler.md` — why it is shaped this way, and how we would know
   it was wrong.
4. `orchestration/machine.mjs` — `STATES`, `TIMING`, `fold`, the event builders. Short; read it all.
5. `orchestration/cycle.mjs` — `reviewStep` and `reconcile`. The rest of the fleet serves these.
6. `orchestration/cycle.test.mjs` — the fake world. Every stall the fleet ever had is a test here;
   yours will be too.
7. `docs/ci-contract.md` — every way CI can go red, and the local command for each.

## The model in ten lines

- The **plan** (stories, paths, deps) is on `origin/main`, read from git objects (`plan.mjs`).
- The **board** is `fold(events)`: an append-only log in `<git common dir>/marxy-fleet/`
  (`store.mjs`). Nothing else is state. Status names: todo, in_progress, in_review, blocked,
  escalate, done.
- Every change is an **event** that names the status it expects (`from`) and, for a run, the run
  that must still own the story (`ifRun`). The fold refuses one that no longer holds.
- `cycle.mjs` is **level-triggered**: each cycle reads the whole world and takes the next step for
  every story. It never relies on having seen an earlier event.
- **Runs** (`worker.mjs`) do the agent work: implement, review, resolve, plan. Each has a deadline
  and a stall watchdog, runs in its own process group, and ends with an `exit.json` outcome.
  `runs.mjs` `finishRun` decides what the ending means.
- **Holds** on a PR each have an owner (`reviewStep`): the implementor, a reviewer run, a resolver
  run, the cycle, or a person via **Needs you** in `status.md`.
- **People and agents** act through `node orchestration/fleet.mjs …`; nobody edits the store.
- Every stage of the cycle is **guarded**: a failure is named and retried, never a stall.
- **Docs are tested** against the code (`orchestration/docs.test.mjs`).
- **Models** per role and compute mode are in `orchestration/models.json`, pinned by
  `orchestration/lib.test.mjs`. You never change them.

## Invariants — a change that breaks one is wrong, however good it looks

1. Every non-final status has an owner and a way out that fires without anyone noticing it.
2. Nothing the fleet writes is a tracked file; nothing the fleet decides is read from a working tree.
3. Nothing waits silently: a wait that is not normal becomes a **Needs you** line with the command
   that moves it.
4. No uncommitted work is ever deleted. Worktrees are removed only clean and only after their PR
   merged or closed; reused ones are snapshotted to `refs/fleet/wip/` first.
5. A merge happens only in `cycle.mjs`, only when `merge-bar.mjs` says so, pinned to the evaluated
   head, with a reviewer's signed approval (`approve.mjs`). An implementor never approves.
6. Every subprocess has a time limit (`proc.mjs`); every agent runs in its own process group.
7. `--dry-run` changes nothing anywhere. Tests never touch the real store.
8. Model assignments do not change.
9. The project's four commitments in `AGENTS.md` (MIT, no telemetry, nothing phones home, never
   touch a byte the user did not ask to change) apply to the fleet's code too.

## How to work

- **One item, one PR.** Start each with
  `node orchestration/out-of-plan.mjs start "summary" --type fix --paths "…" --acceptance "…"`. Keep
  Paths to the files the item needs. The command claims the key for you; the cycle adopts the PR
  when it opens.
- **Test first.** For fleet behaviour, add a scenario to `orchestration/cycle.test.mjs` using its
  `world({...})` helper: rows, stories, open PRs, worktrees, run observations, facts. Make it fail,
  then fix. For pure functions, test beside the module (`runs.test.mjs`, `machine.test.mjs`).
- **Run** `node --test orchestration/*.test.mjs orchestration/test/` until green, then
  `pnpm precheck`, then `pnpm done KEY` and `pnpm done KEY --open`.
- **Try it for real, safely:** `MARXY_FLEET_DIR=$(mktemp -d) node orchestration/cycle.mjs --dry-run`
  reads the live repo and GitHub, prints the status it would write, and changes nothing.
- **CODEOWNERS:** `orchestration/cycle.mjs`, `orchestration/merge-bar.mjs` and
  `orchestration/approve.mjs` need the author's GitHub review. Prefer fixes that leave them alone;
  when one must change, say so in the PR's "For the reviewer".
- Write like the surrounding code: comments explain why, cite the story or ADR, no filler.

## When to stop and report instead of pushing on

Record it with `node orchestration/fleet.mjs report KEY blocked "what you tried, what you need"` and
stop, when:

- a fix needs a new status, a new event type, or a change to an invariant above (that is an ADR);
- a fix needs a model change, a new dependency, or a network call;
- the same approach has failed twice;
- a test can only pass by weakening another test.

## The follow-up plan

Ordered by priority. Each item names the failure it prevents, the files it should need, and the
check that proves it. Sizes: S under an hour, M a few hours, L several PRs.

### P0 — confirm the cutover (do these first, in order)

1. **Verify the heartbeat assumption (S, operational).** Workers run
   `cursor-agent -p --output-format stream-json` and stop a run after `stallMinutes` (25) with no
   output. That assumes stream-json prints during tool calls; it was not checked against a live run.
   Watch the first implement runs with `node orchestration/fleet.mjs why KEY` and the run's
   `out.log`. If runs end `stalled` while working (a long Rust build prints nothing), raise
   `stallMinutes` in `orchestration/models.json` and record the evidence in the PR.
   *Check:* three live runs end `exited`, none `stalled` wrongly.
2. **Make the log tail readable (S).** `finishRun` fingerprints failures from the last line of
   `out.log`, which is now a stream-json event. Extract the final result or text field before
   fingerprinting, so "the same failure twice" compares messages, not JSON noise.
   *Paths:* `orchestration/runs.mjs`, `orchestration/runs.test.mjs`, a small fixture of real
   stream-json output. *Check:* a runs test with two stream-json tails that differ only in ids gives
   the same fingerprint.
3. **Retire the stories this superseded (S, planner).** MARXY-220 (a blocked story's worktree does
   not reserve paths), MARXY-213 (a merged story with no board record is settled) and MARXY-218
   (review occupancy) are overtaken by ADR-0034. The planner marks them `dropped` with that reason
   in a delta; nobody implements them. *Check:* `node orchestration/ready.mjs` no longer offers them.
4. **Clean up after the cutover (S, needs the author).** Once the loop has run a day on the store:
   the main checkout's old `results/` directory under `orchestration/`, and the older copies in
   `~/.config/marxy/` (state, status, needs-human), are no longer read. List them for the author;
   delete nothing yourself.

### P1 — small robustness (good first items)

5. **Test the command line (M).** `fleet.mjs` commands call `process.exit` and are untested. Make
   each return `{ code, lines }` (the CLI prints and exits), then test claim, renew, release,
   verdict (merge / return / escalate), return, park, unpark, retry and report against a temporary
   store and a fake `gh`. *Paths:* `orchestration/fleet.mjs`, a new test file beside it.
   *Check:* each command's refusal path (wrong status, unknown key) has a test.
6. **Test worktree observation (S).** `observeWorktrees` reads dirtiness, commits ahead and last
   activity from git; nothing tests it against a real repository. Build a temporary repo with a
   worktree, make it dirty, commit ahead, and assert what is observed. Remember
   `-c commit.gpgsign=false` on every test commit. *Paths:* `orchestration/observe.mjs`, a new test
   file beside it.
7. **Test the runner (S).** `loop.sh`'s `code_root` creates the runner worktree, snapshots dirt to
   `refs/fleet/wip/runner/…` and resets to `origin/main`. Cover it with a temporary repo and a bare
   origin. *Paths:* `orchestration/loop.sh`, `orchestration/loop.test.mjs`.
8. **Push to Jira only when something changed (S).** `jira.mjs push` searches every issue each
   cycle. Record the board's `seq` at the last successful push in the store and skip the push when
   it has not moved, forcing one every hour. *Paths:* `orchestration/jira.mjs`,
   `orchestration/cycle.mjs` (CODEOWNERS; keep the change to one call site).
   *Check:* a cycle test where an unchanged board makes no push call.
9. **Compact the event log (M).** ADR-0034 says to compact when the log grows. Add a `compact`
   command to `fleet.mjs` that appends an `imported` snapshot of the current board, then moves the
   older lines to a dated archive beside it. `fold` already accepts a snapshot. `doctor` already
   warns past 200 000 events. *Check:* fold(archive + log) equals fold(compacted log).
10. **Record outcomes per model (M).** The README calls Composer 2.5 as implementor "a live
    experiment". Add a `stats` command to `fleet.mjs` that folds the run events into attempts,
    outcomes and time-to-PR per model and role. Report only; never change models from it.

### P2 — structural (each needs an ADR first; ask before starting)

11. **One file per story instead of one shared CSV (L).** The single largest source of merge
    conflicts is every PR and every planner pass editing `docs/plan/jira-issues.csv`. Move each row
    to its own file under `docs/plan/` (front matter in the task card is the natural home) and
    generate the CSV, or retire it. It touches `scripts/check-story.mjs`, `scripts/check-cards.mjs`,
    `scripts/lib/own-row.mjs`, `orchestration/jira.mjs`, `orchestration/plan.mjs`,
    `orchestration/out-of-plan.mjs` and the planner prompt. Do it in steps, each green: a reader
    that accepts both forms, then writers, then removal.
12. **CHANGELOG fragments (M).** Every PR also edits `CHANGELOG.md`. One fragment file per PR,
    assembled at release, removes that conflict. It changes `scripts/check-pr.mjs` and the release
    runbook in `docs/sdlc.md`.
13. **Planner PRs carry the board in their Paths (S).** A planner pass edits other stories' rows,
    which is only allowed when its own row lists the board files; MARXY-224's PR was held for
    exactly that. Make `out-of-plan.mjs start` for a planner pass add the board files to Paths by
    default. *Check:* a test on the row it writes.

### P3 — tidy-ups and questions for the author

14. **CODEOWNERS scope (question).** `machine.mjs` and `runs.mjs` decide returns and escalations,
    though not merges. Ask the author whether they join the gated set (ADR-0028); do not change
    `.github/CODEOWNERS` yourself.
15. **Dead code in `merge-bar.mjs` (S, CODEOWNERS).** `chooseUpdate` and `worktreeLive` are no longer
    called by the cycle. Remove them with their tests once the author agrees.
16. **Canvases (S).** `canvases.mjs` shows runs from the board; add a test for its `healthBlock` with
    a folded board fixture.

## Definition of done for any item

`node --test orchestration/*.test.mjs orchestration/test/` green, `pnpm precheck` green,
`orchestration/docs.test.mjs` green (update any doc your change affects in the same PR), a
CHANGELOG line with the key, and a `--dry-run` cycle against the live repo that shows no new
**Needs you** line you cannot explain.
