// The summoned outline (A-15): closed at rest, rows equal outlineFrom, mark follows scrolling,
// ↓ ↓ Enter lands the third heading, Esc returns focus to the article.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { outlineFrom, parseMarkdown } from '@marxy/core';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const fixture = readFileSync(join(desktopRoot, '../../fixtures/corpus/01-long-technical.md'));
const entries = outlineFrom(parseMarkdown(fixture, { file: '/docs/long.md' }));
const files = { '/docs/long.md': fixture.toString('base64') };
const outDir = mkdtempSync(join(tmpdir(), 'marxy-outline-'));
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

async function boot(browser) {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files }) => {
    const { handle } = await window.marxyPaletteBoot.start(files, ['/docs/long.md']);
    window.__h = handle;
  }, { files });
  const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
  return { page, chord: `${mod}+Shift+KeyO` };
}

const rowsOf = (page) =>
  page.$$eval('#marxy-outline .marxy-outline-row', (els) =>
    els.map((el) => ({ text: el.textContent, level: Number(el.style.getPropertyValue('--marxy-outline-level')) })));
const markedOf = (page) =>
  page.$$eval('#marxy-outline .marxy-outline-row', (els) =>
    els.map((el, i) => (el.getAttribute('aria-current') === 'true' ? i : -1)).filter((i) => i >= 0));
const dialogOpen = (page) => page.evaluate(() => document.getElementById('marxy-outline')?.hasAttribute('open') ?? false);

test('at rest no outline is open; Mod+Shift+O opens rows equal to outlineFrom', async () => {
  const browser = await launchWebkit();
  try {
    const { page, chord } = await boot(browser);
    assert.equal(await dialogOpen(page), false, 'closed at rest');
    assert.equal(await page.$$eval('#marxy-outline .marxy-outline-row', (e) => e.length), 0);
    await page.keyboard.press(chord);
    assert.equal(await dialogOpen(page), true);
    assert.ok(entries.length > 5);
    assert.deepEqual(await rowsOf(page), entries.map((e) => ({ text: e.text, level: e.level })));
    const box = await page.$eval('#marxy-outline', (el) => { const r = el.getBoundingClientRect(); return { right: r.right, width: r.width }; });
    assert.equal(Math.round(box.right), 960);
    assert.ok(box.width <= 320);
  } finally {
    await browser.close();
  }
});

test('the mark is the last heading at or above the reading position and follows a scroll', async () => {
  const browser = await launchWebkit();
  try {
    const { page, chord } = await boot(browser);
    await page.keyboard.press(chord);
    assert.deepEqual(await markedOf(page), [0]);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction(() => document.querySelector('#marxy-outline [aria-current="true"]')?.id !== 'marxy-outline-row-0');
    const position = await page.evaluate(() => window.__h.sourceHarness().byteOffset);
    let expected = -1;
    entries.forEach((e, i) => { if (e.src.start <= position) expected = i; });
    assert.ok(expected > 0);
    assert.deepEqual(await markedOf(page), [expected]);
  } finally {
    await browser.close();
  }
});

test('Down Down Enter lands the third heading on the reading line and closes the outline', async () => {
  const browser = await launchWebkit();
  try {
    const { page, chord } = await boot(browser);
    await page.keyboard.press(chord);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('marxy-outline')?.hasAttribute('open'));
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => window.__h.sourceHarness().byteOffset), entries[2].src.start);
  } finally {
    await browser.close();
  }
});

test('Esc closes the outline and the article has focus', async () => {
  const browser = await launchWebkit();
  try {
    const { page, chord } = await boot(browser);
    await page.keyboard.press(chord);
    assert.equal(await dialogOpen(page), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialogOpen(page), false);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'doc');
  } finally {
    await browser.close();
  }
});
