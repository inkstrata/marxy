# AGENTS.md

Marxy is a desktop reader for local files: Markdown, plain text, code, data, logs, diffs, notebooks,
mail, archives, PDFs, images, audio and video, fonts, spreadsheets, Word documents and decks, and
SQLite databases. It is a Tauri 2 app (Rust) with a TypeScript front end built by Vite, in a pnpm
workspace. This file is the working guide for coding agents; `docs/` describes the software, and each
level's `README.md` lists its layout and tools.

## Map

| Path | What it is |
| --- | --- |
| `packages/core` | parsing with byte provenance, the file-type registry and detection, readings, operations and transforms, the sanitiser, highlighting, search; no DOM, no Node built-ins |
| `packages/typeset` | line breaking, hyphenation, hanging punctuation, the baseline grid (DOM only) |
| `packages/theme` | tokens and base CSS, bundled themes, the look engine, `config.toml` parsing and the settings schema |
| `packages/shell-api` | the `Shell` interface for every privileged operation (types only) |
| `apps/desktop/src` | the app: boot, window and panes, panels, rendering, Source, commands and keys, viewers, the Studio |
| `apps/desktop/src-tauri` | the Rust shell: commands, file access, watching, archives and decoders |
| `apps/desktop/test` | browser and integration tests |
| `fixtures/` | the test corpus and the demo workspace |
| `scripts/` | tools run from the root: checks, gates, runners, measurements, the work cycle ([index](scripts/README.md)) |
| `docs/` | what the software does and how it is built ([index](docs/README.md)); `docs/research/` is the Reader Typography Handbook and other research behind the design |
| `work/` | the tracker and the records of how work was carried out: runs, reports, questions ([schema](work/README.md)) |

Start with [docs/README.md](docs/README.md); [docs/architecture.md](docs/architecture.md) is the
technical map and [docs/working.md](docs/working.md) is how a change is carried from the tracker to
`main`. [work/STATE.md](work/STATE.md) says where `main` stands now.

## Commands

| Task | Command |
| --- | --- |
| Install | `pnpm install` |
| Where work stands | `pnpm work` |
| Start a piece of work | `git fetch`, then `pnpm work start <name> --from origin/main` (branch `agent/<name>`, worktree `<checkout>-wt/<name>`) |
| Run in a browser over the demo files | `pnpm --filter @marxy/desktop exec vite --port 1420 --strictPort`, then `http://localhost:1420/?open=<path under fixtures/demo>`; in a worktree, another `--port` and no `--strictPort` |
| Run the desktop app | `pnpm --filter @marxy/desktop dev` |
| Type-check, lint | `pnpm typecheck`, `pnpm lint` |
| Repository checks | `pnpm check` |
| Check a tree in tiers, with timings | `pnpm verify` (`--tier`: quick, changed, full) |
| A package's tests | `pnpm --filter @marxy/core test` (also `@marxy/theme`, `@marxy/typeset`) |
| One test file | `node --test --experimental-strip-types <file>`; desktop files from `apps/desktop` with `--test-concurrency=1` |
| Several browser test files | `node scripts/browser-tests.mjs [--jobs n] test/a.test.mjs test/b.test.mjs` (paths relative to `apps/desktop`) |
| Pictures of the app | `pnpm --filter @marxy/desktop shots <scenario.mjs>` (`--exe` for the built window) |
| Rust | `cargo test` in `apps/desktop/src-tauri`; `pnpm lint:rust` |
| Release build and smoke check | `pnpm --filter @marxy/desktop build` |
| Installer | `pnpm --filter @marxy/desktop bundle`; built from a ref, kept and installed (macOS and Windows): `pnpm work installer` |
| Drive the real window (Windows) | `pnpm --filter @marxy/desktop check:tauri`, after `build` |
| Clear finished work | `pnpm work clean` lists it, `--apply` removes it |

Run pnpm from inside the tree it is to act on; the repository pins its pnpm version, and a pnpm started
elsewhere and pointed in with `-C` refuses to run.

## Rules the code enforces

- **Bytes are the document.** A file is held as its bytes; every change is a `splice` over a byte
  range (`packages/core/src/buffer/`), and every rendered element carries its range as
  `data-marxy-s` / `data-marxy-e`. Do not normalise line endings, BOMs or encodings when reading or
  writing; saves go through the shell's atomic write.
- **Boundaries** (`check-boundaries`): `packages/core` takes no DOM globals and no Node built-ins;
  `@tauri-apps` and `invoke(` appear only under `apps/desktop/src/shell/`; a relative import never
  leaves its package.
- **The shell has two implementations.** A privileged operation is a method of the `Shell` interface
  (or `AppShell` in `apps/desktop/src/app-types.ts`), implemented in `shell/tauri.ts` and in the
  in-memory `shell/memory.ts` used by the browser build and the tests. A new Tauri command also goes in
  `src-tauri/build.rs`, `generate_handler!` in `main.rs` and `capabilities/main.json`.
- **One parser, one sanitiser** (`check-one-parse`): Markdown is parsed only by `packages/core`; HTML
  reaches the DOM only sanitised, and only from files listed in `innerHtmlAllowedIn`.
- **One scrollbar**: `packages/theme/src/frame.css` draws every bar in Chromium. A rule that sets
  `scrollbar-color`, or a `scrollbar-width` other than `none`, turns that bar off for its box and all
  inside it; `packages/theme/test/scrollbar-rules.test.mjs` fails on one.
- **Names are registered** (`check-registry`): `data-marxy-*` attributes, `marxy:` events, startup
  marks and private `--marxy-*` properties go in `scripts/registry.json`; a class needs no entry, only the `marxy-` prefix.
- **Theme sheets are generated**: edit `packages/theme/src/looks/<id>.ts`, then run
  `node packages/theme/scripts/write-theme-sheets.mjs`; a test fails on drift.
- **Dependencies are allow-listed** (`scripts/allowlists/dependencies.json`, `check-deps`) and must
  have a permissive licence (`pnpm gate:licences`).
- **No network**: the only network code is the reader-approved remote image fetch in
  `src-tauri/src/remote.rs`.
- **Tests and tools are mapped**: a new browser test file goes in `scripts/verify-map.json`, and a new
  script in its level's `README.md` (`scripts/verify.test.mjs` and `scripts/readme-index.test.mjs` fail
  otherwise).
- **Big files are ordinary** (`check-scale`, [docs/big-files.md](docs/big-files.md)): a file of 1 to 5 MB
  must stay usable. Work for a key, scroll, hover or panel is bounded by the screen or the change, never
  the file; whole-file work runs once per version of the bytes, yields and can be cancelled, and features
  reuse the store's parse, line index and readings instead of parsing again. No DOM query or layout read
  in a loop, no `shift`/`concat`/sort in a loop, no array spread into call arguments, no whole-text
  `split('\n')`, no unbounded pattern from the reader on the main thread; a bounded one says why on its
  line (`// scale: <why>`). A function that takes a whole document gets a growth case in
  `packages/core/src/scale.test.ts`. The checklist is the `big-files` skill.

## Design principles

The rules no check enforces. They apply to a one-line fix as much as to new design; the reasons, the owner
of each concern and the shapes to copy are in [docs/principles.md](docs/principles.md). Read it before
changing structure, adding a mechanism, or fixing a bug that crosses modules.

- **One owner per concern.** Path scope, chords, "is a modal open", work budgets, text helpers and errors
  each have one implementation. Find it and fix there; never add a second copy.
- **Look for copies first.** A fix to one of two copies is half a fix: fix both, or route through the owner.
- **Add nothing global:** no new `document`/`window` key listener, singleton, `appHandle()` call in a leaf
  module, modal selector or helper copy. A chord is a `key` on a command in the registry.
- **Dependencies point one way.** Import core from `@marxy/core` (export a missing name, don't deep-import);
  pass a module what it needs instead of reaching for globals.
- **Don't grow the giants.** New behaviour in `createRenderedView`, typeset's `attach()` and the other big
  factories goes in its own module; every listener added is removed on destroy in the same change.
- **Tests wait for conditions, not time,** and must pass on a hosted CI runner.
- **Structure changes stand alone,** in their own pull request, after in-flight branches that touch the same
  files. If the right fix is structural, make the narrow fix and add a tracker row.

## The cycle

[docs/working.md](docs/working.md) has the whole of it. In short:

1. Work is listed in the tracker, [work/todo.md](work/todo.md), committed in this repository. Take rows
   from it; `pnpm work todo` prints them.
2. `pnpm work start <name> --from origin/main` makes the branch and its worktree. Do everything there;
   write `<name>` in the rows' `Branch` cells.
3. Build the change with its tests and its documentation. A repair is proved by a test that opens the
   file or presses the key and checks what the reader sees.
4. Verify (below), commit on the branch, push it and open a pull request against `main`. The pull request
   says what changed for the reader, the tests run with counts, and anything not done or not checked. It
   removes the rows it finishes from `work/todo.md`.
5. Someone who did not write it, on a different model when agents build, reviews the pull request's diff
   and posts one comment with its verdict and marker (the `review` skill). CI runs `pnpm verify` on macOS.
6. In scheduled runs the merge gate (`node scripts/auto/auto.mjs tick`) merges a pull request once an
   independent review approved its current head, CI is green and it touches no CODEOWNERS path; no agent
   merges. In a session the owner drives, merging is left to the owner. A pull request that needs the
   owner's approval (CODEOWNERS paths, a `hold` label) waits for it. Do not merge or remove a branch
   another session is working on.

The schedule that runs this cycle every night, and its budget and merge rules, are in
[scripts/auto/README.md](scripts/auto/README.md).

A run of several branches built together (a wave or a round) keeps its account, rules, briefs, reports,
reviews and logs in `work/runs/<date>-<kind>-<nn>/`; when it lands, its pull request adds a row to
`work/ledger.md` and rewrites `work/STATE.md`. The layout is in [work/README.md](work/README.md).

## Verifying a change

1. `pnpm verify --tier changed` runs install, typecheck, lint, `pnpm check`, the gates, the unit suites
   of the packages touched, the browser test files that cover the changed folders, and the Rust lint and
   tests when the shell changed. Each can be run alone (the table above).
2. For anything visible, run the browser dev loop and look at it, or take pictures with `shots`, then
   run the desktop test files for that area. Run several with
   `node scripts/browser-tests.mjs [--jobs 3] test/<file>...` from the repo root (one server and browser
   for the batch). Browser tests serve the source live: do not edit source while they run, and run wide
   batches three files at a time.
3. For changes to the Rust shell, file handling, saving, the window or the frame, build and run
   `check:tauri` on Windows; it is the only check that drives the real WebView2 window. On macOS,
   `pnpm --filter @marxy/desktop build` builds the release binary and its smoke check launches it. One run at a time per
   machine (debugging port 9333): when several pieces are being built side by side, it is run by
   whoever integrates them, not by each builder.

## Conventions

- Comments say why, in plain words, where the code cannot. No ticket, decision, plan, review or tracker
  identifiers in code, comments, test names, commit subjects or `docs/`. They belong in `work/`.
- Keep `docs/` true: a change to behaviour a doc describes updates that doc in the same commit.
- Briefs, plans, logs, measurements and reviews of a piece of work go under `work/`, in the layout
  [work/README.md](work/README.md) sets out: text, not builds, and no account names or secrets in logs.
  Nothing outside `work/` refers to it.
- Commit subjects follow the history's form, `type(scope): what changed`.
- The product is written Marxy in prose and `marxy` in identifiers, paths and package names.
- The repository is `inkstrata/marxy` on GitHub and the default branch is `main`. Work on a branch
  `agent/<name>` in its own worktree, never in the main checkout; `git stash` is shared by every
  worktree, so commit instead. Push what another machine may need.

## Windows

- Package scripts written `VAR=value command` work under pnpm because `pnpm-workspace.yaml` sets
  `shellEmulator`; keep that setting, since `cmd.exe` would not set the variable.
- Tests that link a directory fall back to a junction when symlinks are refused (no Developer Mode), so
  they run; a few that need a real symlink still skip.
- `pnpm check:tauri`, `shots --exe` and the smoke check run the app with its own `MARXY_DATA_DIR`, so
  they never touch an installed Marxy's settings or state.
