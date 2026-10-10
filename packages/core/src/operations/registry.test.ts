// Registry-level checks (E-01). Later stories that register operations extend these by registering, not by
// editing this file: no list of ids is kept here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPERATIONS } from './index.ts';

test('registry: every operation id is unique and kebab-case', () => {
  const seen = new Set<string>();
  for (const op of OPERATIONS) {
    assert.match(op.id, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, `${op.id} is not kebab-case`);
    assert.ok(!seen.has(op.id), `${op.id} is registered twice`);
    seen.add(op.id);
  }
});

test('registry: every operation has a title and at least one appliesTo', () => {
  for (const op of OPERATIONS) {
    assert.ok(op.title.trim().length > 0, `${op.id} has no title`);
    assert.ok(op.appliesTo.length > 0, `${op.id} has an empty appliesTo`);
  }
});
