---
key: MARXY-137
design: [04-typesetting]
depends: [MARXY-24, MARXY-25]
verify: [pnpm precheck, pnpm done MARXY-137]
---
# MARXY-137 — turn on hyphenation and hanging punctuation in the app readers open

**Design:** [04-typesetting](../../design/04-typesetting.md), `docs/design-language.md` (the six constraints) · **Depends on:** MARXY-24 (the options), MARXY-25 (the baselines this story recaptures) · **ADRs:** ADR-0007, ADR-0014.

**Outcome.** The two typesetting features marxy competes on are on for the reader. One line of code and a
whole corpus of baselines.

## The one line
`apps/desktop/src/app.ts:128` reads:

```ts
typeset = attach(article, { lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', onPass: () => snap(article) });
```

MARXY-24 landed `hyphenate?: boolean` defaulting to `true` and `hanging?: 'none' | 'left'` defaulting to
`'left'` (`packages/typeset/src/index.ts`). It correctly did not touch `app.ts`, which is outside its
paths, so both features exist and no reader sees either. **Delete both overrides**; do not pass the
values explicitly, so the app follows the package default and there is one place the default lives.

## Why it is a story and not a one-liner
Turning both on moves every line of every screenshot. This story therefore owns the recapture of
`fixtures/baselines` and the taste-review row, and its own diff is the before/after artifact the queue
wants — the whole corpus, greedy rag beside Knuth–Plass with hung punctuation. MARXY-25 commits the first
baselines and by construction captures the un-hyphenated, un-hanging page; it is allowed to merge first,
and this story is dispatched immediately after it lands.

## Files
- `apps/desktop/src/app.ts` — the two options removed. Nothing else in the file changes.
- `apps/desktop/test/typeset-defaults.test.mjs` — new, Playwright through the MARXY-95 harness.
- `fixtures/baselines` — regenerated.
- `docs/taste-review/2026-09-typeset-defaults/` — before/after pairs; a row in `docs/taste-review/queue.md`.

## Do this, in order
1. Remove the two options. Confirm the file's diff is exactly that.
2. Write the two Playwright cases below and check each fails against `main` before the change.
3. `pnpm gate:aesthetics`, then regenerate the baselines. Read the failure list first: a baseline that
   moved for a reason you cannot name is a bug in the change, not a stale baseline.
4. `pnpm gate:perf`. `typeset_viewport` has a 100 ms budget and hyphenation adds work to the line
   breaker; paste the numbers from both runners into the PR body. If it is over, stop and report blocked —
   do **not** raise the budget, and do not turn the feature back off to get green.
5. Render review #0 passages 2 and 4 at 1× and 2× as before/after pairs; add the queue row.

## Tests → expected
| Check | Expect |
| --- | --- |
| `01-long-technical.md` through the harness | at least one line ends in the hyphen `packages/typeset/src/apply.ts` injects; fails against `main` |
| the same hyphen | not selectable text (it is generated, not a document byte) |
| a line beginning with a hanging quote | its first grapheme sits left of the measure's left edge by a non-zero amount |
| a line beginning with a letter | no protrusion |
| `pnpm gate:aesthetics` both engines | green with the regenerated baselines; the PR lists every file that moved with a reason |
| `pnpm gate:perf` | green against `main`'s baselines; `typeset_viewport` under 100 ms on both runners |
| the document's bytes | untouched — no operation runs here |

## Acceptance → check
The row's seven criteria in order: 1 is the diff check, 2–3 are the Playwright cases, 4 is
`gate:aesthetics` plus the PR's baseline list, 5 is `gate:perf` with the numbers pasted, 6 is the artifact
and the queue row, 7 is the `CHANGELOG.md` line.

## Do not
Change any value in `packages/theme` (that is MARXY-128 and MARXY-129). Change `--marxy-measure`. Touch
`packages/typeset` — if a default is wrong there, that is its own story. Pass `hyphenate: true` or
`hanging: 'left'` explicitly. Raise a budget or edit a recorded perf number to make a gate green
(`docs/roadmap.md` tripwire). Regenerate a baseline you cannot explain.
