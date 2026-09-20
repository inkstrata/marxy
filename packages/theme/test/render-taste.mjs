// Renders the five MARXY-20 corpus pages in dark and light at 960 px, 2×, for the
// MARXY-128 taste-review pair. usage: node packages/theme/test/render-taste.mjs --prefix before|after
import { mkdirSync } from 'node:fs';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { facesCss, css, renderCorpus } from './page.mjs';

const PAGES = [
  '01-long-technical.md',
  '02-readme-real-world.md',
  '03-ai-plan.md',
  '09-gfm-everything.md',
  '15-prose-volume.md',
];
const prefix = process.argv.includes('--prefix') ? process.argv[process.argv.indexOf('--prefix') + 1] : 'after';
const out = new URL('../../../docs/taste-review/2026-09-marxy-128/', import.meta.url);
mkdirSync(out, { recursive: true });

const browser = await launchWebkit();
for (const variant of ['dark', 'light']) {
  for (const file of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const html = renderCorpus(file);
    await page.setContent(
      `<!doctype html><html lang="en" data-marxy-variant="${variant}"><head><meta charset="utf-8">` +
        `<style>${facesCss()}${css}</style></head>` +
        `<body><article class="marxy-article" id="doc">${html}</article></body></html>`,
    );
    await page.evaluate(() => document.fonts.ready);
    const slug = file.replace(/\.md$/, '');
    const dest = new URL(`${prefix}-${variant}-${slug}.png`, out);
    await page.screenshot({ path: dest.pathname, fullPage: false });
    await ctx.close();
    console.log(`wrote ${dest.pathname.slice(dest.pathname.indexOf('docs/'))}`);
  }
}
await browser.close();
