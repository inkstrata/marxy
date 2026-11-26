// A SQLite database and a workbook under the cursor in WebKit: a row, then its cells; the bar's
// address (`#stations/2/lat`, `#Summary!F5`), `c` the stored value, `x` the record or the cell as stored, `o` a BLOB in a
// tab of its own, `]` `[` the tables and sheets, the next page of rows drawn as the cursor goes past the last, and the
// change verbs refusing.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { rowOf, showCardPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo');
const bytes = (rel) => readFileSync(join(demo, rel));
const DB = '/r/data/gauges.sqlite';
const XLSX = '/r/sheets/tide-log-2026.xlsx';
const ODS = '/r/sheets/tide-log-2026.ods';
const FILES = {
  '/r/README.md': '# Here\n',
  [DB]: bytes('data/gauges.sqlite'),
  [XLSX]: bytes('sheets/tide-log-2026.xlsx'),
  [ODS]: bytes('sheets/tide-log-2026.ods'),
};

const keys = async (page, ...list) => {
  for (const k of list) await page.keyboard.press(k);
};
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const clipboard = (page) =>
  page.evaluate(() => {
    const last = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
    const rep = last?.args[0].find((r) => r.type === 'public.utf8-plain-text');
    return rep ? new TextDecoder().decode(rep.bytes) : null;
  });
const copied = (page, n) => page.waitForFunction((n) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length === n, n);

/** The bar as the reader sees it, and the element under the cursor. */
const bar = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('.marxy-verb-bar');
    const shown = b && !b.hidden;
    const el = document.querySelector('[data-marxy-pane="0"] .marxy-cursor');
    return {
      where: shown ? b.querySelector('.marxy-verb-bar-where').textContent : null,
      what: shown ? b.querySelector('.marxy-verb-bar-what').textContent : null,
      verbs: shown ? [...b.querySelectorAll('[data-marxy-verb]')].map((v) => v.textContent.trim()) : [],
      text: el ? el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) : null,
      tag: el ? el.localName : null,
    };
  });
const where = async (page) => (await bar(page)).where;
const waitWhere = (page, want) => page.waitForFunction((want) => document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent === want, want);
const xray = (page) =>
  page.evaluate(() => {
    const box = document.querySelector('[data-marxy-pane="0"] .marxy-xray');
    return box ? { head: box.getAttribute('aria-label'), lines: [...box.querySelectorAll('.marxy-xray-text')].map((t) => t.textContent) } : null;
  });
const notices = (page) => page.$$eval('.marxy-notice-text', (els) => els.map((e) => e.textContent));

test('K-tables 02 j k walk a database’s rows, l goes into the first cell and h comes out; j at a row’s last cell goes on to the next row', async () => {
  await withFrame({ files: FILES, open: [DB] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    await blur(page);
    await keys(page, 'g', 'g');
    let b = await bar(page);
    assert.equal(b.where, 'gauges.sqlite#stations/1');
    assert.equal(b.what, 'row 1');
    assert.equal(b.tag, 'tr', 'the row is marked');
    assert.deepEqual(b.verbs, ['c copy', 'C cite', 'x x-ray', '\\ source', 'r read as', 'y collect', 'n note', 'Enter all'], 'only read: no change verbs');
    await keys(page, 'j');
    assert.equal(await where(page), 'gauges.sqlite#stations/2');
    await keys(page, 'l');
    b = await bar(page);
    assert.equal(b.where, 'gauges.sqlite#stations/2/id', 'l goes onto its first cell');
    assert.equal(b.what, 'cell id');
    assert.equal(b.tag, 'td');
    await keys(page, 'j', 'j');
    assert.equal(await where(page), 'gauges.sqlite#stations/2/lat', 'j moves along the row');
    // The Cell card follows the cursor (a part picked: in Outline).
    await showCardPanel(page, 'now-cell');
    await page.waitForFunction(() => /column\s*lat · declared REAL/.test(document.querySelector('.marxy-drawer [data-marxy-card="now-cell"]')?.innerText ?? ''));
    await keys(page, 'h');
    assert.equal(await where(page), 'gauges.sqlite#stations/2', 'h comes back to the row');
    await keys(page, 'l', 'j', 'j', 'j', 'j', 'j', 'j');
    assert.equal(await where(page), 'gauges.sqlite#stations/2/photo', 'the last cell');
    await keys(page, 'j');
    b = await bar(page);
    assert.equal(b.where, 'gauges.sqlite#stations/3', 'j at the last cell goes on to the next row, not into it');
    assert.equal(b.what, 'row 3');
    await keys(page, 'Shift+G');
    assert.equal(await where(page), 'gauges.sqlite#stations/6');
    // The arrows scroll the page: they no longer move a cell.
    await page.click('.marxy-tbl-grid tbody tr:nth-child(1) td[data-marxy-col="2"]');
    await blur(page);
    await keys(page, 'ArrowDown', 'ArrowRight');
    assert.equal(await page.$$eval('.marxy-tbl-grid td[aria-selected="true"]', (els) => els.map((e) => e.textContent)).then((t) => t.join()), '50.1182');
    await keys(page, 'Escape');
    assert.equal(await where(page), null, 'Escape lets the cursor go');
  });
});

test('K-tables 03 c copies stored values: a cell its value, NULL as nothing, a BLOB as its length and first bytes; a row its values by tabs', async () => {
  await withFrame({ files: FILES, open: [DB] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    await blur(page);
    await keys(page, 'Shift+G');
    assert.equal(await where(page), 'gauges.sqlite#stations/6', 'the sixth station');
    await keys(page, 'l', 'j', 'j', 'j', 'j', 'j');
    let b = await bar(page);
    assert.equal(b.where, 'gauges.sqlite#stations/6/notes');
    assert.equal(b.text, 'NULL', 'a NULL is marked on the page');
    await keys(page, 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), '', 'and copies as nothing');
    await keys(page, 'j', 'c');
    await copied(page, 2);
    assert.equal(await clipboard(page), 'BLOB, 242 bytes, starting 89 50 4E 47 0D 0A 1A 0A', 'a BLOB copies as its length and first bytes');
    await keys(page, 'h', 'c');
    await copied(page, 3);
    assert.equal(await clipboard(page), ['6', 'Sand Spit', '50.1098', '-4.7467', '2012-03-08', '', 'BLOB, 242 bytes, starting 89 50 4E 47 0D 0A 1A 0A'].join('\t'));
    await keys(page, 'l', 'j', 'Shift+C');
    await copied(page, 4);
    assert.equal(await clipboard(page), `> Sand Spit\n\n— \`${DB}#stations/6/name\`\n`);
    // J takes the next row too; c copies the run one row to a line.
    await keys(page, 'g', 'g', 'Shift+J');
    b = await bar(page);
    assert.equal(b.what, '2 parts');
    await keys(page, 'c');
    await copied(page, 5);
    assert.match(await clipboard(page), /^1\tNorth Mole\t50\.1182\t.*\n2\tFerry Steps\t50\.114\t/);
  });
});

test('K-tables 04 x shows a row’s record as stored, each value with its class; on a BLOB, its own first bytes', async () => {
  await withFrame({ files: FILES, open: [DB] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    await blur(page);
    await keys(page, 'g', 'g', 'j', 'x');
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-xray');
    let x = await xray(page);
    assert.equal(x.head, 'The record of stations, rowid 2, as stored · each value with its class');
    assert.deepEqual(x.lines, ['id  INTEGER  2', 'name  TEXT  "Ferry Steps"', 'lat  REAL  50.114', 'lon  REAL  -4.7388', 'opened  TEXT  "1991-09-03"', 'notes  TEXT  "Float gauge; read by the ferry crew each morning."', 'photo  BLOB  17,395 bytes']);
    await keys(page, 'x');
    await page.waitForFunction(() => !document.querySelector('[data-marxy-pane="0"] .marxy-xray'));
    await keys(page, 'l', 'j', 'j', 'j', 'j', 'j', 'j');
    assert.equal(await where(page), 'gauges.sqlite#stations/2/photo');
    await keys(page, 'x');
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-xray');
    x = await xray(page);
    assert.equal(x.head, 'photo of stations, rowid 2 · the BLOB\'s first 64 of 17,395 bytes, at its own offsets');
    assert.match(x.lines[0], /^89 50 4E 47 0D 0A 1A 0A/);
    assert.equal(x.lines.length, 4);
  });
});

test('K-tables 06 e only says the database is read, nothing is written; \\ goes to its bytes and back', async () => {
  await withFrame({ files: FILES, open: [DB] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    await blur(page);
    await keys(page, 'g', 'g', 'l', 'e');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((e) => /only read here/.test(e.textContent)));
    assert.ok((await notices(page)).some((t) => /only read here; nothing in it is changed/.test(t)));
    assert.equal(await page.evaluate((p) => window.__marxyHandle.shell.calls.filter((c) => /^write/.test(c.method) && c.args[0] === p).length, DB), 0, 'nothing written to the database');
    await keys(page, '\\');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-hex-magic').length > 0);
    await blur(page);
    await keys(page, 'g', 'g');
    assert.equal(await where(page), 'gauges.sqlite@0x0000', 'Source is the bytes, a row of them at a time');
    await keys(page, '\\');
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
  });
});

test('K-tables 07 rows come 200 at a time: j past the page’s last row draws the next 200, k back draws the 200 before', async () => {
  await withFrame({ files: FILES, open: [DB] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    await blur(page);
    await keys(page, ']');
    await waitWhere(page, 'gauges.sqlite#readings/1');
    assert.equal(await page.textContent('.marxy-tbl-pager-label'), 'Rows 1 to 200 of 1,240');
    await keys(page, 'Shift+G');
    assert.equal(await where(page), 'gauges.sqlite#readings/200', 'G is the last row drawn');
    // The page after is read while the cursor is on this one.
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.content.viewer().parts('rendered').find('readings\u0000200') !== null);
    assert.equal(await page.textContent('.marxy-tbl-pager-label'), 'Rows 1 to 200 of 1,240', 'read, not drawn');
    await keys(page, 'j');
    assert.equal(await where(page), 'gauges.sqlite#readings/201', 'j past the last row');
    assert.equal(await page.textContent('.marxy-tbl-pager-label'), 'Rows 201 to 400 of 1,240', 'draws the next 200');
    assert.equal((await bar(page)).text?.startsWith('201'), true, 'and marks the row');
    await keys(page, 'l', 'j', 'j', 'j');
    assert.equal(await where(page), 'gauges.sqlite#readings/201/height_m');
    await keys(page, 'h', 'k');
    assert.equal(await where(page), 'gauges.sqlite#readings/200');
    assert.equal(await page.textContent('.marxy-tbl-pager-label'), 'Rows 1 to 200 of 1,240', 'k back draws the 200 before');
  });
});

test('K-tables 09 o on a BLOB opens it in a tab of its own, read-only, as its own kind', async () => {
  await withFrame({ files: FILES, open: [DB] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    await blur(page);
    await keys(page, 'g', 'g', 'l');
    assert.ok(!(await bar(page)).verbs.includes('o open'), 'a number is not a file');
    await keys(page, 'j', 'j', 'j', 'j', 'j', 'j');
    const b = await bar(page);
    assert.equal(b.where, 'gauges.sqlite#stations/1/photo', 'the first photo');
    assert.deepEqual(b.verbs, ['c copy', 'C cite', 'x x-ray', 'o open', '\\ source', 'r read as', 'y collect', 'n note', 'Enter all']);
    await keys(page, 'o');
    await page.waitForFunction(() => document.querySelector('[data-marxy-viewer]')?.getAttribute('data-marxy-viewer') === 'image');
    assert.deepEqual(await rowOf(page), ['gauges.sqlite', 'photo-1.png*']);
    assert.match(await page.evaluate(() => window.__marxyHandle.panes().panes[0].path()), /^archive-entry:\d+\/stations\/photo-1\.png$/);
  });
});

test('K-tables 10 ] and [ step the tables and views; a WITHOUT ROWID row is named by its key, a view’s by its place', async () => {
  await withFrame({ files: FILES, open: [DB] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    await blur(page);
    await keys(page, ']');
    await waitWhere(page, 'gauges.sqlite#readings/1');
    await keys(page, ']');
    await waitWhere(page, 'gauges.sqlite#surveys/1');
    await keys(page, ']');
    await waitWhere(page, 'gauges.sqlite#tide_constants/1,K1');
    assert.equal((await bar(page)).what, 'row 1,K1');
    await keys(page, 'l', 'j', 'j');
    assert.equal(await where(page), 'gauges.sqlite#tide_constants/1,K1/amplitude');
    await keys(page, ']');
    await waitWhere(page, 'gauges.sqlite#daily_high/1');
    await keys(page, 'l', 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), 'North Mole');
    await keys(page, '[');
    await waitWhere(page, 'gauges.sqlite#tide_constants/1,K1');
    assert.equal(await page.textContent('.marxy-pbar-tab[aria-selected="true"] .marxy-pbar-name'), 'tide_constants', 'the bar follows');
  });
});

test('K-tables 12 a workbook’s rows then cells: a row by its sheet and number, a cell by its reference; c copies the value as stored', async () => {
  await withFrame({ files: FILES, open: [XLSX] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-sheet tbody tr');
    // The Cell card is a part picked: Outline shows it.
    await showCardPanel(page, 'now-cell');
    await blur(page);
    await keys(page, 'g', 'g', 'j', 'j', 'j', 'j');
    let b = await bar(page);
    assert.equal(b.where, 'tide-log-2026.xlsx#Summary!5', 'a row is named by its sheet and number');
    assert.equal(b.what, 'row 5');
    await keys(page, 'l', 'j', 'j', 'j', 'j', 'j');
    b = await bar(page);
    assert.equal(b.where, 'tide-log-2026.xlsx#Summary!F5', 'a cell by its sheet and reference');
    assert.equal(b.what, 'cell F5');
    assert.equal(b.text, '3.5%', 'it reads as its format says');
    await page.waitForSelector('.marxy-drawer [data-marxy-card="now-cell f5"]');
    await keys(page, 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), '0.03456221198156682', 'c copies the value as stored');
    await keys(page, 'Shift+C');
    await copied(page, 2);
    assert.equal(await clipboard(page), `> 0.03456221198156682\n\n— \`${XLSX}#Summary!F5\`\n`);
    // A merged title is one cell: row 1 holds A1, then G1.
    await keys(page, 'g', 'g', 'l');
    assert.equal(await where(page), 'tide-log-2026.xlsx#Summary!A1');
    await keys(page, 'j');
    assert.equal(await where(page), 'tide-log-2026.xlsx#Summary!G1');
    await keys(page, 'e');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((e) => /only read here/.test(e.textContent)));
    assert.equal(await page.evaluate((p) => window.__marxyHandle.shell.calls.filter((c) => /^write/.test(c.method) && c.args[0] === p).length, XLSX), 0, 'nothing written to the workbook');
  });
});

test('K-tables 13 x on a cell shows its value and formula as saved, named where it comes from; on a row, its cells', async () => {
  await withFrame({ files: FILES, open: [XLSX] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-sheet tbody tr');
    await blur(page);
    await keys(page, 'g', 'g', 'j', 'j', 'j', 'j', 'l', 'j', 'j', 'j', 'j', 'j', 'x');
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-xray');
    let x = await xray(page);
    assert.match(x.head, /^Cell F5 of Summary, as the Excel workbook saved it/);
    assert.deepEqual(x.lines, ['value  0.03456221198156682', 'type  a number', 'formula  =COUNTIFS(Readings!B:B,A5,Readings!E:E,"suspect")/B5', 'format  0.0%']);
    await keys(page, 'x', 'h', 'x');
    await page.waitForFunction(() => /^Row 5 of Summary/.test(document.querySelector('[data-marxy-pane="0"] .marxy-xray')?.getAttribute('aria-label') ?? ''));
    x = await xray(page);
    assert.equal(x.lines[0], 'A5  North Mole');
    assert.ok(x.lines.includes('F5  0.03456221198156682  =COUNTIFS(Readings!B:B,A5,Readings!E:E,"suspect")/B5'), x.lines.join('\n'));
  });
});

test('K-tables 14 ] steps to the Readings sheet; its 2,000 rows a page: G draws the last page, g g the first; c on a date copies its serial', async () => {
  await withFrame({ files: FILES, open: [XLSX] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-sheet tbody tr');
    await blur(page);
    await keys(page, ']');
    await waitWhere(page, 'tide-log-2026.xlsx#Readings!1');
    assert.equal(await page.$eval('.marxy-tbl-sheet', (t) => Number(t.getAttribute('aria-rowcount')) - 1), 2000);
    await keys(page, 'j', 'l', 'j', 'j');
    assert.equal(await where(page), 'tide-log-2026.xlsx#Readings!C2');
    assert.equal((await bar(page)).text, '2026-10-01 00:00', 'a date as its format says');
    await keys(page, 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), '46296', 'c on a date copies its stored serial number');
    await keys(page, 'Shift+G');
    assert.equal(await where(page), 'tide-log-2026.xlsx#Readings!2601', 'the last row of the sheet, not of the page');
    await page.waitForFunction(() => document.querySelector('.marxy-tbl-sheet tbody tr th')?.textContent === '2001');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] tr.marxy-cursor th')?.textContent === '2601', null, { timeout: 5000 });
    await keys(page, 'k');
    assert.equal(await where(page), 'tide-log-2026.xlsx#Readings!2600');
    await keys(page, 'g', 'g');
    assert.equal(await where(page), 'tide-log-2026.xlsx#Readings!1');
    await page.waitForFunction(() => document.querySelector('.marxy-tbl-sheet tbody tr th')?.textContent === '1');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] tr.marxy-cursor th')?.textContent === '1');
    await keys(page, '[');
    await waitWhere(page, 'tide-log-2026.xlsx#Summary!1');
    await keys(page, '[');
    assert.equal(await where(page), 'tide-log-2026.xlsx#Summary!1', '[ at the first sheet stays');
  });
});

test('K-tables 16 an ods reads the same way: c copies the stored value; the arrows no longer move a picked cell', async () => {
  await withFrame({ files: FILES, open: [ODS] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-sheet tbody tr');
    await showCardPanel(page, 'now-cell');
    await blur(page);
    await keys(page, 'g', 'g', 'j', 'j', 'j', 'j', 'l', 'j', 'j', 'j', 'j', 'j');
    assert.equal(await where(page), 'tide-log-2026.ods#Summary!F5');
    await keys(page, 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), '0.04');
    await keys(page, 'Escape');
    await page.click('td[data-marxy-cell="C5"]');
    await page.waitForSelector('.marxy-drawer [data-marxy-card="now-cell c5"]');
    await blur(page);
    await keys(page, 'ArrowDown', 'ArrowRight');
    assert.ok(await page.$('.marxy-drawer [data-marxy-card="now-cell c5"]'), 'the Cell card stays on C5');
  });
});
