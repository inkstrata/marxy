// The Source text (F-34.1, ADR-0069): each byte that is not UTF-8 is its own code unit, U+DC80 to U+DCFF, and encodes
// back to that byte; everything else is the reading decode. And what reads the file for Rendered and the index never
// sees one of those code units.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headingsFromMarkdown } from '../index-model/entry.ts';
import { renderSafeHtml } from '../render/pipeline.ts';
import { createBuffer, foldText, splice } from './buffer.ts';
import {
  encodeSourceText,
  holdsStrayBytes,
  readableText,
  sourceTextOf,
  sourceToTextOffset,
  strayByteOf,
  textToSourceOffset,
} from './source-text.ts';

const enc = new TextEncoder();
const bytesOf = (...parts: Array<string | number[]>): Uint8Array =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...enc.encode(p)] : p)));
const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
const LONE = /[\uD800-\uDFFF]/u;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('valid UTF-8 is its reading text, unit for unit, and a U+FFFD in the file stays one', () => {
  const buffer = createBuffer('/v.md', bytesOf('é 漢 \u{1F600} \uFFFD end\n'));
  const source = sourceTextOf(buffer);
  assert.equal(source.text, buffer.text);
  assert.equal(source.offsets, buffer.offsets);
  assert.equal(source.sameUnits, true);
  assert.equal(holdsStrayBytes(source.text), false);
  assert.equal(sourceTextOf(buffer), source, 'computed once per buffer');
});

test('each byte of an invalid sequence is its own code unit, U+DC00 plus the byte', () => {
  const cases: Array<[string, number[]]> = [
    ['lone FF', [0xff]],
    ['lone continuation', [0x80]],
    ['truncated three-byte', [0xe2, 0x82]],
    ['truncated four-byte', [0xf0, 0x9f, 0x98]],
    ['overlong', [0xc0, 0xaf]],
    ['encoded surrogate', [0xed, 0xa0, 0x80]],
    ['beyond U+10FFFF', [0xf4, 0x90, 0x80, 0x80]],
  ];
  for (const [name, stray] of cases) {
    const bytes = bytesOf('a', stray, 'b\uFFFD');
    const buffer = createBuffer('/s.md', bytes);
    const { text, offsets, sameUnits } = sourceTextOf(buffer);
    assert.equal(text, `a${stray.map((b) => String.fromCharCode(0xdc00 + b)).join('')}b\uFFFD`, name);
    assert.equal(sameUnits, buffer.text.length === text.length, name);
    for (let k = 0; k < stray.length; k++) {
      assert.equal(offsets.at(1 + k), 1 + k, `${name}: unit ${1 + k} is byte ${1 + k}`);
      assert.equal(strayByteOf(text.charCodeAt(1 + k)), stray[k], name);
    }
    assert.equal(offsets.at(text.length), bytes.length, name);
    assert.equal(hex(encodeSourceText(text)), hex(bytes), `${name}: encodes back`);
  }
  assert.equal(strayByteOf(0xfffd), -1);
  assert.equal(strayByteOf(0xdc7f), -1, 'below the range: never made for a byte (ASCII is always valid)');
});

test('any bytes at all decode to a Source text that encodes back to exactly those bytes (20,000 random files)', () => {
  const next = rng(1);
  for (let n = 0; n < 20000; n++) {
    const length = Math.floor(next() * 40);
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      // Half the bytes high: most files hold invalid sequences, many hold valid ones too.
      const r = next();
      bytes[i] = r < 0.5 ? Math.floor(next() * 0x80) : 0x80 + Math.floor(next() * 0x80);
    }
    if (n % 7 === 0 && length > 3) bytes.set([0xef, 0xbb, 0xbf]);
    const buffer = createBuffer('/r.md', bytes);
    const { text, offsets } = sourceTextOf(buffer);
    assert.equal(hex(encodeSourceText(text)), hex(bytes), `file ${n}`);
    // Every code unit starts at its own bytes, in order, and the units cover the file.
    let last = 0;
    for (let u = 0; u <= text.length; u++) {
      assert.ok(offsets.at(u) >= last, `file ${n}: offsets go back at ${u}`);
      last = offsets.at(u);
    }
    assert.equal(offsets.at(text.length), bytes.length);
    // The reading text is the Source text with each stray byte's run read as U+FFFD.
    assert.equal(readableText(text).replace(/\uFFFD+/g, '\uFFFD'), buffer.text.replace(/\uFFFD+/g, '\uFFFD'), `file ${n}`);
    // Offsets between the two texts agree on bytes.
    for (let u = 0; u <= text.length; u++) {
      const cu = sourceToTextOffset(buffer, u);
      assert.ok(buffer.offsets.at(cu) <= offsets.at(u), `file ${n}: unit ${u}`);
      const inPair = cu > 0 && /[\uD800-\uDBFF]/.test(buffer.text[cu - 1]!) && /[\uDC00-\uDFFF]/.test(buffer.text[cu] ?? '');
      if (!inPair) assert.equal(sourceToTextOffset(buffer, textToSourceOffset(buffer, cu)), cu, `file ${n}: unit ${u} back`);
    }
  }
});

test('readableText leaves no lone surrogate and keeps astral characters', () => {
  assert.equal(readableText('a\uDCFFb\uDC80\u{1F600}\uD800z'), 'a\uFFFDb\uFFFD\u{1F600}\uFFFDz');
  assert.equal(readableText('plain'), 'plain');
  assert.equal(readableText('\uD83D\uDC80'), '\u{1F480}', 'a pair whose low half is in the escape range is a character');
  assert.equal(holdsStrayBytes('\uD83D\uDC80'), false);
});

test('encodeSourceText writes any other lone surrogate as EF BF BD, as TextEncoder does', () => {
  assert.equal(hex(encodeSourceText('\uD800\uDCFF')), hex(enc.encode('\u{100FF}')), 'a pair is a character');
  assert.equal(hex(encodeSourceText('\uDC10x\uDCFF')), hex(bytesOf([0xef, 0xbf, 0xbd], 'x', [0xff])));
  assert.equal(hex(encodeSourceText('a\uD800')), hex(bytesOf('a', [0xef, 0xbf, 0xbd])));
});

test('Rendered and the index read a folded file with no lone surrogate', () => {
  const like = createBuffer('/r.md', bytesOf('# Caf', [0xe9], '\n\npara ', [0xff], ' and ', [0xe2, 0x82], '\n'));
  const source = sourceTextOf(like).text;
  const fold = foldText(like, source.replace('para', 'PARA').replace('# Caf', '# CAF'));
  assert.ok(fold);
  const after = splice(like, fold.range, fold.replacement);
  assert.equal(hex(after.bytes), hex(bytesOf('# CAF', [0xe9], '\n\nPARA ', [0xff], ' and ', [0xe2, 0x82], '\n')));
  assert.ok(!LONE.test(after.text), 'the reading text');
  const html = renderSafeHtml(after.bytes).html;
  assert.ok(!LONE.test(html), 'the rendered HTML');
  assert.ok(html.includes('\uFFFD'), 'a stray byte reads as U+FFFD');
  const headings = headingsFromMarkdown(after.bytes);
  assert.equal(headings.length, 1);
  assert.ok(!LONE.test(JSON.stringify(headings)), 'the index');
});

test('the Source text of 1 MB with strays is built in well under the fold\'s own time', () => {
  const parts: Array<string | number[]> = [];
  for (let i = 0; i < 30000; i++) parts.push(`line ${i} of a fairly long file `, i % 50 === 0 ? [0xe2, 0x82] : [0xe9], '\n');
  const buffer = createBuffer('/big.md', bytesOf(...parts));
  assert.ok(buffer.bytes.length > 1_000_000);
  const t0 = performance.now();
  const { text, sameUnits } = sourceTextOf(buffer);
  const ms = performance.now() - t0;
  assert.equal(sameUnits, false);
  assert.equal(hex(encodeSourceText(text).subarray(0, 64)), hex(buffer.bytes.subarray(0, 64)));
  // Recorded, not a budget (ADR-0032): the number is in the PR.
  console.log(`# Source text of ${buffer.bytes.length} bytes with 30000 strays: ${ms.toFixed(1)} ms`);
});
