// KINDS: the fixed list of document kinds and its default.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_KIND, KINDS } from './kinds.ts';

test('KINDS has fourteen distinct names and article is the default', () => {
  assert.equal(KINDS.length, 14);
  assert.equal(new Set(KINDS).size, KINDS.length);
  assert.equal(DEFAULT_KIND, 'article');
  assert.equal(KINDS[0], DEFAULT_KIND);
});
