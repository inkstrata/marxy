import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, tableRows, age } from './dashboard.mjs';

const now = '2026-11-28T18:00:00Z';
const todo = [
  '## Waiting on Ian', '', '| # | What | Where |', '| --- | --- | --- |',
  `| R2 | ${'x'.repeat(150)} | GitHub |`, '', '## Later',
].join('\n');

const fixture = {
  now,
  queue: {
    week: '2026-11-27',
    rows: tableRows('## Queue\n\n| # | Rows | Piece | Size | Branch |\n| --- | --- | --- | --- | --- |\n| 1 | F1 | Alpha | S | `alpha` |\n| 2 | F2 | Beta | M | `beta` |\n| 3 | F3 | Gamma | L | `gamma` |\n', 'Queue'),
  },
  prs: [
    { number: 50, title: 'Beta work', headRefName: 'agent/beta', merge: false, reasons: ['no approval of the current head'] },
    { number: 51, title: 'Docs', headRefName: 'agent/docs', merge: false, reasons: ['waits for the owner: CODEOWNERS paths docs/a.md'] },
  ],
  merged: [
    { number: 40, title: 'Alpha landed', headRefName: 'agent/alpha', mergedAt: '2026-11-28T10:00:00Z' },
    { number: 39, title: 'Old', headRefName: 'agent/old', mergedAt: '2026-11-10T10:00:00Z' },
  ],
  waitingOnOwner: tableRows(todo, 'Waiting on Ian'),
  ci: { conclusion: 'success', createdAt: '2026-11-28T15:00:00Z' },
  devices: {
    windows: { os: 'windows', finishedAt: '2026-11-28T14:30:00Z', install: { ok: true }, verify: { ok: false }, reruns: [{ file: 'a', verdict: 'real' }, { file: 'b', verdict: 'load' }] },
    macos: { os: 'macos', finishedAt: '2026-11-28T16:00:00Z', install: { ok: true }, slept: true },
  },
  usage: { at: '2026-11-28T17:30:00Z', usage: { fiveHour: { pct: 12 }, weekly: { pct: 41.25 }, fable: { pct: 3 } } },
  budget: { autoPct: 6, ownerPct: 35.25, totalPct: 41.25 },
  jobs: [{ id: 'night', kind: 'agent', when: '20 0 * * *' }, { id: 'tick', kind: 'script', when: '*/30 * * * *' }],
};

test('render lays out the sections in order with live queue state', () => {
  const md = render(fixture);
  const order = ['# Marxy dashboard', '## Next up', '## Changelog', '## Waiting for you', '## Health', '## Budget'].map((h) => md.indexOf(h));
  assert.ok(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1])), 'sections in order');
  assert.match(md, /Week of 2026-11-27/);
  assert.match(md, /Alpha \(S\): merged #40/);
  assert.match(md, /Beta \(M\): PR #50 open \(no approval/);
  assert.match(md, /Gamma \(L\): not started/);
  assert.match(md, /\*\*2026-11-28\*\*\n- #40 Alpha landed/);
  assert.doesNotMatch(md, /#39 Old/);
  assert.match(md, /PR #51 Docs: waits for the owner/);
  assert.match(md, /- R2 x{90,100}\.\.\./);
  assert.ok(md.includes('- macos: inconclusive (slept)'));
  assert.ok(md.includes('- windows: ok, verify failed (1 real reds)'));
  assert.match(md, /- linux: no data yet/);
  assert.match(md, /automation this week: 6%/);
  assert.doesNotMatch(md, /41\.\d*%/, 'the owner\'s weekly meter stays off the public issue');
  assert.doesNotMatch(md, /owner 35/, 'the owner\'s share stays off the public issue');
  assert.match(md, /night 20 0 \* \* \*/);
  assert.doesNotMatch(md, /tick/);
});

test('render tolerates missing data', () => {
  const md = render({ now, prs: [], merged: [], queue: null, jobs: [] });
  assert.match(md, /Week of no plan yet/);
  assert.match(md, /## Next up\nnone/);
  assert.match(md, /## Changelog\nnone/);
  assert.match(md, /## Waiting for you\nnone/);
  assert.match(md, /- windows: no data yet/);
  assert.match(md, /last usage reading: none yet/);
});

test('age words', () => {
  assert.equal(age('2026-11-28T17:30:00Z', now), '30m');
  assert.equal(age('2026-11-28T12:00:00Z', now), '6h');
  assert.equal(age('2026-11-20T12:00:00Z', now), '8d');
  assert.equal(age(null, now), 'no data');
});
