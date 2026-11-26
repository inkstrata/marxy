// Which tier a code file is coloured in, and what the page says of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLOUR_ALL_BYTES, COLOUR_LINE_CHARS, colourTier, longestLine, tierHeadWords, tierList, tierWhyWords } from './tier.ts';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const ofSize = (n: number, line = 80): Uint8Array => {
  const out = new Uint8Array(n).fill(0x61);
  for (let i = line; i < n; i += line + 1) out[i] = 0x0a;
  return out;
};

test('tier: up to 2 MB with short lines is the full page, and says nothing', () => {
  assert.deepEqual(colourTier(bytes('const a = 1;\n')), { tier: 'full' });
  assert.deepEqual(colourTier(ofSize(COLOUR_ALL_BYTES)), { tier: 'full' });
  assert.equal(tierHeadWords(colourTier(ofSize(COLOUR_ALL_BYTES))), null);
});

test('tier: past 2 MB is plain text, said in the head', () => {
  const tier = colourTier(ofSize(COLOUR_ALL_BYTES + 1));
  assert.deepEqual(tier, { tier: 'plain', why: 'size', anyway: false });
  assert.equal(tierHeadWords(tier), 'Plain text · no colour past 2 MB');
  assert.equal(tierWhyWords(tier, 5_400_000), 'by its size: 5.1 MB, past the 2 MB a full page is made for');
});

test('tier: a line past 10,000 characters is plain text, at any size', () => {
  const at = `${'x'.repeat(COLOUR_LINE_CHARS)}\n`;
  assert.deepEqual(colourTier(bytes(at)), { tier: 'full' }, 'a line of exactly 10,000 is the full page');
  const past = colourTier(bytes(`a\n${'x'.repeat(COLOUR_LINE_CHARS + 1)}\nb\n`));
  assert.deepEqual(past, { tier: 'plain', why: 'line', anyway: false });
  assert.equal(tierHeadWords(past), 'Plain text · no colour with lines past 10,000 characters');
  // Characters, not bytes: 6,000 two-byte characters are 12,000 bytes on one short line.
  assert.deepEqual(colourTier(bytes(`${'é'.repeat(6000)}\n`)), { tier: 'full' });
  // A CR alone ends a line too.
  assert.equal(longestLine(bytes(`${'x'.repeat(10)}\r${'y'.repeat(4)}`)), 10);
});

test('tier: colour anyway is the reader\'s choice, said as theirs; the full page has none to make', () => {
  const tier = colourTier(ofSize(COLOUR_ALL_BYTES + 1), true);
  assert.deepEqual(tier, { tier: 'plain', why: 'size', anyway: true });
  assert.equal(tierHeadWords(tier), 'Coloured as you scroll · your choice');
  assert.deepEqual(colourTier(bytes('x\n'), true), { tier: 'full' });
});

test('tier: the Reading card lists three tiers with the file\'s marked', () => {
  const full = tierList({ tier: 'full' });
  assert.deepEqual(full.items.map((i) => i.name), ['The full page', 'Plain text', 'The bytes']);
  assert.equal(full.at, 0);
  assert.equal(tierList(colourTier(ofSize(COLOUR_ALL_BYTES + 1))).at, 1);
});
