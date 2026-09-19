import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFromArgv, laneBudget, models } from './lib.mjs';

const fixture = {
  compute: 'default',
  modes: {
    default: { orchestrator: { model: 'claude-opus-5' }, implementor: { model: 'grok-4.6-fast' } },
    low: { orchestrator: { model: 'claude-sonnet-5' }, implementor: { model: 'grok-4.6-fast' } },
    minimal: { orchestrator: { model: 'grok-4.6-fast' }, implementor: { model: 'grok-4.6-fast' } },
  },
  lanes: 3,
};

test('computeFromArgv reads --low, --minimal, and --compute', () => {
  assert.equal(computeFromArgv(['node', 'x', '--low']), 'low');
  assert.equal(computeFromArgv(['node', 'x', '--minimal']), 'minimal');
  assert.equal(computeFromArgv(['node', 'x', '--compute=low']), 'low');
  assert.equal(computeFromArgv(['node', 'x', '--compute', 'minimal']), 'minimal');
  assert.equal(computeFromArgv(['node', 'x', '--no-merge']), null);
});

test('models() default, low, and minimal resolve the named roles', () => {
  const d = models(fixture, ['node'], {});
  assert.equal(d.compute, 'default');
  assert.equal(d.orchestrator.model, 'claude-opus-5');
  const low = models(fixture, ['node', '--low'], {});
  assert.equal(low.compute, 'low');
  assert.equal(low.orchestrator.model, 'claude-sonnet-5');
  assert.equal(low.implementor.model, 'grok-4.6-fast');
  const min = models(fixture, ['node', '--minimal'], { MARXY_COMPUTE: 'default' });
  assert.equal(min.compute, 'minimal');
  assert.equal(min.orchestrator.model, 'grok-4.6-fast');
  assert.equal(min.reviewer, undefined);
});

test('models() env and file field apply when argv is silent', () => {
  assert.equal(models(fixture, ['node'], { MARXY_COMPUTE: 'low' }).compute, 'low');
  assert.equal(models({ ...fixture, compute: 'minimal' }, ['node'], {}).compute, 'minimal');
});

test('models() rejects an unknown mode', () => {
  assert.throws(() => models(fixture, ['node', '--compute=turbo'], {}), /unknown compute mode "turbo"/);
});

test('laneBudget treats null, 0, and omitted as uncapped', () => {
  assert.equal(laneBudget({ lanes: null }), Infinity);
  assert.equal(laneBudget({ lanes: 0 }), Infinity);
  assert.equal(laneBudget({}), Infinity);
  assert.equal(laneBudget({ lanes: 3 }), 3);
  assert.throws(() => laneBudget({ lanes: -1 }), /invalid lanes/);
});

test('checked-in models.json has default, low, and minimal', () => {
  const d = models(undefined, ['node'], {});
  assert.equal(d.compute, 'default');
  assert.equal(d.orchestrator.model, 'claude-opus-5');
  const low = models(undefined, ['node', '--low'], {});
  assert.equal(low.orchestrator.model, 'claude-sonnet-5');
  assert.equal(low.implementor.inApp, 'cursor-grok-4.6-high-fast');
  const min = models(undefined, ['node', '--minimal'], {});
  for (const role of ['orchestrator', 'planner', 'implementor', 'implementorEscalation']) {
    assert.equal(min[role].model, 'grok-4.6-fast');
    assert.equal(min[role].inApp, 'cursor-grok-4.6-high-fast');
  }
  // The one exception: a review by the implementor's own model family repeats its blind spots (MARXY-106).
  assert.equal(min.reviewer.model, 'claude-sonnet-5');
  assert.equal(d.lanes, null);
  assert.equal(laneBudget(d), Infinity);
});
