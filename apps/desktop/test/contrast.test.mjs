// More contrast: with the system's Increase contrast emulated (`prefers-contrast: more`) the app resolves
// `data-marxy-contrast` to `more` and the frame's quiet text (the tabs not in front, the left section's card heads, notes and
// fact keys, Places' labels, counts and foot) computes to at least 7:1 on the ground under it; `contrast = "normal"`
// in config.toml keeps today's look under it; `reduce_transparency = true` makes the find fill opaque. The real app over
// the memory shell, config.toml at `/config`. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { drawerShows, showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const DOC = '/r/A.md';
const FILES = {
  [DOC]: '# Alpha\n\nA paragraph long enough to be found by the find field, with the word needle in it.\n\n## Later\n\nMore.\n',
  '/r/B.md': '# Beta\n\nA second file, so a tab is not in front.\n',
};

/**
 * The frame's quiet text: what takes the secondary and faint roles in the tab row, the head and the left section's panels,
 * by the panel that draws it (the cards are Metadata's and Outline's, the counts and foot Places').
 */
const QUIET = {
  places: [
    '.marxy-tabbar .marxy-tab:not([aria-selected="true"]) .marxy-tab-name',
    '.marxy-head .marxy-crumb[data-marxy-crumb="root"]',
    '.marxy-drawer .marxy-l-head .marxy-l-subject',
    '.marxy-drawer .marxy-l-census',
    '.marxy-drawer .marxy-l-gh .marxy-l-n',
    '.marxy-drawer .marxy-l-foot',
  ],
  // The document panels are rows: section heads and their notes, the keys of The file, the quiet words.
  metadata: [
    '.marxy-drawer .marxy-l-sec span',
    '.marxy-drawer .marxy-l-sec em',
    '.marxy-drawer .marxy-l-kv > span:first-child',
  ],
  outline: ['.marxy-drawer .marxy-l-row .marxy-l-n'],
};
/** The app with a tab behind the one in front, Places open in the docked drawer, under `config` and `media`. */
async function withApp({ config, variant = 'dark', media = {} }, fn) {
  await withFrame({ files: FILES, open: ['/r/B.md'], config, media }, async (page, { mod }) => {
    await page.evaluate(async ({ doc, variant }) => {
      await window.__marxyHandle.open(doc);
      document.documentElement.setAttribute('data-marxy-variant', variant);
    }, { doc: DOC, variant });
    await page.keyboard.press(`${mod}+Shift+E`);
    await drawerShows(page, 'places');
    await page.waitForSelector('.marxy-drawer .marxy-l-prow[data-marxy-left-row="f:/r/A.md"]');
    await fn(page);
  });
}

/** Each kind of quiet text against the colour under it, from computed style, ratio unrounded; each panel is shown in turn. */
async function frameContrast(page) {
  const items = [];
  let attribute = null;
  for (const [panel, selectors] of Object.entries(QUIET)) {
    await showPanel(page, panel);
    const got = await measure(page, selectors);
    attribute = got.attribute;
    items.push(...got.items);
  }
  return { attribute, items, min: Math.min(...items.map((r) => r.ratio)) };
}

function measure(page, selectors) {
  return page.evaluate((selectors) => {
    const parse = (c) => {
      // A colour-mixed ground computes as `color(srgb r g b / a)`, its channels 0 to 1.
      const srgb = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)$/.exec(c);
      if (srgb) return { r: srgb[1] * 255, g: srgb[2] * 255, b: srgb[3] * 255, a: srgb[4] === undefined ? 1 : Number(srgb[4]) };
      const m = c.match(/[\d.]+/g).map(Number);
      return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
    };
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
    const items = selectors.map((selector) => {
      const el = document.querySelector(selector);
      if (!el) return { selector, ratio: 0, color: 'missing' };
      const fg = parse(getComputedStyle(el).color), bg = groundOf(el);
      const [a, b] = [lum(over(fg, bg)), lum(bg)];
      return { selector, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), color: getComputedStyle(el).color };
    });
    return { attribute: document.documentElement.getAttribute('data-marxy-contrast'), items, min: Math.min(...items.map((r) => r.ratio)) };
  }, selectors);
}

const secondary = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--marxy-color-text-secondary').trim());

for (const variant of ['dark', 'light']) {
  test(`prefers-contrast: more resolves data-marxy-contrast to more and the frame's quiet text is 7:1 or better (${variant})`, async () => {
    await withApp({ variant, media: { contrast: 'more' } }, async (page) => {
      const got = await frameContrast(page);
      assert.equal(got.attribute, 'more');
      assert.ok(got.items.every((i) => i.color !== 'missing'), JSON.stringify(got.items));
      assert.ok(got.min >= 7, JSON.stringify(got.items));
    });
  });
}

test('without the system setting nothing changes, and turning it on and off is followed live', async () => {
  await withApp({ media: { contrast: 'no-preference' } }, async (page) => {
    const rest = await frameContrast(page);
    assert.equal(rest.attribute, 'normal');
    assert.ok(rest.min < 7, `at rest the quiet text is under 7:1 (it is ${rest.min}), so the 7:1 below is the block's doing`);
    const restColor = await secondary(page);
    await page.emulateMedia({ contrast: 'more' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-marxy-contrast') === 'more');
    const more = await frameContrast(page);
    assert.ok(more.min >= 7, JSON.stringify(more.items));
    await page.emulateMedia({ contrast: 'no-preference' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-marxy-contrast') === 'normal');
    assert.deepEqual(await frameContrast(page), rest);
    assert.equal(await secondary(page), restColor);
  });
});

test('contrast = "normal" in config.toml keeps today\'s look under the system setting', async () => {
  let rest;
  await withApp({ media: { contrast: 'no-preference' } }, async (page) => { rest = await frameContrast(page); });
  await withApp({ config: 'contrast = "normal"\n', media: { contrast: 'more' } }, async (page) => {
    const got = await frameContrast(page);
    assert.equal(got.attribute, 'normal');
    assert.deepEqual(got.items, rest.items);
  });
});

test('contrast = "more" in config.toml raises the frame\'s quiet text with no system setting', async () => {
  await withApp({ config: 'contrast = "more"\n', media: { contrast: 'no-preference' } }, async (page) => {
    const got = await frameContrast(page);
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

test('reduce_transparency = true makes the find fill opaque; unset, it is translucent as today', async () => {
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

test('more contrast makes the find fill solid too', async () => {
  await withApp({ media: { contrast: 'more' } }, async (page) => {
    const got = await findRectBackground(page);
    assert.match(got.background, /^rgb\(\d+, \d+, \d+\)$/, got.background);
  });
});
