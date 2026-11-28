import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSteps, unstartedPieces, readyRows, huntFacts, huntDates, runCounts, needsBuilder, resumable } from './next.mjs';

const base = { huntToday: false, prsNeedingBuilder: [], queueUnstarted: [], readyRows: [], daysSinceHunt: 1, huntsThisWeek: 0, topUpsThisRun: 0, smallHuntsThisRun: 0, weekday: 1, sweep: false, finalSweep: false };
const names = (f) => nextSteps({ ...base, ...f }).map((s) => s.step);
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `R${i}` }));

test('carry-over comes first, then the queue', () => {
  assert.deepEqual(names({ prsNeedingBuilder: [{ number: 1 }], queueUnstarted: [{}, {}, {}] }), ['carry-over', 'queue']);
});

test('a short queue is topped up with at most two rows, once per run', () => {
  const s = nextSteps({ ...base, queueUnstarted: [{}], readyRows: rows(5), daysSinceHunt: 0 });
  assert.deepEqual(s.map((x) => x.step), ['queue', 'top-up']);
  assert.equal(s[1].rows.length, 2);
  assert.ok(!names({ queueUnstarted: [{}], readyRows: rows(5), daysSinceHunt: 0, topUpsThisRun: 1 }).includes('top-up'));
  assert.ok(!names({ queueUnstarted: [{}, {}], readyRows: rows(5) }).includes('top-up'));
});

test('a small hunt needs few ready rows, a quiet hunt record and no earlier one this run', () => {
  assert.deepEqual(names({ readyRows: rows(2), daysSinceHunt: 3 }), ['top-up', 'small-hunt']);
  assert.ok(!names({ readyRows: rows(3), daysSinceHunt: 3 }).includes('small-hunt'));
  assert.ok(!names({ daysSinceHunt: 1 }).includes('small-hunt'));
  assert.ok(!names({ daysSinceHunt: 5, huntsThisWeek: 2 }).includes('small-hunt'));
  assert.ok(!names({ daysSinceHunt: 5, smallHuntsThisRun: 1 }).includes('small-hunt'));
  assert.ok(names({ daysSinceHunt: null }).includes('small-hunt'));
});

test('Tuesday runs the regular hunt, not a small one', () => {
  assert.deepEqual(names({ weekday: 2, daysSinceHunt: 6 }), ['hunt']);
});

test('nothing to do stops with a reason', () => {
  const s = nextSteps(base);
  assert.deepEqual(s.map((x) => x.step), ['stop']);
  assert.match(s[0].reason, /queue empty/);
  assert.match(nextSteps({ ...base, sweep: true })[0].reason, /sweep/);
});

test('unstartedPieces drops pieces with a PR, a merge or a branch', () => {
  const q = [['1', 'a', '', 'S', '`alpha`'], ['2', 'b', '', 'S', '`beta`'], ['3', 'c', '', 'S', '`gamma`'], ['4', 'd', '', 'S', '`delta`']];
  const got = unstartedPieces(q, [{ headRefName: 'agent/alpha' }], [{ headRefName: 'agent/beta' }], ['agent/gamma']);
  assert.deepEqual(got.map((p) => p.branch), ['agent/delta']);
});

test('readyRows takes empty-branch rows from the three sections and skips waiting ones', () => {
  const md = [
    '## Next', '', '| # | What | Why | Size | Branch |', '| --- | --- | --- | --- | --- |',
    '| A1 | plain | why | S | |', '| A2 | taken | why | S | `x` |', '| A3 | waits for A1 | why | S | |', '',
    '## Later', '| # | What | Why | Size | Branch |', '| --- | --- | --- | --- | --- |', '| Z1 | later | w | S | |', '',
    '## Big files', '| # | What | Why | Size | Branch |', '| --- | --- | --- | --- | --- |', '| L1 | after L9 lands | w | S | |', '| L2 | fine | w | M | |',
  ].join('\n');
  assert.deepEqual(readyRows(md).map((r) => r.id), ['A1', 'L2']);
});

test('huntFacts counts from the weekly reset', () => {
  const now = new Date('2026-12-01T20:00:00Z');
  const f = huntFacts(huntDates({ folders: ['2026-11-27-hunt-01', '2026-11-28-hunt-02', '2026-11-20-hunt-00', '2026-11-27-wave-02'] }), now);
  assert.equal(f.daysSinceHunt, 3);
  assert.equal(f.huntsThisWeek, 1);
  assert.equal(huntFacts([], now).daysSinceHunt, null);
});

test('runCounts counts notes after the run start only', () => {
  const r = [
    { event: 'start', run: 'night-1' }, { event: 'note', run: 'night-1', kind: 'top-up' },
    { event: 'start', run: 'night-2' }, { event: 'note', run: 'night-2', kind: 'small-hunt' }, { event: 'note', run: 'night-2', kind: 'state' },
  ];
  assert.deepEqual(runCounts(r, 'night-2'), { topUpsThisRun: 0, smallHuntsThisRun: 1, targetedHuntsThisRun: 0 });
  assert.deepEqual(runCounts(r), { topUpsThisRun: 0, smallHuntsThisRun: 1, targetedHuntsThisRun: 0 });
  assert.deepEqual(runCounts(r, 'night-1'), { topUpsThisRun: 1, smallHuntsThisRun: 0, targetedHuntsThisRun: 0 });
});

test('needsBuilder: changes, red checks, behind or conflicting, but not held', () => {
  const pr = (reasons, head = 'agent/x') => ({ headRefName: head, reasons });
  assert.ok(needsBuilder(pr(['changes requested on the current head'])));
  assert.ok(needsBuilder(pr(['failed checks: ci'])));
  assert.ok(needsBuilder(pr(['merge state is BEHIND, not CLEAN'])));
  assert.ok(!needsBuilder(pr(['failed checks: ci', 'labelled hold'])));
  assert.ok(!needsBuilder(pr(['ci has not passed'])));
  assert.ok(!needsBuilder(pr(['failed checks: ci'], 'feature/x')));
});

test('readyRows ranks data loss, then cause rows by what they cover, then S1 to S3, then tracker order', () => {
  const row = (id, why) => `| ${id} | text | ${why} | S | |`;
  const md = ['## Next', '| # | What | Why | Size | Branch |', '| --- | --- | --- | --- | --- |',
    row('A', 'plain'), row('B', 'S3 odd'), row('C', 'S2 slow'), row('D', 'S1 freeze'), row('E', 'data loss on save'),
    row('F', 'Covers: X-01, X-02; core'), row('G', 'Covers: X-03, X-04, B7; core'), row('H', 'S1 again')].join('\n');
  assert.deepEqual(readyRows(md).map((r) => r.id), ['E', 'G', 'F', 'D', 'H', 'C', 'B', 'A']);
});

test('data loss outranks a cause row, and a one-id Covers row ranks by its severity', () => {
  const row = (id, why) => `| ${id} | text | ${why} | S | |`;
  const md = ['## Next', '| # | What | Why | Size | Branch |', '| --- | --- | --- | --- | --- |',
    row('A', 'S3 plain'), row('B', 'Covers: X-01; S3 core'), row('C', 'S1 freeze'), row('D', 'S2 data loss on save'),
    row('E', 'Covers: X-01, X-02, X-03; core')].join('\n');
  assert.deepEqual(readyRows(md).map((r) => r.id), ['D', 'E', 'C', 'A', 'B']);
});

test('only a named row makes a row wait', () => {
  const row = (id, what) => `| ${id} | ${what} | S2 | S | |`;
  const md = ['## Structure', '| # | What | Why | Size | Branch |', '| --- | --- | --- | --- | --- |',
    row('Q7', 'With E22 the windowed rows move'), row('Q8', 'Fix the drawer after the page opens'), row('Q9', 'waits for L21'),
    row('Q1', 'the parked panel and a held key'), row('Q2', 'after 2 and with the rest')].join('\n');
  assert.deepEqual(readyRows(md).map((r) => r.id), ['Q8', 'Q1', 'Q2']);
});

test('hunts are counted once across notes, open pull requests and folders, by Pacific date', () => {
  const now = new Date('2026-12-02T03:30:00Z'); // still Dec 1 in Pacific
  const dates = huntDates({
    folders: ['2026-11-30-hunt-05'],
    runs: [{ event: 'note', kind: 'hunt', at: '2026-12-01T08:00:00Z' }, { event: 'note', kind: 'top-up', at: '2026-12-01T08:00:00Z' }, { event: 'note', kind: 'small-hunt', at: '2026-11-30T09:00:00Z' }],
    prs: [{ headRefName: 'agent/hunt-06', createdAt: '2026-12-02T01:00:00Z' }, { headRefName: 'agent/other', createdAt: '2026-12-02T01:00:00Z' }],
  });
  assert.deepEqual(dates, ['2026-11-30', '2026-12-01']);
  const f = huntFacts(dates, now);
  assert.equal(f.huntToday, true);
  assert.equal(f.huntsThisWeek, 2);
  assert.ok(!names({ weekday: 2, huntToday: true }).includes('hunt'));
});

test('targeted hunt notes are counted for the run', () => {
  assert.equal(runCounts([{ event: 'start', run: 'r' }, { event: 'note', run: 'r', kind: 'targeted-hunt' }], 'r').targetedHuntsThisRun, 1);
});

test('GitHub unreachable stops everything', () => {
  const s = nextSteps({ ...base, offline: true, queueUnstarted: [{}], readyRows: rows(3) });
  assert.deepEqual(s, [{ step: 'stop', reason: 'GitHub unreachable' }]);
});

test('a saved state resumes only for the same job, young and not ended', () => {
  const state = { at: '2026-12-01T10:00:00Z', job: 'night', run: 'night-1' };
  const now = Date.parse('2026-12-01T12:00:00Z');
  assert.equal(resumable(state, [], 'night', now), state);
  assert.equal(resumable(state, [], 'day', now), null);
  assert.equal(resumable(state, [], 'night', Date.parse('2026-12-01T16:30:00Z')), null);
  assert.equal(resumable(state, [{ event: 'end', run: 'night-1' }], 'night', now), null);
  assert.equal(resumable(null, [], 'night', now), null);
});
