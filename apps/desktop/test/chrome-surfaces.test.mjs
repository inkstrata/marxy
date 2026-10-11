// One chrome for every summoned surface and every menu (W-04): the palette, the verb menu, find and the outline
// share one spec, read from the tokens and scaled by the chrome size. Computed style in real WebKit on the palette harness;
// the static half (no literal shadow colour, radius or face in those rules) is packages/theme/src/chrome-spec.test.ts.
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
const corpusDir = join(desktopRoot, '..', '..', 'fixtures', 'corpus');
const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
const outDir = mkdtempSync(join(tmpdir(), 'marxy-chrome-surfaces-'));
let server;
let base;
let browser;

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
  browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
  server?.close();
});

const FILE = '28-llm-answer.md';

async function boot(variant = 'dark', chrome = 13) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, argv, variant, chrome }) => {
    document.documentElement.setAttribute('data-marxy-variant', variant);
    window.__marxyOpsBoot = await window.marxyPaletteBoot.start(files, argv, []);
    document.documentElement.style.setProperty('--marxy-size-chrome', `${chrome}px`);
  }, { files: { [`/corpus/${FILE}`]: readFileSync(join(corpusDir, FILE)).toString('base64') }, argv: [`/corpus/${FILE}`], variant, chrome });
  await page.waitForFunction(() => window.__marxyOpenSynced === true);
  return page;
}

const mod = async (page) => ((await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control');

/** Open each surface in turn and read what it computes, beside what the tokens resolve to on a probe. */
async function surfaces(page) {
  const out = {};
  const read = (selector) => page.evaluate((selector) => {
    const probe = document.createElement('div');
    probe.style.cssText = 'box-shadow: var(--marxy-shadow-surface); font-family: var(--marxy-face-chrome); font-size: var(--marxy-size-chrome); background: var(--marxy-color-surface)';
    document.body.append(probe);
    const want = getComputedStyle(probe);
    const expected = { boxShadow: want.boxShadow, fontFamily: want.fontFamily, fontSize: want.fontSize, backgroundColor: want.backgroundColor };
    probe.remove();
    const el = document.querySelector(selector);
    const got = getComputedStyle(el);
    return {
      expected,
      boxShadow: got.boxShadow, fontFamily: got.fontFamily, fontSize: got.fontSize, backgroundColor: got.backgroundColor,
      radius: got.borderTopLeftRadius, radiusEnd: got.borderBottomLeftRadius, borderColor: got.borderTopColor, borderWidth: got.borderTopWidth,
    };
  }, selector);
  const key = await mod(page);
  await page.keyboard.press(`${key}+KeyP`);
  await page.waitForSelector('#marxy-palette[open]');
  out.palette = await read('#marxy-palette');
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${key}+Shift+KeyO`);
  await page.waitForSelector('#marxy-outline[open]');
  out.outline = await read('#marxy-outline');
  await page.keyboard.press('Escape');
  await page.locator('#doc pre[data-marxy-s]').first().click({ button: 'right' });
  await page.waitForSelector('.marxy-verb-menu');
  out.verbMenu = await read('.marxy-verb-menu');
  await page.keyboard.press('Escape');
  await page.locator('#doc').click();
  await page.keyboard.press(`${key}+KeyF`);
  await page.waitForSelector('.marxy-find');
  out.find = await read('.marxy-find');
  await page.keyboard.press('Escape');
  return out;
}

for (const variant of ['dark', 'light']) {
  test(`${variant}: each raised surface computes the surface shadow, the chrome face and a radius of 6, 9 or 13 px at 13 px chrome`, async () => {
    const page = await boot(variant, 13);
    try {
      const got = await surfaces(page);
      const radii = { palette: 9, outline: 13, verbMenu: 6, find: 6 };
      for (const [name, s] of Object.entries(got)) {
        assert.equal(s.fontFamily, s.expected.fontFamily, `${name}: the chrome face`);
        assert.equal(s.fontSize, s.expected.fontSize, `${name}: the chrome size`);
        assert.equal(s.radius, `${radii[name]}px`, `${name}: radius`);
        assert.equal(s.boxShadow, s.expected.boxShadow, `${name}: box-shadow is the resolved --marxy-shadow-surface`);
        assert.equal(s.backgroundColor, s.expected.backgroundColor, `${name}: the surface ground`);
      }
      assert.equal(got.outline.radiusEnd, '13px', 'the outline rounds the corners that face the page');
      assert.notEqual(got.palette.boxShadow, 'none', `${variant} has a shadow to read`);
    } finally {
      await page.close();
    }
  });
}

/** Rows of the verb menu and of the palette's command list, with their geometry. */
async function rows(page, which) {
  return page.evaluate((which) => {
    const sel = which === 'verb' ? '.marxy-verb-menu [role="menuitem"]' : '#marxy-palette .marxy-palette-row';
    return [...document.querySelectorAll(sel)].map((row) => {
      const cs = getComputedStyle(row);
      const key = row.querySelector(which === 'verb' ? '.marxy-verb-menu-key' : '.marxy-palette-key');
      return {
        height: row.getBoundingClientRect().height,
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
        keyRight: key ? Math.round(key.getBoundingClientRect().right * 10) / 10 : null,
        rowRight: row.getBoundingClientRect().right,
      };
    });
  }, which);
}

for (const chrome of [13, 16, 26]) {
  test(`menu rows are round(28 x ${chrome} / 13) high, padded 5 by 10 scaled, and every shortcut ends at one x`, async () => {
    const page = await boot('dark', chrome);
    try {
      const want = Math.round((28 * chrome) / 13);
      const padY = `${(5 * chrome) / 13}px`;
      const padX = `${(10 * chrome) / 13}px`;
      const near = (a, b) => Math.abs(parseFloat(a) - parseFloat(b)) < 0.06;
      // The verb menu.
      await page.locator('#doc pre[data-marxy-s]').first().click({ button: 'right' });
      await page.waitForSelector('.marxy-verb-menu');
      const verb = await rows(page, 'verb');
      assert.ok(verb.length >= 2, 'rows');
      for (const r of verb) {
        assert.equal(r.height, want, `verb row height at ${chrome}`);
        assert.ok(near(r.pad[0], padY) && near(r.pad[2], padY) && near(r.pad[1], padX) && near(r.pad[3], padX), `verb padding ${r.pad} at ${chrome}`);
      }
      const verbKeys = verb.filter((r) => r.keyRight !== null);
      assert.ok(verbKeys.length >= 1);
      assert.equal(new Set(verbKeys.map((r) => r.keyRight)).size, 1, 'the verb menu shortcuts share a right edge');
      await page.keyboard.press('Escape');
      // The palette's command list.
      const key = await mod(page);
      await page.keyboard.press(`${key}+Shift+KeyP`);
      await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
      const palette = (await rows(page, 'palette')).slice(0, 12);
      assert.ok(palette.length >= 4, 'rows');
      for (const r of palette) {
        assert.equal(r.height, want, `palette row height at ${chrome}`);
        assert.ok(near(r.pad[0], padY) && near(r.pad[1], padX), `palette padding ${r.pad} at ${chrome}`);
      }
      const keys = palette.filter((r) => r.keyRight !== null);
      assert.ok(keys.length >= 2, 'several rows show a shortcut');
      assert.equal(new Set(keys.map((r) => r.keyRight)).size, 1, 'the palette shortcuts share a right edge');
      assert.ok(Math.abs(keys[0].keyRight - (keys[0].rowRight - parseFloat(padX))) < 0.2, 'the shortcut is right-aligned inside the padding');
    } finally {
      await page.close();
    }
  });
}

test('the icon gap in a palette row is 8 px at 13 and scales with the chrome size', async () => {
  for (const chrome of [13, 26]) {
    const page = await boot('dark', chrome);
    try {
      await page.keyboard.press(`${await mod(page)}+Shift+KeyP`);
      await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
      const gap = await page.evaluate(() => getComputedStyle(document.querySelector('#marxy-palette .marxy-palette-row')).columnGap);
      assert.equal(gap, `${(8 * chrome) / 13}px`);
    } finally {
      await page.close();
    }
  }
});

test('the article is untouched by the chrome size and by any surface being open: font, size and line box', async () => {
  const article = (page) => page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('doc'));
    const p = getComputedStyle(document.querySelector('#doc p'));
    return { fontFamily: cs.fontFamily, fontSize: cs.fontSize, lineHeight: cs.lineHeight, pFont: p.fontFamily, pSize: p.fontSize, pLine: p.lineHeight };
  });
  const seen = [];
  for (const chrome of [13, 26]) {
    const page = await boot('dark', chrome);
    try {
      const closed = await article(page);
      await page.keyboard.press(`${await mod(page)}+KeyP`);
      await page.waitForSelector('#marxy-palette[open]');
      assert.deepEqual(await article(page), closed, 'palette open');
      seen.push(closed);
    } finally {
      await page.close();
    }
  }
  assert.deepEqual(seen[0], seen[1], 'chrome 13 and 26 set the same article');
});

test('forced-colors: the surfaces keep a CanvasText border and no shadow', async () => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, forcedColors: 'active' });
  try {
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    await page.evaluate(async ({ files, argv }) => {
      window.__marxyOpsBoot = await window.marxyPaletteBoot.start(files, argv, []);
    }, { files: { [`/corpus/${FILE}`]: readFileSync(join(corpusDir, FILE)).toString('base64') }, argv: [`/corpus/${FILE}`] });
    await page.waitForFunction(() => window.__marxyOpenSynced === true);
    await page.locator('#doc pre[data-marxy-s]').first().click({ button: 'right' });
    await page.waitForSelector('.marxy-verb-menu');
    const menu = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.marxy-verb-menu'));
      const text = document.createElement('div');
      text.style.color = 'CanvasText';
      document.body.append(text);
      const canvasText = getComputedStyle(text).color;
      text.remove();
      return { shadow: cs.boxShadow, border: cs.borderTopColor, canvasText };
    });
    assert.equal(menu.shadow, 'none');
    assert.equal(menu.border, menu.canvasText);
    await page.keyboard.press('Escape');
    await page.keyboard.press(`${await mod(page)}+KeyP`);
    await page.waitForSelector('#marxy-palette[open]');
    const palette = await page.evaluate(() => getComputedStyle(document.getElementById('marxy-palette')).boxShadow);
    assert.equal(palette, 'none');
  } finally {
    await page.close();
  }
});
