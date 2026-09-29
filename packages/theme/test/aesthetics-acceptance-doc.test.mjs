// MARXY-241: docs/aesthetics-acceptance.md stays aligned with scripts/gate-aesthetics.mjs.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../../', import.meta.url);
const gate = readFileSync(new URL('scripts/gate-aesthetics.mjs', root), 'utf8');
const doc = readFileSync(new URL('docs/aesthetics-acceptance.md', root), 'utf8');

const shared = [
  'text-bearing',
  'text-on-tint',
  'forced-colors',
  'prefers-contrast',
  'prefers-reduced-motion',
  '320',
  '400',
  'fixtures/themes',
];

test('MARXY-241: aesthetics-acceptance.md documents the same contrast and reflow checks as the gate', () => {
  for (const phrase of shared) {
    assert.match(doc, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(gate, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
