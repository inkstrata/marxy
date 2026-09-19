// Fixture-driven checks for plannerReasons: which signals fire, and which stop firing once
// the planner has already ruled (MARXY-120).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannerReasons } from './planner-trigger.mjs';

const M = { plannerEveryMerges: 5, plannerEveryDays: 7 };
const NOW = Date.parse('2026-02-01T00:00:00Z');
const NO_DEPS = { phases: {}, deps: {} };

/** `n` finished stories, S0 oldest .. S(n-1) most recent, none in a numbered phase. */
function finishedStories(n) {
  const stories = {};
  for (let i = 0; i < n; i++) {
    stories[`S${i}`] = { status: 'done', attempts: 1, finished: new Date(2026, 0, i + 1).toISOString() };
  }
  return stories;
}

test('fires and names the counts: 6 of the last 10 merges were ops', () => {
  const stories = finishedStories(10);
  const d = { phases: { 0: ['S6', 'S7', 'S8', 'S9'] }, deps: {} }; // S0..S5 unlisted → ops
  const s = { lastPlan: new Date(2026, 0, 20).toISOString(), merges: 0, mergesAtLastPlan: 0, stories };
  const reasons = plannerReasons({ s, m: M, all: [], d, now: NOW });
  assert.ok(reasons.includes('6 of the last 10 merges were ops'));
});

test('does not fire at 5 of the last 10', () => {
  const stories = finishedStories(10);
  const d = { phases: { 0: ['S5', 'S6', 'S7', 'S8', 'S9'] }, deps: {} }; // S0..S4 ops = 5
  const s = { lastPlan: new Date(2026, 0, 20).toISOString(), merges: 0, mergesAtLastPlan: 0, stories };
  const reasons = plannerReasons({ s, m: M, all: [], d, now: NOW });
  assert.ok(!reasons.some(r => /merges were ops/.test(r)));
});

test('does not fire with fewer than 10 finished stories', () => {
  const stories = finishedStories(9); // none in any phase: all would count as ops if the window were met
  const s = { lastPlan: new Date(2026, 0, 20).toISOString(), merges: 0, mergesAtLastPlan: 0, stories };
  const reasons = plannerReasons({ s, m: M, all: [], d: NO_DEPS, now: NOW });
  assert.ok(!reasons.some(r => /merges were ops/.test(r)));
});

test('only the 10 most recently finished count toward the window', () => {
  const stories = finishedStories(11); // S0 is the 11th-most-recent and falls out of the window
  const d = { phases: { 0: ['S1', 'S2', 'S3', 'S4', 'S5'] }, deps: {} }; // S6..S10 ops = 5, S0 (ops, excluded) would make 6
  const s = { lastPlan: new Date(2026, 0, 20).toISOString(), merges: 0, mergesAtLastPlan: 0, stories };
  const reasons = plannerReasons({ s, m: M, all: [], d, now: NOW });
  assert.ok(!reasons.some(r => /merges were ops/.test(r)), 'S0 sits outside the 10-story window');
});

test('blocked with blockedAt before lastPlan: no escalated/blocked reason', () => {
  const s = {
    lastPlan: new Date(2026, 0, 10).toISOString(),
    merges: 0,
    mergesAtLastPlan: 0,
    stories: { X: { status: 'blocked', blockedAt: new Date(2026, 0, 5).toISOString() } },
  };
  const reasons = plannerReasons({ s, m: M, all: [], d: NO_DEPS, now: NOW });
  assert.ok(!reasons.some(r => /escalated\/blocked/.test(r)));
});

test('escalated with blockedAt after lastPlan: the reason names the key', () => {
  const s = {
    lastPlan: new Date(2026, 0, 5).toISOString(),
    merges: 0,
    mergesAtLastPlan: 0,
    stories: { X: { status: 'escalate', blockedAt: new Date(2026, 0, 10).toISOString() } },
  };
  const reasons = plannerReasons({ s, m: M, all: [], d: NO_DEPS, now: NOW });
  assert.ok(reasons.includes('escalated/blocked: X'));
});

test('blocked with no blockedAt still names the key, so nothing is silently dropped', () => {
  const s = {
    lastPlan: new Date(2026, 0, 5).toISOString(),
    merges: 0,
    mergesAtLastPlan: 0,
    stories: { X: { status: 'blocked' } },
  };
  const reasons = plannerReasons({ s, m: M, all: [], d: NO_DEPS, now: NOW });
  assert.ok(reasons.includes('escalated/blocked: X'));
});

test('never-planned still fires exactly as before', () => {
  const s = { lastPlan: null, merges: 0, mergesAtLastPlan: 0, stories: {} };
  const reasons = plannerReasons({ s, m: M, all: [], d: NO_DEPS, now: NOW });
  assert.deepEqual(reasons, ['never planned']);
});

test('the merge-count trigger still fires at its threshold, unchanged', () => {
  const s = { lastPlan: new Date(2026, 0, 1).toISOString(), merges: 5, mergesAtLastPlan: 0, stories: {} };
  const reasons = plannerReasons({ s, m: M, all: [], d: NO_DEPS, now: Date.parse('2026-01-01T00:00:00Z') });
  assert.deepEqual(reasons, ['5 merges since last plan']);
});

test('the weekly-age trigger still fires at its threshold, unchanged', () => {
  const lastPlan = new Date('2026-01-01T00:00:00Z').toISOString();
  const now = Date.parse('2026-01-08T00:00:00Z'); // exactly plannerEveryDays later
  const s = { lastPlan, merges: 0, mergesAtLastPlan: 0, stories: {} };
  const reasons = plannerReasons({ s, m: M, all: [], d: NO_DEPS, now });
  assert.deepEqual(reasons, ['plan older than a week']);
});
