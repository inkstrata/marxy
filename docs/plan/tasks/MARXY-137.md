---
key: MARXY-137
design: [04-typesetting]
depends: [MARXY-24, MARXY-25, MARXY-143]
verify: [pnpm precheck, pnpm done MARXY-137]
---
# MARXY-137 — turn on hyphenation and hanging punctuation in the app readers open

**Design:** [04-typesetting](../../design/04-typesetting.md), `docs/design-language.md` (the six constraints) · **Depends on:** MARXY-24 (the options), MARXY-25 (the baselines this story recaptures), MARXY-143 (the aesthetics gate must be deterministic on `webkit-linux` before criterion 4 can be met) · **ADRs:** ADR-0007, ADR-0014.

> **Revised 2026-09-19 (attempt 3), after PR #104 was returned again at `2877622`** —
> `orchestration/results/MARXY-137.json`, `docs/plan/deltas/2026-09-19-marxy-137-hang-check.md`.
> Attempt 2 did everything the prior revision asked: `headless.ts` matches `app.ts`, criterion 8's
> parity case exists, all sixteen `rag` baselines are recaptured on both engines. The one thing
> left is `scripts/gate-aesthetics.mjs`'s `checkHanging`, now in `Paths`: its 40 % rule was written
> for a full hanging quote and wrongly applies to the ~5 % optical `latinProtrusion` nudge `hang.ts`
> puts under the same `.marxy-hang` class, which is why turning hanging on in `headless.ts` fails
> roughly 2100 corpus checks that are correct typesetting. Fix `checkHanging`, not the typesetting,
> not the corpus, not the CLS threshold. **PR #104 stays open — amend it, do not cut a new branch
> and do not close it.**
>
> **Revised 2026-09-19 (attempt 2), after PR #104 was returned at `f697884`** —
> `orchestration/results/MARXY-137.notes.md`, `docs/plan/deltas/2026-09-19-marxy-137-headless.md`.
> `Paths` gained `apps/desktop/src/render/headless.ts`, and criterion 4 named that file while a new
> criterion 8 pinned the two entry points to the same option set. The returned attempt flipped
> `app.ts` only, which left the gate measuring a render path no reader gets.

**Outcome.** The two typesetting features Marxy competes on are on for the reader. Two call sites
and a whole corpus of baselines.

## The one line, in two places
`apps/desktop/src/app.ts:128` reads:

```ts
typeset = attach(article, { lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', onPass: () => snap(article) });
```

and `apps/desktop/src/render/headless.ts:328-336` passes the same two literals to `attach()`, under a
comment saying they "stay off until MARXY-24 flips them there and here, and re-baselines
`fixtures/baselines/rag/`". That file is the headless render entry `pnpm gate:aesthetics` measures.

MARXY-24 landed `hyphenate?: boolean` defaulting to `true` and `hanging?: 'none' | 'left'` defaulting to
`'left'` (`packages/typeset/src/index.ts`). It correctly did not touch `app.ts`, which is outside its
paths, so both features exist and no reader sees either. **Delete both overrides in both files**; do
not pass the values explicitly, so both follow the package default and there is one place the default
lives. Delete the stale comment in `headless.ts` too — or rewrite it to say the options now follow the
package default. Flipping only one of the two is the defect that returned attempt 1: `checkRag` would
then be green about the greedy rag while readers get the Knuth–Plass one.

## Why it is a story and not a one-liner
Turning both on moves every line of every screenshot. This story therefore owns the recapture of
`fixtures/baselines` and the taste-review row, and its own diff is the before/after artifact the queue
wants — the whole corpus, greedy rag beside Knuth–Plass with hung punctuation. MARXY-25 commits the first
baselines and by construction captures the un-hyphenated, un-hanging page; it is allowed to merge first,
and this story is dispatched immediately after it lands.

## Files
- `apps/desktop/src/app.ts` — the two options removed. Nothing else in the file changes.
- `apps/desktop/src/render/headless.ts` — the same two options removed and the stale comment gone.
  Nothing else in the file changes; the snapshot windows and `finishShift` belong to MARXY-143.
- `scripts/gate-aesthetics.mjs` — `checkHanging` (§10 check 6, around line 298) gains a branch: for
  a `.marxy-hang` element whose `hangFraction` (`packages/typeset/src/hang.ts`) is less than 1, read
  the element's own inline `style.marginInlineStart` and require `contentLeft - rect.left` to match
  `-parseFloat(marginInlineStart)` within a small pixel tolerance, instead of the 40 % rule. An
  element whose `hangFraction` is 1 (in `hangingCharacters.start`) keeps the existing
  `rect.left < contentLeft - 0.4 * rect.width` check unchanged. Add two `--selftest` cases: a
  crafted ~5 % protrusion span that fails the old rule and passes the new one, and a crafted full
  quote-hang miss that still fails. Nothing else in this file changes.
- `apps/desktop/test/typeset-defaults.test.mjs` — new, Playwright through the MARXY-95 harness, plus
  the source-level parity case (criterion 8).
- `fixtures/baselines` — regenerated, including `rag/webkit-macos/` and `rag/webkit-linux/`.
- `docs/taste-review/2026-09-typeset-defaults/` — before/after pairs; a row in `docs/taste-review/queue.md`.

## Do this, in order
1. Remove the two options from both files and the comment from `headless.ts`. Confirm each file's
   diff is exactly that.
2. Write the two Playwright cases below and check each fails against `main` before the change. Add
   the parity case: read both sources and assert the option set passed to `attach()` matches.
3. `pnpm gate:aesthetics`, then regenerate the baselines. Read the failure list first: a baseline that
   moved for a reason you cannot name is a bug in the change, not a stale baseline. `rag/` moves on
   **both** engines: expect cv and short-line rate to fall, which `checkRag` tolerates because it
   only fails on a 5 % regression — the recapture is a ratchet, not a rescue. Find the route MARXY-25
   used to capture `fixtures/baselines/rag/webkit-linux/` from a Darwin machine and name it in the PR
   body; if there is no such route, report blocked rather than hand-editing Linux JSON.
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
| the two sources | both pass `attach()` the same option set; fails if either carries an override the other does not |
| `pnpm gate:aesthetics` both engines | green with the regenerated baselines, `rag/webkit-macos` and `rag/webkit-linux` among them; the PR lists every file that moved with a reason |
| `pnpm gate:perf` | green against `main`'s baselines; `typeset_viewport` under 100 ms on both runners |
| the document's bytes | untouched — no operation runs here |

## Acceptance → check
The row's eight criteria in order: 1 is the `app.ts` diff check, 2–3 are the Playwright cases, 4 is
`headless.ts` plus the `checkHanging` fix in `gate-aesthetics.mjs` plus `gate:aesthetics` and the
PR's baseline list, 5 is `gate:perf` with the numbers pasted, 6 is the artifact and the queue row,
7 is the `CHANGELOG.md` line, 8 is the parity case.

## Do not
Change any value in `packages/theme` (that is MARXY-128 and MARXY-129). Change `--marxy-measure`. Touch
`packages/typeset` — if a default is wrong there, that is its own story. Pass `hyphenate: true` or
`hanging: 'left'` explicitly. Raise a budget or edit a recorded perf number to make a gate green
(`docs/roadmap.md` tripwire). Regenerate a baseline you cannot explain. Touch anything in
`headless.ts` beyond the two options and the comment — the snapshot windows, `finishShift` and the
font waits are MARXY-143's, and it lands before you. Touch anything in `gate-aesthetics.mjs` beyond
`checkHanging` and its two new selftest cases — the CLS window, `checkRag`, `checkScreenshot` and
every other check are out of scope; do not loosen the 40 % rule for a full hanging quote, do not
skip `webkit-linux`, and do not special-case a document to get the check green. Open a second PR:
#104 is the one.
