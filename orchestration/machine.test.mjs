// The state machine and the fold (ADR-0034): every non-final status has an owner and a way out,
// and a guarded event that no longer applies is refused, not half-applied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { implementRole } from './runs.mjs';
import { STATES, TIMING, timing, fold, story, runEvent, boardEvent, returnEvents, reopenEvents, occupies, importLegacy, board, commit } from './machine.mjs';

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

test('models.json: one implementor attempt, then the escalation model once, then escalate (MARXY-326)', () => {
  const t = timing(JSON.parse(readFileSync(new URL('./models.json', import.meta.url), 'utf8')));
  assert.equal(t.maxAttempts, 1);
  assert.equal(t.escalationAttempts, 1);
  assert.equal(implementRole(0, t), 'implementor');
  const [first] = returnEvents('MARXY-7', { attempts: 1 }, { why: 'timeout', t, now: at(5) });
  assert.equal(first.to, 'todo', 'one timed-out attempt is not the end');
  assert.equal(implementRole(1, t), 'implementorEscalation', 'the next dispatch is on the escalation model');
  const [second] = returnEvents('MARXY-7', { attempts: 2 }, { why: 'timeout', t, now: at(9) });
  assert.equal(second.to, 'escalate', 'the escalation attempt failing goes to escalate');
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

test('reopenEvents: a done story goes back to todo with the red run and jobs in returned.why, its PR cleared and its shas kept', () => {
  const t = timing({});
  const reopened = { at: at(5), sha: 'a'.repeat(40), revertSha: 'b'.repeat(40), revertPr: 20, originalPr: 12 };
  const why = 'main went red at aaaaaaa (feat: x (MARXY-1)); ci run https://github.com/inkstrata/marxy/actions/runs/9; failing jobs: fast, browser';
  const done = { type: 'story', key: 'MARXY-1', to: 'done', at: at(0), set: { pr: 12, finished: at(0) }, inc: { attempts: 1 } };
  const b = fold([done, ev(reopenEvents('MARXY-1', fold([done]).stories['MARXY-1'], { why, reopened, t, now: at(5) })[0], 5)]);
  const rec = b.stories['MARXY-1'];
  assert.deepEqual([rec.status, rec.attempts, rec.pr, rec.finished], ['todo', 1, undefined, undefined]);
  assert.equal(rec.returned.why, why);
  assert.match(rec.returned.why, /runs\/9; failing jobs: fast, browser/);
  assert.equal(rec.returned.head, null, 'no PR head, so nothing is adopted as already returned');
  assert.deepEqual(rec.reopened, reopened);
  assert.match(rec.why, /^reverted: /);
  assert.equal(b.rejected.length, 0);
});

test('reopenEvents: attempts are not reset; a spent story escalates, and one nothing dispatches is blocked for a person', () => {
  const t = timing({});
  const args = { why: 'w', reopened: { sha: 'a'.repeat(40) }, t };
  assert.equal(reopenEvents('MARXY-1', { attempts: t.maxAttempts + t.escalationAttempts }, args)[0].to, 'escalate');
  assert.equal(reopenEvents('MARXY-1', { attempts: t.maxAttempts }, args)[0].to, 'todo');
  const blocked = reopenEvents('MARXY-1', { attempts: 1 }, { ...args, dispatchable: false })[0];
  assert.equal(blocked.to, 'blocked');
  assert.match(blocked.set.parkedReason, /a person opens its fix/);
  const moved = fold([{ type: 'story', key: 'MARXY-1', to: 'in_review', at: at(0) }, ev(reopenEvents('MARXY-1', {}, args)[0], 1)]);
  assert.equal(moved.rejected.length, 1, 'only a Done story can be reopened');
});
