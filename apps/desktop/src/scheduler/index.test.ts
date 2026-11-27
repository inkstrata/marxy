// The scheduler: a slice stays inside its deadline, a run is cancelled by signal or by generation, the lanes are served
// highest first, and a lane that is always held off still gets its turn.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { DEFAULT_BUDGET_MS, generationGuard, runSliced, STARVE_MS, testing, yieldToMain, type Lane } from './index.ts';

afterEach(() => testing.setClock(null));

/** A clock the test moves by hand. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1000;
  const now = () => t;
  testing.setClock(now);
  return { now, advance: (ms) => void (t += ms) };
}

test('yieldToMain resolves in a later task, after a microtask has run', async () => {
  let microtask = false;
  const waited = yieldToMain().then(() => assert.equal(microtask, true));
  queueMicrotask(() => (microtask = true));
  await waited;
});

test('a slice is told when its budget is spent, and the default is within the research range', async () => {
  assert.ok(DEFAULT_BUDGET_MS >= 5 && DEFAULT_BUDGET_MS <= 8);
  const clock = fakeClock();
  const seen: boolean[] = [];
  let calls = 0;
  await runSliced(
    (slice) => {
      seen.push(slice.expired());
      assert.equal(slice.remaining(), 6);
      clock.advance(5);
      seen.push(slice.expired());
      clock.advance(1);
      seen.push(slice.expired());
      return ++calls === 2 ? 'done' : 'more';
    },
    { budgetMs: 6 },
  );
  assert.deepEqual(seen, [false, false, true, false, false, true]);
});

test('a step that loops until the slice expires does a bounded amount of work per slice', async () => {
  const clock = fakeClock();
  let left = 100;
  const slices: number[] = [];
  const result = await runSliced(
    (slice) => {
      let n = 0;
      while (left > 0 && !slice.expired()) {
        left--;
        n++;
        clock.advance(1);
      }
      slices.push(n);
      return left > 0 ? 'more' : 'done';
    },
    { budgetMs: 8 },
  );
  assert.equal(result, 'done');
  assert.deepEqual(slices.slice(0, 3), [8, 8, 8]);
  assert.equal(slices.reduce((a, b) => a + b, 0), 100);
});

test('a run is cancelled by its signal before the next slice, and a cancelled run starts none', async () => {
  const ctl = new AbortController();
  let calls = 0;
  const result = await runSliced(
    () => {
      if (++calls === 3) ctl.abort();
      return 'more';
    },
    { signal: ctl.signal },
  );
  assert.equal(result, 'cancelled');
  assert.equal(calls, 3);
  const pre = new AbortController();
  pre.abort();
  let started = false;
  assert.equal(await runSliced(() => ((started = true), 'done'), { signal: pre.signal }), 'cancelled');
  assert.equal(started, false);
});

test('a run is cancelled by generation when a newer run begins', async () => {
  const guard = generationGuard();
  const log: string[] = [];
  const run = (name: string) => {
    const stale = guard.begin();
    let n = 0;
    return runSliced(
      () => {
        log.push(`${name}${n}`);
        return ++n === 4 ? 'done' : 'more';
      },
      { stale },
    );
  };
  const first = run('a');
  await yieldToMain();
  const second = run('b');
  assert.equal(await first, 'cancelled');
  assert.equal(await second, 'done');
  assert.equal(log.filter((l) => l.startsWith('b')).length, 4);
  assert.ok(log.filter((l) => l.startsWith('a')).length < 4, 'the replaced run stopped early');
  guard.cancel();
  assert.equal(await runSliced(() => 'done', { stale: guard.begin() }), 'done');
});

test('a step that throws rejects the run', async () => {
  await assert.rejects(runSliced(() => { throw new Error('boom'); }), /boom/);
});

test('waiters are served by lane, highest first, and in order within a lane', async () => {
  fakeClock();
  const order: string[] = [];
  const wait = (lane: Lane, name: string) => yieldToMain(lane).then(() => void order.push(name));
  const all = [wait('background', 'bg1'), wait('viewport', 'vp1'), wait('input', 'in1'), wait('background', 'bg2'), wait('input', 'in2'), wait('viewport', 'vp2')];
  await Promise.all(all);
  assert.deepEqual(order, ['in1', 'in2', 'vp1', 'vp2', 'bg1', 'bg2']);
  assert.deepEqual(testing.waiting(), { input: 0, viewport: 0, background: 0 });
});

test('a lane held off by a busier one still gets a turn once it has waited STARVE_MS', async () => {
  const clock = fakeClock();
  const order: string[] = [];
  const low = yieldToMain('background').then(() => void order.push('low'));
  // Input work keeps arriving, each a little later than the last, as a long find would.
  const busy = (async () => {
    for (let i = 0; i < 40 && !order.includes('low'); i++) {
      clock.advance(STARVE_MS / 8);
      await yieldToMain('input');
      order.push('in');
    }
  })();
  await Promise.all([low, busy]);
  const at = order.indexOf('low');
  assert.ok(at > 0, 'the busier lane went first while the wait was short');
  assert.ok(at <= 9, `the background waiter ran after about ${STARVE_MS} ms, not never (ran at ${at})`);
});

test('with no starvation the lower lane waits behind every higher waiter', async () => {
  fakeClock();
  const order: string[] = [];
  const low = yieldToMain('background').then(() => void order.push('low'));
  const highs = [1, 2, 3].map((n) => yieldToMain('input').then(() => void order.push(`in${n}`)));
  await Promise.all([low, ...highs]);
  assert.deepEqual(order, ['in1', 'in2', 'in3', 'low']);
});
