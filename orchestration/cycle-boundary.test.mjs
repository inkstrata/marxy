// settleFromMain and dispatch ordering: merged-on-main keys before selectReady (MARXY-213).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleFromMain } from './cycle.mjs';

const board = stories => ({ stories });

test('settleFromMain settles missing and todo, flags live statuses, ignores done (MARXY-213)', () => {
  const merged = new Map([
    ['MARXY-MISSING', 100],
    ['MARXY-TODO', 101],
    ['MARXY-REVIEW', 102],
    ['MARXY-BLOCKED', 103],
    ['MARXY-DONE', 104],
  ]);
  const s = board({
    'MARXY-TODO': { status: 'todo', attempts: 0 },
    'MARXY-REVIEW': { status: 'in_review', attempts: 1, pr: 102 },
    'MARXY-BLOCKED': { status: 'blocked', attempts: 2 },
    'MARXY-DONE': { status: 'done', attempts: 1 },
  });
  const { settle, flag } = settleFromMain(merged, s);
  assert.deepEqual(settle.map(x => x.key).sort(), ['MARXY-MISSING', 'MARXY-TODO']);
  assert.deepEqual(flag.map(x => x.key).sort(), ['MARXY-BLOCKED', 'MARXY-REVIEW']);
  assert.ok(!settle.some(x => x.key === 'MARXY-DONE'));
  assert.ok(!flag.some(x => x.key === 'MARXY-DONE'));
});

test('reconcile settles from main before selectReady (MARXY-213)', () => {
  const src = readFileSync(resolve('orchestration/cycle.mjs'), 'utf8');
  const reconcileBody = src.slice(src.indexOf('export function reconcile'), src.indexOf('function runCycle'));
  const settleAt = reconcileBody.indexOf('settleFromMain(');
  const readyAt = reconcileBody.indexOf('selectReady(');
  assert.ok(settleAt >= 0 && readyAt >= 0, 'both calls must appear in reconcile');
  assert.ok(settleAt < readyAt, 'settleFromMain must run before selectReady');
});
