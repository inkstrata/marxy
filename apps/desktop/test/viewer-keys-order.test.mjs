// A key that is both a viewer's and a command's goes to the command alone: the dispatcher runs first and prevents the key,
// and the viewer's listener leaves a prevented key. A database's grid takes Escape to release a cell the pointer picked, and
// Escape is also Clear selection; with a cell picked, the command clears it and the viewer's own handler is never asked.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const DB = '/r/data/gauges.sqlite';
const FILES = {
  '/r/README.md': '# Here\n',
  [DB]: readFileSync(join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'data', 'gauges.sqlite')),
};

const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const where = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('.marxy-verb-bar');
    return b && !b.hidden ? b.querySelector('.marxy-verb-bar-where').textContent : null;
  });
const pickedCells = (page) => page.$$eval('.marxy-tbl-grid td[aria-selected="true"]', (els) => els.length);
/** Counts the keys the shown viewer is asked to handle; the count is read back with sked. */
const spyOnViewer = (page) =>
  page.evaluate(() => {
    const viewer = window.__marxyHandle.panes().focused.content.viewer();
    const own = viewer.key.bind(viewer);
    window.__viewerAsked = 0;
    viewer.key = (e, mode) => {
      window.__viewerAsked++;
      return own(e, mode);
    };
  });
const asked = (page) => page.evaluate(() => window.__viewerAsked);

test('Escape with a cell picked runs Clear selection and never reaches the viewer key handler', async () => {
  await withFrame({ files: FILES, open: [DB] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    await blur(page);
    await page.click('.marxy-tbl-grid tbody tr:nth-child(1) td[data-marxy-col="2"]');
    await blur(page);
    assert.equal(await pickedCells(page), 1, 'the pointer picked a cell');
    assert.ok(await where(page), 'the cell is under the cursor, so Clear selection applies');
    await spyOnViewer(page);
    await page.keyboard.press('Escape');
    assert.equal(await where(page), null, 'the command let go of the cursor');
    assert.equal(await pickedCells(page), 0);
    assert.equal(await asked(page), 0, 'the viewer was not asked for a key the command took');
  });
});
