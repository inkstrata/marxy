# ADR-0042 — One plan file per story instead of a shared CSV and deps map

- **Status:** accepted by the repo owner on 2026-09-29 (MARXY-327), with epics in one `epics.json`
- **Date:** 2026-09-28
- **Amends:** nothing accepted. Carries out `orchestration/prompts/hardening.md` item 11 and
  follows the changelog fragments of MARXY-315.

## Context

MARXY-315 split `CHANGELOG.md` into one fragment per story so open pull requests stopped
conflicting on it. Two shared files remain that every story filing and every planner pass edits,
always by appending at the end:

| File | Commits touching it | Open PRs editing it (of 19) |
| --- | --- | --- |
| `docs/plan/jira-issues.csv` (272 lines, one row per story and epic) | 91 (all in the last 14 days, of 248 commits) | 8 |
| `orchestration/deps.json` (`phases`: key lists; `deps`: key to keys; a note; `research`) | 76 | 5 |
| `docs/plan/tasks/KEY.md` (149 cards, front matter `key`, `design`, `depends`, `verify`) | 47 across all cards | 3, each its own card |

Two PRs that each append a row at the end of the CSV, or a key at the end of a `phases` list and
of `deps`, always conflict, though they share no meaning. Jira is the board of record; the CSV
mirrors it and `deps.json` exists only here. Cards already prove the shape: one file per story,
no conflicts.

Everyone who reads or writes these files today:

- **`orchestration/lib.mjs`** reads the CSV (`stories()`, `parseCsv`) and `deps()`, `phaseOf`.
- **`orchestration/plan.mjs`** reads both from `origin/main` git objects (`CSV_PATH`, `DEPS_PATH`),
  so the fleet sees the plan without a checkout.
- **`orchestration/jira.mjs`** reads the CSV (`bootstrap`, `csvRows`), reads `phases` for
  `release`, and renames `docs/plan/tasks/*.md` and rewrites keys in migrate. It also writes
  `jira-map.json`, which stays as it is.
- **`orchestration/out-of-plan.mjs`** writes the story's CSV row and `deps.json` entry into its
  branch (`start`, `row`) with its own quote-aware line scan.
- **`orchestration/worktrees.mjs`** reads a row from main, else from the worktree's CSV.
- **`orchestration/ready.mjs`, `doctor.mjs`, `readiness.mjs`** consume the plan `planAt()`
  returns (rows, `deps.d`, phases), so they change only if that shape does; it will not.
- **`orchestration/cycle.mjs`, `review.mjs`** and **`scripts/lib/own-row.mjs`** (`BOARD_FILES`,
  `branchBoundary`) judge whether a branch touched only its own row and `deps.json` entry.
- **`scripts/check-story.mjs`, `scripts/done.mjs`, `scripts/lib/repo.mjs`** (`story()`) read the
  row for paths, acceptance and the no-row failure.
- **`scripts/check-cards.mjs`** (MARXY-126) reconciles CSV, cards and `deps.json`.
- **`scripts/ci-changes.mjs`** classifies both board files as not docs (MARXY-191).
- **`orchestration/canvases.mjs`**, **`README.md`** and the **planner** and **implementor**
  prompts read or name them.

## Decision

**1. A story's row and dependencies live in one file, `docs/plan/stories/KEY.json`.** It holds
every CSV column (`type`, `summary`, `epic`, `parent`, `labels`, `paths`, `description`,
`acceptance`) plus what `deps.json` held per story: `phase` and `depends`. Epics live together in one
`docs/plan/epics.json`: there are few of them, they change rarely, and no story PR edits one.
JSON, not front matter in the card: acceptance criteria are long multi-line text where YAML
quoting is a trap, only 149 of the 270 keys have a card, and a card is prose an author rewrites
while a row is data a tool rewrites. A card's `depends` stays and `check-cards` keeps requiring
it to equal the story file's.

**2. `jira-issues.csv` and `deps.json` stop being committed.** Nothing generated is checked in,
so nothing can drift or conflict. One shared reader, `scripts/lib/plan.mjs`, returns the same
rows, deps and phase lists the old files did, from disk or, for `plan.mjs`, from `origin/main`
via one `git ls-tree` and `git cat-file --batch`. `node scripts/plan-export.mjs --csv` prints
the CSV for people and for `jira.mjs bootstrap`. The former `_note` text moves to
`docs/plan/stories/README.md`; the empty `research` map is dropped, since research is an
ordinary labelled row. Order within a phase is by numeric key, replacing append order; nothing
depends on the order inside `phases` (see Resolved questions).

**3. Jira sync is unchanged in behaviour.** `jira.mjs` reads rows through the shared reader.
`bootstrap`, `release` and the key-rename migration change only where they read and write.
`jira-map.json` is a Jira artefact and stays.

**4. The board boundary shrinks to the story's own file.** `BOARD_FILES` becomes the prefix
`docs/plan/stories/`; a branch may touch only `stories/<its key>.json`, so a planner pass that
edits many stories lists the directory in its Paths, exactly as today.

**Migration, each step green on its own:**

1. **Reader accepts both.** Add `scripts/lib/plan.mjs` (stories directory first, CSV and
   `deps.json` as the fallback, and a check that they agree while both exist). Switch
   `orchestration/lib.mjs`, `orchestration/plan.mjs`, `orchestration/jira.mjs`,
   `orchestration/worktrees.mjs`, `scripts/lib/repo.mjs` and `scripts/check-story.mjs` to it.
   Add `scripts/plan-export.mjs`. No file moves; nothing is written in the new form.
2. **Convert once.** A script writes `docs/plan/stories/*.json` and `docs/plan/epics.json` from
   the CSV and `deps.json` in one PR that touches only those and the two old files, which stay. `check-cards.mjs` gains
   the CSV-equals-stories check.
3. **Writers switch.** `orchestration/out-of-plan.mjs`, `scripts/lib/own-row.mjs`,
   `orchestration/cycle.mjs`, `orchestration/review.mjs`, `scripts/done.mjs`,
   `scripts/check-cards.mjs`, `scripts/ci-changes.mjs` (classify `stories/` as the board) and
   the planner and implementor prompts write and judge the story file only. The old two files
   are now frozen: CI fails a PR that edits them.
4. **Remove.** Delete `docs/plan/jira-issues.csv` and `orchestration/deps.json`, the fallback,
   the frozen-file check, and the stale mentions in `orchestration/README.md`,
   `orchestration/canvases.mjs` and `docs/hygiene.md`. This is the only step that needs the
   in-flight PRs to have landed or rebased, so it waits for a quiet moment.

## Consequences

- Two stories filed at once touch different files and cannot conflict. Of the 19 open PRs today,
  the 8 that edit the CSV and the 5 that edit `deps.json` would touch disjoint files.
- A whole-board view is now a computation, not a file. `plan-export.mjs` and `fleet.mjs status`
  cover it; grepping the CSV by hand does not.
- Editing a story elsewhere (a widened `Paths`, an acceptance fix) is a one-file diff, so
  reviews of it get smaller and sharper.
- About 270 small files under `docs/plan/stories/`; the same count the cards already added.
- Step 3 changes the merge bar's own-row logic, a CODEOWNERS path, so it needs the owner.

## Rejected

- **A merge driver or union merge for the CSV (`.gitattributes merge=union`).** It does resolve
  two appended rows, but it needs per-clone config that the fleet's worktrees and GitHub's own
  merge do not share, so conflicts still appear in the PR UI. It also silently interleaves a
  quoted multi-line field and duplicates a row when both sides fixed the same one.
- **Keep the CSV but sort rows by key.** Removes the end-of-file hotspot, not the conflict:
  neighbouring keys still share hunks, and every re-sort is a whole-file diff that collides with
  every other open edit. It also moves the rebase problem onto the planner.
- **Front matter in the existing card.** Attractive because cards exist, but only 149 of about
  270 stories have one, criteria are awkward in YAML, and a card edited by a human for prose
  would then also be rewritten by tools.
- **Keep both files as committed, generated copies.** Any committed generated file is a shared
  file again, and the last writer wins every conflict.
- **Make Jira the only source and drop the plan files.** Breaks offline reads, `plan.mjs`'s read
  from git objects and the rule that a story's row travels in its own reviewed PR.

## How we would know this was wrong

1. A conflict still appears in `docs/plan/stories/` on a routine story PR, or step 2's
   agreement check keeps failing. Then two writers still own one story and the boundary rule is
   wrong, not the layout.
2. `plan.mjs` on 300 files is measurably slower than one file, or the fleet's cycle time rises
   after step 3. Then the reader needs one cached index, which would itself be a shared file.
3. People ask for the CSV back, or a tool starts committing `plan-export.mjs` output. Then the
   whole-board view was the real product and the generated copy should be a release artefact.

## Resolved questions

- **Order inside `phases`.** Nothing depends on it: `ready.mjs` and `plan.mjs` only ask which
  phase a key is in, and dispatch order comes from row order, which is already close to key
  order. Numeric key order needs no `order` field.
- **Epics.** One `docs/plan/epics.json` (the repo owner, 2026-09-29).
- **`MARXY-NEW-<slug>` placeholders.** They never reach `main` (`docs/sdlc.md`, "Placeholders
  never reach main"): `jira.mjs sync --new` renames them before the planner's PR opens, and
  `check-cards` fails one left on a branch. On a branch they sort after every numeric key.
- **Step 3 touches CODEOWNERS paths.** Accepting this ADR approves the direction; each step's PR
  still gets the owner's review where CODEOWNERS says so.
