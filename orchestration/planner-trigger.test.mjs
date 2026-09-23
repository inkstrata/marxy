// Fixture-driven checks for plannerReasons: which signals fire, and which stop firing once
// the planner has already ruled (MARXY-120).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plannerReasons, blocksDispatch } from './planner-trigger.mjs';
import { ROOT } from './lib.mjs';

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

test('docs/roadmap.md tripwire table names the ops-majority signal and what it reopens', () => {
  const roadmap = readFileSync(`${ROOT}docs/roadmap.md`, 'utf8');
  const row = roadmap.split('\n').find(l => /^\|.*ops.*\|.*\|$/i.test(l) && /last 10/i.test(l));
  assert.ok(row, 'tripwire table has a row naming the ops-majority signal');
  assert.match(row, /defers ops stories that do not unblock a phase/);
});

test('the weekly-age trigger still fires at its threshold, unchanged', () => {
  const lastPlan = new Date('2026-01-01T00:00:00Z').toISOString();
  const now = Date.parse('2026-01-08T00:00:00Z'); // exactly plannerEveryDays later
  const s = { lastPlan, merges: 0, mergesAtLastPlan: 0, stories: {} };
  const reasons = plannerReasons({ s, m: M, all: [], d: NO_DEPS, now });
  assert.deepEqual(reasons, ['plan older than a week']);
});

test('a planLanded merge is excluded from the ops-window count entirely, not merely counted as non-ops', () => {
  // 10 finished, none in a numbered phase (all ops), but the most recent is tagged planLanded:
  // excluding it drops the window to 9, below OPS_WINDOW, so the reason must not fire.
  const stories = finishedStories(10);
  stories.S9.planLanded = true;
  const s = { lastPlan: new Date(2026, 0, 20).toISOString(), merges: 0, mergesAtLastPlan: 0, stories };
  const reasons = plannerReasons({ s, m: M, all: [], d: NO_DEPS, now: NOW });
  assert.ok(!reasons.some(r => /merges were ops/.test(r)), 'a planLanded merge must not fill an ops-window slot');
});

test('a planLanded merge does not let an 11th, older ops merge back into the window either', () => {
  // 11 finished; excluding the planLanded one still leaves exactly 10 real merges in the window.
  const stories = finishedStories(11);
  stories.S10.planLanded = true;
  const d = { phases: { 0: ['S1', 'S2', 'S3', 'S4'] }, deps: {} }; // S0, S5..S9 ops = 6 of the 10 counted
  const s = { lastPlan: new Date(2026, 0, 20).toISOString(), merges: 0, mergesAtLastPlan: 0, stories };
  const reasons = plannerReasons({ s, m: M, all: [], d, now: NOW });
  assert.ok(reasons.includes('6 of the last 10 merges were ops'), 'the window still fills from the 10 real merges, not the planLanded one');
});

test('blocksDispatch: never-planned and an unread escalation hold dispatch', () => {
  assert.equal(blocksDispatch(['never planned']), true);
  assert.equal(blocksDispatch(['escalated/blocked: X']), true);
  assert.equal(blocksDispatch(['never planned', '7 merges since last plan']), true);
});

test('blocksDispatch: cadence reasons alone are advisory, not blocking', () => {
  assert.equal(blocksDispatch(['5 merges since last plan']), false);
  assert.equal(blocksDispatch(['plan older than a week']), false);
  assert.equal(blocksDispatch(['6 of the last 10 merges were ops']), false);
  assert.equal(blocksDispatch(['5 merges since last plan', 'plan older than a week']), false);
});

test('blocksDispatch: no reasons means nothing to block', () => {
  assert.equal(blocksDispatch([]), false);
});
