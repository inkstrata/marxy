# Plan delta — 2026-09-19 (the hang check conflates a full quote with a nudge, and a done story's own gate blocks it)

> Narrow, out-of-cadence planner pass covering two triggers. No product scope changes, no phase
> re-sequencing, no ADRs, no split of either story.
>
> 1. **MARXY-137** reported `blocked` on attempt 2 (PR #104, head `2877622`) —
>    `orchestration/results/MARXY-137.json`.
> 2. **MARXY-59** (PR #100) is red on both gates runners for a reason its own `Paths` cannot fix —
>    surfaced by the author, not a returned review.

## Trigger 1 — `checkHanging` cannot tell a hanging quote from a 5 % optical nudge

MARXY-137 attempt 2 did the in-path work correctly: `headless.ts` matches `app.ts` on `attach()`,
criterion 8's parity case exists, and all sixteen `rag` baseline files are recaptured for both
engines via the MARXY-25 docker route. Criteria 1–3 and 5–8 hold. Criterion 4 still cannot go
green in CI, and this time the remaining gap is one line in a file the story does not own.

`scripts/gate-aesthetics.mjs`'s `checkHanging` (§10 check 6) is written for one shape of hang:

```js
if (!(rect.left < contentLeft - 0.4 * rect.width)) out.push(`hang ... does not sit outside the edge`);
```

That rule is right for a hanging opening quote — `packages/typeset/src/hang.ts`'s `hangFraction`
returns `1` for anything in `hangingCharacters.start`, so the whole glyph advance is pulled left of
the measure and 40 % is a generous floor under real rendering noise. It is wrong for the *other*
thing `hang.ts` puts under the same `.marxy-hang` class: `latinProtrusion` optical alignment, where
`hangFraction` returns a few hundredths (a value from `justif/core`, divided by 1000) and the
element's own `marginInlineStart` is set to exactly `-(fraction * advance)` — typically 4–8 % of the
glyph's width, not 40 %. The check was written before MARXY-24 shipped either kind of span (the
file's own comment called it "vacuous until MARXY-24 hangs anything"), so it was never wrong on a
tree where nothing hung. MARXY-137 is the first PR where `headless.ts` renders the corpus with
hanging on, and the optical-protrusion spans — most of the punctuation and cap-height letters that
start a line, per `docs/design/04-typesetting.md` — fail a rule built for full quote hangs. The
implementor counted roughly 2100 failing checks across the corpus and verified the fix locally: same
criterion, one file, outside `MARXY-137`'s `Paths`.

### Decision: widen, do not split — same shape as the 2026-09-19 headless pass

The remaining work is the hang check the story's own criterion 4 already implies (`checkHanging`
correct for the render path the story turns on), in one more file, with a check the implementor
already verified passes. A split would separate "turn hanging on" from "make the hang check able to
see hanging," which is not a coherent boundary — the second half only exists because of the first.
**PR #104 stays open and is amended on attempt 3.**

`Paths` for MARXY-137 gain `scripts/gate-aesthetics.mjs`:

```
apps/desktop/src/app.ts, apps/desktop/src/render/headless.ts, scripts/gate-aesthetics.mjs,
apps/desktop/test/typeset-defaults.test.mjs, fixtures/baselines,
docs/taste-review/2026-09-typeset-defaults
```

Criterion 4 is rewritten to require `checkHanging` compare a `.marxy-hang` span's observed
protrusion against its own `marginInlineStart` when the span is not a full hanging-quote character
(`hangFraction` < 1), and to keep the 40 % floor only for spans where it is (`hangFraction` === 1).
A new `--selftest` case in `scripts/gate-aesthetics.mjs` crafts a ~5 % optical-protrusion span and
has to fail against the current 40 %-for-all rule (and pass after the fix); a second crafted case
keeps a full quote-hang miss failing exactly as it does today, so the fix cannot be satisfied by
loosening the check into always passing. Everything else about criterion 4 — both engines green,
baselines regenerated in this PR, the PR body naming every moved file and the Linux capture route —
is unchanged. Summary, Description intent, phase, and criteria 1, 2, 3, 5, 6, 7 and 8 are untouched.
`docs/plan/jira-issues.csv` is **not** added to `MARXY-137`'s `Paths`, for the reason PR #87 was
returned: a story that can edit its own row has no boundary.

**Frozen, restated because this is the kind of fix that invites a shortcut:** the CLS gate is not
loosened, `webkit-linux` is not skipped, and no document is special-cased to get `gate:aesthetics`
green. The fix is to `checkHanging`'s rule, not to the corpus or the thresholds around it.

## Trigger 2 — MARXY-91's own diff guard now blocks the story it exists to let land

MARXY-59 (PR #100) fails `gates (macos-latest)` and `gates (ubuntu-latest)` on every commit with:

```
selftest FAIL: diff: the three-dot range must not contain gate-perf, budgets, or parse.test.ts
  — scripts/gate-perf.mjs, fixtures/perf-budgets.json, packages/core/src/parse/parse.test.ts
measure-parse selftest failed: 1 case(s)
```

(run 35478253837, jobs 105991225184 and 105991225208). `scripts/measure-parse.mjs --selftest` runs
unconditionally in the `gates` job on every PR (`.github/workflows/ci.yml:182`, before the actual
parse measurement). One of its nine named cases — `UNTOUCHED_PATHS` / `forbiddenInDiff` /
`threeDotNames()` — reads the live `origin/main...HEAD` diff and fails if it contains
`scripts/gate-perf.mjs`, `fixtures/perf-budgets.json` or `packages/core/src/parse/parse.test.ts`.
MARXY-91 wrote that guard, correctly, to stop some *other* story from touching the two-tier perf
mechanism before `measure-parse.mjs` existed to feed it. But MARXY-59's entire job — its `Paths`,
its Description, its acceptance — is to touch exactly those three files: move the parse budget into
`gate-perf.mjs`'s two-tier enforcement, add the CI entries to `perf-budgets.json`, and delete the
self-calibrating assertion from `parse.test.ts`. MARXY-91 is done; the guard has done its job
(nothing landed early); it now permanently forbids the one PR it was written to make possible.

This is not a MARXY-59 defect and not a reason to touch MARXY-59's own `Paths` — `scripts/` outside
`measure-parse.mjs` is not listed there, and the fix belongs to the file that wrote the guard.

### Decision: a companion story, not a MARXY-59 rework, not a second MARXY-59

**MARXY-147 — retire the diff guard now that MARXY-59 is its sanctioned user.** Paths:
`scripts/measure-parse.mjs` only. It deletes `UNTOUCHED_PATHS`, `forbiddenInDiff`, `threeDotNames`
and the one selftest case that calls them, leaving the other eight named cases byte-identical and
in the same order. `.github/workflows/ci.yml` does not change — the `--selftest` step already runs
unconditionally; removing the one case inside it is enough. Card: `docs/plan/tasks/MARXY-147.md`.

**MARXY-59 is not re-dispatched, not split, and PR #100 is not closed.** It waits for MARXY-147 to
land, then rebases and its own `gates` runs go green on the parse guard for the first time — no
product rework, since criteria 1–3 and 5 were never in question (`orchestration/results/
MARXY-59.json`, gates all green except this one; `MARXY-59.notes.md`'s escalation history is a
different, already-resolved defect from an earlier attempt).

## Sequencing

`scripts/check-story.mjs` reads the CSV from the working tree on the implementor's branch, and
MARXY-137's row is already on `main` from the MARXY-144 landing, so the further-widened row and the
new MARXY-147 row both need to reach `main` in their own commit before either story moves. Both
triggers land in **one** landing story rather than two, because their board edits touch the same
files (`docs/plan/jira-issues.csv`, `orchestration/deps.json`, `orchestration/jira-map.json`,
`docs/plan/tasks`) and two landing stories dispatched in the same round would collide on the overlap
guard for no reason — precedent for bundling unrelated deltas into one landing PR is MARXY-140.

| Key | Change |
| --- | --- |
| **MARXY-148** | new, ops lane, no deps: commits this delta, the further-widened MARXY-137 row, the MARXY-147 row, and the cards. **Dispatch first.** |
| **MARXY-147** | new, ops lane, no deps: retires `measure-parse.mjs`'s diff guard. Dispatch after MARXY-148 lands. |
| MARXY-137 | `Paths` gain `scripts/gate-aesthetics.mjs`; criterion 4 rewritten again; card revised. Stays `blocked` on PR #104 until MARXY-148 merges, then is returned for attempt 3 (amend #104, same PR — do not cut a new branch, do not close it). |
| MARXY-59 | row unchanged; `deps.json` gains an edge from MARXY-59 to MARXY-147. Stays as-is on PR #100 until MARXY-147 merges, then rebases. |

So: **MARXY-148 lands → #104 is returned for MARXY-137 attempt 3 (amend, same PR) → MARXY-147 is
dispatched and merges → MARXY-59 rebases and its `gates` runs go green.** MARXY-137's return and
MARXY-147's dispatch are independent of each other once MARXY-148 is on `main` — neither blocks the
other — but **do not start a second MARXY-137 implementor before MARXY-148 is on main**, and **do
not start a second MARXY-59**.

## Risks that moved

- **The aesthetics gate's mechanical checks are still young.** This is the second time in three
  attempts that `checkHanging` (this pass) or `checkRag`/the CLS window (the prior headless pass)
  needed a correction rather than the story needing rework. Read a red `browser` on a typography
  PR as a prompt to check whether the *check* matches the design doc before re-dispatching.
- **A CI gate that reads the live three-dot diff is a sharper tool than it looks.** MARXY-91's
  guard was correct on the day it was written and became wrong the day MARXY-59 was ready to land
  — nothing about the code changed, only what the guard was allowed to see. The lesson for future
  stories: a guard shaped "no PR may touch file X" needs either an expiry condition or a named
  exception for the story that is supposed to touch it, stated in the guard's own acceptance, not
  left to a planner pass to discover after the fact.

## Escalation risk

- **MARXY-137 attempt 3.** Third attempt on the same PR; the remaining change is smaller and
  better-specified than attempt 2's (implementor already verified the fix locally), which lowers
  risk, but three attempts on one PR is itself a signal — if this returns again, the next planner
  pass should look for a fourth call site or a design gap rather than assume a fourth narrow fix.
- **MARXY-147.** Low risk — deletion-only change to one file's internals, the other eight selftest
  cases are unaffected, and MARXY-59's own `Paths` prove what the guard is standing in the way of.
- **MARXY-148.** Board-only, small diff, sixth instance of the same shape (MARXY-131, MARXY-135,
  MARXY-140, MARXY-144, MARXY-146). Low risk.

## How we would know I was wrong

1. **`checkHanging`'s fix does not clear all ~2100 failures.** Then optical protrusion has more
   than one shape in the corpus and the check needs a third branch, decided from the actual
   failure list, not guessed here.
2. **MARXY-147's deletion breaks a case MARXY-91 relied on for something other than the
   pre-MARXY-59 window.** Then the guard was protecting something this delta did not find, and it
   needs to move to a different mechanism (an ADR-scale question about what `measure-parse.mjs`'s
   selftest promises) rather than be deleted outright.
3. **MARXY-59 fails `gates` again after MARXY-147 merges, for a different reason.** Then its own
   `Paths` or acceptance need a second look — MARXY-59.notes.md already documents one prior,
   unrelated escalation (the parse measurement never reaching the gates job at all), so a third
   failure mode would be worth a dedicated read before touching either story again.
