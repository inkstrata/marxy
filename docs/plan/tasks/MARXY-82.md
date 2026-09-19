---
key: MARXY-82
design: [10-gates-and-testing]
depends: [MARXY-6]
verify: [node scripts/gate-protection.mjs --selftest, pnpm done MARXY-82]
---
# MARXY-82 — Gate branch protection so the settings cannot drift back

**Depends on:** MARXY-6 (done) · **ADRs:** none. Reads live settings; does not change them.

**Outcome.** A standing check knows when `enforce_admins` or the merge settings
drift. CI runs the selftest over committed fixtures. Live mode is `--live` and
never runs in CI.

After-8 replan 2026-09-19: `package.json` dropped from Paths so this row no
longer collides with MARXY-65. Invoke as
`node scripts/gate-protection.mjs --selftest`. Do not add a pnpm script.

## Files and signatures
- `scripts/gate-protection.mjs` — `--live` (gh api) and `--selftest` (fixtures)
- `scripts/fixtures/protection/` — one JSON fixture per condition, that condition flipped
- `docs/hygiene.md` — working command is `gh api -X PATCH` (not PUT), `-F strict=true`,
  required context is the single name `ci`

`CHANGELOG.md` is an implicit extra. Do not edit `package.json` or `.github/`.

## Do this, in order
1. Build `--selftest` over fixtures; injected reader; no `gh`; no network.
2. Build `--live` against the real repo settings listed in the CSV.
3. Document the PATCH command in `docs/hygiene.md`.
4. CHANGELOG line.

## Tests → expected
| Check | Expect |
| --- | --- |
| `--selftest`, ≥ 10 fixtures, one condition flipped each | exit 1 if any fixture passes; prints case count |
| injected reader call counter | no network, no `gh` |
| `.github/workflows/` references this script | check fails |
| `--live` with `enforce_admins` false | exit 1, names MARXY-6 in words |

## Acceptance → check
CSV criteria 1–6.

## Do not
Change any GitHub setting. Add `pnpm gate:protection` (that needs `package.json`,
which is MARXY-65). Edit `cycle.mjs` or `.github/workflows`. Reopen PR #43.
