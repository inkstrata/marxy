---
name: bug-catch
description: Use when the owner asks for a bug hunt, a bug-catch fleet or cycle, "find bugs in X", or reports a bug to fold into a hunt in Marxy. Starts a hunt run, plans its axes (areas, past-bug causes, rules, input shapes), sends one Sonnet catcher per axis in parallel, each appending findings to one shared file, hands the file to bug-verify and bug-triage, and runs further rounds while new axes keep finding bugs no other axis found.
---

# Bug catch: the first step of the bug cycle

The cycle has three steps, each its own skill, and one file the steps add to:

1. **Catch** (this skill): an axis plan, then Sonnet catchers, one per axis, run in parallel and append
   candidate findings to `findings.md`.
2. **Verify** (`bug-verify`): Sonnet verifiers who did not catch them try to reproduce each finding and
   append a verdict to `verification.md`.
3. **Triage** (`bug-triage`): the orchestrating session turns confirmed findings into ready rows in
   `work/todo.md`, and the hunt lands as one pull request.

A hunt runs in rounds: plan, catch, verify, read the yield, and plan again from it, until a round stops
finding bugs that only one axis found (section 5). Triage runs once, after the last round.

The file format, the severities and the append helper are in [format.md](format.md). Read it first.

## 1. Start the hunt

```bash
git fetch
pnpm work start hunt-<nn> --from origin/main     # <nn>: the next hunt number in work/runs, two digits
```

In the worktree make `work/runs/<date>-hunt-<nn>/` with `README.md` (goal, the owner's reports),
`findings.md` (a heading and one line: "Append-only. Write through .claude/skills/bug-catch/finding.mjs."),
`verification.md` (the same), `briefs/` and `probes/`. Commit it, so every catcher starts from one tree.

**Owner reports come first, and keep coming.** A report the owner sends after the fleet has started is
appended the same way and sent to the running catcher of its axis with `SendMessage`, with where it falls
in that catcher's order; a freeze or data loss goes ahead of what the catcher was doing.

**Owner reports, in order.** A bug the owner named ("the Export tab freezes the app") is written as a
finding by the orchestrator before the fleet starts, `Confidence: low` until a probe shows it, `Found by:
owner`, under the prefix `OWN` (`OWN-01`, `OWN-02`...), so it needs no axis to exist yet; the yield leaves
owner reports out. Once the axes are chosen (section 2), give each to the catcher of the axis it belongs to
as lead number one; a report no axis covers becomes an axis of its own.

## 2. Plan the axes

An axis is what one catcher looks for and where; the format is under "Axes" in [format.md](format.md).
The hunts so far say why this step exists: the best yield came from an axis that cut across domains (hunt 01's
note "long unbroken input is the richest seam" became hunt 03: 38 findings, 33 confirmed), and that hunt's
catchers each had a lens for big files, not the generic list. Until now the next hunt's axes came from a few
hand-written lines in the last README, and no one could tell which lens found what.

1. Send the planner: one Opus agent at medium effort, which reads the tree and writes only `axes.md`, from [planner-brief.md](planner-brief.md). It reads the
   earlier hunts' findings, verdicts and yield, the rules in `AGENTS.md` and `docs/`, and what changed since
   the last hunt, and writes up to twelve ranked axes to `axes.md`. For a narrow hunt (one owner report, one
   area) skip it and write two to four axes yourself.
2. Decide. The plan is a proposal: cut overlaps, put the owner's reports first, and keep the axes for this
   round to what can run at once: six, since the round starts after the last round's verifiers are done. The rest wait in `axes.md` for
   the next round, `Round:` left empty. Choosing the axes is judgement, so it stays with the orchestrator.
3. Give each axis a prefix no axis in this hunt has used. A domain axis may reuse the table's prefix; any
   other takes a new one (`LNG`, `PAR`, `MOV`: two to four capital letters, no digits). Only that axis's catcher writes it,
   which keeps ids from colliding and lets the yield table credit each finding to its axis.

The domain table is one source of axes and the map of where things live:

| Prefix | Domain | Start in |
| --- | --- | --- |
| EXP | export, print, copy out, the tray | `src/left/panels/export.ts`, `src/export/`, `src/tray/`, `src/commands/copy-*.ts`, `src/render/export-file.ts` |
| EDT | editing and saving: Source, splices, paste, undo, save, close guard | `src/source/`, `src/paste/`, `src/save.ts`, `src/close.ts`, `packages/core/src/buffer/` |
| VWR | viewers and file kinds: archives, PDF, images, media, office, fonts, SQLite, mail | `src/viewers/`, `src/kinds/`, `packages/core/src/kind/` |
| NAV | navigation and panes: tabs, split, place keeping, the left panels, find | `src/pane/`, `src/left/`, `src/find/`, `src/position/`, `src/layout/` |
| RDR | reading and rendering: Markdown, typesetting, tables, notes, depths, folds | `src/render/`, `src/view/`, `packages/typeset/`, `packages/core/src/parse/`, `packages/core/src/render/` |
| LOK | look, Studio, settings, themes, config.toml | `src/studio/`, `src/settings/`, `src/look/`, `packages/theme/` |
| SHL | the Rust shell: file access, watching, atomic write, quit and window life, remote images | `src-tauri/src/`, `src/shell/` |
| CMD | commands, keys, the Line, menus, the palette | `src/commands/`, `src/line/`, `src/menu/`, `src/palette/` |

Paths under `src/` are `apps/desktop/src/`. Add a row here when a hunt finds an area the table lacks.

**Proposed axes.** Before inventing axes, read those proposed in the last 14 days: the `## Axes proposed` of run
summaries in `~/.local/state/fleet/marxy/auto-state/nights/` (`git -C ~/.local/state/fleet/marxy/auto-state pull`
first) and of hunts' READMEs. Rank them with the ledger rule below and take the best first; the triggered small
hunt takes the top proposal first. A proposal taken or dropped is accounted for in the hunt's `triage.md`.

**Coverage ledger.** `work/hunt-coverage.md` says where hunts have looked, with what lens, at which commit and
with what yield. The same lens on an area that last confirmed nothing is not run again there until
`git log <commit>..origin/main -- <paths>` shows the area changed; after four weeks without a change, only a
different lens may run there. Rank candidate axes by whether the area changed since its last sweep, then by the lens's past
confirmed yield, then by severity. The Tuesday hunt and the triggered small hunt both follow this.

**Target.** A hunt may be aimed at a pull request number, a branch, a tracker row id or a set of paths. The scope
is the changed files (`git diff --name-only` against `origin/main`) plus their direct callers (grep for
importers); axes are planned only inside it. Lenses: hostile input past the budgets, boundaries and encodings,
and listener and lifecycle cleanup. Shape: two Sonnet catchers, one round, no Opus planner, verification on the
other model. Findings on an open pull request become a CHANGES review on it (`review` skill), not tracker rows;
on merged code they become rows, or the next run's carry-over.

**Standard axis: changes since the last hunt.** Every Tuesday hunt includes it: `git log --stat` of `origin/main`
since the newest hunt's date, one catcher, a domain axis over whatever changed most.

**Small shape (a triggered hunt).** The night skill's `small-hunt` step uses it when the work runs thin: two to
four axes, taken from the newest hunt's `axes.md` entries left unrun (`Round:` empty) or, failing those, the
standard axis above. Sonnet catchers only, one round, no Opus planner, verification on the other model as
usual, then triage. It does not run a second round unless section 5 allows one.

## 3. Send the catchers

One agent per axis, with the axis's model (`sonnet` unless `axes.md` says `haiku`), effort medium, in the
background, all in one message. Six at most at once, counting any verifiers still running (a domain's batch may be verified while other
catchers run, `bug-verify` section 1); the machine's ceiling is the
browser probes, not the agents. Write each brief from [catcher-brief.md](catcher-brief.md) into
`briefs/<PREFIX>.md`, the axis's lens in it, and send its text as the prompt.

Cheap catchers do not make a cheap hunt: every finding costs a Sonnet verifier's probe, and the machine runs
few of those at once. A `haiku` axis whose precision in the yield table falls under one half does not get a
second round.

While they run, do not edit the hunt's worktree yourself: the catchers serve its source live.

## 4. When the catchers are done

1. `node .claude/skills/bug-catch/finding.mjs list <findings.md>`: every catcher appended, the helper
   accepted every block (a catcher that reports findings it never appended is asked to append them, via
   `SendMessage`, not re-spawned).
2. Remove any `*.lock` left in the run folder only if no agent is still writing.
3. Commit `findings.md`, `briefs/` and `probes/` on the hunt branch and push it, so the hunt survives the
   laptop sleeping.
4. Add the catch counts to the hunt's `README.md` (findings per axis and severity, catchers that ran
   out of budget, areas not reached).
5. Go on to `bug-verify`, then come back to section 5.

## 5. Rounds, and when to stop

When every finding of the round has a verdict, read the yield:

```bash
node .claude/skills/bug-catch/finding.mjs yield <run>/findings.md <run>/verification.md
```

Copy the table into the README under the round. Then:

- **Another round**, at most three in all: round 2 only if round 1 confirmed two or more findings and the budget
  gate allows it (not `noNewAgents`, allowance left); round 3 only if round 2 did the same. Send the planner again with the table (its **Last round** paragraph):
  extend the axes that found bugs alone, drop those that found none, and run the axes still waiting.
- **Stop** when they found fewer than two, or when a round's findings were only duplicates. Saying "a round
  found nothing" about a cheap model says more about the model than the code, so the README names the areas
  covered and found clean by two or more axes ("Converged"). Each goes one of three ways, written down: one
  Opus catcher on the riskiest (the reader core, the big-file guards, anything holding an S1 before), the
  real window or WebKit (`scripts/browser-tests.mjs`) for what headless Chromium cannot show, or closed.
- **A third round that still finds bugs** is reported to the owner as a structural problem, in the hunt's README
  and triage, and is not answered with a fourth.

Then go on to `bug-triage`.

## Rules for the whole cycle

- Catchers and verifiers never edit `apps/`, `packages/`, `scripts/` or `docs/` in a way that stays: a
  probe test placed in the tree to run is moved into `probes/` and deleted from the tree straight after.
  Nobody fixes anything in a hunt; fixes are the tracker rows that triage writes.
- Findings already in `work/todo.md` are not new findings. New evidence for a row is appended as a
  finding that says "Adds to todo row <id>".
- Every committed log replaces `/Users/<name>` with `/Users/<user>` (the repository is public). Scrub an
  axis's `probes/` once its agents are done, and `findings.md` or `verification.md` only when no agent is
  writing to it: an in-place rewrite (`sed -i`) during an append can drop the appended block.
- The orchestrator never appends findings of its own beyond the owner's reports, and never verifies a
  finding it wrote down.
