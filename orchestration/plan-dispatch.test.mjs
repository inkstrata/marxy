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
