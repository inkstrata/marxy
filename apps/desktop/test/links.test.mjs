// In-document, relative and external links in Rendered mode (MARXY-240).

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const appRoot = new URL('..', import.meta.url).pathname;
const outDir = mkdtempSync(join(tmpdir(), 'marxy-links-'));
let server;
let base;

const para = (w) => `${w} `.repeat(80);

const INDEX = [
  '# Index',
  '',
  ...Array.from({ length: 30 }, (_, i) => `${para(`Filler ${i}`)}\n`),
  '## Target section',
  '',
  para('Lead'),
  '',
  ...Array.from({ length: 20 }, (_, i) => `${para(`Below ${i}`)}\n`),
  '[jump](#target-section)',
  '',
  '[other](./other.md)',
  '',
  '[away](../outside.md)',
  '',
  '[web](https://example.invalid/)',
  '',
].join('\n');

const OTHER = ['# Other doc', '', para('Body'), ''].join('\n');

before(async () => {
  if (skip) return;
  await build({ root: appRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  await build({
    configFile: false,
    root: appRoot,
    logLevel: 'silent',
    build: {
      lib: {
        entry: resolve(appRoot, 'src/selection/harness-entry.ts'),
        formats: ['iife'],
        name: 'MarxySelectionHarness',
        fileName: 'selection-harness',
      },
      outDir: join(outDir, 'sel'),
      emptyOutDir: true,
    },
  });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

async function boot(page, files, argv) {
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.addScriptTag({ url: `${base}sel/selection-harness.iife.js` });
  await page.waitForFunction(() => window.__marxySelectionHarnessPatched === true);
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    window.__marxyTestHandle = handle;
  }, { files, argv });
  await page.waitForFunction(() => document.querySelector('#doc h2#target-section'));
}

test('hash link scrolls; relative opens; external calls openExternal; back returns; outside is refused', async () => {
  const root = '/repo/docs';
  const files = {
    [`${root}/index.md`]: Buffer.from(INDEX, 'utf8').toString('base64'),
    [`${root}/other.md`]: Buffer.from(OTHER, 'utf8').toString('base64'),
    [`/repo/outside.md`]: Buffer.from('# Outside\n', 'utf8').toString('base64'),
    [`/repo/.git/HEAD`]: Buffer.from('ref: refs/heads/main\n', 'utf8').toString('base64'),
  };
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await boot(page, files, [`${root}/index.md`]);

    await page.locator('#doc a[href="#target-section"]').click();
    await page.waitForFunction(() => {
      const top = document.querySelector('#target-section')?.getBoundingClientRect().top;
      return top !== undefined && top > 200 && top < 420;
    });

    await page.locator('#doc a[href="./other.md"]').click();
    await page.waitForFunction(() => window.__marxyTestHandle.currentPath().endsWith('/other.md'));
    assert.match(await page.textContent('#doc'), /Other doc/);

    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
    await page.keyboard.press(isMac ? 'Meta+[' : 'Control+[');
    await page.waitForFunction(() => window.__marxyTestHandle.currentPath().endsWith('/index.md'));

    await page.locator('#doc a[href="https://example.invalid/"]').click();
    const external = await page.evaluate(() =>
      window.__marxyTestHandle.shell.calls.filter((c) => c.method === 'openExternal'),
    );
    assert.ok(external.length >= 1);

    await page.locator('#doc a[href="../outside.md"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#marxy-notices')?.textContent?.includes('outside'),
    );
    assert.match(await page.evaluate(() => window.__marxyTestHandle.currentPath()), /index\.md$/);
  } finally {
    await browser.close();
  }
});
