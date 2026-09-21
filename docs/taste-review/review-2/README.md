# Taste review #2 — palette vs tabs (ADR-0011)

Prepared kit for the Phase 2 gate: the reviewer must reach a document from three switches ago
using **only the palette**, in under five seconds. Failure triggers the designed fallback in
ADR-0011 (tabs revealed only while switching, never at rest).

Reference captures: dark theme, **960×900** px viewport, **2×**, Playwright WebKit via
`node docs/taste-review/review-2/render.mjs`. See `manifest.json` for the exact open order.

## Before you start

1. Build and run marxy from this commit (palette mounted, Source mode on `.rs`, no tab bar at rest).
2. Confirm chrome at rest is still zero — no tab strip, no persistent palette.
3. Use the five corpus paths in **exact order** below (paths match `fixtures/corpus/`).

## Task script — palette reach (stopwatch)

Open each document in sequence (double-click or `marxy <path>` — however you normally open a
file). After the fifth document is on screen, **without using Mod+[ / Mod+] history**, summon the
palette and jump to **the document from three switches ago**.

| Step | Action | Stopwatch (s) |
| --- | --- | --- |
| 1 | Open `fixtures/corpus/01-long-technical.md` | |
| 2 | Open `fixtures/corpus/02-readme-real-world.md` | |
| 3 | Open `fixtures/corpus/03-ai-plan.md` | |
| 4 | Open `fixtures/corpus/15-prose-volume.md` | |
| 5 | Open `fixtures/corpus/09-gfm-everything.md` (you should be reading this one) | |
| 6 | **Mod+P** — empty query: confirm MRU shows recent documents, newest first | |
| 7 | Find and open **`02-readme-real-world.md`** using **only** the palette (typing allowed; no back/forward keys) | start → stop |
| 8 | Record total seconds for step 7 | |

**Target document:** `02-readme-real-world.md` (second in the open sequence).

**Pass:** step 7 completes in **under 5 s**. **Fail:** 5 s or more, or you needed Mod+[ / Mod+]
instead of the palette — record either outcome in `docs/taste-review/2026-09-review-2/decisions.md`.

## Reference screenshots (marxy)

| State | Capture |
| --- | --- |
| Empty query (MRU / pins) | [palette-empty-dark-960-2x.png](palette-empty-dark-960-2x.png) |
| Typing (document hits) | [palette-typing-dark-960-2x.png](palette-typing-dark-960-2x.png) |
| Headings section (Tab) | [palette-headings-dark-960-2x.png](palette-headings-dark-960-2x.png) |
| Operations stub (`>`) | [palette-operations-dark-960-2x.png](palette-operations-dark-960-2x.png) |
| Source mode on `04-source.rs` | [source-04-source-rs-dark-960-2x.png](source-04-source-rs-dark-960-2x.png) |

## Record outcomes

Write pass/fail, stopwatch time, and any notes to
`docs/taste-review/2026-09-review-2/decisions.md`, then link the decision from
`docs/taste-review/queue.md`. A failure here blocks the Phase 2 release; it does not block
merging individual PRs.
