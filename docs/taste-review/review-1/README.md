# Taste review #1 — blind side-by-side (tier 2)

Prepared kit for [ADR-0014 tier 2](../../aesthetics-acceptance.md#tier-2--human-scheduled) item 1–3.
Corpus: `01-long-technical.md`, `02-readme-real-world.md`, `03-ai-plan.md` at **68 `ch`**, **17 px**,
**light**, **2×**, viewport **960×900** px.

## Before you rank

1. Read `manifest.json` for capture ids (`first`, `scroll70`) per document.
2. View PNGs under `blind/` when populated (after Ian adds Typora and Marked 2 captures and re-runs
   `node docs/taste-review/review-1/shuffle-manifest.mjs`). Until then, marxy-only references live
   under `marxy/`.
3. Do **not** open `manifest.key.json` until rankings are recorded below.

## Ranking form — tier 2 items 1–3

### 1. Blind side-by-side (three documents)

For each corpus document, rank **A**, **B**, and **C** (best to worst) at reading distance.
All three viewers were captured at the same width and theme intent (light).

| Document | 1st | 2nd | 3rd | Notes |
| --- | --- | --- | --- | --- |
| Long technical (`01-long-technical.md`) — first screen | | | | |
| Long technical — scroll ~70% (“fourth page”) | | | | |
| Real README (`02-readme-real-world.md`) — first screen | | | | |
| Real README — scroll ~70% | | | | |
| AI plan (`03-ai-plan.md`) — first screen | | | | |
| AI plan — scroll ~70% | | | | |

**Pass (item 1):** marxy is **first** on at least **two of the three** documents (compare first-screen
captures; scroll rows inform item 2).

### 2. The fourth page (long document)

On the long technical document scrolled to ~70%, note whether the grid has drifted or the rag has
degraded anywhere in the viewport.

**Pass (item 2):** nothing noted.

### 3. First reaction (README)

One person who has not seen marxy opens `02-readme-real-world.md` in marxy and records the first
remark verbatim (about how it **looks**, not a feature request).

**Pass (item 3):** the remark is aesthetic, not functional.

## Record outcomes

Write decisions to `docs/taste-review/2026-09-review-1/decisions.md` (or a dated sibling folder) and
link from `docs/taste-review/queue.md`. Tier-2 failure blocks the phase release; it does not block
merging individual PRs.
