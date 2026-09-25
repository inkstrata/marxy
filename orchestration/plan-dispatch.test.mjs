// Headless planner spawn mirrors dispatch.mjs argv shape (MARXY-200 AC4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannerSpawnArgs } from './plan-dispatch.mjs';

test('plannerSpawnArgs uses the planner role model and prompt tail like dispatch.mjs', () => {
  const m = {
    planner: { model: 'claude-sonnet-5', effort: 'high' },
    cliEffortFlag: '',
  };
  const { bin, args } = plannerSpawnArgs({ m, bin: 'cursor-agent', prompt: 'PLAN' });
  assert.equal(bin, 'cursor-agent');
  assert.deepEqual(args.slice(0, 5), ['-p', '--force', '--model', 'claude-sonnet-5', '--output-format']);
  assert.equal(args.at(-1), 'PLAN');
});

test('plannerSpawnArgs forwards cliEffortFlag when configured', () => {
  const m = {
    planner: { model: 'x', effort: 'high' },
    cliEffortFlag: '--reasoning-effort',
  };
  const { args } = plannerSpawnArgs({ m, prompt: 'p' });
  assert.ok(args.includes('--reasoning-effort'));
  assert.ok(args.includes('high'));
});

// One planner at a time, and a cooldown after it (MARXY-208).
import { plannerGate } from './plan-dispatch.mjs';

const T0 = Date.parse('2026-09-24T12:00:00.000Z');
const ago = min => new Date(T0 - min * 60_000).toISOString();

test('plannerGate starts a planner when none has run', () => {
  assert.equal(plannerGate({ lease: null, held: null, nowMs: T0 }).run, true);
});

test('plannerGate never starts a second planner while one runs', () => {
  const g = plannerGate({ lease: { pid: 9, started: ago(20) }, held: true, nowMs: T0 });
  assert.equal(g.run, false);
  assert.match(g.why, /running/);
});

test('plannerGate waits out the cooldown after a planner finished, then allows the next', () => {
  assert.equal(plannerGate({ lease: { pid: 9, started: ago(30) }, held: false, nowMs: T0, cooldownMinutes: 240 }).run, false);
  assert.equal(plannerGate({ lease: { pid: 9, started: ago(300) }, held: false, nowMs: T0, cooldownMinutes: 240 }).run, true);
});

test('plannerGate stops trusting a lease past maxMinutes, since its pid may be reused', () => {
  assert.equal(plannerGate({ lease: { pid: 9, started: ago(500) }, held: true, nowMs: T0, cooldownMinutes: 240, maxMinutes: 180 }).run, true);
});
