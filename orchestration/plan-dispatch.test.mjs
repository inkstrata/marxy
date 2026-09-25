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

test('plannerGate never starts a second planner beside a running one, however long it has run (a machine that slept)', () => {
  assert.equal(plannerGate({ lease: { pid: 9, started: ago(900) }, held: true, nowMs: T0, cooldownMinutes: 240 }).run, false);
});

// The 2026-09-24 bug: the detached planner exited at once and never wrote planner.log (MARXY-208).
test('a detached planner writes planner.log, holds its lease while it runs, then cools down', async () => {
  const { mkdtempSync, writeFileSync: write, readFileSync: read, chmodSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { runPlanner } = await import('./plan-dispatch.mjs');
  const { pidAlive } = await import('./lease.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'marxy-planner-'));
  const bin = join(dir, 'fake-agent');
  write(bin, '#!/bin/sh\necho "planned"\nsleep 1\n');
  chmodSync(bin, 0o755);
  const opts = { m: { planner: { model: 'x' }, cliEffortFlag: '' }, bin, prompt: '# fake planner prompt\nbody', leasePath: join(dir, 'planner.lease'), logPath: join(dir, 'planner.log'), needsHumanPath: join(dir, 'nh.md') };
  const first = await runPlanner(opts);
  assert.ok(first.pid > 0);
  assert.equal((await runPlanner(opts)).skipped, true, 'no second planner while the first runs');
  const until = Date.now() + 5000;
  while (pidAlive(first.pid) && Date.now() < until) await new Promise(r => setTimeout(r, 50));
  assert.match(read(opts.logPath, 'utf8'), /planned/);
  assert.equal((await runPlanner(opts)).skipped, true, 'cooldown after it finished');
});

test('plan-dispatch.mjs exits cleanly when it starts a detached planner (no unsettled await)', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const src = new URL('./plan-dispatch.mjs', import.meta.url).href;
  const dir = mkdtempSync(join(tmpdir(), 'marxy-planner-'));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { runPlanner } = await import(${JSON.stringify(src)});
    await runPlanner({ m: { planner: { model: 'x' }, cliEffortFlag: '' }, bin: '/usr/bin/true', prompt: 'p',
      leasePath: ${JSON.stringify(join(dir, 'l'))}, logPath: ${JSON.stringify(join(dir, 'log'))}, needsHumanPath: ${JSON.stringify(join(dir, 'nh'))} });`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
