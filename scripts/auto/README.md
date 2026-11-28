# scripts/auto: the standing automation

Marxy's cycle (`docs/working.md`) run on a timer. Agent jobs are Claude desktop app scheduled tasks on Osiris,
the Windows hub, that follow skills in `.claude/skills/`. Everything mechanical is
`node scripts/auto/auto.mjs <command>`, run by Task Scheduler on Osiris, launchd on Eris (macOS) and a systemd
user timer on Set (SteamOS). Only the GitHub account `inkstrata` contributes: write commands take
`GH_TOKEN=$(gh auth token -u inkstrata)` (PowerShell: `$env:GH_TOKEN = (gh auth token -u inkstrata)`), never
`gh auth switch`.

## What runs when

Pacific time. `schedule.json` holds the same list as data.

| When | Job | Kind, where | Does |
| --- | --- | --- | --- |
| daily 00:20, until 05:00 | `night` | agent, Osiris | carry-over, then the week's queue (the `night` skill); Saturday the plan intake, Tuesday a bug hunt within half the night's allowance, Thursday and Friday the sweep |
| daily 05:15 | `nightly` | script, Osiris | full verify of `main` with the browser suite and `check:tauri`, red browser files rerun alone, the Windows install check |
| daily 08:45, until 13:30 | `day` | agent, Osiris | triage of the nightly and device results, then more building (the `night` skill, day mode) |
| Friday 08:15 | `plan` | agent, Osiris | the week's outcome, `work/STATE.md`, the ledger row and next week's plan as a pull request (the `plan-week` skill) |
| every 30 minutes | `tick` | script, Osiris | the merge gate (00:00 to 14:00) and the dashboard issue (always) |
| hourly, on power | `device` | script, Eris | macOS build and install check, the macOS browser suite weekly, runs spoiled by sleep retried |
| hourly, on power | `device` | script, Set | Linux install check of CI's AppImage |
| daily 01:30 | `installers` | GitHub Actions | Linux AppImage and deb from `main` |
| Wednesday 02:00 | `browser-windows` | GitHub Actions | the hosted Windows browser files |

**The week.** It starts at the usage reset, Friday 20:00. Its plan is `work/weeks/<that Friday>.md`, written on
Friday morning as a pull request labelled `plan`. The owner can comment, push or veto until Saturday's night
run, which answers the comments (the intake) before it builds; the gate merges the plan after that. From
Thursday 00:00 to Friday 14:00 the sweep spends the week's leftover budget, after the queue, on further rows
from `work/todo.md`: Next, then Structure, then Big files.

## Models

The job's own session stays thin and delegates; its agents are defined in `.claude/agents/`.

| Agent | Model, effort | Does |
| --- | --- | --- |
| `builder` | Sonnet, medium | one piece: build, test, verify, open the pull request; escalated to Opus after two failed attempts |
| `reviewer` | Opus, medium | one review; always another model from the builder (a `work/`- or docs-only pull request built by Haiku or Opus gets Sonnet) |
| `scout` | Haiku, low | reading: a failure's cause, the week's facts, a plan checked against the tracker |
| planner | Opus, medium | the plan job's own session |

At most 3 builders at once. Follow-ups go to the same agent (`SendMessage`) before a fresh one is spawned.
Fable is used only when the week's plan pull request has its Fable box ticked by the owner.

## The budget

- **The owner's window**, 14:00 to 24:00, has no agent work. A 5-hour usage block starts at the first
  message after the last one expired; a new block must end by 14:00.
- **5-hour meter:** at 75% no new agents; at 85% stop, finishing only the current step.
- **Weekly meter:** the owner keeps a reserve of max(15, 60 − the owner's use this week) percent; the sweep
  lowers it to at most 30 on Thursday and 15 on Friday. Each slot may use the headroom divided by the slots
  left before Friday 14:00.
- **Usage** comes from the desktop app's `get_usage` tool. The job loads it with ToolSearch
  (`select:mcp__ccd_session_mgmt__get_usage`), writes the returned `plan` object to a file and runs
  `auto.mjs usage --json <file>`, which prints `{ allowed, reason, noNewAgents, stopAt, allowancePct, sweep,
  blind, ... }`. Without the tool, `auto.mjs gate` answers in blind mode: at most 2 builders and 3 hours.
  Jobs check again before each new agent and at least every 30 minutes.
- `auto.mjs run start|end --job <id> --run <run-id>` brackets each job, so the weekly meter's growth during
  runs is counted as the automation's and the rest as the owner's.

## The merge gate

No agent merges. Auto mode's classifier refuses to merge a pull request no person approved, and the fleet's
rule left merging in this repository to the owner. The owner's written policy (merge what an agent other than
its author approved, with CI green and no owner path touched) is enforced here, by a script, and by GitHub's
required `ci` check. `.claude/settings.json` denies `gh pr merge` to agents.

`auto.mjs tick` merges a pull request when all of these hold:

- it is open, not a draft, and its head is `agent/*`;
- its body ends with `<!-- marxy-author run=<id> model=<model> -->`;
- a comment carries `<!-- marxy-review verdict=approve head=<sha> run=<id> model=<model> -->` for its current
  head, from a run and a model different from the author's, with no later `changes` verdict;
- the `ci` check passed and no check failed;
- it touches no path in `.github/CODEOWNERS` (those wait for the owner);
- it has no `hold` label, GitHub calls it `CLEAN`, and the time is 00:00 to 14:00;
- for a `plan` pull request: the weekly reset has passed, and the newest `<!-- marxy-intake head=<sha> -->`
  comment is for the current head and newer than every owner comment (one with no `<!-- marxy-` marker).

`auto.mjs merge --dry-run` prints what it would do and why each one is held.

## Records

Run ids are `<job>-<YYYYMMDD>-<HHMM>`, with `-b<n>` or `-r<n>` for builders and reviewers. A night build's
record is its pull request: the builder's account and the review comment. Each run's summary goes to the
`auto-state` data branch (`auto.mjs record <night|day> <file>`), with the nightly and device results. The
pinned issue "Marxy dashboard" shows the changelog, what is next in the plan, what waits for the owner, health
and budget. Local logs are under `~/.local/state/fleet/marxy/`. The weekly plan, outcome, `STATE.md` and ledger
row are in `work/` (`work/README.md`).

## Install

| Device | Install | Stop |
| --- | --- | --- |
| Osiris, agent jobs | in the Claude desktop app, scheduled tasks `marxy-night` (00:20 daily), `marxy-day` (08:45 daily) and `marxy-plan` (08:15 Friday, Opus), each run in `D:\Dev\marxy` with the prompt "Use the night skill in night mode" (or day mode, or the plan-week skill) | disable the task in the app |
| Osiris, scripts | `powershell -File scripts/auto/osiris.ps1` (`-Status` shows the tasks) | `powershell -File scripts/auto/osiris.ps1 -Remove` |
| Eris | `bash scripts/auto/eris/install.sh` | `launchctl bootout gui/$(id -u)/com.inkstrata.marxy-auto` |
| Set | `bash scripts/auto/set/install.sh` | `systemctl --user disable --now marxy-auto.timer` |

To hold one pull request, label it `hold`. The desktop app's scheduled tasks run only while the app is open
and the machine awake.

## Size guard

Code under `scripts/auto/` stays at 1,200 lines or less, and the `night`, `plan-week` and `review` skills at
600 lines of Markdown or less; `size.test.mjs` fails past either. In September 2026 the orchestration code
reached about 10,000 lines against about 12,000 of product and was torn out. Grow the product, not this.

## Files

| File | What it is |
| --- | --- |
| `auto.mjs` | the entry point: `usage`, `gate`, `run`, `status`, `merge`, `dashboard`, `tick`, `record`, `nightly`, `device` |
| `device.mjs` | the install and verify checks: `nightly` on Windows, `device` on macOS and Linux |
| `schedule.json` | every job, when and where it runs, as data |
| `lib/governor.mjs` | the budget rules: may agent work start now, and until when |
| `lib/merge-policy.mjs` | the merge gate's rules and the marker parser |
| `lib/codeowners.mjs` | which changed files `.github/CODEOWNERS` gives to the owner |
| `lib/state.mjs` | local run logs and the `auto-state` data branch |
| `lib/github.mjs` | the `gh` calls, with the contributor's token |
| `lib/dashboard.mjs` | collects the state and renders the dashboard issue |
| `osiris.ps1` | registers `tick` and `nightly` in Task Scheduler on Osiris |
| `eris/` | `eris/install.sh` and `eris/marxy-auto.plist`: the hourly launchd agent on Eris |
| `set/` | `set/install.sh`, `set/marxy-auto.service` and `set/marxy-auto.timer`: the hourly systemd user timer on Set |
| `size.test.mjs` | the size guard |
