// The launch measurement's frame counter: a launch
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
  async mark(_name: string, _t: number, _data?: string) {},
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

type Rec = { marks: string[]; times: Record<string, number> };
function recorder(): { shell: typeof shell; rec: Rec } {
  const rec: Rec = { marks: [], times: {} };
  return {
    rec,
    shell: {
      ...shell,
      async mark(name: string, t: number, data?: string) {
        rec.marks.push(data ? `${name} ${data}` : name);
        rec.times[name] = t;
      },
    },
  };
}
const evidence = { blocks: 1, chars: 5, hasText: true, heading: '' };
const g = globalThis as Record<string, unknown>;

test('a wait that saw frames but no paint entry marks painted source=frame and first_text at its frame', async () => {
  const { shell: recording, rec } = recorder();
  const realSetTimeout = globalThis.setTimeout;
  g.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  // The fallback is due in 2 s; the test makes it due 150 ms later, after the frames on an idle machine.
  let fallbackAt = Infinity;
  g.setTimeout = (fn: () => void) => realSetTimeout(() => { fallbackAt = Date.now(); fn(); }, 150);
  try {
    const measure = createLaunchMeasure(recording, []);
    const start = Date.now();
    const pending = measure.waitForFirstText({} as HTMLElement, evidence, performance.now(), start);
    // The bounds of the second frame, the one that sees two frames ticked. Under load the 5 ms gaps can
    // stretch past any fixed bound, so the frame's own time is the measure, not a wall-clock limit.
    let secondFrame = { from: 0, to: 0 };
    for (let i = 0; i < 6; i++) {
      const from = Date.now();
      frame();
      if (i === 1) secondFrame = { from, to: Date.now() };
      await new Promise((resolve) => realSetTimeout(resolve, 5));
    }
    const outcome = await Promise.race([pending, new Promise((resolve) => realSetTimeout(() => resolve('hung'), 800))]);
    assert.equal(outcome, 'frames_only');
    assert.ok(rec.marks.some((m) => /^painted frames=\d+ since_render_ms=\d+ signal=frames-only source=frame$/.test(m)), rec.marks.join(' | '));
    assert.ok(!rec.marks.some((m) => /fcp_before_ms/.test(m)), 'no earlier paint on the timeline, so no evidence is claimed');
    assert.ok(rec.marks.includes('first_text'), 'a frames-only boot that showed text records first_text');
    const at = rec.times.first_text;
    assert.ok(at >= secondFrame.from && at <= secondFrame.to, `first_text (${at - start} ms) is the second frame's time (${secondFrame.from - start} to ${secondFrame.to - start} ms)`);
    // When the fallback ran after the frames, it must not be the time recorded.
    if (fallbackAt > secondFrame.to) assert.ok(at < fallbackAt, `first_text (${at - start} ms) is not the fallback (${fallbackAt - start} ms)`);
    assert.equal(rec.times.first_text, rec.times.painted);
    measure.stopObserving();
  } finally {
    g.setTimeout = realSetTimeout;
    delete g.getComputedStyle;
  }
});

test('a launch whose FCP came before the render goes on at once, records the evidence, and does not wait 2 s', async () => {
  const { shell: recording, rec } = recorder();
  g.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  const realPerf = globalThis.performance;
  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    value: { now: () => realPerf.now(), getEntriesByType: () => [{ name: 'first-contentful-paint', startTime: 212.4 }] },
  });
  try {
    const measure = createLaunchMeasure(recording, []);
    const start = Date.now();
    // The default 2 s fallback is live: only the early FCP can end this wait quickly.
    const pending = measure.waitForFirstText({} as HTMLElement, evidence, 5000, start);
    for (let i = 0; i < 4; i++) frame();
    const outcome = await pending;
    // Downstream work (typeset, restoring the place) runs after the wait, so its start is this moment.
    const downstreamAt = Date.now() - start;
    assert.equal(outcome, 'frames_only');
    assert.ok(downstreamAt < 500, `downstream work started ${downstreamAt} ms after the render, not after the 2000 ms fallback`);
    assert.ok(rec.marks.some((m) => /signal=frames-only source=frame fcp_before_ms=212$/.test(m)), rec.marks.join(' | '));
    assert.ok(rec.marks.includes('first_text'));
    measure.stopObserving();
  } finally {
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: realPerf });
    delete g.getComputedStyle;
  }
});

test('an engine paint entry marks source=paint and first_text', async () => {
  const { shell: recording, rec } = recorder();
  g.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  const realPerf = globalThis.performance;
  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    value: { now: () => realPerf.now(), getEntriesByType: () => [{ name: 'first-contentful-paint', startTime: 1e9 }] },
  });
  try {
    const measure = createLaunchMeasure(recording, []);
    const pending = measure.waitForFirstText({} as HTMLElement, evidence, 0, Date.now());
    for (let i = 0; i < 4; i++) frame();
    assert.equal(await pending, 'painted');
    assert.ok(rec.marks.some((m) => /signal=first-contentful-paint source=paint$/.test(m)), rec.marks.join(' | '));
    assert.ok(rec.marks.includes('first_text'));
    measure.stopObserving();
  } finally {
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: realPerf });
    delete g.getComputedStyle;
  }
});

test('no text records no_text with the counts and never first_text', async () => {
  const { shell: recording, rec } = recorder();
  const measure = createLaunchMeasure(recording, []);
  assert.equal(await measure.waitForFirstText({} as HTMLElement, { blocks: 0, chars: 0, hasText: false, heading: '' }, 0, 0), 'no_text');
  assert.equal(await measure.waitForFirstText({} as HTMLElement, { blocks: 2, chars: 1, hasText: false, heading: '' }, 0, 0), 'no_text');
  assert.deepEqual(rec.marks, ['no_text blocks=0 chars=0', 'no_text blocks=2 chars=1']);
  measure.stopObserving();
});

test('a hidden document records no_paint reason=not-visible and never first_text', async () => {
  const { shell: recording, rec } = recorder();
  g.getComputedStyle = () => ({ visibility: 'hidden', display: 'block' });
  try {
    const measure = createLaunchMeasure(recording, []);
    assert.equal(await measure.waitForFirstText({} as HTMLElement, evidence, 0, 0), 'no_paint');
    assert.deepEqual(rec.marks, ['no_paint reason=not-visible']);
    measure.stopObserving();
  } finally {
    delete g.getComputedStyle;
  }
});
