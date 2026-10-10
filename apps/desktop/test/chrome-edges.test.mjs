// The palette and outline read the contract v2 edge roles (H-03.1, ADR-0059): real WebKit, the palette harness.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
const outDir = mkdtempSync(join(tmpdir(), 'marxy-chrome-edges-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot, logLevel: 'silent',
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

const FILES = { '/repo/README.md': '# Home\n\n## Part\n\nText.\n' };

async function boot(browser) {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async (files) => {
    const r = await window.marxyPaletteBoot.start(files, ['/repo/README.md'], []);
    window.__h = r.handle;
  }, Object.fromEntries(Object.entries(FILES).map(([k, v]) => [k, Buffer.from(v, 'utf8').toString('base64')])));
  const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+KeyP`);
  await page.waitForSelector('#marxy-palette[open]');
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${mod}+Shift+KeyO`);
  await page.waitForSelector('#marxy-outline[open]');
  await page.keyboard.press(`${mod}+KeyP`);
  await page.waitForSelector('#marxy-palette[open]');
  return page;
}

// Resolves each role to a distinct colour, so a repoint to the wrong role cannot pass.
const read = (page) => page.evaluate(() => {
  const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
  const row = document.querySelector('#marxy-outline .marxy-outline-row');
  row?.setAttribute('aria-selected', 'true');
  const wash = row ? getComputedStyle(row).backgroundColor : null;
  return {
    paletteOutline: css('#marxy-palette', 'borderTopColor'),
    queryEdge: css('#marxy-palette .marxy-palette-query', 'borderBottomColor'),
    outlineOutline: css('#marxy-outline', 'borderInlineStartColor'),
    outlineWash: wash,
  };
});

test('a theme that sets the v2 roles repaints the palette and outline edges and the outline wash', async () => {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser);
    const before_ = await read(page);
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.textContent = ':root { --marxy-color-rule-strong: rgb(1, 2, 3); --marxy-color-edge: rgb(4, 5, 6); --marxy-color-accent-wash: rgb(7, 8, 9); }';
      document.head.append(s);
    });
    const after_ = await read(page);
    assert.equal(after_.paletteOutline, 'rgb(1, 2, 3)');
    assert.equal(after_.outlineOutline, 'rgb(1, 2, 3)');
    assert.equal(after_.queryEdge, 'rgb(4, 5, 6)');
    assert.equal(after_.outlineWash, 'rgb(7, 8, 9)');
    assert.notDeepEqual(before_, after_);
  } finally { await browser.close(); }
});

test('with no theme override the edges resolve through the v1 fallbacks the default declares', async () => {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser);
    const got = await read(page);
    const roles = await page.evaluate(() => {
      const probe = document.createElement('i');
      document.body.append(probe);
      const of = (v) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; };
      return { rule: of('--marxy-color-rule'), secondary: of('--marxy-color-text-secondary'), selection: of('--marxy-color-selection') };
    });
    assert.equal(got.paletteOutline, roles.rule);
    assert.equal(got.queryEdge, roles.secondary);
    assert.equal(got.outlineWash, roles.selection);
  } finally { await browser.close(); }
});
