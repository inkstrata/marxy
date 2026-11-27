import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScan, scanSome, tableOf } from '../data/delimited.ts';
import type { Pace } from '../data/table-view.ts';
import { cpuNow } from '../testing/cpu-clock.ts';
import {
  findInRows,
  indexSome,
  parseSome,
  READING_MAX_RECORD,
  recordRows,
  recordsHeadText,
  rowAt,
  rowCells,
  cellValue,
  rowCount,
  rowHtml,
  rowRange,
  rowsHolding,
  sortByKeys,
  sortKeys,
  tableRows,
  textKey,
} from './rows.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const pace: Pace = { yieldNow: () => Promise.resolve() };

test('a table is indexed a slice at a time to the same rows the whole scan reads, its header left out', () => {
  const text = '﻿name,note\r\na,"two\nlines"\r\n\r\nb,"say ""hi"""\n"c,x\nd,4\n\ne,5';
  const bytes = enc(text);
  const whole = tableOf((() => {
    const s = createScan(bytes, ',');
    scanSome(s);
    return s;
  })(), 'f.csv');
  const rows = tableRows(bytes, ',')!;
  while (!indexSome(rows, { rows: 1 }));
  const expected = whole.children.slice(1).map((c) => [c.src.start, c.src.end, c.type]);
  const got = Array.from({ length: rowCount(rows) }, (_, r) => {
    const range = rowRange(rows, r);
    return [range.start, range.end, rows.bad.data[r] ? 'unreadable' : 'row'];
  });
  assert.deepEqual(got, expected);
  // A quoted field's line break is inside its row: four data rows read and one that does not, not one a line.
  assert.equal(rowCount(rows), 5);
  assert.equal(rows.badRows, 1);
  assert.deepEqual(rowCells(rows, 0).values, ['a', 'two\nlines']);
  assert.deepEqual(rowCells(rows, 1).values, ['b', 'say "hi"']);
});

test('a drawn row carries its bytes and its cells', () => {
  const bytes = enc('n,v\n1,"a, b"\n2,c\n');
  const rows = tableRows(bytes, ',')!;
  indexSome(rows);
  const html = rowHtml(rows, 0);
  const s = Number(/data-marxy-s="(\d+)"/.exec(html)![1]);
  const e = Number(/data-marxy-e="(\d+)"/.exec(html)![1]);
  assert.equal(new TextDecoder().decode(bytes.subarray(s, e)), '1,"a, b"');
  assert.match(html, /data-marxy-value="a, b">a, b<\/td>/);
  assert.equal(rowAt(rows, s + 3), 0);
  assert.equal(rowAt(rows, e + 1), 1);
  assert.equal(rowAt(rows, 0), -1);
});

test('JSON Lines: rows are the lines that are not blank, parsed for their keys, a bad line named by its line in the file', () => {
  const bytes = enc('{"a":1}\n\n{"a":2,"b":"x"}\r\nnot json\n{"b":true}\n');
  const rows = recordRows(bytes);
  indexSome(rows);
  parseSome(rows);
  assert.equal(rowCount(rows), 4);
  assert.deepEqual(rows.columns.map((c) => [c.name, c.has, c.numeric]), [['a', 2, true], ['b', 2, false]]);
  assert.equal(recordsHeadText(rows), 'JSON Lines · 3 records · 2 keys · 1 line not a record');
  assert.match(rowHtml(rows, 2), /^<tr class="marxy-records-bad"[^>]*><td colspan="2">line 4: /);
  // The `\r` before a line break is in the row's bytes, as the line's text leaves it out.
  const r1 = rowRange(rows, 1);
  assert.equal(new TextDecoder().decode(bytes.subarray(r1.start, r1.end)), '{"a":2,"b":"x"}\r');
  assert.deepEqual(rowCells(rows, 1).values, ['2', 'x']);
});

test('sorting reads every row: numbers by value, words by their letters and numbers, empty and unreadable last', async () => {
  const rows = tableRows(enc('n,w\n10,item 10\n9,Item 2\n,b\n"x\n100,é\n'), ',')!;
  indexSome(rows);
  const order = Int32Array.from({ length: rowCount(rows) }, (_, i) => i);
  const byNumber = (await sortKeys(rows, 0, pace))!;
  assert.equal(byNumber.nature, 'number');
  const down = (await sortByKeys(byNumber, order, true, pace))!;
  assert.deepEqual([...down].map((r) => rowCells(rows, r).values[0] ?? 'bad'), ['100', '10', '9', '', 'bad']);
  const byWord = (await sortKeys(rows, 1, pace))!;
  assert.equal(byWord.nature, 'text');
  const up = (await sortByKeys(byWord, order, false, pace))!;
  assert.deepEqual([...up].map((r) => rowCells(rows, r).values[1] ?? 'bad'), ['b', 'é', 'Item 2', 'item 10', 'bad']);
  assert.ok(textKey('a2') < textKey('a10'));
});

test('the row filter and find look through every row, in the order given', async () => {
  const lines = ['id,city'];
  for (let i = 0; i < 5000; i++) lines.push(`${i},${i % 3 === 0 ? 'Oslo' : 'Lima'}`);
  const rows = tableRows(enc(lines.join('\n')), ',')!;
  indexSome(rows);
  const kept = (await rowsHolding(rows, null, 'oslo', pace))!;
  assert.equal(kept.length, 1667);
  assert.equal(kept[kept.length - 1], 4998);
  let heard = 0;
  const found = (await findInRows(rows, kept, /Oslo/g, { ...pace, budgetMs: 0 }, (n) => (heard = n)))!;
  assert.equal(found.count, 1667);
  assert.equal(heard, 1667);
  assert.equal(found.at[5], 5);
  assert.equal(found.cell[5], 1);
});

test('a CSV of a million rows is indexed in well under a second, a few bytes a row', () => {
  const line = '12345,2026-01-02,Lisbon,79.19,paid,"a, b",X9e3779b1,0.1,customer@example.com,desk model 1\n';
  const bytes = enc(`a,b,c,d,e,f,g,h,i,j\n${line.repeat(1_000_000)}`);
  const rows = tableRows(bytes, ',')!;
  const t0 = cpuNow();
  indexSome(rows);
  const ms = cpuNow() - t0;
  assert.equal(rowCount(rows), 1_000_000);
  assert.ok(ms < 1500, `indexing ${bytes.length} bytes took ${ms.toFixed(0)} ms`);
  assert.ok(rows.starts.data.byteLength + rows.bad.data.byteLength < 12 * 1024 * 1024);
});

const newlines = (count: number): Uint8Array => new Uint8Array(count).fill(0x0a);

test('JSON Lines of nothing but blank lines is indexed in bounded steps, a run kept as one entry', () => {
  const bytes = newlines(20_000_000);
  const rows = recordRows(bytes);
  let calls = 0;
  let pos = rows.pos;
  while (!indexSome(rows, { rows: 100_000 })) {
    assert.ok(rows.pos - pos <= 100_000, `a call passed ${rows.pos - pos} bytes`);
    pos = rows.pos;
    calls++;
  }
  assert.equal(calls, 199);
  assert.equal(rowCount(rows), 0);
  assert.equal(rows.blanks.length, 2);
  assert.equal(rows.blanks.data[1], 20_000_000);
});

test('JSON Lines blank runs keep every row\'s line number', () => {
  const bytes = enc('\n\n{"a":1}\nnope\n\n\n\nbad\n{"a":2}\n');
  const rows = recordRows(bytes);
  while (!indexSome(rows, { rows: 1 }));
  parseSome(rows);
  assert.equal(rowCount(rows), 4);
  assert.match(rowHtml(rows, 1), /line 4: /);
  assert.match(rowHtml(rows, 2), /line 8: /);
});

test('a header followed by 20 MB of blank lines is indexed in bounded steps and stores no entry per blank line', () => {
  const head = enc('a,b\n');
  const bytes = new Uint8Array(head.length + 20_000_000).fill(0x0a);
  bytes.set(head, 0);
  const rows = tableRows(bytes, ',')!;
  assert.ok(rows);
  let calls = 0;
  let pos = rows.pos;
  while (!indexSome(rows, { rows: 100_000 })) {
    assert.ok(rows.pos - pos <= 100_016, `a call passed ${rows.pos - pos} bytes`);
    pos = rows.pos;
    calls++;
  }
  assert.ok(calls >= 199);
  assert.equal(rowCount(rows), 0);
  const scan = createScan(bytes, ',', { fields: false });
  scan.pos = head.length;
  scanSome(scan, { records: 1000 });
  assert.equal(scan.pos, head.length + 1000);
  assert.equal(scan.blanks.length, 0);
  let checks = 0;
  const again = createScan(bytes, ',', { fields: false });
  again.pos = head.length;
  scanSome(again, { until: () => ++checks > 3 });
  assert.ok(again.pos <= head.length + 1024, `until was not reached: passed ${again.pos}`);
});

test('a file of blank lines before its header is not a table past the first steps', () => {
  assert.equal(tableRows(newlines(20_000_000), ','), null);
  const rows = tableRows(enc(`${'\n'.repeat(500)}a,b\n1,2\n`), ',')!;
  indexSome(rows);
  assert.equal(rowCount(rows), 1);
});

test('a 10 MB quoted field is drawn under the cap, its byte range whole and its value whole to sort and find', async () => {
  const size = 10_000_000;
  const field = 'é'.repeat(size / 2);
  const bytes = enc(`a,b\n1,"${field}"\n2,x\n`);
  const rows = tableRows(bytes, ',')!;
  indexSome(rows);
  const html = rowHtml(rows, 0);
  assert.ok(html.length < 20_000, `a drawn row is ${html.length} characters`);
  assert.match(html, /…<\/td>/);
  const s = Number(/data-marxy-s="(\d+)"/.exec(html)![1]);
  const e = Number(/data-marxy-e="(\d+)"/.exec(html)![1]);
  assert.equal(e - s, bytes.indexOf(0x0a, s) - s);
  assert.ok(e - s > size);
  assert.equal(cellValue(rows, 0, 1)!.length, size / 2);
  assert.equal(rowCells(rows, 0).texts[1]!.length, size / 2);
  assert.equal(rowCells(rows, 0).values[1], field);
  assert.equal((await rowsHolding(rows, null, 'ééé', pace))!.length, 1);
});

test('a doubled quote is never split by the cap', () => {
  const rows = tableRows(enc(`a\n"${'""'.repeat(2_000_000)}"\n`), ',')!;
  indexSome(rows);
  const cell = /<td[^>]*data-marxy-value="([^"]*)"/.exec(rowHtml(rows, 0))!;
  assert.match(cell[1]!.replaceAll('&quot;', '"'), /^"+…$/);
});

/** A JSON object line whose one string value is `size` bytes of `x`. */
function bigRecord(size: number): Uint8Array {
  const head = enc('{"k":"');
  const tail = enc('"}');
  const out = new Uint8Array(head.length + size + tail.length);
  out.set(head);
  out.fill(0x78, head.length, head.length + size);
  out.set(tail, head.length + size);
  return out;
}

const joinLines = (...lines: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(lines.reduce((n, l) => n + l.length + 1, 0));
  let at = 0;
  for (const l of lines) {
    out.set(l, at);
    out[at + l.length] = 0x0a;
    at += l.length + 1;
  }
  return out;
};

test('JSON Lines: a record past the bytes read is a cut row with its size and head, counted apart from lines that are not records', () => {
  const bytes = joinLines(enc('{"a":1}'), bigRecord(READING_MAX_RECORD + 10), enc('not json'), enc('{"a":2}'));
  const rows = recordRows(bytes);
  indexSome(rows);
  parseSome(rows);
  assert.equal(rowCount(rows), 4);
  assert.equal(rows.cutRows, 1);
  assert.equal(rows.badRows, 2);
  assert.deepEqual(rows.columns.map((c) => c.name), ['a']);
  assert.equal(recordsHeadText(rows), 'JSON Lines · 2 records · 1 key · 1 line not a record · 1 record cut');
  const html = rowHtml(rows, 1);
  assert.match(html, /^<tr class="marxy-records-bad"[^>]*><td colspan="1">line 2: record of 1\.0 MB, over 1\.0 MB, not read · <code>\{&quot;k&quot;:&quot;xxx/);
  assert.equal(rowCells(rows, 1).bad, true);
  assert.equal(cellValue(rows, 1, 0), undefined);
  const r = rowRange(rows, 1);
  assert.equal(r.end - r.start, READING_MAX_RECORD + 10 + '{"k":""}'.length);
  // A record exactly at the limit is read whole.
  const edge = recordRows(joinLines(bigRecord(READING_MAX_RECORD - '{"k":""}'.length), enc('{"a":1}')));
  indexSome(edge);
  parseSome(edge);
  assert.equal(edge.cutRows, 0);
  assert.equal(edge.badRows, 0);
});

test('JSON Lines: a 50 MB single-line record is cut in a few milliseconds and held as bytes only', () => {
  const rows = recordRows(joinLines(enc('{"a":1}'), enc('{"a":2}'), bigRecord(50 * 1024 * 1024)));
  const t = cpuNow();
  indexSome(rows);
  parseSome(rows);
  const html = rowHtml(rows, 2);
  const text = recordsHeadText(rows);
  const took = cpuNow() - t;
  assert.ok(took < 500, `${Math.round(took)} ms`);
  assert.match(text, /1 record cut$/);
  assert.match(html, /record of 50\.0 MB/);
  assert.ok(html.length < 2000);
});
