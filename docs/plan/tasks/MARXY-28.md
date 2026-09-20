---
key: MARXY-28
design: [02-render]
depends: [MARXY-61, MARXY-20, MARXY-138]
verify: [pnpm precheck, pnpm done MARXY-28]
---
# MARXY-28 — KaTeX on first use, on the grid

**Design:** [02-render](../../design/02-render.md) post-pass 6, D-A12 · **Depends on:** MARXY-61, MARXY-20.

## Do this
1. Renderer (core): `mathBlock` → `<pre class="marxy-math">`, `mathInline` → `<code class="marxy-math-inline">` with escaped TeX source (adjust `render-html.ts`; update goldens with a queue entry).
2. `apps/desktop/src/render/math.ts`: if the article contains `.marxy-math, .marxy-math-inline`, `await import('katex')` and `katex.render(src, el, { throwOnError: false, output: 'html', displayMode: isBlock })`; inject `katex.min.css` once; KaTeX fonts copied into the bundle (OFL, licences into `THIRD_PARTY_NOTICES.md`); `font-src` already allows `'self'`.
3. Reserve block height before render: `style.minHeight = lines × lineBox` from the source's line count; after render, `snapToGrid` on the element.

## Tests
`06-math.md`: KaTeX not loaded for `02-readme-real-world.md` (no request for the chunk — assert via the bundle's chunk list and a Playwright request log); display blocks occupy integer line boxes after render; inline math baseline within 1 px of the surrounding text baseline; screenshot baseline for `06-math.md` with a queue entry.
