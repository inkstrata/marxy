import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { diagnose, snapshot, surveyInflight, VERDICT } from './doctor.mjs';
import { append } from './store.mjs';

test('diagnose names ghost workers and points at doctor --fix', () => {
  const x = {
    loop: { held: true, lease: { pid: 1, started: '2026-01-01T00:00:00.000Z' } },
    cycle: { held: false, lease: null },
    planner: { held: false, gate: { run: false, why: 'not due' }, authFailure: false },
    statusAgeMinutes: 1,
    stuckCycleMinutes: 30,
    main: { branch: 'main', ahead: 0, behind: 0 },
    inflight: [{ key: 'MARXY-1', verdict: VERDICT.GHOST, why: 'worker gone; left nothing', rec: {} }],
    parked: [],
    ready: { ready: [], blockedByPaths: [], blockedByDeps: [], blockedByLanes: [] },
    todo: 1,
    holders: {},
    needsHuman: 0,
    fleetDoctor: [],
  };
  const f = diagnose(x);
  assert.ok(f.some(g => g.area === 'MARXY-1' && g.level === 'fail' && g.fix?.includes('doctor.mjs --fix')));
});

test('snapshot and diagnose run against a temporary fleet store', () => {
  process.env.MARXY_FLEET_DIR = mkdtempSync(join(tmpdir(), 'marxy-doctor-'));
  append({ type: 'imported', board: { stories: {} } });
  const x = snapshot();
  assert.ok(x.loop);
  assert.ok(Array.isArray(diagnose(x)));
});

// The 2026-09-27 bug reports: every one of these was filed as a failure (MARXY-273).
const NOW = Date.parse('2026-09-27T12:00:00.000Z');
const ago = m => new Date(NOW - m * 60_000).toISOString();
const T = { staleMinutes: 90 };

test('a run that wrote its exit record is finished, not dead, until a cycle is overdue to read it', () => {
  const b = { runs: { r1: { key: 'MARXY-263', role: 'review', pid: 9 } }, stories: { 'MARXY-263': { status: 'in_review', run: 'r1' } } };
  const wt = [{ key: 'MARXY-263', ahead: 3, dirty: false }];
  const fresh = surveyInflight({ b, runObs: { r1: { alive: false, exit: { endedAt: ago(2) }, logBytes: 9000 } }, worktrees: wt, t: T, nowMs: NOW });
  assert.equal(fresh[0].verdict, VERDICT.LIVE);
  assert.match(fresh[0].why, /finished 2 min ago/);
  const unread = surveyInflight({ b, runObs: { r1: { alive: false, exit: { endedAt: ago(120) }, logBytes: 9000 } }, worktrees: wt, t: T, nowMs: NOW });
  assert.equal(unread[0].verdict, VERDICT.DEAD);
  const vanished = surveyInflight({ b, runObs: { r1: { alive: false, logBytes: 9000 } }, worktrees: wt, t: T, nowMs: NOW });
  assert.equal(vanished[0].verdict, VERDICT.DEAD);
});

test('a story claimed by a person or session is live however quiet its worktree', () => {
  // MARXY-266 was reported "quiet" sixty times while out-of-plan.mjs held its claim.
  const rec = { status: 'in_progress', started: ago(600), claim: { by: 'out-of-plan.mjs', until: ago(-120), paths: ['a'] } };
  const b = { runs: {}, stories: { 'MARXY-266': rec } };
  const wt = [{ key: 'MARXY-266', ahead: 0, dirty: true, lastActivityMs: NOW - 300 * 60_000 }];
  const live = surveyInflight({ b, runObs: {}, worktrees: wt, t: T, nowMs: NOW });
  assert.equal(live[0].verdict, VERDICT.LIVE);
  assert.match(live[0].why, /claimed by out-of-plan\.mjs/);
  rec.claim.until = ago(5);
  assert.equal(surveyInflight({ b, runObs: {}, worktrees: wt, t: T, nowMs: NOW })[0].verdict, VERDICT.QUIET, 'a lapsed claim is quiet again');
});

const healthy = over => ({
  loop: { held: true, lease: { pid: 1, started: ago(600) } },
  cycle: { held: false, lease: null },
  planner: { held: false, gate: { run: false, why: 'not due' }, authFailure: false },
  statusAgeMinutes: 1,
  stuckCycleMinutes: 30,
  nowMs: NOW,
  main: { branch: 'main', ahead: 0, behind: 0 },
  inflight: [],
  parked: [],
  ready: { ready: [], blockedByPaths: ['MARXY-16'], blockedByDeps: [], blockedByLanes: [] },
  todo: 1,
  holders: {},
  needsHuman: 0,
  fleetDoctor: [],
  ...over,
});

test('nothing ready fails only when a stalled story holds the paths the rest wait on', () => {
  const stalled = { key: 'MARXY-264', verdict: VERDICT.DEAD, why: 'worker gone', rec: {} };
  const bystander = diagnose(healthy({ inflight: [stalled], holders: { 'MARXY-16': ['MARXY-49 (in_progress)'] } })).find(f => f.area === 'ready');
  assert.equal(bystander.level, 'warn');
  assert.doesNotMatch(bystander.msg, /nobody is running/);
  const holder = diagnose(healthy({ inflight: [stalled], holders: { 'MARXY-16': ['MARXY-264 (in_review)'] } })).find(f => f.area === 'ready');
  assert.equal(holder.level, 'fail');
  assert.match(holder.msg, /held by stories nobody is running: MARXY-264/);
});

test('a stale report after the machine slept is a warning, not a hung cycle to restart', () => {
  const slept = diagnose(healthy({ statusAgeMinutes: 513, lastCycle: { started: ago(514), ended: ago(513), rc: 0 } })).find(f => f.area === 'loop' && f.level !== 'ok');
  assert.equal(slept.level, 'warn');
  assert.equal(slept.fix, undefined, 'no restart is proposed');
  const hung = diagnose(healthy({ statusAgeMinutes: 60, cycle: { held: true, lease: { pid: 5, started: ago(60) } } })).find(f => f.area === 'loop' && f.level === 'fail');
  assert.match(hung.msg, /hung/);
  assert.match(hung.fix, /loop\.sh stop/);
});
