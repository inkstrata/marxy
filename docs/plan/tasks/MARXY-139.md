---
key: MARXY-139
design: [05-theme]
depends: [MARXY-133]
verify: [pnpm precheck, pnpm done MARXY-139]
---
# MARXY-139 — stop the story boundary treating tokens.css as a frozen contract

**Design:** [05-theme](../../design/05-theme.md), `docs/theme-contract.md` · **Depends on:** MARXY-133 · **ADRs:** ADR-0031 (accepted), ADR-0008.

**Outcome.** The story boundary and the token check agree about what is frozen, so a values-only theme
tune can be committed. Nothing a reader sees changes.

## The bug
ADR-0031 decided that the theme contract is token **names, units and meanings**, and that the default
theme's values are taste which may change in any story whose paths name the theme, with a taste-review row
and never an ADR. MARXY-133 landed that: it removed the byte pin from `test:contracts-frozen` and added
`scripts/check-tokens.mjs` with the snapshot in `packages/theme/tokens.contract.json`.

It did not touch `scripts/registry.json`, whose `frozen` array still lists
`packages/theme/src/tokens.css`. `scripts/check-story.mjs:17` refuses any change to a file in that array
unless a `docs/adr/*.md` is in the same change:

```
if (isFrozen(f, reg) && !files.some(g => g.startsWith('docs/adr/') && g.endsWith('.md')))
```

So MARXY-129 — a values-only tune of the mono size and the heading weight — is refused at commit time by
the exact rule ADR-0031 retired, and every future tune would either be blocked or land a pointless ADR.
MARXY-129 depends on this story.

## Files
- `scripts/registry.json` — remove `packages/theme/src/tokens.css` from `frozen`; the `_note` gains a
  sentence saying tokens.css's contract is its names and units, checked by `scripts/check-tokens.mjs`
  (ADR-0031), not its bytes.
- `scripts/check-story.test.mjs` — new, in the shape of `scripts/check-one-parse.test.mjs`.
- `docs/hygiene.md` — the frozen-files section states the split in one sentence.

## Do this, in order
1. Write the two cases in `check-story.test.mjs` **first** and watch the tokens.css half fail. A test
   written after the fix cannot tell you the fix was needed.
2. Remove the entry and add the `_note` sentence.
3. Confirm `pnpm test:contracts-frozen` and `node scripts/check-tokens.mjs` are both still green, and that
   neither consults `registry.json`'s `frozen` array for tokens.css.
4. `docs/hygiene.md`, then `pnpm precheck`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `check-story` over a staged tokens.css change, no ADR | exit 0 (fails before the change) |
| `check-story` over a staged `packages/shell-api/src/index.ts` change, no ADR | exit 1 naming the file — this half fails if the array is emptied instead of edited |
| `check-story` over a staged `packages/core/src/contracts/` change, no ADR | exit 1 |
| `pnpm test:contracts-frozen` | green; the `packages/*/src/contracts/` pins unchanged |
| `node scripts/check-tokens.mjs` | green; no value in tokens.css moved |
| `git diff -- packages/theme` | empty |

## Acceptance → check
The row's five criteria in order: 1 is `registry.json`, 2 is the two-sided `check-story.test.mjs` case,
3 is the token-check case, 4 is `docs/hygiene.md`, 5 is `pnpm precheck` and the `CHANGELOG.md` line.

## Do not
Change any value in `tokens.css`, or any byte of it. Edit `packages/theme/tokens.contract.json`. Remove
`packages/core/src/contracts/` or `packages/shell-api/src/` from `frozen` — the two-sided test exists so
that emptying the array cannot pass. Edit ADR-0031 or any accepted ADR. Widen
`registry.json`'s `extraAllowedPaths` or `innerHtmlAllowedIn` while you are in the file.
