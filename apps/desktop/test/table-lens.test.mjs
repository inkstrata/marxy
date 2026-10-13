// The table lens (K-10b, ADR-0071), in WebKit over the shipped skeleton and the memory shell. A `.csv` in Source becomes a
// grid from the strip's Table tool: its header row stays put on scroll, a number column is right-aligned, a sort by
// `cold_ms` orders the rows as numbers and writes nothing, and Esc returns to Source at the row. The awkward fixture shows
// every case honestly (a decoded cell marked, a line break and a bidi control as marks, an absent cell apart from an empty
// one, unreadable rows raw); a cell copies its decoded value, *Source field* copies its raw bytes, Jump to source selects
// exactly the raw field, and a copy of the whole table guards each formula. The stats follow an external change. The last
// test opens a CSV of 50 MB and records when its first rows are drawn and how long a sort and the stats hold the window.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness, harnessBase, routeSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);
after(() => closeHarness());

const fixture = (name) => readFileSync(new URL(`../../../fixtures/corpus/${name}`, import.meta.url), 'utf8');
const RESULTS = fixture('37-results.csv');
const AWKWARD = fixture('38-awkward.csv');
/** A table tall enough to scroll: a header and 300 rows. */
const TALL = `n,label,value\n${Array.from({ length: 300 }, (_, i) => `${i + 1},row-${i + 1},${(i * 37) % 101}`).join('\n')}\n`;
const files = {
  '/r/results.csv': RESULTS,
  '/r/awkward.csv': AWKWARD,
  '/r/tall.csv': TALL,
  '/r/plain.tsv': 'name\tnote\n"quoted"\t"a ""b"""\n',
  '/r/note.md': '# Note\n\nWords.\n',
};

async function withPage(fn, { width = 1280, height = 800 } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', (e) => console.log(`# pageerror: ${e.message}`));
    await fn(page);
  } finally {
    await browser.close();
  }
}

const boot = async (page, open, opts = {}) => {
  await bootTwoPanes(page, { files, open: [open], ...opts });
  await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source', null, { timeout: 15_000 });
};
const open = (page, path) => page.evaluate(async (p) => {
  await window.__marxyHandle.open(p);
}, path);
const run = (page, id) => page.evaluate(async (id) => {
  const { buildAppContext } = await import('/src/selection/bind.ts');
  const h = window.__marxyHandle;
  await h.commands().find((c) => c.id === id).run(buildAppContext(h));
}, id);
const settled = (page) => page.evaluate(async () => {
  const { lensOf } = await import('/src/kinds/table-lens.ts');
  await lensOf(window.__marxyHandle.panes().focused)?.settled();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});
const lensState = (page) => page.evaluate(async () => {
  const { lensOf } = await import('/src/kinds/table-lens.ts');
  return lensOf(window.__marxyHandle.panes().focused)?.state() ?? null;
});
/** The text of each drawn row's cells, as the grid shows them (the markers' labels left out). */
const shownRows = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-table-lens-grid tbody tr[data-record]')].map((tr) =>
  [...tr.querySelectorAll('td')].map((td) => {
    const copy = td.cloneNode(true);
    for (const g of copy.querySelectorAll('.marxy-invisible-glyph')) g.remove();
    return copy.textContent;
  })));
const bytesNow = (page) => page.evaluate(() => [...window.__marxyHandle.panes().focused.view.store().snapshot().buffer.bytes]);
/** Writes that reached a document of the test's (`/r/…`); the app's own state files are not the reader's documents. */
const writes = (page) => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => /^write/.test(c.method) && String(c.args[0]).startsWith('/r/')).length);
const copied = (page) => page.evaluate(() => {
  const call = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
  return call ? new TextDecoder().decode(call.args[0].find((r) => r.type === 'public.utf8-plain-text').bytes) : null;
});
const mod = (page) => page.evaluate(() => (navigator.platform === 'MacIntel' ? 'Meta' : 'Control'));
const enc = (s) => [...new TextEncoder().encode(s)];

test('the strip\'s Table tool shows a grid: the header stays put on scroll, numbers are right-aligned, a sort by cold_ms orders the rows as numbers, and nothing is written', () =>
  withPage(async (page) => {
    await boot(page, '/r/results.csv');
    const before = await bytesNow(page);
    // Unfolded, so the strip is drawn: Table is its first tool, Column stats the second, Chart is not there.
    await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    await page.waitForSelector('[data-marxy-workspace-region="strip"] button[data-tool="table"]');
    const tools = await page.$$eval('[data-marxy-workspace-region="strip"] button[data-tool]', (bs) => bs.map((b) => b.dataset.tool));
    assert.deepEqual(tools, ['table', 'column-stats']);
    await page.click('[data-marxy-workspace-region="strip"] button[data-tool="table"]');
    await page.waitForSelector('.marxy-table-lens-grid tbody tr[data-record]');
    await settled(page);
    const state = await lensState(page);
    assert.equal(state.header, true, 'row 1 of distinct words is the header');
    assert.match(await page.textContent('.marxy-table-lens-info'), /Table from 9 lines of CSV · Row 1 used as header/);
    assert.deepEqual(await page.$$eval('.marxy-table-lens-grid thead th[data-col] .marxy-table-lens-name', (n) => n.map((x) => x.textContent)), ['corpus', 'files', 'size_mb', 'cold_ms', 'warm_ms', 'peak_mb', 'host']);
    // The Source frame is under the grid, not in the way: hidden, inert, still mounted.
    assert.equal(await page.$eval('#marxy-source .marxy-source-frame', (f) => getComputedStyle(f).display === 'none' && f.hasAttribute('inert')), true);

    // A number column is right-aligned in tabular figures; an identifier column is in the code face.
    const align = await page.$eval('.marxy-table-lens-grid tbody td[data-col="3"]', (td) => ({ align: getComputedStyle(td).textAlign, nums: getComputedStyle(td).fontVariantNumeric }));
    assert.ok(align.align === 'right' || align.align === 'end', align.align);
    assert.match(align.nums, /tabular-nums/);
    assert.deepEqual(state.types, ['ident', 'number', 'number', 'number', 'number', 'number', 'ident']);

    // Sort by cold_ms: as numbers (1100 before 9900 before 118400), not as text.
    await page.click('.marxy-table-lens-grid thead th[data-col="3"] button');
    await settled(page);
    const cold = (await shownRows(page)).map((r) => Number(r[3]));
    assert.deepEqual(cold, [...cold].sort((a, b) => a - b));
    assert.equal(cold[0], 1100);
    assert.equal(cold.at(-1), 118400);
    assert.equal(await page.$eval('th[data-col="3"]', (th) => th.getAttribute('aria-sort')), 'ascending');
    assert.match(await page.textContent('.marxy-table-lens-info'), /sorted by cold_ms ↑ · the file is unchanged/);
    await page.click('.marxy-table-lens-grid thead th[data-col="3"] button');
    await settled(page);
    const down = (await shownRows(page)).map((r) => Number(r[3]));
    assert.deepEqual(down, [...down].sort((a, b) => b - a));

    // The lens never writes: the buffer is the file, and no write reached the shell.
    assert.deepEqual(await bytesNow(page), before);
    assert.equal(await writes(page), 0);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.view.store().snapshot().dirty ?? false), false);
  }));

test('the header row stays put while the rows scroll under it, and Esc returns to Source at the selected row', () =>
  withPage(async (page) => {
    await boot(page, '/r/tall.csv');
    await run(page, 'data.table-lens');
    await page.waitForSelector('.marxy-table-lens-grid tbody tr[data-record]');
    await settled(page);
    const headTop = () => page.$eval('.marxy-table-lens-grid thead th[data-col="0"]', (th) => th.getBoundingClientRect().top);
    const top0 = await headTop();
    await page.$eval('.marxy-table-lens-scroll', (s) => { s.scrollTop = 4000; });
    await page.waitForTimeout(120);
    assert.equal(await headTop(), top0, 'the header did not move');
    const firstShown = await page.$eval('.marxy-table-lens-grid tbody tr[data-record]', (tr) => Number(tr.dataset.record));
    assert.ok(firstShown > 100, `rows from ${firstShown} are drawn after the scroll: the grid draws what is on screen`);
    assert.ok(await page.$$eval('.marxy-table-lens-grid tbody tr[data-record]', (t) => t.length) < 120, 'only the rows near the screen are drawn');

    // Select a cell of the row labelled row-250 and press Esc: Source, with that row's line at the reading position.
    await page.$eval('.marxy-table-lens-scroll', (s) => { s.scrollTop = 0; });
    await page.evaluate(async () => {
      const { lensOf } = await import('/src/kinds/table-lens.ts');
      lensOf(window.__marxyHandle.panes().focused);
    });
    await page.click('.marxy-table-lens-grid tbody td[data-col="1"]');
    for (let i = 0; i < 249; i++) await page.keyboard.press('ArrowDown');
    const sel = (await lensState(page)).selected;
    assert.equal(sel.record, 250);
    assert.equal(await page.$eval('td[aria-selected="true"]', (td) => td.textContent), 'row-250');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.marxy-table-lens'));
    const at = await page.evaluate(async () => {
      const view = window.__marxyHandle.panes().focused.view;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const editor = activeSourceEditor();
      const focused = editor.view.hasFocus;
      return { mode: view.mode, byte: view.position().byteOffset, focused };
    });
    assert.equal(at.mode, 'source');
    const expected = new TextEncoder().encode(TALL.split('\n').slice(0, 250).join('\n') + '\n').length;
    assert.equal(at.byte, expected, 'Source is at the row the reader was on (its first byte)');
    assert.equal(at.focused, true, 'focus is back in Source');
  }));

test('the awkward fixture: the header line says what was reshaped, a decoded cell is marked, breaks and bidi controls are marks, an absent cell is not an empty one, unreadable rows are raw', () =>
  withPage(async (page) => {
    await boot(page, '/r/awkward.csv');
    await run(page, 'data.table-lens');
    await settled(page);
    const info = await page.textContent('.marxy-table-lens-info');
    for (const part of ['Table from 14 lines of CSV', 'starts with a byte-order mark', 'Row 1 used as header', '1 field decoded', '2 rows unreadable', '1 row short of 5 fields', '1 row longer than 5 fields', '1 blank line left out', 'Source Esc']) {
      assert.ok(info.includes(part), `${part} in: ${info}`);
    }
    const rows = await shownRows(page);
    // The decoded cell, and only it, carries the mark; a quoted field whose outer quotes alone went is not marked.
    const decoded = await page.$$eval('td[data-marxy-decoded]', (tds) => tds.map((td) => ({ text: td.textContent, title: td.title, desc: td.getAttribute('aria-description') })));
    assert.deepEqual(decoded, [{ text: 'said "hello"', title: 'decoded from "said ""hello"""', desc: 'decoded from "said ""hello"""' }]);
    assert.equal(rows[0][1], 'Ada, Countess');
    // A CRLF inside a field is a visible mark, never a silent space.
    assert.equal(rows[1][2], 'two↵lines');
    assert.equal(await page.$$eval('.marxy-table-lens-break', (b) => b.length), 1);
    // A bidi control and a zero-width space are markers, never acting.
    assert.equal(await page.$$eval('tr[data-record="8"] .marxy-invisible', (m) => m.length), 2);
    // Row 5 is short: its missing cells are absent (hatched, labelled), apart from row 4's empty fields.
    assert.equal(await page.$$eval('tr[data-record="5"] td.marxy-table-lens-absent', (t) => t.length), 4);
    assert.equal(await page.$$eval('tr[data-record="4"] td.marxy-table-lens-absent', (t) => t.length), 1, 'row 4 has five fields; only the sixth, long row\'s column is absent');
    assert.equal(rows[3][3], '', 'an empty field is an empty cell');
    assert.match(await page.$eval('tr[data-record="5"] td.marxy-table-lens-absent', (td) => td.getAttribute('aria-label')), /^absent: this row has 2 fields$/);
    // The long row adds a column of its own.
    assert.equal((await lensState(page)).columns, 6);
    // The unreadable rows show their own line, raw, under a label; nothing after them is lost.
    const bad = await page.$$eval('tr.marxy-table-lens-unreadable', (trs) => trs.map((tr) => [tr.querySelector('.marxy-table-lens-label').textContent, tr.querySelector('code').textContent]));
    assert.deepEqual(bad, [
      ['Unreadable · bytes after a closing quote', '7,"Gil"x,bad after quote,9,y'],
      ['Unreadable · a quote is never closed', '10,Kit,"never closed,12,v'],
    ]);
    assert.equal(rows.at(-1)[1], 'Lee', 'the row after an unclosed quote is read');
    // The count lists its places, each a Jump to source.
    await page.click('.marxy-table-lens-count:has-text("unreadable")');
    const places = await page.$$eval('.marxy-verb-menu-item', (items) => items.map((i) => i.textContent));
    assert.deepEqual(places, ['Row 7 · line 9Jump to source', 'Row 10 · line 13Jump to source']);
    await page.keyboard.press('Escape');

    // Row 1 is a header by inference; one click makes it a data row, and the file is unchanged.
    const before = await bytesNow(page);
    await page.click('[data-action="header"]');
    assert.equal((await lensState(page)).header, false);
    assert.equal(await page.textContent('[data-action="header"]'), 'Row 1 is data');
    assert.deepEqual(await page.$$eval('thead .marxy-table-lens-name', (n) => n.slice(0, 2).map((x) => x.textContent)), ['Column 1', 'Column 2']);
    assert.deepEqual((await shownRows(page))[0].slice(0, 2), ['id', 'name']);
    assert.deepEqual(await bytesNow(page), before);
  }));

test('a cell: ⌘C copies its decoded value with no guard, Source field copies its raw bytes, Jump to source selects exactly the raw field, and the whole table\'s copy guards formulas', () =>
  withPage(async (page) => {
    await boot(page, '/r/awkward.csv');
    await run(page, 'data.table-lens');
    await settled(page);
    const m = await mod(page);
    await page.click('td[data-marxy-decoded]');
    // A cell is a derived node, never the app's selection: no registered operation applies while one is selected (ADR-0071 item 7).
    const dispatch = await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const h = window.__marxyHandle;
      const ctx = buildAppContext(h);
      return { kind: ctx.selection.kind, input: ctx.operationInput(), ops: h.commands().filter((c) => c.id.startsWith('op.') && c.when(ctx)).map((c) => c.id) };
    });
    assert.deepEqual(dispatch, { kind: 'none', input: null, ops: [] });
    await page.keyboard.press(`${m}+KeyC`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    assert.equal(await copied(page), 'said "hello"');
    // A formula-looking cell copies as it reads: one value the reader is looking at carries no guard (ADR-0071 item 5).
    await page.click('tr[data-record="1"] td[data-col="4"]');
    await page.keyboard.press(`${m}+KeyC`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length === 2);
    assert.equal(await copied(page), '=SUM(A1:A3)');

    // Copy as: Source field (CSV) is the raw field's exact bytes, quotes and doubled quotes included.
    await page.click('td[data-marxy-decoded]');
    await page.keyboard.press(`${m}+Shift+KeyC`);
    await page.waitForSelector('[data-row-key="table.copy-source-field"]');
    assert.deepEqual(await page.$$eval('.marxy-verb-menu-item', (i) => i.map((x) => x.textContent)), ['Value (plain text)', 'Source field (CSV)', 'Table as TSV', 'Table as CSV']);
    await page.click('[data-row-key="table.copy-source-field"]');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length === 3);
    assert.equal(await copied(page), '"said ""hello"""');

    // The whole table as TSV: every cell a spreadsheet would run is guarded; a plain negative number is not.
    await page.keyboard.press(`${m}+Shift+KeyC`);
    await page.click('[data-row-key="table.copy-tsv"]');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length === 4);
    const tsv = (await copied(page)).split('\n').map((l) => l.split('\t'));
    assert.deepEqual(tsv[0], ['id', 'name', 'note', 'amount', 'formula', 'Column 6']);
    assert.equal(tsv[1][4], "'=SUM(A1:A3)");
    assert.equal(tsv[2][4], "'+cmd");
    assert.equal(tsv[3][4], "'@risk");
    assert.equal(tsv[6][4], '-5');
    assert.equal(tsv[1][2], 'said "hello"');

    // The cell's menu, in ADR-0071 item 6's order; Jump to source selects the raw field in Source, byte for byte.
    await page.click('td[data-marxy-decoded]', { button: 'right' });
    await page.waitForSelector('[data-row-key="table.jump"]');
    assert.deepEqual(await page.$$eval('.marxy-verb-menu-item .marxy-verb-menu-title', (i) => i.map((x) => x.textContent)), ['Copy', 'Copy as…', 'Source field (CSV)', 'Column stats', 'Sort by this column', 'Jump to source', 'Open in Source']);
    await page.click('[data-row-key="table.jump"]');
    await page.waitForFunction(() => !document.querySelector('.marxy-table-lens'));
    const selection = await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const v = activeSourceEditor().view;
      const s = v.state.selection.main;
      return v.state.sliceDoc(s.from, s.to);
    });
    assert.equal(selection, '"said ""hello"""');
    assert.equal(await writes(page), 0);
  }));

test('a TSV is never decoded: a quote is data, no cell is marked, and its Copy as offers no Source field', () =>
  withPage(async (page) => {
    await boot(page, '/r/plain.tsv');
    await run(page, 'data.table-lens');
    await settled(page);
    assert.deepEqual(await shownRows(page), [['"quoted"', '"a ""b"""']]);
    assert.equal(await page.$$eval('td[data-marxy-decoded]', (t) => t.length), 0);
    assert.match(await page.textContent('.marxy-table-lens-info'), /lines of TSV/);
    await page.click('td[data-col="1"]');
    await page.keyboard.press(`${await mod(page)}+Shift+KeyC`);
    await page.waitForSelector('.marxy-verb-menu-item');
    assert.deepEqual(await page.$$eval('.marxy-verb-menu-item', (i) => i.map((x) => x.textContent)), ['Value (plain text)', 'Table as TSV', 'Table as CSV']);
  }));

test('Table view is offered for a CSV or TSV only, and the tool again returns to Source', () =>
  withPage(async (page) => {
    await boot(page, '/r/results.csv');
    const offered = () => page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const h = window.__marxyHandle;
      return h.commands().find((c) => c.id === 'data.table-lens').when(buildAppContext(h));
    });
    assert.equal(await offered(), true);
    await run(page, 'data.table-lens');
    await page.waitForSelector('.marxy-table-lens');
    await run(page, 'data.table-lens');
    await page.waitForFunction(() => !document.querySelector('.marxy-table-lens'));
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.view.mode), 'source');
    assert.equal(await page.$eval('#marxy-source .marxy-source-frame', (f) => getComputedStyle(f).display !== 'none' && !f.hasAttribute('inert')), true);
    await open(page, '/r/note.md');
    assert.equal(await offered(), false);
  }));

test('the stats of a column are recomputed after an external change reloads the file', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/results.csv'], guard: true });
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source');
    await run(page, 'data.column-stats');
    await settled(page);
    const cold = async () => (await lensState(page)).stats[3];
    assert.deepEqual(await cold(), { count: 8, empty: 0, absent: 0, numbers: 8, min: 1100, max: 118400, mean: 36562.5 });
    assert.match(await page.$eval('tfoot td[data-col="3"]', (td) => td.textContent), /max 118,400/);
    await page.evaluate((text) => window.__outside('/r/results.csv', text), `${RESULTS}bigger,1,1,500000,1,1,m2-air\n`);
    await page.waitForFunction(async () => {
      const { lensOf } = await import('/src/kinds/table-lens.ts');
      const s = lensOf(window.__marxyHandle.panes().focused)?.state();
      return s?.stats?.[3]?.max === 500000;
    }, null, { timeout: 15_000 });
    assert.equal((await cold()).count, 9);
    assert.match(await page.$eval('tfoot td[data-col="3"]', (td) => td.textContent), /max 500,000/);
    assert.equal(await page.$$eval('.marxy-table-lens-grid tbody tr[data-record]', (t) => t.length), 9);
  }));

// ---- commitment 5: a CSV of 50 MB ---------------------------------------------------------------------------------------

const LARGE_SOURCE = `
  window.__makeCsv = (mb) => {
    const parts = ['id,name,city,score,when,note\\n'];
    let bytes = parts[0].length;
    for (let n = 0; bytes < mb * 1024 * 1024; n++) {
      const line = n + ',"user ' + n + '",city-' + (n % 977) + ',' + ((n * 37) % 10007) / 10 + ',2026-10-' + ((n % 28) + 1) + ',"a ""quoted"" note, with a comma"\\n';
      parts.push(line);
      bytes += line.length;
    }
    return new TextEncoder().encode(parts.join(''));
  };
`;

test(`a CSV of ${process.env.MARXY_CSV_MB ?? 50} MB: its first rows are drawn before its last byte is read, and a sort and the stats give the window back`, () =>
  withPage(async (page) => {
    const mb = Number(process.env.MARXY_CSV_MB ?? 50);
    const base = await harnessBase();
    await routeSkeleton(page, base);
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    await page.evaluate(LARGE_SOURCE);
    const size = await page.evaluate(async (mb) => {
      const bytes = window.__makeCsv(mb);
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { startApp } = await import('/src/app.ts');
      const handle = await startApp(createMemoryShell({ '/r/big.csv': bytes }), { argv: ['/r/big.csv'] });
      await handle.ready;
      window.__marxyHandle = handle;
      return bytes.length;
    }, mb);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source', null, { timeout: 120_000 });
    await page.waitForTimeout(500);
    /** Runs `fn` in the page with a 4 ms heartbeat: how often the main thread came back, and the longest it was held. */
    const timing = await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const { lensOf } = await import('/src/kinds/table-lens.ts');
      const h = window.__marxyHandle;
      const pane = h.panes().focused;
      const watch = () => {
        let worst = 0;
        let beats = 0;
        let last = performance.now();
        const id = setInterval(() => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; beats++; }, 4);
        return () => { clearInterval(id); worst = Math.max(worst, performance.now() - last); return { worst, beats }; };
      };
      const began = performance.now();
      let stop = watch();
      await h.commands().find((c) => c.id === 'data.table-lens').run(buildAppContext(h));
      const lens = lensOf(pane);
      await new Promise((r) => requestAnimationFrame(r));
      const firstRows = performance.now() - began;
      const first = lens.state().firstDraw;
      const drawn = document.querySelectorAll('.marxy-table-lens-grid tbody tr[data-record]').length;
      await lens.settled();
      const read = { ms: performance.now() - began, ...stop() };
      const records = lens.state().records;
      stop = watch();
      let t = performance.now();
      await lens.sortBy(3, 'desc');
      const sort = { ms: performance.now() - t, ...stop() };
      const top = [...document.querySelectorAll('.marxy-table-lens-grid tbody tr[data-record]')].slice(0, 3).map((tr) => tr.children[4].textContent);
      stop = watch();
      t = performance.now();
      await lens.setStats(true);
      const stats = { ms: performance.now() - t, ...stop(), max: lens.state().stats[3].max };
      return { firstRows, first, drawn, read, records, sort, top, stats, slices: lens.state().slices };
    });
    console.log(`# csv ${mb} MB (${size} bytes, ${timing.records} records): first rows drawn ${timing.firstRows.toFixed(0)} ms after the command, with ${timing.first.bytesRead} of ${timing.first.bytes} bytes read (${timing.first.records} records); the whole file read in ${timing.read.ms.toFixed(0)} ms, the window held at most ${timing.read.worst.toFixed(0)} ms (${timing.read.beats} beats)`);
    console.log(`# csv ${mb} MB: read in ${timing.slices.read} slices (the widest ${timing.slices.widestRead} bytes), sorted in ${timing.slices.sort}, stats in ${timing.slices.stats}`);
    console.log(`# csv ${mb} MB: sort by score, descending, ${timing.sort.ms.toFixed(0)} ms, held at most ${timing.sort.worst.toFixed(0)} ms (${timing.sort.beats} beats); stats ${timing.stats.ms.toFixed(0)} ms, held at most ${timing.stats.worst.toFixed(0)} ms (${timing.stats.beats} beats)`);
    assert.ok(timing.drawn > 0, 'rows are drawn at once');
    assert.ok(timing.first.bytesRead < timing.first.bytes / 100, `the first rows needed ${timing.first.bytesRead} of ${timing.first.bytes} bytes`);
    // Slicing is asserted by structure, not the clock (ADR-0032): the main thread came back many times during each piece of work.
    // The work is time-budgeted, so a slow machine only makes more, smaller slices; one task doing it all is the failure.
    const cut = timing.slices;
    assert.ok(cut.read >= 5, `the file was read in ${cut.read} slices`);
    assert.ok(cut.widestRead < timing.first.bytes / 2, `one slice read ${cut.widestRead} of ${timing.first.bytes} bytes`);
    assert.ok(cut.sort >= 5, `the sort ran in ${cut.sort} slices`);
    assert.ok(cut.stats >= 5, `the stats ran in ${cut.stats} slices`);
    assert.deepEqual(timing.top, ['1000.6', '1000.6', '1000.6']);
    assert.equal(timing.stats.max, 1000.6);
  }));
