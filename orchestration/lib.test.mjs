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

test('checked-in models.json has default, low, minimal, and high', () => {
  const d = models(undefined, ['node'], {});
  assert.equal(d.compute, 'default');
  assert.equal(d.orchestrator.model, 'claude-sonnet-5');
  assert.equal(d.implementor.model, 'composer-2.5');
  const low = models(undefined, ['node', '--low'], {});
  assert.equal(low.orchestrator.model, 'claude-sonnet-5');
  assert.equal(low.implementor.model, 'composer-2.5');
  assert.equal(low.implementorEscalation.model, 'grok-4.6');
  const high = models(undefined, ['node', '--high'], {});
  assert.equal(high.compute, 'high');
  assert.equal(high.reviewer.model, 'claude-opus-5');
  assert.equal(high.planner.model, 'claude-opus-5');
  assert.equal(d.lanes, null);
  assert.equal(laneBudget(d), Infinity);
});

test('minimal compute mode never names a Claude or GPT model — the Cursor-only floor', () => {
  const min = models(undefined, ['node', '--minimal'], {});
  for (const role of ['orchestrator', 'planner', 'implementor', 'implementorEscalation', 'reviewer']) {
    assert.doesNotMatch(min[role].model, /claude|gpt|gemini/i, `minimal.${role} must not name a Claude/GPT/Gemini model`);
  }
  // Escalation ceiling is Grok — the strongest model configured anywhere in this mode.
  assert.equal(min.implementorEscalation.model, 'grok-4.6');
});

// MARXY-173: a row still carrying its MARXY-NEW- placeholder has no Jira issue, and `jira.mjs sync` is
// about to rename it. Dispatched in that window it was run twice, once under each key.
const CSV = [
  'Key,Type,Summary,Labels,Paths,Acceptance',
  'MARXY-1,Story,real story,phase-1,packages/core,"1. it works"',
  'MARXY-NEW-tokens-test-live-values,Story,not synced yet,ops,scripts/x,"1. it works"',
  'MARXY-2,Epic,an epic,,,',
].join('\n');

test('isPlaceholderKey matches MARXY-NEW- keys only, in any case', async () => {
  const { isPlaceholderKey } = await import('./lib.mjs');
  assert.equal(isPlaceholderKey('MARXY-NEW-tokens-test-live-values'), true);
  assert.equal(isPlaceholderKey('marxy-new-x'), true);
  assert.equal(isPlaceholderKey('MARXY-145'), false);
  assert.equal(isPlaceholderKey(undefined), false);
});

test('stories() leaves out a placeholder row and keeps the real ones', async () => {
  const { stories } = await import('./lib.mjs');
  const keys = stories(CSV).map(s => s.Key);
  assert.ok(keys.includes('MARXY-1'));
  assert.ok(!keys.some(k => /^MARXY-NEW-/i.test(k)));
});

test('isBoardKey accepts a numbered Jira key and nothing else', async () => {
  const { isBoardKey } = await import('./lib.mjs');
  for (const ok of ['MARXY-1', 'MARXY-145']) assert.equal(isBoardKey(ok), true, ok);
  for (const no of ['MARXY-NEW-x', 'MARXY-', 'marxy-1', 'MARXY-1a', 'x MARXY-1', '', undefined]) assert.equal(isBoardKey(no), false, String(no));
});

test('a placeholder row is never ready, so it cannot be dispatched before sync', async () => {
  const { stories } = await import('./lib.mjs');
  const { selectReady } = await import('./ready.mjs');
  const report = selectReady({ all: stories(CSV), s: { stories: {} }, d: { phases: {}, deps: {} }, cap: Infinity });
  const named = [...report.ready.map(r => r.key), ...report.blockedByDeps, ...report.blockedByPaths, ...report.excluded.map(e => e.key)];
  assert.ok(report.ready.some(r => r.key === 'MARXY-1'));
  assert.ok(!named.some(k => /^MARXY-NEW-/.test(k)));
});
