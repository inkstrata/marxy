// F-25: an open Source editor keeps its line separator through a live reload.
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
const outDir = mkdtempSync(join(tmpdir(), 'marxy-eol-reload-'));
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
      rollupOptions: { input: { app: join(desktopRoot, 'app.html'), paletteBoot: join(desktopRoot, 'test/palette-boot.html') } },
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


async function open(page, text, path) {
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    window.__boot = await window.marxyPaletteBoot.start(files, argv, []);
  }, { files: { [path]: Buffer.from(text, 'latin1').toString('base64') }, argv: [path] });
  await page.waitForFunction(() => window.__marxyOpenSynced === true);
}
async function toSource(page) {
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
  await page.click('#doc p');
  await page.waitForFunction(() => window.marxySelection?.getSelectionState().selection.kind !== 'none');
  await page.evaluate(() => window.marxyRunCommand?.('view.jump-to-source'));
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-line'));
}
async function leave(page) {
  const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+e`);
  await page.waitForFunction(() => document.body.dataset.marxyMode !== 'source');
}
async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    await fn(await browser.newPage({ viewport: { width: 960, height: 900 } }));
  } finally {
    await browser.close();
  }
}
const latin = (page) =>
  page.evaluate(() => String.fromCharCode(...window.__boot.handle.openDocument().buffer.bytes));

/** An outside write: new bytes on disk, then the watcher's event, then wait for the reload to land. */
async function outsideWrite(page, path, text) {
  await page.evaluate(async ({ path, b64 }) => {
    const h = window.__boot.handle;
    const marks = () => h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'live_reload').length;
    const before = marks();
    const bin = atob(b64);
    await h.shell.writeFileAtomic(path, Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    h.shell.emit([{ kind: 'modified', path }]);
    for (let i = 0; i < 500 && marks() === before; i++) await new Promise((r) => setTimeout(r, 10));
    if (marks() === before) throw new Error('the outside write was not reloaded');
  }, { path, b64: Buffer.from(text, 'latin1').toString('base64') });
}

const LINES = ['alpha one', 'bravo two', 'charlie three'];
const file = (sep) => LINES.join(sep) + sep;
const MIXED = 'alpha one\r\nbravo two\rcharlie three\n';

// Each transition: the open Source shows the new file's lines, and Enter inserts the new class's newline.
const transitions = [
  ['CR to LF', file('\r'), file('\n'), '\n'],
  ['LF to CR', file('\n'), file('\r'), '\r'],
  ['CR to mixed', file('\r'), MIXED, '\n'],
  ['LF to CRLF', file('\n'), file('\r\n'), '\r\n'],
];

for (const [name, from, to, newline] of transitions) {
  test(`a reload that changes the file ${name} shows its lines and Enter inserts its newline (F-25)`, () =>
    withPage(async (page) => {
      await open(page, from, '/doc/x.md');
      await toSource(page);
      await outsideWrite(page, '/doc/x.md', to);
      const want = to === MIXED ? 3 : 4;
      await page.waitForFunction((n) => document.querySelectorAll('#marxy-source .cm-line').length === n, want);
      // One line per ending; only a mixed file keeps CR characters (shown as marks), never a break the file now uses.
      assert.equal(await page.locator('#marxy-source .cm-specialChar').count(), to === MIXED ? 2 : 0, 'no stray ␍ or ␤ marks');
      await page.locator('#marxy-source .cm-line').nth(1).click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Enter');
      await leave(page);
      const got = await latin(page);
      const expected = to.replace('bravo two', `${newline}bravo two`);
      assert.equal(got, expected, 'one byte class of newline went in: the new one');
    }));
}

test('an unchanged save after a separator-changing reload is byte-exact (F-25)', () =>
  withPage(async (page) => {
    await open(page, file('\r'), '/doc/x.md');
    await toSource(page);
    await outsideWrite(page, '/doc/x.md', file('\n'));
    await page.waitForFunction(() => document.querySelectorAll('#marxy-source .cm-line').length === 4);
    await page.locator('#marxy-source .cm-line').nth(1).click();
    await page.keyboard.type('Z');
    await page.keyboard.press('Backspace');
    await leave(page);
    assert.equal(await latin(page), file('\n'));
  }));

test('a BOM that appears across a reload keeps the bytes and the edit place right (F-25)', () =>
  withPage(async (page) => {
    const plain = file('\n');
    const bom = '\xEF\xBB\xBF' + plain;
    await open(page, plain, '/doc/x.md');
    await toSource(page);
    await outsideWrite(page, '/doc/x.md', bom);
    await page.locator('#marxy-source .cm-line').nth(1).click();
    await page.keyboard.press('Home');
    await page.keyboard.type('Z');
    await leave(page);
    assert.equal(await latin(page), '\xEF\xBB\xBF' + plain.replace('bravo', 'Zbravo'));
  }));

test('a BOM that disappears across a reload keeps the bytes and the edit place right (F-25)', () =>
  withPage(async (page) => {
    const plain = file('\n');
    await open(page, '\xEF\xBB\xBF' + plain, '/doc/x.md');
    await toSource(page);
    await outsideWrite(page, '/doc/x.md', plain);
    await page.locator('#marxy-source .cm-line').nth(1).click();
    await page.keyboard.press('Home');
    await page.keyboard.type('Z');
    await leave(page);
    assert.equal(await latin(page), plain.replace('bravo', 'Zbravo'));
  }));
