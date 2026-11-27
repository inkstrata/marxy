// utf8Length says exactly what TextEncoder says, on every short string over the code units that take each of its paths.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { plural, utf8Length } from './count.ts';

/** Every string of length up to `max` over the code units in `units`. */
function* strings(units: readonly string[], max: number): Generator<string> {
  let level = [''];
  yield '';
  for (let n = 1; n <= max; n++) {
    const next: string[] = [];
    for (const s of level) for (const c of units) next.push(s + c);
    yield* next;
    level = next;
  }
}

test('utf8Length counts what TextEncoder writes, lone surrogates included', () => {
  const encoder = new TextEncoder();
  // ASCII, two bytes, three bytes, both halves of a pair, and the edges between them.
  const units = ['a', '\u007f', '\u0080', 'é', '߿', 'ࠀ', '€', '퟿', '\ud800', '\udbff', '\udc00', '\udfff', '', '￿'];
  let checked = 0;
  for (const s of strings(units, 3)) {
    assert.equal(utf8Length(s), encoder.encode(s).length, JSON.stringify(s));
    checked++;
  }
  assert.equal(checked, 1 + 14 + 14 ** 2 + 14 ** 3);
  for (const s of ['😀', 'a😀b', '\ud83d', '\ude00\ud83d', '\ud83d😀', `x${'😀'.repeat(1000)}`]) {
    assert.equal(utf8Length(s), encoder.encode(s).length, JSON.stringify(s));
  }
});

test('plural groups the count and picks the word', () => {
  assert.equal(plural(0, 'page'), '0 pages');
  assert.equal(plural(1, 'page'), '1 page');
  assert.equal(plural(1234, 'entry', 'entries'), '1,234 entries');
  assert.equal(plural(1_000_000, 'byte'), '1,000,000 bytes');
});
