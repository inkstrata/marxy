// The report says who owns every story in flight, lists what a person must do first, and the log
// repeats nothing that has not changed (ADR-0034).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { needsYou, inFlight, renderStatus, changedLines } from './report.mjs';
import { pathHolds } from './observe.mjs';
import { verbEvents } from './state.mjs';
import { fold, timing } from './machine.mjs';

process.env.MARXY_FLEET_DIR ??= mkdtempSync(join(tmpdir(), 'marxy-fleet-report-'));
const AT = '2026-09-26T12:00:00.000Z';
const nowMs = Date.parse(AT);
const board = over => ({ stories: {}, runs: {}, planner: {}, rejected: [], merges: 0, ...over });

test('needs you: gate items first, then blocked and escalated stories with the command that moves them', () => {
  const b = board({ stories: {
    'MARXY-1': { status: 'blocked', parkedReason: 'setup failed twice', blockedAt: '2026-09-26T10:00:00.000Z' },
    'MARXY-2': { status: 'escalate', why: 'attempt 3 exited', blockedAt: '2026-09-25T10:00:00.000Z' },
  } });
  const items = needsYou({ board: b, nowMs, attention: [{ key: 'MARXY-9', why: 'PR #1: CODEOWNERS', gate: true }, { key: 'MARXY-9', why: 'PR #1: CODEOWNERS', gate: true }] });
  assert.deepEqual(items.map(i => i.key), ['MARXY-9', 'MARXY-1', 'MARXY-2']);
  assert.match(items[1].why, /fleet\.mjs unpark MARXY-1/);
  assert.match(items[2].why, /fleet\.mjs retry MARXY-2/);
});

test('in flight names the run, its model, its attempt and when it ends; a review names its hold and age', () => {
  const b = board({
    stories: {
      'MARXY-1': { status: 'in_progress', attempts: 2, run: 'r1' },
      'MARXY-2': { status: 'in_review', pr: 9, hold: { class: 'red', reason: 'red: ci', since: '2026-09-26T11:50:00.000Z' } },
      'MARXY-3': { status: 'in_progress', claim: { by: 'ian', until: '2026-09-26T16:00:00.000Z' } },
    },
    runs: { r1: { role: 'implement', model: 'composer-2.5', started: '2026-09-26T11:30:00.000Z', deadline: '2026-09-26T12:15:00.000Z' } },
  });
  const lines = inFlight({ board: b, nowMs });
  assert.match(lines[0], /MARXY-1.*composer-2\.5 \(attempt 2\).*ends by 12:15Z/);
  assert.match(lines[1], /MARXY-2.*PR #9 — red: red: ci \(10 min\)/);
  assert.match(lines[2], /MARXY-3.*claimed by ian until 16:00Z/);
});

test('status.md carries every section, and every waiting story says why', () => {
  const text = renderStatus({ at: AT, compute: 'default', board: board({ stories: { 'MARXY-5': { status: 'done' } } }), attention: [], lines: ['merged MARXY-5 (PR #3)'],
    ready: { ready: [], waits: { 'MARXY-6': 'waits on MARXY-5', 'MARXY-7': 'waits on MARXY-5' } } });
  for (const h of ['## Needs you', '## In flight', '## Ready to start', '## Waiting (2)', '## This cycle', '## Done (1)']) assert.ok(text.includes(h), h);
  assert.match(text, /MARXY-6, MARXY-7 — waits on MARXY-5/);
});

test('the log gets a heartbeat and only what changed since the last cycle', () => {
  const r = { at: AT, lines: ['a', 'b'], board: board(), ready: { ready: [] } };
  const first = changedLines(null, r, []);
  assert.deepEqual(first.fresh, ['a', 'b']);
  const again = changedLines({ lines: ['a', 'b'], needs: [] }, r, []);
  assert.deepEqual(again.fresh, []);
  assert.match(again.heartbeat, /cycle .*: 0 in flight, 0 need you, 0 ready/);
});

test('path holds: an explicit claim with paths holds; an active worktree holds; an idle one does not', () => {
  const t = timing({});
  const plan = { byKey: new Map([['MARXY-8', { Key: 'MARXY-8', Paths: 'a, b' }]]) };
  const b = board({ stories: { 'MARXY-300': { status: 'in_progress', claim: { by: 'x', until: '2026-09-26T13:00:00.000Z', paths: ['orchestration/x.mjs'] } } } });
  const wt = mins => ({ key: 'MARXY-8', path: '/wt/8', branch: 'feat/MARXY-8-x', dirty: true, ahead: 0, lastActivityMs: nowMs - mins * 60_000 });
  const active = pathHolds({ board: b, plan, worktrees: [wt(5)], t, nowMs, rowOf: () => null });
  assert.deepEqual(active.map(h => h.key), ['MARXY-300', 'MARXY-8']);
  const idle = pathHolds({ board: b, plan, worktrees: [wt(t.activeWorktreeMinutes + 5)], t, nowMs, rowOf: () => null });
  assert.deepEqual(idle.map(h => h.key), ['MARXY-300']);
});

test('state.mjs verbs are the same guarded events fleet.mjs appends', () => {
  const b = fold([], { renames: {} });
  const [start] = verbEvents('start', 'MARXY-1', [], b, { now: AT, t: timing({}) });
  assert.deepEqual([start.from, start.to], ['todo', 'in_progress']);
  assert.ok(start.set.claim.until > AT);
  const [review] = verbEvents('review', 'MARXY-1', ['12'], b, { now: AT });
  assert.deepEqual([review.to, review.set.pr], ['in_review', 12]);
  assert.equal(verbEvents('nonsense', 'MARXY-1', [], b), null);
});
