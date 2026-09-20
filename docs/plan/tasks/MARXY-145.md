---
key: MARXY-145
design: []
depends: []
verify: [pnpm precheck, pnpm done MARXY-145]
---
# MARXY-145 — derive check-tokens.test.mjs's mutation literals from the live tokens.css

**Depends on:** nothing · **Reference:** `orchestration/results/MARXY-129.notes.md` note 1,
`docs/plan/deltas/2026-09-19-marxy-129-tokens-companion.md` · **ADRs:** ADR-0031 (values are
taste; the check is names and units).

**Outcome.** `scripts/check-tokens.test.mjs` proves the same four failure modes and the same
values-only pass regardless of what `--marxy-size-code` and `--marxy-weight-heading` are
currently set to, so a future taste tune can never turn a real check into a no-op again.

## The defect
`re-kinded token is red` and `value-only change is green` both build their mutated CSS with a
literal `String.replace('--marxy-size-code: 14px;', ...)`. MARXY-129 (PR #107) is a values-only
tune, exactly the shape ADR-0031 exists to allow, and it moved `--marxy-size-code` from `14px` to
`15px`. After it lands, `14px;` is no longer a substring of the committed `tokens.css`, so both
    10|replaces are no-ops: `mutated === css`. `value-only change is green` still happens to pass
(an empty diff is vacuously green), but `re-kinded token is red` asserts on an empty `found` array
and fails for real — `pnpm test` and CI's `fast` job go red on a tree with nothing wrong in it.
MARXY-129's implementor could not fix this: `scripts/` is outside that story's `Paths`.

## Files
- `scripts/check-tokens.test.mjs` — the only file this story touches (plus `CHANGELOG.md`).

## Do this, in order
1. Read the two target declarations out of the live `css` constant already in the test file, the
   same way `declarations(css)` or a targeted regex would, instead of writing `14px` or `600` as a
    20|   string. A helper like `declOf(css, name)` returning the current `value` string for
   `--marxy-size-code` (or `--marxy-weight-heading`) is enough; you already have `declarations` and
   `contract` imported.
2. `re-kinded token is red`: build the splice from that live value — replace the live length
   (`${value}`) with the same numeric text stripped of its unit (`14px` → `14`, `15px` → `15`,
   whatever it is today), so the case still turns a length into a bare number. Keep the same
   assertions: `found.some(p => p.kind === 're-kinded' ...)`, `/length → number/`, `found.length === 1`.
3. `value-only change is green`: derive the new values from the live ones — parse each to a
   number and move it by a fixed offset (`+1` for size, `-40` for weight is fine, or any
   deterministic offset), so the mutation is never the literal `15px`/`560` MARXY-129 happened to
    30|   land on. Keep the same assertions: `reasons(mutated)` empty, `declarations(mutated)` deep-equals
   `declarations(css)`.
4. Add one new case, `no hard-coded token literal survives a tune`, that reads
   `scripts/check-tokens.test.mjs`'s own source text (`readFileSync(import.meta.url ...)` or
   `fileURLToPath` + `readFileSync`) and asserts it contains no substring matching
   `/--marxy-size-code:\s*1[45]px;/` or `/--marxy-weight-heading:\s*(600|560);/`. This is the case
   that makes a regression to the old literal fail loudly instead of silently.
5. Run the suite against the committed tree (`--marxy-size-code: 15px` today) and paste the
   output in the PR body. `pnpm precheck`, `pnpm done MARXY-145`.

## Tests → expected
    40|| Check | Expect |
| --- | --- |
| `node --test scripts/check-tokens.test.mjs` | 8/8 green against the committed tree |
| `re-kinded token is red` | still fails `kind === 're-kinded'`, message matches `/length → number/`, built from the live declaration |
| `value-only change is green` | still asserts `reasons(mutated)` empty and `declarations` unchanged, built from live values |
| the new literal-survives case | fails if you revert steps 2–3 back to the literal `14px`/`15px` |
| `git diff --name-only origin/main...HEAD` | exactly `scripts/check-tokens.test.mjs` (+ `CHANGELOG.md`) |
| `pnpm test` | green — this is the exact command CI's `fast` job runs and that MARXY-129 (PR #107) was returned for |

## Acceptance → check
    50|The row's six criteria in order: 1 is the live-read requirement plus the new literal-survives
case, 2 is `re-kinded token is red`, 3 is `value-only change is green`, 4 is the green run pasted in
the PR body, 5 is the boundary diff, 6 is `pnpm test` on the PR head.

## Do not
Change `scripts/check-tokens.mjs` (the checker) or `packages/theme/src/tokens.css` — that file is
MARXY-129's, already tuned, and not yours to touch. Loosen `re-kinded token is red`'s assertions to
make the case easier; it must still fail on a real re-kind. Touch, close, reopen or push to PR
#107 — MARXY-129 stays `in_review` exactly as the reviewer left it and is restacked once this
merges, with no product rework.
