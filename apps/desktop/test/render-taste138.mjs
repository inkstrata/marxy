// Renders MARXY-138 taste-review before/after PNGs for 09-gfm-everything.md and 10-hostile.md.
// usage: node apps/desktop/test/render-taste138.mjs --prefix before|after
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { openPage, renderCorpus } from '../../../packages/theme/test/page.mjs';

const prefix = process.argv.includes('--prefix') ? process.argv[process.argv.indexOf('--prefix') + 1] : null;
if (prefix !== 'before' && prefix !== 'after') {
  console.error('usage: node apps/desktop/test/render-taste138.mjs --prefix before|after');
  process.exit(1);
}

const repoRoot = new URL('../../../', import.meta.url).pathname;
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const out = new URL('../../../docs/taste-review/2026-09-marxy-138/', import.meta.url);
mkdirSync(out, { recursive: true });

const PAGES = [
  { file: '09-gfm-everything.md', slug: '09-gfm-everything' },
  { file: '10-hostile.md', slug: '10-hostile' },
];

function outPath(slug) {
  return new URL(`${prefix}-${slug}-dark-960-2x.png`, out);
}

/** Scroll so the taste-review subject sits in the viewport (image block or article top). */
async function scrollToSubject(page, slug) {
  if (slug === '09-gfm-everything') {
    const y = await page.evaluate(() => {
      const img = document.querySelector('#doc img[alt="Image alt"]');
      if (!img) return 0;
      const pad = 48;
      return Math.max(0, Math.round(img.getBoundingClientRect().top + window.scrollY - pad));
    });
    await page.evaluate((top) => window.scrollTo(0, top), y);
    return;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

function b64(path) {
  return readFileSync(path).toString('base64');
}

function filesForCorpus(file) {
  const docPath = `/corpus/${file}`;
  const files = { [docPath]: b64(join(corpusDir, file)) };
  if (file === '09-gfm-everything.md') {
    files['/corpus/image.png'] = b64(join(corpusDir, 'image.png'));
  }
  return { docPath, files };
}

async function renderBefore(browser) {
  for (const { file, slug } of PAGES) {
    const html = renderCorpus(file);
    const ctx = await browser.newContext({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 2 });
    const page = await openPage(ctx, html, { variant: 'dark', width: 960, height: 900 });
    await scrollToSubject(page, slug);
    const dest = outPath(slug);
    await page.screenshot({ path: dest.pathname, fullPage: false });
    console.log(`wrote ${dest.pathname.slice(dest.pathname.indexOf('docs/'))}`);
    await ctx.close();
  }
}

async function boot(page, base, files, argv) {
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
  }, { files, argv });
}

async function renderAfter(browser) {
  const outDir = mkdtempSync(join(tmpdir(), 'marxy-taste138-'));
  await build({ root: join(repoRoot, 'apps', 'desktop'), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  const types = {
    '.html': 'text/html',
    '.ttf': 'font/ttf',
    '.js': 'text/javascript',
    '.txt': 'text/plain',
    '.css': 'text/css',
    '.png': 'image/png',
  };
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  try {
    for (const { file, slug } of PAGES) {
      const { docPath, files } = filesForCorpus(file);
      const ctx = await browser.newContext({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await boot(page, base, files, [docPath]);
      await scrollToSubject(page, slug);
      const dest = outPath(slug);
      await page.screenshot({ path: dest.pathname, fullPage: false });
      console.log(`wrote ${dest.pathname.slice(dest.pathname.indexOf('docs/'))}`);
      await ctx.close();
    }
  } finally {
    server.close();
  }
}

function assertPngArtifacts() {
  const paths = PAGES.map(({ slug }) => outPath(slug).pathname);
  const digests = new Set();
  for (const path of paths) {
    const bytes = readFileSync(path);
    if (bytes[0] !== 0x89 || bytes.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${path} is not a PNG`);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digests.has(digest)) throw new Error(`${path} is byte-identical to another PNG in this prefix`);
    digests.add(digest);
  }
}

const browser = await launchWebkit();
try {
  if (prefix === 'before') await renderBefore(browser);
  else await renderAfter(browser);
  assertPngArtifacts();
} finally {
  await browser.close();
}
