# Orchestration — how the fleet runs

Three roles, one loop, everything on disk so any session can pick it up cold.

| Role | Default model (edit `models.json`) | Runs | Owns |
| --- | --- | --- | --- |
| **Orchestrator** | Claude Opus, medium reasoning | continuously, as the main Cursor agent in this repo | dispatch, review, merge, the board (`state.json` mirrored into Jira), `needs-human.md` |
| **Planner** | Claude Opus, medium reasoning | periodically, as a subagent the orchestrator invokes | re-sequencing, splitting, new stories, ADR proposals, plan deltas |
| **Implementor** | Grok 4.6 High Fast | one per story, in its own git worktree | exactly one story, on its own branch, inside its listed paths |

The orchestrator never implements. The planner never implements. Implementors never plan.
Humans (Ian) review taste, approve CODEOWNERS paths, and answer `needs-human.md`.

**Jira is the board of record** — project MARXY at <https://marxy.atlassian.net>, four states,
no WIP cap. `state.json` is the local mirror the scripts read; `jira.mjs` keeps the two equal.
The process, including the definitions of ready and done, is `docs/sdlc.md`.

## The loop (orchestrator)

1. `node orchestration/ready.mjs` — stories whose dependencies are done and whose paths do
   not overlap anything in progress. Lanes are uncapped (`models.json` `lanes` is `null`);
   a positive value would restore a WIP limit.
2. `node orchestration/dispatch.mjs KEY [KEY…]` — for each: create a worktree and branch, run
   the implementor headlessly with `prompts/implementor.md` plus the story, wait. Results land
   in `orchestration/results/KEY.json`. (Or spawn the `implementor` subagent per key in-app and
   have it follow the same prompt; the result file is the contract either way.)
3. `node orchestration/review.mjs KEY` — a review packet: story, acceptance criteria, diff
   stat, files outside the listed paths (must be none), gate outputs, the implementor's notes.
   Decide: **merge**, **return** (notes appended, attempts+1), or **escalate** (attempts ≥ 2 →
   the planner splits it or the escalation model takes it).
4. `node orchestration/jira.mjs pr KEY <number>` — links the PR on the issue and moves it to
   In Review. Merge only when CI is green and, for CODEOWNERS paths, a human approved. Squash.
   Then `node orchestration/state.mjs done KEY`, which moves the Jira issue too.
5. `node orchestration/planner-trigger.mjs` — says whether to invoke the planner now
   (every 5 merges, any story at 2 failures, a phase boundary, a tripwire in `docs/roadmap.md`,
   or 7 days since the last plan). If yes, run the planner with `prompts/planner.md`.
6. Anything only a person can do goes in `needs-human.md`; the orchestrator continues with
   other stories and re-checks the file each cycle. When nothing is ready and nothing is in
   progress, write a status report to `orchestration/status.md` and stop.

## Two ways to run it

**A. In Cursor, in-app.** Open the repo, choose the orchestrator model for the active compute
mode (Opus medium by default; Sonnet 5 medium in `--low`; Grok 4.6 High Fast in `--minimal`),
paste `prompts/orchestrator.md` as the first message (or use it as a custom mode). Subagents
are defined in `.cursor/agents/` (`planner`, `implementor`, `reviewer`); the orchestrator
invokes them by name and, when compute is not `default`, passes the role's `inApp` model.
If your Cursor build does not read `.cursor/agents/`, use the same files as custom modes,
or fall back to B for implementors.

**B. Headless, through the Cursor CLI.** `dispatch.mjs` shells out to `cursor-agent -p --force
--model <implementor model>` inside each worktree, in parallel. The orchestrator itself can be
the in-app agent (A) or a headless loop driven by `orchestration/loop.sh`.

Either way the mechanical half of every cycle is one command, and it is the same command in both
modes: `node orchestration/cycle.mjs` mirrors the board into Jira, merges the pull requests that
are provably finished, names what should start next (dispatching headlessly if `cursor-agent` is
on PATH), asks whether the planner is due, and writes `status.md`. It is idempotent, so
`./orchestration/loop.sh` just runs it until interrupted — `INTERVAL=600`, `ONCE=1` for cron,
`--no-merge` to decide without landing anything, `--low` or `--minimal` to spend less.

What the cycle will never do is decide that a diff satisfies its story. Green gates prove the
code works, not that it does what was asked, so a PR merges only once a reviewer (never the
implementor) writes `results/KEY.approved` and signs it with `node orchestration/approve.mjs KEY`,
which stamps in the commit being approved. That is an agent action. Unsigned, or signed against
a different commit, holds the PR: a review is of a tree, and a push after it lands turns the
approval into a note about something else. When the rest of the quality bar in `docs/sdlc.md`
is green and only CI is still running, the cycle enables GitHub auto-merge rather than waiting
for the next loop. Everything else about a merge — checks, conflicts, CODEOWNERS, the path
boundary, the CHANGELOG line, the result file — is checked by `merge-bar.mjs`, and a held PR
always prints the reason it was held. CODEOWNERS paths still need Ian.

Check model ids once: `cursor-agent --list-models` and the in-app model picker; put the exact
names in `models.json`. Reasoning effort is set where Cursor exposes it (picker or agent
frontmatter); the CLI flag, if present in your version, is read from `models.json`.

## Compute modes

Same loop, cheaper models. `default` is the quality profile; the others exist so the fleet
can keep moving when Opus time is tight.

| Mode | How | Orchestrator / planner / reviewer / escalation | Implementor |
| --- | --- | --- | --- |
| **default** | `"compute": "default"` | Claude Opus 5, medium | Grok 4.6 High Fast |
| **low** | `--low` or `MARXY_COMPUTE=low` | Claude Sonnet 5, medium | Grok 4.6 High Fast |
| **minimal** | `--minimal` or `MARXY_COMPUTE=minimal` | Grok 4.6 High Fast | Grok 4.6 High Fast |

Precedence: `--low` / `--minimal` / `--compute=NAME`, then `MARXY_COMPUTE`, then the
`compute` field in `models.json`. `cycle.mjs` pins `MARXY_COMPUTE` for the child processes
it starts (dispatch, planner trigger), so a flag on the cycle is enough. In-app, pass each
role's `inApp` slug when you spawn a subagent.

## Files

| File | What |
| --- | --- |
| `models.json` | model id and effort per role, plus `default` / `low` / `minimal` compute profiles |
| `lib.mjs` | shared helpers; run it to print the resolved compute roles |
| `jira.mjs` | the Jira bridge: `doctor`, `sync`, `push`, `move`, `pr`, `release`, `bootstrap` |
| `jira-map.json` | what each issue was called before Jira existed, so old commits stay readable |
| `state.json` | the local mirror of the board: status, attempts, branch, PR per story |
| `deps.json` | story dependencies (the CSV has none) and phase membership |
| `cycle.mjs` | one idempotent cycle: push, merge what is finished, dispatch, plan check, report |
| `merge-bar.mjs` | the quality bar: hold / auto-merge / merge; the only decision `cycle.mjs` consults |
| `loop.sh` | `cycle.mjs` until interrupted |
| `results/KEY.json` | written by implementors; the only handshake |
| `results/KEY.approved` | a reviewer's judgement that the diff satisfies the story, signed by `approve.mjs` against the commit it read; no merge without it |
| `needs-human.md` | queue of things a person must do |
| `status.md` | the orchestrator's last report |
| `prompts/*.md` | role prompts, the source of truth for behaviour |
| `../docs/plan/jira-issues.csv` | the stories: summary, acceptance, paths, labels |

## Rules the scripts enforce, so nobody has to remember them

- One story, one worktree, one branch `type/KEY-slug` where KEY is the Jira key; branches are
  never shared. Every board transition is mirrored to Jira; a Jira failure prints the command
  to re-run and never stops the loop.
- A story's diff may touch only its `Paths` (plus `CHANGELOG.md` and its own result file).
  `review.mjs` lists violations; a violation is an automatic **return**.
- Contracts (`packages/*/src/contracts/**`, `packages/theme/src/tokens.css`) change only in a
  story whose paths name them and that carries an ADR; `.cursor/rules/frozen-contracts.mdc`
  tells the agent so before it edits.
- Attempts are capped at 2 per implementor model. Time cap per attempt: 45 minutes.
- Nothing is merged with a red gate. Baseline updates need a taste-queue entry.
- No AI attribution anywhere (a hook blocks it locally; the reviewer checks too).

## Budget

Implementors are cheap and fast; spend them freely on retries inside the caps. In `default`,
Opus time goes to review packets, merges, and the periodic plan. If that model is spending
more than a third of its turns reading implementor diffs, the stories are too big: trigger
the planner. `--low` and `--minimal` spend the same turns on cheaper models; they do not
change the lane budget or the attempt cap.
