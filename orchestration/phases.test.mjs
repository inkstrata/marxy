// The ops lane and the phase rules the committed board must keep (MARXY-107).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stories, deps, phaseOf, earlierPhaseOpen } from './lib.mjs';
import { selectReady } from './ready.mjs';
import { plannerReasons } from './planner-trigger.mjs';

const story = (Key, Paths, Labels = '') => ({ Key, Type: 'Story', Summary: Key, Paths, Labels, Acceptance: 'a check' });
const board = statuses => ({ stories: Object.fromEntries(Object.entries(statuses).map(([k, status]) => [k, { status, attempts: 0 }])) });

test('an ops story is never phase-blocked and never holds a numbered phase', () => {
  const d = { phases: { 0: ['A'], 1: ['B'], ops: ['C'] }, deps: {} };
  const all = [story('A', 'a'), story('B', 'b'), story('C', 'c')];
  assert.equal(earlierPhaseOpen(phaseOf('C', d), d, board({ A: 'todo', C: 'todo' })), false);
  const open = selectReady({ all, d, s: board({ A: 'todo', B: 'todo', C: 'todo' }), cap: Infinity });
  assert.deepEqual(open.ready.map(r => r.key).sort(), ['A', 'C'], 'phase 0 open: B waits, the ops story does not');
  const closed = selectReady({ all, d, s: board({ A: 'done', B: 'todo', C: 'todo' }), cap: Infinity });
  assert.deepEqual(closed.ready.map(r => r.key).sort(), ['B', 'C'], 'an open ops story does not hold phase 1');
});

const d = deps();
const csv = stories().filter(s => s.Type === 'Story');

test('the committed board: every story is in exactly one phase', () => {
  const seen = {};
  for (const [p, keys] of Object.entries(d.phases)) for (const k of keys) (seen[k] ??= []).push(p);
  assert.deepEqual(csv.filter(s => !seen[s.Key]).map(s => s.Key), [], 'stories with no phase');
  assert.deepEqual(Object.entries(seen).filter(([, v]) => v.length > 1), [], 'stories in more than one phase');
  assert.deepEqual(Object.keys(seen).filter(k => !csv.some(s => s.Key === k)), [], 'phase entries with no CSV row');
});

test('the committed board: no story depends on a story in a later numbered phase', () => {
  const bad = [];
  for (const [k, ds] of Object.entries(d.deps)) {
    for (const x of ds) {
      const [a, b] = [phaseOf(k, d), phaseOf(x, d)];
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) bad.push(`${k} (phase ${a}) → ${x} (phase ${b})`);
    }
  }
  assert.deepEqual(bad, [], 'a later-phase dependency can never be satisfied: the phase rule holds it until the earlier phase closes');
});

test('the committed board: Phase 1 opens while ops work is still todo', () => {
  // The board as merged on 2026-09-19: Phase 0 done, and these later-phase stories landed early.
  const merged = new Set([...(d.phases[0] ?? []), 'MARXY-19', 'MARXY-29', 'MARXY-34', 'MARXY-35', 'MARXY-64', 'MARXY-67', 'MARXY-68', 'MARXY-72', 'MARXY-73']);
  const statuses = Object.fromEntries(csv.map(s => [s.Key, merged.has(s.Key) ? 'done' : 'todo']));
  const r = selectReady({ all: csv, d, s: board(statuses), cap: Infinity });
  assert.ok(r.ready.some(x => x.key === 'MARXY-75'), 'MARXY-75 is offered');
  assert.ok(r.ready.some(x => (d.phases.ops ?? []).includes(x.key)), 'ops stories are offered alongside');
  assert.ok(r.blockedByDeps.includes('MARXY-20'), 'MARXY-20 waits on MARXY-75, by dependency and not by phase');
  const after = selectReady({ all: csv, d, s: board({ ...statuses, 'MARXY-75': 'done' }), cap: Infinity });
  assert.ok(after.ready.some(x => x.key === 'MARXY-20'), 'MARXY-20 is offered once MARXY-75 is done, ahead of any ops story on its paths');
});

test('a phase story takes a contested path ahead of an ops story', () => {
  const d2 = { phases: { 1: ['P'], ops: ['O'] }, deps: {} };
  const r = selectReady({ all: [story('O', 'packages/theme/package.json'), story('P', 'packages/theme')], d: d2, s: board({ O: 'todo', P: 'todo' }), cap: Infinity });
  assert.deepEqual(r.ready.map(x => x.key), ['P']);
  assert.deepEqual(r.blockedByPaths, ['O']);
});

test('the planner is not kept due by a dropped or human-gated story', () => {
  const m = { plannerEveryMerges: 5, plannerEveryDays: 7 };
  const s = { lastPlan: new Date(0).toISOString(), merges: 0, mergesAtLastPlan: 0, stories: { X: { status: 'blocked' }, Y: { status: 'blocked' }, Z: { status: 'escalate' } } };
  const all = [story('X', 'x', 'ops,dropped'), story('Y', 'y', 'human-gated'), story('Z', 'z')];
  const reasons = plannerReasons({ s, m, all, now: 1000 });
  assert.deepEqual(reasons, ['escalated/blocked: Z']);
});
