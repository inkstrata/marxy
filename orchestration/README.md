# Orchestration — how the fleet runs

Three roles, one loop, everything on disk so any session can pick it up cold.

| Role | Default model (edit `models.json`) | Runs | Owns |
| --- | --- | --- | --- |
| **Orchestrator** | Claude Sonnet 5, medium reasoning | continuously, as the main Cursor agent in this repo | dispatch, review, merge, the board (`state.json` mirrored into Jira), `needs-human.md` |
| **Planner** | Claude Sonnet 5, high reasoning | periodically, as a subagent the orchestrator invokes | re-sequencing, splitting, new stories, ADR proposals, plan deltas |
| **Implementor** | Composer 2.5 | one per story, in its own git worktree | exactly one story, on its own branch, inside its listed paths |

The orchestrator never implements. The planner never implements. Implementors never plan.
Humans (the author) review taste, approve CODEOWNERS paths, and answer `needs-human.md`.

**Jira is the board of record** — project MARXY at <https://marxy.atlassian.net>, four states,
no WIP cap. `state.json` is the local mirror the scripts read; `jira.mjs` keeps the two equal.
The process, including the definitions of ready and done, is `docs/sdlc.md`.

## The loop (orchestrator)

1. `node orchestration/ready.mjs` — stories whose earlier phase is settled, whose
   dependencies are done, and whose paths do not overlap anything in progress. It never
   offers a story from phase N+1 while phase N still has `todo` or `in_progress` work,
   unless the story is labelled `cross-phase`. `human-gated` stories, and stories with
   empty Acceptance or empty Paths, are refused with the rule named. Dispatch lanes stay
   uncapped (`models.json` `lanes` is `null`); a positive value is the implementor WIP
   limit and a story that would exceed it is `blockedByLanes`, not a dependency wait.
   `reviewLanes` (4) is a different cap: while the count of `in_review` stories is at or
   above it, ready dispatches nothing and prints `blockedByReviewWip` with the count and
   the cap. A returned story leaves In Review, so it does not count. The other honest
   counters are `blockedByDeps` and `blockedByPaths`.
2. `node orchestration/dispatch.mjs KEY [KEY…]` — for each: create a worktree and branch, run
   the implementor headlessly with `prompts/implementor.md` plus the story, wait. Results land
   in `orchestration/results/KEY.json`. (Or spawn the `implementor` subagent per key in-app and
   have it follow the same prompt; the result file is the contract either way.)
3. `node orchestration/review.mjs KEY` — a review packet: story, acceptance criteria, diff
   stat, files outside the listed paths (must be none; `CHANGELOG.md`, `pnpm-lock.yaml` and
   `results/` are allowed extras), gate outputs, the implementor's notes, and explicit
   pass/fail lines for a CHANGELOG entry, a claimed check per acceptance criterion, and a
   taste-queue row when fixtures/baselines changed. If it cannot determine the branch or
   compute the diff it exits non-zero and says so — it does not print `none` for the
   boundary checks, and when `state.json` has no branch it names the four checks that
   cannot run without one. Decide: **merge**, **return** (notes appended, attempts+1), or
   **escalate** (attempts ≥ 2 → the planner splits it or the escalation model takes it).
4. The cycle **adopts** the open PR (`adopt.mjs`): any non-draft PR whose title or branch names a
   key the board does not have In Review becomes In Review with its number and is linked in Jira —
   a story's PR, and an out-of-plan PR whose row is only on its branch alike. It lands once CI is
   green, a reviewer has signed it, and, for CODEOWNERS paths, a human approved; squash, then
   `state.mjs done KEY`, which moves the Jira issue too. Nobody runs `gh pr merge` by hand.
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
modes: `node orchestration/cycle.mjs` mirrors the board into Jira, reads GitHub once (two `gh pr
list` calls, `github.mjs`, where it used to make three calls per open PR plus one per worktree),
adopts open PRs the board does not know are in review, merges the pull requests that are provably
finished, names what should start next (dispatching headlessly if `cursor-agent` is
on PATH), asks whether the planner is due, and writes `status.md`. It is idempotent, so
`./orchestration/loop.sh` just runs it until interrupted — `INTERVAL=600`, `ONCE=1` for cron,
`--no-merge` to decide without landing anything, `--dry-run` to change nothing anywhere (Jira
included), `--low` or `--minimal` to spend less.

The cycle acts on the computed review order (`review-order.mjs`, ADR-0025). It calls
`gh pr update-branch` on **at most one** pull request per cycle — the first order entry
that is BEHIND — and every other BEHIND pull request prints
`behind main; waiting its turn in the review order (position N)`. A DIRTY pull request is
returned to In Progress with `attempts` unchanged and the conflicting files named in
`results/KEY.json`; the cycle cannot resolve a conflict and a reviewer reading one is
reading nothing.

What the cycle will never do is decide that a diff satisfies its story. Green gates prove the
code works, not that it does what was asked, so a PR merges only once a reviewer (never the
implementor) writes `results/KEY.approved` and signs it with `node orchestration/approve.mjs KEY`,
which stamps in the commit being approved. That is an agent action. `approve.mjs` refuses to
sign — and writes no signature — when the pull request is BEHIND, DIRTY, or not the first entry
of the review order, and prints which of the three held it. There is no environment
variable that skips those checks. Unsigned, or signed against a different commit, holds the
PR: a review is of a tree, and a push after it lands turns the approval into a note about
something else. When the rest of the quality bar in `docs/sdlc.md` is green and only CI is
still running, the cycle enables GitHub auto-merge rather than waiting for the next loop.
Everything else about a merge — checks, conflicts, CODEOWNERS, the path boundary, the
CHANGELOG line, the result file — is checked by `merge-bar.mjs`, and a held PR always
prints the reason it was held. CODEOWNERS paths still need the author.

`node orchestration/readiness.mjs` prints that queue as one table: every open pull request,
with its URL, CI conclusion, mergeability, approval, who it waits on, and the next action,
in the review/merge order 80/81 already compute. `--json` prints the same rows. Every
approval run ends with this table.

Check model ids once: `cursor-agent --list-models` and the in-app model picker; put the exact
names in `models.json`. Reasoning effort is set where Cursor exposes it (picker or agent
frontmatter); the CLI flag, if present in your version, is read from `models.json`.

## Compute modes

Four levels, weakest to strongest. `default` and `low` are Sonnet-led and are where you'll
spend most of your time; `high` is the Opus tier for when judgement quality matters more than
cost; `minimal` is the Cursor-only floor for when only Cursor-included spend is available.

| Mode | How | Orchestrator | Planner | Implementor | Escalation | Reviewer |
| --- | --- | --- | --- | --- | --- | --- |
| **high** | `--high` or `MARXY_COMPUTE=high` | Sonnet 5, medium | Opus 5, high | Grok 4.6 | Opus 5, high | Opus 5, high |
| **default** | `"compute": "default"` | Sonnet 5, medium | Sonnet 5, high | Composer 2.5 | Opus 5, high | Sonnet 5, high |
| **low** | `--low` or `MARXY_COMPUTE=low` | Sonnet 5, medium | Sonnet 5, medium | Composer 2.5 | Grok 4.6 | Sonnet 5, medium |
| **minimal** | `--minimal` or `MARXY_COMPUTE=minimal` | Composer 2.5 | Composer 2.5 | Composer 2.5 | Grok 4.6 | Composer 2.5 |

**`minimal` is Cursor-only by construction**: no role in that mode names a Claude, GPT, or
Gemini model, so the fleet runs entirely on Cursor-included spend. Its escalation ceiling is
Grok because that's the strongest thing configured anywhere in the mode — a story that fails
twice under `minimal` moves to `escalate` (the planner or a human decides), it never silently
reaches for Opus. If you need a stronger model at any point, switch modes explicitly; `minimal`
will not do it for you.

The `implementor: Composer 2.5` choice in `default`/`low` is a live experiment, not a settled
fact — see `models.json`'s `_modelNote` for the small reviewer-judgement pilot (not a vendor
benchmark) it's grounded in, and compare `state.json`/`results/*.json` `model` fields against
outcomes as more stories run on it before trusting it further.

Precedence: `--low` / `--minimal` / `--high` / `--compute=NAME`, then `MARXY_COMPUTE`, then the
`compute` field in `models.json`. `cycle.mjs` pins `MARXY_COMPUTE` for the child processes
it starts (dispatch, planner trigger), so a flag on the cycle is enough. In-app, pass each
role's `inApp` slug when you spawn a subagent — verify that slug in the model picker first;
`models.json`'s `_modelNote` flags which ones are unverified as of this edit.

## Files

| File | What |
| --- | --- |
| `models.json` | model id and effort per role, plus `default` / `low` / `minimal` compute profiles; `lanes` (dispatch, stays null) and `reviewLanes` (In Review cap, 4) |
| `lib.mjs` | shared helpers; run it to print the resolved compute roles |
| `jira.mjs` | the Jira bridge: `doctor`, `sync`, `push`, `move`, `pr`, `release`, `bootstrap` |
| `jira-map.json` | what each issue was called before Jira existed, so old commits stay readable |
| `state.json` | the local mirror of the board: status, attempts, branch, PR per story |
| `deps.json` | story dependencies (the CSV has none) and phase membership |
| `cycle.mjs` | one idempotent cycle: push, snapshot GitHub, adopt, merge what is finished, dispatch, plan check, report |
| `github.mjs` | the cycle's one read of GitHub: every open PR, and recent PR states by branch |
| `adopt.mjs` | which open PRs the cycle moves to In Review, and how |
| `merge-bar.mjs` | the quality bar: hold / auto-merge / merge; the only decision `cycle.mjs` consults |
| `readiness.mjs` | every open PR as a merge-readiness table in review order; `--json` for machines |
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
- A story's diff may touch only its `Paths` (plus `CHANGELOG.md`, `pnpm-lock.yaml`,
  `results/` and its own result file), and its own board row and `deps.json` entry — never
  another story's. `review.mjs` lists violations; a violation is an
  automatic **return**. `node --test orchestration/test` is the fixture-board check for
  the ready and review scripts.
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
