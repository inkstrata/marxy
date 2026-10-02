// Mod+E, back and forward are registry commands (A-13): same chords, same exceptions in Source.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { chordMatches } from '../src/palette/commands.ts';
import { navigationCommands } from '../src/commands/navigation.ts';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const long = readFileSync(join(desktopRoot, '../../fixtures/corpus/01-long-technical.md'));
const para = (t) => `${t} `.repeat(60).trim();
const A = ['# Alpha', '', para('First'), '', '[to bravo](./b.md)', '', para('More'), ''].join('\n');
const B = ['# Bravo', '', para('Second'), ''].join('\n');
const C = ['# Charlie', '', para('Third'), ''].join('\n');
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const files = {
  '/repo/a.md': b64(A),
  '/repo/b.md': b64(B),
  '/repo/c.md': b64(C),
  '/repo/long.md': long.toString('base64'),
  '/repo/.git/HEAD': b64('ref: refs/heads/main\n'),
};
const outDir = mkdtempSync(join(tmpdir(), 'marxy-navkeys-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: { paletteBoot: join(desktopRoot, 'test/palette-boot.html') } } },
  });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css' };
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

async function boot(browser, start) {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, start }) => {
    const entry = (path, title) => ({ path, root: '/repo', title, headings: [], mtimeMs: 1, size: 1, kind: 'markdown' });
    const { handle } = await window.marxyPaletteBoot.start(files, [start], [entry('/repo/b.md', 'bravo'), entry('/repo/c.md', 'charlie')]);
    window.__h = handle;
  }, { files, start });
  const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
  return { page, mod };
}

const current = (page) => page.evaluate(() => window.__h.currentPath());
const mode = (page) => page.evaluate(() => document.body.dataset.marxyMode);
const settle = (page, path) => page.waitForFunction((p) => window.__h.currentPath() === p, path, { timeout: 8000 });

async function toSource(page, mod) {
  await page.keyboard.press(`${mod}+KeyE`);
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-content'), null, { timeout: 8000 });
  await page.waitForTimeout(400);
}

async function openViaPalette(page, mod, query) {
  await page.keyboard.press(`${mod}+KeyP`);
  await page.fill('#marxy-palette .marxy-palette-query', query);
  await page.keyboard.press('Enter');
}

test('Mod+E opens Source at the reading position and Mod+E in the editor returns to Rendered', async () => {
  const browser = await launchWebkit();
  try {
    const { page, mod } = await boot(browser, '/repo/long.md');
    await page.evaluate(() => window.scrollTo(0, 3000));
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => window.__h.sourceHarness().byteOffset);
    assert.ok(before > 0);
    await toSource(page, mod);
    assert.equal(await mode(page), 'source');
    const inSource = await page.evaluate(() => window.__h.sourceHarness().byteOffset);
    assert.ok(Math.abs(inSource - before) < 400, `${before} vs ${inSource}`);
    await page.locator('#marxy-source .cm-content').click();
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered', null, { timeout: 8000 });
    assert.equal(await mode(page), 'rendered');
  } finally {
    await browser.close();
  }
});

test('after following a relative link, Mod+[ and Alt+ArrowLeft return to the first document', async () => {
  const browser = await launchWebkit();
  try {
    const { page, mod } = await boot(browser, '/repo/a.md');
    for (const chord of [`${mod}+[`, 'Alt+ArrowLeft']) {
      await page.locator('#doc a[href="./b.md"]').click();
      await settle(page, '/repo/b.md');
      await page.waitForTimeout(300);
      await page.keyboard.press(chord);
      await settle(page, '/repo/a.md');
      assert.equal(await current(page), '/repo/a.md', chord);
    }
  } finally {
    await browser.close();
  }
});

test('Alt+ArrowLeft with the caret in Source mode does not navigate', async () => {
  const browser = await launchWebkit();
  try {
    const { page, mod } = await boot(browser, '/repo/a.md');
    await page.locator('#doc a[href="./b.md"]').click();
    await settle(page, '/repo/b.md');
    await page.waitForTimeout(300);
    await toSource(page, mod);
    await page.locator('#marxy-source .cm-content').click();
    await page.keyboard.press('Alt+ArrowLeft');
    await page.keyboard.press(`${mod}+[`);
    await page.waitForTimeout(500);
    assert.equal(await current(page), '/repo/b.md');
    assert.equal(await mode(page), 'source');
    // Source still showing but focus off the editor: still the editor's keys, not history.
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Alt+ArrowLeft');
    await page.waitForTimeout(1200);
    assert.equal(await current(page), '/repo/b.md');
    assert.equal(await mode(page), 'source');
  } finally {
    await browser.close();
  }
});

test('Mod+[ and Mod+] move through the session history after two palette opens', async () => {
  const browser = await launchWebkit();
  try {
    const { page, mod } = await boot(browser, '/repo/a.md');
    await openViaPalette(page, mod, 'bravo');
    await settle(page, '/repo/b.md');
    await openViaPalette(page, mod, 'charlie');
    await settle(page, '/repo/c.md');
    await page.waitForTimeout(300);
    await page.keyboard.press(`${mod}+[`);
    await settle(page, '/repo/b.md');
    await page.keyboard.press(`${mod}+]`);
    await settle(page, '/repo/c.md');
    await page.keyboard.press('Alt+ArrowLeft');
    await settle(page, '/repo/b.md');
    await page.keyboard.press('Alt+ArrowRight');
    await settle(page, '/repo/c.md');
    assert.equal(await current(page), '/repo/c.md');
  } finally {
    await browser.close();
  }
});

test('> in the palette lists Toggle Rendered / Source, Back and Forward with their keys', async () => {
  const browser = await launchWebkit();
  try {
    const { page, mod } = await boot(browser, '/repo/a.md');
    await page.keyboard.press(`${mod}+KeyP`);
    await page.fill('#marxy-palette .marxy-palette-query', '>');
    const rows = await page.$$eval('#marxy-palette .marxy-palette-row', (els) =>
      els.map((el) => [el.querySelector('.marxy-palette-title')?.textContent, el.querySelector('.marxy-palette-key')?.textContent]));
    const mac = mod === 'Meta';
    const find = (t) => rows.find((r) => r[0] === t);
    assert.deepEqual(find('Toggle Rendered / Source'), ['Toggle Rendered / Source', mac ? '⌘E' : 'Ctrl+E']);
    assert.deepEqual(find('Back'), ['Back', mac ? '⌘[' : 'Ctrl+[']);
    assert.deepEqual(find('Forward'), ['Forward', mac ? '⌘]' : 'Ctrl+]']);
  } finally {
    await browser.close();
  }
});

nodeTest('Ctrl+[ and Ctrl+] are history keys on a Mac as before; plain and Meta spellings are unchanged', () => {
  const ev = (key, o = {}) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o });
  const matches = (cmdId, e, mac) => {
    const c = navigationCommands().find((x) => x.id === cmdId);
    return [c.key, ...(c.keys ?? [])].some((spec) => chordMatches(e, spec, mac));
  };
  assert.equal(matches('nav.back', ev('[', { ctrlKey: true }), true), true);
  assert.equal(matches('nav.forward', ev(']', { ctrlKey: true }), true), true);
  assert.equal(matches('nav.back', ev('[', { metaKey: true }), true), true);
  assert.equal(matches('nav.back', ev('['), true), false);
  assert.equal(matches('nav.back', ev('[', { ctrlKey: true }), false), true); // Mod on Windows/Linux
});
