// Renders the four MARXY-130 format samples dark at 960 px and 2× for the taste queue.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderSafeHtml } from '../../../packages/core/src/render/index.ts';
import { defaultThemeCss } from '../../../packages/theme/scripts/inline.mjs';

const here = new URL('.', import.meta.url);
const root = new URL('../../../', import.meta.url);
export const FILES = [
  '16-api-reference.md',
  '17-changelog.md',
  '18-agent-transcript.md',
  '19-source-file.md',
];
export const WIDTH = 960;
export const HEIGHT = 800;
export const DPR = 2;
export const VARIANT = 'dark';

const faces = [
  { family: 'Literata', file: 'fonts/literata/Literata[opsz,wght].ttf', weight: '200 900', style: 'normal' },
  { family: 'Literata', file: 'fonts/literata/Literata-Italic[opsz,wght].ttf', weight: '200 900', style: 'italic' },
  { family: 'JetBrains Mono', file: 'fonts/jetbrains-mono/JetBrainsMono[wght].ttf', weight: '100 800', style: 'normal' },
];

function fontFaceCss() {
  return faces.map((f) => {
    const b64 = readFileSync(new URL(f.file, root)).toString('base64');
    return `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};font-display:block;src:url(data:font/ttf;base64,${b64}) format("truetype")}`;
  }).join('\n');
}

export function pngName(file) {
  return file.replace(/\.md$/, `-${VARIANT}-${WIDTH}-${DPR}x.png`);
}

const css = `${fontFaceCss()}\n${defaultThemeCss()}`;

const browser = await chromium.launch();
mkdirSync(fileURLToPath(here), { recursive: true });
try {
  for (const file of FILES) {
    const src = readFileSync(new URL(`fixtures/corpus/${file}`, root));
    const html = renderSafeHtml(src, { file }).html;
    const ctx = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: DPR,
      offline: true,
    });
    await ctx.route('**/*', (route) => {
      const url = route.request().url();
      if (/^(https?|ws|wss):/i.test(url)) return route.abort();
      return route.continue();
    });
    const page = await ctx.newPage();
    await page.setContent(
      `<!doctype html><html lang="en" data-marxy-variant="${VARIANT}"><head><meta charset="utf-8"><style>${css}</style></head>`
        + `<body><article class="marxy-article" id="doc">${html}</article></body></html>`,
      { waitUntil: 'load' },
    );
    await page.evaluate(() => document.fonts.ready);
    const out = pngName(file);
    const dest = fileURLToPath(new URL(out, here));
    await page.screenshot({ path: dest, fullPage: false });
    console.log(`wrote ${out} (${statSync(dest).size} bytes)`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
