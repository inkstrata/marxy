# Marxy's standing automation: the design

The answer to `PROMPT.md` beside this file. Written 2026-11-27 on Osiris. The operating manual is
`scripts/auto/README.md`; this file says what was decided and why.

## Bottom line

- **It is the existing cycle on a timer, not a new process.** `docs/working.md` already says how a change goes
  from the tracker to `main`. Agent jobs are Claude desktop scheduled tasks on Osiris that follow three skills
  (`night`, `plan-week`, `review`). Everything mechanical is one small script, `scripts/auto/auto.mjs`, run by
  Task Scheduler, launchd or a systemd timer. Scripts never call Claude.
- **No agent merges.** A deterministic merge gate merges a pull request only when an agent other than its
  builder, on a different model, approved its current commit, `ci` is green, and no file matches
  `.github/CODEOWNERS`. Everything else waits for you. The classifier is never asked to approve a merge.
- **Your usage stays yours.** No agent work from 14:00 to midnight. No 5-hour block that reaches 14:00. Hard stop
  at 85% of the 5-hour limit. The week keeps a reserve for your other projects (60%, less what you have used),
  and the leftover is spent from Thursday night to Friday morning, before it would expire at the Friday 20:00 reset.
- **Night does the big work.** The night job builds from 00:20 to 05:00; the full Windows verify, with the browser
  suite and the real-window check that CI cannot run, follows at 05:15; the day job triages and continues until
  13:30.
- **Sonnet builds, Opus reviews, Haiku reads.** The scheduled session stays thin and delegates; Opus plans once a
  week; Fable only if you tick the box in that week's plan.
- **A weekly plan you can veto or change**, sent as a pull request on Friday morning, lands after the reset.
- **One dashboard**: a pinned issue, "Marxy dashboard", refreshed every 30 minutes: next up from the plan, the
  changelog, what waits for you, health, budget.
- **It lives in marxy**, in `scripts/auto/` and `.claude/`, under a size limit a test enforces: 1,200 lines of
  code and 600 lines of skills.

## The schedule (Pacific)

| When | Job | Kind, where | Model | What |
| --- | --- | --- | --- | --- |
| daily 00:20 to 05:00 | `night` | agent, Osiris desktop task | Sonnet session; Sonnet builders, Opus reviewers | budget gate; carry-over fixes; the week's queue; Saturday: plan intake; Tuesday: a bug hunt; Thursday and Friday: the sweep |
| daily 05:15 | `nightly` | script, Osiris Task Scheduler | none | full verify of `main` (browser suite and `check:tauri` included), each red re-run alone three times, then the Windows install check |
| daily 08:45 to 13:30 | `day` | agent, Osiris desktop task | Sonnet; Haiku scouts | triage of the nightly and device results, then more of the queue if the budget allows |
| Friday 08:15 | `plan` | agent, Osiris desktop task | Opus, medium | the week's outcome, `STATE.md`, a ledger row, next week's plan as a PR |
| every 30 min | `tick` | script, Osiris Task Scheduler | none | the merge gate (00:00 to 14:00 only; changed 2026-11-27, see the note at the end) and the dashboard |
| hourly, on power | `device` | script, launchd on Eris | none | macOS install check daily, macOS browser suite weekly; a run that overlapped a sleep is retried |
| hourly, on power | `device` | script, systemd timer on Set | none | the nightly AppImage installed and launched |
| daily 01:30 | `installers` | GitHub Actions | none | Linux AppImage and deb from `main` |
| Wednesday 02:00 | `browser-windows` | GitHub Actions | none | the hosted Windows browser files, for repeat green runs |

The week runs from the Friday 20:00 reset to the next. Its shape:

- **Saturday 00:20:** plan intake. Your comments on the plan PR are applied, and a closed plan means the week runs
  on carry-over, fixes, tests and hardening only.
- **Tuesday night:** one bug hunt with the existing `bug-catch`, `bug-verify` and `bug-triage` skills, within half
  the night's allowance.
- **Thursday 00:00 to Friday 14:00:** the sweep. After the queue, further rows from `todo.md` are taken in order.
- **Friday 08:15:** the plan for the next week. You have your Friday window to veto or change it.

## The budget governor

`scripts/auto/lib/governor.mjs`, a pure function with tests. Each agent job reads the desktop app's `get_usage`
at its start, before every new agent, and at least every 30 minutes, and passes the reading to the script.

| Rule | Why |
| --- | --- |
| No agent work 14:00 to 24:00 | your window |
| A new 5-hour block must end by 14:00, so none starts after 09:00 | a block starts at the first message after the last one expired and lasts five hours; a block the automation opened at 10:00 would still be half spent when your window opens |
| 5-hour at 75%: no new agents; at 85%: stop | your hard stop |
| Weekly reserve: max(15, 60 − your use this week) | you use 30 to 60% on other projects; whatever is left usually went to Marxy, which is what the automation now does |
| Sweep, Thursday 00:00 to Friday 14:00: the reserve drops to at most 30 on Thursday and 15 on Friday | after that it expires unused at the reset |
| Outside the sweep, each slot spends headroom ÷ slots left | it advances every day without front-loading |
| Fable: only when the week's plan PR has its box ticked | Fable costs too much against both limits |
| `get_usage` unreadable: at most 2 builders and 3 hours | blind runs stay small |

Your share and the automation's are told apart by bracketing each job (`auto.mjs run start|end`). Weekly growth
inside the brackets is the automation's; the rest is yours.

## The orchestration pipeline

Three loops, each driving the next. Judgement sits in the agents and rules sit in scripts. Every hand-off is a file,
a pull request or a marker.

### The weekly loop: planning

1. **Friday 08:15, `plan`** (Opus, medium) reads where things stand:
   - `STATE.md`, `todo.md` and the ledger
   - the closing week's file and the PRs merged in it
   - the nightly, device and night summaries on `auto-state`
   - the budget the week actually used

   It appends the week's **Outcome** (what landed against the plan, what slipped and why, the budget, and the
   health of each device). Then it rewrites `STATE.md`, adds one ledger row, and writes next week's file:
   - **Goals:** three at most.
   - **Queue:** ordered pieces, sized to what the past weeks actually landed per night.
   - **Hunt:** the axis for Tuesday.
   - **Hardening:** device items.
   - **Waiting on you**
   - **Fable box:** unticked unless one piece needs it.
2. **Review:** a scout checks the plan against the tracker and the budget, then posts its marker.
3. **Friday 14:00 to 24:00, your window.** Merge the PR as it is, edit it, comment on it, label it `hold`, or close it
   (a veto).
4. **Saturday 00:30, intake.** The night run applies your comments to the plan branch and posts an intake marker,
   always, so the gate knows it has read you. The gate merges the plan on its next tick. A closed plan means a week
   of carry-over, fixes, tests and hardening only.

### The daily loop: orchestration

Each `night` run (00:30 to 05:00) and `day` run (08:49 to 13:30) follows the same skill:

| Step | What | Who |
| --- | --- | --- |
| Gate | `get_usage` → `auto.mjs usage`: allowed? until when? how much? | the session, then the script |
| Status | `auto.mjs status`: open PRs and why each is not merged; nightly and device results; the week's file | script |
| Triage (day only) | each real failure from the nightly run, the devices or `main`'s CI becomes either a small fix piece for this run or a tracker row | scout, then the session |
| Intake (Saturday only) | the plan PR, as above | the session |
| Carry-over | PRs with a CHANGES verdict or red CI go back to their builder before anything new starts | builder |
| Hunt (Tuesday only) | one bug hunt within half the night's allowance: `bug-catch`, `bug-verify`, `bug-triage` | Sonnet catchers and verifiers |
| Pick | the next queue rows, in order, honouring "after" notes, one writer per file set, up to three builders | the session |
| Build and review | the piece's life, below | builder, reviewer |
| Sweep (Thursday and Friday) | after the queue: further rows from `todo.md`'s Next, Structure and Big files sections | builders |
| Record | the run's summary: pieces, PRs, verdicts, usage at start and end, why it stopped; `pnpm work clean --apply` | the session, then the script |

The session re-checks the gate before every new agent and at least every 30 minutes. It never runs past the stop time
the gate gives.

### The continuous loop: mechanics

- **Every 30 minutes, `tick`:** the merge gate, then the dashboard.
- **05:15, `nightly`:** the full Windows verify, then the install check.
- **Hourly, the device runs** on Eris and Set.
- **CI** runs on every push.

None of these uses any plan usage.

### A piece's life

```
queued ─▶ building ─▶ open ─▶ reviewed ─┬─ approve ─▶ (gate) ─┬─ merged ─▶ recorded
   ▲         ▲                           │                     └─ held: waits for you
   │         └──────── changes ──────────┘
   └──── stale or stopped (draft PR, row kept)
```

| State | Recorded as | Moves on when |
| --- | --- | --- |
| queued | a row in the week's `## Queue` (and in `todo.md`) | a run picks it |
| building | `agent/<branch>` and its worktree; the row's `Branch` cell | the builder opens the PR |
| open | the PR, whose body ends with the author marker | the reviewer posts its verdict |
| reviewed | one review comment with its marker, tied to the head commit | approve: the gate looks at it; changes: back to building |
| held | the gate's reasons (on the dashboard) | you act: merge it yourself, comment, or remove `hold` |
| merged | the squash commit on `main`; the dashboard's changelog | the week's Outcome and ledger row |

### When things go wrong

| What | What happens |
| --- | --- |
| The builder can't get `verify --tier changed` green after two attempts | escalate the piece to an Opus builder; if that fails too, push it as a draft PR, keep the row, and say why in the run summary |
| Review says CHANGES twice and the builder disagrees | the PR is labelled `hold` and listed under "Waiting for you" |
| CI is red after the PR opened | carry-over at the next run, ahead of new work |
| `main` moved under the PR | the builder merges `origin/main` before every push (its rules) and re-runs what the merge touched, and the reviewer re-reads only what changed |
| A browser file fails in the nightly | it is re-run alone three times: three passes mean load, which is noted; anything else is real and goes to triage |
| 5-hour soft stop | no new agents, and the in-flight work finishes |
| 5-hour hard stop or the gate's stop time | builders push their work in progress as draft PRs and the run ends; the next run resumes from the PR |
| A PR with no progress over three runs | the night run closes it with a note and returns the row to the queue or to Later |
| A device run that overlapped a sleep | marked inconclusive and retried the next hour; not a failure |
| `get_usage` unreadable | blind mode: two builders, three hours |

### Roles and models

| Role | Model, effort | Does | Never |
| --- | --- | --- | --- |
| scheduled session | as set in the app (Sonnet; Opus for `plan`) | reads the gate, picks, delegates, records | builds code itself; merges |
| `builder` | Sonnet, medium (Opus after two failed attempts) | one piece in one worktree, proved by tests, PR with the author marker | merges; edits another worktree |
| `reviewer` | Opus, medium; Sonnet when the builder was not Sonnet | reads the diff, mutation-checks key tests, posts the one verdict comment | reviews its own model's work; approves on GitHub; pushes |
| `scout` | Haiku, low | reads: locates a failure's cause, checks a plan against the tracker | writes code |
| hunters | the hunt skills' own choice (Sonnet) | catch and verify findings | fix them in the same run |
| merge gate | none: a script | merges by the written policy | anything else |

Only `inkstrata` contributes, so GitHub cannot tell a reviewer from a builder by account. The markers carry that
instead, and the gate checks them against the head commit, so a new push voids an old approval. An agent is resumed
with `SendMessage` rather than spawned again, because a fresh agent pays for its whole context once more. Briefs
name the exact branch, the worktree, the rows, the done-check and the report's size.

## The merge permission

The refusal on 2026-11-27 had two causes. Auto mode's classifier blocks, by default, "merging a pull request no human
has approved". It also reads the fleet's instructions, which said merging in `inkstrata/marxy` stays with you. So the
fix is not a stronger instruction to the agent:

- **No agent merges.** `.claude/settings.json` denies `gh pr merge`, and deny rules hold in every permission mode.
- **The gate merges.** It is reviewed code. CODEOWNERS covers the automation's own files, so changes to it wait for
  you, and GitHub's required `ci` check backs it up.
- **The fleet rule names the exception.** `command-center/ai/CLAUDE.shared.md` now names the exception, so an agent
  and the classifier read the same rule you wrote.
- **No permissions widened.** No `autoMode.allow` entry was added. That would widen what agents may do, and the
  gate makes it unnecessary.

GitHub's code-owner review requirement was turned off with your agreement. With every PR authored by `inkstrata`,
it would have blocked every owner-path PR for good. `.github/CODEOWNERS` now only tells the gate what waits for you.

## Install hardening

| Device | How | Why this way |
| --- | --- | --- |
| Osiris (Windows) | after the nightly verify: the repo's own installer (`pnpm work installer`): build, sign, install for this user, launch with its own data folder | the real per-user install, on the machine that has WebView2 and `check:tauri` |
| Eris (macOS) | hourly when on power and not in Low Power mode, if the last good run is over 20 hours old: the macOS installer under `caffeinate -dimsu`; afterwards `pmset -g log` is read, and a run that overlapped Sleep, DarkWake or Maintenance is marked inconclusive and retried | Eris sleeps and travels; a frozen run is not a failure |
| Set (SteamOS) | hourly when on power: the newest `installers` AppImage, run from a temp folder under `systemd-inhibit`, falling back to extract-and-run without FUSE | a read-only root and no compiler, so it tests the artifact a person would download |

Results go to `auto-state` (`devices/<os>.json`). The day job turns real failures into fixes or tracker rows.

## Testing and bug catching

- **CI:** pull requests run `--tier changed`, and `main` runs `--tier full` without the browser suite.
- **Nightly on Osiris:** what CI cannot run. That covers the browser suite (2,536 tests) and `check:tauri`.
  `STATE.md`'s rule is applied by script: a red that passes alone three times is load, and one that fails alone is real.
- **Weekly hunt:** one hunt, using the hunt skills as they are.
- **Hosted Windows browser files:** weekly, until they have the repeat green runs they need.
- **macOS browser suite:** weekly on Eris, under the sleep check.

## Records: how `work/` adapts

- **`work/weeks/<date>.md`** is new: the plan (goals, queue, hunt axis, hardening, what waits for you, the Fable
  box) and, appended a week later, its outcome.
- **`STATE.md`** is rewritten weekly.
- **`ledger.md`** gets one row per week.
- **Hunts** keep their run folders and ledger rows.
- **Night builds get no run folder.** Each PR holds its builder's account and its review, and the night summary is
  on `auto-state`.
- **`todo.md`** stays the tracker.

## Where it lives, and the size guard

It lives inside marxy, not in a new repository:

- **The cycle is already here.** The cycle it automates, the tracker it reads and the skills it uses are already in
  marxy.
- **Every device already has a checkout.** Eris and Set get their runners with `git pull`.
- **Skills serve both.** Skills in `.claude/` serve your own sessions as well as scheduled ones.
- **CODEOWNERS sits beside the gate.** CODEOWNERS can protect the automation's rules in the same repository the gate
  merges into.

September's orchestration also lived in the repository and grew to 10k lines. The guard this time is
`scripts/auto/size.test.mjs`, which fails above 1,200 lines of automation code or 600 lines of skills. The dashboard
work is plain Markdown, and the merge rules are about 100 lines.

## What you do once

- **Models:** in the desktop app, set each scheduled task's model. The app cannot be told from a session.
  - `marxy-night` and `marxy-day`: Sonnet
  - `marxy-plan`: Opus
  - Leave Keep computer awake on.
- **Eris:** `bash scripts/auto/eris/install.sh`.
- **Set:** `bash scripts/auto/set/install.sh` (it clones marxy into `~/Dev`).
- **Stop or pause:** disable the tasks in the app, `powershell -File scripts/auto/osiris.ps1 -Remove`, or label a
  PR `hold`.

## Risks

- **Usage visibility:** whether a scheduled task can call `get_usage` is undocumented. If it can't, the jobs run blind
  with small caps, and the dashboard says so.
- **Desktop tasks need the app open and Osiris awake.** A missed night is caught up once, and the window rule stops a
  catch-up that lands in your window.
- **First runs of the device scripts and the installers workflow are unproven.** They were written on Osiris without
  Eris or Set at hand, and the dashboard will show their first results.

## Changes

Changed 2026-11-27: the gate merges at any hour, not only 00:00 to 14:00. The owner's concern is not the hour but the
automation draining CPU or memory while they game or work, or using up their Claude allowance. So the gate, the
nightly run and the device runs now check whether the owner is using the machine (recent input, a full-screen app, a
game running) and stand down if so; Osiris's nightly task waits for ten idle minutes and runs at below-normal priority;
and the night skill starts no new agents while the owner has a Claude session working. See "When you are using the
machine" in `scripts/auto/README.md`.

Changed 2026-11-27: Friday 14:00 to 20:00 is a final sweep. The weekly limits reset at 20:00 and what is left is
lost, so the owner asked for the end of the week to use it, up to 90% of the 5-hour limit (that cap is what keeps
them from being locked out). In that window the governor drops the owner window and the 14:00 block rule, keeps a
flat 2% weekly reserve, stops at 19:55 and refuses without a usage reading. A busy owner no longer stops it: the
gate answers `lightOnly`, so only light work (reading and writing, quick-tier verify, CI for the rest) runs while
they are at the machine. A `friday` job at 14:05 runs the night skill in final mode.
