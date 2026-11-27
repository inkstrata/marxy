// The sheet viewer at size, in WebKit over a stub shell: a worksheet page of 2,000 rows by 100 columns
// draws the rows near the screen, not 200,000 cells, and a click on a cell deep in the page finds its part.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);
after(() => closeHarness());

async function withSheet(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => console.log(`# pageerror: ${e.message}`));
    await bootTwoPanes(page, { files: { '/r/note.md': '# Note\n' }, open: ['/r/note.md'] });
    await page.evaluate(async () => {
      const { createSheetViewer } = await import('/src/viewers/sheet.ts');
      const ROWS = 2000;
      const COLS = 100;
      const sheet = { name: 'Wide', state: 'visible', kind: 'worksheet', rows: ROWS, cols: COLS, cells: ROWS * COLS, formulas: ROWS, merged: 1, cut: null };
      const book = {
        format: 'xlsx', sheets: [sheet], formats: [], formatsRead: true,
        properties: { application: null, appVersion: null, creator: null, lastModifiedBy: null, created: null, modified: null, title: null },
        macros: false, links: [], parts: null, compound: null, size: 1,
      };
      const cells = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push([r, c, c === 0 ? { v: { k: 'int', v: String(r) }, f: `ROW()-1` } : { v: { k: 'text', v: `r${r}c${c}` } }]);
      const shell = {
        tablesRows: async (_p, _s, from, count) => ({ from, to: from + count, cells: cells.filter(([r]) => r >= from && r < from + count), merges: [[3, 1, 4, 2]] }),
        readRange: async () => new Uint8Array(0),
      };
      const viewer = createSheetViewer({ shell, file: { path: '/r/wide.xlsx', size: 1, modified: 0 }, book });
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;height:800px;background:white;z-index:99';
      document.body.append(host);
      viewer.show('rendered', host);
      window.__sheet = { viewer, host };
    });
    await page.waitForSelector('.marxy-tbl-sheet tbody tr');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await fn(page);
  } finally {
    await browser.close();
  }
}

const tds = (page) => page.$$eval('.marxy-tbl-sheet td', (t) => t.length);

test('a page of 2,000 rows by 100 columns draws the rows near the screen, and Formulas does not draw the rest', () =>
  withSheet(async (page) => {
    const first = await tds(page);
    assert.ok(first < 5000, `first draw made ${first} cells`);
    assert.equal(await page.$eval('.marxy-tbl-sheet', (t) => t.getAttribute('aria-rowcount')), '2001', 'the table still says how many rows it has');
    await page.click('.marxy-tbl-segb:nth-child(2)');
    await page.waitForSelector('.marxy-tbl-fx');
    assert.ok((await tds(page)) < 5000, 'Formulas draws the same rows again');
    // Scrolling down draws more rows as they come near; the last one is row 2,000.
    for (let i = 0; i < 200; i++) {
      const done = await page.evaluate(() => {
        const s = document.querySelector('.marxy-tpage');
        s.scrollTop = s.scrollHeight;
        return document.querySelector('.marxy-tbl-sheet tbody tr:last-child th')?.textContent === '2000';
      });
      if (done) break;
      await page.waitForTimeout(30);
    }
    assert.equal(await page.$eval('.marxy-tbl-sheet tbody tr:last-child th', (th) => th.textContent), '2000');
  }));

test('a click on a cell in row 1,500 of a 100-column page finds its part', () =>
  withSheet(async (page) => {
    const got = await page.evaluate(async () => {
      const { unitAt } = await import('/src/parts/cursor.ts');
      const tree = window.__sheet.viewer.parts('rendered');
      const cell = tree.find('0!1499!50');
      const td = cell.el();
      if (!td) return { error: 'row 1,500 was not drawn' };
      const t0 = performance.now();
      const unit = unitAt(tree, td);
      const ms = performance.now() - t0;
      const row = unitAt(tree, td.parentElement.querySelector('th'));
      return { id: unit?.id ?? null, row: row?.id ?? null, ms };
    });
    assert.equal(got.error, undefined, got.error);
    assert.equal(got.id, '0!1499!50', 'the cell under the click');
    assert.equal(got.row, '0!1499', 'the row under a click on its number');
    assert.ok(got.ms < 50, `unitAt took ${got.ms} ms`);
  }));
