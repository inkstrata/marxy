# Human capture needed — review #1 competitors

This cloud environment has **no Typora or Marked 2**. marxy captures are committed under `marxy/`.
Please add matching captures before the blind review.

## Capture spec (match marxy)

| Setting | Value |
| --- | --- |
| Documents | `fixtures/corpus/01-long-technical.md`, `02-readme-real-world.md`, `03-ai-plan.md` |
| Column width | **68 `ch`** (same effective measure as marxy) |
| Body size | **17 px** |
| Theme | **Light** |
| Scale | **2×** (Retina / equivalent sharp capture) |
| Viewport | **960×900** px content area where possible |
| Shots | **First screen** and **~70% scroll** for each document (same scroll fraction as marxy) |

## Where to put files

Use the same filenames as `marxy/`:

```
docs/taste-review/review-1/typora/<slug>-first-light-960-2x.png
docs/taste-review/review-1/typora/<slug>-scroll70-light-960-2x.png
docs/taste-review/review-1/marked/<slug>-first-light-960-2x.png
docs/taste-review/review-1/marked/<slug>-scroll70-light-960-2x.png
```

(`<slug>` is `01-long-technical`, `02-readme-real-world`, or `03-ai-plan`.)

## After captures land

```bash
node docs/taste-review/review-1/shuffle-manifest.mjs
```

That refreshes `manifest.json`, writes a new `manifest.key.json`, and copies PNGs into `blind/` with
labels **A/B/C**. Then follow `README.md` in this folder.

Do **not** commit fake competitor screenshots; empty `typora/` and `marked/` until real captures exist.
