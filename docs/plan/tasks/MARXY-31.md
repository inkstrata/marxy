---
key: MARXY-31
design: []
depends: [MARXY-138, MARXY-27, MARXY-30]
verify: [pnpm precheck, pnpm done MARXY-31]
---
# MARXY-31 — Taste review #1 artifact: blind side-by-side against Typora and Marked 2

**Design:** `docs/aesthetics-acceptance.md` tier 2 · **Depends on:** MARXY-30, MARXY-26, MARXY-27. **Human-gated** for the competitor captures.

## Do this
1. `scripts/taste-review/review-1.mjs`: renders `01-long-technical.md`, `02-readme-real-world.md`, `03-ai-plan.md` through the headless entry at 68 ch, 17 px, light, 2× — first screen and "fourth page" (scrolled to 70 %) — into `docs/taste-review/review-1/marxy/`.
2. A `needs-human.md` entry asking for the same three documents captured in Typora and Marked 2 at the same width into `docs/taste-review/review-1/{typora,marked}/`, and a `manifest.json` template that labels the three sets A/B/C at random (the script shuffles and records the key in `manifest.key.json`, which the reviewer opens only after ranking).
3. `docs/taste-review/review-1/README.md`: the ranking form (tier 2 items 1–3) with the pass criteria.

## Acceptance → check
The Marxy captures exist and are byte-identical across two runs; the manifest and form exist; the queue has the entry.
