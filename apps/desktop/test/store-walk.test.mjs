// The standing data-safety walk over the document store (F-33): seeded, model-based, node only.
//
//   MARXY_WALK_SEEDS=<n>  runs seeds 1..n (default 40; the nightly run sets 2000)
//   MARXY_WALK_SEED=<n>   replays that one seed and nothing else
//
// A failure names its seed and lists the steps. Every later data-safety story adds an op or an invariant to
// test/support/store-walk.mjs instead of writing a probe of its own; the story's PR runs 200 seeds and says so.
import { strict as assert } from 'node:assert';
import { runInNewContext } from 'node:vm';
import { setFlagsFromString } from 'node:v8';
import { test } from 'node:test';
import { cmDocText } from '../src/source/buffer-commit.ts';
import { openDocumentStore } from '../src/document/store.ts';
import { INVARIANTS, OPS, describeFailure, runWalk, seedsFromEnv } from './support/store-walk.mjs';

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
  assert.deepEqual(again.peeks, first.peeks, 'the peeks the app made are the same too');
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

// Found by the F-33 walk (seeds 57, 79, 108): a Source session with typed changes either side of a byte that is not
// UTF-8 folded as one splice and rewrote the byte as U+FFFD (ff -> ef bf bd). The editor's text now holds each such byte
// as its own code unit (F-34.1), so the fold is exact, and the walk types around stray bytes without restriction.
test('two changes in one Source session, either side of a byte that is not UTF-8, keep that byte', async () => {
  const enc = new TextEncoder();
  const bytes = new Uint8Array([...enc.encode('alpha\n'), 0xff, ...enc.encode('\nomega\n')]);
  const store = openDocumentStore({ writeFileAtomic: async () => {} }, '/x.md', bytes);
  const text = cmDocText(store.snapshot().buffer);
  await store.commitSource(`ALPHA${text.slice(5, text.length - 6)}OMEGA\n`);
  assert.deepEqual([...store.snapshot().buffer.bytes], [...enc.encode('ALPHA\n'), 0xff, ...enc.encode('\nOMEGA\n')]);
});

// F-33.1: a failing seed prints what the app peeked at (the store's stale-write comparison, a live reload's read), so the
// failure explains itself: which path, in which step, and the bytes it saw.
test('the app\'s peeks are logged by step, and a failure prints the last of them', async () => {
  const { peeks, trace } = await runWalk(2);
  assert.ok(peeks.length > 0, 'a walk makes peeks (every save and every reload compares disk with the baseline)');
  assert.match(peeks[0], /^step \d+: peeked \/w\/[\w.]+: (\d+ bytes, [0-9a-f]{8}|not-found)$/);
  const text = describeFailure(2, { invariant: 'I1', message: 'x' }, trace, peeks);
  assert.match(text, new RegExp(`peeks \\(the last ${Math.min(peeks.length, 15)} of ${peeks.length}\\):`));
  assert.ok(text.trimEnd().endsWith(peeks.at(-1)), 'the newest peek is last');
  assert.ok(!describeFailure(2, { invariant: 'I1', message: 'x' }, trace).includes('peeks ('), 'no peeks, no section');
});

test('the new steps run within the default seeds: paste in all its kinds, and Save As onto an unsaved open path', async () => {
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    for (const line of (await runWalk(seed)).trace) {
      const paste = line.match(/^paste \((\w+)\)/);
      if (paste) seen.add(`paste ${paste[1]}`);
      if (/unsaved in another document.*: refused, nothing written$/.test(line)) seen.add('saveAsOntoDirty');
    }
  }
  for (const want of ['paste text', 'paste markdown', 'paste plain', 'paste concealed', 'paste notUtf8', 'saveAsOntoDirty']) assert.ok(seen.has(want), `no seed in the first forty ran ${want}`);
});
