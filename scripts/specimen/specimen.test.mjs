// Unit checks for the specimen scripts: no hard-coded hex outside the theme parser, expected PNG names.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DPRS, OUT, VARIANTS, pages, pairs } from './specimen.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hex = new RegExp(`${String.fromCharCode(35)}[0-9a-f]{6}\\b`, 'gi');

test('scripts/specimen/*.mjs contain no hard-coded hex outside parse-theme.mjs', () => {
  for (const name of readdirSync(here).filter(f => f.endsWith('.mjs') && f !== 'parse-theme.mjs' && f !== 'specimen.test.mjs')) {
    const text = readFileSync(join(here, name), 'utf8');
    const hits = [...text.matchAll(hex)].map(m => m[0]);
    assert.equal(hits.length, 0, `${name} hard-codes ${hits.join(', ')}`);
  }
});

test('review-0 expected PNG names', () => {
  const expected = [];
  for (const pair of pairs) {
    for (const variant of VARIANTS) {
      for (const page of pages) {
        for (const dpr of DPRS) {
          expected.push(`${OUT}/${pair.slug}/${page.id}-${variant}-${dpr}x.png`);
        }
      }
    }
  }
  assert.equal(expected.length, pairs.length * VARIANTS.length * pages.length * DPRS.length);
  assert.deepEqual(expected.slice(0, 2), [
    `${OUT}/${pairs[0].slug}/${pages[0].id}-dark-1x.png`,
    `${OUT}/${pairs[0].slug}/${pages[0].id}-dark-2x.png`,
  ]);
});
