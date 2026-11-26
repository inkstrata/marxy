import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  indexLines,
  LINES_FROM,
  LINES_READ_ONLY_FROM,
  LineHeights,
  lineHtml,
  lineOfByte,
  lineRanks,
  lineText,
  lineWindow,
  linesLogShape,
  linesTier,
  logLinesOf,
  rowAtScroll,
  scrollForLine,
  wrapRows,
} from './lines.ts';
import { readingOf, setsPlainReading } from './index.ts';
import { logRanks } from '../highlight/line-classes.ts';
import { summariseLog } from '../log/summary.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
/** `size` bytes of `line` repeated, each line ended by a newline. */
function big(size: number, line = 'a line of text'): Uint8Array {
  const one = enc(`${line}\n`);
  const out = new Uint8Array(Math.ceil(size / one.length) * one.length);
  for (let at = 0; at < out.length; at += one.length) out.set(one, at);
  return out;
}

test('the tier starts at 5 MB, for a log, plain text, code or Markdown, and never for data, a patch or HTML', () => {
  const under = big(LINES_FROM - 100);
  const over = big(LINES_FROM);
  assert.equal(linesTier('/a.log', under, 'log'), null);
  assert.equal(linesTier('/a.log', over, 'log'), 'log');
  assert.equal(linesTier('/a.txt', over, null), 'text');
  assert.equal(linesTier('/a.txt', over, 'log'), 'log', 'a .txt found to be a log is a log');
  assert.equal(linesTier('/a.ts', over, 'code'), 'text');
  assert.equal(linesTier('/README', over, null), 'text');
  assert.equal(linesTier('/a.md', under, null), null);
  assert.equal(linesTier('/a.md', over, null), 'markdown');
  assert.equal(linesTier('/a.md', over, 'article'), 'markdown', 'whatever kind its text suggests');
  for (const path of ['/a.json', '/a.csv', '/a.jsonl', '/a.patch', '/a.html', '/a.session', '/a.png']) assert.equal(linesTier(path, over, null), null, path);
  assert.equal(linesTier('/a.txt', over, 'diff'), null, 'a .txt read as a patch keeps the patch page');
});

test('text that is not UTF-8 keeps its own page', () => {
  const bytes = big(LINES_FROM, 'café');
  const latin1 = Uint8Array.from(bytes, (b) => b);
  // Every é as one byte (0xE9), as Latin-1 writes it.
  const one = Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
  const legacy = new Uint8Array(Math.ceil(LINES_FROM / one.length) * one.length);
  for (let at = 0; at < legacy.length; at += one.length) legacy.set(one, at);
  assert.equal(linesTier('/a.txt', latin1, null), 'text');
  assert.equal(linesTier('/a.txt', legacy, null), null);
});

test('lines are split where the parse splits them, each with its bytes, a last empty line not counted', () => {
  const bytes = enc('one\r\ntwo\rthree\n\nfive\n');
  const lines = indexLines(bytes, false);
  assert.equal(lines.count, 5);
  assert.deepEqual([...Array(lines.count)].map((_, i) => lineText(lines, i)), ['one', 'two', 'three', '', 'five']);
  assert.deepEqual([...lines.starts], [0, 5, 9, 15, 16]);
  assert.deepEqual([...lines.ends], [3, 8, 14, 15, 20]);
  assert.equal(lineOfByte(lines, 0), 0);
  assert.equal(lineOfByte(lines, 4), 0, 'a line ending belongs to its line');
  assert.equal(lineOfByte(lines, 10), 2);
  assert.equal(lineOfByte(lines, 99), 4);
});

test('a BOM is not in the first line, an LF-only file is split the same way, and an empty file is one empty line', () => {
  const bom = indexLines(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61, 0x0a, 0x62]), false);
  assert.deepEqual([...bom.starts], [3, 5]);
  assert.equal(lineText(bom, 0), 'a');
  assert.equal(lineText(bom, 1), 'b');
  assert.equal(indexLines(enc(''), false).count, 1);
  const unix = indexLines(enc('a\nbb\n\nccc'), false);
  assert.deepEqual([...unix.starts], [0, 2, 5, 6]);
  assert.deepEqual([...unix.ends], [1, 4, 5, 9]);
});

test('read-only from 32 MB', () => {
  assert.equal(indexLines(new Uint8Array(LINES_READ_ONLY_FROM - 1), false).readOnly, false);
  assert.equal(indexLines(new Uint8Array(LINES_READ_ONLY_FROM), false).readOnly, true);
});

test('a log line marks its time and its level, with its rank, and escapes its text', () => {
  const lines = indexLines(enc('2026-11-19T08:10:02.220Z WARN  db: a < b & c\n    at frame (x.rs:1)\n'), true);
  const row = lineHtml(lines, 0);
  assert.match(row, /^<div class="marxy-lines-row" data-marxy-s="0" data-marxy-e="\d+" data-marxy-rank="2">/);
  assert.match(row, /<span class="marxy-lines-no" aria-hidden="true">1<\/span>/);
  assert.match(row, /<span class="marxy-lines-time">2026-11-19T08:10:02.220Z<\/span> <span class="marxy-lines-level">WARN<\/span>  db: a &lt; b &amp; c/);
  assert.doesNotMatch(lineHtml(lines, 1), /data-marxy-rank|marxy-lines-time/);
  const text = indexLines(enc('2026-11-19T08:10:02.220Z WARN x\n'), false);
  assert.doesNotMatch(lineHtml(text, 0), /marxy-lines-time/, 'text is not marked as a log');
});

test('ranks agree with the level filter`s, a slice at a time', async () => {
  const src = ['2026-01-01 10:00:00 INFO a', '2026-01-01 10:00:01 ERROR b', '  at frame', '', '2026-01-01 10:00:02 WARN c', 'plain words'];
  const lines = indexLines(enc(src.join('\n')), true);
  let slices = 0;
  const ranks = await lineRanks(lines, { yieldNow: async () => void slices++, budgetMs: 0 });
  assert.deepEqual([...ranks!], [...logRanks(src)]);
  assert.equal(lines.ranks, ranks, 'kept for the next ask');
  assert.equal(await lineRanks(indexLines(enc('x'), true), { yieldNow: async () => {}, aborted: () => true }), null);
});

test('a line wraps into as many rows as its length needs', () => {
  assert.equal(wrapRows(0, 80), 1);
  assert.equal(wrapRows(80, 80), 1);
  assert.equal(wrapRows(81, 80), 2);
  assert.equal(wrapRows(400, 80), 5);
  assert.equal(wrapRows(400, 0), 1);
});

test('heights: rows before a line, the line at a row, and a corrected line', () => {
  const rows = [1, 3, 1, 2, 1, 1, 4];
  const h = new LineHeights(rows.length, (i) => rows[i]!);
  assert.equal(h.total(), 13);
  assert.deepEqual([...Array(rows.length + 1)].map((_, i) => h.before(i)), [0, 1, 4, 5, 7, 8, 9, 13]);
  const lineAtEachRow = [...Array(13)].map((_, r) => h.lineAt(r));
  assert.deepEqual(lineAtEachRow, [0, 1, 1, 1, 2, 3, 3, 4, 5, 6, 6, 6, 6]);
  assert.equal(h.lineAt(99), 6);
  h.set(1, 1);
  assert.equal(h.total(), 11);
  assert.equal(h.rowsOf(1), 1);
  assert.equal(h.lineAt(2), 2);
  assert.equal(new LineHeights(0, () => 1).total(), 0);
});

test('the window covers the screen and a margin, its gaps make up the page, and the end is the last line', () => {
  const n = 10_000;
  const h = new LineHeights(n, (i) => (i % 10 === 0 ? 3 : 1));
  const rowPx = 20;
  const vh = 800;
  const top = lineWindow(h, 0, vh, rowPx, 5);
  assert.equal(top.first, 0);
  assert.equal(top.topPx, 0);
  assert.equal(top.height, h.total() * rowPx);
  assert.equal(top.topPx + (h.before(top.last) - h.before(top.first)) * rowPx + top.bottomPx, top.height);
  const mid = lineWindow(h, 50_000, vh, rowPx, 5);
  const atTop = h.lineAt(50_000 / rowPx);
  assert.equal(mid.first, atTop - 5);
  assert.ok(h.before(mid.last) * rowPx >= 50_000 + vh, 'the screen is covered');
  assert.equal(mid.topPx, h.before(mid.first) * rowPx);
  const end = lineWindow(h, top.height, vh, rowPx, 5);
  assert.equal(end.last, n);
  assert.equal(end.bottomPx, 0);
});

test('past the paint limit the scroll is a scale whose end is the last screen', () => {
  const n = 2_000_000;
  const h = new LineHeights(n, () => 1);
  const rowPx = 24;
  const vh = 900;
  const max = 1_000_000;
  const end = lineWindow(h, max, vh, rowPx, 5, max);
  assert.equal(end.height, max);
  assert.equal(end.last, n);
  assert.ok(Math.abs(end.topPx + (end.last - end.first) * rowPx - max) < 1e-6, 'the last line ends at the page`s end');
  const start = lineWindow(h, 0, vh, rowPx, 5, max);
  assert.equal(start.first, 0);
  assert.equal(start.topPx, 0);
  // A line put on the screen's top by its scroll is at the top of the window drawn for that scroll.
  const y = scrollForLine(h, 1_234_567, vh, rowPx, 0, max);
  assert.equal(Math.round(rowAtScroll(h, y, vh, rowPx, max)), 1_234_567);
  const at = lineWindow(h, y, vh, rowPx, 5, max);
  assert.equal(at.first, 1_234_567 - 5);
  assert.ok(Math.abs(at.topPx + 5 * rowPx - y) < 1, 'the line is drawn where the scroll is');
});

test('Read sets a 5 MB log as Lines, with its account, and leaves the parse until asked', () => {
  const bytes = big(LINES_FROM, '2026-11-19T08:10:00.000Z INFO api: listening');
  const reading = readingOf('/big.log', bytes, 'log');
  assert.equal(reading?.id, 'lines');
  assert.equal(reading?.lines?.log, true);
  assert.equal(reading?.lines?.count, bytes.length / enc('2026-11-19T08:10:00.000Z INFO api: listening\n').length);
  assert.match(reading!.html, /data-marxy-reading="lines"/);
  assert.match(reading!.html, />Lines</);
  assert.match(reading!.html, /Past 5 MB a text file is drawn as lines/);
  assert.match(reading!.html, /Find, the level filter and the outline read the whole file/);
  assert.equal(setsPlainReading('/big.log', bytes, 'log'), true);
  assert.equal(readingOf('/small.log', enc('2026-11-19T08:10:00.000Z INFO x\n'), 'log'), null, 'below the tier a log keeps its page');
});

test('a log that grew is indexed from its last line on, and comes out as a whole index would', async () => {
  const before = enc('2026-01-01 10:00:00 INFO a\r\n2026-01-01 10:00:01 ERROR b\n  at frame\n2026-01-01 10:00:02 WARN partial');
  const after = new Uint8Array([...before, ...enc(' line\n2026-01-01 10:00:03 INFO d\nplain\n')]);
  const prev = indexLines(before, true);
  await lineRanks(prev, { yieldNow: async () => {} });
  const grown = indexLines(after, true, prev);
  const whole = indexLines(after, true);
  assert.deepEqual([...grown.starts], [...whole.starts]);
  assert.deepEqual([...grown.ends], [...whole.ends]);
  assert.equal(grown.seedRanks?.count, prev.count - 1, 'the ranks of every whole line are kept');
  assert.deepEqual([...(await lineRanks(grown, { yieldNow: async () => {} }))!], [...(await lineRanks(whole, { yieldNow: async () => {} }))!]);
  // Bytes that changed before the end are indexed whole.
  const changed = Uint8Array.from(after);
  changed[3] = 0x37;
  assert.equal(indexLines(changed, true, prev).seedRanks, null);
});

test('a U+FEFF that opens a line after the first is kept as text', () => {
  const lines = indexLines(Uint8Array.from([0x61, 0x0a, 0xef, 0xbb, 0xbf, 0x62]), false);
  assert.equal(lineText(lines, 1), '\ufeffb');
});

test('the panels` summary of a log read as lines agrees with the text`s, its places bytes', async () => {
  const src = '2026-01-01T10:00:00Z INFO a\r\n2026-01-01T10:00:01Z ERROR b \u001b[31mred\u001b[0m\r\n  at frame\r\n\r\n2026-01-01T10:00:02Z WARN c\r\n';
  const lines = indexLines(enc(src), true);
  const shape = await linesLogShape(lines, { yieldNow: async () => {}, budgetMs: 0 });
  const text = summariseLog(src.replace(/\r\n/g, '\n'));
  assert.deepEqual(shape!.summary.counts, text.counts);
  assert.equal(shape!.summary.escapes, 2);
  assert.deepEqual(shape!.summary.notable.map((e) => [e.level, e.text, e.at]), [['ERROR', 'b \u001b[31mred\u001b[0m', lines.starts[1]], ['WARN', 'c', lines.starts[4]]]);
  assert.deepEqual(shape!.timed.map((t) => t.at), [lines.starts[0], lines.starts[1], lines.starts[4]]);
  assert.equal(lines.shape, shape, 'kept for the next ask');
});

test('near the top of a scaled page the row at the screen`s top is drawn there', () => {
  const n = 2_000_000;
  const h = new LineHeights(n, () => 1);
  const rowPx = 24;
  const vh = 900;
  const max = 1_000_000;
  for (const y of [1, 40, 300, 2_000]) {
    const r0 = rowAtScroll(h, y, vh, rowPx, max);
    const w = lineWindow(h, y, vh, rowPx, 40, max);
    const at = w.topPx + (Math.floor(r0) - w.first) * rowPx;
    assert.ok(w.first <= Math.floor(r0), `${y}: the top row is drawn`);
    assert.ok(Math.abs(at - (y - (r0 - Math.floor(r0)) * rowPx)) < 1, `${y}: row ${Math.floor(r0)} at ${at}`);
  }
});

test('the same bytes are not indexed again, and a big log shown another way has lines for the panels', () => {
  const bytes = big(LINES_FROM, '2026-11-19T08:10:00.000Z INFO x');
  const lines = indexLines(bytes, true);
  assert.equal(indexLines(bytes, true, lines), lines);
  assert.notEqual(indexLines(bytes, false, lines), lines, 'read another way is indexed as that');
  assert.equal(readingOf('/same.log', bytes, 'log')?.lines, readingOf('/same.log', bytes, 'log')?.lines);
  const panel = logLinesOf(bytes);
  assert.equal(panel?.log, true);
  assert.equal(logLinesOf(bytes), panel, 'once per bytes');
  assert.equal(logLinesOf(enc('2026-11-19T08:10:00.000Z INFO x\n')), null, 'below the tier the text is read whole');
});
