# Prompt: design Marxy's standing automation schedule

Run this on **Opus 5.5 at max effort**, in a Claude Code session on Osiris (`D:\Dev`) or Eris (`~/Dev`).

---

## The prompt

Design and then build the standing automation that keeps **Marxy** (`inkstrata/marxy`, a Tauri
markdown reader) advancing every day without me driving it. You make the design decisions. What follows
is what I want, the constraints that are mine, and facts you'd otherwise have to rediscover.

### What I want

A daily and weekly schedule of automated jobs covering:
- orchestration
- bug catching
- planning
- PR merging
- testing
- hardening installation on macOS, Windows and Linux

The project's tracker and records (`work/` in the repo) should adapt to whatever form the schedule takes.
The jobs that run overnight on Osiris should be created and registered.

### My constraints

- **Keep my usage for my own work.** My plan's usage is shared with everything else I do. Automation
  should use what would otherwise go to waste and leave me what I need.
- **My window is 14:00 to midnight (Pacific).** Keep it free. Daytime compute outside it is fine to use.
- **Night is for big jobs.** Use the night hours for big jobs and agent runs where possible.
- **Lean on Sonnet and Haiku.** Use them heavily wherever they're enough.
- **Install hardening runs on my devices:** Eris for macOS, Osiris for Windows, Set for Linux.
- **Automation auto-merges** a PR once an agent other than its author has reviewed and approved it, CI is
  green, and it touches no CODEOWNERS path. Anything else waits for me. This overrides the fleet rule that
  merging in `inkstrata/*` stays with me, for Marxy's automation only.
- **Show me the design before you build it.**

### Facts worth knowing

- **Usage limits.** I'm on the Max plan. There's a rolling 5-hour limit, a weekly all-models limit, and a
  weekly Fable limit. The weekly limits reset Friday 20:00 Pacific. The desktop app's `get_usage` tool
  reports all of them. I don't know whether a scheduled task can call it.
- **Scheduled jobs on Osiris.** They exist today as Claude desktop app scheduled tasks
  (`research-queue-night`, `repo-sync-night`). These run only while the app is open and the machine is
  awake. There are also plain Task Scheduler jobs (`machines/osiris/tasks.ps1`). `tools/research/night.mjs`
  is a working claim → work → publish → report pipeline.
- **The merge permission problem.** On 2026-11-27, Claude Code's auto-mode classifier refused an agent's
  auto-merge even though `AGENTS.md` allows it. Find a legitimate way to grant the permission; don't route
  around the classifier.
- **Eris sleeps.** Even with a keep-awake hold, it enters Maintenance Sleep/DarkWake, and on low battery
  Low Power Sleep. Processes freeze, so test durations come out longer than wall time (`pmset -g log`
  shows it). It also travels.
- **Set** is a handheld running SteamOS: read-only root, user-space installs only, often off.
- **Ceremony has outgrown the product before.** In September 2026 the project's orchestration code reached
  ~10k lines against ~12k lines of product, and it was torn out. The current lean process (#773) replaced it.

### Where to look

Marxy:
- `AGENTS.md`, `docs/working.md`, `docs/principles.md`, `docs/testing.md`
- `work/README.md`, `work/todo.md`, `work/STATE.md`, `work/ledger.md`, `work/runs/`, `work/reports/`
- `.claude/skills/`
- `.github/workflows/`, `scripts/`

command-center:
- `ai/CLAUDE.shared.md`
- `machines/` (each device's `CLAUDE.md`; `README.md`, "The night run"; Osiris's job prompts and `tasks.ps1`)
- `docs/runbooks/orchestration.md`
- `tools/research/`
- `maps/registry.json`
