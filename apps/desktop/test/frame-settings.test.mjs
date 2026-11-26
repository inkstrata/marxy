// Settings › Proposals: the eleven proposals, each a switch that writes config.toml's `proposals` line
// at once (naming only those that differ from their defaults, the rest of the file untouched) and takes effect without
// a restart. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { drawerShows, fileText, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const FILES = { '/r/A.md': '# A\n\nThe first file.\n', '/r/B.md': '# B\n\nThe second file.\n' };
const CONFIG = '# Mine, kept as written.\ncontrast = "normal"\n';
const PROPOSALS = ['minimap', 'glance', 'pairs', 'drag', 'inspector', 'paging', 'notes_in_place', 'sets', 'compare_files', 'table_aids', 'log_zone'];
const OFF_BY_DEFAULT = new Set(['glance']);

const config = (page) => fileText(page, '/config');
/** Flips proposal `id` and waits until config.toml is no longer `before`. */
async function flip(page, id, before) {
  await page.click(`[data-marxy-control="proposals.${id}"]`);
  await page.waitForFunction(async (was) => new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/config')) !== was, before);
  return config(page);
}

test('Settings › Proposals lists the eleven, each switch as config.toml says; a switch writes the proposals line at once', async () => {
  await withFrame({ files: FILES, open: ['/r/A.md', '/r/B.md'], config: CONFIG }, async (page, { mod }) => {
    await page.keyboard.press(`${mod}+,`);
    await drawerShows(page, 'settings');
    await page.waitForSelector('[data-marxy-setting="proposals.log_zone"]');
    const rows = await page.$$eval('[data-marxy-setting^="proposals."]', (els) => els.map((e) => [e.dataset.marxySetting.slice('proposals.'.length), e.querySelector('input').checked]));
    assert.deepEqual(rows, PROPOSALS.map((id) => [id, !OFF_BY_DEFAULT.has(id)]));
    assert.equal(await page.textContent('[data-marxy-setting="proposals.glance"] code.marxy-setting-key'), 'proposals.glance');

    let text = await flip(page, 'glance', CONFIG);
    assert.equal(text, `${CONFIG}proposals = { glance = true }\n`);
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-marxy-proposal-glance')), true, 'on at once');
    assert.equal(await page.getAttribute('[data-marxy-setting="proposals.glance"]', 'data-marxy-changed'), 'true');

    // Drag a tab off: the tabs stop being draggable without a restart.
    assert.equal(await page.getAttribute('.marxy-tabbar .marxy-tab', 'draggable'), 'true');
    text = await flip(page, 'drag', text);
    assert.equal(text, `${CONFIG}proposals = { glance = true, drag = false }\n`);
    await page.waitForFunction(() => document.querySelector('.marxy-tabbar .marxy-tab')?.draggable === false);

    // Pairs off: the pair marks go.
    assert.equal(await page.isVisible('.marxy-tabbar .marxy-tab-pair'), true);
    text = await flip(page, 'pairs', text);
    assert.equal(text, `${CONFIG}proposals = { glance = true, pairs = false, drag = false }\n`);
    await page.waitForSelector('.marxy-tabbar .marxy-tab-pair', { state: 'detached' });

    // Back to their defaults, one by one: the line names fewer, then is taken out, and the file is as it was.
    text = await flip(page, 'glance', text);
    assert.equal(text, `${CONFIG}proposals = { pairs = false, drag = false }\n`);
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-marxy-proposal-glance')), false);
    text = await flip(page, 'pairs', text);
    text = await flip(page, 'drag', text);
    assert.equal(text, CONFIG);
    await page.waitForFunction(() => document.querySelector('.marxy-tabbar .marxy-tab')?.draggable === true);
    assert.equal(await page.isVisible('.marxy-tabbar .marxy-tab-pair'), true);
  });
});

test('a proposal named in config.toml is on at launch, and its row says it differs from the default and resets it', async () => {
  await withFrame({ files: FILES, open: ['/r/A.md'], config: `${CONFIG}proposals = { sets = false }\n` }, async (page, { mod }) => {
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-marxy-proposal-sets')), false);
    await page.keyboard.press(`${mod}+Shift+E`);
    await drawerShows(page, 'places');
    await page.waitForSelector('.marxy-drawer .marxy-l-prow[data-marxy-left-row="f:/r/A.md"]');
    assert.equal(await page.locator('.marxy-drawer .marxy-l-prow[data-marxy-left-row="g:sets"]').count(), 0, 'no Sets group while Sets is off');
    await page.keyboard.press(`${mod}+,`);
    await drawerShows(page, 'settings');
    await page.waitForSelector('[data-marxy-setting="proposals.sets"][data-marxy-changed="true"]');
    assert.equal(await page.isChecked('[data-marxy-control="proposals.sets"]'), false);
    await page.click('[data-marxy-setting="proposals.sets"] .marxy-setting-dot');
    await page.waitForFunction(async (want) => new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/config')) === want, CONFIG);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-marxy-proposal-sets'));
    await page.keyboard.press(`${mod}+Shift+E`);
    await drawerShows(page, 'places');
    await page.waitForSelector('.marxy-drawer .marxy-l-prow[data-marxy-left-row="g:sets"]');
  });
});

test('Escape from the empty "Find a setting" field closes Settings; with words in it, it clears them first', async () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 640, height: 480 }]) {
    await withFrame({ files: FILES, open: ['/r/A.md'], config: CONFIG, viewport }, async (page, { mod }) => {
      await page.keyboard.press(`${mod}+,`);
      await drawerShows(page, 'settings');
      await page.waitForFunction(() => document.activeElement?.getAttribute('placeholder') === 'Find a setting');
      await page.keyboard.type('font');
      await page.keyboard.press('Escape');
      assert.equal(await page.inputValue('input[placeholder="Find a setting"]'), '');
      assert.equal(await page.evaluate(() => window.__marxyHandle.frame().left.extra()), 'settings', 'the first Escape only clears the field');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__marxyHandle.frame().left.extra() === null);
      assert.equal(await page.evaluate(() => document.activeElement?.closest('.marxy-drawer') ?? null), null, 'the keys are back on the page');
      if (viewport.width < 900) assert.equal(await page.getAttribute('body', 'data-marxy-drawer'), 'closed');
    });
  }
});
