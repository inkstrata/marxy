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

test('F-31: a wait that saw frames but no paint entry marks painted signal=frames-only and no first_text', async () => {
  const marks: string[] = [];
  const recording = { ...shell, async mark(name: string, _t: number, data?: string) { marks.push(data ? `${name} ${data}` : name); } };
  const g = globalThis as Record<string, unknown>;
  const realSetTimeout = globalThis.setTimeout;
  g.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  // The fallback is due in 2 s; the test makes it due now.
  g.setTimeout = (fn: () => void) => realSetTimeout(fn, 0);
  try {
    const measure = createLaunchMeasure(recording, []);
    const evidence = { blocks: 1, chars: 5, hasText: true, heading: '' };
    const pending = measure.waitForFirstText({} as HTMLElement, evidence, performance.now(), Date.now());
    for (let i = 0; i < 6; i++) {
      frame();
      await new Promise((resolve) => realSetTimeout(resolve, 5));
    }
    const outcome = await Promise.race([pending, new Promise((resolve) => realSetTimeout(() => resolve('hung'), 500))]);
    assert.equal(outcome, 'frames_only');
    assert.ok(marks.some((m) => /^painted frames=\d+ since_render_ms=\d+ signal=frames-only$/.test(m)), marks.join(' | '));
    assert.ok(!marks.some((m) => m.startsWith('first_text')), 'a frames-only boot is not a first_text sample');
    measure.stopObserving();
  } finally {
    g.setTimeout = realSetTimeout;
    delete g.getComputedStyle;
  }
});
