# Plan delta — 2026-09-18 (design runway)

**Board at the time of writing:** 7 merges (MARXY-7, 11, 13, 17, 19, 55, 57), 3 PRs open
(MARXY-10 Jira as board of record, MARXY-12 sanitiser, MARXY-63 cold/warm split), 18 stories
added by the planner (MARXY-55..73), all Phase 0. This delta is a **design pass** by the
handoff author: it adds `docs/design/` (twelve documents), `docs/plan/tasks/` (one card per
Phase 1 and Phase 2 story), ADR-0023, and two stories (MARXY-74 this work, MARXY-75 provenance).

## Where things are, honestly

- **The parser is real** (MARXY-11): mdast/micromark, byte offsets on every node, invariants,
  goldens, the CommonMark suite. ADR-0021 is accepted by construction. The one deliberate
  loss — GFM's autolink-literal tree transform dropped because it discards positions — is
  documented and small.
- **The sanitiser and HTML renderer are in review** (MARXY-12) and are good: default-deny
  allow-list, 27 vectors each proven falsifiable, the no-network gate now drives the real
  pipeline. But the renderer emits **no provenance** and the policy strips `data-*`, so nothing
  in the DOM can resolve to bytes yet. MARXY-75 fixes that with a two-pass sanitise (ADR-0023);
  it is the first Phase 1 story after MARXY-61.
- **The rag research** (MARXY-19) is careful and its conclusion is narrower than ADR-0007's
  language: Knuth–Plass beats greedy modestly (short lines 7.1 % → 4.8 %, CV 0.0361 → 0.0339)
  and only at ≤ 0.6 em glue stretch; at 2 em it is worse than greedy. The differentiator a
  reader sees is therefore the **bundle** — rag, hung punctuation, no short last lines, a grid
  that never drifts — and the design (§04) builds and the gate (§10) measures all four. ADR-0007
  stands; its "categorically better" sentence should be read as "measurably better on four
  properties", and the Phase 1 review will say which.
- **Cold start is far over budget on CI**: launch 1 on `macos-latest` is 2.4–3.5 s (MARXY-63's
  finding). The reference-hardware number does not exist yet. The waterfall in §00 sets the
  order of levers; MARXY-61 (dropping markdown-it and DOMPurify) is the first and cheapest.
- **The fleet is drifting toward machinery.** Of the 18 planner-added stories, 15 are gates,
  harness or process. Each is defensible; together they are the failure mode the handoff named
  ("do not let the machinery become the project"). The runway below is ordered so that the
  next dispatches are product stories.

## What this pass changes

| Change | Why |
| --- | --- |
| `docs/design/00..11` | Every decision a Phase 1–2 implementor would otherwise make is made once, with signatures and tests |
| `docs/plan/tasks/<KEY>.md` for MARXY-16, 20–31, 33–39, 61, 64, 75 | Executable cards; the implementor prompt now reads them |
| ADR-0023 (proposed) | Provenance in the DOM; the spoofing analysis |
| MARXY-75 (new, Phase 1) | Lands ADR-0023; blocks 20, 23, 38, 41 |
| `deps.json` — see below | Sequencing corrections |
| Feature decisions D-A1..D-A19 recorded in §00 | So `docs/decisions.md` has one place to point at |

### Dependency edits (apply in `orchestration/deps.json`; this PR does not touch the board files, MARXY-10 owns them)

- `MARXY-61 → [MARXY-12]`; `MARXY-75 → [MARXY-12, MARXY-61]`
- `MARXY-20 → [MARXY-61, MARXY-75]` (was 10, 12 by plan id); `MARXY-26 → [MARXY-61, MARXY-75]`;
  `MARXY-27 → [MARXY-61, MARXY-20]`; `MARXY-28 → [MARXY-61, MARXY-20]`; `MARXY-29 → [MARXY-12]`
- `MARXY-23 → [MARXY-19, MARXY-20, MARXY-21, MARXY-64, MARXY-75]`
- `MARXY-37 → [MARXY-20, MARXY-75]`; `MARXY-38 → [MARXY-34]`; `MARXY-34 → [MARXY-14, MARXY-75]`; `MARXY-33 → [MARXY-21, MARXY-27, MARXY-28, MARXY-35]`
- Phase 1 membership adds MARXY-61, MARXY-64, MARXY-75.

### Recommended dispatch order once MARXY-12 merges

1. MARXY-61 (renderer through core; bundle shrinks) — lane 1
2. MARXY-64 (prose fixture) — lane 2, independent
3. MARXY-29 (smart typography) — lane 3, independent, small
4. MARXY-75 (provenance) — after 61
5. MARXY-20 (theme + grid) — after 75; MARXY-21 (fonts) after 20
6. MARXY-23 (typesetter) — after 20, 21, 64; MARXY-25 (headless entry + gate) in parallel with 23 once 20 is in
7. MARXY-26, 27, 28 in parallel after 20/75; MARXY-24 after 23; MARXY-30 after 25; MARXY-31 last

Gate/harness stories (55–73) fill free lanes only; none of them blocks the list above.

## Tripwires checked

| Tripwire | Status |
| --- | --- |
| K–P not beating greedy | Passes on this corpus by 2.3 points of short lines; re-checked on MARXY-64's fixture by MARXY-23 |
| Cold start > 500 ms | Fires on CI hardware, unknown on reference; levers ordered in §00; not yet a decision |
| Weight residual > 25 on real Linux | No data; MARXY-22 needs a desktop (`needs-human.md`) |
| Others | Not fired |

## Addendum, same day — dark is primary, and the designs are hardened

Ian's decision, applied now rather than after light was designed: **dark is the primary
variant** (ADR-0024). Token defaults are the dark palette, the default theme carries the light
block, the window and the empty state paint dark, every matrix and review lists dark first.
Palette values and contrast ratios are in `docs/design/05-theme.md` §Palettes (body 14.5:1 dark,
16.2:1 light; every code token ≥ 4.6:1). MARXY-46 is now "light designed, not inverted";
MARXY-76 re-renders taste review #0 on dark before the typeface decision.

Hardening: `docs/design/README.md` gained the "hardened rules" table (runner, paths,
dependencies, naming, the complete list of marks and events, tolerances, what to do when a
design is wrong) and a pinned dependency table with a forbidden list. Three remaining
judgement calls were closed: the index ceiling keeps the 50,000 newest by mtime; the aesthetics
gate runs Playwright WebKit on both runners (never Chromium); the highlighter's scope → class
mapping is a fixed prefix table.

Board edits for MARXY-10's owner: MARXY-46 summary and description as in Jira; add MARXY-76
(Phase 1, deps none) and MARXY-75 (Phase 1, deps MARXY-12, MARXY-61) to the CSV and `deps.json`.

## Addendum — CI solidified (MARXY-83)

Measured: 6–10 min per PR; the Tauri release build alone 180–270 s uncached; Linux startup
measurement up to 135 s waiting out launches that never painted (fixed on `main` by MARXY-63's
Xvfb environment; confirmed 24 s after); two red `main` pushes from a perf baseline breach
(runner noise) and a 10 ms parse assertion in a unit test that failed at 22 ms on a slow runner.

Changed: the workflow is now five parallel jobs plus one aggregate `ci` check; change detection
skips build and browser work for docs-only PRs; cargo, pnpm, apt and mise are cached; browsers
come from the Playwright image; the app builds with a thin-LTO `ci` profile; every job has a
timeout; a perf breach is re-measured once before it fails; the parse-time assertion is skipped
under CI. `docs/hygiene.md` §CI holds the table and the rules.

Board edit for MARXY-10's owner: add MARXY-83 (Phase 0, `agent-loop`, done by this PR) to the
CSV. Human step after merge: point branch protection at the single `ci` context (command in
`docs/hygiene.md`).
