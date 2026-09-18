# MARXY-25 — Headless render entry and the full mechanical aesthetics gate

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · **Depends on:** MARXY-20, MARXY-23.

## Do this, in order
1. `apps/desktop/src/render/headless.ts` exporting `window.marxyRender` as in §10; a stub shell in `apps/desktop/src/shell/stub.ts` implementing `imageSize` via an in-page `Image` decode of a `data:` URL, `assetUrl` as identity, everything else rejecting with `unsupported`.
2. `vite.config.ts`: second entry `render` → `dist/render.js` (library mode, IIFE, no code splitting) plus `dist/render.html` that loads it and the inlined styles.
3. `scripts/gate-aesthetics.mjs`: replace the token-only checks with the ten checks of §10 over the corpus × widths × variants (dark first) × sizes matrix, in Playwright WebKit on both runners (§10); baselines under `fixtures/baselines/rag/` and `fixtures/baselines/<engine>/`; `--update` writes baselines and exits non-zero with the "add a queue entry" message.
4. `.github/workflows/ci.yml`: set `MARXY_AESTHETICS_REQUIRED=1`.
5. Commit the baselines; add the queue entry.

## Tests
The gate itself, plus `scripts/gate-aesthetics.selftest.mjs`: each check fails on a crafted page (a heading 3 px off grid, a 90 ch measure, a 3:1 contrast, a paragraph with a forced short line, a `<mark>` outside `#marxy-main`).

## Do not
Import `apps/desktop/src/main.ts` from the headless entry. Weaken any threshold.
