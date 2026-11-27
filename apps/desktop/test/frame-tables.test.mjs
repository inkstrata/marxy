// A SQLite database and a spreadsheet as the table page:
// the bar of parts at the page's foot, rows 200 at a time with Earlier, Later and Go to row, the Cell card and a BLOB
// opened into memory, a view run, the schema, the WAL read and the file alone as a choice, a locked file read from a
// copy, an encrypted one falling to the card; a workbook's values in its own formats, Formulas, merges, hidden sheets
// and the 2,000-row draw. The browser build answers from what the desktop's readers gave for the demo's files
// (src/harness/tables-demo.json); `cargo test` covers the readers themselves. WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as nodeTest } from 'node:test';
import { skip, withApp } from './support/kit.mjs';
import { cardText, cardsOf, rowOf, showCardPanel, showPanel } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo');
const bytes = (rel) => readFileSync(join(demo, rel));
const FILES = {
  '/r/README.md': '# Here\n',
  '/r/data/gauges.sqlite': bytes('data/gauges.sqlite'),
  '/r/data/journal.sqlite': bytes('data/journal.sqlite'),
  '/r/data/journal.sqlite-wal': bytes('data/journal.sqlite-wal'),
  '/r/data/journal.sqlite-shm': bytes('data/journal.sqlite-shm'),
  '/r/data/tidemark-cache.db': bytes('data/tidemark-cache.db'),
  '/r/data/vault.db': bytes('data/vault.db'),
  '/r/sheets/tide-log-2026.xlsx': bytes('sheets/tide-log-2026.xlsx'),
  '/r/sheets/tide-log-2026.ods': bytes('sheets/tide-log-2026.ods'),
  '/r/sheets/harbour-dues-1999.xls': bytes('sheets/harbour-dues-1999.xls'),
};

const tabs = (page) => page.$$eval('.marxy-pbar-tab', (els) => els.map((e) => `${e.querySelector('.marxy-pbar-name').textContent}${e.getAttribute('aria-selected') === 'true' ? '*' : ''}`));
// The passing cards (This byte, Cell, Glyph) are the part under the cursor, Metadata's "This part".
const factsOf = async (page, id) => {
  await (id.startsWith('now-') ? showPanel(page, 'metadata') : showCardPanel(page, id));
  return page.evaluate((id) => Object.fromEntries([...document.querySelectorAll(`.marxy-drawer [data-marxy-card="${id}"] .marxy-fact`)].map((e) => [e.children[0].textContent, e.children[1].textContent])), id);
};
const calls = (page, method) => page.evaluate((m) => window.__marxyHandle.shell.calls.filter((c) => c.method === m).map((c) => c.args), method);
const head = (page) => page.evaluate(() => {
  const g = document.querySelector('.marxy-guess');
  // The head's mark is kept current but never drawn, so it is read by its hidden attribute, not by layout.
  return g && !g.hidden ? { text: g.textContent, tier: g.hasAttribute('data-marxy-tier') } : null;
});
const pickPart = async (page, name) => {
  // A click on a cell puts the parts cursor there; its verb bar stands above the parts bar, so the tab is pressed as it is.
  const clear = await page.evaluate(() => {
    const bar = document.querySelector('.marxy-verb-bar');
    if (!bar || bar.hidden) return true;
    const a = bar.getBoundingClientRect();
    const b = document.querySelector('.marxy-pbar').getBoundingClientRect();
    return a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right;
  });
  assert.equal(clear, true, 'the verb bar sits clear of the parts bar');
  await page.click(`.marxy-pbar-tab:has(.marxy-pbar-name:text-is("${name}"))`);
  await page.waitForFunction((name) => document.querySelector('.marxy-pbar-tab[aria-selected="true"] .marxy-pbar-name')?.textContent === name, name);
};
const gridRow = (page, i) => page.$eval(`.marxy-tbl-grid tbody tr:nth-child(${i + 1})`, (tr) => [...tr.children].map((c) => c.textContent));

test('a database opens as the table page: its parts in the bar at the foot, Schema last, columns with their declared types, NULL said, a BLOB as its size', async () => {
  await withApp({ files: FILES, open: ['/r/data/gauges.sqlite'] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'sqlite');
    assert.equal(await page.textContent('.marxy-tbl-line'), 'SQLite 3 · 4 tables, 2 views, 2 indexes, 1 trigger · 300.0 KB');
    assert.deepEqual(await tabs(page), ['stations*', 'readings', 'surveys', 'tide_constants', 'daily_high', 'suspect_readings', 'sqlite_sequence', 'Schema']);
    assert.deepEqual(await page.$$eval('.marxy-pbar-label', (els) => els.map((e) => e.textContent)), ['Tables', 'Views', 'SQLite’s']);
    assert.equal(await page.textContent('.marxy-tbl-sub'), 'table · 6 rows · 7 columns');
    assert.deepEqual(await page.$$eval('.marxy-tbl-grid thead th', (ths) => ths.map((t) => t.innerText.replace(/\n/g, ' '))), ['id INTEGER · key', 'name TEXT', 'lat REAL', 'lon REAL', 'opened TEXT', 'notes TEXT', 'photo BLOB']);
    assert.deepEqual(await gridRow(page, 1), ['2', 'Ferry Steps', '50.114', '-4.7388', '1991-09-03', 'Float gauge; read by the ferry crew each morning.', 'BLOB · 17.0 KB']);
    assert.equal(await page.$eval('.marxy-tbl-grid tbody tr:nth-child(4) td[data-marxy-col="6"]', (td) => [td.textContent, td.classList.contains('marxy-tbl-null'), getComputedStyle(td).fontStyle].join()), 'NULL,true,italic');
    assert.equal(await page.$eval('.marxy-tbl-grid tbody tr:nth-child(1) td[data-marxy-col="2"]', (td) => getComputedStyle(td).textAlign), 'right', 'numbers to the right');
    assert.match(await page.textContent('.marxy-tbl .marxy-account-body'), /Rows are in the order they are stored, by rowid, 200 at a time\. They are never sorted/);
    // The bar is inside the page, under the rows.
    assert.equal(await page.$eval('.marxy-pbar', (n) => n.parentElement.classList.contains('marxy-tpage')), true);
    // Metadata: Reading, Database, Facts; Outline: Tables.
    assert.deepEqual((await cardsOf(page)).map((c) => c.title), ['Reading', 'Facts', 'Database', 'Tables']);
    assert.match(await cardText(page, 'reading'), /Shown as a SQLite database/);
    assert.match(await cardText(page, 'contents'), /readings\s+1,240/);
    const dbFacts = await factsOf(page, 'frontmatter');
    assert.equal(dbFacts.pages, '75 of 4,096 bytes');
    assert.equal(dbFacts.journal, 'rollback');
    assert.equal(dbFacts.application, '0x54444D4B · “TDMK”');
    assert.equal(dbFacts['written by'], 'SQLite 3.49.1');
    assert.equal(await head(page), null, 'read in place: the head is quiet');
    // Read by the shell, never whole by the page.
    assert.deepEqual((await calls(page, 'tablesOpen'))[0], ['/r/data/gauges.sqlite', false]);
    assert.equal((await calls(page, 'readFile')).filter(([p]) => p === '/r/data/gauges.sqlite').length, 0);
  });
});

test('a BLOB picked is the passing Cell card: its first bytes, what it seems to be, and Open it, into memory in a tab of its own', async () => {
  await withApp({ files: FILES, open: ['/r/data/gauges.sqlite'] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    await page.click('.marxy-tbl-grid tbody tr:nth-child(2) td[data-marxy-col="6"]');
    await showPanel(page, 'metadata');
    await page.waitForFunction(() => /a PNG image, 128 × 80/.test(document.querySelector('.marxy-drawer [data-marxy-card="now-cell"]')?.innerText ?? ''));
    const cell = await factsOf(page, 'now-cell');
    assert.equal(cell.row, '2 · rowid 2');
    assert.equal(cell.column, 'photo · declared BLOB');
    assert.equal(cell['stored as'], 'BLOB');
    assert.equal(cell.size, '17.0 KB · 17,395 bytes');
    assert.equal(cell.starts, '89 50 4E 47 0D 0A 1A 0A');
    assert.equal(cell.seems, 'a PNG image, 128 × 80');
    assert.equal((await cardsOf(page, 'metadata')).at(-1).title, 'Cell', 'a passing card, Metadata\'s part under the cursor, after the standing ones');
    await page.click('.marxy-drawer .marxy-tbl-open');
    await page.waitForFunction(() => document.querySelector('[data-marxy-viewer]')?.getAttribute('data-marxy-viewer') === 'image');
    assert.deepEqual(await rowOf(page), ['gauges.sqlite', 'photo-2.png*']);
    assert.match(await page.evaluate(() => window.__marxyHandle.panes().panes[0].path()), /^archive-entry:\d+\/stations\/photo-2\.png$/);
    // An ordinary cell: its value and the type SQLite stored.
    await page.click('.marxy-tab:has-text("gauges.sqlite")');
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    await page.click('.marxy-tbl-grid tbody tr:nth-child(1) td[data-marxy-col="2"]');
    await showPanel(page, 'metadata');
    await page.waitForFunction(() => /column\s*lat · declared REAL/.test(document.querySelector('.marxy-drawer [data-marxy-card="now-cell"]')?.innerText ?? ''));
    const lat = await factsOf(page, 'now-cell');
    assert.equal(lat['stored as'], 'REAL');
    assert.equal(lat.value, '50.1182');
  });
});

test('rows come 200 at a time with Earlier, Later and Go to row; a view runs and says what it is; the schema says triggers never run', async () => {
  await withApp({ files: FILES, open: ['/r/data/gauges.sqlite'] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    await pickPart(page, 'readings');
    await page.waitForFunction(() => document.querySelector('.marxy-tbl-pager-label')?.textContent === 'Rows 1 to 200 of 1,240');
    assert.equal(await page.$$eval('.marxy-tbl-grid tbody tr', (r) => r.length), 200);
    assert.equal(await page.isDisabled('.marxy-tbl-pager button:has-text("Earlier")'), true);
    await page.click('.marxy-tbl-pager button:has-text("Later")');
    await page.waitForFunction(() => document.querySelector('.marxy-tbl-pager-label')?.textContent === 'Rows 201 to 400 of 1,240');
    assert.equal((await gridRow(page, 0))[0], '201');
    await page.fill('.marxy-tbl-goto-input', '1,239');
    await page.press('.marxy-tbl-goto-input', 'Enter');
    await page.waitForFunction(() => document.querySelector('.marxy-tbl-pager-label')?.textContent === 'Rows 1,201 to 1,240 of 1,240');
    assert.equal(await page.isDisabled('.marxy-tbl-pager button:has-text("Later")'), true);
    await page.click('.marxy-tbl-pager button:has-text("Earlier")');
    await page.waitForFunction(() => document.querySelector('.marxy-tbl-pager-label')?.textContent === 'Rows 1,001 to 1,200 of 1,240');
    assert.deepEqual((await calls(page, 'tablesRows')).map((c) => c.slice(1, 3)).filter(([p]) => p === 'readings'), [['readings', 0], ['readings', 200], ['readings', 1200], ['readings', 1000]]);
    // The column's CREATE statement, folded.
    await page.click('.marxy-tbl-ddl');
    assert.match(await page.textContent('.marxy-tbl-sql'), /^CREATE TABLE readings\(/);
    // A view runs when opened, read-only.
    await pickPart(page, 'daily_high');
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    assert.match(await page.textContent('.marxy-tbl-sub'), /^view · [\d,]+ rows · 3 columns$/);
    assert.match(await page.textContent('.marxy-tbl-note'), /^A view is a query: its rows are what it selects now, read-only/);
    assert.deepEqual(await page.$$eval('.marxy-tbl-grid thead th', (ths) => ths.map((t) => t.innerText.trim().replace(/\n/g, ' '))), ['station TEXT', 'day', 'high_m'], 'a column the view takes from a table keeps its declared type');
    assert.match(await cardText(page, 'contents'), /daily_high view\s+[\d,]+/);
    // A WITHOUT ROWID table is in key order.
    await pickPart(page, 'tide_constants');
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    assert.match(await page.textContent('.marxy-tbl-sub'), /^table, WITHOUT ROWID · 12 rows/);
    assert.match(await page.textContent('.marxy-tbl .marxy-account-body'), /Rows are in key order, as a WITHOUT ROWID table stores them/);
    // Schema is the last item: every CREATE statement, coloured, triggers said never to run.
    await pickPart(page, 'Schema');
    await page.waitForSelector('.marxy-tbl-group');
    assert.deepEqual(await page.$$eval('.marxy-tbl-group', (els) => els.map((e) => e.textContent)), ['Tables', 'Views', 'Indexes', 'Triggers']);
    assert.ok((await page.textContent('.marxy-tpage')).includes('A trigger runs only when something writes, and nothing here writes: these never run.'));
    assert.ok((await page.$$eval('.marxy-sql-kw', (els) => els.map((e) => e.textContent))).includes('TRIGGER'));
    // ← and → move along the bar.
    await page.focus('.marxy-pbar-tab[aria-selected="true"]');
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('.marxy-pbar-tab[aria-selected="true"] .marxy-pbar-name')?.textContent === 'sqlite_sequence');
  });
});

test('a WAL database is read with its log, said in grey in the head and above the rows; the file alone is a choice, said as yours', async () => {
  await withApp({ files: FILES, open: ['/r/data/journal.sqlite'] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    await page.waitForFunction(() => document.querySelector('.marxy-guess')?.textContent === 'With its WAL');
    assert.deepEqual(await head(page), { text: 'With its WAL', tier: true });
    assert.match(await page.textContent('.marxy-tbl-state'), /^Read with its write-ahead log, journal\.sqlite-wal, beside it, as SQLite reads it: the log's committed pages stand over the file's own\. Nothing is checkpointed or written\./);
    assert.equal(await page.textContent('.marxy-tbl-sub'), 'table · 52 rows · 3 columns');
    assert.match((await factsOf(page, 'frontmatter')).journal, /^WAL · 7 frames in the log, 3 commits/);
    await page.click('.marxy-tbl-state button:has-text("Read the file alone")');
    await page.waitForFunction(() => document.querySelector('.marxy-tbl-sub')?.textContent === 'table · 40 rows · 3 columns');
    await page.waitForFunction(() => document.querySelector('.marxy-guess')?.textContent === 'The file alone · your choice');
    assert.match(await page.textContent('.marxy-tbl-state'), /^The file alone, as of its last checkpoint: journal\.sqlite-wal beside it is left unread, your choice\./);
    assert.deepEqual((await calls(page, 'tablesOpen')).at(-1), ['/r/data/journal.sqlite', true]);
    // Kept in readings.json, beside the other reading choices.
    const keptAlone = () =>
      page.evaluate(async () => {
        const shell = window.__marxyHandle.shell;
        const paths = await shell.configPaths();
        try {
          return JSON.parse(new TextDecoder().decode(await shell.readFile(`${paths.data}/readings.json`))).alone ?? null;
        } catch {
          return null;
        }
      });
    // The write is the app's own, after the click: poll on frames until the file says it, the test's timeout bounding it.
    await page.evaluate(async () => {
      const kept = async () => {
        const shell = window.__marxyHandle.shell;
        const paths = await shell.configPaths();
        try {
          return JSON.parse(new TextDecoder().decode(await shell.readFile(`${paths.data}/readings.json`))).alone != null;
        } catch {
          return false;
        }
      };
      while (!(await kept())) await new Promise((r) => requestAnimationFrame(r));
    });
    const alone = await keptAlone();
    assert.deepEqual(alone, ['/r/data/journal.sqlite'], 'the choice is kept in readings.json');
    await page.click('.marxy-tbl-state button:has-text("Read it with its WAL")');
    await page.waitForFunction(() => document.querySelector('.marxy-tbl-sub')?.textContent === 'table · 52 rows · 3 columns');
  });
});

test('a locked database is read from a copy in memory, said; an encrypted one falls to the file card and the head stays quiet; its log names it', async () => {
  await withApp({ files: FILES, open: ['/r/data/tidemark-cache.db'] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    await page.waitForFunction(() => document.querySelector('.marxy-guess')?.textContent === 'A copy in memory · the file is locked');
    assert.match(await page.textContent('.marxy-tbl-state'), /^Another program holds this database for itself alone, so it cannot be opened in place\. It is read from a copy of its bytes taken into memory/);
    assert.equal(await page.$eval('.marxy-tbl-grid thead th', (th) => th.textContent), 'rowid', 'a TEXT key: the rowid is a column of its own');
    assert.equal((await factsOf(page, 'frontmatter')).locked, 'by another program: read from a copy in memory');
  });
  await withApp({ files: FILES, open: ['/r/data/vault.db'] }, async (page) => {
    await page.waitForSelector('.marxy-fcard');
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'card');
    const card = await page.innerText('.marxy-fcard');
    assert.match(card, /probably an encrypted database/);
    assert.match(card, /The name says \.db, a database, but its first bytes, 96 93 C9 DC FF 66 ED F2 68 E7 6A 6A 02 DE BA 21, are not SQLite's header\./);
    assert.match(card, /bits a byte, of 8\), as encrypted data is\. SQLCipher and its kind write nothing in the clear\./);
    assert.match(card, /The app does not ask for database keys, so it shows the bytes\./);
    assert.equal(await head(page), null);
    assert.equal((await calls(page, 'tablesOpen')).length, 0, 'no SQLite header: nothing asked of SQLite');
  });
  await withApp({ files: FILES, open: ['/r/data/journal.sqlite-wal'] }, async (page) => {
    await page.waitForSelector('.marxy-fcard');
    const card = await page.innerText('.marxy-fcard');
    assert.match(card, /a SQLite write-ahead log/);
    assert.match(card, /It belongs to journal\.sqlite beside it, and is read with it\./);
    await page.click('.marxy-fcard button:has-text("Open journal.sqlite")');
    await page.waitForFunction(() => document.querySelector('[data-marxy-viewer]')?.getAttribute('data-marxy-viewer') === 'sqlite');
    assert.deepEqual(await rowOf(page), ['journal.sqlite-wal', 'journal.sqlite*']);
  });
});

test('Source is the bytes, SQLite’s header underlined; Export offers the database, a table as CSV and the schema', async () => {
  await withApp({ files: FILES, open: ['/r/data/gauges.sqlite'] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr');
    const names = await page.evaluate(() => window.__marxyHandle.panes().focused.content.viewer().exports('rendered').map((e) => e.name));
    assert.deepEqual(names, ['The database, as it is', 'stations as CSV', 'The schema']);
    const csv = await page.evaluate(async () => new TextDecoder().decode((await window.__marxyHandle.panes().focused.content.viewer().exports('rendered')[1].build()).bytes));
    assert.equal(csv.split('\r\n')[0], 'id,name,lat,lon,opened,notes,photo');
    assert.equal(csv.split('\r\n')[2], '2,Ferry Steps,50.114,-4.7388,1991-09-03,Float gauge; read by the ferry crew each morning.,"[BLOB, 17395 bytes]"');
    await page.click('.marxy-rs-source');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-hex-magic').length > 0);
    assert.equal(await page.$('.marxy-tbl-grid'), null);
  });
});

test('a workbook: values as saved in its own formats, a formula’s corner mark, merges drawn merged, errors and missing values as saved, the Cell card', async () => {
  await withApp({ files: FILES, open: ['/r/sheets/tide-log-2026.xlsx'] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-sheet tbody tr');
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'sheet');
    assert.equal(await page.textContent('.marxy-tbl-line'), 'Excel workbook · 5 sheets, 2 of them hidden');
    assert.equal(await page.textContent('.marxy-tbl-bar .marxy-tbl-sub'), 'Summary · 17 rows, 7 columns · 37 formulas · 3 merged ranges');
    assert.deepEqual(await page.$$eval('.marxy-tbl-sheet thead th', (ths) => ths.map((t) => t.textContent)), ['', 'A', 'B', 'C', 'D', 'E', 'F', 'G']);
    const cell = (name) => page.$eval(`td[data-marxy-cell="${name}"]`, (td) => ({ text: td.textContent, f: td.classList.contains('marxy-tbl-hasf'), span: td.colSpan, rows: td.rowSpan }));
    assert.deepEqual(await cell('F5'), { text: '3.5%', f: true, span: 1, rows: 1 });
    assert.equal((await cell('C5')).text, '2.91');
    assert.equal((await cell('G5')).text, '#DIV/0!');
    assert.equal((await cell('B12')).text, 'no saved value');
    assert.equal((await cell('B13')).text, '2026-10-31 23:43');
    assert.equal((await cell('A1')).span, 6, 'the title merged across A1:F1');
    assert.equal((await cell('A15')).rows, 3, 'the notes label down A15:A17');
    assert.equal(await page.$('td[data-marxy-cell="B1"]'), null, 'a merge covers its cells');
    assert.equal(await page.$eval('td[data-marxy-cell="F5"]', (td) => getComputedStyle(td, '::before').borderTopWidth), '5px', 'the corner mark');
    await page.click('td[data-marxy-cell="F5"]');
    await showPanel(page, 'metadata');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-card="now-cell f5"]'));
    const f5 = await factsOf(page, 'now-cell f5');
    assert.equal(f5.shows, '3.5%');
    assert.equal(f5.stored, '0.03456221198156682');
    assert.equal(f5.type, 'a number');
    assert.equal(f5.format, '0.0%');
    assert.equal(f5.formula, '=COUNTIFS(Readings!B:B,A5,Readings!E:E,"suspect")/B5');
    assert.equal(f5['worked out'], 'by the app that saved it; the reader does not recalculate');
    assert.deepEqual((await cardsOf(page)).map((c) => c.title), ['Reading', 'Facts', 'Workbook', 'Cell F5', 'Sheets']);
    const wb = await factsOf(page, 'frontmatter');
    assert.equal(wb.hidden, 'Lookup, _calc');
    assert.equal(wb.macros, 'none');
    assert.equal(wb.links, 'none to other files');
    assert.equal(wb.formulas, '37, shown as saved; never recalculated');
    assert.equal(await head(page), null);
  });
});

test('Formulas shows each formula as written for this tab; hidden sheets sit in the bar in italic, marked; 2,000 rows are drawn, then the step', async () => {
  await withApp({ files: FILES, open: ['/r/sheets/tide-log-2026.xlsx'] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-sheet tbody tr');
    await page.click('.marxy-tbl-segb:has-text("Formulas")');
    await page.waitForFunction(() => document.querySelector('td[data-marxy-cell="B5"]')?.textContent === '=COUNTIF(Readings!B:B,A5)');
    assert.equal(await page.textContent('td[data-marxy-cell="B12"]'), '=B11*2');
    assert.equal(await page.textContent('td[data-marxy-cell="A5"]'), 'North Mole', 'a cell with no formula keeps its value');
    await page.click('td[data-marxy-cell="B12"]');
    await showPanel(page, 'metadata');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-card="now-cell b12"]'));
    const b12 = await factsOf(page, 'now-cell b12');
    assert.equal(b12.shows, 'nothing: no value was saved');
    assert.equal(b12['worked out'], 'never: the app that saved it did not calculate it');
    // Hidden sheets, in the bar.
    assert.deepEqual(await page.$$eval('.marxy-pbar-tab', (els) => els.map((e) => [e.querySelector('.marxy-pbar-name').textContent, e.querySelector('.marxy-pbar-mark')?.textContent ?? '', getComputedStyle(e.querySelector('.marxy-pbar-name')).fontStyle])), [
      ['Summary', '', 'normal'],
      ['Readings', '', 'normal'],
      ['Stations', '', 'normal'],
      ['Lookup', 'hidden', 'italic'],
      ['_calc', 'very hidden', 'italic'],
    ]);
    await pickPart(page, 'Lookup');
    await page.waitForFunction(() => document.querySelector('.marxy-tbl-bar .marxy-tbl-sub')?.textContent === 'Lookup · hidden in the workbook · 4 rows, 2 columns');
    // The 2,000-row draw.
    await pickPart(page, 'Readings');
    await page.waitForSelector('.marxy-tbl-drawcap');
    assert.equal(await page.$eval('.marxy-tbl-sheet', (t) => Number(t.getAttribute('aria-rowcount')) - 1), 2000);
    assert.match(await page.textContent('.marxy-tbl-drawcap'), /^The first 2,000 of 2,601 rows are drawn, as the table page draws\./);
    await page.click('.marxy-tbl-drawcap button:has-text("Rows 2,001 to 2,601")');
    await page.waitForFunction(() => document.querySelector('.marxy-tbl-sheet tbody tr th')?.textContent === '2001');
    assert.equal(await page.$eval('.marxy-tbl-sheet', (t) => Number(t.getAttribute('aria-rowcount')) - 1), 601);
    assert.match(await page.textContent('.marxy-tbl-drawcap'), /^Rows 2,001 to 2,601 of 2,601 are drawn\./);
  });
});

test('an ods and an xls read the same way: an ods’s merges from its spans and its hidden sheet; an xls’s BIFF cells and its compound file', async () => {
  await withApp({ files: FILES, open: ['/r/sheets/tide-log-2026.ods'] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-sheet tbody tr');
    assert.match(await page.textContent('.marxy-tbl-line'), /^OpenDocument spreadsheet · 3 sheets, 1 of them hidden/);
    assert.equal(await page.$eval('td[data-marxy-cell="A1"]', (td) => td.colSpan > 1), true);
    assert.ok((await page.$$eval('.marxy-pbar-mark', (els) => els.map((e) => e.textContent))).includes('hidden'));
    // Its data styles are its formats: a percentage, two places, a date as the style writes it.
    assert.match(await page.textContent('td[data-marxy-cell="F5"]'), /^4\.0%/);
    assert.match(await page.textContent('td[data-marxy-cell="C5"]'), /^3\.18/);
    assert.match(await page.textContent('td[data-marxy-cell="B13"]'), /^2026-10-02 18:38/);
  });
  await withApp({ files: FILES, open: ['/r/sheets/harbour-dues-1999.xls'] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-sheet tbody tr');
    assert.match(await page.textContent('.marxy-tbl-line'), /^Excel 97 to 2003 workbook · 2 sheets, 1 of them hidden/);
    await page.click('td[data-marxy-cell="D12"]');
    await showPanel(page, 'metadata');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-card="now-cell d12"]'));
    const d12 = await factsOf(page, 'now-cell d12');
    assert.equal(d12.formula, '=SUM(D4:D11)');
    // Its XF names a builtin format, read from the BIFF records.
    assert.equal(d12.shows, '797.30');
    assert.equal(d12.format, '#,##0.00');
    assert.match((await factsOf(page, 'frontmatter')).formats, /^the file’s own/);
    assert.match((await factsOf(page, 'frontmatter')).format, /^Excel 97 to 2003 workbook · a compound file, 512-byte sectors, streams Workbook/);
    assert.equal(await head(page), null, 'an xls is read for real: no tier in the head');
  });
});
