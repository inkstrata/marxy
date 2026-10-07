// B-21: a closed document's queued highlight jobs are not run, and the next document does not wait for them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closedJobIds, JobQueue } from './highlight-queue.ts';

/** A scheduler the test steps by hand, so no timing decides anything. */
function manualTasks() {
  const tasks: (() => void)[] = [];
  return {
    nextTask: (fn: () => void) => void tasks.push(fn),
    step: async () => {
      tasks.shift()?.();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
  };
}

test("a queued job that was dropped is never run, and the next document's job is the next one run", async () => {
  const ran: number[] = [];
  const t = manualTasks();
  const q = new JobQueue<{ id: number }>(async (job) => void ran.push(job.id), t.nextTask);
  for (let id = 0; id < 5; id++) q.push({ id });
  await t.step(); // job 0 runs; 1..4 are the closed document's
  assert.deepEqual(ran, [0]);
  assert.deepEqual(q.drop([1, 2, 3, 4]), [1, 2, 3, 4]);
  q.push({ id: 5 }); // the new document's fence
  await t.step();
  assert.deepEqual(ran, [0, 5], 'the new fence runs right after the running job');
  await t.step();
  await t.step();
  assert.deepEqual(ran, [0, 5], 'the dropped jobs never run');
});

test('dropping an id that already ran reports nothing', async () => {
  const t = manualTasks();
  const q = new JobQueue<{ id: number }>(async () => {}, t.nextTask);
  q.push({ id: 1 });
  await t.step();
  assert.deepEqual(q.drop([1, 99]), []);
});

test('a job that throws does not stop the queue', async () => {
  const ran: number[] = [];
  const t = manualTasks();
  const q = new JobQueue<{ id: number }>(async (job) => {
    ran.push(job.id);
    if (job.id === 0) throw new Error('boom');
  }, t.nextTask);
  q.push({ id: 0 });
  q.push({ id: 1 });
  await t.step();
  await t.step();
  assert.deepEqual(ran, [0, 1]);
});

test('closedJobIds names the pending jobs whose block has left the page', () => {
  const pending = new Map([
    [1, { block: { isConnected: true } }],
    [2, { block: { isConnected: false } }],
    [3, { block: { isConnected: false } }],
  ]);
  assert.deepEqual(closedJobIds(pending), [2, 3]);
});
