// The linear helpers say exactly what the regexes they replace said, on every short string over the characters those
// regexes care about; and they stay linear where the regexes were quadratic or worse.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { atxHeading, lineOfOffset, lineStartsOf, own, trailingRun, trimEndOf, withoutClosingHashes, withoutTrailingBreaks } from './text.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

/** Every string of length up to `max` over `alphabet`. */
function* strings(alphabet: string, max: number): Generator<string> {
  let level = [''];
  yield '';
  for (let n = 1; n <= max; n++) {
    const next: string[] = [];
    for (const s of level) for (const c of alphabet) next.push(s + c);
    yield* next;
    level = next;
  }
}

test('atxHeading reads a line as the ATX regexes in kind detection and the notebook did', () => {
  const spaced = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/;
  const blank = /^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/;
  for (const s of strings(' \t#a\r\u00a0', 7)) {
    const m = spaced.exec(s);
    const got = atxHeading(s, 6);
    assert.deepEqual(got && { level: got.level, text: got.text }, m && { level: /#+/.exec(s.trimStart())![0].length, text: m[1]! }, JSON.stringify(s));
    const b = blank.exec(s);
    assert.deepEqual(atxHeading(s, 3, true), b && { level: b[1]!.length, text: b[2]! }, JSON.stringify(s));
  }
});

test('the trims remove what their regexes removed', () => {
  for (const s of strings(' \t\na#\r', 6)) {
    assert.equal(trimEndOf(s, ' \t'), s.replace(/[ \t]+$/, ''), JSON.stringify(s));
    assert.equal(trimEndOf(s, '\n'), s.replace(/\n+$/, ''), JSON.stringify(s));
    assert.equal(trimEndOf(s, '\r\n'), s.replace(/[\r\n]+$/, ''), JSON.stringify(s));
    assert.equal(trailingRun(s, ' ') >= 2, / {2,}$/.test(s), JSON.stringify(s));
    assert.equal(withoutClosingHashes(s), s.replace(/[ \t]+#+[ \t]*$/, ''), JSON.stringify(s));
    const bare = s.replace(/[ \t]+$/, '');
    assert.equal(withoutClosingHashes(bare, true), bare.replace(/(?:^|[ \t]+)#+$/, ''), JSON.stringify(s));
    assert.equal(withoutTrailingBreaks(s), s.replace(/(?:\r?\n)+$/, ''), JSON.stringify(s));
  }
});

test('on a line of 100,000 spaces that does not end in one, each helper is linear', () => {
  const line = `# a${' '.repeat(100_000)}x#`;
  const t = cpuNow();
  assert.deepEqual(atxHeading(line, 6), { level: 1, text: `a${' '.repeat(100_000)}x` });
  assert.equal(atxHeading(line, 3, true)?.level, 1);
  assert.equal(trimEndOf(`${line} `, ' \t'), line);
  assert.equal(withoutClosingHashes(line), line);
  assert.ok(cpuNow() - t < 200, `${Math.round(cpuNow() - t)} ms`);
});

test('own finds only what the table holds', () => {
  const table: Record<string, number> = { a: 1 };
  assert.equal(own(table, 'a'), 1);
  for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) assert.equal(own(table, key), undefined, key);
});

test('lineOfOffset finds the line of every offset', () => {
  const text = 'a\nbc\n\nd';
  const starts = lineStartsOf(text);
  assert.deepEqual(starts, [0, 2, 5, 6]);
  assert.deepEqual([...text, ''].map((_, i) => lineOfOffset(starts, i)), [0, 0, 1, 1, 1, 2, 3, 3]);
});
