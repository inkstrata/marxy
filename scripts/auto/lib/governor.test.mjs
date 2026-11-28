import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, slotsUntilReset, fromGetUsage, localParts, zonedTime } from './governor.mjs';
import { withPresence } from './presence.mjs';

// Late November 2026 is standard time in Los Angeles, UTC-8. 24 Nov is a Tuesday, 26 a Thursday,
// 27 a Friday, 28 a Saturday.
const la = (s) => new Date(`${s}-08:00`);
const iso = (s) => la(s).toISOString();
const usage = ({ five = 0, resets = null, weekly = 10 } = {}) => ({
  fiveHour: { pct: five, resetsAt: resets }, weekly: { pct: weekly, resetsAt: null }, fable: { pct: 0 },
});

test('zone helpers read and build Los Angeles wall time', () => {
  const p = localParts(la('2026-11-24T09:30:00'));
  assert.deepEqual([p.hour, p.minute, p.weekday], [9, 30, 2]);
  assert.equal(zonedTime(2026, 11, 24, 14, 0).toISOString(), iso('2026-11-24T14:00:00'));
  // Across the March change the offset is still right.
  assert.equal(zonedTime(2026, 3, 9, 14, 0).toISOString(), '2026-03-09T21:00:00.000Z');
});

const cases = [
  { name: 'owner window at 15:00', now: '2026-11-24T15:00:00', usage: usage(), want: { allowed: false, reason: 'owner window' } },
  { name: 'new block at 09:30 would end 14:30', now: '2026-11-24T09:30:00', usage: usage(),
    want: { allowed: false, reason: 'a new block would reach the owner window' } },
  { name: 'active block ending 13:50 stops there', now: '2026-11-24T10:00:00',
    usage: usage({ five: 20, resets: iso('2026-11-24T13:50:00') }),
    want: { allowed: true, stopAt: iso('2026-11-24T13:50:00') } },
  { name: 'active block ending 08:00 leaves room for one more', now: '2026-11-24T05:00:00',
    usage: usage({ five: 20, resets: iso('2026-11-24T08:00:00') }),
    want: { allowed: true, stopAt: iso('2026-11-24T14:00:00') } },
  { name: 'active block ending 15:00', now: '2026-11-24T10:00:00',
    usage: usage({ five: 20, resets: iso('2026-11-24T15:00:00') }),
    want: { allowed: false, reason: 'block reaches the owner window' } },
  { name: 'after midnight a block ending before 14:00 is fine', now: '2026-11-24T00:20:00', usage: usage(),
    want: { allowed: true, stopAt: iso('2026-11-24T14:00:00'), noNewAgents: false } },
  { name: '5-hour soft', now: '2026-11-24T00:20:00', usage: usage({ five: 76, resets: iso('2026-11-24T03:00:00') }),
    want: { allowed: true, noNewAgents: true } },
  { name: '5-hour hard', now: '2026-11-24T00:20:00', usage: usage({ five: 85, resets: iso('2026-11-24T03:00:00') }),
    want: { allowed: false, reason: '5-hour hard stop' } },
  { name: 'Saturday night share', now: '2026-11-28T00:20:00', usage: usage({ weekly: 2 }), owner: 2,
    want: { allowed: true, sweep: false, reservePct: 58, headroomPct: 40, allowancePct: Math.round((40 / 14) * 10) / 10 } },
  { name: 'unknown owner usage counts as none, keeping the whole share in reserve', now: '2026-11-28T00:20:00', usage: usage({ weekly: 30 }),
    want: { reservePct: 60, headroomPct: 10 } },
  { name: 'Thursday sweep', now: '2026-11-26T01:00:00', usage: usage({ weekly: 20 }), owner: 10,
    want: { allowed: true, sweep: true, reservePct: 30, headroomPct: 50, allowancePct: 50 } },
  { name: 'Friday sweep', now: '2026-11-27T09:00:00', usage: usage({ weekly: 40 }), owner: 30,
    want: { allowed: true, sweep: true, reservePct: 15, headroomPct: 45, allowancePct: 45 } },
  { name: 'no headroom', now: '2026-11-24T00:20:00', usage: usage({ weekly: 90 }),
    want: { allowed: false, reason: 'weekly reserve', reservePct: 60, headroomPct: -50 } },
  { name: 'blind still keeps the window', now: '2026-11-24T16:00:00', usage: null,
    want: { allowed: false, reason: 'owner window', blind: true } },
  { name: 'blind refuses a block into the window', now: '2026-11-24T10:00:00', usage: null,
    want: { allowed: false, blind: true } },
  { name: 'blind runs under caps', now: '2026-11-24T00:20:00', usage: null,
    want: { allowed: true, blind: true, allowancePct: null, stopAt: iso('2026-11-24T03:20:00') } },
];

// The research queue's "run now" profile: any hour, a 60/70 five-hour line, three hours at most.
const now = (c) => decide({ now: la('2026-11-24T15:00:00'), usage: usage({ five: c, resets: iso('2026-11-24T17:00:00') }), profile: 'research-now' });
test('research-now runs in the owner window while the five-hour meter is low', () => {
  const d = now(20);
  assert.equal(d.allowed, true);
  assert.equal(d.noNewAgents, false);
  assert.equal(d.stopAt, iso('2026-11-24T18:00:00'));
  assert.equal(decide({ now: la('2026-11-24T15:00:00'), usage: usage(), profile: 'night' }).reason, 'owner window');
});
test('research-now with no usage reading is refused', () => {
  const d = decide({ now: la('2026-11-24T15:00:00'), usage: null, profile: 'research-now' });
  assert.deepEqual([d.allowed, d.reason], [false, 'research-now needs a usage reading']);
});
test('research-now has a 60 and 70 line', () => {
  assert.equal(now(59).noNewAgents, false);
  assert.equal(now(61).noNewAgents, true);
  assert.deepEqual([now(71).allowed, now(71).reason], [false, '5-hour hard stop']);
});
test('research-now keeps the weekly reserve, and an unknown profile is the default', () => {
  assert.equal(decide({ now: la('2026-11-24T15:00:00'), usage: usage({ weekly: 90 }), profile: 'research-now' }).reason, 'weekly reserve');
  assert.equal(decide({ now: la('2026-11-24T00:20:00'), usage: usage({ five: 76 }), profile: 'whatever' }).noNewAgents, true);
});

for (const c of cases) {
  test(`decide: ${c.name}`, () => {
    const d = decide({ now: la(c.now), usage: c.usage, ownerUsedPct: c.owner ?? null });
    assert.deepEqual(Object.keys(d).sort(),
      ['allowancePct', 'allowed', 'blind', 'headroomPct', 'noNewAgents', 'reason', 'reservePct', 'stopAt', 'sweep']);
    for (const [k, v] of Object.entries(c.want)) assert.deepEqual(d[k], v, k);
    if (c.usage === null && d.allowed) assert.match(d.reason, /2 builders for 3 hours/);
  });
}

test('slotsUntilReset counts slots up to Friday 14:00', () => {
  assert.equal(slotsUntilReset(la('2026-11-28T00:20:00')), 14);
  assert.equal(slotsUntilReset(la('2026-11-28T03:00:00')), 14, 'a slot begun within three hours still counts');
  assert.equal(slotsUntilReset(la('2026-11-28T04:00:00')), 13);
  assert.equal(slotsUntilReset(la('2026-11-27T09:00:00')), 1);
  assert.equal(slotsUntilReset(la('2026-11-27T16:00:00')), 1, 'never below one');
  assert.equal(slotsUntilReset(la('2026-11-27T21:00:00')), 14, 'after the reset the next week counts');
});

test('fromGetUsage reads the plan windows', () => {
  const u = fromGetUsage({ windows: [
    { label: '5-hour limit', percentUsed: 12, resetsAt: '2026-11-24T11:00:00Z' },
    { label: 'Weekly · All Models', percentUsed: 33, resetsAt: null },
    { label: 'Weekly · Fable', percentUsed: 4, resetsAt: null },
  ] });
  assert.deepEqual(u, {
    fiveHour: { pct: 12, resetsAt: '2026-11-24T11:00:00Z' }, weekly: { pct: 33, resetsAt: null }, fable: { pct: 4 },
  });
  assert.equal(fromGetUsage(null), null);
  assert.equal(fromGetUsage({ windows: [{ label: '5-hour limit', percentUsed: 1 }] }), null);
});

// Friday 27 Nov 14:00 to 20:00 is the final sweep: no owner window, a 75/90 five-hour line, a flat 2% weekly reserve.
const fri = (t, u, profile) => decide({ now: la(`2026-11-27T${t}`), usage: u, profile });
test('final sweep: the five-hour line is 75 soft and 90 hard', () => {
  const ok = fri('15:00:00', usage({ five: 80, resets: iso('2026-11-27T18:00:00') }));
  assert.deepEqual([ok.allowed, ok.noNewAgents, ok.finalSweep], [true, true, true]);
  assert.equal(fri('15:00:00', usage({ five: 74, resets: iso('2026-11-27T18:00:00') })).noNewAgents, false);
  const hard = fri('15:00:00', usage({ five: 90, resets: iso('2026-11-27T18:00:00') }));
  assert.deepEqual([hard.allowed, hard.reason], [false, '5-hour hard stop']);
  // 85 is the hard line on other days; in the final sweep it only stops new agents.
  const at85 = fri('15:00:00', usage({ five: 85, resets: iso('2026-11-27T18:00:00') }));
  assert.deepEqual([at85.allowed, at85.noNewAgents], [true, true]);
  assert.equal(fri('15:00:00', usage({ five: 89.9, resets: iso('2026-11-27T18:00:00') })).allowed, true);
});
test('final sweep: nothing starts from the 19:55 stop until the reset', () => {
  assert.equal(fri('19:54:00', usage({ weekly: 40 })).allowed, true);
  for (const t of ['19:55:00', '19:59:00']) {
    const d = fri(t, usage({ weekly: 40 }));
    assert.deepEqual([d.allowed, d.reason, d.finalSweep], [false, 'final sweep has ended', true], t);
  }
  const next = fri('20:00:00', usage({ weekly: 5 }));
  assert.deepEqual([next.finalSweep, next.reason], [undefined, 'owner window']);
});
test('final sweep: a flat 2% reserve, and nothing at 98% weekly', () => {
  const d = fri('15:00:00', usage({ weekly: 50 }));
  assert.deepEqual([d.allowed, d.allowancePct, d.reservePct, d.stopAt, d.reason],
    [true, 48, 2, iso('2026-11-27T19:55:00'), 'final sweep: spend what is left before the 20:00 reset']);
  assert.equal(fri('15:00:00', usage({ weekly: 98 })).allowed, false);
  assert.equal(fri('15:00:00', usage({ weekly: 99 })).reason, 'weekly reserve');
});
test('final sweep starts at 14:00 sharp and the new week starts at 20:00', () => {
  // Before 14:00 the old rules still hold: here a fresh block would run into the owner's window.
  const before = fri('13:59:00', usage({ weekly: 40 }));
  assert.deepEqual([before.finalSweep, before.reason], [undefined, 'a new block would reach the owner window']);
  const sweep = fri('13:00:00', usage({ five: 20, resets: iso('2026-11-27T13:30:00'), weekly: 40 }));
  assert.deepEqual([sweep.sweep, sweep.finalSweep, sweep.allowed], [true, undefined, true]);
  assert.equal(fri('14:00:00', usage({ weekly: 40 })).finalSweep, true);
  const after = fri('20:00:00', usage({ weekly: 5 }));
  assert.deepEqual([after.finalSweep, after.reason], [undefined, 'owner window']);
});
test('final sweep without a usage reading is refused', () => {
  const d = fri('15:00:00', null);
  assert.deepEqual([d.allowed, d.reason, d.blind], [false, 'final sweep needs a usage reading', true]);
});
test('final sweep: research-now follows the same caps', () => {
  const d = fri('15:00:00', usage({ five: 80, resets: iso('2026-11-27T18:00:00') }), 'research-now');
  assert.deepEqual([d.allowed, d.noNewAgents, d.stopAt], [true, true, iso('2026-11-27T19:55:00')]);
  assert.equal(fri('15:00:00', usage({ five: 65 }), 'research-now').noNewAgents, false);
  assert.equal(fri('15:00:00', usage({ five: 90 }), 'research-now').allowed, false);
});
test('final sweep: a research-now decision with the owner at the machine', () => {
  const busy = { busy: true, why: ['input 1 min ago'] };
  const d = withPresence(fri('15:00:00', usage({ five: 50, weekly: 40 }), 'research-now'), busy, 'research-now');
  assert.deepEqual([d.allowed, d.finalSweep, d.lightOnly, d.noNewAgents, d.allowancePct, d.stopAt],
    [true, true, undefined, false, 58, iso('2026-11-27T19:55:00')]);
  const night = withPresence(fri('15:00:00', usage({ five: 50, weekly: 40 }), 'night'), busy, 'night');
  assert.deepEqual([night.allowed, night.lightOnly], [true, true]);
  const late = withPresence(fri('19:56:00', usage({ five: 50, weekly: 40 }), 'research-now'), busy, 'research-now');
  assert.deepEqual([late.allowed, late.reason], [false, 'final sweep has ended']);
});
test('slotsUntilReset stays at one through the final sweep', () => {
  for (const t of ['14:00:00', '19:59:00']) assert.equal(slotsUntilReset(la(`2026-11-27T${t}`)), 1);
});
