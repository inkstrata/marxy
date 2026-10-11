// Peeking's pure half (W-03): which edge a point rests at, and the dwell with an injected clock. No DOM, no timers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DWELL_MS, EDGE_PX, createDwell, edgeFor, type DwellClock, type PeekEdge } from './peek.ts';

const W = 1000;
const H = 700;

test('the bands: left is the sidebar, right the inspector, top the toolbar, and 8 px is the width of each', () => {
  assert.equal(EDGE_PX, 8);
  assert.equal(edgeFor(0, 300, W, H), 'sidebar');
  assert.equal(edgeFor(7, 300, W, H), 'sidebar');
  assert.equal(edgeFor(8, 300, W, H), null);
  assert.equal(edgeFor(W - 8, 300, W, H), 'inspector');
  assert.equal(edgeFor(W - 9, 300, W, H), null);
  assert.equal(edgeFor(500, 0, W, H), 'toolbar');
  assert.equal(edgeFor(500, 7, W, H), 'toolbar');
  assert.equal(edgeFor(500, 8, W, H), null);
});

test('the side bands win over the top band at a corner, and the bottom never peeks', () => {
  assert.equal(edgeFor(0, 0, W, H), 'sidebar');
  assert.equal(edgeFor(3, 3, W, H), 'sidebar');
  assert.equal(edgeFor(W - 1, 0, W, H), 'inspector');
  assert.equal(edgeFor(500, H - 1, W, H), null);
  assert.equal(edgeFor(0, H - 1, W, H), 'sidebar');
});

test('a point outside the client area is at no edge', () => {
  assert.equal(edgeFor(-1, 300, W, H), null);
  assert.equal(edgeFor(W, 300, W, H), null);
  assert.equal(edgeFor(500, -1, W, H), null);
  assert.equal(edgeFor(500, H, W, H), null);
});

/** A clock that moves only when told: `tick(ms)` runs what has come due, in order. */
function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: DwellClock = {
    set(fn, ms) {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clear(handle) {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    pending: () => timers.size,
    tick(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
  };
}

test('resting 150 ms fires once; 100 ms fires nothing', () => {
  const fired: PeekEdge[] = [];
  const t = fakeClock();
  const dwell = createDwell((edge) => fired.push(edge), DWELL_MS, t.clock);
  dwell.move('toolbar');
  t.tick(100);
  assert.deepEqual(fired, []);
  dwell.move('toolbar'); // the pointer jitters inside the band: the timer is not restarted
  t.tick(50);
  assert.deepEqual(fired, ['toolbar']);
  dwell.move('toolbar');
  t.tick(1000);
  assert.deepEqual(fired, ['toolbar'], 'one stay, one peek');
});

test('leaving the band cancels, and coming back waits the whole delay again', () => {
  const fired: PeekEdge[] = [];
  const t = fakeClock();
  const dwell = createDwell((edge) => fired.push(edge), DWELL_MS, t.clock);
  dwell.move('sidebar');
  t.tick(140);
  dwell.move(null);
  assert.equal(t.pending(), 0);
  t.tick(500);
  assert.deepEqual(fired, []);
  dwell.move('sidebar');
  t.tick(149);
  assert.deepEqual(fired, []);
  t.tick(1);
  assert.deepEqual(fired, ['sidebar']);
});

test('moving from one edge to another restarts the dwell for the new one', () => {
  const fired: PeekEdge[] = [];
  const t = fakeClock();
  const dwell = createDwell((edge) => fired.push(edge), DWELL_MS, t.clock);
  dwell.move('sidebar');
  t.tick(100);
  dwell.move('toolbar');
  t.tick(100);
  assert.deepEqual(fired, []);
  t.tick(50);
  assert.deepEqual(fired, ['toolbar']);
});

test('after a hide the dwell restarts, even with the pointer still in the band', () => {
  const fired: PeekEdge[] = [];
  const t = fakeClock();
  const dwell = createDwell((edge) => fired.push(edge), DWELL_MS, t.clock);
  dwell.move('inspector');
  t.tick(150);
  assert.deepEqual(fired, ['inspector']);
  dwell.reset(); // hidden by the workspace (a dock, a blur)
  dwell.move('inspector');
  t.tick(149);
  assert.equal(fired.length, 1);
  t.tick(1);
  assert.deepEqual(fired, ['inspector', 'inspector']);
});
