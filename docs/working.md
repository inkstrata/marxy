# Working on Marxy

How work is tracked and carried out: where things are, the tracker, the cycle a change goes through on
its way to `main` on GitHub, and the tool for each step. Setup, running and building are in
[development.md](development.md); the checks are in [testing.md](testing.md).

## Where things are

The repository is `inkstrata/marxy` on GitHub; `main` is the default branch and moves only through pull
requests. Tracking and run records are committed with the code, in `work/`, so every machine and session
reads the same tracker through git. Worktrees and kept installers stay outside git:

| Path | What it is |
| --- | --- |
| `<checkout>/` | the main checkout, kept clean, on `main` and current (`git pull --ff-only`) |
| `<checkout>-wt/<name>/` | one git worktree per branch being worked on, branch `agent/<name>`; `MARXY_WORKTREES` names another folder |
| `<checkout>-wt/exe/` | the Windows installer tool's own worktree, on no branch |
| `<checkout>/builds/<date>-<time>-<commit>/` | installers kept by `pnpm work installer`, each with a `BUILD.txt` (git ignores `builds/`) |
| `work/todo.md` | the tracker, committed |
| `work/STATE.md`, `work/ledger.md` | where `main` stands, and one row per landing or week |
| `work/weeks/<date>.md` | one week's plan (its queue) and, once it ends, its outcome |
| `work/runs/<date>-<kind>-<nn>/` | one orchestration run: its account, rules, per-branch briefs, reports and reviews, logs and measurements |
| `work/reports/`, `work/questions/` | evaluations, plans and handoffs; question sets for the owner (`pnpm work ask`) |
| `work/shots/` | pictures taken by the `shots` tool (git ignores it; copy the ones a report needs into its folder) |

The layout, names and rules of `work/` are in [work/README.md](../work/README.md). In short: text, not
builds; no tracker ids outside `work/`; no secrets or account names in committed logs; a finished run's
folder is not rewritten.

`pnpm work init` makes the worktrees and builds folders, and `work/todo.md` if the tree has none.
`scripts/lib/workspace.mjs` finds the main checkout from `git worktree list`, so every worktree agrees on it;
the tracker read is the one in the tree you ask from, so a branch reads and edits its own copy.

## The tracker

`work/todo.md` is Markdown tables under `##` headings, one row per piece of open work:

```markdown
## Next

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| A1 | A `.txt` log is set as paragraphs | `$...$` in a log line is taken as maths | S | `as-written` |
| A2 | `.zst` and `.tar.zst` open as archives | | M | |
```

- A row is any table row whose first cell is an id: one to three capital letters and a number. The id
  is for the tracker only and never goes into code, comments, test names, docs or commit subjects.
- `What` says what is wrong or missing as a reader of the app would meet it. Everything between the id
  and the last column is the writer's own (`Why`, `Size`, where in the code).
- `Branch` holds, in backticks, the name of the branch that has taken the row, without `agent/`. An
  empty cell is work nobody has started. A column headed `Round` is read the same way.
- A row leaves the file in the pull request that lands its branch, or when the work is dropped. There
  are no rows for finished work: git, `work/ledger.md` and the run folders have those.
- The headings sort the rows: what is next, what waits for a person to try in a real window, what is
  for later.

`pnpm work todo` prints the rows with each named branch's state. `pnpm work todo --check` exits
non-zero on an id used twice and on a row whose every branch has already landed, naming the row to
remove. A branch has landed when its commits are all in `main`, or when its upstream is gone: GitHub
deletes a merged pull request's branch, so after `git fetch --prune` a squash-merged branch counts too. `--file <path>` reads a tracker somewhere else.

## The cycle

| Step | What happens | Tool |
| --- | --- | --- |
| Pick | take rows from the tracker and group them into pieces: one branch each, small enough to read as one change | `pnpm work`, `pnpm work todo` |
| Start | a branch and a worktree for the piece, cut from a fresh `main`; the name goes in the rows' `Branch` cells | `git fetch`, `pnpm work start <name> --from origin/main` |
| Build | the change, its tests and its documentation, committed on the branch | the dev loop in [development.md](development.md) |
| Verify | the checks that cover what changed, then a look at it | `pnpm verify --tier changed`, `shots` |
| Open | push the branch and open a pull request: what changed for the reader, tests run with counts, what was not done or checked | `git push -u origin agent/<name>`, `gh pr create` |
| Review | someone who did not write it reads the pull request's diff; CI runs `pnpm verify` on macOS | the pull request |
| Integrate | pieces built side by side are merged on one branch and checked whole | `pnpm verify --tier full` |
| Try | what only the real window or a person shows | `check:tauri`, `pnpm work installer` |
| Land | the merge gate merges the pull request once an independent review approved it and CI is green, or the owner merges it in a session they drive (the owner approves CODEOWNERS paths); its rows leave the tracker in the same pull request, and a run's landing adds a row to `work/ledger.md` and rewrites `work/STATE.md` | GitHub, `pnpm work todo --check` |
| Clear | worktrees and branches that have landed are removed | `git fetch --prune`, `pnpm work clean --apply` |

### Start

```bash
pnpm work start as-written --from origin/main   # branch agent/as-written, worktree <checkout>-wt/as-written, pnpm install --offline
pnpm work start seams --from agent/round-12     # cut from another branch
```

Run every later command from inside the worktree. A dev server there takes its own port:
`pnpm --filter @marxy/desktop exec vite --port 1430` (without `--strictPort` Vite moves to the next
free port and prints it).

### Build

The rules are in [AGENTS.md](../AGENTS.md); `pnpm check` enforces most of them. A piece is done when:

- a repair is proved by the key or the open: a test that opens the file or presses the key and checks
  what the reader sees, and fails without the change;
- every document that describes the changed behaviour says the new thing, in the same commits;
- a new browser test file is in `scripts/verify-map.json`, a new attribute, event, mark or private property in `scripts/registry.json`, a new
  dependency in the allow-lists;
- `pnpm verify --tier changed` passes.

### Verify, and look

`pnpm verify` is described in [testing.md](testing.md#one-command-for-a-tree-pnpm-verify). For anything
visible, take pictures of it rather than trusting the markup:

```bash
pnpm --filter @marxy/desktop shots scripts/shots/window.mjs            # this tree's source, in headless Edge
pnpm --filter @marxy/desktop shots scripts/shots/window.mjs --exe      # the built marxy.exe's own window
```

A scenario is a module whose default export receives the tools (`apps/desktop/scripts/shots/window.mjs`
is one to copy; keep a piece's own scenarios in its run folder under `work/runs/`):

| Tool | Does |
| --- | --- |
| `boot(file, { w, h, scheme, scale })` | a Playwright page with the app landed on a file under `fixtures/demo`; each call is a fresh window |
| `shot(page, name, { clip, wait })` | writes `<name>.png`, the whole window or the `clip` rectangle, and prints any page errors |
| `plantText(page, path, text)`, `plantBytes(page, path, bytes)` | puts a file into the memory shell, for a page no fixture has |
| `open(page, path)` | opens a shell path in the active pane |
| `real` | true under `--exe` |

Without `--exe` the app is served from source over the memory shell and drawn at two device pixels per
CSS pixel, so a crop holds up at true size, with scrollbars as Chromium draws them. With `--exe` the
scenario drives the release binary through WebView2's debugging port with a data folder of its own; it
holds the same machine lock as `check:tauri`, and `plantText` and `plantBytes` are refused (put the file
on disk and `boot` its path). Pictures go to `work/shots/<tree>-<time>/` unless `--out` names a folder;
`--only <text>` takes the pictures whose name contains the text, `--size 1200x800` and `--scale 1` set
the window.

### Review

The reviewer reads the pull request's diff (`git diff main...agent/<name>`), not the builder's account
of it, and after fixes reads only what changed since. A review that an agent writes is one comment on the
pull request, from the `review` skill (`.claude/skills/review/`): its first line is
`Independent review: APPROVE` or `Independent review: CHANGES`, then numbered findings, and its last line a
marker the merge gate reads, `<!-- marxy-review verdict=<approve|changes> head=<sha> run=<id> model=<model> -->`.
The builder's pull request body ends with `<!-- marxy-author run=<id> model=<model> -->`. A person's review
goes on the pull request too. Things a diff of Marxy is read for:

- input the reader did not write (a file's bytes, an archive's directory, a pasted page): is the work it
  can cause bounded, and is every string it supplies escaped or sanitised where it is drawn;
- a shell operation present in `shell/tauri.ts` and `shell/memory.ts` alike, and a path that is checked
  before it is read;
- tests that would pass without the change;
- documents that still describe the old behaviour.

When agents build, the reviewer runs on a different model from the builder, and the merge gate counts an
approval only from another run on another model than the author's marker names.

### Integrate

One piece can land by itself, as its own pull request. Several built side by side are merged, in turn, on
an integration branch (`pnpm work start wave-06 --from origin/main`, then `git merge agent/<name>` for each in
that worktree), checked together with `pnpm verify --tier full`, and land as one pull request. The run's
orchestrator keeps its account in `work/runs/<date>-wave-06/README.md` as it goes. What breaks at the seams between pieces that each passed alone:

- tests that count things (shell commands, settings, kinds) when two pieces each add one;
- `packages/core/goldens/` when two pieces touch the kind registry: the second to merge re-runs
  `pnpm gate:golden`;
- `scripts/verify-map.json` and `scripts/registry.json`, which every piece appends to.

Tier `full` builds the release binary and, on Windows, runs `check:tauri`. Only one such run can drive a
window on a machine at a time, so it belongs to whoever integrates; builders stop at tier `changed`.

### Try

On Windows, `pnpm work installer` builds a ref in the `exe` worktree, signs it, keeps a copy under
`builds/` and installs it for this user ([development.md](development.md#an-installer-of-a-ref-kept-and-installed)).
What a script cannot judge (how a thing looks at rest, a real pointer, a network share, files from other
programs) stays in the tracker under its own heading until someone has tried it.

### Land and clear

`main` moves only through a pull request. In scheduled runs the merge gate, `node scripts/auto/auto.mjs tick`,
merges it, and no agent does: the pull request is not a draft, its head is `agent/*`, an approve marker for
its current head comes from a run and model other than its author's, the `ci` check is green, it touches no
path in `.github/CODEOWNERS`, it has no `hold` label, GitHub calls it clean (merges happen at any hour). Anything else waits for the owner. In a session the owner drives, the owner merges. A
run lands with `pnpm verify --tier full` behind it. The pull request carries the tracker change (its rows
removed), and for a run the new `work/ledger.md` row and the rewritten `work/STATE.md`. Then:

```bash
git -C <checkout> pull --ff-only        # the main checkout catches up
git fetch --prune                       # merged branches lose their upstream
pnpm work todo --check                  # names any row whose branch has landed
pnpm work clean                         # lists the worktrees and branches that have landed
pnpm work clean --apply                 # removes them
```

`clean` touches only `agent/` branches that have landed (every commit in `main`, or upstream gone). It
keeps a worktree with uncommitted or untracked files and says which files, keeps a branch that sits on
`main`'s own commit or that nothing has been committed on since it was made (work about to begin, wherever
it was cut), and never touches a worktree on no branch. `--keep a,b` holds back the named ones.

## The schedule

The cycle above also runs by itself, on Osiris (Windows) with device checks on Eris (macOS) and Set (Linux).
The agent jobs are Claude desktop app scheduled tasks that follow skills in `.claude/skills/`; the mechanical
jobs are `node scripts/auto/auto.mjs <command>` run by the machine's scheduler. Times are Pacific.

| When | Job | Does |
| --- | --- | --- |
| daily 00:20 to 05:00 | `night` (agent) | carry-over, then the week's queue: builders, reviewers; Saturday the plan intake, Tuesday a bug hunt, Thursday and Friday the sweep |
| daily 05:15 | `nightly` (script) | full verify of `main` with the browser suite and `check:tauri`, alone reruns, the Windows install check |
| daily 08:45 to 13:30 | `day` (agent) | triage of the nightly and device results, then more building |
| Friday 08:15 | `plan` (agent) | the week's outcome, `STATE.md`, the ledger row, and next week's plan as a pull request |
| every 30 minutes | `tick` (script) | the merge gate (any hour) and the dashboard issue |
| hourly, on power | device scripts | install checks on Eris and Set |

The owner's window, 14:00 to midnight, has no agent work. The week starts at the usage reset, Friday 20:00:
its plan is `work/weeks/<that Friday>.md`, and the owner can change it on its pull request until Saturday's
night run takes it in. The budget rules, the devices and how to stop any of it are in
[scripts/auto/README.md](../scripts/auto/README.md).

## Questions for the owner

A row that waits on the owner's call becomes a question in a set, answered on a page. The page is one
HTML file in the reader's default theme (Night, or Paper when the system is light), with the theme,
the faces and every picture inside it.

```bash
pnpm work ask new 2026-04-12-waiting     # work/questions/2026-04-12-waiting/questions.json, a template
pnpm work ask serve 2026-04-12-waiting   # the page on http://127.0.0.1:4517/; ends when the owner presses Send
pnpm work ask read 2026-04-12-waiting    # the answers as Markdown
```

`questions.json` holds a `title`, an `intro` and `questions`. Each question has an `id`, a `title`,
`context` (paragraphs), `from` (where it came from), `default` (what happens unanswered), `choices`
(each an `id`, a `label`, a `detail`, `recommended`, an `image`, and `specify`: a prompt for a text
field shown when that choice is picked), `multi` for any number of picks, and `note` (the prompt of the
free text field every question has; with no choices it is the answer). Text draws `code` and
**bold** and nothing else. `visual` is one or a list of:

| Key | Draws |
| --- | --- |
| `image` | a picture beside the set (`alt`, `caption`) |
| `images` | pictures one under the other, each with a `label`, to compare |
| `bars` | horizontal bars: `unit` and `rows` of `label`, `value`, `note`, and `mark` for the one to point at |
| `table` | `head` and `rows` of cells |
| `code` | a block of text as written |
| `svg` | a drawing, shown as an image so nothing in it runs |

`serve` saves every change to `answers.json` and `answers.md` beside the set, so nothing is lost if the
page closes; Send writes them marked sent, prints the Markdown and exits, so a command waiting on it
learns the answers when it ends. The server answers only `127.0.0.1` and `localhost` at its own port.
`build` writes `<set>-questions.html` to open as a file instead: answers stay in that browser, Copy
answers puts the Markdown on the clipboard, and Save answers file downloads them for
`pnpm work ask read <set> --from <file>`. `pnpm work ask` lists the sets and how many of each are
answered. Answers are acted on in the tracker: a row leaves Waiting with its decision written in.

## Working side by side

- One writer per worktree. Pieces that edit the same files run one after the other.
- `git stash` is shared by every worktree of a repository: commit to the branch instead.
- Work another machine may need is pushed. Unfinished work goes up as its `agent/<name>` branch, with
  where it stands in the run folder or a draft pull request.
- Browser tests serve the source live, so do not edit a tree while its tests run. With several builders
  on one machine, each runs at most two browser test files at a time; `pnpm verify --tier changed` keeps to
  that by default (`--jobs 2`), and runs at most four Node-only desktop unit files at once (`--unit-jobs`).
  `pnpm verify` also takes one of two machine-wide places for its heavy steps and waits when both are taken
  ([testing.md](testing.md#a-turn-for-the-heavy-steps)); no outside queue is needed.
- `check:tauri`, `shots --exe` and `pnpm verify --tier full` wait on one machine lock
  ([testing.md](testing.md#one-checktauri-at-a-time)).
- A builder's report says what it committed, what changed for the reader, which tests it ran and their
  counts, and what it did not do or could not check.

## `pnpm work`

| Command | Does |
| --- | --- |
| `pnpm work` | where things stand: `main`'s commit, branches with commits it lacks (how many, which worktree, clean or not), worktrees ready to clear, the tracker's counts, the newest build |
| `pnpm work init` | makes `<checkout>-wt/`, `builds/`, and `work/todo.md` if the tree has none; leaves what exists |
| `pnpm work start <name> [--from <ref>] [--no-install]` | branch `agent/<name>` and worktree `<checkout>-wt/<name>` |
| `pnpm work list [--dirty]` | every worktree: branch, commit, state (`open`, `merged`, `unstarted`, `at-base`, `detached`, `gone`), and with `--dirty` its uncommitted changes |
| `pnpm work clean [--apply] [--keep a,b]` | merged worktrees and branches; lists them, and removes them with `--apply` |
| `pnpm work todo [--check] [--file <path>]` | the tracker's rows against the branches |
| `pnpm work installer [<arguments>]` | Windows: `scripts/installer-windows.ps1` with the checkout's paths; everything after `installer` goes to it unchanged, a `--` first is dropped |
| `pnpm work ask [list\|new\|build\|serve\|read] <set>` | questions for the owner and their answers ([above](#questions-for-the-owner)); everything after `ask` goes to it |

`--base <ref>` measures against a branch other than `main`; `--root <dir>` asks about another tree of
the same repository. With `installer` they go before it; after it they reach the script.
