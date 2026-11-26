// The file the app was launched with is a read like any other: Ctrl+K's Recent lists it. Places has no
// Recent section, so the Library's half of this case is gone. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { rowOf, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const doc = (name) => `# ${name}\n\nThe ${name} file.\n`;
const FILES = Object.fromEntries(['A', 'B'].map((n) => [`/r/${n}.md`, doc(n)]));

/** The paths under the palette's section `label`, once it has drawn. */
const paletteRecent = async (page, mod) => {
  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector('#marxy-palette[open]');
  await page.waitForFunction(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-section')].some((s) => s.textContent === 'Recent'));
  const rows = await page.$$eval('#marxy-palette .marxy-palette-section, #marxy-palette .marxy-palette-row', (els) => els.map((e) => (e.classList.contains('marxy-palette-section') ? `#${e.textContent}` : e.textContent)));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#marxy-palette[open]', { state: 'detached' });
  return rows.slice(rows.indexOf('#Recent') + 1);
};

test('the launch file is in the palette\'s Recent, and stays there once its tab is closed', async () => {
  await withFrame({ files: FILES, open: ['/r/A.md'] }, async (page, { mod }) => {
    const rows = await paletteRecent(page, mod);
    assert.ok(rows.some((r) => r.includes('A.md')), `Recent holds the launch file: ${JSON.stringify(rows)}`);
    await page.evaluate(() => window.__marxyHandle.open('/r/B.md'));
    await page.click('.marxy-tabbar .marxy-tab:has(.marxy-tab-name:text-is("A.md")) .marxy-tab-close');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/B.md');
    assert.deepEqual(await rowOf(page), ['B.md*']);
    const again = await paletteRecent(page, mod);
    assert.ok(again.some((r) => r.includes('A.md')), `Recent still holds A.md: ${JSON.stringify(again)}`);
  });
});
