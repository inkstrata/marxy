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

## The app harness entry (MARXY-95)

The headless render entry renders; it has no palette, no notices, no commands, no buffer and no
save. Phase 2–3 behaviour — the palette (MARXY-87), operations (42, 43), trust (44), find and
outline (48), save (49), themes (47) — has to be driven in a browser **through the real app
code**, without Tauri. So the app's startup is split once:

```ts
// apps/desktop/src/app.ts — everything main.ts does today after it has a shell
export async function startApp(shell: AppShell, opts?: { argv?: readonly string[] }): Promise<AppHandle>
// apps/desktop/src/main.ts — shrinks to: startApp(tauriShell)
// apps/desktop/src/harness/app-harness.ts — built to dist/app.html + dist/app.js
window.marxyApp = { start(files: Record<string, string /* base64 */>, argv: string[]): Promise<AppHandle> }
```

`AppShell` is the ADR-0026 `Shell`. The harness passes `createMemoryShell(files)`
(`apps/desktop/src/shell/memory.ts`): an in-memory filesystem keyed by absolute path;
`writeFileAtomic` records every write (path, bytes, order) and applies it; `watch` returns an
emitter the test drives (`handle.shell.emit(events)`); `clipboardWrite`, `openExternal`,
`revealInExternalEditor` and `fetchRemoteImage` record their calls (the last returns a `data:`
PNG); `saveDialog` returns whatever the test queued; `configPaths` returns `/config` and
`/data` inside the same memory filesystem. `AppHandle` exposes `state` (read-only),
`dispatch`, `commands()`, `shell` (the recorder), and `ready` (resolves after first text and
the first idle pass).

Rules: `app.ts` never imports `./shell/tauri.ts` (the boundary test asserts it);
`memory.ts` is test-only and is excluded from the production bundle (the bundle gate greps for
its marker string); the no-network harness can attach to `app.html` exactly as to
`render.html`. The render entry (above) stays the one used by gates that only render.

## Aesthetics gate algorithms (`scripts/gate-aesthetics.mjs`, tier 1)

For each corpus markdown file × width `{ 720, 960, 1280 }` × variant `{ dark, light }` (dark
first, ADR-0024) × body size `{ 14, 17, 21, 24 }` (sizes only at 960 to bound the matrix), in
**Playwright WebKit on both runners**: on macOS it is CoreText (matches WKWebView within ten
weight units, `docs/spike/outcome.md`); on Linux Playwright's WebKit is built from the GTK/WPE
port on FreeType, which is the closest headless stand-in for WebKitGTK. Chromium is used by the
no-network gate only and never for aesthetics.

1. **Grid.** `unit = getComputedStyle(article).lineHeight / 2` (ADR-0030). For every element with
   `data-marxy-s` that is `display: block` (or `table`, `list-item`): `top = rect.top − article.rect.top`;
   assert `Math.abs((top % unit + unit) % unit) ≤ 0.5` or `≥ unit − 0.5`. The reference
   implementation is `offGrid` in `packages/theme/test/grid.test.mjs`.
2. **Measure.** `chWidth` from a probe `<span>0</span>` in the article's font; assert
   the article's content width (`clientWidth` minus inline padding) `/ chWidth ∈ [60, 75]` at every size.
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
    `fixtures/baselines/<engine>/<file>-<width>-<variant>.png` (engine ∈ `webkit-macos`, `webkit-linux`) at threshold 0.1 and ≤ 0.1 %
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
Parse is measured on the gates job: `scripts/measure-parse.mjs` runs on both runner classes
before `pnpm gate:perf` and writes only `results/perf-parse.json` as
`{ "parse_long_technical_ms": <median> }` of `fixtures/corpus/01-long-technical.md`, so
MARXY-59 can keep that metric required. New metrics land the same way: the app emits
`MARK <metric> <ms>` lines for `typeset_viewport`, `live_reload`, `palette_keystroke` (p95
over a scripted session in the headless entry) and `find_first_match`; the harness collects
them into the same JSON.

## Writing a test an implementor cannot get wrong

- Every acceptance criterion in a story maps to exactly one named test or gate assertion; the
  PR's agent-detail table lists the mapping.
- A test that cannot fail is not a test: for each new check, the PR shows one run where it
  fails (a deliberately broken input or a neutralised function), as MARXY-12 did.
- Fixtures are bytes: never generate them at test time from a parser (the golden becomes a
  tautology); commit them.
- Browser tests use the headless render entry for rendering and the app harness entry for
  behaviour, never `apps/desktop/src/main.ts` (which would need Tauri).
