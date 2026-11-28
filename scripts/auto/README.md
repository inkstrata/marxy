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
| Sunday 04:30 | `clean` | script, Osiris | `work clean --stale --apply` (old worktrees, folders and branches, archived first), then old logs and temporary folders pruned |
| daily 08:45, until 13:30 | `day` | agent, Osiris | triage of the nightly and device results, then more building (the `night` skill, day mode) |
| Friday 14:05, until 19:55 | `friday` | agent, Osiris | the final sweep (the `night` skill, final mode) |
| Friday 08:15 | `plan` | agent, Osiris | the week's outcome, `work/STATE.md`, the ledger row and next week's plan as a pull request (the `plan-week` skill) |
| every 30 minutes | `tick` | script, Osiris | the merge gate (any hour) and the dashboard issue |
| hourly, on power | `device` | script, Eris | macOS build and install check, the macOS browser suite weekly, runs spoiled by sleep retried, the weekly cleanup |
| hourly, on power | `device` | script, Set | Linux install check of CI's AppImage, the weekly cleanup |
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
- `usage` and `gate` take `--job <id>`: `research-now` selects a profile for the research queue's "run now" requests (any hour,
  5-hour line 60% soft and 70% hard, at most 3 hours; the presence check still applies), and any other job, such as
  `research-night`, gets the default rules. The research queue's calls with `--job research-night` and `--job research-now` land with
  ijdio/command-center#41; nothing calls them yet. `research-now` with no usage reading is refused.
- `auto.mjs run start|end --job <id> --run <run-id>` brackets each job, so the weekly meter's growth during
  runs is counted as the automation's and the rest as the owner's.

## The merge gate

No agent merges. Auto mode's classifier refuses to merge a pull request no person approved, and the fleet's
rule left merging in this repository to the owner. The owner's written policy (merge what an agent other than
its author approved, with CI green and no owner path touched) is enforced here, by a script, and by GitHub's
required `ci` check. `.claude/settings.json` denies `gh pr merge` to agents.

Only comments by the contributor `inkstrata` count; anyone else's are ignored, so they neither approve, hold nor
veto. Of those, a comment is the automation's only when its first line is `Independent review:` (or `Intake:`) and
its last non-empty line is one well-formed marker of that kind, every field present; any other is the owner's,
and a marker inside it, quoted or mentioned, counts for nothing.

`auto.mjs tick` merges a pull request when all of these hold:

- it is open, not a draft, its head is `agent/*`, and the head branch is in this repository (a fork's pull
  request is refused, whatever its branch is called);
- its body ends with `<!-- marxy-author run=<id> model=<model> -->`;
- a review comment carries `<!-- marxy-review verdict=approve head=<40-hex sha> run=<id> model=<model> -->` for
  its current head, from a run and a model different from the author's, with no `changes` verdict for that head
  in the same second or later;
- the `ci` check passed and no check failed;
- it touches no path in `.github/CODEOWNERS` (those wait for the owner);
- it has no `hold` label, and GitHub calls it `CLEAN` (merges happen at any hour);
- for a `plan` pull request: the weekly reset has passed, and the newest `<!-- marxy-intake head=<sha> -->`
  comment is for the current head and newer than every owner comment.

`auto.mjs merge --dry-run` prints what it would do and why each one is held.

## Friday final sweep

The weekly limits reset Friday 20:00 and what is left is lost, so from Friday 14:00 to 20:00 the governor stops
protecting the owner's window and spends it (`POLICY.finalSweep`). In that window `decide()` skips the
owner-window and 14:00-block rules for every profile, `research-now` included; the 5-hour line is 75% soft (no
new agents) and 90% hard (stop); the weekly reserve is a flat 2%, so the allowance is the whole headroom; `stopAt`
is 19:55. It answers `finalSweep: true`. With no usage reading it refuses (no blind mode). If the owner is at the
machine, or presence is unknown, the gate does not refuse but answers `lightOnly: true`: reading and writing work, local verify at
`--tier quick`, CI runs the rest; for `research-now` presence is ignored. The `friday` job runs the `night`
skill in final mode.

## When you are using the machine

Osiris and Set are also gaming machines, and Eris is the owner's laptop. `lib/presence.mjs` says the owner is
there when any of these holds:

- keyboard or mouse input in the last 10 minutes (Windows `GetLastInputInfo`, macOS `HIDIdleTime`, KDE's
  `GetSessionIdleTime` on Linux; no signal elsewhere);
- on Windows, a full-screen app (`SHQueryUserNotificationState`: full screen, Direct3D, presentation, Store app);
- a game process: a path or command line with `steamapps/common`; on Windows also a path under `Epic Games`,
  `XboxGames`, `GOG Galaxy\Games`, or `Riot Games` (controller play shows no input); on Linux
  `SteamLaunch`. Wallpaper Engine, the Epic launcher and the Riot client are not counted;
- presence unknown: a probe that runs but fails, times out or answers something unreadable (including a KDE idle
  time between 600 and 600,000, which reads either as recent input or as idleness, since its unit is unverified).
  It fails closed: only a probe whose command is not on the system, such as `qdbus` without KDE, is no signal.

What each job does: `usage` and `gate` answer `allowed: false` ("owner is using this machine"), so the night skill
starts nothing new (it also starts no agent while a Claude session of the owner's is working). `nightly` and
`device` check at the start and again before each long step; when busy they stop, publish what ran with the rest
marked skipped (not good for freshness, so retried), and exit 0. Both run at below-normal priority, and `verify`
does too when `MARXY_NICE=1`, which builders and the device scripts set. On Osiris `Marxy - nightly` also waits for
10 idle minutes (up to 8 hours) and both tasks run at priority 7. `tick` is light and runs regardless. `clean` stands down the same way (Osiris holds it until idle).

## Cleanup

`auto.mjs clean` is registered as the `Marxy - clean` task on Osiris, Sundays 04:30, held until the machine is idle; Eris and Set run it
from `device` when the newest `clean/<os>.json` is over a week old. It runs `node scripts/work.mjs clean --apply --stale` from the checkout, which removes landed work, then
worktrees with no commit for 30 days, unregistered folders beside them untouched for 14 days and branches already on
`origin/main` or under an `archive/*` tag. A tip not safe elsewhere is tagged `archive/branch/<name>` and pushed first;
uncommitted changes are saved as `changes.patch` and `untracked.tar` (every untracked file git does not ignore, whatever
folder it is in; of the ignored ones, all but those under `node_modules`, `target`, `dist`, `.pnpm-store` or `.venv`),
checked complete before the worktree goes, and folders as a tar without `node_modules` and `target`, under `~/.local/state/fleet/marxy/archive/worktrees/<name>-<date>/`. Then logs older than 30 days, rows
older than 90 days in the `.jsonl` files and `marxy-verify` temporary folders older than 14 days go. The result is
published as `clean/<os>.json`; the dashboard's Health section shows its age.

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

Code under `scripts/auto/` stays at 1,500 lines or less, and the `night`, `plan-week` and `review` skills at
600 lines of Markdown or less; `size.test.mjs` fails past either. In September 2026 the orchestration code
reached about 10,000 lines against about 12,000 of product and was torn out. Grow the product, not this.

## Files

| File | What it is |
| --- | --- |
| `auto.mjs` | the entry point: `usage`, `gate`, `run`, `status`, `merge`, `dashboard`, `tick`, `record`, `clean`, `nightly`, `device` |
| `device.mjs` | the install and verify checks: `nightly` on Windows, `device` on macOS and Linux |
| `schedule.json` | every job, when and where it runs, as data |
| `lib/governor.mjs` | the budget rules: may agent work start now, and until when |
| `lib/merge-policy.mjs` | the merge gate's rules and the marker parser |
| `lib/clean.mjs` | the weekly cleanup: runs `work clean --stale`, prunes old logs, rows and temporary folders, publishes the result |
| `lib/presence.mjs` | whether the owner is using this machine: input, a full-screen app, a game |
| `lib/codeowners.mjs` | which changed files `.github/CODEOWNERS` gives to the owner |
| `lib/state.mjs` | local run logs and the `auto-state` data branch |
| `lib/github.mjs` | the `gh` calls, with the contributor's token |
| `lib/dashboard.mjs` | collects the state and renders the dashboard issue |
| `osiris.ps1` | registers `tick` and `nightly` in Task Scheduler on Osiris (`nightly` only when idle) |
| `eris/` | `eris/install.sh` and `eris/marxy-auto.plist`: the hourly launchd agent on Eris |
| `set/` | `set/install.sh`, `set/marxy-auto.service` and `set/marxy-auto.timer`: the hourly systemd user timer on Set |
| `size.test.mjs` | the size guard |
