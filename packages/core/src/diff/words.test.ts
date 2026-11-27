import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pairChangedLines, wordTokens } from './words.ts';

const changed = (tokens: readonly string[], marks: readonly boolean[]): string[] => tokens.filter((_, k) => marks[k]);

test('tokens cover the line: words, runs of space, and each other character', () => {
  const line = '- Expected downtime is **about 10** minutes.';
  assert.equal(wordTokens(line).join(''), line);
  assert.deepEqual(wordTokens('a, b'), ['a', ',', ' ', 'b']);
});

test('each added line pairs with the removed line most like it, and only the words that differ are marked', () => {
  const pairs = pairChangedLines(
    ['Two blockers remain.', 'Expected downtime is about 10 minutes.'],
    ['Expected downtime is under 4 minutes.'],
  );
  assert.equal(pairs.length, 1);
  const [p] = pairs;
  assert.equal(p!.del, 1);
  assert.deepEqual(changed(p!.delTokens, p!.delChanged), ['about', '10']);
  assert.deepEqual(changed(p!.addTokens, p!.addChanged), ['under', '4']);
});

test('a rewrite, an unchanged line and a change only in space are left whole', () => {
  assert.deepEqual(pairChangedLines(['The cat sat on the mat.'], ['Deploys run at noon on Fridays.']), []);
  assert.deepEqual(pairChangedLines(['same words here'], ['same words here']), []);
  assert.deepEqual(pairChangedLines(['a  b c'], ['a b c']), []);
});

test('a removed line is used once', () => {
  const pairs = pairChangedLines(['one two three four'], ['one two three five', 'one two three six']);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]!.add, 0);
});
