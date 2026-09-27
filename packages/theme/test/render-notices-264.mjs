// Before/after screenshots for the notice/dismiss banner, which had zero CSS (MARXY-264).
// Drives the real notice DOM (apps/desktop/src/notices) with the real theme stylesheet, never a
// hand-built approximation. usage: node --experimental-strip-types packages/theme/test/render-notices-264.mjs --prefix before|after
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { renderSafeHtml } from '../../core/src/render/pipeline.ts';
import { blockedImageNoticeText } from '../../core/src/render/images.ts';
import { DISK_CHANGED_EDITS_KEPT } from '../../../apps/desktop/src/notices/disk.ts';
import { facesCss, css } from './page.mjs';

const prefix = process.argv.includes('--prefix') ? process.argv[process.argv.indexOf('--prefix') + 1] : null;
if (prefix !== 'before' && prefix !== 'after') {
  console.error('usage: node --experimental-strip-types packages/theme/test/render-notices-264.mjs --prefix before|after');
  process.exit(1);
}

const repoRoot = new URL('../../../', import.meta.url);
const out = new URL('../../../docs/taste-review/2026-09-marxy-264/', import.meta.url);
mkdirSync(out, { recursive: true });

// The real notice module, type-stripped and dropped into the page unchanged: the same technique
// packages/theme/test/grid.test.mjs uses for the typesetter's grid pass. No behaviour is written
// here twice — this loads apps/desktop/src/notices/index.ts itself.
const noticesSrc = stripTypeScriptTypes(
  readFileSync(new URL('apps/desktop/src/notices/index.ts', repoRoot), 'utf8'),
).replace(/^export /gm, '');

function outPath(name) {
  return new URL(`${prefix}-${name}-dark-960-2x.png`, out);
}

async function pageWithNotice(browser, articleHtml) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 420 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(
    `<!doctype html><html lang="en" data-marxy-variant="dark"><head><meta charset="utf-8">` +
      `<style>${facesCss()}${css}#marxy-notices:empty{display:none}</style></head>` +
      `<body data-marxy-mode="rendered" data-marxy-variant="dark">` +
      `<main id="marxy-main"><div id="marxy-notices" role="status"></div>` +
      `<article id="doc" class="marxy-article">${articleHtml}</article></main></body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: noticesSrc });
  return { ctx, page };
}

async function renderBlocked(browser) {
  const { html, blockedImages } = renderSafeHtml(
    readFileSync(new URL('fixtures/corpus/10-hostile.md', repoRoot)),
    { file: '10-hostile.md' },
  );
  const text = blockedImageNoticeText(blockedImages);
  const { ctx, page } = await pageWithNotice(browser, html);
  await page.evaluate((t) => {
    notify({ kind: 'blocked', text: t });
  }, text);
  const dest = outPath('blocked-10-hostile');
  await page.screenshot({ path: dest.pathname, fullPage: false });
  console.log(`wrote ${dest.pathname.slice(dest.pathname.indexOf('docs/'))}`);
  await ctx.close();
}

async function renderInfo(browser) {
  const { html } = renderSafeHtml(
    readFileSync(new URL('fixtures/corpus/02-readme-real-world.md', repoRoot)),
    { file: '02-readme-real-world.md' },
  );
  const { ctx, page } = await pageWithNotice(browser, html);
  await page.evaluate((t) => {
    notify({ kind: 'info', text: t });
  }, DISK_CHANGED_EDITS_KEPT);
  const dest = outPath('info-generic');
  await page.screenshot({ path: dest.pathname, fullPage: false });
  console.log(`wrote ${dest.pathname.slice(dest.pathname.indexOf('docs/'))}`);
  await ctx.close();
}

function assertPngArtifacts() {
  const names = ['blocked-10-hostile', 'info-generic'];
  const digests = new Set();
  for (const name of names) {
    const path = outPath(name).pathname;
    const bytes = readFileSync(path);
    if (bytes[0] !== 0x89 || bytes.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${path} is not a PNG`);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digests.has(digest)) throw new Error(`${path} is byte-identical to another PNG in this prefix`);
    digests.add(digest);
  }
}

const browser = await launchWebkit();
try {
  await renderBlocked(browser);
  await renderInfo(browser);
  assertPngArtifacts();
} finally {
  await browser.close();
}
