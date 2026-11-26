// A database, a workbook, a font and a recording inside an archive: `o` on each opens a tab that is
// that kind's own page, read-only, its facts and rows read by the shell's readers from the archive's entry in memory
// (the memory shell's twin here), never the card and never a file on disk. The archive is the demo's held-kinds.zip,
// written by fixtures/demo/archives/make-held-kinds.mjs. WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { rowOf, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'archives');
const ZIP = '/r/archives/held-kinds.zip';
const FILES = { '/r/README.md': '# Here\n', [ZIP]: readFileSync(join(demo, 'held-kinds.zip')) };

const calls = (page, method) => page.evaluate((m) => window.__marxyHandle.shell.calls.filter((c) => c.method === m).map((c) => c.args), method);
/** The call of `method` for entry `name`: the preview may have asked first, for whatever it showed on arrival. */
const callFor = async (page, method, name) => (await calls(page, method)).find((args) => args.some((a) => a?.name === name));
const selected = (page) => page.$eval('.marxy-arow[aria-selected="true"] .marxy-arch-name', (e) => e.textContent);

/** Puts the cursor on `name` and presses `o`; resolves once the tab is the entry's. */
async function openEntry(page, name) {
  await page.waitForSelector('.marxy-atree');
  await page.click(`.marxy-arow:has(.marxy-arch-name:text-is("${name}"))`);
  // The page marks the row once the cursor has moved, a frame after the click.
  await page.waitForSelector(`.marxy-arow[aria-selected="true"]:has(.marxy-arch-name:text-is("${name}"))`);
  assert.equal(await selected(page), name);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('o');
  await page.waitForFunction((n) => (window.__marxyHandle.panes().panes[0].path() ?? '').endsWith(`/${n}`), name);
  const path = await page.evaluate(() => window.__marxyHandle.panes().panes[0].path());
  assert.match(path, /^archive-entry:\d+\//);
  return path;
}

/** Read-only and said so, nothing of it written anywhere, and the reader asked of the archive, never of a path on disk. */
async function heldAndUnwritten(page, name, entryName) {
  await page.waitForFunction(
    (n) => [...document.querySelectorAll('.marxy-notice-text')].some((e) => e.textContent === `An entry of held-kinds.zip, opened into memory when you asked: ${n}. It is not on disk, and nothing here can be edited.`),
    entryName,
  );
  assert.deepEqual(await rowOf(page), ['held-kinds.zip', `${name}*`]);
  assert.equal(await page.$('.marxy-fcard'), null, 'not the card');
  for (const m of ['writeFileAtomic', 'writeFileNew']) assert.deepEqual((await calls(page, m)).filter(([p]) => !String(p).startsWith('/data/')), [], m);
  assert.deepEqual((await calls(page, 'readFile')).filter(([p]) => String(p).startsWith('archive-entry:') || String(p).endsWith(name)), []);
}

test('a database inside the archive opens as the table page, its rows read from the entry in memory, with nothing beside it', async () => {
  await withFrame({ files: FILES, open: [ZIP] }, async (page) => {
    await openEntry(page, 'gauges.sqlite');
    await page.waitForSelector('[data-marxy-viewer="sqlite"] .marxy-tbl-grid tbody tr');
    await heldAndUnwritten(page, 'gauges.sqlite', 'data/gauges.sqlite');
    const at = { index: 0, name: 'data/gauges.sqlite' };
    assert.deepEqual(await callFor(page, 'tablesOpen', at.name), [ZIP, false, at]);
    assert.ok((await calls(page, 'tablesRows')).every((args) => args[0] === ZIP && args[4]?.name === at.name));
    assert.match(await page.innerText('[data-marxy-viewer="sqlite"]'), /An entry of an archive, read from its bytes held in memory: it has no place on disk and nothing beside it/);
  });
});

test('a workbook inside the archive opens as the sheet page, its cells read from the entry in memory', async () => {
  await withFrame({ files: FILES, open: [ZIP] }, async (page) => {
    await openEntry(page, 'tide-log-2026.xlsx');
    await page.waitForSelector('[data-marxy-viewer="sheet"] .marxy-tbl-sheet tbody tr');
    await heldAndUnwritten(page, 'tide-log-2026.xlsx', 'sheets/tide-log-2026.xlsx');
    assert.deepEqual(await callFor(page, 'tablesOpen', 'sheets/tide-log-2026.xlsx'), [ZIP, false, { index: 1, name: 'sheets/tide-log-2026.xlsx' }]);
    assert.ok((await page.$$('[data-marxy-viewer="sheet"] .marxy-tbl-sheet tbody td')).length > 10);
  });
});

test('a font inside the archive opens as the font specimen, its facts and glyphs read from the entry in memory', async () => {
  await withFrame({ files: FILES, open: [ZIP] }, async (page) => {
    await openEntry(page, 'TidemarkSans-Regular.ttf');
    await page.waitForSelector('[data-marxy-viewer="font"] .marxy-font-spec');
    await heldAndUnwritten(page, 'TidemarkSans-Regular.ttf', 'fonts/TidemarkSans-Regular.ttf');
    await page.waitForFunction(() => document.querySelector('.marxy-font-name')?.textContent === 'Tidemark Sans Regular');
    assert.deepEqual(await callFor(page, 'fontFacts', 'fonts/TidemarkSans-Regular.ttf'), [ZIP, { index: 2, name: 'fonts/TidemarkSans-Regular.ttf' }]);
  });
});

test('a recording inside the archive opens as the media page: a player on a typed blob of the entry, and its waveform', async () => {
  await withFrame({ files: FILES, open: [ZIP] }, async (page) => {
    await page.waitForSelector('.marxy-atree');
    // This WebKit build plays no WAV: the player's error is hidden, as frame-media does, and every blob made is noted.
    await page.evaluate(() => {
      Object.defineProperty(HTMLMediaElement.prototype, 'error', { configurable: true, get: () => null });
      const make = URL.createObjectURL;
      window.__blobs = [];
      URL.createObjectURL = (b) => {
        const u = make(b);
        window.__blobs.push([u, b.type, b.size]);
        return u;
      };
    });
    await openEntry(page, 'bell-buoy.wav');
    await page.waitForSelector('[data-marxy-viewer="media"] audio.marxy-media-player');
    await page.waitForSelector('[data-marxy-viewer="media"] .marxy-media-wave canvas');
    await heldAndUnwritten(page, 'bell-buoy.wav', 'media/bell-buoy.wav');
    assert.equal(await page.textContent('[data-marxy-viewer="media"] .marxy-media-line'), 'WAV · PCM, 16-bit, mono, 22,050 Hz · 5.0 s');
    const src = await page.getAttribute('audio.marxy-media-player', 'src');
    const made = (await page.evaluate(() => window.__blobs)).find(([u]) => u === src);
    assert.deepEqual(made?.slice(1), ['audio/wav', 220672], 'the entry’s own bytes, typed for the player');
    const at = { index: 3, name: 'media/bell-buoy.wav' };
    assert.deepEqual(await callFor(page, 'mediaFacts', at.name), [ZIP, at]);
  });
});
