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
  '[beyond](../../elsewhere.md)',
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

test('hash link scrolls; relative opens; external calls openExternal; back returns; outside the repository is refused; one folder up inside it opens (F-14)', async () => {
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

    await page.locator('#doc a[href="../../elsewhere.md"]').click();
    await page.waitForFunction(() =>
      // In a repository the boundary is the repository, and the notice says so.
      document.querySelector('#marxy-notices')?.textContent?.includes('outside this repository'),
    );
    assert.match(await page.evaluate(() => window.__marxyTestHandle.currentPath()), /index\.md$/);

    // F-14: ../outside.md leaves the folder but not the repository, so it opens.
    await page.locator('#doc a[href="../outside.md"]').click();
    await page.waitForFunction(() => window.__marxyTestHandle.currentPath() === '/repo/outside.md');
  } finally {
    await browser.close();
  }
});

// F-05: a heading far down a long document is not mounted when the link is followed (the document
// mounts progressively); the link must still land it, at the same reading line as a mounted one.
const BIG = [
  '# Top',
  '',
  '[toc](#late-heading)',
  '',
  '[mid](#mid-heading)',
  '',
  ...Array.from({ length: 2500 }, (_, i) => `${para(`P${i}`)}\n`),
  '## Mid heading',
  '',
  para('Mid'),
  '',
  ...Array.from({ length: 2500 }, (_, i) => `${para(`Q${i}`)}\n`),
  '## Late heading',
  '',
  para('Lead'),
  '',
  ...Array.from({ length: 30 }, (_, i) => `${para(`After ${i}`)}\n`),
].join('\n');
const FROM = ['# From', '', '[go](./big.md#late-heading)', ''].join('\n');

const landed = (id = 'late-heading') => {
  const top = document.querySelector(`#${id}`)?.getBoundingClientRect().top;
  return top !== undefined && top > 200 && top < 420;
};

test('F-05: a same-page link to a heading not yet mounted lands it at the reading line', async () => {
  const files = { '/d/big.md': Buffer.from(BIG, 'utf8').toString('base64') };
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    await page.addScriptTag({ url: `${base}sel/selection-harness.iife.js` });
    await page.waitForFunction(() => window.__marxySelectionHarnessPatched === true);
    const mounted = await page.evaluate(async ({ files }) => {
      const handle = await window.marxyApp.start(files, ['/d/big.md']);
      await handle.ready;
      window.__marxyTestHandle = handle;
      return !!document.querySelector('#late-heading');
    }, { files });
    assert.equal(mounted, false, 'precondition: the heading is not mounted when the link is followed');
    await page.evaluate(() => document.querySelector('#doc a[href="#late-heading"]').click());
    await page.waitForFunction(landed, 'late-heading', { timeout: 60000 });
  } finally {
    await browser.close();
  }
});

test('F-05: a cross-document link to a late heading lands it at the reading line', async () => {
  const files = {
    '/d/from.md': Buffer.from(FROM, 'utf8').toString('base64'),
    '/d/big.md': Buffer.from(BIG, 'utf8').toString('base64'),
  };
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    await page.addScriptTag({ url: `${base}sel/selection-harness.iife.js` });
    await page.waitForFunction(() => window.__marxySelectionHarnessPatched === true);
    await page.evaluate(async ({ files }) => {
      const handle = await window.marxyApp.start(files, ['/d/from.md']);
      await handle.ready;
      window.__marxyTestHandle = handle;
    }, { files });
    await page.evaluate(() => document.querySelector('#doc a[href="./big.md#late-heading"]').click());
    await page.waitForFunction(() => window.__marxyTestHandle.currentPath().endsWith('/big.md'));
    await page.waitForFunction(landed, 'late-heading', { timeout: 60000 });
  } finally {
    await browser.close();
  }
});

async function bootBig(page) {
  const files = { '/d/big.md': Buffer.from(BIG, 'utf8').toString('base64') };
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.addScriptTag({ url: `${base}sel/selection-harness.iife.js` });
  await page.waitForFunction(() => window.__marxySelectionHarnessPatched === true);
  await page.evaluate(async ({ files }) => {
    const handle = await window.marxyApp.start(files, ['/d/big.md']);
    await handle.ready;
    window.__marxyTestHandle = handle;
    window.__done = false;
    void handle.contentComplete().then(() => { window.__done = true; });
  }, { files });
}

test('F-05: a link to a heading halfway down lands before the document has finished mounting', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootBig(page);
    assert.equal(await page.evaluate(() => !!document.querySelector('#mid-heading')), false, 'precondition');
    await page.evaluate(() => document.querySelector('#doc a[href="#mid-heading"]').click());
    await page.waitForFunction(landed, 'mid-heading', { timeout: 10000 });
    assert.equal(await page.evaluate(() => window.__done), false, 'it landed before the mount completed');
  } finally {
    await browser.close();
  }
});

test('F-05: a landing never pulls the page after the reader has scrolled on', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootBig(page);
    await page.evaluate(() => document.querySelector('#doc a[href="#mid-heading"]').click());
    await page.waitForFunction(landed, 'mid-heading', { timeout: 10000 });
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, 300);
    await new Promise((r) => setTimeout(r, 300));
    const before = await page.evaluate(() => document.documentElement.scrollTop);
    await page.evaluate(() => window.__marxyTestHandle.contentComplete());
    await new Promise((r) => setTimeout(r, 800));
    const after = await page.evaluate(() => document.documentElement.scrollTop);
    // A grid pass over the late blocks may move the page a line or two; a yank is thousands of px.
    assert.ok(Math.abs(after - before) < 100, `the page stayed where the reader left it (${before} -> ${after})`);
  } finally {
    await browser.close();
  }
});

test('F-05: a link to an id the document has no heading for does nothing', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootBig(page);
    const kids = await page.evaluate(() => {
      const a = document.createElement('a');
      a.setAttribute('href', '#no-such-heading');
      a.textContent = 'x';
      document.querySelector('#doc p').appendChild(a);
      const n = document.getElementById('doc').childElementCount;
      a.click();
      return [n, document.getElementById('doc').childElementCount, document.documentElement.scrollTop];
    });
    assert.equal(kids[1], kids[0], 'nothing was mounted for a missing id');
    assert.equal(kids[2], 0);
  } finally {
    await browser.close();
  }
});
