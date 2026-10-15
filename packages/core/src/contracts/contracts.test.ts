import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AST_INVARIANTS, type Node } from './ast.ts';
import { DERIVED_INVARIANTS, type DerivedNode, type TranscriptNode } from './derived.ts';
import { INDEX_LIMITS } from './index-entry.ts';
test('contract constants', () => {
  assert.equal(AST_INVARIANTS.length, 6);
  assert.equal(INDEX_LIMITS.entriesPerRoot, 50_000);
});

test('a DerivedNode is not a Node: no derived tree reaches an operation by the type checker (ADR-0061 items 2 and 6)', () => {
  // Each line fails to compile if a derived node, or any transcript node, ever becomes assignable to an AST node.
  const separate: [DerivedNode] extends [Node] ? 'leaks' : 'separate' = 'separate';
  const transcript: [TranscriptNode] extends [Node] ? 'leaks' : 'separate' = 'separate';
  const someLeaf: Extract<DerivedNode, Node> extends never ? 'none' : 'some' = 'none';
  assert.deepEqual([separate, transcript, someLeaf], ['separate', 'separate', 'none']);
  assert.equal(DERIVED_INVARIANTS.length, 7);
});
