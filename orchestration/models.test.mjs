// Every compute mode keeps the reviewer independent of the implementor (MARXY-106).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { models } from './lib.mjs';

const raw = JSON.parse(readFileSync(new URL('./models.json', import.meta.url), 'utf8'));
/** claude-opus-5 → claude, grok-4.6-fast → grok, gpt-5 → gpt. */
const family = id => String(id).toLowerCase().split(/[-.]/)[0];

for (const mode of Object.keys(raw.modes)) {
  test(`${mode}: the reviewer is not the implementor's model family`, () => {
    const m = models(raw, [], { MARXY_COMPUTE: mode });
    assert.notEqual(family(m.reviewer.model), family(m.implementor.model));
  });
}

test('family reads the vendor prefix', () => {
  assert.equal(family('claude-sonnet-5'), 'claude');
  assert.equal(family('grok-4.6-fast'), 'grok');
});
