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

// Two headings only, but tall enough that landing the second can reach the reading line.
const filler = Array.from({ length: 60 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');
const shortDoc = Buffer.from(`# One\n\n${filler}\n\n# Two\n\n${filler}\n`);

async function boot(browser, extra = {}) {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files }) => {
    const { handle } = await window.marxyPaletteBoot.start(files, ['/docs/long.md']);
    window.__h = handle;
  }, { files: { ...files, ...extra } });
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

async function toSource(page, mod) {
  await page.keyboard.press(`${mod}+KeyE`);
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-content'), null, { timeout: 8000 });
  await page.waitForTimeout(500);
}

test('from Source mode, Mod+Shift+O, a row and Enter return to Rendered at that heading', async () => {
  const browser = await launchWebkit();
  try {
    const { page, chord } = await boot(browser);
    const mod = chord.split('+')[0];
    await toSource(page, mod);
    await page.keyboard.press(chord);
    assert.equal(await dialogOpen(page), true);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered', null, { timeout: 8000 });
    await page.waitForTimeout(800);
    assert.equal(await dialogOpen(page), false);
    const harness = await page.evaluate(() => window.__h.sourceHarness());
    assert.equal(harness.mode, 'rendered');
    assert.equal(harness.byteOffset, entries[2].src.start);
  } finally {
    await browser.close();
  }
});

test('Esc in Source mode leaves focus in the editor, not on a hidden element', async () => {
  const browser = await launchWebkit();
  try {
    const { page, chord } = await boot(browser);
    await toSource(page, chord.split('+')[0]);
    await page.keyboard.press(chord);
    await page.keyboard.press('Escape');
    assert.equal(await dialogOpen(page), false);
    const focus = await page.evaluate(() => {
      const a = document.activeElement;
      return { inEditor: a?.classList.contains('cm-content') ?? false, visible: !!a && a.getClientRects().length > 0 };
    });
    assert.deepEqual(focus, { inEditor: true, visible: true });
  } finally {
    await browser.close();
  }
});

test('> in the palette lists Outline with its key; Enter opens the outline and closes the palette', async () => {
  const browser = await launchWebkit();
  try {
    const { page, chord } = await boot(browser);
    const mod = chord.split('+')[0];
    await page.keyboard.press(`${mod}+KeyP`);
    await page.fill('#marxy-palette .marxy-palette-query', '>outline');
    const rows = await page.$$eval('#marxy-palette .marxy-palette-row', (els) =>
      els.map((el) => ({
        title: el.querySelector('.marxy-palette-title')?.textContent ?? el.textContent,
        key: el.querySelector('.marxy-palette-key')?.textContent ?? null,
      })));
    const row = rows.find((r) => r.title === 'Outline');
    assert.ok(row, JSON.stringify(rows));
    assert.match(row.key, /^(⇧⌘O|Ctrl\+Shift\+O)$/);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('marxy-outline')?.hasAttribute('open'));
    assert.equal(await page.evaluate(() => document.getElementById('marxy-palette').open), false);
  } finally {
    await browser.close();
  }
});

test('Mod+Shift+O with the palette open closes the palette: overlays are exclusive', async () => {
  const browser = await launchWebkit();
  try {
    const { page, chord } = await boot(browser);
    await page.keyboard.press(`${chord.split('+')[0]}+KeyP`);
    assert.equal(await page.evaluate(() => document.getElementById('marxy-palette').open), true);
    await page.keyboard.press(chord);
    assert.equal(await dialogOpen(page), true);
    assert.equal(await page.evaluate(() => document.getElementById('marxy-palette').open), false);
  } finally {
    await browser.close();
  }
});

const selectedOf = (page) =>
  page.$$eval('#marxy-outline .marxy-outline-row', (els) =>
    els.map((el, i) => (el.getAttribute('aria-selected') === 'true' ? i : -1)).filter((i) => i >= 0));

test('opening another document with the outline open keeps the selected row on the marked one, and Enter lands it', async () => {
  for (const [from, to] of [['/docs/long.md', '/docs/short.md'], ['/docs/short.md', '/docs/long.md']]) {
    const browser = await launchWebkit();
    try {
      const { page, chord } = await boot(browser, { '/docs/short.md': shortDoc.toString('base64') });
      if (from !== '/docs/long.md') {
        await page.evaluate((p) => window.__h.open(p), from);
        await page.waitForTimeout(400);
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.keyboard.press(chord);
      await page.waitForTimeout(400);
      const targets = to === '/docs/short.md' ? outlineFrom(parseMarkdown(shortDoc, { file: to })) : entries;
      const at = targets[to === '/docs/short.md' ? 1 : 5].src.start;
      await page.evaluate(([p, at]) => window.__h.open(p, { at }), [to, at]);
      await page.waitForFunction((p) => window.__h.openDocument()?.path === p, to);
      await page.waitForTimeout(600);
      const marked = await markedOf(page);
      assert.equal(marked.length, 1, `${from} -> ${to}: one row marked`);
      assert.deepEqual(await selectedOf(page), marked, `${from} -> ${to}: selected equals marked`);
      const rows = await page.$$eval('#marxy-outline .marxy-outline-row', (e) => e.length);
      const target = targets[marked[0]];
      assert.ok(rows > marked[0] && target);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.getElementById('marxy-outline')?.hasAttribute('open'));
      await page.waitForTimeout(600);
      const landed = await page.evaluate(() => window.__h.sourceHarness().byteOffset);
      assert.equal(landed, target.src.start);
    } finally {
      await browser.close();
    }
  }
});
