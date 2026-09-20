// Renders review #0 passages 2 (inline code) and 4 (heading stack) at 1× and 2× for MARXY-129.
// usage: node packages/theme/test/render-taste129.mjs --prefix before|after
import { mkdirSync } from 'node:fs';
import { webkit } from 'playwright';
import { css, facesCss, renderCorpus } from './page.mjs';

const prefix = process.argv.includes('--prefix') ? process.argv[process.argv.indexOf('--prefix') + 1] : 'after';
const out = new URL('../../../docs/taste-review/2026-09-marxy-129/', import.meta.url);
mkdirSync(out, { recursive: true });

const BEFORE =
  ':root{--marxy-size-code:14px;--marxy-line-box-code:22px;--marxy-weight-heading:600}' +
  'code{font-size:0.875em!important}a code{font-size:0.875em!important}' +
  '.marxy-article>ol{list-style:revert;counter-reset:revert}.marxy-article>ol>li{counter-increment:revert}' +
  '.marxy-article>ol>li::before{content:none!important}';

const PAGES = [
  { id: 'p2-inline-code', anchor: 'p2-inline-code' },
  { id: 'p4-heading-stack', anchor: 'p4-heading-stack' },
];

function anchorOffset(id) {
  const pad = 56;
  const blocks = [...document.querySelectorAll('article > *')];
  const describe = (el) => ({ tag: el.tagName.toLowerCase(), block: blocks.indexOf(el), text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) });
  const at = (el) => ({ y: Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - pad)), anchor: describe(el) });
  if (id === 'p2-inline-code') return at(blocks.find((el) => el.matches('p') && el.querySelector('code')));
  if (id === 'p4-heading-stack') return at(blocks.find((el) => el.matches('h3')));
  throw new Error(`unknown passage ${id}`);
}

const browser = await webkit.launch();
const html = renderCorpus('01-long-technical.md');
for (const dpr of [1, 2]) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const tune = prefix === 'before' ? BEFORE : '';
  await page.setContent(
    `<!doctype html><html lang="en" data-marxy-variant="dark"><head><meta charset="utf-8">` +
      `<style>${facesCss()}${css}${tune}</style></head>` +
      `<body><article class="marxy-article" id="doc">${html}</article></body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  for (const p of PAGES) {
    const { y } = await page.evaluate(anchorOffset, p.anchor);
    await page.evaluate((top) => window.scrollTo(0, top), y);
    const dest = new URL(`${prefix}-${p.id}-${dpr}x.png`, out);
    await page.screenshot({ path: dest.pathname, fullPage: false });
    console.log(`wrote ${dest.pathname.slice(dest.pathname.indexOf('docs/'))}`);
  }
  await ctx.close();
}
await browser.close();
