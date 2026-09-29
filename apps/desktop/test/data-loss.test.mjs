// Data-loss regressions in the Rendered/Source round trip and in operations (MARXY-337):
// CRLF bytes, history after a failed write, two quick operations, and the task checkbox click.
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
const outDir = mkdtempSync(join(tmpdir(), 'marxy-data-loss-'));
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

/** Boots the memory-shell harness on `text`. Nothing pokes #doc: the first document must work as rendered. */
async function boot(text, { slowWrite = 0 } = {}) {
  const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ b64, slow, path }) => {
    const r = await window.marxyPaletteBoot.start({ [path]: b64 }, [path], []);
    window.__handle = r.handle;
    // Dirty baseline the harness provides (as save.test.mjs does): the bytes as first read.
    window.__marxyOrigBytes = new Uint8Array(await r.handle.shell.readFile(path));
    if (slow) {
      const sh = r.handle.shell;
      const orig = sh.writeFileAtomic;
      sh.writeFileAtomic = async (p, b) => { await new Promise((res) => setTimeout(res, slow)); return orig(p, b); };
    }
  }, { b64: Buffer.from(text).toString('base64'), slow: slowWrite, path: PATH });
  await page.waitForFunction(() => typeof window.marxySelection?.getSelectionState === 'function');
  await page.waitForFunction(() => window.__marxyTasksReady === true);
  return page;
}

const disk = (page) =>
  page.evaluate((p) => window.__handle.shell.readFile(p).then((a) => new TextDecoder().decode(a)), PATH);
const modOf = async (page) => ((await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control');
const buf = (page) =>
  page.evaluate(() => new TextDecoder().decode(window.__handle.openDocument().buffer.bytes));
// Operations change only the in-memory buffer; Mod+S writes it (MARXY-49).
// The Save command's `when` needs a live selection today, so click the heading to select it first.
const saveKey = async (page) => {
  await page.click('#doc h1');
  await page.keyboard.press(`${await modOf(page)}+s`);
  await settle(page);
  await rebaseAfterSave(page);
};
// The harness baseline does not move on save; follow the disk so a second save is judged against it.
const rebaseAfterSave = (page) =>
  page.evaluate(async (p) => {
    window.__marxyOrigBytes = new Uint8Array(await window.__handle.shell.readFile(p));
  }, PATH);
const mode = (page, m) => page.waitForFunction((m) => document.body.dataset.marxyMode === m, m);
const toggleMode = async (page, m) => {
  await page.keyboard.press(`${await modOf(page)}+e`);
  await mode(page, m);
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
const settle = (page, ms = 500) => page.waitForTimeout(ms);

const CRLF = '# T\r\n\r\nhello\r\n\r\n- [ ] one\r\n- [ ] two\r\n';

test('CRLF file: Rendered to Source to Rendered twice leaves every byte identical', async () => {
  const page = await boot(CRLF);
  for (let i = 0; i < 2; i++) {
    await toggleMode(page, 'source');
    await toggleMode(page, 'rendered');
  }
  assert.equal(await page.evaluate(() => new TextDecoder().decode(window.__handle.openDocument().buffer.bytes)), CRLF);
  await page.close();
});

test('CRLF file: one character typed in Source changes only that character', async () => {
  const page = await boot(CRLF);
  await toggleMode(page, 'source');
  await page.click('.cm-content');
  await page.keyboard.press((await modOf(page)) === 'Meta' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.type('X');
  await toggleMode(page, 'rendered');
  assert.equal(await page.evaluate(() => new TextDecoder().decode(window.__handle.openDocument().buffer.bytes)), `X${CRLF}`);
  await page.close();
});

test('CRLF file: a task toggled after a Source round trip keeps its CRLF line endings', async () => {
  const page = await boot(CRLF);
  await toggleMode(page, 'source');
  await toggleMode(page, 'rendered');
  await clickBox(page, 0);
  await settle(page);
  const toggledCrlf = CRLF.replace('- [ ] one', '- [x] one');
  assert.equal(await buf(page), toggledCrlf);
  assert.equal(await disk(page), CRLF, 'an operation alone does not write the file');
  await saveKey(page);
  assert.equal(await disk(page), toggledCrlf);
  await page.close();
});

test('CRLF file: an unedited Source session reloads an external change, no "edits kept" notice', async () => {
  const page = await boot(CRLF);
  await toggleMode(page, 'source');
  const NEW = `${CRLF}from disk\r\n`;
  await page.evaluate(async ([p, text]) => {
    const sh = window.__handle.shell;
    await sh.writeFileAtomic(p, new TextEncoder().encode(text));
    sh.emit([{ kind: 'modified', path: p }]);
  }, [PATH, NEW]);
  await settle(page, 800);
  assert.equal(await page.evaluate(() => document.getElementById('marxy-notices')?.innerText.trim()), '');
  assert.ok(await page.evaluate(() => document.querySelector('.cm-content').innerText.includes('from disk')));
  await page.close();
});

test('a failed save leaves no phantom history: two Undos after a later toggle stay inside that history', async () => {
  const orig = '# T\n\n| a | b |\n|-|-|\n| longer cell | x |\n\nTail stays intact.\n\n- [ ] one\n';
  const page = await boot(orig);
  await page.evaluate(() => {
    const sh = window.__handle.shell;
    window.__origWrite = sh.writeFileAtomic;
    sh.writeFileAtomic = async () => { throw new Error('read-only'); };
  });
  await page.evaluate(() => window.marxyHarnessAlignTable().catch(() => {}));
  await saveKey(page);
  assert.equal(await disk(page), orig);
  assert.match(await page.evaluate(() => document.getElementById('marxy-notices').innerText), /Could not save/);
  await page.evaluate(() => { window.__handle.shell.writeFileAtomic = window.__origWrite; });
  await clickBox(page, 0);
  await settle(page);
  const toggled = (await buf(page));
  assert.ok(toggled.includes('- [x] one'));
  assert.ok(toggled.includes('Tail stays intact.'));
  await saveKey(page);
  assert.equal(await disk(page), toggled);
  await page.keyboard.press(`${await modOf(page)}+z`);
  await settle(page);
  await page.keyboard.press(`${await modOf(page)}+z`);
  await settle(page);
  const afterUndos = await buf(page);
  assert.ok(afterUndos.includes('Tail stays intact.'), 'Undo must not remove unrelated text');
  assert.ok(afterUndos.includes('- [ ] one'), 'the toggle was undone');
  assert.ok(afterUndos.includes('longer cell'), 'the table survives the extra Undo');
  await saveKey(page);
  const finalDisk = await disk(page);
  assert.equal(finalDisk, afterUndos);
  assert.ok(finalDisk.includes('Tail stays intact.') && finalDisk.includes('- [ ] one'));
  await page.close();
});

test('two quick toggles land in the buffer, then a slow save writes both', async () => {
  const page = await boot('# T\n\n- [ ] one\n- [ ] two\n- [ ] three\n', { slowWrite: 150 });
  await clickBox(page, 0);
  await page.waitForTimeout(40);
  await clickBox(page, 1);
  await settle(page, 600);
  const both = '# T\n\n- [x] one\n- [x] two\n- [ ] three\n';
  assert.equal(await buf(page), both);
  await page.click('#doc h1');
  await page.keyboard.press(`${await modOf(page)}+s`);
  await settle(page, 1200);
  await rebaseAfterSave(page);
  assert.equal(await disk(page), both);
  await page.close();
});

test('the first document has working task checkboxes with a real mouse click', async () => {
  const page = await boot('# T\n\n- [ ] one\n- [ ] two\n');
  await clickBox(page, 1);
  await settle(page);
  assert.equal(await buf(page), '# T\n\n- [ ] one\n- [x] two\n');
  await saveKey(page);
  assert.equal(await disk(page), '# T\n\n- [ ] one\n- [x] two\n');
  await page.close();
});

test('a real click on the checkbox toggles it; a click on a link in the item does not', async () => {
  const page = await boot('# T\n\n- [ ] see [the site](https://example.com/x) now\n- [ ] plain\n');
  await page.evaluate(() => document.addEventListener('click', (e) => { if (e.target.closest('a')) e.preventDefault(); }));
  const [x, y] = await page.evaluate(() => {
    const r = document.querySelector('#doc li a').getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  await page.mouse.click(x, y);
  await settle(page);
  assert.equal(await disk(page), '# T\n\n- [ ] see [the site](https://example.com/x) now\n- [ ] plain\n');
  await clickBox(page, 0);
  await settle(page);
  await saveKey(page);
  assert.equal(await disk(page), '# T\n\n- [x] see [the site](https://example.com/x) now\n- [ ] plain\n');
  await page.close();
});
