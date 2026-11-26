// The store-only zip and the checksums of Export's bundle: read back from the zip's own bytes, every entry is the file
// byte for byte with a true CRC-32, and SHA-256 is the standard digest.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { crc32, sha256Hex, uniquePaths, ZIP_MOST_ENTRIES, ZipTooLarge, zipStore } from './zip.ts';

function unzip(b: Uint8Array): { name: string; method: number; flags: number; crc: number; localCrc: number; data: Uint8Array }[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const e = b.length - 22;
  assert.equal(dv.getUint32(e, true), 0x06054b50, 'an end record at the end');
  const n = dv.getUint16(e + 10, true);
  const cdSize = dv.getUint32(e + 12, true);
  let o = dv.getUint32(e + 16, true);
  const start0 = o;
  const out = [];
  for (let i = 0; i < n; i++) {
    assert.equal(dv.getUint32(o, true), 0x02014b50);
    const nl = dv.getUint16(o + 28, true);
    const lo = dv.getUint32(o + 42, true);
    const size = dv.getUint32(o + 20, true);
    const name = new TextDecoder().decode(b.subarray(o + 46, o + 46 + nl));
    assert.equal(dv.getUint32(lo, true), 0x04034b50);
    const at = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    out.push({ name, flags: dv.getUint16(o + 8, true), method: dv.getUint16(o + 10, true), crc: dv.getUint32(o + 16, true), localCrc: dv.getUint32(lo + 14, true), data: b.subarray(at, at + size) });
    o += 46 + nl + dv.getUint16(o + 30, true) + dv.getUint16(o + 32, true);
  }
  assert.equal(o - start0, cdSize, 'the central directory is as long as it says');
  return out;
}

test('crc32 is the standard check value; sha256Hex the standard digest', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const big = new Uint8Array(70_000).map((_, i) => (i * 31) & 255);
  assert.equal(await sha256Hex(big), createHash('sha256').update(big).digest('hex'));
});

test('a stored zip gives each file back byte for byte, its name in UTF-8 and its CRC in both headers', () => {
  const files = [
    { path: 'plans/a.md', bytes: new TextEncoder().encode('# A\r\nno final newline') },
    { path: 'notes/é.md', bytes: new Uint8Array([0, 1, 2, 255]) },
    { path: 'empty', bytes: new Uint8Array() },
  ];
  const z = unzip(zipStore(files, new Date(2026, 10, 11, 9, 30, 0)));
  assert.deepEqual(z.map((e) => e.name), ['plans/a.md', 'notes/é.md', 'empty']);
  for (const [i, e] of z.entries()) {
    assert.equal(e.method, 0, 'stored');
    assert.ok(e.flags & 0x800, 'UTF-8 name');
    assert.equal(e.crc, crc32(files[i]!.bytes));
    assert.equal(e.localCrc, e.crc);
    assert.deepEqual([...e.data], [...files[i]!.bytes]);
  }
});

test('uniquePaths numbers a second entry of the same path before its extension', () => {
  const b = new Uint8Array();
  assert.deepEqual(uniquePaths([{ path: 'a.md', bytes: b }, { path: 'a.md', bytes: b }, { path: 'a.md', bytes: b }, { path: 'x', bytes: b }, { path: 'x', bytes: b }]).map((e) => e.path), ['a.md', 'a (2).md', 'a (3).md', 'x', 'x (2)']);
});

test('a zip of more entries than its end record can count is refused, not written corrupt; the most it can count is built', () => {
  const b = new Uint8Array();
  const many = Array.from({ length: ZIP_MOST_ENTRIES + 1 }, (_, i) => ({ path: `f${i}`, bytes: b }));
  assert.throws(() => zipStore(many), ZipTooLarge);
  assert.equal(unzip(zipStore(many.slice(1))).length, ZIP_MOST_ENTRIES);
});
