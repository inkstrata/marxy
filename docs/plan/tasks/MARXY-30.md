# MARXY-30 — Screenshot baselines and diff gate per engine

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) check 10 · **Depends on:** MARXY-25.

## Do this
1. Baselines for every corpus markdown file at 960 px, dark then light, first screen and last-heading screen, in Playwright WebKit on the macOS runner (`webkit-macos`) and on the Linux runner (`webkit-linux`) — committed under `fixtures/baselines/<engine>/` (PNG, `binary` attribute already set).
2. `pixelmatch` (MIT) comparison in `gate-aesthetics.mjs` with threshold 0.1 and ≤ 0.1 % differing pixels; a diff image is written to `results/diffs/` on failure and uploaded as a CI artifact.
3. `--update` flow documented in `docs/design/10-gates-and-testing.md` (already) and in the PR template's checklist ("baseline updated → queue entry").

## Tests
A 1 px change to `h2` margin in a scratch branch fails the gate with a diff image; identical rerun passes (determinism across two runs on the same runner).
