// The document panels' arithmetic: the file as stored, its bytes, the outline's rows and siblings, the strip of time, links.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  byteSplice,
  eolWords,
  foldedLevel,
  hexRows,
  lineStartsOf,
  linesNaming,
  placeLinks,
  posixJoin,
  readable,
  sectionRows,
  siblingsOf,
  slugOf,
  splitTarget,
  storedFacts,
  logShapeOf,
  timeStrip,
  tokenAround,
  utf8Trial,
} from './doc-model.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test('the file as stored: line ends, the final newline, the indent', () => {
  const lf = storedFacts(enc('a\n  b\n'));
  assert.deepEqual([lf.eol, lf.lines, lf.finalNewline, lf.indent], ['lf', 2, true, 'spaces']);
  assert.equal(eolWords(lf), 'LF, and a final newline');
  const mixed = storedFacts(enc('a\r\n\tb\nc'));
  assert.deepEqual([mixed.eol, mixed.lines, mixed.finalNewline, mixed.indent], ['mixed', 3, false, 'tabs']);
  assert.equal(eolWords(mixed), 'Mixed: 1 LF, 1 CRLF');
  assert.equal(eolWords(storedFacts(enc('one line'))), 'None: it is one line');
  assert.equal(eolWords(storedFacts(enc(''))), 'None: it is empty');
  assert.equal(storedFacts(enc('\tx\n  y\n')).indent, 'mixed');
});

test('bytes tried: where UTF-8 gives up, how much reads as text, the head as hex with its signature marked', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x9c, 0x3f]);
  assert.deepEqual(utf8Trial(png), { bad: 0, zero: 8 });
  assert.deepEqual(utf8Trial(enc('héllo')), { bad: -1, zero: -1 });
  assert.equal(readable(enc('abcd\u0001')).runs, 1);
  const rows = hexRows(png, 2, [0, 4]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.map((b) => b.sep + b.hex).join(''), '89 50 4e 47 0d 0a 1a 0a  00 00 00 0d 49 48 44 52');
  assert.deepEqual(rows[0]!.filter((b) => b.marked).map((b) => b.hex), ['89', '50', '4e', '47']);
});

test('the outline: keys from the words, bars against the second level, siblings under one heading', () => {
  const rows = sectionRows([
    { text: 'Plan', level: 1, start: 0, end: 100, words: 400 },
    { text: 'Scope', level: 2, start: 10, end: 40, words: 100 },
    { text: 'Risks & costs', level: 2, start: 40, end: 80, words: 200 },
    { text: 'Detail', level: 3, start: 50, end: 80, words: 50 },
    { text: 'Scope', level: 2, start: 80, end: 100, words: 50 },
  ]);
  assert.deepEqual(rows.map((r) => r.key), ['plan', 'scope', 'risks-costs', 'detail', 'scope-2']);
  assert.deepEqual(rows.map((r) => r.depth), [0, 1, 1, 2, 1]);
  assert.equal(rows[2]!.bar, 1);
  assert.equal(rows[1]!.bar, 0.5);
  assert.deepEqual(rows.map((r) => r.kids), [true, false, true, false, false]);
  assert.deepEqual(siblingsOf(rows, rows[1]!).map((r) => r.key), ['scope', 'risks-costs', 'scope-2']);
  assert.equal(slugOf('1. What arrived'), '1-what-arrived');
  assert.equal(foldedLevel(rows, []), 'all');
  assert.equal(foldedLevel(rows, [10, 40, 80]), '2');
  assert.equal(foldedLevel(rows, [10]), null);
});

test('a log’s strip of time: even steps, errors counted, each bucket’s first entry', () => {
  const at = (s: number, error = false) => ({ ms: s * 1000, error });
  const strip = timeStrip([at(0), at(30, true), at(61), at(300)]);
  assert.ok(strip);
  assert.equal(strip.step, 5_000);
  assert.equal(strip.buckets.length, 61);
  assert.equal(strip.buckets[6]!.errors, 1);
  assert.equal(strip.buckets[0]!.first?.ms, 0);
  assert.equal(timeStrip([at(1)]), null);
});

test('links are placed: to a file here, nowhere, within the file, outside; written paths only where they lead', () => {
  const files = new Set(['/w/plans/plan.md', '/w/logs/a.log', '/w/src/x.ts']);
  const placed = placeLinks({
    docPath: '/w/plans/plan.md',
    links: [
      { url: '../logs/a.log#L68', line: 3 },
      { url: '../plans/missing.md', line: 4 },
      { url: '#rollback', line: 5 },
      { url: 'https://example.com', line: 6 },
    ],
    written: [
      { w: 'src/x.ts:12', line: 7 },
      { w: 'nowhere.ts', line: 8 },
    ],
    has: (p) => files.has(p),
    roots: ['/w'],
  });
  assert.deepEqual(placed.map((p) => [p.place, p.line, p.path ?? null, p.at ?? null]), [
    ['file', 3, '/w/logs/a.log', 68],
    ['dead', 4, null, null],
    ['self', 5, null, null],
    ['web', 6, null, null],
    ['file', 7, '/w/src/x.ts', 12],
  ]);
  assert.deepEqual(splitTarget('a%20b.md:9'), { path: 'a b.md', line: 9 });
  assert.equal(posixJoin('C:/Dev/w', '../x.md'), 'C:/Dev/x.md');
  assert.equal(posixJoin('C:/Dev', '../../x.md'), 'C:/x.md');
  assert.equal(posixJoin('/w/a', '../../../x.md'), '/x.md');
  assert.deepEqual(linesNaming('see a.md\nand xa.md, a.md.\n', ['a.md']), [
    { w: 'a.md', line: 1 },
    { w: 'a.md', line: 2 },
  ]);
  assert.equal(tokenAround('read ../plans/pg16-plan.md, then', 14, 21), '../plans/pg16-plan.md');
});

test('posixJoin keeps a network share and a //?/ path as the top', () => {
  assert.equal(posixJoin('//host/share/docs', '../x.md'), '//host/share/x.md');
  assert.equal(posixJoin('//host/share', '../../x.md'), '//host/share/x.md');
  assert.equal(posixJoin('//?/C:/Dev/w', '../x.md'), '//?/C:/Dev/x.md');
  assert.equal(posixJoin('//?/UNC/host/share/a', '../../b/x.md'), '//?/UNC/host/share/b/x.md');
});

test('byteSplice cuts on character boundaries, so a heading that starts 第 or É moves whole', () => {
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8', { fatal: true });
  for (const [x, y] of [
    ['# 第一\n\n# 第二\n', '# 第二\n\n# 第一\n'],
    ['# Été\n# Ça\n', '# Ça\n# Été\n'],
    ['a😀b', 'a😁b'],
  ] as const) {
    const before = enc.encode(x);
    const after = enc.encode(y);
    const s = byteSplice(before, after)!;
    dec.decode(before.subarray(0, s.start));
    dec.decode(s.replacement);
    dec.decode(before.subarray(s.end));
    const out = new Uint8Array([...before.subarray(0, s.start), ...s.replacement, ...before.subarray(s.end)]);
    assert.equal(dec.decode(out), y);
  }
  assert.equal(byteSplice(enc.encode('same'), enc.encode('same')), null);
});

test('a drive path is a file, not a web link; file:/// URLs keep their drive or share', () => {
  const files = new Set(['C:/Dev/a.md', 'C:/Dev/w/doc.md', '//host/share/b.md', '/w/c.md']);
  const placed = placeLinks({
    docPath: 'C:/Dev/w/doc.md',
    links: [
      { url: 'C:/Dev/a.md', line: 1 },
      { url: 'C:\\Dev\\a.md', line: 2 },
      { url: 'file:///C:/Dev/a.md', line: 3 },
      { url: 'file://host/share/b.md', line: 4 },
      { url: 'C:/Dev/a.md:12', line: 5 },
      { url: 'mailto:x@example.com', line: 6 },
    ],
    written: [],
    has: (p) => files.has(p),
    roots: ['C:/Dev/w'],
  });
  assert.deepEqual(placed.map((p) => [p.place, p.line, p.path ?? null, p.at ?? null]), [
    ['file', 1, 'C:/Dev/a.md', null],
    ['file', 2, 'C:/Dev/a.md', null],
    ['file', 3, 'C:/Dev/a.md', null],
    ['file', 4, '//host/share/b.md', null],
    ['file', 5, 'C:/Dev/a.md', 12],
    ['web', 6, null, null],
  ]);
  const posix = placeLinks({ docPath: '/w/doc.md', links: [{ url: 'file:///w/c.md', line: 1 }], written: [], has: (p) => files.has(p), roots: ['/w'] });
  assert.equal(posix[0]?.path, '/w/c.md');
});

test('line starts: a lone CR ends a line as LF and CRLF do; a written path on a CR-only file is on its own line', () => {
  const enc = new TextEncoder();
  assert.deepEqual([...lineStartsOf(enc.encode('a\rb\r\nc\nd'))], [0, 2, 5, 7]);
  assert.deepEqual([...lineStartsOf(enc.encode('a\r'))], [0], 'no line after the last end');
  assert.deepEqual(linesNaming('one\rtwo src/x.ts\rthree', ['src/x.ts']), [{ w: 'src/x.ts', line: 2 }]);
});

test("a log's summary and times are worked out once per buffer, not on every redraw", () => {
  const buffer = { text: '2026-01-02 10:00:00 INFO up\n2026-01-02 10:00:30 ERROR down\n  at x\n' };
  const first = logShapeOf(buffer);
  assert.equal(logShapeOf(buffer), first, 'an unchanged buffer is not read again');
  assert.deepEqual(first.timed.map((t) => [t.error, t.at, t.time]), [[false, 0, '2026-01-02 10:00:00'], [true, 28, '2026-01-02 10:00:30']]);
  assert.equal(first.summary.counts.reduce((a, b) => a + b, 0), 2);
  assert.notEqual(logShapeOf({ text: buffer.text }), first, 'a new buffer is read');
});
