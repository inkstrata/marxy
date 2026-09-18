# MARXY-33 — Cold start under budget: fonts eager, everything else deferred

**Design:** [00-architecture](../../design/00-architecture.md) §Waterfall (targets, levers) · **Depends on:** MARXY-21, MARXY-27, MARXY-28, MARXY-35.

## Do this, in order
1. Instrument: marks for every waterfall row (`window_shown` from Rust, `script_start`, `args`, `file_read`, `parsed`, `rendered`, `fonts_ready`, `first_text`, `typeset_viewport`, `position_restored`, `highlight_ms`, `index_loaded`); `scripts/measure-startup.mjs` writes them all into `results/perf.json` as `waterfall`.
2. Assert deferral: a test on the built bundle's module graph (`vite build --manifest`) that the entry chunk imports none of `@shikijs/*`, `katex`, `@codemirror/*`; those are dynamic imports only.
3. Index, MRU, pins load in an idle callback after `position_restored`.
4. Apply levers in order until the reference-tier median for `01-long-technical.md` is < 400 ms: (a) inline both roman fonts as `data:` in `index.html`; (b) defer the italic face; (c) trim `base.css`; report each lever's effect in the PR.
5. Post the waterfall table in the PR body.

## Acceptance → check
`results/perf.json` `cold_start_first_text_ms` under the CI envelope on both runners and < 400 ms on the reference tier (a `needs-human.md` entry asks for one reference run on the M5); module-graph test green; waterfall attached.
