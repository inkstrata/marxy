// An ICC profile past what the facts read: a PNG's packed profile is unpacked only that far, a JPEG's segments are
// gathered only that far, and the colour row says the profile was not read rather than naming nothing.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createInflate, deflateSync } from 'node:zlib';
import { imageFactsFromBytes } from './image-facts.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const be32 = (b: Uint8Array, at: number, n: number): void => {
  new DataView(b.buffer, b.byteOffset).setUint32(at, n);
};

/** A v2 profile `size` bytes long whose `desc` tag names it `name`. */
function profile(name: string, size: number): Uint8Array {
  const p = new Uint8Array(size);
  be32(p, 0, size);
  p.set(enc('acsp'), 36);
  be32(p, 128, 1);
  p.set(enc('desc'), 132);
  be32(p, 136, 144);
  be32(p, 140, 12 + name.length + 1);
  p.set(enc('desc'), 144);
  be32(p, 152, name.length + 1);
  p.set(enc(name), 156);
  return p;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const c = new Uint8Array(12 + data.length);
  be32(c, 0, data.length);
  c.set(enc(type), 4);
  c.set(data, 8);
  return c;
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

function png(icc: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  be32(ihdr, 0, 4);
  be32(ihdr, 4, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const iccp = concat([enc('Hostile\0'), Uint8Array.of(0), new Uint8Array(deflateSync(icc))]);
  return concat([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IHDR', ihdr), chunk('iCCP', iccp), chunk('IEND', new Uint8Array(0))]);
}

function jpeg(icc: Uint8Array): Uint8Array {
  const most = 65_535 - 2 - 14;
  const count = Math.ceil(icc.length / most);
  const parts: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)];
  for (let i = 0; i < count; i++) {
    const body = icc.subarray(i * most, (i + 1) * most);
    const len = 2 + 14 + body.length;
    parts.push(Uint8Array.of(0xff, 0xe2, len >> 8, len & 0xff), enc('ICC_PROFILE\0'), Uint8Array.of(i + 1, count), body);
  }
  parts.push(Uint8Array.of(0xff, 0xc0, 0, 11, 8, 0, 4, 0, 4, 3, 1, 0x11, 0), Uint8Array.of(0xff, 0xd9));
  return concat(parts);
}

/** Inflates only as far as `limit`, as the page's inflate does, and records what each call was asked and gave. */
function stopping(): { inflate: (packed: Uint8Array, limit?: number) => Promise<Uint8Array>; calls: { limit?: number; got: number }[] } {
  const calls: { limit?: number; got: number }[] = [];
  const inflate = (packed: Uint8Array, limit?: number): Promise<Uint8Array> =>
    new Promise((resolve, reject) => {
      const z = createInflate();
      const parts: Buffer[] = [];
      let n = 0;
      const done = (): void => {
        const out = new Uint8Array(Buffer.concat(parts));
        calls.push({ limit, got: out.length });
        resolve(out);
      };
      z.on('data', (c: Buffer) => {
        parts.push(c);
        n += c.length;
        if (limit !== undefined && n >= limit) {
          z.pause();
          z.destroy();
          done();
        }
      });
      z.on('end', done);
      z.on('error', reject);
      z.end(packed);
    });
  return { inflate, calls };
}

const MB = 1024 * 1024;

test('a PNG profile that unpacks past 4 MB is unpacked only that far and said to be unread', async () => {
  const { inflate, calls } = stopping();
  const facts = await imageFactsFromBytes(png(profile('Hostile P3', 8 * MB)), { inflate });
  assert.equal(facts?.colorProfile, 'Hostile (over 4 MB, not read)');
  assert.ok(calls.length === 1 && calls[0]!.limit !== undefined && calls[0]!.got < 5 * MB, JSON.stringify(calls));
});

test('a JPEG whose profile segments come to more than 4 MB is said to be unread', async () => {
  const facts = await imageFactsFromBytes(jpeg(profile('Hostile P3', 4 * MB + 1024)));
  assert.equal(facts?.colorProfile, 'an embedded profile (over 4 MB, not read)');
});

test('a profile within the limit is named as before', async () => {
  const { inflate } = stopping();
  assert.equal((await imageFactsFromBytes(png(profile('Display P3', 4096)), { inflate }))?.colorProfile, 'Display P3');
  assert.equal((await imageFactsFromBytes(jpeg(profile('Display P3', 200_000))))?.colorProfile, 'Display P3');
  assert.equal((await imageFactsFromBytes(jpeg(profile('Display P3', 4 * MB))))?.colorProfile, 'Display P3');
});
