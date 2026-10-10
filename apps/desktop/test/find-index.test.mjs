// The text index for Rendered find (D-03).
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildTextIndex, findAll } from '../src/find/text-index.ts';

test("buildTextIndex(['foo ', 'bar baz']) locates 'bar' at piece 1 offset 0 (D-03)", () => {
  const index = buildTextIndex(['foo ', 'bar baz']);
  assert.equal(index.text, 'foo bar baz');
  const [m] = findAll(index, /bar/g);
  assert.deepEqual(index.locate(m.start), { piece: 1, offset: 0 });
  assert.deepEqual(index.locate(m.end), { piece: 1, offset: 3 });
});

test("a match 'o b' spanning a piece boundary reports both ends in the right pieces (D-03)", () => {
  const index = buildTextIndex(['foo ', 'bar baz']);
  const [m] = findAll(index, /o b/g);
  assert.deepEqual(index.locate(m.start), { piece: 0, offset: 2 });
  assert.deepEqual(index.locate(m.end), { piece: 1, offset: 1 });
});

test('a boundary inside a word is not a space (D-03)', () => {
  const index = buildTextIndex(['hel', 'lo']);
  assert.equal(findAll(index, /hello/g).length, 1);
});

test('the end of the text locates at the end of the last piece; empty pieces are skipped (D-03)', () => {
  const index = buildTextIndex(['', 'ab', '', 'cd', '']);
  assert.deepEqual(index.locate(4), { piece: 3, offset: 2 });
  assert.deepEqual(index.locate(2), { piece: 3, offset: 0 });
  assert.deepEqual(index.locate(0), { piece: 1, offset: 0 });
  assert.deepEqual(buildTextIndex([]).locate(3), { piece: 0, offset: 0 });
});

test('findAll is non-overlapping, skips empty matches and ignores lastIndex and a missing g flag (D-03)', () => {
  const index = buildTextIndex(['aaaa']);
  assert.deepEqual(findAll(index, /aa/g), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  assert.deepEqual(findAll(index, /x*/g), []);
  assert.deepEqual(findAll(buildTextIndex(['abx']), /x*/g), [{ start: 2, end: 3 }]);
  const re = /a/;
  re.lastIndex = 3;
  assert.equal(findAll(index, re).length, 4);
  const g = /a/g;
  g.lastIndex = 3;
  assert.equal(findAll(index, g).length, 4);
});

test('offsets are UTF-16 code units, as the DOM counts them (D-03)', () => {
  const index = buildTextIndex(['\u{1F600}', 'x']);
  const [m] = findAll(index, /x/gu);
  assert.equal(m.start, 2);
  assert.deepEqual(index.locate(m.start), { piece: 1, offset: 0 });
});

test("two panes' pieces are independent: no module state (D-03)", () => {
  const a = buildTextIndex(['one two']);
  const b = buildTextIndex(['x', 'y', 'z']);
  assert.equal(a.text, 'one two');
  assert.deepEqual(b.locate(2), { piece: 2, offset: 0 });
  assert.deepEqual(a.locate(4), { piece: 0, offset: 4 });
});

test('findAll over 200 KB with a one-character query finds every match; the time is recorded (D-03)', (t) => {
  const index = buildTextIndex(Array.from({ length: 2000 }, () => 'abcdefghij'.repeat(10)));
  assert.equal(index.text.length, 200_000);
  const t0 = performance.now();
  const spans = findAll(index, /a/g);
  const ms = performance.now() - t0;
  t.diagnostic(`findAll, 200 KB, one-character query: ${ms.toFixed(2)} ms`);
  assert.equal(spans.length, 20_000);
});
