# residue: builder's report (Sonnet)

Saved by the orchestrator from the builder's text report.

Branch `agent/residue`: two commits on `agent/wave1` `f99eed3e`. Verify is red on three files (a notebook speed test, `frame.test.mjs`, `transcript-jsonl.test.mjs`); each passes run alone, so the builder counts them as load.

**Commits**

- `ab0f746b` chore(scripts): drop the class list nothing reads from the registry
- `82cb7f0e` docs(comments): say why in plain words and drop process ids from comments, test names and tool prose

**Numbers**

- `scripts/registry.json`: 547 lines removed (the 545 entries plus the `classes` wrapper). `AGENTS.md` and `docs/working.md` now say a class needs only the `marxy-` prefix.
- Comments: about 330 lines edited across 192 files, counted by `git diff`. About 120 edits were mechanical and the rest by hand. Each comment kept its reason and lost its id; none was deleted whole.
  - By pattern: `archive page A#` (about 50); the theme-pass and `STUDIO-BRIEF` lines (about 28); `D-A#` (9); `(B#/C#/E#)` and `D#:` prefixes (about 35); `H#` (about 28); decision, review-of-#, ruling and `Ian` mentions (about 20); "Ports the prototype's checks (lab 25 …)" (about 15); "criterion" (about 10); and the CI and nightly prose in the listed tools plus about ten other files.
  - Three commit hashes in comments went (`notebook.test.ts`, `kind-profiles`, `conformance`/`fold-text`).
- Test names: about 105 renamed, mostly `D1:`, `B#:`, `C#:`, `criterion N:`, `#N:`, `MARXY-…`, `P-look`, `Studio acceptance` and `(H#)` prefixes.
- Files renamed, with `verify-map.json` updated:
  - `round3-desktop` → `source-notices-grid`
  - `split-screen-criterion` → `split-readme-beside-plan`
  - `phase-e-flow` → `paste-and-tidy-flow`
- Switch and constant names:
  - `MARXY_84_MUTATION` → `MARXY_TREE_DEPTH_MUTATION`
  - `MARXY_14_RUST_CASES` → `SAVE_PATH_RUST_CASES`
  - `MARXY_229_RESERVED` → `RESERVED_VECTORS`
  - `MARXY_86_MUTATION` is gone from `mutations.mjs` and `gate-bundle.test.mjs`.
- Also removed: the `toml` comment and the `[profile.ci]` prose in `Cargo.toml`, and the ADR and nightly note in `perf-budgets.json`.

**Id-pattern search survivors (kept)**

- `H1`–`H7` in `probe-layout*.mjs` and `gate-aesthetics.mjs`: the tools' own output labels.
- `MARXY_8` and `MARXY_19` in `gate-bundle.mjs` and its test: prefixes guarding removed switches.
- `MARXY-64`, `MARXY-235` and `ADR-0006` in `fixtures/corpus/README.md`, `28-artifact-fences.md`, `15-prose-volume.md` and `14-marxy-plan.md`: golden-covered. Editing the README failed the golden gate, so that edit was reverted.
- ADR 0004 and the "prototype" wording in the `fixtures/demo` sample documents.
- "the prototype's glyph/cursor" comments in `src/`.
- "handbook ch.N" references.
- The "post-pass N" labels.
- The `H1`/`H2` cell and heading names in tests.
- A few "nightly" and "CI" mentions outside the listed tools.

**Tests run**

- Typecheck, lint and `pnpm check` (10/10) pass.
- Core 4234 pass, 3 skip. Theme 305 pass. Scripts 281 pass. Desktop unit 1100 pass, 3 skip.
- Not run: a clean desktop browser suite beyond what verify ran.

**Verify** (`residue-verify.log`)

- Two runs are interleaved in one log, because killing the first did not stop it.
- The first hit a stale golden gate. That was the README edit, since reverted.
- The second run (commit `82cb7f0e`) passed every step except:
  - `unit-core`: the 10 MB notebook speed test.
  - `unit-desktop-browser`: `frame.test.mjs`.
  - `browser`: `transcript-jsonl.test.mjs`.
- Each passes alone: 19/19, 17/17 and 8/8.
- Separately, `perf-record.test.mjs` failed once in a loaded scripts run and passes alone (3/3).

**Not done, and calls made**

- No revert-and-fail proof: nothing new was added.
- The `source-looks` race did not show up.

## Orchestrator's notes for the reviewer

- Checked: two commits; 202 files, +411/-976 against `agent/wave1`; the tree is clean; no verify process left; both slots free.
- The verify log is two runs in one tree at once: one through the turn script, one outside the slot system. The machine was doubly loaded and the log is hard to read. Take one clean verify turn on the tip.
- The builder's "desktop unit 1100 pass" is lower than `agent/wave1`'s parts would suggest (verify on this tree: 1256 Node-only plus 44 browser-starting). Make sure renames did not drop or skip tests: compare test counts per suite between `agent/wave1` and the tip.
- Comment edits can break tests that scan source text, and ids hide in strings. A renamed switch must be renamed everywhere it is read (scripts, docs, package scripts).
