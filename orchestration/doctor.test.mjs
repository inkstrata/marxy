// doctor.mjs findings over a fixture snapshot (MARXY-208).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from './doctor.mjs';

const base = (over = {}) => ({
  loop: { lease: { pid: 1, started: 'T' }, held: true },
  cycle: { lease: null, held: null },
  planner: { lease: null, held: null, gate: { run: true, why: '' } },
  statusAgeMinutes: 1,
  stuckCycleMinutes: 30,
  main: { branch: 'main', ahead: 0, behind: 0 },
  inflight: [],
  parked: [],
  ready: { ready: [{ key: 'MARXY-1' }], blockedByPaths: [], blockedByDeps: [], blockedByLanes: [] },
  todo: 1,
  holders: {},
  needsHuman: 0,
  ...over,
});
const fails = x => diagnose(x).filter(f => f.level === 'fail');

test('a healthy fleet has no failures', () => {
  assert.deepEqual(fails(base()), []);
});

test('the 2026-09-23 deadlock: nothing ready, paths held by ghosts — a failure naming them and --fix', () => {
  const x = base({
    inflight: [{ key: 'MARXY-16', verdict: 'ghost', why: 'no lease; quiet 1800 min; left nothing' }],
    ready: { ready: [], blockedByPaths: ['MARXY-44'], blockedByDeps: ['MARXY-45'], blockedByLanes: [] },
    todo: 2,
    holders: { 'MARXY-44': ['MARXY-16 (in_progress)'] },
  });
  const ready = fails(x).find(f => f.area === 'ready');
  assert.match(ready.msg, /held by stories nobody is running: MARXY-16/);
  assert.match(ready.msg, /MARXY-44 ← MARXY-16/);
  assert.equal(ready.fix, 'node orchestration/doctor.mjs --fix');
  assert.ok(fails(x).some(f => f.area === 'MARXY-16'));
});

test('nothing ready behind live work is waiting, not a failure', () => {
  const x = base({
    inflight: [{ key: 'MARXY-16', verdict: 'live', why: 'worker pid 7 running' }],
    ready: { ready: [], blockedByPaths: ['MARXY-44'], blockedByDeps: [], blockedByLanes: [] },
    holders: { 'MARXY-44': ['MARXY-16 (in_progress)'] },
  });
  assert.deepEqual(fails(x), []);
});

test('a quiet story is a failure with a command for a person, not --fix', () => {
  const x = base({ inflight: [{ key: 'MARXY-5', verdict: 'quiet', why: 'no lease; quiet 200 min; left 1 commit(s)', rec: { worktree: '../marxy-wt/MARXY-5' } }] });
  const f = fails(x).find(g => g.area === 'MARXY-5');
  assert.match(f.fix, /state\.mjs return MARXY-5/);
});

test('a loop that is gone leaves a lease: named, with the command that restarts it', () => {
  const f = diagnose(base({ loop: { lease: { pid: 3 }, held: false } })).find(g => g.area === 'loop');
  assert.equal(f.level, 'warn');
  assert.equal(f.fix, './orchestration/loop.sh start');
});

test('a running loop whose status.md stopped moving has a hung cycle', () => {
  assert.ok(fails(base({ statusAgeMinutes: 90 })).some(f => f.area === 'loop'));
});

test('a cycle lock with a dead holder is named for --fix', () => {
  const f = diagnose(base({ cycle: { lease: { pid: 3 }, held: false } })).find(g => g.area === 'cycle');
  assert.equal(f.fix, 'node orchestration/doctor.mjs --fix');
});

test('an orchestrator checkout off main or diverged is a failure; behind alone is not', () => {
  assert.ok(fails(base({ main: { branch: 'fix/x', ahead: 0, behind: 0 } })).some(f => f.area === 'checkout'));
  assert.ok(fails(base({ main: { branch: 'main', ahead: 2, behind: 1 } })).some(f => f.area === 'checkout'));
  assert.deepEqual(fails(base({ main: { branch: 'main', ahead: 0, behind: 3 } })), []);
});

test('uncommitted board files on main hold dispatch, and the fix is board-park; off main it is not', () => {
  const dirty = fails(base({ main: { branch: 'main', ahead: 0, behind: 0, dirtyBoard: ['orchestration/ready.mjs', 'orchestration/worktrees.mjs'] } }));
  const hit = dirty.find(f => f.fix === 'node orchestration/board-park.mjs');
  assert.ok(hit);
  assert.match(hit.msg, /orchestration\/ready\.mjs, orchestration\/worktrees\.mjs hold dispatch/);
  const off = fails(base({ main: { branch: 'fix/x', ahead: 0, behind: 0, dirtyBoard: ['orchestration/ready.mjs'] } }));
  assert.ok(off.some(f => /switch main/.test(f.fix)));
  assert.ok(!off.some(f => f.fix === 'node orchestration/board-park.mjs'));
});

test('a planner that failed to authenticate is a failure with the login command', () => {
  const f = fails(base({ planner: { lease: { pid: 2 }, held: false, authFailure: true } }));
  assert.equal(f[0].fix, 'cursor-agent login');
});
