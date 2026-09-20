// Shared Playwright page for theme taste checks: the inlined default stylesheet, vendored faces,
// and the same grid pass the app runs (MARXY-128).
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { renderSafeHtml } from '../../core/src/render/pipeline.ts';
import { defaultThemeCss } from '../scripts/inline.mjs';

const root = new URL('../../../', import.meta.url);
export const css = defaultThemeCss();
const grid = stripTypeScriptTypes(readFileSync(new URL('packages/typeset/src/grid.ts', root), 'utf8')).replace(
  /^export /gm,
  '',
);

const FACES = [
  { family: 'Literata', file: 'fonts/literata/Literata[opsz,wght].ttf', style: 'normal', weight: '200 900' },
  { family: 'Literata', file: 'fonts/literata/Literata-Italic[opsz,wght].ttf', style: 'italic', weight: '200 900' },
  { family: 'JetBrains Mono', file: 'fonts/jetbrains-mono/JetBrainsMono[wght].ttf', style: 'normal', weight: '100 800' },
];

/** `@font-face` rules with the vendored files inlined, so a test page never fetches. */
export function facesCss() {
  return FACES.map((face) => {
    const data = readFileSync(new URL(face.file, root)).toString('base64');
    return `@font-face{font-family:"${face.family}";font-style:${face.style};font-weight:${face.weight};font-display:block;src:url(data:font/ttf;base64,${data}) format("truetype")}`;
  }).join('\n');
}

export function renderMarkdown(source, file = 't.md') {
  return renderSafeHtml(source, { file }).html;
}

export function renderCorpus(file) {
  return renderSafeHtml(readFileSync(new URL(`fixtures/corpus/${file}`, root)), { file }).html;
}

/**
 * A page of rendered markdown in the default theme. Fonts are inlined so italic resolves to
 * Literata's real italic, not a synthetic slant.
 */
export async function openPage(browser, html, { width = 960, variant = 'dark', snap = true, height = 900, extraCss = '' } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(
    `<!doctype html><html lang="en" data-marxy-variant="${variant}"><head><meta charset="utf-8">` +
      `<style>${facesCss()}${css}${extraCss}</style></head>` +
      `<body><article class="marxy-article" id="doc">${html}</article></body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: `${grid}\nwindow.snapToGrid = snapToGrid;` });
  if (snap) {
    await page.evaluate(() => {
      const article = document.getElementById('doc');
      window.snapToGrid(article, parseFloat(getComputedStyle(article).lineHeight));
    });
  }
  return page;
}

/** WCAG relative luminance of an `rgb()` triple, same formula as scripts/gate-aesthetics.mjs. */
export function luminance([r, g, b]) {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export function onGrid(px, unit) {
  const r = ((px % unit) + unit) % unit;
  return r <= 0.5 || unit - r <= 0.5;
}
