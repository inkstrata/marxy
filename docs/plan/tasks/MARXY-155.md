---
key: MARXY-155
design: [02-render, 06-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-155]
---
# MARXY-155 — real before/after PNGs for MARXY-138's taste-review row

**Design:** [02-render](../../design/02-render.md) post-passes 3 and 4, [06-shell](../../design/06-shell.md) §Asset protocol and image scoping · **Depends on:** nothing — MARXY-138 is Done on `main`.

**Outcome.** `docs/taste-review/queue.md` and `docs/plan/jira-issues.csv`'s MARXY-138 row both claim a
`docs/taste-review/2026-09-marxy-138/` directory of real before/after PNGs exists. It does not — PR #115
merged (`9c4e36a`) without ever adding it (`orchestration/needs-human.md`, 2026-09-20: "AC11 taste PNGs
were never in the tree... a later story must add the shots. Do not reopen #115."). This story renders and
commits the four PNGs the row already promises. MARXY-138 stays Done; PR #115 stays closed/merged; this
is a new, independent PR.

## Why this story exists in this shape
Two returns on PR #115 (`docs/plan/deltas/2026-09-20-marxy-138-paths.md`,
`docs/plan/deltas/2026-09-20-marxy-138-taste.md`) fought over the *path* for this directory and the wording
of AC11, and both were fixed by landing stories (MARXY-152, MARXY-154). Attempt 3 never happened — the
story merged anyway with the path and wording both correct but the PNGs themselves never rendered. This
is not a defect in MARXY-138's feature (images and notices both work; the four other criteria depending on
them were independently verified in review); it is a missing artifact, closed out on its own PR rather than
by reopening a merged one.

## Files and signatures
- `apps/desktop/test/render-taste138.mjs` — a render script, **not** a test (the filename does not end in
  `.test.mjs`, so `apps/desktop/package.json`'s `test/**/*.test.mjs` glob does not pick it up). Usage:
  `node apps/desktop/test/render-taste138.mjs --prefix before|after`. Both prefixes render
  `09-gfm-everything.md` and `10-hostile.md` at viewport 960×900, `data-marxy-variant="dark"`,
  `deviceScaleFactor: 2`, via `scripts/playwright-webkit.mjs`'s `launchWebkit()` (MARXY-149; headless by
  default, so this never flashes a window).
  - `--prefix before`: render through **core's pipeline only**, the pre-138 shape — no image sizing, no
    notices region. Reuse `packages/theme/test/page.mjs`'s `renderCorpus(file)` and `openPage(browser, html,
    { variant: 'dark', width: 960, height: 900 })` exactly as `packages/theme/test/render-taste129.mjs`
    does; take the page's own `screenshot({ path, fullPage: false })`.
  - `--prefix after`: render through **the real app**, the same way `apps/desktop/test/images.test.mjs`'s
    `boot()` does: `vite build` the app once (`outDir` a temp dir), serve it with a small `http.createServer`,
    `page.goto('.../app.html')`, `await page.evaluate(() => typeof window.marxyApp?.start === 'function')`,
    then `await window.marxyApp.start([...], argv)` and `await handle.ready` before screenshotting, so
    post-passes 3 (image box) and 4 (blocked-content notice) have both run.
  - Output file names: `{prefix}-09-gfm-everything-dark-960-2x.png`, `{prefix}-10-hostile-dark-960-2x.png`,
    written into `docs/taste-review/2026-09-marxy-138/` (created if missing).
- `docs/taste-review/2026-09-marxy-138/` — the four PNGs: `before-09-gfm-everything-dark-960-2x.png`,
  `after-09-gfm-everything-dark-960-2x.png`, `before-10-hostile-dark-960-2x.png`,
  `after-10-hostile-dark-960-2x.png`.
- `docs/taste-review/queue.md` — one new entry, same shape as the `2026-09-marxy-128` and
  `2026-09-marxy-129` entries: what changed (images get a reserved box and load locally; blocked remote
  hosts get one notice line), the four PNGs linked, and a sentence naming this as the retroactive artifact
  for MARXY-138's merged AC11 and this story's own key.
- `CHANGELOG.md` — one line.

## Do this, in order
1. Write `render-taste138.mjs`'s `before` path first (it is the simpler of the two, and matches
   `render-taste129.mjs`'s existing pattern almost exactly). Run it, confirm the two PNGs exist and look
   like the corpus files rendered plainly (broken/unstyled image marker for `09-gfm-everything.md`, no
   notice line for `10-hostile.md`).
2. Write the `after` path using `images.test.mjs`'s `boot()` as the reference implementation (same vite
   build + static server + `window.marxyApp.start` pattern) rather than re-deriving it. Run it, confirm the
   image is boxed and sized in `09-gfm-everything.md`'s PNG and the notice line naming `example.invalid`
   appears above the article in `10-hostile.md`'s PNG.
3. Add the `docs/taste-review/queue.md` row and the `CHANGELOG.md` line.
4. `pnpm precheck`, `pnpm done MARXY-155` (or the resolved key `jira.mjs sync` assigns).

## Tests → expected
| Check | Expect |
| --- | --- |
| `node apps/desktop/test/render-taste138.mjs --prefix before` | writes two PNGs; process exits 0 |
| `node apps/desktop/test/render-taste138.mjs --prefix after` | writes two PNGs; process exits 0 |
| the four PNGs | four distinct byte sequences (no two identical); each opens as a valid PNG |
| the `after` image PNG vs the `before` image PNG | visibly different (a sized image box vs. a broken/unstyled marker) |
| the `after` hostile PNG vs the `before` hostile PNG | visibly different (one notice line present vs. absent) |
| `docs/taste-review/queue.md` | new entry present, linking all four PNGs, naming PR #115 and this story |
| `git diff -- apps/desktop/src, packages/, fixtures/baselines, docs/plan/jira-issues.csv` | empty |

## Acceptance → check
The seven criteria on the CSV row map onto the table above in order.

## Do not
Reopen PR #115 or comment on it claiming it is now complete. Touch anything under `apps/desktop/src/` or
`packages/`. Seed a `fixtures/baselines` entry — that is MARXY-30's job, not this one's; a `gate:aesthetics`
pixel baseline seeded here with no consumer would be dead weight. Touch `docs/plan/jira-issues.csv`. Rename
or remove `docs/taste-review/2026-09-marxy-138/`'s existing shape from what MARXY-128/129 established.
Put anything under `docs/taste-review/` outside `2026-09-marxy-138/` and `queue.md`.
