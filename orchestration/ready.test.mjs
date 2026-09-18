// in_review occupies listed paths; blocked, escalate and done do not (MARXY-102).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectReady } from './ready.mjs';

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
