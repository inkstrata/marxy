// Before/after PNG pair for MARXY-164 taste review on 03-ai-plan.md code fences.
// usage: node docs/taste-review/2026-09-marxy-164/render-pngs.mjs --prefix before|after
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const require = createRequire(fileURLToPath(new URL('../../../apps/desktop/package.json', import.meta.url)));
const { build } = require('vite');
import { openPage, renderCorpus } from '../../../packages/theme/test/page.mjs';

const prefix = process.argv.includes('--prefix') ? process.argv[process.argv.indexOf('--prefix') + 1] : null;
if (prefix !== 'before' && prefix !== 'after') {
  console.error('usage: node docs/taste-review/2026-09-marxy-164/render-pngs.mjs --prefix before|after');
  process.exit(1);
}

const repoRoot = new URL('../../../', import.meta.url).pathname;
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const outDir = new URL('.', import.meta.url);
mkdirSync(outDir, { recursive: true });
const file = '03-ai-plan.md';

function outPath() {
  return new URL(`${prefix}-03-ai-plan-dark-960-2x.png`, outDir);
}

function b64(path) {
  return readFileSync(path).toString('base64');
}

async function scrollToCode(page) {
  const y = await page.evaluate(() => {
    const pre = document.querySelector('#doc pre code[class^="language-"]')?.closest('pre');
    if (!pre) return 0;
    const pad = 48;
    return Math.max(0, Math.round(pre.getBoundingClientRect().top + window.scrollY - pad));
  });
  await page.evaluate((top) => window.scrollTo(0, top), y);
}

async function renderBefore(browser) {
  const html = renderCorpus(file);
  const ctx = await browser.newContext({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 2 });
  const page = await openPage(ctx, html, { variant: 'dark', width: 960, height: 900 });
  await scrollToCode(page);
  await page.screenshot({ path: outPath().pathname, fullPage: false });
  console.log(`wrote ${outPath().pathname.slice(outPath().pathname.indexOf('docs/'))}`);
  await ctx.close();
}

async function boot(page, base, files, argv) {
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
  }, { files, argv });
  await page.waitForFunction(() => document.querySelector('code[data-marxy-done="highlight"] .marxy-tok-string, code[data-marxy-done="highlight"] .marxy-tok-keyword'), { timeout: 15_000 });
}

async function renderAfter(browser) {
  const buildOut = mkdtempSync(join(tmpdir(), 'marxy-taste164-'));
  await build({ root: join(repoRoot, 'apps', 'desktop'), logLevel: 'silent', build: { outDir: buildOut, emptyOutDir: true } });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css', '.png': 'image/png' };
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(buildOut, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const docPath = `/corpus/${file}`;
  const files = { [docPath]: b64(join(corpusDir, file)) };
  try {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await boot(page, base, files, [docPath]);
    await scrollToCode(page);
    await page.screenshot({ path: outPath().pathname, fullPage: false });
    console.log(`wrote ${outPath().pathname.slice(outPath().pathname.indexOf('docs/'))}`);
    await ctx.close();
  } finally {
    server.close();
  }
}

function assertPng() {
  const path = outPath().pathname;
  const bytes = readFileSync(path);
  if (bytes[0] !== 0x89 || bytes.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${path} is not a PNG`);
  createHash('sha256').update(bytes).digest('hex');
}

const browser = await launchWebkit();
try {
  if (prefix === 'before') await renderBefore(browser);
  else await renderAfter(browser);
  assertPng();
} finally {
  await browser.close();
}
