---
key: MARXY-91
design: [10-gates-and-testing]
depends: [MARXY-11, MARXY-55, MARXY-90]
verify: [pnpm precheck, pnpm done MARXY-91]
---
# MARXY-91 — Run the parse measurement on both gates runners

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) §Perf · **Depends on:** MARXY-11, MARXY-55, MARXY-90 · **ADRs:** ADR-0022.

**Outcome.** Both `gates` runners write `results/perf-parse.json` before `pnpm gate:perf`. MARXY-59 can keep `required: true`. The gate is not loosened.

## Files and signatures
- `.github/workflows/ci.yml` — on the `gates` job (both `macos-latest` and `ubuntu-latest`), a named step `run: node scripts/measure-parse.mjs` with no `if:`, no `continue-on-error`, no `|| true`, appearing before `pnpm gate:perf`. After `measure-startup` is the safest place.
- `scripts/measure-parse.mjs` — `parseMarkdown` on `fixtures/corpus/01-long-technical.md`; warmup then a recorded sample; write **only** `results/perf-parse.json` as `{ "parse_long_technical_ms": <median> }`; print the median; `--selftest` covers the workflow mutations in acceptance 1 and the snapshot mutations in acceptance 2.
- `docs/design/10-gates-and-testing.md` §Perf — one paragraph: parse is measured on the gates job, not only in the ubuntu-only `fast` job.

MARXY-59's `mergeParseMeasurement` already reads that snapshot. Do not re-implement the gate.

## Do this, in order
1. Add `scripts/measure-parse.mjs` with `--selftest`. Prove it writes only the snapshot.
2. Add the gates step on both matrix OSes, before `pnpm gate:perf`.
3. Update §Perf. CHANGELOG line.

## Tests → expected
| Check | Expect |
| --- | --- |
| `node scripts/measure-parse.mjs --selftest` | named cases for a missing / late / conditional / swallowed step, a dropped runner class, a missing or non-numeric snapshot, and a write to `results/perf.json` |
| Delete the step or move it after `pnpm gate:perf` | `--selftest` red |
| `git diff --name-only origin/main...HEAD` | no `scripts/gate-perf.mjs`, no `fixtures/perf-budgets.json`, no `packages/core/src/parse/parse.test.ts` |

## Acceptance → check
CSV criteria 1–5. Criterion 3 is the one that keeps MARXY-59's `required: true` untouched.

## Do not
Edit `scripts/gate-perf.mjs`, `fixtures/perf-budgets.json`, or `packages/core/src/parse/parse.test.ts`. Flip `required` to `false`. Widen the 30 % band. Invent a second measurement inside the gate. Ask MARXY-59's implementor to revert anything. Re-derive the ubuntu parse baseline — that is MARXY-70. Start while MARXY-62, MARXY-65, or MARXY-90 still own `.github/workflows/ci.yml`. Treat a ubuntu `glib-2.0` miss as this story's — that is MARXY-90 / PR #32. MARXY-68 has landed.
