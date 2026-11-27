---
name: bug-catch
description: Use when the owner asks for a bug hunt, a bug-catch fleet or cycle, "find bugs in X", or reports a bug to fold into a hunt in Marxy. Starts a hunt run, sends parallel Sonnet catchers across separate domains of the app, each appending findings to one shared file, then hands the file to bug-verify and bug-triage.
---

# Bug catch: the first step of the bug cycle

The cycle has three steps, each its own skill, and one file the steps add to:

1. **Catch** (this skill): Sonnet catchers, one per domain, run in parallel and append candidate findings
   to `findings.md`.
2. **Verify** (`bug-verify`): Sonnet verifiers who did not catch them try to reproduce each finding and
   append a verdict to `verification.md`.
3. **Triage** (`bug-triage`): the orchestrating session turns confirmed findings into ready rows in
   `work/todo.md`, and the hunt lands as one pull request.

The file format, the severities and the append helper are in [format.md](format.md). Read it first.

## 1. Start the hunt

```bash
git fetch
pnpm work start hunt-<nn> --from origin/main     # <nn>: the next hunt number in work/runs, two digits
```

In the worktree make `work/runs/<date>-hunt-<nn>/` with `README.md` (goal, domains, the owner's reports),
`findings.md` (a heading and one line: "Append-only. Write through .claude/skills/bug-catch/finding.mjs."),
`verification.md` (the same), `briefs/` and `probes/`. Commit it, so every catcher starts from one tree.

**Owner reports come first, and keep coming.** A report the owner sends after the fleet has started is
appended the same way and sent to the running catcher of its domain with `SendMessage`, with where it falls
in that catcher's order; a freeze or data loss goes ahead of what the catcher was doing.

**Owner reports, in order.** A bug the owner named ("the Export tab freezes the app") is written as a
finding by the orchestrator before the fleet starts, `Confidence: low` until a probe shows it, `Found by:
owner`. Give it to the catcher of its domain as lead number one.

## 2. Pick the domains

Four to six per hunt, from the table, chosen for what changed lately (`git log --since`), what the owner
reported, and what earlier hunts did not cover (their `README.md`). Each domain has a prefix that only its
catcher writes, which is what keeps the ids from colliding.

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

## 3. Send the catchers

One Sonnet agent per domain, `model: "sonnet"`, effort medium, in the background, all in one message. Six
at most at once; the machine's ceiling is the browser probes, not the agents. Write each brief from
[catcher-brief.md](catcher-brief.md) into `briefs/<PREFIX>.md` and send its text as the prompt.

While they run, do not edit the hunt's worktree yourself: the catchers serve its source live.

## 4. When the catchers are done

1. `node .claude/skills/bug-catch/finding.mjs list <findings.md>`: every catcher appended, the helper
   accepted every block (a catcher that reports findings it never appended is asked to append them, via
   `SendMessage`, not re-spawned).
2. Remove any `*.lock` left in the run folder only if no agent is still writing.
3. Commit `findings.md`, `briefs/` and `probes/` on the hunt branch and push it, so the hunt survives the
   laptop sleeping.
4. Add the catch counts to the hunt's `README.md` (findings per domain and severity, catchers that ran
   out of budget, areas not reached).
5. Go on to `bug-verify`.

## Rules for the whole cycle

- Catchers and verifiers never edit `apps/`, `packages/`, `scripts/` or `docs/` in a way that stays: a
  probe test placed in the tree to run is moved into `probes/` and deleted from the tree straight after.
  Nobody fixes anything in a hunt; fixes are the tracker rows that triage writes.
- Findings already in `work/todo.md` are not new findings. New evidence for a row is appended as a
  finding that says "Adds to todo row <id>".
- Every committed log replaces `/Users/<name>` with `/Users/<user>` (the repository is public). Scrub a
  domain's `probes/` once its agents are done, and `findings.md` or `verification.md` only when no agent is
  writing to it: an in-place rewrite (`sed -i`) during an append can drop the appended block.
- The orchestrator never appends findings of its own beyond the owner's reports, and never verifies a
  finding it wrote down.
