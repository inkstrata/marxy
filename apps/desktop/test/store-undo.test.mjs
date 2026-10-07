// Undo follows the document store, not a content hash (B-11, ADR-0037 §3). The ADR's defect 2 sequence
// end to end in WebKit — tick a task, type in Source, come back, undo twice — plus rename and reload,
// and a source-text check that the modules which used to hold the history hold no state now.
// Nothing here sets window.__marxyOrigBytes: the store's own `dirty` is what is under test.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const desktopRoot = new URL('..', import.meta.url).pathname;

/** A module's source without comments, so a word in prose does not count as code. */
function code(rel) {
  return readFileSync(join(desktopRoot, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

nodeTest('commands/edits.ts and save.ts hold no module-level let and no History instance', () => {
  for (const rel of ['src/commands/edits.ts', 'src/save.ts']) {
    const src = code(rel);
    assert.doesNotMatch(src, /^let /m, `${rel} keeps module state; the store owns it (ADR-0037)`);
    assert.doesNotMatch(src, /\bHistory\b/, `${rel} keeps its own undo history; the store owns it (ADR-0037 §3)`);
  }
});

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const outDir = mkdtempSync(join(tmpdir(), 'marxy-store-undo-'));
let server;
let base;
let browser;

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
  browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
  server?.close();
});

const PATH = '/d/t.md';
const ORIGINAL = '# T\n\nhello\n\n- [ ] one\n- [ ] two\n';

async function boot(text = ORIGINAL) {
  const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ b64, path }) => {
    const r = await window.marxyPaletteBoot.start({ [path]: b64 }, [path], []);
    window.__handle = r.handle;
  }, { b64: Buffer.from(text).toString('base64'), path: PATH });
  await page.waitForFunction(() => window.__marxyTasksReady === true && typeof window.marxyHarnessSave === 'function');
  return page;
}

const modOf = async (page) => ((await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control');
const buf = (page) => page.evaluate(() => new TextDecoder().decode(window.__handle.openDocument().buffer.bytes));
const untilBuffer = (page, text) =>
  page.waitForFunction((t) => new TextDecoder().decode(window.__handle.openDocument().buffer.bytes) === t, text, { timeout: 5000 });
const canUndo = (page) => page.evaluate(() => window.__handle.document().snapshot().canUndo);
const toggleMode = async (page, m) => {
  await page.keyboard.press(`${await modOf(page)}+e`);
  await page.waitForFunction((m) => document.body.dataset.marxyMode === m, m);
};
const clickBox = async (page, i) => {
  const [x, y] = await page.evaluate((i) => {
    const el = document.querySelectorAll('#doc input[type=checkbox]')[i];
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, i);
  await page.mouse.click(x, y);
};
const undoKey = async (page) => page.keyboard.press(`${await modOf(page)}+z`);

test('ADR-0037 defect 2: toggle, Source edit, two undos restore the original', async () => {
  const page = await boot();
  const toggled = ORIGINAL.replace('- [ ] one', '- [x] one');
  await clickBox(page, 0);
  await untilBuffer(page, toggled);
  await toggleMode(page, 'source');
  await page.click('.cm-content');
  await page.keyboard.press((await modOf(page)) === 'Meta' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.type('X');
  await toggleMode(page, 'rendered');
  await untilBuffer(page, `X${toggled}`);
  await undoKey(page);
  await untilBuffer(page, toggled);
  await undoKey(page);
  await untilBuffer(page, ORIGINAL);
  assert.equal(await buf(page), ORIGINAL);
  assert.equal(await canUndo(page), false, 'two entries, two undos');
  assert.equal(await page.evaluate(() => window.marxyDocumentEdit().dirty), false, 'back at the bytes on disk');
  await page.close();
});

test('rename keeps history: an unsaved edit followed to the new name can still be undone', async () => {
  const page = await boot();
  const toggled = ORIGINAL.replace('- [ ] one', '- [x] one');
  await clickBox(page, 0);
  await untilBuffer(page, toggled);
  await page.evaluate(async (text) => {
    const sh = window.__handle.shell;
    await sh.writeFileAtomic('/d/moved.md', new TextEncoder().encode(text));
    sh.emit([{ kind: 'renamed', path: '/d/t.md', to: '/d/moved.md' }]);
  }, ORIGINAL);
  await page.waitForFunction(() => window.__handle.currentPath() === '/d/moved.md');
  assert.equal(await buf(page), toggled, 'the unsaved edit followed the rename');
  assert.equal(await canUndo(page), true, 'the history followed the rename');
  await page.click('#doc h1');
  await undoKey(page);
  await untilBuffer(page, ORIGINAL);
  await page.close();
});

test('a clean reload clears history: Mod+Z then does nothing', async () => {
  const page = await boot();
  const toggled = ORIGINAL.replace('- [ ] one', '- [x] one');
  await clickBox(page, 0);
  await untilBuffer(page, toggled);
  assert.equal(await page.evaluate(() => window.marxyHarnessSave()), 'saved');
  assert.equal(await canUndo(page), true, 'a save keeps history');
  const external = `${toggled}\nfrom disk\n`;
  await page.evaluate(async ([p, text]) => {
    const sh = window.__handle.shell;
    await sh.writeFileAtomic(p, new TextEncoder().encode(text));
    sh.emit([{ kind: 'modified', path: p }]);
  }, [PATH, external]);
  await untilBuffer(page, external);
  assert.equal(await canUndo(page), false, 'the reload cleared the history');
  await page.click('#doc h1');
  await undoKey(page);
  await page.waitForTimeout(400);
  assert.equal(await buf(page), external, 'Mod+Z after a clean reload changes nothing');
  await page.close();
});
