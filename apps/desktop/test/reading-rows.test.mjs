// A long CSV or JSON Lines in the Table reading reaches every row: the rows near the screen are on the page, each with
// the bytes it was read from, the last row is as near as the scrollbar's end, and sorting, the row filter and find go
// through every row of the file, not the rows drawn. Playwright WebKit over the app harness (src/harness/web.ts); the
// files are made in the page and written to the memory shell, so no large fixture is kept.
import { strict as assert } from 'node:assert';
import { after, before, test as nodeTest } from 'node:test';
import { closeHarness, harnessBase } from './support/two-pane.mjs';
import { openBrowser, skip } from './support/kit.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
let browser = null;
before(async () => {
  if (!skip) browser = await openBrowser();
});
after(async () => {
  await browser?.close();
  await closeHarness();
});

const ROWS = 50_000;

async function withPage(fn) {
  const base = await harnessBase();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  try {
    await page.goto(`${base}?open=${encodeURIComponent('data/p95-latency.csv')}`);
    await page.waitForFunction(() => window.marxy?.handle);
    await fn(page);
  } finally {
    await page.close();
  }
  assert.deepEqual(problems, []);
}

/** Writes `name` under /demo/data, made in the page, and opens it in Read; resolves once every row is read. */
async function openMade(page, name, form) {
  await page.evaluate(
    async ({ name, form, rows }) => {
      const lines = form === 'csv' ? ['id,city,status,note'] : [];
      for (let i = 1; i <= rows; i++) {
        const city = ['Oslo', 'Lima', 'Kyoto', 'Accra'][i % 4];
        if (form === 'csv') lines.push(`${i},${city},${i % 17 === 0 ? 'refunded' : 'paid'},${i % 1000 === 0 ? '"two\nlines"' : `order ${i}`}`);
        else lines.push(JSON.stringify(i === rows - 10 ? { id: i, city, late: true } : { id: i, city }));
        if (form === 'jsonl' && i === 7) lines.push('');
      }
      await window.marxy.shell.plant(`/demo/data/${name}`, new TextEncoder().encode(`${lines.join('\n')}\n`));
      await window.marxy.handle.open(`/demo/data/${name}`);
    },
    { name, form, rows: ROWS },
  );
  await page.waitForFunction((n) => document.title.startsWith(n) && document.querySelector('.marxy-article .marxy-reading-table tbody tr[data-marxy-s]'), name);
  await page.waitForFunction(() => document.querySelector('[data-marxy-rows-note]')?.textContent === '' && !/so far/.test(document.querySelector('[data-marxy-rows-head]')?.textContent ?? ''));
}

const drawnRows = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.marxy-article .marxy-reading-table tbody tr[data-marxy-s]')].map((tr) => ({ s: Number(tr.dataset.marxyS), e: Number(tr.dataset.marxyE), first: tr.cells[0]?.textContent ?? '' })));

const scrollToEnd = (page) =>
  page.evaluate(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

test('a long CSV draws the rows near the screen, each with its bytes, and reaches its last row', async () => {
  await withPage(async (page) => {
    await openMade(page, 'long.csv', 'csv');
    const top = await drawnRows(page);
    assert.ok(top.length > 20 && top.length < 200, `${top.length} rows on the page`);
    assert.equal(top[0].first, '1');
    await scrollToEnd(page);
    const end = await drawnRows(page);
    assert.equal(end[end.length - 1].first, String(ROWS));
    // Every drawn row's bytes are its record, the quoted line break inside it.
    const records = await page.evaluate(async (rows) => {
      const bytes = await window.marxy.shell.readFile('/demo/data/long.csv');
      return rows.map((r) => new TextDecoder().decode(bytes.subarray(r.s, r.e)));
    }, end);
    for (const [i, text] of records.entries()) assert.ok(text.startsWith(`${end[i].first},`), text);
    assert.ok(records.some((t) => t.includes('"two\nlines"')), 'a field over two lines is one row');
    // An edit is a splice over the bytes, as on any page: the last row taken out, the table read again without it.
    const last = end[end.length - 1];
    await page.evaluate(async (r) => {
      const store = window.marxy.handle.panes().focused.content.store();
      await window.marxy.handle.dispatch({ type: 'apply', range: { start: r.s, end: r.e + 1 }, replacement: '', label: 'Delete row', baseVersion: store.snapshot().version });
    }, last);
    await page.waitForFunction((n) => {
      const trs = [...document.querySelectorAll('.marxy-article .marxy-reading-table tbody tr[data-marxy-s]')];
      return trs.some((tr) => tr.cells[0]?.textContent === String(n - 1)) && !trs.some((tr) => tr.cells[0]?.textContent === String(n));
    }, ROWS);
    assert.equal(await page.evaluate(() => window.marxy.handle.panes().focused.content.store().snapshot().dirty), true);
  });
});

test('sorting, the row filter and find go through every row of a long CSV', async () => {
  await withPage(async (page) => {
    await openMade(page, 'sorted.csv', 'csv');
    await page.click('.marxy-article th[data-marxy-sort="0"]');
    await page.waitForFunction(() => /Sorted by id, high to low/.test(document.querySelector('[data-marxy-sort-note]')?.textContent ?? ''));
    assert.equal((await drawnRows(page))[0].first, String(ROWS));
    const kept = await page.evaluate(async () => {
      const m = await import('/src/view/reading-filter.ts');
      return m.filterRows(document.querySelector('.marxy-article'), 'refunded', () => '/demo/data/sorted.csv');
    });
    assert.deepEqual(kept, { shown: Math.floor(ROWS / 17), total: ROWS });
    assert.equal((await drawnRows(page))[0].first, String(Math.floor(ROWS / 17) * 17));
    await page.evaluate(async () => (await import('/src/view/reading-filter.ts')).clearRowFilter(document.querySelector('.marxy-article')));
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+f`);
    await page.keyboard.type('order 49999');
    await page.waitForFunction(() => /\b1 of 1\b/.test(document.querySelector('.marxy-find-slot')?.textContent ?? ''));
    const shown = await page.evaluate(() =>
      [...document.querySelectorAll('.marxy-article .marxy-reading-table tbody tr[data-marxy-s]')].some((tr) => {
        const r = tr.getBoundingClientRect();
        return tr.cells[0]?.textContent === '49999' && r.top >= 0 && r.bottom <= innerHeight;
      }),
    );
    assert.ok(shown, 'find brings the row of its match into view');
  });
});

test('a long JSON Lines file reads every line: its count, a key that first appears near the end, a blank line kept out', async () => {
  await withPage(async (page) => {
    await openMade(page, 'long.jsonl', 'jsonl');
    assert.equal(await page.textContent('[data-marxy-rows-head]'), `JSON Lines · ${ROWS.toLocaleString('en-GB')} records · 3 keys`);
    const heads = await page.evaluate(() => [...document.querySelectorAll('.marxy-article .marxy-reading-table thead th')].map((th) => th.textContent));
    assert.deepEqual(heads, ['id', 'city', 'late']);
    await scrollToEnd(page);
    const end = await drawnRows(page);
    assert.equal(end[end.length - 1].first, String(ROWS));
  });
});
