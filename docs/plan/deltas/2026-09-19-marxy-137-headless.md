# Plan delta — 2026-09-19 (the headless render entry: one row too narrow, one gate too flaky)

> Narrow, out-of-cadence planner pass covering two triggers that turn out to be the same file.
> No product scope changes, no phase re-sequencing, no new ADRs, no split of either story.
>
> 1. **MARXY-137** returned on attempt 1 (PR #104, head `f697884`) — `orchestration/results/MARXY-137.notes.md`.
> 2. **MARXY-26** escalated on attempt 2 (PR #95, head `1594c86`) — `orchestration/results/MARXY-26.notes.md`.
>
> Both point at `apps/desktop/src/render/headless.ts`: the first because the row's `Paths` stop
> one file short of its own criterion, the second because that file's font/image window is
> non-deterministic on `webkit-linux` and is now red on every pull request that runs `browser`.

## Trigger 1 — MARXY-137's Paths stop one file short of its own criterion

MARXY-137 turns hyphenation and left-edge hanging on for the reader and owns the baseline
recapture that follows. Criterion 4 requires `pnpm gate:aesthetics` green "with the baselines
regenerated in this PR". That is not achievable inside the row's `Paths`, because the two options
are set in **two** places:

- `apps/desktop/src/app.ts` — the app the reader opens. In `Paths`; flipped by PR #104.
- `apps/desktop/src/render/headless.ts` lines 328–336 — the headless render entry the aesthetics
  gate measures. **Not** in `Paths`; still passes `hyphenate: false` and `hanging: 'none'`, under
  a comment saying they "stay off until MARXY-24 flips them there and here, and re-baselines
  `fixtures/baselines/rag/`".

The implementor left `headless.ts` alone and was right to, under AGENTS.md's one-issue-one-owner
rule. The consequence is worse than a missing criterion: after #104 the comment is false, the two
entries no longer share literals, and `fixtures/baselines/rag/*/**.json` records the rag of a
configuration that no longer ships. `checkRag` in `scripts/gate-aesthetics.mjs` would then be
green about the greedy rag while readers get the Knuth–Plass one — the mechanical half of the
aesthetics test measuring a page nobody sees. Nothing else in the tree gates the new rag.

### Decision: widen, do not split

The remaining work is the same two-option deletion the story already owns plus the recapture it
already owns, in one more file. A split would put the app flip and the gate's view of the app flip
in two PRs and guarantee an interval where the baselines describe neither. **PR #104 stays open and
is amended on attempt 2.**

`Paths` for MARXY-137 become:

```
apps/desktop/src/app.ts, apps/desktop/src/render/headless.ts,
apps/desktop/test/typeset-defaults.test.mjs, fixtures/baselines,
docs/taste-review/2026-09-typeset-defaults
```

Criterion 4 now names `headless.ts` explicitly, requires the rag JSON regenerated for **both**
`webkit-macos` and `webkit-linux`, and asks the PR body to name the route used to capture the
Linux half — which is the route MARXY-25 used, since MARXY-25 committed those files. A criterion 8
is added: a source-level case pinning the two entries to the same option set and deleting the now
false comment, so the drift that caused this return cannot recur silently. Summary, Description
intent, phase and every other criterion are untouched. `docs/plan/jira-issues.csv` is **not** added
to MARXY-137's `Paths`, and never should be: a story that can edit its own row has no boundary
(the reason PR #87 was returned).

## Trigger 2 — the aesthetics font/image window is a race on webkit-linux

MARXY-26 (PR #95) is signed: eight of eight criteria met, boundaries clean, the reviewer would
merge today. The only red is `browser`, and it is red for something the diff cannot cause — the
diff is pure functions plus one data field on `RenderResult`, with `gate:golden` green proving the
HTML is unchanged. Two runs of the *identical* commit `1594c86` failed on different documents with
different magnitudes: `19-source-file.md 960×24 dark` at `0.78` (job 105996495895) and
`02-readme-real-world.md 720×17 dark` at `0.0173` (job 105997368997). A defect caused by a code
change fails the same case twice.

The failing interval is `finishShift`'s `snaps[0] → snaps[1]` window in `headless.ts`. The entry
awaits `document.fonts.ready` and snapshots; on FreeType a content face or an unreserved image can
still land after that promise resolves, so the window scores movement belonging to nobody's diff.
`gate:aesthetics` is green on `webkit-macos`, which is exactly why `engineName()` splits the two.
The gate has three samples in its whole life — two green, and every red so far has been this.

### Decision: a new ops story, MARXY-143

**MARXY-143 — make the aesthetics font and image window deterministic on webkit-linux.** Paths:
`apps/desktop/src/render/headless.ts`, `scripts/gate-aesthetics.mjs`, and one new test file
`apps/desktop/test/layout-shift-window.test.mjs` (the acceptance needs somewhere to live). The
acceptance is deliberately two-sided, because the cheap way to make this gate green is to stop it
measuring:

- **Positive:** wait on the faces the page actually uses (`document.fonts.load` per family, weight
  and style the article's own elements report) and on `decode()` of every image whose box was
  reserved, before the first snapshot. A case fails against a tree that awaits `fonts.ready` alone.
- **Determinism:** a new `--repeat N` flag runs the corpus through the CLS check N times in one
  process and fails if the set of documents reporting a non-zero window differs between passes, or
  if any pass reports one at all. `--repeat 3` green on `ubuntu-latest` in CI is the evidence.
- **Negative:** `--selftest` stays green, i.e. the crafted late-image case still scores a miss, and
  a new case asserts an unreserved image inserted after the first snapshot still yields
  `fontWindow > 0`.
- **Frozen thresholds:** a case asserts `reported.cls > 0`, the `snapshots < 2` floor, `RAG_OPTS`,
  `WIDTHS`, `VARIANTS`, `SIZES` and `LINE_BOX` are byte-identical to `main`. **The CLS threshold is
  not widened, no document is special-cased, and the check is not skipped on webkit-linux.**

**MARXY-26 is not re-dispatched, not split again, and #95 is not closed.** It stays `escalate`
until `browser` is green, then merges as it stands on a rebase — the rebase is how the gate fix
arrives. No dependency edge is added to MARXY-26's row, so nothing about that story needs a
landing. The reviewer's two non-blocking notes (the `evil.example` carve-out in criterion 5, and
`imageSize`'s home in `docs/design/06-shell.md` versus the Rust `imagesize` crate) are carried into
MARXY-138's card rather than into a new story; neither is worth a PR of its own.

## Sequencing

`scripts/check-story.mjs` reads the CSV from the working tree on the implementor's branch, and
MARXY-137's row is already on `main` from the MARXY-140 landing. So the widened row and the new
MARXY-143 row must reach `main` in their own commit before either story moves. That is a landing
story's job, the same shape as MARXY-131, MARXY-135 and MARXY-140.

| Key | Change |
| --- | --- |
| **MARXY-144** | new, ops lane, no deps: commits this delta, the widened MARXY-137 row, the MARXY-143 row and the cards. **Dispatch first.** |
| **MARXY-143** | new, ops lane, depends on MARXY-25 (done): the CLS-window fix. Dispatch after MARXY-144 lands. |
| MARXY-137 | `Paths` gain `apps/desktop/src/render/headless.ts`; criterion 4 rewritten; criterion 8 added; card rewritten; **now depends on MARXY-143**. |
| MARXY-30 | now depends on MARXY-137 — no row change, a `deps.json` edge only (see below). |

MARXY-137 and MARXY-143 both edit `headless.ts`, so the dependency edge — not just the path-overlap
guard — keeps them from being dispatched together, and it puts them in the only order that works:
MARXY-137's criterion 4 asks for `gate:aesthetics` green on `webkit-linux`, which nobody can
deliver while that gate names a different document each run. Precedent for a numbered-phase story
depending on an ops key is MARXY-109 and MARXY-110 on MARXY-111; the MARXY-107 rule is about phase
*blocking*, which is untouched.

So: **MARXY-144 lands → MARXY-143 merges → #104 is returned for MARXY-137 attempt 2 → #95 rebases
and merges.**

One more edge falls out of that queue. **MARXY-30** ("screenshot baselines and diff gate per
engine") is `todo`, ready by dependency, and its `Paths` are `fixtures/baselines,
scripts/gate-aesthetics.mjs` — it collides with MARXY-143 on the gate and with MARXY-137 on the
baselines, and it would commit screenshot baselines of the un-hyphenated page that MARXY-137 then
has to move again. `node orchestration/ready.mjs` already shows MARXY-143 in `blockedByPaths`
behind it, which is the overlap guard picking the wrong winner. MARXY-30 therefore **now depends on
MARXY-137**, so the three stories run in the only order in which each captures a page the next one
does not immediately invalidate.

Nothing else moves. MARXY-138 still waits on MARXY-26, MARXY-25, MARXY-95 and MARXY-137; MARXY-128
(#94) and MARXY-139 (#105) are untouched by this pass.

## Risks that moved

- **The aesthetics gate is not yet trustworthy.** It has three samples and two of the three reds
  were phantom. Until MARXY-143 merges, a red `browser` on a diff that cannot move a pixel is
  evidence about the gate, not the diff — read it that way rather than re-dispatching the story.
  This is the first thing since the perf-variance pass that could stall the whole queue.
- **Baseline recapture now has two owners in sequence.** MARXY-143 must not move a baseline byte
  (its acceptance says so) precisely so that MARXY-137's recapture stays the single event that
  explains every changed file under `fixtures/baselines`.

## Escalation risk

- **MARXY-137 attempt 2.** Already returned once, and the remaining half is the part the
  implementor cannot fully verify on a Darwin worktree: `fixtures/baselines/rag/webkit-linux/`. If
  the Linux recapture has no local route, the attempt stalls on evidence rather than on code. The
  card now names MARXY-25's capture route as the thing to find and say out loud; if it cannot be
  found, the right move is to report blocked, not to hand-edit Linux JSON.
- **MARXY-143.** A timing race on an engine the implementor cannot run locally, in a mechanism no
  prior story has touched, with acceptance that deliberately forbids the easy fix. This is the
  most likely escalation of the three; if it escalates, the fallback to consider is scoring the
  window against a per-engine floor rather than `> 0`, which is an ADR-sized decision about what
  `gate:aesthetics` promises, not another implementor attempt.
- **MARXY-144.** Board-only, small diff, three prior instances of the same shape. Low risk.

## How we would know I was wrong

1. **MARXY-137 attempt 2 steps outside the five entries.** Then the recapture reaches further than
   two call sites and the story needs splitting after all, most likely along the engine boundary.
2. **`gate:aesthetics` is still non-deterministic after MARXY-143.** Then the window is not the
   race and the check is measuring something the DOM cannot settle; that is an ADR about what the
   zero-CLS promise covers, not a third attempt.
3. **A third call site of `attach()` appears.** Then the option set wants one exported default
   object in `packages/typeset` rather than literals repeated per entry point — its own story.
