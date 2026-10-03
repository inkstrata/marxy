import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { generateLarge, median, parseSize, stageDeltas } from './perf-harness.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('generateLarge is deterministic and at least the size asked for', () => {
  for (const size of ['256k', '1m']) {
    const target = parseSize(size);
    const a = generateLarge(target);
    const b = generateLarge(target);
    assert.equal(sha(a), sha(b), `${size}: two calls, two different documents`);
    assert.ok(a.length >= target, `${size}: ${a.length} bytes, under ${target}`);
  }
  // The sizes of the audit's generated documents (05-performance-audit.md §9.1).
  assert.equal(generateLarge(parseSize('256k')).length, 264_940);
  assert.equal(generateLarge(parseSize('1m')).length, 1_059_760);
});

test('generateLarge repeats the long technical document with one blank line between copies', () => {
  const source = readFileSync(new URL('../fixtures/corpus/01-long-technical.md', import.meta.url), 'utf8');
  const text = new TextDecoder().decode(generateLarge(1));
  assert.equal(text, `${source}\n\n`);
  const two = new TextDecoder().decode(generateLarge(generateLarge(1).length + 1));
  assert.equal(two, text + text);
});

test('parseSize knows the three names and a plain byte count, and nothing else', () => {
  assert.equal(parseSize('256k'), 262_144);
  assert.equal(parseSize('1m'), 1_048_576);
  assert.equal(parseSize('5m'), 5_242_880);
  assert.equal(parseSize('1000'), 1000);
  assert.throws(() => parseSize('2g'), /unknown size/);
});

test('stageDeltas maps the app marks to the columns of the audit table', () => {
  const marks = { script_start: -10, file_read: 5, parsed: 25, rendered: 32, fonts_ready: 55, render: 57, painted: 63, first_text: 63, typeset_viewport: 90 };
  assert.deepEqual(stageDeltas(marks, { typeset_viewport: 'ms=13.4 hyphenation_load_ms=2.0 set=12' }), {
    parse: 20, render: 7, layout_fonts: 23, grid: 2, paint_wait: 6, first_text: 63, typeset_viewport: 13.4,
  });
});

test('stageDeltas leaves out a stage whose marks are missing', () => {
  assert.deepEqual(stageDeltas({ file_read: 0, parsed: 10 }), { parse: 10 });
  assert.deepEqual(stageDeltas({ file_read: 0, parsed: 10 }, { typeset_viewport: 'hyphenation_load_ms=2.0' }), { parse: 10 });
});

test('median takes the middle of an odd count and the mean of the middle two of an even one', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([7]), 7);
  assert.ok(Number.isNaN(median([])));
});
