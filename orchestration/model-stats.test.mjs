import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateBoard, modelFamily } from './model-stats.mjs';

test('modelFamily buckets composer and grok', () => {
  assert.equal(modelFamily('composer-2.5-fast'), 'composer');
  assert.equal(modelFamily('grok-4.6-fast'), 'grok');
  assert.equal(modelFamily('claude-opus-5'), 'claude');
});

test('aggregateBoard counts returns and first-try done', () => {
  const board = {
    merges: 3,
    stories: {
      'MARXY-1': { status: 'done', attempts: 1, model: 'grok-4.6-fast' },
      'MARXY-2': { status: 'done', attempts: 2, model: 'grok-4.6-fast' },
      'MARXY-3': { status: 'escalate', attempts: 2, model: 'grok-4.6-fast' },
    },
  };
  const { byFamily } = aggregateBoard(board);
  const g = byFamily.grok;
  assert.equal(g.done, 2);
  assert.equal(g.firstTryDone, 1);
  assert.equal(g.retryDone, 1);
  assert.equal(g.escalate, 1);
});
