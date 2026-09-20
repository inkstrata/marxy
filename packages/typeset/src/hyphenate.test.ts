// The skip rules and the allow-list, in Node: a hyphenator that ran on code, a URL or a German
// paragraph would be a licence and a meaning bug, and those cases never need a browser.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { hyphenateEnGB } from 'justif/hyphenate/en-gb';
import { hyphenateEnUS } from 'justif/hyphenate/en-us';
import { hyphenOffsets, resolvePattern, skipHyphenation } from './hyphenate.ts';

const allowlist = JSON.parse(
  readFileSync(new URL('../../../scripts/allowlists/hyphenation-patterns.json', import.meta.url), 'utf8'),
);

test('only en-us and en-gb patterns are allow-listed', () => {
  assert.deepEqual(
    allowlist.languages.map((row: { id: string }) => row.id).sort(),
    ['en-gb', 'en-us'],
  );
});

test('nearest lang picks an allow-listed pattern or nothing', () => {
  assert.equal(resolvePattern('en'), 'en-us');
  assert.equal(resolvePattern('en-US'), 'en-us');
  assert.equal(resolvePattern('en_GB'), 'en-gb');
  assert.equal(resolvePattern('en-gb-oed'), 'en-gb');
  assert.equal(resolvePattern('de'), null);
  assert.equal(resolvePattern('fr'), null);
  assert.equal(resolvePattern('en-au'), null);
});

test('short words, digits and URLs never hyphenate', () => {
  assert.equal(skipHyphenation('hello'), true);
  assert.equal(skipHyphenation('hyphenation'), false);
  assert.equal(skipHyphenation('utf8encoding'), true);
  assert.equal(skipHyphenation('https://example.com/internationalization'), true);
  assert.equal(skipHyphenation('www.example.com'), true);
});

test('en-us splits a long word; en-gb is a different pattern', () => {
  assert.deepEqual(hyphenOffsets('hyphenation', hyphenateEnUS), [2, 6]);
  assert.ok(hyphenOffsets('organisation', hyphenateEnGB).length > 0);
  assert.notDeepEqual(
    hyphenOffsets('organisation', hyphenateEnUS),
    hyphenOffsets('organisation', hyphenateEnGB),
  );
});

test('a skipped word produces no offsets even if the hyphenator would split it', () => {
  assert.deepEqual(hyphenOffsets('hello', hyphenateEnUS), []);
  assert.deepEqual(hyphenOffsets('https://example.com/internationalization', hyphenateEnUS), []);
});
