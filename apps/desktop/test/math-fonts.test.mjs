// Maths is drawn in KaTeX's own faces, which ship as woff2 files only: under the release CSP every face loads, and the
// page asks for no other font file. The CSP's font-src has no data:, so a face the build inlined would never load.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { injectStyleNonces, loadConfiguredCsp, releaseStyleCsp } from '../../../scripts/check-csp.mjs';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { build } from './support/shared-vite.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const outDir = mkdtempSync(join(tmpdir(), 'marxy-math-fonts-'));
const NONCE = 'marxymathfonts';
let server;
let base;
const requested = [];

before(async () => {
  if (skip) return;
  await build({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  const csp = releaseStyleCsp(loadConfiguredCsp(), NONCE);
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    requested.push(pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    const ext = extname(path);
    res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
    if (ext === '.html') {
      res.setHeader('Content-Security-Policy', csp);
      return res.end(injectStyleNonces(readFileSync(path, 'utf8'), NONCE));
    }
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

const DOC = '/maths.md';
// The four delimiter sizes each have their own face (KaTeX_Size1 to Size4).
const TEXT = 'Inline $x^2 + \\frac{a}{b}$ and a block:\n\n$$\n\\sum_{i=0}^{n} i = \\frac{n(n+1)}{2} \\bigl( \\Bigl( \\biggl( \\Biggl( x \\Biggr) \\biggr) \\Bigr) \\bigr)\n$$\n';

test('under the release CSP every KaTeX face loads from a woff2 file, and no woff or ttf file is asked for', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    await page.evaluate(async ({ files, argv }) => {
      const handle = await window.marxyApp.start(files, argv);
      await handle.ready;
    }, { files: { [DOC]: Buffer.from(TEXT, 'utf8').toString('base64') }, argv: [DOC] });
    await page.waitForSelector('.katex');
    const state = await page.evaluate(async () => {
      await document.fonts.ready;
      const katex = [...document.fonts].filter((f) => f.family.replace(/["']/g, '').startsWith('KaTeX_'));
      // Every face, not only those this formula drew: a face the page cannot load is a glyph in a fallback somewhere.
      await Promise.allSettled(katex.map((f) => f.load()));
      const sheet = [...document.adoptedStyleSheets, ...document.styleSheets].flatMap((s) => [...s.cssRules]).filter((r) => r instanceof CSSFontFaceRule && /KaTeX_/.test(r.cssText));
      return {
        faces: katex.length,
        failed: katex.filter((f) => f.status !== 'loaded').map((f) => `${f.family} ${f.weight} ${f.style}: ${f.status}`),
        sources: sheet.flatMap((r) => [...r.cssText.matchAll(/url\("?([^")]+)"?\)/g)].map((m) => m[1])),
      };
    });
    assert.ok(state.faces >= 20, `KaTeX's faces are declared: ${state.faces}`);
    assert.deepEqual(state.failed, [], 'every KaTeX face loads');
    const woff2File = (u) => /\.woff2(\?|$)/.test(u) && !u.startsWith('data:');
    assert.ok(state.sources.length > 0 && state.sources.every(woff2File), `every declared source is a woff2 file: ${state.sources.filter((u) => !woff2File(u)).map((u) => u.slice(0, 60))}`);
    assert.deepEqual(requested.filter((p) => /KaTeX.*\.(woff|ttf)$/.test(p)), []);
  } finally {
    await browser.close();
  }
});
