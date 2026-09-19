---
key: MARXY-69
design: [10-gates-and-testing]
depends: [MARXY-63, MARXY-71]
verify: [node scripts/gate-perf.mjs --selftest, pnpm done MARXY-69]
---
# MARXY-69 — Measure a genuine cold start without a product ceiling

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) §Perf · **Depends on:** MARXY-63, MARXY-71 · **ADRs:** ADR-0022 (land Amendment 2). Do not edit ADR-0013.

**Outcome.** Reference mode runs at least five genuinely cold launches, records the procedure, and prints the median. It does not fail a 501 ms median. A tag carries the measurement and no duration claim.

## Files and signatures
- `scripts/measure-startup.mjs` — reference path: k ≥ 5 cold launches, each preceded by the cold-making step; no warm launch in the statistic.
- `scripts/gate-perf.mjs` — reference mode records `median(cold_launches)`; no comparison to `product.cold_start_first_text_ms`; placeholder `'the product cold-start budget is not currently enforceable'` gone.
- `docs/sdlc.md` — release runbook step 2 names the artifact and forbids a cold-start duration on the tag.
- `docs/adr/0022-perf-budgets-two-tier-enforcement.md` — Amendment 2: no product ceiling; keep measuring; resist inflation.
- `docs/adr/README.md` — Amendment 2 listed.

`CHANGELOG.md` is an implicit extra, not a listed path.

## Do this, in order
1. Wait until MARXY-71 is `done` so `MARK first_text` means paint.
2. Build the k ≥ 5 cold round and the recorded `cold_procedure`.
3. Replace the placeholder with the measurement-only path. Prove 501 ms still exits 0.
4. Rewrite the runbook step. Land Amendment 2. CHANGELOG line.

## Tests → expected
| Check | Expect |
| --- | --- |
| reference, 5 certified cold launches | exit 0; `cold_launches_n` ≥ 5; `cold_procedure` set |
| reference, median 501 ms, product 500 | exit 0 |
| a comparison against `product.cold_start_first_text_ms` | `--selftest` red |
| `cold_launches_n` < 5 or missing procedure | exit 1 |
| `rg -n 'not currently enforceable' scripts/` | no match |
| `fixtures/perf-budgets.json` vs main | byte-identical |

## Acceptance → check
CSV criteria 1–10. Criterion 3 is the ruling: no product ceiling.

## Do not
Compare the median to 500 ms. Raise a number in `fixtures/perf-budgets.json`. Edit ADR-0013. Invent MARXY-103. Start while MARXY-71 is still in review. Claim a time on a tag (that is also MARXY-16).
