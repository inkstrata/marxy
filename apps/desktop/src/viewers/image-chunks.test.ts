import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FILL_MAX, imageStructure, jpegName } from './image-chunks.ts';

const reader = (b: Uint8Array) => async (at: number, n: number) => b.subarray(at, at + n);
const walk = (b: Uint8Array) => imageStructure(b.subarray(0, 64), b.length, reader(b));
const demo = (name: string) => new Uint8Array(readFileSync(new URL(`../../../../fixtures/demo/images/${name}`, import.meta.url)));

test('a PNG: its signature, then each chunk at its offset with its length, to IEND', async () => {
  const s = (await walk(demo('tidemark-icon.png')))!;
  assert.equal(s.word, 'chunk');
  assert.deepEqual(s.chunks.slice(0, 2), [
    { type: 'signature', at: 0, length: 8, head: 8 },
    { type: 'IHDR', at: 8, length: 25, head: 8 },
  ]);
  assert.equal(s.chunks.at(-1)!.type, 'IEND');
  const last = s.chunks.at(-1)!;
  assert.equal(last.at + last.length, 418, 'the chunks cover the file');
  assert.equal(s.stopped, null);
});

test('a JPEG: its segments, the scan running to the next marker past stuffed bytes and restarts, then EOI', async () => {
  const b = Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46,
    0xff, 0xda, 0x00, 0x04, 0x01, 0x02,
    0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33,
    0xff, 0xd9,
  ]);
  const s = (await walk(b))!;
  assert.equal(s.word, 'segment');
  assert.deepEqual(s.chunks.map((c) => [c.type, c.at, c.length]), [['SOI', 0, 2], ['APP0', 2, 6], ['SOS', 8, 13], ['EOI', 21, 2]]);
  assert.equal(s.stopped, null);
  const photo = (await walk(demo('harbour-at-low-water.jpg')))!;
  assert.equal(photo.chunks[0]!.type, 'SOI');
  assert.equal(photo.chunks.at(-1)!.type, 'EOI');
  assert.ok(photo.chunks.some((c) => c.type === 'SOS') && photo.chunks.some((c) => c.type === 'DQT'));
});

test('a WebP: its RIFF head, then its chunks; GIF and a cut file are said, never thrown', async () => {
  const s = (await walk(demo('ferry.webp')))!;
  assert.equal(s.chunks[0]!.type, 'RIFF');
  assert.match(s.chunks[1]!.type, /^VP8[ LX]?$/);
  assert.equal(await walk(demo('buoy.gif')), null);
  const cut = demo('harbour-at-low-water.jpg').subarray(0, 4000);
  const c = (await walk(cut))!;
  assert.ok(c.stopped, 'a file cut short says where the walk stopped');
  assert.equal(jpegName(0xe1), 'APP1');
  assert.equal(jpegName(0xc2), 'SOF2');
});

test('a JPEG with fill bytes before a marker is walked past them in a few reads, however long the run', async () => {
  const run = (n: number, tail: number[]) => {
    const b = new Uint8Array(4 + n + tail.length);
    b.set([0xff, 0xd8, 0xff, 0xff]);
    b.fill(0xff, 2, 2 + n);
    b.set(tail, 2 + n);
    return b;
  };
  let reads = 0;
  const counted = (b: Uint8Array) => async (at: number, n: number) => { reads++; return b.subarray(at, at + n); };
  const small = run(500, [0xd9]);
  const s = (await imageStructure(small.subarray(0, 64), small.length, counted(small)))!;
  assert.deepEqual(s.chunks.map((c) => [c.type, c.at]), [['SOI', 0], ['EOI', 501]]);
  assert.ok(reads <= 4, `${reads} reads`);

  const big = run(FILL_MAX / 2, [0xd9]);
  reads = 0;
  const m = (await imageStructure(big.subarray(0, 64), big.length, counted(big)))!;
  assert.equal(m.chunks.at(-1)!.type, 'EOI');
  assert.ok(reads < 30, `${reads} reads`);

  const huge = new Uint8Array(64 * 1024 * 1024).fill(0xff);
  huge[0] = 0xff; huge[1] = 0xd8;
  reads = 0;
  const t0 = Date.now();
  const h = (await imageStructure(huge.subarray(0, 64), huge.length, counted(huge)))!;
  assert.match(h.stopped!, /fill bytes run past/);
  assert.ok(reads < 40 && Date.now() - t0 < 2000, `${reads} reads`);
});
