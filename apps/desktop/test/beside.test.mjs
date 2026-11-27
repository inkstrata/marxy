// The file's neighbours in its folder: `g ]` and `g [` open the next and previous file in the order the folder's page
// lists them, in the same tab; the crumb's menu says the keys beside those two; the ends do not wrap and say so.
// Playwright WebKit, over the demo's reading folder.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { rowOf, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'reading');
const NAMES = ['on-the-measure.md', 'the-case-for-ragged-lines.md', 'the-case-for-ragged-lines.pdf', 'tide-table.txt'];
const FILES = Object.fromEntries(NAMES.map((n) => [`/r/reading/${n}`, readFileSync(join(demo, n))]));
const focused = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.path());
const shows = (page, name) => page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === `/r/reading/${p}`, name);
const leavePage = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());

test('g ] opens the next file in folder order and g [ comes back, in the one tab; the ends say so and do not wrap', async () => {
  await withFrame({ files: FILES, open: ['/r/reading/on-the-measure.md'] }, async (page) => {
    await page.waitForSelector('.marxy-article');
    await leavePage(page);
    await page.keyboard.press('g');
    await page.keyboard.press('[');
    await page.waitForSelector('.marxy-notice');
    assert.match(await page.innerText('.marxy-notice'), /first file in reading\//);
    assert.equal(await focused(page), '/r/reading/on-the-measure.md', 'nothing wrapped');
    await page.keyboard.press('g');
    await page.keyboard.press(']');
    await shows(page, 'the-case-for-ragged-lines.md');
    await page.keyboard.press('g');
    await page.keyboard.press(']');
    await shows(page, 'the-case-for-ragged-lines.pdf');
    await page.keyboard.press('g');
    await page.keyboard.press('[');
    await shows(page, 'the-case-for-ragged-lines.md');
    assert.equal((await rowOf(page)).length, 1, 'every step in the one tab');
    await page.evaluate(() => window.__marxyHandle.open('/r/reading/tide-table.txt'));
    await shows(page, 'tide-table.txt');
    await leavePage(page);
    await page.keyboard.press('g');
    await page.keyboard.press(']');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice')].some((n) => /last file in reading\//.test(n.textContent)));
    assert.equal(await focused(page), '/r/reading/tide-table.txt');
  });
});

test('the chord steps from anywhere, a Source editor aside, and typing g ] into the editor types it', async () => {
  await withFrame({ files: FILES, open: ['/r/reading/the-case-for-ragged-lines.md'] }, async (page, { mod }) => {
    await page.waitForSelector('.marxy-article');
    await page.keyboard.press(`${mod}+Alt+BracketRight`);
    await shows(page, 'the-case-for-ragged-lines.pdf');
    await page.keyboard.press(`${mod}+Alt+BracketLeft`);
    await shows(page, 'the-case-for-ragged-lines.md');
    await page.keyboard.press(`${mod}+e`);
    await page.waitForSelector('.cm-content');
    await page.click('.cm-content');
    await page.keyboard.press('g');
    await page.keyboard.press(']');
    assert.equal(await focused(page), '/r/reading/the-case-for-ragged-lines.md', 'typing in the editor steps nowhere');
    assert.match(await page.innerText('.cm-content'), /g\]/);
  });
});

test('the file crumb\'s menu says g [ and g ] beside the neighbours', async () => {
  await withFrame({ files: FILES, open: ['/r/reading/the-case-for-ragged-lines.md'] }, async (page) => {
    await page.click('.marxy-crumb[data-marxy-crumb="file"]');
    await page.waitForSelector('.marxy-verb-menu [role="menuitem"]');
    const rows = await page.$$eval('.marxy-verb-menu [role="menuitem"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    const has = (name, key) => rows.some((r) => r.includes(name) && r.includes(key));
    assert.ok(has('on-the-measure.md', 'g ['), rows.join(' | '));
    assert.ok(has('the-case-for-ragged-lines.md', 'here'));
    assert.ok(has('the-case-for-ragged-lines.pdf', 'g ]'));
    assert.ok(!rows.find((r) => r.includes('tide-table.txt'))?.match(/g [\[\]]/), 'only the two neighbours carry a key');
  });
});
