// The launch measurement's frame counter (B-08, the B-15 card's note from the B-08 review): a launch
// started right after the last one finished, in one page, counts each frame once. Node, with frames
// run by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Animation frames this test runs: each `frame()` runs the callbacks queued before it. */
let queued: FrameRequestCallback[] = [];
globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
  queued.push(cb);
  return queued.length;
};
function frame(): void {
  const run = queued;
  queued = [];
  for (const cb of run) cb(0);
}

const { createLaunchMeasure } = await import('./measure.ts');

const shell = {
  async mark() {},
  async quit() {},
  async startupMarks() {
    return {};
  },
};

test('a launch right after another finished counts each frame once: one loop at a time', async () => {
  const first = createLaunchMeasure(shell, []);
  frame();
  await first.finish(0);
  // The stopped loop's next frame is already queued; the next launch starts its own before it runs.
  const second = createLaunchMeasure(shell, []);
  const before = second.framesObserved();
  for (let i = 0; i < 5; i++) frame();
  assert.equal(second.framesObserved() - before, 5);
  second.stopObserving();
});
