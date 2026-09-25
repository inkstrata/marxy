// in_review occupies listed paths; blocked, escalate and done do not (MARXY-102).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectReady, RULE } from './ready.mjs';

function story(key, paths) {
  return {
    Key: key,
    Summary: key,
    Paths: paths,
    Acceptance: 'observable',
    Labels: 'phase-0',
  };
}

function fixtureState(all, over = {}) {
  const stories = {};
  for (const st of all) stories[st.Key] = { status: 'todo', attempts: 0 };
  for (const [k, v] of Object.entries(over)) stories[k] = { ...stories[k], ...v };
  return { stories };
}

function readyFrom(all, stateOver = {}, cap = Infinity) {
  return selectReady({
    all,
    s: fixtureState(all, stateOver),
    d: { phases: {}, deps: {} },
    cap,
  });
}

const keys = report => report.ready.map(r => r.key);

test('in_review on package.json occupies that path the same way in_progress does', () => {
  const all = [story('MARXY-A', 'package.json'), story('MARXY-B', 'package.json')];
  for (const status of ['in_progress', 'in_review']) {
    const report = readyFrom(all, { 'MARXY-A': { status } });
    assert.ok(report.blockedByPaths.includes('MARXY-B'));
    assert.ok(!keys(report).includes('MARXY-B'));
  }
  const reviewing = readyFrom(all, { 'MARXY-A': { status: 'in_review' } });
  assert.deepEqual(reviewing.inProgress, []);
  const working = readyFrom(all, { 'MARXY-A': { status: 'in_progress' } });
  assert.deepEqual(working.inProgress, ['MARXY-A']);
});

test('in_review on a shared file blocks a todo that also lists another path', () => {
  const all = [
    story('MARXY-A', 'docs/adr/README.md'),
    story('MARXY-B', 'docs/adr/README.md, orchestration/review-order.mjs'),
  ];
  const report = readyFrom(all, { 'MARXY-A': { status: 'in_review' } });
  assert.ok(report.blockedByPaths.includes('MARXY-B'));
  assert.ok(!keys(report).includes('MARXY-B'));
});

test('blocked, escalate and done do not occupy overlapping paths', () => {
  for (const status of ['blocked', 'escalate', 'done']) {
    const all = [
      story('MARXY-36', 'apps/desktop/src/palette'),
      story('MARXY-86', 'apps/desktop/src/palette/session.ts'),
    ];
    const report = readyFrom(all, { 'MARXY-36': { status } });
    assert.ok(keys(report).includes('MARXY-86'), `${status} must not starve MARXY-86`);
    assert.ok(!report.blockedByPaths.includes('MARXY-86'));
  }
});

// MARXY-170: product-over-ops as a reservation. With lanes uncapped the only later exclusion is path
// overlap between stories eligible in the same cycle, and ops paths rarely overlap product paths, so
// the sort alone never protected a product story from an ops story that started first.
function laned(all, phases, deps = {}, stateOver = {}, cap = Infinity) {
  return selectReady({ all, s: fixtureState(all, stateOver), d: { phases, deps }, cap });
}
const product = (key, paths, extra = {}) => ({ ...story(key, paths), ...extra });
const yielded = report => report.excluded.filter(e => e.rule === 'yields to product');

test('an ops story yields to a product story that is itself held back only by a busy path', () => {
  // The 2026-09-20 shape: MARXY-138 (product) waited on a busy path while an ops story took the
  // corpus and the shell paths it needed next.
  const all = [
    story('MARXY-BUSY', 'apps/desktop/src/shell'),
    product('MARXY-P', 'apps/desktop/src/shell, packages/core'),
    story('MARXY-OPS', 'packages/core/goldens'),
  ];
  const r = laned(all, { 1: ['MARXY-BUSY', 'MARXY-P'], ops: ['MARXY-OPS'] }, {}, { 'MARXY-BUSY': { status: 'in_progress' } });
  assert.ok(r.blockedByPaths.includes('MARXY-P'), 'the product story is waiting on the busy path');
  assert.deepEqual(yielded(r), [{ key: 'MARXY-OPS', rule: 'yields to product', to: ['MARXY-P'] }]);
  assert.deepEqual(keys(r), []);
});

test('an ops story yields to a ready product story with an overlapping path, uncapped lanes', () => {
  const all = [product('MARXY-P', 'packages/core, apps/desktop/src-tauri'), story('MARXY-OPS', 'packages/core/goldens')];
  const r = laned(all, { 1: ['MARXY-P'], ops: ['MARXY-OPS'] });
  assert.ok(!keys(r).includes('MARXY-OPS'));
  assert.deepEqual(yielded(r), [{ key: 'MARXY-OPS', rule: 'yields to product', to: ['MARXY-P'] }]);
  assert.ok(r.blockedByPaths.includes('MARXY-OPS'));
  assert.ok(keys(r).includes('MARXY-P'));
});

test('an ops story yields even when the product story is only waiting on work already under way', () => {
  const all = [story('MARXY-DEP', 'scripts/x'), product('MARXY-P', 'packages/core'), story('MARXY-OPS', 'packages/core/goldens')];
  const under = laned(all, { 1: ['MARXY-P'], ops: ['MARXY-DEP', 'MARXY-OPS'] }, { 'MARXY-P': ['MARXY-DEP'] }, { 'MARXY-DEP': { status: 'in_review' } });
  assert.equal(yielded(under).length, 1);
  assert.ok(!keys(under).includes('MARXY-OPS'));
});

test('a product story waiting on a story that has not started reserves nothing, so the ops story it needs is not held', () => {
  const all = [story('MARXY-OPS', 'packages/core/goldens'), product('MARXY-P', 'packages/core')];
  const r = laned(all, { 1: ['MARXY-P'], ops: ['MARXY-OPS'] }, { 'MARXY-P': ['MARXY-OPS'] });
  assert.deepEqual(keys(r), ['MARXY-OPS']);
  assert.deepEqual(yielded(r), []);
});

test('an ops story with paths that never meet a product story is unaffected', () => {
  const all = [product('MARXY-P', 'packages/core'), story('MARXY-OPS', 'orchestration/x, scripts/y')];
  const r = laned(all, { 1: ['MARXY-P'], ops: ['MARXY-OPS'] });
  assert.deepEqual(keys(r).sort(), ['MARXY-OPS', 'MARXY-P']);
});

test('a product story that cannot start for its phase, its gate or a dropped label reserves nothing', () => {
  const later = [product('MARXY-P0', 'apps/x'), product('MARXY-P1', 'packages/core'), story('MARXY-OPS', 'packages/core/g')];
  const phased = laned(later, { 0: ['MARXY-P0'], 1: ['MARXY-P1'], ops: ['MARXY-OPS'] }, { 'MARXY-P0': ['MARXY-NEVER'] });
  assert.deepEqual(yielded(phased), [], 'phase 1 cannot start while phase 0 is open');
  assert.ok(keys(phased).includes('MARXY-OPS'));
  for (const label of ['human-gated', 'dropped']) {
    const all = [product('MARXY-P', 'packages/core', { Labels: `phase-1,${label}` }), story('MARXY-OPS', 'packages/core/g')];
    const r = laned(all, { 1: ['MARXY-P'], ops: ['MARXY-OPS'] });
    assert.deepEqual(yielded(r), [], label);
    assert.deepEqual(keys(r), ['MARXY-OPS'], label);
  }
});

test('product stories still win a lane cap over ops', () => {
  const all = [story('MARXY-OPS', 'orchestration/x'), product('MARXY-P', 'packages/core')];
  const r = laned(all, { 1: ['MARXY-P'], ops: ['MARXY-OPS'] }, {}, {}, 1);
  assert.deepEqual(keys(r), ['MARXY-P']);
  assert.deepEqual(r.blockedByLanes, ['MARXY-OPS']);
});

test('a product story in progress does not also reserve: its busy paths already block ops', () => {
  const all = [product('MARXY-P', 'packages/core'), story('MARXY-OPS', 'packages/core/g')];
  const r = laned(all, { 1: ['MARXY-P'], ops: ['MARXY-OPS'] }, {}, { 'MARXY-P': { status: 'in_progress' } });
  assert.ok(r.blockedByPaths.includes('MARXY-OPS'));
  assert.deepEqual(yielded(r), []);
});

test('a todo story overlapping a worktree claim is blocked and named worktree holds', () => {
  const all = [story('MARXY-193', 'apps/desktop/src/app.ts'), story('MARXY-OTHER', 'scripts/y')];
  const claims = [{ key: 'MARXY-198', paths: ['apps/desktop/src/app.ts'], path: '/wt/198', ahead: 2, dirty: false }];
  const blocked = selectReady({ all, s: fixtureState(all), d: { phases: {}, deps: {} }, claims });
  assert.ok(blocked.blockedByPaths.includes('MARXY-193'));
  assert.deepEqual(blocked.excluded, [{ key: 'MARXY-193', rule: RULE.WORKTREE_HOLDS, by: 'MARXY-198' }]);
  assert.deepEqual(blocked.ready.map(r => r.key), ['MARXY-OTHER']);
});

test('the same board with no worktree claims offers the story', () => {
  const all = [story('MARXY-193', 'apps/desktop/src/app.ts')];
  const open = selectReady({ all, s: fixtureState(all), d: { phases: {}, deps: {} }, claims: [] });
  assert.deepEqual(open.ready.map(r => r.key), ['MARXY-193']);
});

test('a claim whose key is already in_progress does not change ready', () => {
  const all = [story('MARXY-198', 'apps/desktop/src/app.ts'), story('MARXY-193', 'apps/desktop/src/app.ts')];
  const base = selectReady({
    all,
    s: fixtureState(all, { 'MARXY-198': { status: 'in_progress' } }),
    d: { phases: {}, deps: {} },
    claims: [],
  });
  const withClaim = selectReady({
    all,
    s: fixtureState(all, { 'MARXY-198': { status: 'in_progress' } }),
    d: { phases: {}, deps: {} },
    claims: [{ key: 'MARXY-198', paths: ['apps/desktop/src/app.ts'], path: '/wt', ahead: 1, dirty: false }],
  });
  const sansClaims = ({ claims, ...r }) => r;
  assert.deepEqual(sansClaims(withClaim), sansClaims(base));
});

test('a no-dispatch row is never dispatched, and says why (MARXY-190)', () => {
  const all = [{ ...story('MARXY-OOP', 'orchestration/x'), Labels: 'ops,out-of-plan,no-dispatch' }, story('MARXY-S', 'scripts/y')];
  const r = readyFrom(all);
  assert.deepEqual(r.ready.map(x => x.key), ['MARXY-S']);
  assert.deepEqual(r.excluded, [{ key: 'MARXY-OOP', rule: 'no-dispatch' }]);
});
