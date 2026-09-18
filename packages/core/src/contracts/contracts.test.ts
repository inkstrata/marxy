import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AST_INVARIANTS } from './ast.ts';
import { INDEX_LIMITS } from './index-entry.ts';
test('contracts are frozen constants', () => {
  assert.equal(AST_INVARIANTS.length, 6);
  assert.equal(INDEX_LIMITS.entriesPerRoot, 50_000);
});
