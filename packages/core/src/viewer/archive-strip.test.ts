// The file as stored: the strip covers every byte of a zip, a plain tar, a tar.gz, a lone gzip and a
// 7z exactly once and in order; entries land on their own headers; bytes no part claims are found; runs gather and widths
// keep their floor; a zip's end record, local header and methods are read from the bytes given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync, gzipSync, inflateRawSync } from 'node:zlib';
import { listArchiveBytes, type ArchiveListingLike, type Inflate } from './archive-read.ts';
import {
  archiveStrip,
  flagWords,
  gatherStrip,
  gzipHeaderLength,
  localHeaderOf,
  methodByListing,
  methodName,
  modeOctal,
  modeWords,
  stripHolds,
  stripLayout,
  zipEndIn,
  zipMethods,
  type StripSegment,
} from './archive-strip.ts';

const demo = (p: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../../fixtures/demo/archives/${p}`, import.meta.url)));
const inflate: Inflate = async (bytes, format) => new Uint8Array(format === 'gzip' ? gunzipSync(bytes) : inflateRawSync(bytes));
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

async function list(bytes: Uint8Array, name: string): Promise<ArchiveListingLike> {
  const l = await listArchiveBytes(bytes, name, inflate);
  assert.ok(l, `${name} lists`);
  return l;
}

/** Every byte once, in order, and no segment empty. */
function covers(segs: readonly StripSegment[], size: number): void {
  let at = 0;
  for (const s of segs) {
    assert.equal(s.from, at, `${s.kind} starts where the one before ended`);
    assert.ok(s.to > s.from, `${s.kind} at ${s.from} is not empty`);
    at = s.to;
  }
  assert.equal(at, size, 'the last ends at the file’s end');
}

function tarHeader(name: string, size: number, type = '0'): Uint8Array {
  const h = new Uint8Array(512);
  h.set(enc(name), 0);
  h.set(enc('0000755\0'), 100);
  h.set(enc('0000000\0'), 108);
  h.set(enc('0000000\0'), 116);
  h.set(enc(`${size.toString(8).padStart(11, '0')}\0`), 124);
  h.set(enc(`${(1_700_000_000).toString(8).padStart(11, '0')}\0`), 136);
  h[156] = type.charCodeAt(0);
  h.set(enc('ustar\0'), 257);
  h.set(enc('00'), 263);
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.set(enc(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
  return h;
}
const pad = (b: Uint8Array): Uint8Array => concat([b, new Uint8Array((512 - (b.length % 512)) % 512)]);
function tar(entries: readonly [string, string][], record = 0): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [name, text] of entries) {
    const data = enc(text);
    parts.push(tarHeader(name, name.endsWith('/') ? 0 : data.length, name.endsWith('/') ? '5' : '0'), pad(name.endsWith('/') ? new Uint8Array(0) : data));
  }
  parts.push(new Uint8Array(1024));
  const body = concat(parts);
  return record > 0 ? concat([body, new Uint8Array((record - (body.length % record)) % record)]) : body;
}

test('the survey zip: every byte once, each entry on its own local header, the directory and the end record at the end', async () => {
  const bytes = demo('harbour-survey-2026.zip');
  const l = await list(bytes, 'harbour-survey-2026.zip');
  const tailAt = Math.max(0, bytes.length - 65_557);
  const end = zipEndIn(bytes.subarray(tailAt), tailAt);
  assert.ok(end);
  assert.equal(end.at + end.size, bytes.length);
  const segs = archiveStrip(l, { end });
  covers(segs, bytes.length);
  const entries = segs.filter((s) => s.kind === 'entry');
  assert.equal(entries.length, l.entries.filter((e) => e.offset !== null).length, 'one segment an entry');
  for (const s of entries) {
    assert.deepEqual([...bytes.subarray(s.from, s.from + 4)], [0x50, 0x4b, 0x03, 0x04], `entry ${s.index} begins with its local header`);
    const lh = localHeaderOf(bytes.subarray(s.from, s.from + 30))!;
    const e = l.entries[s.index!]!;
    if (!(lh.flags & 8)) assert.equal(s.header, lh.length, `entry ${s.index}'s header is its local header`);
    assert.equal(s.to - s.from - s.header!, (lh.flags & 8) ? s.to - s.from - s.header! : e.packed);
  }
  assert.deepEqual(segs.slice(-2).map((s) => s.kind), ['directory', 'end']);
  assert.equal(segs.find((s) => s.kind === 'directory')!.from, l.directory!.at);
  assert.equal(segs.filter((s) => s.kind === 'stray' || s.kind === 'before').length, 0, 'nothing unclaimed in a clean zip');
});

test('the methods are the directory’s own, and agree with the listing’s guess for the two the shell reads', async () => {
  const bytes = demo('harbour-survey-2026.zip');
  const l = await list(bytes, 'harbour-survey-2026.zip');
  const methods = zipMethods(bytes.subarray(l.directory!.at, l.directory!.at + l.directory!.size));
  assert.ok(methods.length >= l.entries.length);
  const seen = new Set(methods.map(methodName));
  assert.ok(seen.has('deflate') && seen.has('stored'), [...seen].join(', '));
  for (const e of l.entries) if (e.kind === 'file' && !e.encrypted && !e.method && e.size! > 0) assert.equal(methodByListing(e), methodName(methods[e.index]!), e.path);
});

test('a prefix, bytes between entries and bytes after the end record are drawn as unclaimed', async () => {
  const zip = demo('tidemark-0.5.0.zip');
  const prefix = new Uint8Array(100).fill(0x41);
  const bytes = concat([prefix, zip, new Uint8Array(7)]);
  const l = await list(bytes, 'x.zip');
  const tailAt = Math.max(0, bytes.length - 65_557);
  const end = zipEndIn(bytes.subarray(tailAt), tailAt)!;
  const segs = archiveStrip(l, { end });
  covers(segs, bytes.length);
  assert.deepEqual([segs[0]!.kind, segs[0]!.to], ['before', 100]);
  assert.deepEqual([segs.at(-1)!.kind, segs.at(-1)!.to - segs.at(-1)!.from], ['stray', 7]);
  assert.equal(segs.at(-2)!.kind, 'end');
});

test('a plain tar: each entry is its header and its data blocks, and the end blocks close it', async () => {
  const bytes = tar([['notes/', ''], ['notes/a.md', '# A\n'], ['notes/b.txt', 'x'.repeat(1300)]], 10_240);
  const l = await list(bytes, 'notes.tar');
  const segs = archiveStrip(l);
  covers(segs, bytes.length);
  assert.deepEqual(segs.map((s) => [s.kind, s.to - s.from, s.header]), [
    ['entry', 512, 512],
    ['entry', 1024, 512],
    ['entry', 512 + 1536, 512],
    ['tar-end', 10_240 - 512 - 1024 - 2048, undefined],
  ]);
});

test('a tar.gz and a lone gzip are one packed stream between its header and trailer', async () => {
  for (const name of ['notes-backup.tar.gz', 'tide-table.txt.gz']) {
    const bytes = demo(name);
    const l = await list(bytes, name);
    const segs = archiveStrip(l, { head: bytes.subarray(0, 4096) });
    covers(segs, bytes.length);
    assert.deepEqual(segs.map((s) => s.kind), ['stream-head', 'stream', 'stream-tail'], name);
    assert.equal(segs[0]!.to, gzipHeaderLength(bytes));
    assert.equal(segs[2]!.to - segs[2]!.from, 8);
  }
  const named = gzipSync(enc('hello'));
  assert.equal(gzipHeaderLength(named), 10);
  const withName = concat([Uint8Array.of(0x1f, 0x8b, 8, 8, 0, 0, 0, 0, 0, 3), enc('a.txt\0'), named.subarray(10)]);
  assert.equal(gzipHeaderLength(withName), 16);
});

test('a 7z is its signature header, the packed blocks, then the header that lists the entries', () => {
  const listing: ArchiveListingLike = {
    format: '7z', entries: [], comment: null, truncated: null, skipped: 0, declared: 0, size: 1_000, unpacked: null, directory: { at: 900, size: 90 },
  };
  const segs = archiveStrip(listing);
  covers(segs, 1_000);
  assert.deepEqual(segs.map((s) => [s.kind, s.from, s.to]), [['stream-head', 0, 32], ['stream', 32, 900], ['directory', 900, 990], ['stray', 990, 1_000]]);
  const found = archiveStrip({ ...listing, directory: null });
  covers(found, 1_000);
  assert.deepEqual(found.map((s) => s.kind), ['stream-head', 'stream'], 'a header the shell searched for has no place to draw');
});

test('runs of small entries gather until few enough remain, still covering every byte; a gathered run holds its entries', () => {
  const segs: StripSegment[] = [];
  let at = 0;
  for (let i = 0; i < 20_000; i++) {
    const n = i === 5000 ? 5_000_000 : 100 + (i % 7);
    segs.push({ kind: 'entry', from: at, to: at + n, index: i, header: 30 });
    at += n;
  }
  segs.push({ kind: 'directory', from: at, to: at + 900_000 });
  at += 900_000;
  const out = gatherStrip(segs, 400);
  assert.ok(out.length <= 400, String(out.length));
  covers(out, at);
  assert.ok(out.some((s) => s.kind === 'entry' && s.index === 5000), 'the large one stays itself');
  assert.equal(out.at(-1)!.kind, 'directory');
  const order = new Map(segs.map((s, i) => [s.index ?? -1, i]));
  const run = out.find((s) => s.kind === 'entries')!;
  assert.ok(stripHolds(run, run.index!, order) && stripHolds(run, run.last!, order) && !stripHolds(run, 5000, order));
  assert.equal(out.reduce((s, x) => s + (x.count ?? (x.kind === 'entry' ? 1 : 0)), 0), 20_000);
});

test('widths are to scale, each at least the floor, and fill the width', () => {
  const segs: StripSegment[] = [
    { kind: 'before', from: 0, to: 1 },
    { kind: 'entry', from: 1, to: 9001, index: 0, header: 40 },
    { kind: 'entry', from: 9001, to: 9003, index: 1, header: 2 },
    { kind: 'directory', from: 9003, to: 9100 },
  ];
  const w = stripLayout(segs, 600, 4);
  assert.ok(Math.abs(w.reduce((s, x) => s + x.w, 0) - 600) < 1e-6);
  for (const x of w) assert.ok(x.w >= 4 - 1e-9);
  assert.ok(w[1]!.w > 500);
  w.forEach((x, i) => i > 0 && assert.ok(Math.abs(x.x - (w[i - 1]!.x + w[i - 1]!.w)) < 1e-9));
});

test('a stored record’s words: mode, octal, flags, method', () => {
  assert.equal(modeWords(0o100755), '-rwxr-xr-x');
  assert.equal(modeOctal(0o100755), '755');
  assert.equal(modeWords(0o40755), 'drwxr-xr-x');
  assert.equal(modeWords(0o104755), '-rwsr-xr-x');
  assert.deepEqual(flagWords(0x0808), ['sizes after the data', 'its name is UTF-8']);
  assert.equal(methodName(8), 'deflate');
  assert.equal(methodName(42), 'method 42');
  assert.equal(localHeaderOf(new Uint8Array(30)), null);
});
