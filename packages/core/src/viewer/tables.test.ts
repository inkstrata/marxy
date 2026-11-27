// The table page's words for a database and a workbook, from the desktop shell's own readings of the demo's
// files (apps/desktop/src/harness/tables-demo.json, written by `cargo test write_the_demo_tables -- --ignored`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applicationWords,
  blobSeems,
  bookLine,
  cellName,
  colName,
  csvOf,
  dbCell,
  dbHeadWords,
  dbLine,
  dbStateLine,
  drawCap,
  encryptedWhy,
  generalNumber,
  goToRow,
  journalWords,
  notDeclared,
  pager,
  partWords,
  realText,
  schemaGroups,
  schemaText,
  sheetGrid,
  sheetValue,
  sheetWords,
  sqlTokens,
  sqliteVersion,
  type BookSummary,
  type DbSummary,
  type SheetCell,
  type SheetPage,
} from './tables.ts';

interface Read {
  summary: { db: DbSummary | null; book: BookSummary | null };
  pages: Record<string, SheetPage>;
}
const demo = JSON.parse(readFileSync(new URL('../../../../apps/desktop/src/harness/tables-demo.json', import.meta.url), 'utf8')) as Record<string, { read: Read; alone?: Read }>;
const db = (k: string, alone = false): DbSummary => (alone ? demo[k]!.alone! : demo[k]!.read).summary.db!;
const book = (k: string): BookSummary => demo[k]!.read.summary.book!;

test('a sheet is addressed by its column letters and row numbers', () => {
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(colName), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  assert.equal(cellName(4, 5), 'F5');
});

test('a database says what it holds, read-only, and how it is read: in place, with its WAL, alone, or from a copy', () => {
  const gauges = db('data/gauges.sqlite');
  assert.equal(dbLine(gauges), 'SQLite 3 · 4 tables, 2 views, 2 indexes, 1 trigger · 300.0 KB');
  assert.equal(dbHeadWords(gauges), null);
  assert.equal(sqliteVersion(gauges.header.writtenBy), '3.49.1');
  assert.equal(applicationWords(gauges.header.applicationId), '0x54444D4B · “TDMK”');
  assert.equal(applicationWords(0), 'not set');
  const journal = db('data/journal.sqlite');
  assert.equal(dbHeadWords(journal), 'With its WAL');
  assert.equal(dbStateLine(journal)?.action, 'alone');
  assert.match(dbStateLine(journal)!.text, /^Read with its write-ahead log, journal\.sqlite-wal, beside it, as SQLite reads it/);
  assert.match(journalWords(journal), /^WAL · 7 frames in the log, 3 commits/);
  const alone = db('data/journal.sqlite', true);
  assert.equal(dbHeadWords(alone), 'The file alone · your choice');
  assert.equal(dbStateLine(alone)?.action, 'with');
  const locked = db('data/tidemark-cache.db');
  assert.equal(dbHeadWords(locked), 'A copy in memory · the file is locked');
  assert.match(dbStateLine(locked)!.text, /^Another program holds this database for itself alone/);
  const entry = { ...gauges, state: 'copy' as const, copyWhy: 'entry' as const };
  assert.equal(dbHeadWords(entry), 'A copy in memory');
  assert.match(dbStateLine(entry)!.text, /^An entry of an archive, read from its bytes held in memory/);
  assert.equal(dbStateLine(entry)?.action, null);
});

test('a part says its kind, rows and columns; the schema is grouped and its triggers said never to run', () => {
  const gauges = db('data/gauges.sqlite');
  const readings = gauges.parts.find((p) => p.name === 'readings')!;
  assert.equal(partWords(readings, 1240, 5), 'table · 1,240 rows · 5 columns');
  const tc = gauges.parts.find((p) => p.name === 'tide_constants')!;
  assert.equal(partWords(tc, 12, 4), 'table, WITHOUT ROWID · 12 rows · 4 columns');
  const view = gauges.parts.find((p) => p.name === 'daily_high')!;
  assert.equal(partWords(view, null, 3), 'view · rows not counted yet · 3 columns');
  const groups = schemaGroups(gauges);
  assert.deepEqual(groups.map((g) => g.label), ['Tables', 'Views', 'Indexes', 'Triggers']);
  assert.match(groups[3]!.note!, /these never run/);
  assert.match(schemaText(gauges), /^CREATE TABLE stations\(/);
  assert.ok(schemaText(gauges).includes('CREATE TRIGGER readings_range'));
});

test('a value draws as stored: numbers as SQLite writes them, NULL said, a BLOB as its size, a type that is not declared marked', () => {
  assert.deepEqual(dbCell(null), { text: 'NULL', kind: 'null' });
  assert.equal(dbCell({ k: 'real', v: 5.08 }).text, '5.08');
  assert.equal(realText(5), '5.0');
  assert.equal(dbCell({ k: 'int', v: '9007199254740993' }).text, '9007199254740993');
  assert.equal(dbCell({ k: 'blob', n: 17_395 }).text, 'BLOB · 17.0 KB');
  assert.equal(dbCell({ k: 'text', v: 'x', more: 12 }).more, 12);
  assert.equal(notDeclared({ k: 'text', v: 'n/a' }, 'REAL'), true);
  assert.equal(notDeclared({ k: 'real', v: 1 }, 'REAL'), false);
});

test('the pager steps 200 at a time and Go to row reads a row number', () => {
  assert.deepEqual(pager(0, 200, 1240), { label: 'Rows 1 to 200 of 1,240', earlier: null, later: 200 });
  assert.deepEqual(pager(1200, 40, 1240), { label: 'Rows 1,201 to 1,240 of 1,240', earlier: 1000, later: null });
  assert.deepEqual(pager(0, 200, null), { label: 'Rows 1 to 200', earlier: null, later: 200 }, 'not counted: Later while pages are full');
  assert.equal(goToRow('1,000', 1240), 999);
  assert.equal(goToRow('2000', 1240), null);
  assert.equal(goToRow('x', 1240), null);
});

test('a BLOB says what it seems to be from its first bytes', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 128, 0, 0, 0, 80]);
  assert.deepEqual(blobSeems(png), { what: 'a PNG image, 128 × 80', ext: 'png' });
  assert.equal(blobSeems(new TextEncoder().encode('hello there')).what, 'text');
  assert.equal(blobSeems(new Uint8Array([1, 2, 0, 3])).what, 'bytes the app has no reading for');
});

test('a .db with no SQLite header whose bytes are spread evenly is probably encrypted, and says why', () => {
  const vault = new Uint8Array(readFileSync(new URL('../../../../fixtures/demo/data/vault.db', import.meta.url)));
  const why = encryptedWhy('vault.db', vault.subarray(0, 4096))!;
  assert.match(why[0]!, /^The name says \.db, a database, but its first bytes, 96 93 C9 DC/);
  assert.match(why[1]!, /bits a byte, of 8\), as encrypted data is/);
  assert.equal(encryptedWhy('notes.txt', vault), null);
  assert.equal(encryptedWhy('zeros.db', new Uint8Array(4096)), null);
});

test('SQL is coloured: keywords, strings, numbers, as written', () => {
  const t = sqlTokens("CREATE TABLE t(q TEXT CHECK (q IN ('a','b')), n INT DEFAULT 12)");
  assert.equal(t.map((x) => x.text).join(''), "CREATE TABLE t(q TEXT CHECK (q IN ('a','b')), n INT DEFAULT 12)");
  assert.deepEqual(t.filter((x) => x.kind === 'kw').map((x) => x.text), ['CREATE', 'TABLE', 'CHECK', 'IN', 'DEFAULT']);
  assert.deepEqual(t.filter((x) => x.kind === 'str').map((x) => x.text), ["'a'", "'b'"]);
  assert.deepEqual(t.filter((x) => x.kind === 'num').map((x) => x.text), ['12']);
});

test('CSV quotes what needs quoting', () => {
  assert.equal(csvOf(['a', 'b,c'], [['1', 'say "hi"'], ['', 'x\ny']]), 'a,"b,c"\r\n1,"say ""hi"""\r\n,"x\ny"\r\n');
});

test('CSV export leaves a formatted negative alone and still guards a formula that starts like one', () => {
  const out = csvOf(null, [['-$5.00', '-12%', '-1,234.50', "-1+cmd|' /C calc'!A0", '-SUM(A1)', ' =1+1', '  -2+3']]);
  assert.equal(out, `-$5.00,-12%,"-1,234.50",'-1+cmd|' /C calc'!A0,'-SUM(A1),' =1+1,'  -2+3\r\n`);
});

test('CSV export disarms a cell a spreadsheet would run as a formula', () => {
  const out = csvOf(['=SUM(A1)'], [['+1+1', '-2+3', '@cmd', '\tx', '\rx', '-3.5', '+4', '1e-3', '-', 'a=b', '']]);
  assert.equal(out, "'=SUM(A1)\r\n'+1+1,'-2+3,'@cmd,'\tx,\"'\rx\",-3.5,+4,1e-3,'-,a=b,\r\n");
});

test('a workbook says its sheets, hidden ones, and that nothing recalculates', () => {
  const xlsx = book('sheets/tide-log-2026.xlsx');
  assert.equal(bookLine(xlsx), 'Excel workbook · 5 sheets, 2 of them hidden');
  assert.equal(sheetWords(xlsx.sheets[0]!), 'Summary · 17 rows, 7 columns · 37 formulas · 3 merged ranges');
  assert.equal(sheetWords(xlsx.sheets[3]!), 'Lookup · hidden in the workbook · 4 rows, 2 columns');
  assert.equal(sheetWords(xlsx.sheets[4]!).split(' · ')[1], 'very hidden in the workbook');
  assert.match(bookLine(book('sheets/harbour-dues-1999.xls')), /^Excel 97 to 2003 workbook · 2 sheets, 1 of them hidden/);
});

test('values show in the file’s own formats: percent, decimals, dates; errors and missing values as saved', () => {
  const xlsx = book('sheets/tide-log-2026.xlsx');
  const page = demo['sheets/tide-log-2026.xlsx']!.read.pages.Summary!;
  const at = (r: number, c: number): SheetCell | undefined => page.cells.find(([pr, pc]) => pr === r && pc === c)?.[2];
  assert.equal(sheetValue(at(4, 5), xlsx.formats).text, '3.5%');
  assert.equal(sheetValue(at(4, 2), xlsx.formats).text, '2.91');
  assert.equal(sheetValue(at(4, 1), xlsx.formats).text, '434');
  assert.equal(sheetValue(at(4, 6), xlsx.formats).text, '#DIV/0!');
  assert.deepEqual(sheetValue(at(11, 1), xlsx.formats), { text: 'no saved value', kind: 'none', applied: true });
  assert.equal(sheetValue(at(12, 1), xlsx.formats).text, '2026-10-31 23:43');
  const f = (v: number, code: string): string => sheetValue({ v: { k: 'real', v }, x: 0 }, [code]).text;
  assert.equal(f(1234567.891, '#,##0.00'), '1,234,567.89');
  assert.equal(f(-3.5, '0.0;(0.0)'), '(3.5)');
  assert.equal(f(0.5, '0%'), '50%');
  assert.equal(f(12345, '0.00E+00'), '1.23E+04');
  assert.equal(f(4.5, '"£"#,##0.00'), '£4.50');
  assert.equal(f(46326, 'd mmm yyyy'), '31 Oct 2026');
  assert.equal(f(46326.5, 'h:mm AM/PM'), '12:00 PM');
  assert.deepEqual(sheetValue({ v: { k: 'real', v: 0.75 }, x: 0 }, ['# ?/?']), { text: '0.75', kind: 'num', applied: false }, 'a fraction is not applied, and says so');
  // The codes an ods's data styles are written as (src-tauri/src/tables/formats.rs).
  assert.equal(f(46326, 'd" "mmm" "yyyy'), '31 Oct 2026');
  assert.equal(f(6.5 / 24, 'hh":"mm'), '06:30');
  assert.equal(f(-12.5, '"€"#,##0.00;"-""€"#,##0.00'), '-€12.50');
  assert.equal(f(1234.5, '"€"#,##0.00;"-""€"#,##0.00'), '€1,234.50');
  assert.equal(f(0.0345, '0.00%'), '3.45%');
  assert.equal(f(1234567, '#,##0'), '1,234,567');
  assert.equal(generalNumber(0.1 + 0.2), '0.3');
  assert.equal(generalNumber(123456789012345), '1.23457E+14');
});

test('an xls and an ods show their numbers in their own formats too', () => {
  const shown = (k: string, sheet: string, r: number, c: number): string => {
    const b = book(k);
    const cell = demo[k]!.read.pages[sheet]!.cells.find(([pr, pc]) => pr === r && pc === c)?.[2];
    return sheetValue(cell, b.formats).text;
  };
  assert.equal(book('sheets/harbour-dues-1999.xls').formatsRead, true);
  assert.equal(shown('sheets/harbour-dues-1999.xls', 'Dues', 3, 1), '8.50');
  assert.equal(shown('sheets/harbour-dues-1999.xls', 'Dues', 4, 3), '142.80');
  assert.equal(shown('sheets/harbour-dues-1999.xls', 'Dues', 11, 3), '797.30');
  assert.equal(book('sheets/tide-log-2026.ods').formatsRead, true);
  assert.equal(shown('sheets/tide-log-2026.ods', 'Summary', 4, 5), '4.0%');
  assert.equal(shown('sheets/tide-log-2026.ods', 'Summary', 4, 2), '3.18');
  assert.equal(shown('sheets/tide-log-2026.ods', 'Summary', 12, 1), '2026-10-02 18:38');
});

test('the grid draws merges as one cell and leaves out what they cover; 2,000 rows a draw, then the step', () => {
  const page: SheetPage = { from: 0, to: 3, cells: [[0, 0, { v: { k: 'text', v: 'Title' } }], [1, 0, { v: { k: 'text', v: 'Notes' } }], [1, 1, { v: { k: 'real', v: 1 } }]], merges: [[0, 0, 0, 2], [1, 0, 2, 0]] };
  const grid = sheetGrid(page, 3);
  assert.deepEqual(grid[0]!.cells.map((c) => [c.c, c.span]), [[0, { rows: 1, cols: 3 }]]);
  assert.equal(grid[0]!.cells[0]!.merged, 'A1:C1');
  assert.deepEqual(grid[1]!.cells.map((c) => c.c), [0, 1, 2]);
  assert.deepEqual(grid[1]!.cells[0]!.span, { rows: 2, cols: 1 });
  assert.deepEqual(grid[2]!.cells.map((c) => c.c), [1, 2]);
  assert.deepEqual(drawCap(0, 2601), { text: 'The first 2,000 of 2,601 rows are drawn, as the table page draws.', next: [2000, 2601], back: null });
  assert.deepEqual(drawCap(2000, 2601), { text: 'Rows 2,001 to 2,601 of 2,601 are drawn.', next: null, back: [0, 2000] });
  assert.equal(drawCap(0, 17), null);
});

test('a number format code over 255 characters shows the number in General instead of failing', () => {
  const cell = { x: 0, v: { k: 'real', v: 1.5 } } as never;
  for (const code of ['0.' + '0'.repeat(300), '0'.repeat(400) + '.0', '#,##0.' + '#'.repeat(1000) + 'E+00']) {
    const shown = sheetValue(cell, [code]);
    assert.equal(shown.text, '1.5', code.slice(0, 12));
    assert.equal(shown.kind, 'num');
  }
});

test('decimals and leading zeros in a format code stop at Excel’s limit', () => {
  const cell = { x: 0, v: { k: 'real', v: 1.5 } } as never;
  assert.doesNotThrow(() => sheetValue(cell, ['0.' + '0'.repeat(101)]));
  assert.equal(sheetValue(cell, ['0.' + '0'.repeat(40)]).text, `1.5${'0'.repeat(29)}`);
  assert.equal(sheetValue(cell, ['0'.repeat(50)]).text, `${'0'.repeat(29)}2`);
});
