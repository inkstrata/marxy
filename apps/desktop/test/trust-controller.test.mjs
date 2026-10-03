// Trust lives in trust/controller.ts and app.ts keeps one re-render path (B-10).
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = new URL('..', import.meta.url).pathname;
const repoRoot = new URL('../../../', import.meta.url).pathname;
const corpusDir = join(repoRoot, 'fixtures', 'corpus');

/** app.ts without comments, so a name mentioned in prose does not count as code. */
function appSource() {
  return readFileSync(join(desktopRoot, 'src', 'app.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

nodeTest('app.ts holds no trust state and no second re-render path', () => {
  const src = appSource();
  for (const name of ['trustStore', 'trustLoadPromise', 'grantSummary', 'rerenderOpenDocument']) {
    assert.ok(!src.includes(name), `app.ts still names ${name}; it belongs in trust/controller.ts`);
  }
  assert.match(src, /from '\.\/trust\/controller\.ts'/);
});

nodeTest('app.ts builds the deferred-startup context in one place', () => {
  const calls = appSource().match(/\bdeferredStartupContext\(/g) ?? [];
  // The declaration and its one call.
  assert.equal(calls.length, 2, `deferredStartupContext( appears ${calls.length} times`);
});

const outDir = mkdtempSync(join(tmpdir(), 'marxy-trust-controller-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({ root: desktopRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

async function withApp(docName, fn, text) {
  const docPath = `/corpus/${docName}`;
  const bytes = text === undefined ? readFileSync(join(corpusDir, docName)) : Buffer.from(text, 'utf8');
  const files = { [docPath]: bytes.toString('base64') };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    await page.evaluate(async ({ files, argv }) => {
      const handle = await window.marxyApp.start(files, argv);
      await handle.ready;
      window.__h = handle;
      window.__renders = 0;
      handle.onDocumentChange(() => { window.__renders += 1; });
    }, { files, argv: [docPath] });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/** Renders (document announcements) and typesetter starts (typeset_viewport marks) so far. */
function counts(page) {
  return page.evaluate(() => ({
    renders: window.__renders,
    typeset: window.__h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'typeset_viewport').length,
  }));
}

test('one render per commitEdit', () =>
  withApp('02-readme-real-world.md', async (page) => {
    await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    const before = await counts(page);
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) await window.__h.commitEdit(window.__h.openDocument().buffer);
    });
    const after = await counts(page);
    assert.deepEqual(
      { renders: after.renders - before.renders, typeset: after.typeset - before.typeset },
      { renders: 3, typeset: 3 },
      JSON.stringify({ before, after }),
    );
  }));

test('granting HTML renders the page once more, through the controller', () =>
  withApp('02-readme-real-world.md', async (page) => {
    await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    const before = await counts(page);
    await page.locator('button.marxy-notice-action', { hasText: /Show this document's HTML/ }).first().click();
    await page.waitForFunction(() => document.querySelector('#doc details'));
    await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    const after = await counts(page);
    assert.equal(after.renders - before.renders, 1, JSON.stringify({ before, after }));
  }));

/** The first block whose box is in the viewport, and where its top is: what the reader is looking at. */
function topBlock(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('#doc > [data-marxy-s]')) {
      const box = el.getBoundingClientRect();
      if (box.bottom > 0) return { text: el.textContent?.trim() ?? '', top: Math.round(box.top) };
    }
    return { text: '', top: 0 };
  });
}

test('granting HTML far down a document keeps the reader where they were', () => {
  const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1} of the long document.`);
  // Forty HTML blocks above the reader, each a different height once HTML is shown.
  const html = Array.from({ length: 40 }, (_, i) => `<details><summary>More ${i + 1}</summary>Inside.</details>`);
  const text = `# Long\n\n${html.join('\n\n')}\n\n${paragraphs.join('\n\n')}\n`;
  return withApp('long-with-html.md', async (page) => {
    await page.evaluate(() => window.__h.contentComplete());
    await page.evaluate(() => {
      const target = [...document.querySelectorAll('#doc > p')].find((p) => p.textContent?.startsWith('Paragraph 120 '));
      target?.scrollIntoView({ block: 'start' });
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 100))));
    const before = await topBlock(page);
    assert.match(before.text, /^Paragraph 1[12]\d /, `scrolled to ${before.text}`);
    // A click that does not scroll the button into view first: the grant must read where the reader is.
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button.marxy-notice-action')].find((el) =>
        /Show this document's HTML/.test(el.textContent ?? ''),
      );
      button?.click();
    });
    await page.waitForFunction(() => document.querySelector('#doc details'));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 100))));
    const after = await topBlock(page);
    assert.equal(after.text, before.text);
    assert.ok(Math.abs(after.top - before.top) <= 40, JSON.stringify({ before, after }));
  }, text);
});
