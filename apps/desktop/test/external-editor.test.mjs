// Open in external editor (Mod+Shift+E) in WebKit on the memory shell (A-16,
// docs/design/09-app-shell.md §Open in external editor): the line is the reading block's in Rendered
// and the cursor's in Source, only the path and the line reach the shell, and a refusal is one notice.
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
const outDir = mkdtempSync(join(tmpdir(), 'marxy-external-editor-'));
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

const DOC = '/notes/a folder/long read.md';
const TARGET_LINE = 40;

/** One-line paragraphs on odd lines up to 37, blank 38–39, the target heading on line 40, then plenty to scroll. */
function longDocument() {
  const lines = ['# The long read', ''];
  for (let n = 3; n <= 37; n++) lines.push(n % 2 === 1 ? `Paragraph on line ${n}, with enough words to fill the measure once over.` : '');
  lines.push('', '', '## The target heading on line 40', '');
  for (let n = 0; n < 60; n++) lines.push(`Paragraph ${n} after the target, long enough to wrap across the measure at least once or twice.`, '');
  return lines.join('\n');
}
const TEXT = longDocument();
const targetByte = Buffer.from(TEXT).indexOf('## The target heading');
const lineAtByte = (byte) => TEXT.slice(0, byte).split('\n').length;
assert.equal(lineAtByte(targetByte), TARGET_LINE, 'fixture: the target heading starts line 40');

async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 700 } });
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    await page.evaluate(async ({ files, argv }) => {
      window.__boot = await window.marxyPaletteBoot.start(files, argv, []);
    }, { files: { [DOC]: Buffer.from(TEXT).toString('base64') }, argv: [DOC] });
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered' && document.querySelector('#doc h2'));
    // The command keys are installed right after the rendered selection, which names itself last.
    await page.waitForFunction(() => window.marxySelection !== undefined);
    await fn(page);
  } finally {
    await browser.close();
  }
}

const modOf = async (page) => ((await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control');
const revealCalls = (page) =>
  page.evaluate(() => window.__boot.handle.shell.calls.filter((c) => c.method === 'revealInExternalEditor').map((c) => c.args));
const notices = (page) =>
  page.evaluate(() => [...document.querySelectorAll('#marxy-notices .marxy-notice .marxy-notice-text')].map((n) => n.textContent));

/** One press of Mod+Shift+E, then a wait for its effect. */
async function pressOpenInEditor(page, waitFor) {
  await page.keyboard.press(`${await modOf(page)}+Shift+E`);
  await page.waitForFunction(waitFor, null, { timeout: 5_000 });
}

test('Mod+Shift+E in Rendered opens the reading block line, and writes nothing', () =>
  withPage(async (page) => {
    await page.evaluate(async ({ path, at }) => { await window.__boot.handle.open(path, { at }); }, { path: DOC, at: targetByte });
    const reading = await page.evaluate(() => window.__boot.handle.sourceHarness());
    assert.equal(reading.mode, 'rendered');
    assert.equal(lineAtByte(reading.byteOffset), TARGET_LINE, 'precondition: the reading block is the line-40 heading');
    await pressOpenInEditor(page, () => window.__boot.handle.shell.calls.some((c) => c.method === 'revealInExternalEditor'));
    assert.deepEqual(await revealCalls(page), [[DOC, TARGET_LINE]]);
    const writes = await page.evaluate(() => window.__boot.handle.shell.calls.filter((c) => c.method === 'writeFileAtomic').length);
    assert.equal(writes, 0, 'opening an editor never writes the document');
    assert.deepEqual(await notices(page), []);
  }));

test('Mod+Shift+E in Source, with focus in the editor, opens the cursor line', () =>
  withPage(async (page) => {
    const mod = await modOf(page);
    await page.keyboard.press(`${mod}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('.cm-content .cm-line'));
    const line7 = page.locator('.cm-line', { hasText: 'Paragraph on line 7,' });
    await line7.click();
    await page.waitForFunction(() => document.activeElement?.closest('.cm-content') !== null);
    await pressOpenInEditor(page, () => window.__boot.handle.shell.calls.some((c) => c.method === 'revealInExternalEditor'));
    assert.deepEqual(await revealCalls(page), [[DOC, 7]]);
    assert.equal(await page.evaluate(() => document.body.dataset.marxyMode), 'source');
  }));

test('a refused open shows exactly one notice with the reason', () =>
  withPage(async (page) => {
    await page.evaluate(() => {
      const shell = window.__boot.handle.shell;
      shell.revealInExternalEditor = async (path, line) => {
        shell.calls.push({ method: 'revealInExternalEditor', args: [path, line] });
        const err = new Error('nvim: No such file or directory (os error 2)');
        err.code = 'io';
        throw err;
      };
    });
    await pressOpenInEditor(page, () => document.querySelector('#marxy-notices .marxy-notice') !== null);
    assert.deepEqual(await notices(page), [
      'Could not open long read.md in the external editor: nvim: No such file or directory (os error 2).',
    ]);
    assert.equal((await revealCalls(page)).length, 1, 'one press, one attempt');
  }));
