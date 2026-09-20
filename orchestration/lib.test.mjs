import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeFromArgv, laneBudget, models, cursorAgentBin } from './lib.mjs';

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

test('cursorAgentBin honors CURSOR_AGENT and ~/.local/bin', () => {
  const home = mkdtempSync(join(tmpdir(), 'marxy-cursor-agent-'));
  const bin = join(home, '.local/bin/cursor-agent');
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  writeFileSync(bin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  chmodSync(bin, 0o755);
  const emptyPath = { PATH: home };
  assert.equal(cursorAgentBin(emptyPath, home), bin);
  const other = join(home, 'custom-agent');
  writeFileSync(other, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal(cursorAgentBin({ CURSOR_AGENT: other }, home), other);
});
