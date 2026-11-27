# residue: Opus review

Reviewer of record. Saved by the orchestrator from the reviewer's text report.

**Verdict: ready after its fix.** The fix is committed as `68c1ca04` on `agent/residue`. The worktree is clean.

**Checks and method**

- **Behaviour:** the reviewer read all 268 non-comment changed lines.
  - The renamed switches and constants are renamed everywhere they are read. `MARXY_84_MUTATION`, `MARXY_14_RUST_CASES`, `MARXY_229_RESERVED` and `MARXY_86_MUTATION` no longer appear in scripts, docs, package.json or Rust.
  - `gate-bundle.test` still proves the `MARXY_8` prefix catch.
  - The source text the mutation harness patches (`search.ts`) is untouched.
  - `verify-map.json` matches the three renamed files.
- **Test counts:** it counted test declarations in every one of the 640 test files on `agent/wave1` and on the tip, with renames mapped. Every file matches, 5,607 in total, and the diff adds no `.skip` or `.only`.
  - The builder's "1100" came from an ad-hoc run of 1,103 tests (`desktop-unit.log`), not from the verify suite. Verify's desktop numbers are 1,256 Node-only plus 44 browser-starting.
- **Comments:** it read every rewritten comment, about 370 pairs. Most still say why; the problems are listed under the fix.
- **Class rule:** `AGENTS.md` and `docs/working.md` now name exactly which names go in the registry. `check-registry.mjs` agrees, apart from two fix messages that still said "registered class"; both are fixed.

**What the fix `68c1ca04` changed**

- Dropped about 22 letter-number codes the sweep missed and the builder did not list: D1–D4, B1/B2/B5, E3/E7/E9 and P8, in `registry.ts`, `roles.ts`, `fence-lang.ts`, `os.rs`, `tree.rs`, `shell-api` and others.
- Removed an ADR number from the note in `shiki-languages.json`.
- Mended two sentences the sweep broke: a lost full stop in `entries.ts`, and "bytes :" in `frame-archives.test`.
- Corrected the two "registered class" messages in `check-registry.mjs`.

**Kept on purpose:** H1–H7 in the probe and aesthetics tools, the golden-covered corpus ids, "post-pass N" and "handbook ch.N".

**Verify:** one clean turn on `68c1ca04`, `--tier changed --base agent/wave1`. All 16 steps green: core 4,234; desktop 1,256 + 44; scripts 263; browser 1,895; cargo 624. Nothing was red, so no reruns were needed. Typecheck, lint and `pnpm check` (10/10) also pass.

**To file for later**

- `classPrefix` and `tokenPrefix` in `registry.json` are read by nothing; the brief said to keep them.
- `probe-layout.mjs` output now says "(by the author's own word)", which is vague.
- `gate-aesthetics.mjs` still calls `--mechanical` "the pull-request gate".

## Orchestrator's notes

- Checked: the tip is `68c1ca04` (committed 19:55:08). `residue-verify.log` is a single turn started 19:55:12, so it covers the fix: 218 files changed against `agent/wave1`, 16/16, exit 0 at 20:38:30. The tree is clean.
