import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtLocalDay, fmtLocalTime } from './canvases.mjs';

test('fmtLocalTime uses local wall clock and names the zone', () => {
  const prev = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    assert.equal(fmtLocalTime('2026-09-24T16:06:00.000Z'), '2026-09-24 09:06 PDT');
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
});

test('fmtLocalDay buckets by local calendar date', () => {
  const prev = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    assert.equal(fmtLocalDay('2026-09-24T06:00:00.000Z'), '2026-09-23');
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
});

test('the canvas folder follows the checkout, the way Cursor names its projects', async () => {
  const { cursorProjectName, defaultCanvasDir } = await import('./canvases.mjs');
  assert.equal(cursorProjectName('/Users/a/Dev/marxy/'), 'Users-a-Dev-marxy');
  assert.equal(defaultCanvasDir('/h', '/Users/a/Dev/marxy/'), '/h/.cursor/projects/Users-a-Dev-marxy/canvases');
});

test('healthBlock reports each lease with whether it is alive, and every in-flight verdict', async () => {
  const { healthBlock } = await import('./canvases.mjs');
  const leases = { 'loop.lease': { pid: 7, started: '2026-09-24T16:00:00.000Z' } };
  const h = healthBlock(
    { inflight: [{ key: 'MARXY-1', verdict: 'ghost', why: 'left nothing', to: 'todo' }], cycleLog: ['a', 'b'] },
    { read: p => leases[p.split('/').pop()] ?? null, held: l => l.pid === 7 },
  );
  assert.equal(h.loop.alive, true);
  assert.equal(h.cycle, null);
  assert.deepEqual(h.inflight, [{ key: 'MARXY-1', verdict: 'ghost', why: 'left nothing', to: 'todo' }]);
  assert.deepEqual(h.lastCycle, ['a', 'b']);
});
