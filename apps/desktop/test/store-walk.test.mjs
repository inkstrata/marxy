// The standing data-safety walk over the document store (F-33): seeded, model-based, node only.
//
//   MARXY_WALK_SEEDS=<n>  runs seeds 1..n (default 40; the nightly run sets 2000)
//   MARXY_WALK_SEED=<n>   replays that one seed and nothing else
//   MARXY_WALK_FINDINGS=1 lifts the generator's one restriction (see "OPEN FINDING" in support/store-walk.mjs)
//
// A failure names its seed and lists the steps. Every later data-safety story adds an op or an invariant to
// test/support/store-walk.mjs instead of writing a probe of its own; the story's PR runs 200 seeds and says so.
import { strict as assert } from 'node:assert';
import { runInNewContext } from 'node:vm';
import { setFlagsFromString } from 'node:v8';
import { test } from 'node:test';
import { cmDocText } from '../src/source/buffer-commit.ts';
import { openDocumentStore } from '../src/document/store.ts';
import { INVARIANTS, OPS, runWalk, seedsFromEnv } from './support/store-walk.mjs';

const seeds = seedsFromEnv();

// The heap after a collection, in MB: `gc` is reachable without a flag by asking V8 for it.
setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc');
const heapMB = () => {
  gc();
  return process.memoryUsage().heapUsed / 1048576;
};
const samples = [];

for (const seed of seeds) {
  test(`walk seed ${seed}`, async () => {
    await runWalk(seed);
    if (seeds.length >= 500 && (seed === 100 || seed === seeds.length)) samples.push([seed, heapMB()]);
  });
}

test('the same seed gives the same step list and the same final bytes', async () => {
  const first = await runWalk(7);
  const again = await runWalk(7);
  assert.ok(first.trace.length >= 20, 'a walk is at least twenty steps');
  assert.deepEqual(again.trace, first.trace);
  assert.deepEqual(again.files, first.files);
  const other = await runWalk(8);
  assert.notDeepEqual(other.trace, first.trace, 'a different seed walks a different way');
});

test('MARXY_WALK_SEED replays exactly one seed; MARXY_WALK_SEEDS counts from 1', () => {
  assert.deepEqual(seedsFromEnv({ MARXY_WALK_SEED: '57' }), [57]);
  assert.deepEqual(seedsFromEnv({ MARXY_WALK_SEEDS: '3' }), [1, 2, 3]);
  assert.deepEqual(seedsFromEnv({ MARXY_WALK_SEED: '9', MARXY_WALK_SEEDS: '3' }), [9]);
  assert.equal(seedsFromEnv({}).length, 40, 'the default is forty');
});

test('a story plugs in by adding to OPS and INVARIANTS, which are plain objects of plain entries', () => {
  for (const [key, op] of Object.entries(OPS)) {
    assert.equal(Object.getPrototypeOf(op), Object.prototype, key);
    assert.equal(typeof op.name, 'string', key);
    assert.equal(typeof op.weight, 'number', key);
    assert.equal(typeof op.applicable, 'function', key);
    assert.equal(typeof op.run, 'function', key);
  }
  for (const [key, invariant] of Object.entries(INVARIANTS)) {
    assert.equal(Object.getPrototypeOf(invariant), Object.prototype, key);
    assert.equal(typeof invariant.name, 'string', key);
    assert.equal(typeof invariant.check, 'function', key);
  }
  assert.deepEqual(Object.keys(INVARIANTS).slice(0, 6), ['I1', 'I2', 'I3', 'I4', 'I5', 'I6']);
});

test('a long run does not leak: the heap after a collection does not grow with the seeds', { skip: seeds.length < 500 && 'needs 500 or more seeds' }, () => {
  const [[, early], [, late]] = samples;
  console.log(`# heap after gc: ${early.toFixed(1)} MB at seed 100, ${late.toFixed(1)} MB at seed ${seeds.length}`);
  assert.ok(late - early < 25, `heap grew from ${early.toFixed(1)} MB to ${late.toFixed(1)} MB over ${seeds.length - 100} more seeds`);
});

// FOUND BY THE WALK ON MAIN, NOT FIXED HERE (F-33 is a test story): a Source session with typed changes either
// side of a byte that is not UTF-8 folds as one splice, and the byte between them becomes U+FFFD (ff -> ef bf bd).
// Walk seeds 57, 79, 108 (with MARXY_WALK_FINDINGS=1) reach it. This is a `todo`: it reports, and does not fail the
// run, until `foldText` keeps the byte, when it passes and the restriction in support/store-walk.mjs goes.
test('two changes in one Source session, either side of a byte that is not UTF-8, keep that byte', { todo: 'found by the F-33 walk: foldText re-encodes the span between the changes' }, async () => {
  const enc = new TextEncoder();
  const bytes = new Uint8Array([...enc.encode('alpha\n'), 0xff, ...enc.encode('\nomega\n')]);
  const store = openDocumentStore({ writeFileAtomic: async () => {} }, '/x.md', bytes);
  const text = cmDocText(store.snapshot().buffer);
  await store.commitSource(`ALPHA${text.slice(5, text.length - 6)}OMEGA\n`);
  assert.deepEqual([...store.snapshot().buffer.bytes], [...enc.encode('ALPHA\n'), 0xff, ...enc.encode('\nOMEGA\n')]);
});
