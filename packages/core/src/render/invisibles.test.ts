// Rule table for invisible-character markers (handbook ch.7, MARXY-236).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { markInvisibles, shouldFlagInvisible } from './invisibles.ts';

const prose = { inCode: false, sourceStart: 10 };
const code = { inCode: true, sourceStart: 10 };
const fileStart = { inCode: false, sourceStart: 0 };

function cps(s: string): number[] {
  return [...s].map((ch) => ch.codePointAt(0)!);
}

function flagged(s: string, ctx = prose): boolean[] {
  const arr = cps(s);
  return arr.map((cp, i) => shouldFlagInvisible(cp, ctx, arr, i));
}

test('bidi controls, ZWSP, ZWJ outside emoji, and BOM are flagged', () => {
  assert.ok(flagged('\u202e')[0]);
  assert.ok(flagged('\u2066')[0]);
  assert.ok(flagged('\u200b')[0]);
  assert.ok(flagged('a\u200db')[1]);
  assert.ok(flagged('\ufeff', { inCode: false, sourceStart: 5 })[0]);
});

test('emoji ZWJ, Persian ZWNJ, LRM, RLM and NBSP in prose are not flagged', () => {
  assert.deepEqual(flagged('\u200e'), [false]);
  assert.deepEqual(flagged('\u200f'), [false]);
  assert.deepEqual(flagged('\u00a0'), [false]);
  const persian = 'می\u200cخواهم';
  assert.deepEqual(flagged(persian), [...persian].map(() => false));
  const emoji = cps('👩\u200d💻');
  assert.equal(shouldFlagInvisible(0x200d, prose, emoji, 1), false);
});

test('BOM at document offset 0 is not flagged', () => {
  assert.deepEqual(flagged('\ufeff', fileStart), [false]);
});

test('NBSP in code is flagged', () => {
  assert.ok(flagged('\u00a0', code)[0]);
});

test('tag runs collapse to one tag mark', () => {
  const tags = '\u{e0049}\u{e0047}\u{e004e}';
  const html = markInvisibles(tags, prose);
  assert.match(html, /marxy-invisible-tag/);
  assert.match(html, /marxy-invisible-glyph[^>]*>tag ×3</);
  assert.equal((html.match(/marxy-invisible-tag/g) ?? []).length, 1);
});

test('U+202E in output is isolated and labelled 202E', () => {
  const html = markInvisibles('x\u202ey', prose);
  assert.match(html, /marxy-invisible-glyph[^>]*>202E</);
  assert.match(html, /marxy-invisible-bidi/);
});

test('👩‍💻 is not marked', () => {
  const html = markInvisibles('👩\u200d💻', prose);
  assert.ok(!html.includes('marxy-invisible'));
});
