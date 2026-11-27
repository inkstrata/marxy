# work/: tracking and orchestration records

How Marxy's work is planned, carried out and recorded. Everything here is committed, so every machine and
every session reads the same tracker and history through git. The software and its documentation live
outside this folder. Nothing in `apps/`, `packages/`, `scripts/` or `docs/` refers to anything in here.

## Layout

| Path | What it holds | Who changes it |
| --- | --- | --- |
| `todo.md` | the tracker: open work in sections (Next, To try in a real window, Waiting on the owner, Later, Housekeeping) | every branch that takes, finishes or adds a row |
| `STATE.md` | where `main` stands now: what the app does, platforms, latest verify, performance, open work, risks | rewritten by the branch that lands a run |
| `ledger.md` | one row per landing, oldest first: date, run, pull request or commit, what changed for the reader, verify | appended by the branch that lands a run |
| `runs/<date>-<kind>-<nn>/` | one orchestration run (a `wave` or a `round`): the branches cut together, built, reviewed and landed as one; or a `hunt`: a bug-catch cycle whose output is tracker rows | the run's orchestrator |
| `reports/<date>-<slug>/` or `reports/<date>-<slug>.md` | evaluations, plans, handoffs, spikes and reviews that are not one run | whoever wrote it |
| `questions/<date>-<slug>/` | a set of questions for the owner (`pnpm work ask`) and the answers | `pnpm work ask` and the owner |

### Inside a run folder

| Path | What it holds |
| --- | --- |
| `README.md` | the run's account (its "cut"): goal, branches, what landed and what did not, verify result with counts, follow-ups |
| `builder-rules.md`, `reviewer-rules.md` | the rules the run's builders and reviewers worked to, when the run had them |
| `branches/<branch>/` | per branch: `brief.md`, `report.md` (the builder's account), `review*.md`, and the probes or measurements behind them |
| `logs/` | verify and measurement logs, as text; a step-per-file verify run keeps its `verify-full-logs*/` folder |
| `records/` | measurement output (`interactions-*.json`, startup and perf records) and saved patches |
| `tools/` | small scripts the run used to drive itself (a verify queue, a measurement patch) |

### Inside a hunt folder

A hunt is the bug cycle: catchers append candidate findings, verifiers who did not catch them append a
verdict for each, and the orchestrator triages the verified ones into `todo.md` rows. The steps are the
`bug-catch`, `bug-verify` and `bug-triage` skills in `.claude/skills/`; the block format is
`.claude/skills/bug-catch/format.md`.

| Path | What it holds |
| --- | --- |
| `README.md` | the hunt's account: domains, the owner's reports, counts of findings, verdicts and rows, what was not reached |
| `findings.md` | append-only: one block per candidate finding, written only through `.claude/skills/bug-catch/finding.mjs` |
| `verification.md` | append-only: one verdict block per finding, through the same helper |
| `triage.md` | every finding's outcome: the row it became, the row it merged into, or why it was dropped |
| `briefs/`, `probes/<PREFIX>/` | the brief each agent was given; the scenarios, probe tests and output behind each finding and verdict |

## Rules

- **Names.** Folders start with the ISO date the run landed or the report was written: `2026-11-26-wave-04`,
  `2026-11-23-round-09`, `2026-11-24-evaluation`. Run numbers have two digits so the folders sort.
- **Ids.** Tracker ids (`S17`, `P11`, `E22`, `F24`, `W5`, `H4`) and run names belong in `work/` only. They
  never go in code, comments, test names, commit subjects or `docs/`. Pull requests may name them in the body.
- **Text, not builds.** Commit Markdown, logs, JSON, small scripts and the odd picture a report needs. Never
  commit build output (`dist*/`, bundles, fonts, installers), `node_modules`, `.bak` files, lock folders or
  anything over about 400 KB. Pictures from `shots` land in `work/shots/`, which git ignores; copy the few a
  report needs into its folder.
- **No secrets or personal paths.** Logs carry temp paths: replace the account name in `C:\Users\<name>` or
  `/Users/<name>` with `<user>` before committing. The repository is public.
- **History is kept.** A finished run's folder is not rewritten. A finding that turns out wrong gets a note in
  the run's `README.md` or a later run, not a deletion.
- **The tracker leaves with the work.** A row leaves `todo.md` in the same pull request that lands its
  branch; `pnpm work todo --check` names rows whose branch has landed.

## Before 2026-11-26

Runs from round 9 to wave 5 were carried out on a Windows machine whose checkout had no remote and whose
default branch was `master`. The commit ids in those records (`663a7f7f` and the like) belong to that
checkout and are not in this repository's history. The code arrived here as one import at the state of
`master` `663a7f7f` (wave 4); see `ledger.md`. The raw workspace those records came from, including
the build copies and HTML renders left out here, is attached to the
[`archive/pre-reader-2026-11-26`](https://github.com/inkstrata/marxy/releases/tag/archive/pre-reader-2026-11-26)
release, together with the earlier architecture's code and process documents (at that tag).
