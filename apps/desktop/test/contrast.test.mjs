// More contrast (W-22): with the system's Increase contrast emulated (`prefers-contrast: more`) the app resolves
// `data-marxy-contrast` to `more` and the status bar's secondary text computes to at least 7:1; `contrast = "normal"` in
// config.toml keeps today's look under it; `reduce_transparency = true` makes the find fill opaque. The real app over the
// memory shell, config.toml at `/config`. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { b64, closeHarness, harnessBase, routeSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const DOC = '/r/A.md';
const TEXT = '# Alpha\n\nA paragraph long enough to be found by the find field, with the word needle in it.\n\n## Later\n\nMore.\n';

async function withApp({ config = '', variant = 'dark', media = {} }, fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.emulateMedia(media);
    const base = await harnessBase();
    await routeSkeleton(page, base);
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    await page.evaluate(
      async ({ doc, config, variant }) => {
        const enc = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
        const files = { [doc.path]: enc(doc.b64) };
        if (config !== null) files['/config'] = enc(config);
        const { createMemoryShell } = await import('/src/shell/memory.ts');
        const { bootApplication } = await import('/src/main.ts');
        const handle = await bootApplication(createMemoryShell(files), { argv: [doc.path] });
        await handle.ready;
        window.__marxyHandle = handle;
        document.documentElement.setAttribute('data-marxy-variant', variant);
        handle.workspace().unfold();
      },
      { doc: { path: DOC, b64: b64(TEXT) }, config: config === null ? null : b64(config), variant },
    );
    await page.waitForSelector('.marxy-status-bar .marxy-status-item');
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** The status bar's dimmest text against the colour under it, from computed style, ratio unrounded. */
function statusContrast(page) {
  return page.evaluate(() => {
    const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
    const groundOf = (el) => {
      const chain = [];
      for (let e = el; e; e = e.parentElement) chain.push(parse(getComputedStyle(e).backgroundColor));
      let g = { r: 255, g: 255, b: 255, a: 1 };
      for (const c of chain.reverse()) g = over(c, g);
      return g;
    };
    const items = [...document.querySelectorAll('.marxy-status-bar .marxy-status-item')].filter((e) => e.textContent.trim() !== '');
    const ratios = items.map((el) => {
      const fg = parse(getComputedStyle(el).color), bg = groundOf(el);
      const [a, b] = [lum(over(fg, bg)), lum(bg)];
      return { text: el.textContent.trim(), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), color: getComputedStyle(el).color };
    });
    return { attribute: document.documentElement.getAttribute('data-marxy-contrast'), items: ratios, min: Math.min(...ratios.map((r) => r.ratio)) };
  });
}

for (const variant of ['dark', 'light']) {
  test(`W-22: prefers-contrast: more resolves data-marxy-contrast to more and the status bar's text is 7:1 or better (${variant})`, async () => {
    await withApp({ variant, media: { contrast: 'more' } }, async (page) => {
      const got = await statusContrast(page);
      assert.equal(got.attribute, 'more');
      assert.ok(got.items.length > 0, 'the status bar has text');
      assert.ok(got.min >= 7, JSON.stringify(got.items));
    });
  });
}

test('W-22: without the system setting nothing changes, and turning it on and off is followed live', async () => {
  await withApp({ media: { contrast: 'no-preference' } }, async (page) => {
    const rest = await statusContrast(page);
    assert.equal(rest.attribute, 'normal');
    assert.ok(rest.min < 7, `at rest the status bar is under 7:1 (it is ${rest.min}), so the 7:1 below is the block's doing`);
    const restColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--marxy-color-text-secondary').trim());
    await page.emulateMedia({ contrast: 'more' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-marxy-contrast') === 'more');
    const more = await statusContrast(page);
    assert.ok(more.min >= 7, JSON.stringify(more.items));
    await page.emulateMedia({ contrast: 'no-preference' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-marxy-contrast') === 'normal');
    assert.deepEqual(await statusContrast(page), rest);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--marxy-color-text-secondary').trim()), restColor);
  });
});

test('W-22: contrast = "normal" in config.toml keeps today\'s look under the system setting', async () => {
  let rest;
  await withApp({ media: { contrast: 'no-preference' } }, async (page) => { rest = await statusContrast(page); });
  await withApp({ config: 'contrast = "normal"\n', media: { contrast: 'more' } }, async (page) => {
    const got = await statusContrast(page);
    assert.equal(got.attribute, 'normal');
    assert.deepEqual(got.items, rest.items);
  });
});

test('W-22: contrast = "more" in config.toml raises the status bar with no system setting', async () => {
  await withApp({ config: 'contrast = "more"\n', media: { contrast: 'no-preference' } }, async (page) => {
    const got = await statusContrast(page);
    assert.equal(got.attribute, 'more');
    assert.ok(got.min >= 7, JSON.stringify(got.items));
  });
});

/** The computed background of a find rectangle, drawn in the page as the fallback draws it. */
function findRectBackground(page) {
  return page.evaluate(() => {
    const layer = document.createElement('div');
    layer.className = 'marxy-find-rects';
    const rect = document.createElement('div');
    rect.className = 'marxy-find-rect';
    layer.append(rect);
    document.body.append(layer);
    const style = getComputedStyle(rect);
    const out = { background: style.backgroundColor, blend: style.mixBlendMode, attribute: document.documentElement.getAttribute('data-marxy-transparency') };
    layer.remove();
    return out;
  });
}

test('W-22: reduce_transparency = true makes the find fill opaque; unset, it is translucent as today', async () => {
  await withApp({ config: '', media: { contrast: 'no-preference' } }, async (page) => {
    const got = await findRectBackground(page);
    assert.equal(got.attribute, null);
    assert.match(got.background, /^color\(srgb [\d. ]+ \/ 0\.55\)$|^rgba\(.*0\.55\)$/);
  });
  await withApp({ config: 'reduce_transparency = true\n', media: { contrast: 'no-preference' } }, async (page) => {
    const got = await findRectBackground(page);
    assert.equal(got.attribute, 'reduced');
    assert.match(got.background, /^rgb\(\d+, \d+, \d+\)$/, got.background);
  });
});

test('W-22: more contrast makes the find fill and the toolbar fade solid too', async () => {
  await withApp({ media: { contrast: 'more' } }, async (page) => {
    const got = await findRectBackground(page);
    assert.match(got.background, /^rgb\(\d+, \d+, \d+\)$/, got.background);
    const toolbar = await page.evaluate(() => getComputedStyle(document.querySelector('.marxy-toolbar')).backgroundImage);
    assert.ok(!/transparent|rgba\(|\/ 0\./.test(toolbar), toolbar);
  });
});
