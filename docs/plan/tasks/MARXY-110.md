---
key: MARXY-110
design: []
depends: [MARXY-69, MARXY-111]
verify: [node --test scripts/lib/no-ceiling.test.mjs, pnpm done MARXY-110]
---
# MARXY-110 — Stop claiming a 500 ms cold-start ceiling

**Depends on:** MARXY-69 (done) · **ADRs:** land ADR-0029 (proposed on disk);
do not edit ADR-0013.

**Outcome.** A new session no longer reads "cold start < 500 ms" as a CI
failure. The roadmap tripwire matches the author's resist-inflation ruling.

## Files and signatures
- `docs/adr/0029-no-product-cold-start-ceiling.md` — Status: accepted
- `docs/adr/README.md` — 0029 listed as accepted
- `AGENTS.md` — budget table: drop `< 500 ms` as a cold-start CI failure;
  keep 50 / 16 / 100 / 100 / 50
- `docs/roadmap.md` — replace the "Cold start > 500 ms after Phase 2" tripwire
  with the resist-inflation rule
- `scripts/lib/no-ceiling.test.mjs` — fails if any of those four regress

`CHANGELOG.md` is an implicit extra. `pnpm test` already runs `scripts/lib/*.test.mjs`.

## Do this, in order
1. Flip ADR-0029 to accepted. Update the README row.
2. Rewrite the AGENTS.md budget table cell. Do not invent a new product number.
3. Rewrite the roadmap tripwire Signal. The What-it-reopens cell can stay
   "Font subsetting first; resident mode default on that platform second;
   never a bigger bundle" **or** name resist-inflation; do not keep the 500 ms
   Signal text.
4. Write the regression test. CHANGELOG line.

## Tests → expected
| Check | Expect |
| --- | --- |
| ADR-0029 Status | `accepted` |
| `AGENTS.md` contains `< 500 ms` | test fails |
| `docs/roadmap.md` contains `Cold start > 500 ms after Phase 2` | test fails |
| other named budgets 50 / 16 / 100 / 100 / 50 missing | test fails |
| `docs/adr/0013-speed-budgets-are-gates.md` in the three-dot diff | fail (boundary) |

## Acceptance → check
CSV criteria 1–6.

## Do not
Edit ADR-0013. Edit `fixtures/perf-budgets.json` (MARXY-70). Claim a cold-start
time. Touch `.github` or `package.json`. Raise a number to make a gate green.
