// The state machine and the fold (ADR-0034): every non-final status has an owner and a way out,
// and a guarded event that no longer applies is refused, not half-applied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { STATES, TIMING, timing, fold, story, runEvent, boardEvent, returnEvents, occupies, importLegacy, board, commit } from './machine.mjs';

const at = (n = 0) => new Date(Date.UTC(2026, 8, 26, 10, n)).toISOString();
const ev = (e, n) => ({ at: at(n), by: 'test', ...e });

test('every status that is not final names its owner and its way out', () => {
  for (const [status, s] of Object.entries(STATES)) {
    if (s.terminal) continue;
    assert.ok(s.owner, `${status} has an owner`);
    assert.ok(s.exit, `${status} says how it is left`);
  }
  assert.deepEqual(Object.keys(STATES).sort(), ['blocked', 'done', 'escalate', 'in_progress', 'in_review', 'todo']);
});

test('the statuses a person owns are exactly the ones listed under "Needs you"', () => {
  assert.deepEqual(Object.entries(STATES).filter(([, s]) => s.attention).map(([k]) => k).sort(), ['blocked', 'escalate']);
});

test('timing takes models.json overrides by name and ignores nonsense', () => {
  assert.equal(timing({}).attemptMinutes, TIMING.attemptMinutes);
  assert.equal(timing({ attemptMinutes: 30, stallMinutes: -1, reviewLanes: 'x' }).attemptMinutes, 30);
  assert.equal(timing({ stallMinutes: -1 }).stallMinutes, TIMING.stallMinutes);
});

test('a story transition sets status, since and why; increments never go below zero', () => {
  const b = fold([
    ev(story('MARXY-1', { from: 'todo', to: 'in_progress', inc: { attempts: 1 }, set: { run: 'r1' }, why: 'start' }), 1),
    ev(story('MARXY-1', { inc: { attempts: -5 } }), 2),
  ]);
  const rec = b.stories['MARXY-1'];
  assert.equal(rec.status, 'in_progress');
  assert.equal(rec.since, at(1));
  assert.equal(rec.attempts, 0);
  assert.equal(rec.why, 'start');
});

test('a guard that no longer holds is refused and recorded, and changes nothing', () => {
  const b = fold([
    ev(story('MARXY-2', { from: 'todo', to: 'blocked', why: 'parked' }), 1),
    ev(story('MARXY-2', { from: 'todo', to: 'in_progress', set: { run: 'r' }, why: 'dispatch' }), 2),
  ]);
  assert.equal(b.stories['MARXY-2'].status, 'blocked');
  assert.equal(b.stories['MARXY-2'].run, undefined);
  assert.equal(b.rejected.length, 1);
  assert.match(b.rejected[0].why, /expected todo, was blocked/);
});

test('a run that no longer owns its story cannot move it (fencing)', () => {
  const b = fold([
    ev(story('MARXY-3', { from: 'todo', to: 'in_progress', set: { run: 'old' } }), 1),
    ev(story('MARXY-3', { from: 'in_progress', to: 'todo', unset: ['run'], why: 'timed out' }), 2),
    ev(story('MARXY-3', { from: 'todo', to: 'in_progress', set: { run: 'new' } }), 3),
    ev(story('MARXY-3', { ifRun: 'old', to: 'in_review', set: { pr: 9 } }), 4),
  ]);
  assert.equal(b.stories['MARXY-3'].status, 'in_progress');
  assert.equal(b.stories['MARXY-3'].run, 'new');
  assert.match(b.rejected[0].why, /run old no longer owns it/);
});

test('run and board events fold; the planner block merges instead of replacing', () => {
  const b = fold([
    ev(runEvent('r1', { key: 'MARXY-4', role: 'implement', deadline: at(45) }), 1),
    ev(runEvent('r1', { pid: 42 }), 2),
    ev(boardEvent({ planner: { run: 'p1', started: at(3) } }, { merges: 2 }), 3),
    ev(boardEvent({ planner: { run: null, lastEnded: at(4) } }), 4),
  ]);
  assert.deepEqual(b.runs.r1, { id: 'r1', key: 'MARXY-4', role: 'implement', deadline: at(45), pid: 42 });
  assert.equal(b.merges, 2);
  assert.deepEqual(b.planner, { run: null, started: at(3), lastEnded: at(4) });
});

test('an imported state.json keeps every status; in-progress rows become claims that lapse', () => {
  const b = fold([ev({ type: 'imported', board: { merges: 7, lastPlan: at(0), stories: {
    'MARXY-5': { status: 'in_progress', attempts: 1, lease: { pid: 1 } },
    'MARXY-6': { status: 'in_review', pr: 12, attempts: 1 },
  } } }, 0)]);
  assert.equal(b.merges, 7);
  assert.equal(b.stories['MARXY-6'].status, 'in_review');
  assert.equal(b.stories['MARXY-5'].lease, undefined);
  assert.equal(b.stories['MARXY-5'].claim.until, new Date(Date.parse(at(0)) + 2 * 3_600_000).toISOString());
});

test('jira renames move a placeholder row onto its real key', () => {
  const b = fold([ev(story('MARXY-NEW-x', { to: 'todo' }), 1)], { renames: { 'MARXY-NEW-x': 'MARXY-300' } });
  assert.ok(b.stories['MARXY-300']);
  assert.equal(b.stories['MARXY-NEW-x'], undefined);
});

test('occupies: a run or an unexpired claim or In Review; a lapsed claim reserves nothing', () => {
  const now = Date.parse(at(30));
  assert.equal(occupies({ status: 'in_progress', run: 'r' }, { nowMs: now }), true);
  assert.equal(occupies({ status: 'in_progress', claim: { until: at(60) } }, { nowMs: now }), true);
  assert.equal(occupies({ status: 'in_progress', claim: { until: at(10) } }, { nowMs: now }), false);
  assert.equal(occupies({ status: 'in_review' }, { nowMs: now }), true);
  for (const status of ['todo', 'blocked', 'escalate', 'done']) assert.equal(occupies({ status }, { nowMs: now }), false);
});

test('returnEvents: todo while attempts remain, escalate once implementor and escalation tries are spent', () => {
  const t = timing({});
  const [back] = returnEvents('MARXY-7', { attempts: 1 }, { why: 'red: ci', head: 'h', t, now: at(5) });
  assert.equal(back.to, 'todo');
  assert.deepEqual(back.set.returned, { at: at(5), head: 'h', why: 'red: ci' });
  const [spent] = returnEvents('MARXY-7', { attempts: t.maxAttempts + t.escalationAttempts }, { why: 'x', t, now: at(5) });
  assert.equal(spent.to, 'escalate');
  assert.equal(spent.set.blockedAt, at(5));
});

test('the first read in a clone with no log imports the old state.json and its hand-off files, once', () => {
  const home = mkdtempSync(join(tmpdir(), 'marxy-home-'));
  const fleet = mkdtempSync(join(tmpdir(), 'marxy-fleet-'));
  mkdirSync(join(home, 'orchestration', 'results'), { recursive: true });
  writeFileSync(join(home, 'orchestration', 'state.json'), JSON.stringify({ merges: 3, stories: { 'MARXY-8': { status: 'done', attempts: 1 } } }));
  writeFileSync(join(home, 'orchestration', 'results', 'MARXY-8.approved'), 'ok\n');
  writeFileSync(join(home, 'orchestration', 'results', 'loop.log'), 'noise\n');
  const prior = process.env.MARXY_FLEET_DIR;
  process.env.MARXY_FLEET_DIR = fleet;
  try {
    assert.ok(importLegacy({ homes: [home] }));
    const b = board({ renames: {} });
    assert.equal(b.merges, 3);
    assert.equal(b.stories['MARXY-8'].status, 'done');
    assert.ok(existsSync(join(fleet, 'results', 'MARXY-8.approved')));
    assert.ok(!existsSync(join(fleet, 'results', 'loop.log')));
    commit([story('MARXY-8', { why: 'touch' })]);
    assert.equal(board({ renames: {} }).stories['MARXY-8'].why, 'touch');
  } finally {
    if (prior === undefined) delete process.env.MARXY_FLEET_DIR; else process.env.MARXY_FLEET_DIR = prior;
  }
});

test('a malformed event is refused at the door, never written for every reader to skip', async () => {
  const { eventProblem, append } = await import('./store.mjs');
  assert.equal(eventProblem(story('MARXY-1', { to: 'todo' })), null);
  assert.match(eventProblem(story('MARXY-1', { to: 'finished' })), /unknown status/);
  assert.match(eventProblem(story('marxy 1', { to: 'todo' })), /key/);
  assert.match(eventProblem({ type: 'story', key: 'MARXY-1', inc: { attempts: 'one' } }), /non-number/);
  assert.match(eventProblem({ type: 'run', run: '' }), /run id/);
  assert.match(eventProblem({ type: 'nonsense' }), /unknown event type/);
  assert.throws(() => append({ type: 'nonsense' }), /refusing to append a malformed event/);
});

test('under node --test the fleet store is a temporary directory, never the clone\'s real one', async () => {
  const { fleetDir, gitCommonDir } = await import('./store.mjs');
  const prior = process.env.MARXY_FLEET_DIR;
  delete process.env.MARXY_FLEET_DIR;
  try {
    assert.ok(!fleetDir().startsWith(gitCommonDir()), `${fleetDir()} is inside ${gitCommonDir()}`);
  } finally {
    if (prior !== undefined) process.env.MARXY_FLEET_DIR = prior;
  }
});
