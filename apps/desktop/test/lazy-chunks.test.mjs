// The chunks that load after first text (F-111): the palette's and the workspace panels'. A chunk that cannot be
// read says so in a notice and costs the reader only what is in it; the palette's chunk being late or lost never
// holds back the collection, the watches or the document; and a palette chord pressed before its chunk is in is
// not lost. Dev-server URLs stand for the chunks (`/src/palette/view.ts`, `/src/workspace/panels.ts`): aborting
// or delaying one is what a lost or slow chunk file is.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { b64, bootTwoPanes, closeHarness, harnessBase } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PALETTE_CHUNK = '**/src/palette/view.ts*';
const PANELS_CHUNK = '**/src/workspace/panels.ts*';
const files = {
  '/r/A.md': '# Alpha\n\nA paragraph of the first document, long enough to be read.\n',
  '/r/B.md': '# Bravo\n\nThe second document.\n',
};

const noticeTexts = (page) => page.$$eval('.marxy-notice-text', (els) => els.map((el) => el.textContent));
const mod = (page) => page.evaluate(() => navigator.platform).then((p) => (p === 'MacIntel' ? 'Meta' : 'Control'));

test('a palette chunk that cannot be read is said in a notice, and the collection, the watches and the page still run', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.route(PALETTE_CHUNK, (route) => route.abort());
    const base = await harnessBase();
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    const encoded = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, b64(text)]));
    const state = await page.evaluate(async (encoded) => {
      const { handle } = await window.marxyPaletteBoot.start(encoded, ['/r/A.md']);
      window.__h = handle;
      await handle.collection.loaded;
      return {
        palette: handle.palette,
        exposed: window.__marxyPalette ?? null,
        trees: typeof handle.trees?.stop,
        watches: handle.shell.calls.filter((c) => c.method === 'watch').length,
        text: document.querySelector('.marxy-article')?.textContent ?? '',
      };
    }, encoded);
    assert.equal(state.palette, null, 'there is no palette, and boot did not reject');
    assert.equal(state.exposed, null);
    assert.equal(state.trees, 'function', 'the tree watches were started');
    assert.ok(state.watches > 0, 'the index still watches its folder');
    assert.match(state.text, /A paragraph of the first document/, 'the document is on the page');
    const notices = await noticeTexts(page);
    assert.ok(notices.some((t) => t.startsWith('The palette could not be loaded')), `a notice says so: ${JSON.stringify(notices)}`);
    // Its keys do nothing, and nothing throws.
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.keyboard.press(`${await mod(page)}+KeyK`);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.getElementById('marxy-palette')?.hasAttribute('open') ?? false), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('a palette chord pressed before a slow chunk lands opens the palette when it lands, and the collection does not wait for it', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.route(PALETTE_CHUNK, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    const base = await harnessBase();
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    const encoded = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, b64(text)]));
    const t0 = Date.now();
    await page.evaluate((encoded) => {
      window.__booted = window.marxyPaletteBoot.start(encoded, ['/r/A.md']).then(({ handle }) => {
        window.__h = handle;
        window.__landedAt = Date.now();
      });
    }, encoded);
    await page.waitForFunction(() => /A paragraph of the first document/.test(document.querySelector('.marxy-article')?.textContent ?? ''));
    const key = await mod(page);
    const open = () => page.evaluate(() => document.getElementById('marxy-palette')?.hasAttribute('open') ?? false);
    assert.equal(await page.evaluate(() => window.__h === undefined), true, 'the chunk is still on its way');
    await page.keyboard.press(`${key}+KeyK`);
    await page.waitForTimeout(150);
    assert.equal(await open(), false, 'nothing to open yet');
    await page.evaluate(() => window.__booted);
    assert.ok(Date.now() - t0 >= 1400, 'the boot did wait for the chunk, as the test arranged');
    await page.waitForFunction(() => document.getElementById('marxy-palette')?.hasAttribute('open'));
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#marxy-palette input')), true, 'the field has focus');
    // The collection ran meanwhile: it was started before the chunk landed, not after.
    const order = await page.evaluate(() => {
      const marks = window.__h.shell.calls.filter((c) => c.method === 'mark').map((c) => ({ name: c.args[0], at: c.args[1] }));
      return { loaded: marks.find((m) => m.name === 'collection_loaded')?.at ?? null, landed: window.__landedAt };
    });
    assert.ok(order.loaded !== null && order.loaded < order.landed - 500, `collection_loaded (${order.loaded}) came well before the palette landed (${order.landed})`);
  } finally {
    await browser.close();
  }
});

test('panels that cannot be read are said in a notice, the unfold still ends, and the next unfold reads them again', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.route(PANELS_CHUNK, (route) => route.abort());
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    assert.equal(await page.evaluate(() => window.__marxyHandle.workspace().mode), 'unfolded', 'the unfold ended');
    assert.equal(await page.evaluate(() => document.querySelector('[data-marxy-status-item="encoding"]') === null), true, 'the regions are empty');
    const notices = await noticeTexts(page);
    assert.equal(notices.filter((t) => t.startsWith('The side panels could not be loaded')).length, 1, `one notice: ${JSON.stringify(notices)}`);
    assert.match(await page.evaluate(() => document.querySelector('.marxy-article')?.textContent ?? ''), /A paragraph of the first document/);
    // The chunk is back: fold and unfold again.
    await page.unroute(PANELS_CHUNK);
    await page.evaluate(async () => {
      await window.__marxyHandle.workspace().fold();
      await window.__marxyHandle.workspace().unfold();
    });
    await page.waitForSelector('[data-marxy-status-item="encoding"]');
  } finally {
    await browser.close();
  }
});
