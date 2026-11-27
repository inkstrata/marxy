// measure-scale's arguments, sizes, growth per doubling and table; the browser run itself is a measurement.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { bytesOf, parseArgs, perDoubling, table } from './measure-scale.mjs';

test('sizes read with k and m, and arguments are checked', () => {
  assert.equal(bytesOf('1m'), 1_000_000);
  assert.equal(bytesOf('4.9m'), 4_900_000);
  assert.equal(bytesOf('512k'), 512_000);
  assert.equal(bytesOf('2048'), 2048);
  assert.throws(() => bytesOf('big'));
  assert.deepEqual(parseArgs(['--kinds', 'txt,log', '--sizes', '1m,2m']).kinds, ['txt', 'log']);
  assert.throws(() => parseArgs(['--kinds', 'nope']), /unknown kind/);
  assert.throws(() => parseArgs(['--steps', 'dance']), /unknown step/);
});

test('growth per doubling is 2 for linear work and 4 for quadratic, at any size ratio', () => {
  assert.equal(perDoubling(100, 1e6, 200, 2e6), 2);
  assert.equal(perDoubling(100, 1e6, 400, 2e6), 4);
  assert.ok(Math.abs(perDoubling(100, 1e6, 1600, 4e6) - 4) < 1e-9);
  assert.equal(perDoubling(0, 1e6, 10, 2e6), null);
});

test('the table marks growth over 2.5 per doubling and names a stalled step', () => {
  const t = table([
    { kind: 'txt', bytes: 1e6, steps: { open: { taskMs: 100 }, key: { taskMs: 5 } } },
    { kind: 'txt', bytes: 2e6, steps: { open: { taskMs: 400 }, key: { err: 'over 120 s at key' } } },
  ], ['open', 'key']);
  assert.match(t, /\| txt \| 2\.0 MB \| 400 \(4\.0 !\) \| stalled: over 120 s at key \|/);
  assert.match(t, /\| txt \| 1\.0 MB \| 100 \| 5 \|/);
});
