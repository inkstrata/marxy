// Palette input guards (MARXY-337): history keys leave editors alone, the open flag follows the
// native dialog, result rows are clickable, and an IME's keys stay the IME's. Real WebKit.
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

const outDir = mkdtempSync(join(tmpdir(), 'marxy-palette-guards-'));
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
      rollupOptions: { input: { paletteBoot: join(desktopRoot, 'test/palette-boot.html') } },
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

const FILES = { '/repo/README.md': '# Home\n\nsome words here\n', '/repo/docs/guide.md': '# Guide\n\nbody\n' };
const entry = (path, title) => ({ path, root: '/repo', title, headings: [], mtimeMs: 1, size: 1, kind: 'markdown' });

async function boot(browser) {
  const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, entries }) => {
    const b64 = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, btoa(v)]));
    const r = await window.marxyPaletteBoot.start(b64, ['/repo/README.md'], entries);
    window.__handle = r.handle;
  }, { files: FILES, entries: [entry('/repo/README.md', 'Home'), entry('/repo/docs/guide.md', 'Guide')] });
  await page.waitForFunction(() => typeof window.marxySelection?.getSelectionState === 'function');
  return page;
}
const current = (page) => page.evaluate(() => window.__handle.currentPath());
const dialogOpen = (page) => page.evaluate(() => document.getElementById('marxy-palette').open);
const openViaPalette = async (page, query) => {
  await page.keyboard.press('Meta+KeyP');
  await page.keyboard.type(query);
  await page.keyboard.press('Enter');
  await page.waitForFunction((q) => window.__handle.currentPath().toLowerCase().includes(q), query);
};

test('Option+Arrow and Cmd+[ inside the Source editor are the editor\'s, not palette history', async () => {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser);
    // Two opens, so there is a history entry for a stray Back to travel to.
    await openViaPalette(page, 'guide');
    await openViaPalette(page, 'readme');
    await page.keyboard.press('Meta+KeyE');
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    await page.click('.cm-content');
    await page.keyboard.press('Meta+ArrowDown');
    await page.keyboard.type('typed text');
    for (const chord of ['Alt+ArrowLeft', 'Alt+ArrowRight', 'Meta+BracketLeft', 'Meta+BracketRight']) {
      await page.keyboard.press(chord);
      await page.waitForTimeout(150);
      assert.equal(await current(page), '/repo/README.md', `${chord} must not navigate`);
      assert.equal(await page.evaluate(() => document.body.dataset.marxyMode), 'source');
      assert.match(await page.evaluate(() => document.querySelector('.cm-content').textContent), /typed text/);
    }
    // Focus off the editor while Source is still showing: still not history.
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Alt+ArrowLeft');
    await page.waitForTimeout(150);
    assert.equal(await current(page), '/repo/README.md');
  } finally {
    await browser.close();
  }
});

test('history keys still walk history in Rendered mode', async () => {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser);
    await openViaPalette(page, 'guide');
    await openViaPalette(page, 'readme');
    await page.keyboard.press('Alt+ArrowLeft');
    await page.waitForFunction(() => window.__handle.currentPath() === '/repo/docs/guide.md');
  } finally {
    await browser.close();
  }
});

test('Escape with focus off the input (native dialog cancel) leaves the palette summonable', async () => {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser);
    await page.keyboard.press('Meta+KeyP');
    assert.equal(await dialogOpen(page), true);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    assert.equal(await dialogOpen(page), false);
    await page.keyboard.press('Meta+KeyP');
    assert.equal(await dialogOpen(page), true, 'the next Cmd+P summons rather than "dismissing" a closed dialog');
  } finally {
    await browser.close();
  }
});

test('clicking a result row opens that hit', async () => {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser);
    await page.keyboard.press('Meta+KeyP');
    await page.keyboard.type('guide');
    await page.click('.marxy-palette-row');
    await page.waitForFunction(() => window.__handle.currentPath() === '/repo/docs/guide.md');
    assert.equal(await dialogOpen(page), false);
  } finally {
    await browser.close();
  }
});

test('keys that drive an IME composition do not act on the palette', async () => {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser);
    await page.keyboard.press('Meta+KeyP');
    await page.keyboard.type('guide');
    const fire = (key, init) => page.evaluate(([k, i]) => {
      const input = document.querySelector('.marxy-palette-query');
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...i });
      input.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, [key, init]);
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      for (const key of ['Enter', 'Escape', 'ArrowDown', 'ArrowUp', 'Tab']) {
        assert.equal(await fire(key, init), false, `${key} ${JSON.stringify(init)} must be left to the IME`);
      }
    }
    assert.equal(await dialogOpen(page), true);
    assert.equal(await current(page), '/repo/README.md');
    // Outside composition Escape still dismisses.
    assert.equal(await fire('Escape', {}), true);
    assert.equal(await dialogOpen(page), false);
  } finally {
    await browser.close();
  }
});
