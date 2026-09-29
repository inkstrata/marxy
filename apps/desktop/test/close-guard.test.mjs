// The close guard end to end in WebKit, on the memory shell, with no window.__marxyOrigBytes: the
// app's own baseline decides what is dirty (MARXY-49, MARXY-337).
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = new URL('..', import.meta.url).pathname;
const outDir = mkdtempSync(join(tmpdir(), 'marxy-close-guard-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: { app: join(desktopRoot, 'app.html'), paletteBoot: join(desktopRoot, 'test/palette-boot.html') },
      },
    },
  });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

const A = '/d/a.md';
const B = '/d/b.md';
const b64 = (s) => Buffer.from(s).toString('base64');

async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    await page.evaluate(async ({ files, argv }) => {
      window.__boot = await window.marxyPaletteBoot.start(files, argv, []);
    }, { files: { [A]: b64('# T\n\n- [ ] one\n- [ ] two\n'), [B]: b64('# B\n') }, argv: [A] });
    await page.waitForFunction(() => window.__marxyTasksReady === true);
    await page.waitForFunction(() => typeof window.marxyHarnessSave === 'function');
    assert.equal(await page.evaluate(() => window.__marxyOrigBytes), undefined, 'the shortcut must stay unset');
    await fn(page);
  } finally {
    await browser.close();
  }
}

const calls = (page, method) => page.evaluate((m) => window.__boot.handle.shell.calls.filter((c) => c.method === m).length, method);
const requestClose = (page) => page.evaluate(() => window.__boot.handle.shell.emitCloseRequested());
const noticeButtons = (page) =>
  page.evaluate(() => [...document.querySelectorAll('#marxy-notices .marxy-notice button')].map((b) => b.textContent));
const clickButton = (page, label) =>
  page.evaluate((l) => [...document.querySelectorAll('#marxy-notices .marxy-notice button')].find((b) => b.textContent === l).click(), label);
const noticeCount = (page) => page.evaluate(() => document.querySelectorAll('#marxy-notices .marxy-notice').length);
const writesTo = (page, path) =>
  page.evaluate((p) => window.__boot.handle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === p).length, path);
const openPath = (page) => page.evaluate(() => window.__boot.handle.currentPath());

async function makeDirty(page) {
  await page.evaluate(() => {
    document.querySelector('#doc input[type=checkbox]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => window.marxyDocumentEdit().dirty === true);
  await page.waitForTimeout(150);
}

test('closing a clean document confirms at once and shows nothing', () =>
  withPage(async (page) => {
    await requestClose(page);
    assert.equal(await calls(page, 'confirmClose'), 1);
    assert.equal(await noticeCount(page), 0);
  }));

test('closing a dirty document offers Save and close, Close without saving and Dismiss', () =>
  withPage(async (page) => {
    await makeDirty(page);
    await requestClose(page);
    assert.equal(await calls(page, 'confirmClose'), 0);
    assert.deepEqual(await noticeButtons(page), ['Save and close', 'Close without saving', 'Dismiss']);
  }));

test('Close without saving closes', () =>
  withPage(async (page) => {
    await makeDirty(page);
    await requestClose(page);
    await clickButton(page, 'Close without saving');
    await page.waitForFunction(() => window.__boot.handle.shell.calls.some((c) => c.method === 'confirmClose'));
    assert.equal(await noticeCount(page), 0);
  }));

test('Save and close writes, then closes', () =>
  withPage(async (page) => {
    await makeDirty(page);
    await requestClose(page);
    await clickButton(page, 'Save and close');
    await page.waitForFunction(() => window.__boot.handle.shell.calls.some((c) => c.method === 'confirmClose'));
    assert.equal(await calls(page, 'writeFileAtomic'), 1);
  }));

test('Dismiss, then closing again prompts again', () =>
  withPage(async (page) => {
    await makeDirty(page);
    await requestClose(page);
    await clickButton(page, 'Dismiss');
    assert.equal(await noticeCount(page), 0);
    await requestClose(page);
    assert.equal(await calls(page, 'confirmClose'), 0, 'a dismissed notice is not a second request');
    assert.equal(await noticeCount(page), 1);
  }));

test('a second close request while the notice is up closes without saving', () =>
  withPage(async (page) => {
    await makeDirty(page);
    await requestClose(page);
    await requestClose(page);
    assert.equal(await calls(page, 'confirmClose'), 1);
  }));

test('a notice cleared by something else does not leave the guard off', () =>
  withPage(async (page) => {
    await makeDirty(page);
    await requestClose(page);
    await page.evaluate(() => document.getElementById('marxy-notices').replaceChildren());
    await requestClose(page);
    assert.equal(await calls(page, 'confirmClose'), 0);
    assert.equal(await noticeCount(page), 1);
    // and a discard that the shell did not act on does not disarm later closes
    await clickButton(page, 'Close without saving');
    assert.equal(await calls(page, 'confirmClose'), 1);
    await requestClose(page);
    assert.equal(await calls(page, 'confirmClose'), 1, 'still dirty: the next close prompts, it does not pass');
    assert.equal(await noticeCount(page), 1);
  }));

test('text typed into Source and not yet folded counts as unsaved', () =>
  withPage(async (page) => {
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+e`);
    await page.waitForFunction(() => document.querySelector('#marxy-source .cm-editor'));
    await page.click('#marxy-source .cm-line >> nth=0');
    await page.keyboard.press('End');
    await page.keyboard.type(' typed');
    await requestClose(page);
    assert.equal(await calls(page, 'confirmClose'), 0);
    assert.deepEqual(await noticeButtons(page), ['Save and close', 'Close without saving', 'Dismiss']);
  }));

test('opening another document over unsaved edits asks first; Dismiss keeps the edit', () =>
  withPage(async (page) => {
    await makeDirty(page);
    const before = await page.evaluate(() => [...window.__boot.handle.openDocument().buffer.bytes].join());
    await page.evaluate((p) => window.__boot.handle.open(p), B);
    await page.waitForTimeout(200);
    assert.equal(await openPath(page), A, 'nothing was opened');
    assert.deepEqual(await noticeButtons(page), ['Save and open', 'Open without saving', 'Dismiss']);
    await clickButton(page, 'Dismiss');
    await page.waitForTimeout(200);
    assert.equal(await openPath(page), A);
    assert.equal(await page.evaluate(() => [...window.__boot.handle.openDocument().buffer.bytes].join()), before);
    assert.equal(await page.evaluate(() => window.marxyDocumentEdit().dirty), true);
  }));

test('Open without saving opens the other document; Save and open writes first', () =>
  withPage(async (page) => {
    await makeDirty(page);
    await page.evaluate((p) => window.__boot.handle.open(p), B);
    await clickButton(page, 'Open without saving');
    await page.waitForFunction((p) => window.__boot.handle.currentPath() === p, B);
    assert.equal(await writesTo(page, A), 0, 'discarded: the document was not written');
    await page.evaluate((p) => window.__boot.handle.open(p), A);
    await page.waitForFunction((p) => window.__boot.handle.currentPath() === p, A);
    await makeDirty(page);
    await page.evaluate((p) => window.__boot.handle.open(p), B);
    await clickButton(page, 'Save and open');
    await page.waitForFunction((p) => window.__boot.handle.currentPath() === p, B);
    assert.equal(await writesTo(page, A), 1);
  }));

test('opening over a clean document does not ask', () =>
  withPage(async (page) => {
    await page.evaluate((p) => window.__boot.handle.open(p), B);
    await page.waitForFunction((p) => window.__boot.handle.currentPath() === p, B);
    assert.equal(await noticeCount(page), 0);
  }));
