// The page's inflate and the limits it is used with: a gzip bomb listed through the memory shell or held inside another
// archive stops at the page's stream cap and says so, and a PNG's packed profile is unpacked no further than asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, gzipSync } from 'node:zlib';
import { createMemoryShell } from '../shell/memory.ts';
import { boundedInflate, PAGE_ARCHIVE_LIMITS } from './archive-bytes.ts';
import { listHeld } from './archive-nested.ts';

const MB = 1024 * 1024;
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

function tarEntry(name: string, data: Uint8Array): Uint8Array {
  const h = new Uint8Array(512);
  h.set(enc(name), 0);
  h.set(enc('0000644\0'), 100);
  h.set(enc('0000000\0'), 108);
  h.set(enc('0000000\0'), 116);
  h.set(enc(`${data.length.toString(8).padStart(11, '0')}\0`), 124);
  h.set(enc(`${(1_700_000_000).toString(8).padStart(11, '0')}\0`), 136);
  h[156] = 0x30;
  h.set(enc('ustar\0'), 257);
  h.set(enc('00'), 263);
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.set(enc(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
  return concat([h, data, new Uint8Array((512 - (data.length % 512)) % 512)]);
}

const bomb = (): Uint8Array =>
  new Uint8Array(gzipSync(concat([tarEntry('a.txt', enc('a\n')), tarEntry('zeros.bin', new Uint8Array(8 * MB)), tarEntry('z.txt', enc('z\n')), new Uint8Array(1024)])));

/** The page's stream cap lowered to 1 MB for one test, so a small bomb passes it. */
async function withStreamCap(run: () => Promise<void>): Promise<void> {
  const was = PAGE_ARCHIVE_LIMITS.stream;
  PAGE_ARCHIVE_LIMITS.stream = MB;
  try {
    await run();
  } finally {
    PAGE_ARCHIVE_LIMITS.stream = was;
  }
}

const STOPPED = 'Listed the first 2 entries: the walk stops after 1 MB of unpacked stream.';

test('a tar.gz bomb listed by the memory shell stops at the page stream cap and says so', async () => {
  await withStreamCap(async () => {
    const shell = createMemoryShell({ '/r/bomb.tar.gz': bomb() });
    const listing = (await shell.listArchive('/r/bomb.tar.gz'))!;
    assert.deepEqual(listing.entries.map((e) => e.path), ['a.txt', 'zeros.bin']);
    assert.equal(listing.truncated, STOPPED);
  });
});

test('a tar.gz bomb held inside another archive stops at the page stream cap and says so', async () => {
  await withStreamCap(async () => {
    const listing = (await listHeld({
      path: 'archive-entry:/r/outer.zip::bomb.tar.gz',
      archive: '/r/outer.zip',
      name: 'bomb.tar.gz',
      index: 0,
      bytes: bomb(),
      mtimeMs: null,
      of: 'archive',
      depth: 1,
    }))!;
    assert.equal(listing.truncated, STOPPED);
  });
});

test('a zlib stream is inflated in the page only as far as asked, and an entry cap past that', async () => {
  const packed = new Uint8Array(deflateSync(new Uint8Array(20 * MB).fill(0x61)));
  const head = await boundedInflate(packed, 'deflate', 1000);
  assert.equal(head.length, 1000);
  assert.ok(head.every((b) => b === 0x61));
  assert.equal((await boundedInflate(packed, 'deflate')).length, 16 * MB + 1);
  // Asked for no limit, a gzip stream still stops one byte past the page's stream cap.
  await withStreamCap(async () => assert.equal((await boundedInflate(bomb(), 'gzip')).length, MB + 1));
});

test("the memory shell's image facts unpack a PNG's profile only past the 4 MB the facts read", async () => {
  const be32 = (b: Uint8Array, at: number, n: number): void => new DataView(b.buffer, b.byteOffset).setUint32(at, n);
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const c = new Uint8Array(12 + data.length);
    be32(c, 0, data.length);
    c.set(enc(type), 4);
    c.set(data, 8);
    return c;
  };
  const profile = new Uint8Array(16 * MB);
  const ihdr = new Uint8Array(13);
  be32(ihdr, 0, 4);
  be32(ihdr, 4, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = concat([
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', ihdr),
    chunk('iCCP', concat([enc('Hostile\0'), Uint8Array.of(0), new Uint8Array(deflateSync(profile))])),
    chunk('IEND', new Uint8Array(0)),
  ]);
  // Counts what the page's decompressor hands on, to see how far the profile was unpacked.
  const Real = globalThis.DecompressionStream;
  let unpacked = 0;
  globalThis.DecompressionStream = class {
    readonly writable: WritableStream<BufferSource>;
    readonly readable: ReadableStream<Uint8Array>;
    constructor(format: CompressionFormat) {
      const real = new Real(format);
      this.writable = real.writable;
      this.readable = real.readable.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(c, out) {
            unpacked += c.length;
            out.enqueue(c);
          },
        }),
      );
    }
  } as unknown as typeof DecompressionStream;
  try {
    const facts = await createMemoryShell({ '/r/a.png': png }).imageFacts('/r/a.png');
    assert.equal(facts?.colorProfile, 'Hostile (over 4 MB, not read)');
    assert.ok(unpacked < 8 * MB, `${unpacked} bytes unpacked`);
  } finally {
    globalThis.DecompressionStream = Real;
  }
});
