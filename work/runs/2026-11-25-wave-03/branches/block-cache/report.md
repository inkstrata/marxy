# block-cache: builder report (Sonnet)

Branch `agent/block-cache` (base `84a815dd`). Verify turn 11/11, browser 488 pass, unit-desktop 1256 (`work\wave3\block-cache-verify.log`). The first verify run failed on a parameter property (node strip-only) and an innerHTML assignment in the test; both fixed in the second commit.

## Commits

- `338ad9de` perf(render): keep drawn code, formulas and diagrams by text so a second render paints at once
- `891d47b4` fix(render): cache class without parameter properties; test builds nodes without innerHTML

## What changed

- New shared module `render/block-cache.ts`: bounded LRU stores of strings and token data only.
- Tokens: the cache sits in `tokenize` and `applyHighlightToCode`; on a hit Read paints colour in its first write. A worker reply is stored; null replies are not (dropped or failed jobs also answer null). Source's per-plugin 256-entry cache is gone; Source and Read share one store.
- KaTeX: cached markup keyed by display mode and source. Diagrams: cached SVG keyed by face and source, with a stand-in id prefix swapped per drawing.
- Docs: `docs/architecture.md`. Test `block-cache.test.mjs` in `scripts/verify-map.json`.
- `rendered-view.ts` and `store.ts` untouched.

## Theme

Tokens carry scope names and colour; KaTeX spacing and diagram ink are CSS; no key or clear needed. The test sets `--marxy-tok-keyword` on a cache-built page and the colour follows. Diagram widths depend on the chrome face, so the face is in the diagram key.

## Bounds

Tokens 512 entries, 1.5M chars; formulas 1024 entries, 1M chars; diagrams 64 entries, 1M chars. An entry over a quarter of the char bound is not kept.

## Measured (long-reference, headless Edge; scratch `posts.mjs` in the session scratchpad)

- Code posts after opening and scrolling past every fence: 70. Tab away and back: 0 (same on master: tabs keep the page). Close tab and reopen in the same session: 2 with the cache, 143 with it disabled.
- `measure-interactions` records `plan\records\block-cache-after.json` (also `-after-2.json`, `-nocache-control.json`): all three 1.3-2.5x slower than the wave 2 baseline, including with the cache off: machine load. Timings not readable as gain or regression.

## Revert-and-fail

With lookups disabled, the code test fails (20 posts on the second render) and the formula test fails (planted markup not used). The diagram test fails when only the diagram lookup is disabled.

## Not done

- Unknown-language fences (null reply) not cached: still post each render.
- Cache lives within a page load; an app relaunch gains nothing.
- Earlier verify noise (a 3.4 s frame in `progressive-large`, an EPERM in `perf-record`) did not recur.

## Orchestrator notes

- Checked: two commits, tree clean, verify 11/11 exit 0 (16:24).
- For the reviewer: cached KaTeX markup and diagram SVG are inserted as markup: they must still pass the one sanitiser on the way in (a cache must not become a path around it). Diagram ids rewritten per drawing must not collide when the same diagram appears twice on a page. Trust: a page whose trust grant changes must not get cached output drawn under the other grant. Merge seam: `splice-all` also relies on `data-marxy-done` skips in highlight and math.
