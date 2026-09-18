# 10 — Gates and testing

How each kind of check is written, where it lives, and the algorithms behind the mechanical
aesthetics tier (ADR-0014). Extends what exists: `node:test` with type stripping in packages,
Playwright at the root, `cargo test` in the shell, the perf tiers of ADR-0022.

## The pyramid, per package

| Package | Unit | Property / golden | Browser |
| --- | --- | --- | --- |
| `core` | `node --test` over `src/**/*.test.ts` | `scripts/golden.ts` (AST), `scripts/fidelity.ts` (bytes), the CommonMark suite | none |
| `typeset` | pure parts (`items`, `scheduler`) with `node --test` | rag metrics via `scripts/measure-rag.mjs` | Playwright: apply/revert, hanging, grid |
| `theme` | lint script | — | Playwright: grid by construction |
| `desktop` | `node --test` for `state`, `position`, `keys` | shell-boundary test | Playwright over the headless entry; smoke launch of the binary |
| `src-tauri` | `cargo test` | — | — |

Dependency tests: copy the pattern of `packages/core/src/parse/dependencies.test.ts` into
each package (`dependencies.test.ts` reading its own `package.json` and every `import`
statement under `src/`, asserting the §00 table).

## The headless render entry (MARXY-25)

`apps/desktop/src/render/headless.ts`, built by Vite as a second entry to
`apps/desktop/dist/render.js`. In a Playwright page:

```ts
window.marxyRender(source: string, opts: { theme?: string; variant: 'light' | 'dark'; width: number; size?: number; typeset?: boolean }): Promise<{ removed, stats }>
```

It creates the article, runs the same post-passes as the app with a **stub shell** (`imageSize`
from an in-page decoder over `data:` URLs the harness supplies; no IPC), applies the theme and
tokens, runs the typesetter and grid pass, and resolves when `typeset.ready` and fonts are
done. Fonts are served by the harness from `fonts/` as `data:` URLs. This is the single entry
every browser-side gate uses, so a gate never re-implements rendering.

## Aesthetics gate algorithms (`scripts/gate-aesthetics.mjs`, tier 1)

For each corpus markdown file × width `{ 720, 960, 1280 }` × variant `{ light, dark }` × body
size `{ 14, 17, 21, 24 }` (sizes only at 960 to bound the matrix), in Playwright WebKit on
macOS and Chromium standing in on Linux until a WebKitGTK runner exists:

1. **Grid.** `lineBox = getComputedStyle(article).lineHeight`. For every element with
   `data-marxy-s` that is `display: block` (or `table`, `pre`): `top = rect.top − article.rect.top`;
   assert `Math.abs((top % lineBox + lineBox) % lineBox) ≤ 0.5` or `≥ lineBox − 0.5`.
2. **Measure.** `chWidth` from a probe `<span>0</span>` in the article's font; assert
   `article.clientWidth / chWidth ∈ [60, 75]` at every size.
3. **Contrast.** Relative luminance from computed `color` and `background-color` of `p`,
   `.marxy-caption`, `code`; body ≥ 7:1, secondary ≥ 4.5:1.
4. **Layout shift.** `PerformanceObserver({ type: 'layout-shift', buffered: true })` from
   `marxyRender` start to resolve; assert the sum of `value` is 0.
5. **Rag.** For each `p.marxy-set`: line rectangles via a `Range` per `<br>` interval; compute
   CV of widths and short-line count exactly as `measure-rag.mjs` does; compare with the stored
   baseline JSON (`fixtures/baselines/rag/<file>.json`); fail if CV or short-line rate exceeds
   baseline + 5 %.
6. **Hanging.** For each `.marxy-hang`: `rect.left < paragraph.contentLeft − 0.4 × rect.width`.
7. **Hierarchy.** Every `h1..h6`: `color === article color`, no `border*`, no `background`.
8. **Code voice.** `font-family` of `code` ≠ `p`; x-height ratio: measure `x` glyph height via a
   canvas probe for both faces at the same size; within 5 %.
9. **Chrome at rest.** Every visible element (non-zero rect, not `visibility: hidden`) is a
   descendant of `#marxy-main`.
10. **Screenshot diff.** `page.screenshot({ fullPage: false })` at the viewport (first screen) and
    at the reading position of the last heading; compare with `pixelmatch` (MIT) against
    `fixtures/baselines/<engine>/<file>-<width>-<variant>.png` at threshold 0.1 and ≤ 0.1 %
    differing pixels. Missing baseline → written, and the gate fails with "baseline created;
    add a queue entry" so a first baseline is always a human-visible event.

`MARXY_AESTHETICS_REQUIRED=1` turns the whole tier into hard failures (Phase 1); until then
checks that cannot run print `pending MARXY-25`.

## Golden HTML (added with MARXY-75)

`packages/core/goldens/<file>.html.txt`: the sanitised render of every corpus file, diffed on
every PR like the AST goldens. A renderer change updates them deliberately and the PR says why.

## Perf (ADR-0022, as landed)

`scripts/measure-startup.mjs` writes `results/perf.json` with `cold_start_first_text_ms`
(launch 1) and `warm_start_first_text_ms` (median of 2..N); `gate-perf.mjs` applies the tier.
New metrics land the same way: the app emits `MARK <metric> <ms>` lines for `typeset_viewport`,
`live_reload`, `palette_keystroke` (p95 over a scripted session in the headless entry) and
`find_first_match`; the harness collects them into the same JSON.

## Writing a test an implementor cannot get wrong

- Every acceptance criterion in a story maps to exactly one named test or gate assertion; the
  PR's agent-detail table lists the mapping.
- A test that cannot fail is not a test: for each new check, the PR shows one run where it
  fails (a deliberately broken input or a neutralised function), as MARXY-12 did.
- Fixtures are bytes: never generate them at test time from a parser (the golden becomes a
  tautology); commit them.
- Browser tests use the headless entry, never `apps/desktop/src/main.ts`.
