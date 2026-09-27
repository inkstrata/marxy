// Renders before/after screenshots for the MARXY-263 taste-review row: the top padding drop
// (3lb -> half a line) and the side gutter reconciled with the reader-typography research's
// minimum-gutter rule (16px narrow, 24px larger, was a flat 3rem). "Before" reads base.css from
// the pre-change commit (HEAD); "after" reads the working tree. usage: node
// packages/theme/test/render-taste263.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { facesCss, renderCorpus } from './page.mjs';

const root = new URL('../../../', import.meta.url);
const out = new URL('docs/taste-review/2026-09-marxy-263/', root);
mkdirSync(out, { recursive: true });

const read = (rel) => execFileSync('git', ['show', `HEAD:${rel}`], { cwd: root.pathname, encoding: 'utf8' });
const beforeTheme = [read('packages/theme/src/tokens.css'), read('packages/theme/src/base.css'), read('packages/theme/default/theme.css').replace(/^@import url\("\.\.\/src\/tokens\.css"\);\s*$/m, '')].join(
  '\n',
);
const { defaultThemeCss } = await import('../scripts/inline.mjs');
const afterTheme = defaultThemeCss();

async function shoot(browser, { theme, prefix, file, width, height = 900 }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const html = renderCorpus(file);
  await page.setContent(
    `<!doctype html><html lang="en" data-marxy-variant="dark"><head><meta charset="utf-8">` +
      `<style>${facesCss()}${theme}</style></head>` +
      `<body><article class="marxy-article" id="doc">${html}</article></body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  const slug = file.replace(/\.md$/, '');
  const dest = new URL(`${prefix}-${slug}-dark-${width}-2x.png`, out);
  await page.screenshot({ path: dest.pathname, fullPage: false });
  await ctx.close();
  console.log(`wrote ${dest.pathname.slice(dest.pathname.indexOf('docs/'))}`);
}

const browser = await launchWebkit();
for (const [prefix, theme] of [['before', beforeTheme], ['after', afterTheme]]) {
  // The top padding: a wide window so the first line's distance from the top is the whole story.
  await shoot(browser, { theme, prefix, file: '01-long-technical.md', width: 960 });
  // The side gutter at a phone width, where the padding is the whole visible margin.
  await shoot(browser, { theme, prefix, file: '02-readme-real-world.md', width: 380, height: 800 });
}
await browser.close();
