// The Line by kind in WebKit: a word that names a kind narrows the files, a file that is not text shows what it is,
// and an empty window's first row is the way in.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const FILES = {
  '/r/notes.md': '# Notes\n\nA note.\n',
  '/r/reading/ragged-lines.md': '# Ragged lines\n\nProse.\n',
  '/r/reading/ragged-lines.pdf': '%PDF-1.4\n',
  '/r/reading/other.pdf': '%PDF-1.4\n',
  '/r/apps/desktop/main.ts': 'export {};\n',
  '/r/logs/indexer.log': '2026-10-14T08:00:00Z INFO start\n2026-10-14T08:00:02Z ERROR failed\n',
};

const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const rows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].map((r) => ({
      t: (r.querySelector('.marxy-palette-title')?.textContent ?? '').trim(),
      d: r.querySelector('.marxy-palette-sub')?.textContent ?? '',
      g: r.closest('.marxy-palette-group')?.querySelector('.marxy-palette-section')?.textContent ?? '',
    })),
  );
async function summon(page, mod, text) {
  await blur(page);
  await page.keyboard.press(`${mod}+KeyK`);
  await page.waitForSelector('#marxy-palette[open]');
  if (text) await page.keyboard.type(text);
  await page.waitForTimeout(250);
}

test('an empty window: the first row is Open a file', async () => {
  await withFrame({ files: FILES, open: [] }, async (page, { mod }) => {
    await summon(page, mod);
    const all = await rows(page);
    assert.equal(all[0].t, 'Open a file', JSON.stringify(all.slice(0, 4)));
  });
});

test('a word that names a kind narrows the files, and a PDF row says what it is', async () => {
  await withFrame({ files: FILES, open: ['/r/notes.md'] }, async (page, { mod }) => {
    await summon(page, mod, 'ragged pdf');
    const files = (await rows(page)).filter((r) => r.g === 'Files');
    assert.equal(files.length, 1, JSON.stringify(files));
    assert.match(files[0].t, /ragged-lines/);
    assert.match(files[0].d, /^PDF · .+ · .*ragged-lines\.pdf$/);

    await page.keyboard.press(`${mod}+KeyA`);
    await page.keyboard.type('pdf');
    await page.waitForTimeout(250);
    const only = (await rows(page)).filter((r) => r.g === 'Files').map((r) => r.d.split(' · ').at(-1));
    assert.deepEqual(only.sort(), ['r/reading/other.pdf', 'r/reading/ragged-lines.pdf']);

    await page.keyboard.press(`${mod}+KeyA`);
    await page.keyboard.type('log errors');
    await page.waitForTimeout(250);
    const logs = (await rows(page)).filter((r) => r.g === 'Files');
    assert.ok(logs.every((r) => /\.log$/.test(r.d)), JSON.stringify(logs));

    await page.keyboard.press(`${mod}+KeyA`);
    await page.keyboard.type('ragged');
    await page.waitForTimeout(250);
    assert.equal((await rows(page)).filter((r) => r.g === 'Files').length, 2, 'with no kind word, every file called ragged is listed');

    await page.keyboard.press(`${mod}+KeyA`);
    await page.keyboard.type('desktop ');
    await page.waitForTimeout(250);
    assert.ok((await rows(page)).some((r) => /desktop\/main\.ts$/.test(r.d)), 'an ordinary word narrows nothing');
  });
});
