---
key: MARXY-133
design: [05-theme]
depends: [MARXY-131]
verify: [node scripts/check-tokens.mjs, node --test scripts/check-tokens.test.mjs, pnpm test]
---
# MARXY-133 — Freeze the token names and units, not the default theme's values (ADR-0031)

**Design:** [05-theme](../../design/05-theme.md) · **ADRs:** ADR-0031 (this story accepts it), ADR-0008, ADR-0014, ADR-0016 · **Depends on:** MARXY-131, which puts ADR-0031 on `main` as *proposed* — cut from `main` after it merges.

**Outcome.** A taste decision costs a story and a queue row, not an ADR. `packages/theme/src/tokens.css`
stops being byte-pinned and starts being checked for what is actually contract: the token names, their
unit kinds, and the fact that each is explained. The `packages/*/src/contracts/` pins do not move.

## Files and signatures
- `scripts/check-tokens.mjs` — `export function declarations(css)` → `{ name, kind, comment: boolean }[]`,
  where `kind ∈ length | number | colour | family | ratio | keyword`, inferred from the value (`28px` →
  length, `600` → number, `#151412` → colour, quoted or comma list → family, `1.25` → ratio, `none` →
  keyword; `var()`/`calc()` take the kind they resolve to, else `keyword`). Compares against
  `packages/theme/tokens.contract.json` and exits non-zero naming each token added, removed, re-kinded or
  stripped of its comment.
- `packages/theme/tokens.contract.json` — generated from the current file by `--write`, committed. No
  value in it.
- `scripts/check-tokens.test.mjs` — a fixture per failure mode plus the value-only case
  (`--marxy-size-code` 14px → 15px, `--marxy-weight-heading` 600 → 560) which must pass.
- `package.json` — `test:contracts-frozen` drops `packages/theme/src/tokens\.css` from its path regex
  and its pin map; the root `test` script runs `check-tokens.mjs`.
- `docs/adr/0031-token-values-are-taste.md` → accepted, with the merge date; `docs/adr/README.md` row.
- `AGENTS.md` ("Contracts are frozen") and `docs/hygiene.md` and `docs/theme-contract.md` — the new rule
  in the same words in all three: names, units and meanings need an ADR; the default theme's values need
  a story and a taste-review queue row.

## Do this, in order
1. Generate the snapshot from `tokens.css` as it stands. Diff it by eye against the file: every token
   present, no value captured.
2. Write the check and its test. Show each failure mode red.
3. Edit `test:contracts-frozen`. Prove the remaining pins still bite: touch a byte in
   `packages/core/src/contracts/ast.ts`, show it red, revert.
4. Accept ADR-0031. Update the three documents. `pnpm test`, `pnpm precheck`, `pnpm done MARXY-133`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `check-tokens.test.mjs` | five cases: added, removed, re-kinded, comment lost — red; value-only — green |
| `node scripts/check-tokens.mjs` | green over the committed tree |
| `pnpm test:contracts-frozen` | green; red when a `packages/*/src/contracts/` file changes |
| `git diff --stat` | no `.css` file, nothing under `apps/` |

## Acceptance → check
The seven criteria on the CSV row.

## Do not
Edit `packages/theme/src/tokens.css` — not one value, not one comment. Touch anything under
`packages/*/src/contracts/` or change a pin that is not the theme's. Move the dark variant's values into
`packages/theme/default/theme.css` (ADR-0031 explicitly leaves that open). Add a token. Tune anything:
the tunes are MARXY-129.
