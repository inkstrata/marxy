// What follows an open waits for the reader (F-21). Over unsaved edits `open()` shows the Save / Open without
// saving / Dismiss notice and resolves at once, so a link's landing and its history entry, and Edit
// collection's switch to Source, must run only once the new document is on screen, never on the old one.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'marxy-open-then-act-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: { paletteBoot: join(desktopRoot, 'test/palette-boot.html') } } },
  });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.css': 'text/css' };
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

const filler = `${'word '.repeat(40)}\n\n`;
const FILES = {
  '/repo/.git/HEAD': 'ref: refs/heads/main\n',
  '/repo/linky.md': `# Linky\n\n- [ ] task\n\n[to guide](docs/guide.md#guide)\n\n${filler.repeat(30)}## Guide\n\nLinky has its own Guide heading.\n`,
  '/repo/docs/guide.md': `# Top\n\n${filler.repeat(30)}## Guide\n\nThe guide heading is down here.\n\n${filler.repeat(30)}`,
  '/collection.toml': '[[root]]\npath = "/repo"\n',
};

async function bootDirty(browser) {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async (files) => {
    const r = await window.marxyPaletteBoot.start(files, ['/repo/linky.md']);
    window.__h = r.handle;
    await r.handle.collection.loaded;
  }, Object.fromEntries(Object.entries(FILES).map(([k, v]) => [k, Buffer.from(v, 'utf8').toString('base64')])));
  await page.waitForFunction(() => window.__marxyTasksReady === true);
  await page.evaluate(() => document.querySelector('#doc input[type=checkbox]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await page.waitForFunction(() => window.marxyDocumentEdit().dirty === true);
  await page.waitForTimeout(150);
  return page;
}

const followLink = (page) => page.evaluate(() => {
  [...document.querySelectorAll('#doc a')].find((x) => /to guide/.test(x.textContent))
    .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
const editCollection = async (page) => {
  await page.keyboard.press(`${(await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control'}+KeyP`);
  await page.waitForSelector('#marxy-palette[open]');
  await page.fill('#marxy-palette .marxy-palette-query', '>Edit collection');
  await page.keyboard.press('Enter');
};
const asked = async (page) => {
  await page.waitForFunction(() => document.querySelectorAll('#marxy-notices .marxy-notice button').length > 0);
  await page.waitForTimeout(300);
};
const choose = (page, label) =>
  page.evaluate((l) => [...document.querySelectorAll('#marxy-notices .marxy-notice button')].find((b) => b.textContent === l).click(), label);
const state = async (page) => ({
  path: await page.evaluate(() => window.__h.currentPath()),
  mode: await page.evaluate(() => document.body.dataset.marxyMode),
  dirty: await page.evaluate(() => window.marxyDocumentEdit().dirty),
  scrollY: await page.evaluate(() => window.scrollY),
  writes: await page.evaluate(() => window.__h.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === '/repo/linky.md').length),
});
/** True once the Guide heading is at or above the lower part of the viewport (the landing happened). */
const guideLanded = (page) => page.evaluate(() => {
  const h = [...document.querySelectorAll('#doc h2')].find((x) => x.textContent === 'Guide');
  return h ? h.getBoundingClientRect().top < window.innerHeight * 0.6 && h.getBoundingClientRect().top > -50 : false;
});

// ---- the link ----

test('link over unsaved edits, Dismiss: the page does not move and the history records nothing', async () => {
  const browser = await launchWebkit();
  try {
    const page = await bootDirty(browser);
    const before = await state(page);
    await followLink(page);
    await asked(page);
    await choose(page, 'Dismiss');
    await page.waitForTimeout(500);
    const after = await state(page);
    assert.deepEqual(after, before, 'nothing in the current document changed (path, mode, edit, scroll, writes)');
    assert.equal(await guideLanded(page), false, "linky.md's own Guide heading was not scrolled to");
    assert.equal(await page.evaluate(() => window.__h.selection.back()), false, 'no history entry was recorded');
  } finally {
    await browser.close();
  }
});

test('link over unsaved edits, Open without saving: guide.md opens at its heading and the move is in the history', async () => {
  const browser = await launchWebkit();
  try {
    const page = await bootDirty(browser);
    await followLink(page);
    await asked(page);
    await choose(page, 'Open without saving');
    await page.waitForFunction(() => window.__h.currentPath() === '/repo/docs/guide.md');
    await page.waitForFunction(() => {
      const h = [...document.querySelectorAll('#doc h2')].find((x) => x.textContent === 'Guide');
      return h && h.getBoundingClientRect().top < window.innerHeight * 0.6 && h.getBoundingClientRect().top > -50;
    });
    assert.equal((await state(page)).writes, 0, 'nothing was written');
    assert.equal(await page.evaluate(() => window.__h.selection.back()), true, 'back goes to linky.md');
    await page.waitForFunction(() => window.__h.currentPath() === '/repo/linky.md');
  } finally {
    await browser.close();
  }
});

test('link over unsaved edits, Save and open: writes linky.md, then lands guide.md at its heading', async () => {
  const browser = await launchWebkit();
  try {
    const page = await bootDirty(browser);
    await followLink(page);
    await asked(page);
    await choose(page, 'Save and open');
    await page.waitForFunction(() => window.__h.currentPath() === '/repo/docs/guide.md');
    await page.waitForFunction(() => {
      const h = [...document.querySelectorAll('#doc h2')].find((x) => x.textContent === 'Guide');
      return h && h.getBoundingClientRect().top < window.innerHeight * 0.6 && h.getBoundingClientRect().top > -50;
    });
    assert.equal((await state(page)).writes, 1);
    assert.equal(await page.evaluate(() => window.__h.selection.back()), true);
  } finally {
    await browser.close();
  }
});

// ---- Edit collection ----

test('Edit collection over unsaved edits, Dismiss: the document stays in Rendered', async () => {
  const browser = await launchWebkit();
  try {
    const page = await bootDirty(browser);
    const before = await state(page);
    await editCollection(page);
    await asked(page);
    await choose(page, 'Dismiss');
    await page.waitForTimeout(500);
    assert.deepEqual(await state(page), before, 'still linky.md, still Rendered, edit kept');
    assert.equal(before.mode, 'rendered');
  } finally {
    await browser.close();
  }
});

test('Edit collection over unsaved edits, Open without saving: collection.toml opens in Source', async () => {
  const browser = await launchWebkit();
  try {
    const page = await bootDirty(browser);
    await editCollection(page);
    await asked(page);
    await choose(page, 'Open without saving');
    await page.waitForFunction(() => window.__h.currentPath() === '/collection.toml');
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    assert.equal((await state(page)).writes, 0);
  } finally {
    await browser.close();
  }
});

test('Edit collection over unsaved edits, Save and open: writes linky.md, then collection.toml opens in Source', async () => {
  const browser = await launchWebkit();
  try {
    const page = await bootDirty(browser);
    await editCollection(page);
    await asked(page);
    await choose(page, 'Save and open');
    await page.waitForFunction(() => window.__h.currentPath() === '/collection.toml');
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    assert.equal((await state(page)).writes, 1);
  } finally {
    await browser.close();
  }
});
