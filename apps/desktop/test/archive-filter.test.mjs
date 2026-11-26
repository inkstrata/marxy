// The archive page's filter: typed into
// the Line as a reader types it, the list (or the sheet) keeps the matching files and the folders that hold them, the plan
// dims the rest, the lede says how many are shown, the cursor keeps its entry or goes to the first match; Esc, or "Show
// every entry", brings them all back. Kept in memory per archive, never written.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'archives');
const SURVEY = '/r/archives/harbour-survey-2026.zip';
const FILES = { '/r/README.md': '# Here\n', [SURVEY]: readFileSync(join(demo, 'harbour-survey-2026.zip')) };
const PAGE = '[data-marxy-pane="0"] .marxy-archpage';
const ALL = 25;

const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const rowNames = (page) => page.$$eval(`${PAGE} .marxy-arow .marxy-arch-name`, (els) => els.map((e) => e.textContent));
const rowCount = (page) => page.$$eval(`${PAGE} .marxy-arow`, (els) => els.length);
const showing = (page) => page.evaluate((s) => document.querySelector(`${s} .marxy-arch-lede .marxy-arch-showing`)?.textContent ?? null, PAGE);
const headOf = (page) => page.evaluate(async () => (await import('/src/parts/cursor.ts')).partsHere()?.head?.id ?? null);
const where = (page) => page.evaluate(() => document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent ?? null);
const lineRows = (page) =>
  page.evaluate(() => {
    const d = document.querySelector('#marxy-palette');
    return {
      notice: d.querySelector('.marxy-palette-notice').hidden ? '' : d.querySelector('.marxy-palette-notice').textContent,
      rows: [...d.querySelectorAll('.marxy-palette-row')].map((r) => ({
        t: (r.querySelector('.marxy-palette-title, .marxy-palette-ex')?.textContent ?? '').trim(),
        d: r.querySelector('.marxy-palette-sub')?.textContent ?? '',
        g: r.closest('.marxy-palette-group')?.querySelector('.marxy-palette-section')?.textContent ?? '',
      })),
    };
  });

/** The Line opened on the focused pane, `text` typed into it as a reader types. */
async function line(page, mod, text) {
  await blur(page);
  await page.keyboard.press(`${mod}+KeyK`);
  await page.waitForSelector('#marxy-palette[open]');
  await page.keyboard.type(text);
  await page.waitForTimeout(250);
}

/** The survey open, its list drawn with every row and every reading from bytes. */
async function ready(page) {
  await page.waitForSelector(`${PAGE} .marxy-arow`);
  await page.waitForFunction((s) => document.querySelectorAll(`${s} .marxy-arow`).length > 30, PAGE);
  await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'readArchiveHeads'));
  await page.waitForTimeout(300);
}

/** What the plan dims: the titles of its cells that the filter does not keep. */
const dimmed = (page) => page.$$eval(`${PAGE} .marxy-arch-cell`, (els) => ({ all: els.length, dim: els.filter((c) => c.classList.contains('marxy-arch-cell-dim')).length }));

test('1. = name:.rs leaves only that entry and its folder, said in the lede and dimmed in the plan; Esc restores them', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page, { mod }) => {
    await ready(page);
    const before = await rowCount(page);
    await line(page, mod, '= name:.rs');
    const s = await lineRows(page);
    assert.deepEqual(s.rows.map((r) => [r.g, r.t, r.d]), [['Keep the entries', 'Matching “name:.rs”', `1 of ${ALL} files`]]);
    await page.keyboard.press('Enter');
    await page.waitForFunction((sel) => document.querySelectorAll(`${sel} .marxy-arow`).length === 2, PAGE);
    assert.deepEqual(await rowNames(page), ['src/', 'indexer.rs']);
    assert.equal(await page.textContent(`${PAGE} .marxy-arow-dir .marxy-arch-reads`), '1 of 3 files', 'a folder keeps its count');
    assert.equal(await showing(page), `Showing 1 of ${ALL} files, matching “name:.rs”.`);
    const plan = await dimmed(page);
    assert.ok(plan.dim > 0 && plan.dim < plan.all, `the plan dims what is not kept: ${JSON.stringify(plan)}`);
    const lit = await page.$$eval(`${PAGE} .marxy-arch-cell:not(.marxy-arch-cell-dim)`, (els) => els.map((c) => c.title));
    assert.ok(lit.some((t) => /indexer\.rs|in src\/|^src\//.test(t)), `the cell that holds it is not dimmed: ${JSON.stringify(lit)}`);
    // The cursor goes to the first match, and the preview follows it.
    await page.waitForFunction(() => /indexer\.rs$/.test(document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent ?? ''));
    await page.waitForFunction((sel) => document.querySelector(`${sel} .marxy-arow.marxy-cursor .marxy-arch-name`)?.textContent === 'indexer.rs', PAGE);
    // j finds no other entry to walk to.
    await page.keyboard.press('j');
    await page.waitForTimeout(150);
    assert.equal(await headOf(page), 'harbour-survey-2026/src/indexer.rs');
    // The Line, asked again, offers every entry back.
    await line(page, mod, '=');
    const again = await lineRows(page);
    assert.deepEqual(again.rows.map((r) => [r.g, r.t]), [['The entries now: matching “name:.rs”', 'Show every entry']]);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#marxy-palette')?.open !== true);
    // Esc in the page lets the filter go; the cursor stays on its entry.
    const h0 = await headOf(page);
    await page.keyboard.press('Escape');
    await page.waitForFunction(([sel, n]) => document.querySelectorAll(`${sel} .marxy-arow`).length === n, [PAGE, before]);
    assert.equal(await showing(page), null);
    assert.equal((await dimmed(page)).dim, 0);
    assert.equal(await headOf(page), h0, 'the cursor is where it was');
    const writes = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => /^write|^rename/.test(c.method)).map((c) => String(c.args[0])));
    assert.deepEqual(writes.filter((p) => !p.startsWith('/data/')), [], 'nothing written');
  });
});

test('2. = reading:picture leaves the survey\'s pictures; Show every entry brings the rest back', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page, { mod }) => {
    await ready(page);
    await line(page, mod, '= reading:picture');
    assert.equal((await lineRows(page)).rows[0]?.d, `6 of ${ALL} files`);
    await page.keyboard.press('Enter');
    await page.waitForFunction((sel) => document.querySelectorAll(`${sel} .marxy-arow`).length === 7, PAGE);
    assert.deepEqual(await rowNames(page), ['pictures/', 'boat-ribs.jpg', 'buoy.gif', 'ferry.webp', 'harbour-at-low-water.jpg', 'sketch.svg', 'tide-chart.png']);
    assert.equal(await page.textContent(`${PAGE} .marxy-arow-dir .marxy-arch-reads`), '6 of 6 files');
    // The cursor had no entry: it goes to the first match.
    await page.waitForFunction(() => /boat-ribs\.jpg$/.test(document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent ?? ''));
    await line(page, mod, '=');
    await page.keyboard.press('Enter');
    await page.waitForFunction((sel) => document.querySelectorAll(`${sel} .marxy-arow`).length > 30, PAGE);
    assert.equal(await showing(page), null);
    assert.match((await where(page)) ?? '', /boat-ribs\.jpg$/, 'the cursor stays on its entry');
  });
});

test('3. = size>100kb leaves the large ones, in the list and in the sheet; the cursor stays on an entry that matches', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page, { mod }) => {
    await ready(page);
    await blur(page);
    await page.evaluate(async () => {
      const { partsGoTo } = await import('/src/parts/cursor.ts');
      if (!partsGoTo('harbour-survey-2026/recordings/bell-buoy.wav')) throw new Error('no part');
    });
    await line(page, mod, '= size>100kb');
    await page.keyboard.press('Enter');
    await page.waitForFunction((sel) => document.querySelectorAll(`${sel} .marxy-arow`).length === 5, PAGE);
    assert.deepEqual(await rowNames(page), ['data/', 'gauges.sqlite', 'recordings/', 'bell-buoy.wav', 'ferry-leaving.mp4']);
    assert.equal(await showing(page), `Showing 3 of ${ALL} files, matching “size>100kb”.`);
    await page.waitForTimeout(150);
    assert.match((await where(page)) ?? '', /bell-buoy\.wav$/, 'the cursor stays where it matched');
    // As a sheet: the same files, under headings that keep their counts.
    await page.click(`${PAGE} .marxy-arch-under .marxy-arch-opt:text-is("a sheet")`);
    await page.waitForSelector(`${PAGE} .marxy-arch-sheet .marxy-arch-tile`);
    const tiles = await page.$$eval(`${PAGE} .marxy-arch-sheet .marxy-arch-tile .marxy-arch-tile-name`, (els) => els.map((e) => e.textContent));
    assert.deepEqual(tiles, ['gauges.sqlite', 'bell-buoy.wav', 'ferry-leaving.mp4']);
    const heads = await page.$$eval(`${PAGE} .marxy-arch-shead:not(.marxy-arch-shead-again) span`, (els) => els.map((e) => e.textContent));
    assert.ok(heads.some((h) => /^1 of 4 files/.test(h)) && heads.some((h) => /^2 of 2 files/.test(h)), JSON.stringify(heads));
    await page.click(`${PAGE} .marxy-arch-under .marxy-arch-opt:text-is("a list")`);
    await page.waitForSelector(`${PAGE} .marxy-arow`);
  });
});

test('4. an unreadable term says so in the Line and filters nothing; a filter is kept for the archive across tabs', async () => {
  await withFrame({ files: FILES, open: [SURVEY, '/r/README.md'] }, async (page, { mod }) => {
    await page.evaluate((p) => window.__marxyHandle.panes().openIn(0, p), SURVEY);
    await ready(page);
    const before = await rowCount(page);
    await line(page, mod, '= size>huge');
    const s = await lineRows(page);
    assert.equal(s.rows.length, 0);
    assert.match(s.notice, /“size>huge” is not a size: write size>100kb, with b, kb, mb or gb\./);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    assert.equal(await rowCount(page), before, 'nothing filtered');
    await page.keyboard.press(`${mod}+KeyA`);
    await page.keyboard.type('= colour:red');
    await page.waitForTimeout(250);
    assert.match((await lineRows(page)).notice, /“colour:” is not a filter/);
    await page.keyboard.press(`${mod}+KeyA`);
    await page.keyboard.type('= tide');
    await page.waitForTimeout(250);
    assert.equal((await lineRows(page)).rows[0]?.d, `7 of ${ALL} files`);
    await page.keyboard.press('Enter');
    await page.waitForFunction((sel) => document.querySelector(`${sel} .marxy-arch-showing`) !== null, PAGE);
    const kept = await rowNames(page);
    // Another tab, then back: the filter is the archive's while the app runs.
    await page.evaluate(() => window.__marxyHandle.panes().openIn(0, '/r/README.md'));
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/README.md');
    await page.evaluate((p) => window.__marxyHandle.panes().openIn(0, p), SURVEY);
    await page.waitForSelector(`${PAGE} .marxy-arow`);
    assert.deepEqual(await rowNames(page), kept);
    assert.equal(await showing(page), `Showing 7 of ${ALL} files, matching “tide”.`);
    const writes = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => /^write/.test(c.method)).map((c) => new TextDecoder().decode(c.args[1] ?? new Uint8Array())));
    assert.ok(!writes.some((w) => w.includes('tide') && w.includes('filter')), 'the filter is never written');
  });
});
