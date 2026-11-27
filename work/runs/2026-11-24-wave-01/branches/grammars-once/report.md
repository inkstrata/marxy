# grammars-once: builder's report

Saved by the orchestrator from the builder's final message (subagents cannot write report files themselves). Sonnet builder, 24 November 2026.

Branch `agent/grammars-once`, tip `d10fa885`, cut from `17cfe661`. `pnpm verify --tier changed` passed 11/11 on that tip.

## Commits

- `c908352d` perf(render): ship KaTeX's woff2 fonts only
- `98c025a0` perf(highlight): ship each grammar once, in the worker's bundle alone
- `d10fa885` test(render): maths draws from woff2 faces alone

## For the reader

Nothing visible changes. If the highlight worker cannot start, code stays plain lines and one warning is logged; before, the page coloured it itself.

## How

- Core: `languages.generated.ts` is now names only and a new `grammar-loaders.generated.ts` holds the lazy imports (the generator writes both). `line-cap.ts` is new and `grammar.ts` is new: it holds `highlight`, `grammarTokens` and re-exports `index.ts`, and only the worker, `session.ts` and Node tests import it. `highlight/index.ts` no longer reaches Shiki or the loaders.
- `render/highlight.ts` lost its on-page tokenizer and local `RunSession`.
- `math.ts` globs woff2 only and cuts the woff/ttf fallbacks from the stylesheet.
- `gate-highlight-bundle.mjs` exports `grammarProblems`. It fails if a chunk that defines a grammar is reachable from any page (static or dynamic imports), or if a grammar is defined by two chunks.

## Measured (`build:web`, `dist/assets/*.js`)

| | Before | After |
| --- | --- | --- |
| Files | 883 | 591 |
| Bytes | 22,000,766 | 14,088,457 |
| Names appearing twice | 278 | 6, none of them grammars |
| Grammar scopes defined twice | (502 gate problems on the old shape) | 0 |
| KaTeX fonts | 19 woff2 + 20 woff + 20 ttf, 1,072,948 B | 19 woff2, 256,168 B |
| Entry chunk | 1,383,684 B | 1,377,190 B |

## Tests

- Verify: core 4316 pass, scripts 248, desktop 1319, browser 664 (3 skipped); log `C:\Dev\reader\work\wave1\grammars-once-verify.log`.
- New: `scripts/gate-highlight-bundle.test.mjs` (5), `apps/desktop/test/highlight-no-worker.test.mjs` (2, WebKit, both ways a worker can fail), `apps/desktop/test/math-fonts.test.mjs` (1, WebKit). The two browser files are in `scripts/verify-map.json`.
- Colour in Read and Source still passes: `highlight`, `elided-note`, `source-browser`, `source-looks`, `release-csp`, `math-block-grid`, and the core highlight tests.

## Revert-and-fail

- No-worker test: base `highlight.ts`, worker, `index.ts`, `highlighter.ts`, `languages.generated.ts` and `session.ts` restored. Both cases fail ("no span carries a token role").
- Gate: a build of that old shape gives 502 problems.
- Math-fonts test: base `math.ts` restored; it fails on the woff and ttf sources.
- All restored afterwards; tree is clean.

## Calls and gaps

- Nothing relied on the on-page colour path, so no harness-supplied colourer was added.
- Maths was checked in WebKit only; Chromium was not run.
- `check:tauri` and the exe were not run, per the rules.
- Docs updated: `architecture.md`, `file-kinds.md`, `scripts/README.md`.
- Scratch files are in `C:\Dev\reader\work\wave1\grammars-once\`.

## Orchestrator's notes for the reviewer

- The shipped app runs in Chromium (WebView2) and maths was checked only in WebKit. Draw a page with inline and display maths in headless Edge (the `shots` tool does this) on the branch and on master and compare: every glyph present, no fallback face. `math.ts` now edits KaTeX's stylesheet to drop the woff and ttf sources: read exactly how, and what happens when KaTeX is upgraded and its stylesheet changes shape.
- The licence and font gates: `pnpm gate:licences`, `scripts/gate-font-attrs.mjs`, and the third-party notices that list KaTeX's fonts. Do they still describe what ships?
- The behaviour when the worker cannot start changed from "the page colours it" to "plain lines and a warning". In the shipped app that should never happen; confirm the release CSP still lets the worker start (`release-csp` test passes per the report) and that `check:tauri` has a case that sees coloured code in the real window, so a build where the worker silently fails would be caught at integration. If it has none, say so for the integrator.
- Six chunk names still appear twice. Name them and say why (shared helpers between the page and the worker are expected; a second copy of something large is not).
- The entry chunk barely moved (1,383,684 to 1,377,190 B), as expected: the grammars were lazy chunks. The gain is the size on disk and in the exe.
