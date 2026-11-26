// The archive reader (the browser twin of the Rust one): the same sanitising, sentences, caps and ordinals as the Rust reader, over
// archives built here by hand and the shared table both readers check (src-tauri/tests/fixtures/archives). `node:zlib`
// is the test's `inflate`; the module itself imports nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGunzip, deflateRawSync, gunzipSync, gzipSync, inflateRawSync } from 'node:zlib';
import {
  ARCHIVE_LIMITS,
  ArchiveError,
  ENTRY_CAP,
  crc32,
  listArchiveBytes,
  readArchiveEntryBytes,
  readArchiveHeadsBytes,
  sanitiseEntryName,
  type ArchiveHeadLike,
  type ArchiveLimits,
  type Inflate,
} from './archive-read.ts';

const inflate: Inflate = async (bytes, format) =>
  new Uint8Array(format === 'gzip' ? gunzipSync(bytes) : inflateRawSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }));

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const le = (n: number, width: 2 | 4): Uint8Array => {
  const b = new Uint8Array(width);
  for (let i = 0; i < width; i++) b[i] = Math.floor(n / 2 ** (8 * i)) & 0xff;
  return b;
};

// ---- zip builder ---------------------------------------------------------------------------------------------------

interface Z {
  name: string | Uint8Array;
  data?: Uint8Array;
  method?: number;
  declared?: number;
  crc?: number;
  flags?: number;
  dir?: boolean;
  dosDate?: number;
  dosTime?: number;
  extra?: Uint8Array;
  note?: string;
}

const dosDate = (y: number, m: number, d: number): number => ((y - 1980) << 9) | (m << 5) | d;
const dosTime = (h: number, mi: number, s: number): number => (h << 11) | (mi << 5) | (s >> 1);

function zip(entries: readonly Z[], comment = ''): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = typeof e.name === 'string' ? enc(e.name) : e.name;
    const raw = e.data ?? new Uint8Array(0);
    const method = e.method ?? 0;
    const packed = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const crc = e.crc ?? crc32(raw);
    const size = e.declared ?? raw.length;
    const flags = e.flags ?? 0x800;
    const date = e.dosDate ?? dosDate(2024, 3, 5);
    const time = e.dosTime ?? dosTime(14, 30, 10);
    const extra = e.extra ?? new Uint8Array(0);
    const note = enc(e.note ?? '');
    const local = concat([
      enc('PK\x03\x04'), le(20, 2), le(flags, 2), le(method, 2), le(time, 2), le(date, 2),
      le(crc, 4), le(packed.length, 4), le(size, 4), le(name.length, 2), le(0, 2), name, packed,
    ]);
    central.push(
      concat([
        enc('PK\x01\x02'), le(0x031e, 2), le(20, 2), le(flags, 2), le(method, 2), le(time, 2), le(date, 2),
        le(crc, 4), le(packed.length, 4), le(size, 4), le(name.length, 2), le(extra.length, 2), le(note.length, 2),
        le(0, 2), le(0, 2), le(e.dir ? 0x10 : 0, 4), le(offset, 4), name, extra, note,
      ]),
    );
    parts.push(local);
    offset += local.length;
  }
  const cd = concat(central);
  const endNote = enc(comment);
  return concat([
    ...parts, cd,
    enc('PK\x05\x06'), le(0, 2), le(0, 2), le(entries.length, 2), le(entries.length, 2),
    le(cd.length, 4), le(offset, 4), le(endNote.length, 2), endNote,
  ]);
}

// ---- tar builder ---------------------------------------------------------------------------------------------------

interface T {
  name: string;
  type?: string;
  data?: Uint8Array;
  link?: string;
  prefix?: string;
  mtime?: number;
  sizeField?: Uint8Array;
}

function header(name: Uint8Array, type: string, size: number, o: Pick<T, 'link' | 'prefix' | 'mtime' | 'sizeField'> = {}): Uint8Array {
  const h = new Uint8Array(512);
  h.set(name.subarray(0, 100), 0);
  h.set(enc('0000644\0'), 100);
  h.set(enc('0000000\0'), 108);
  h.set(enc('0000000\0'), 116);
  h.set(o.sizeField ?? enc(`${size.toString(8).padStart(11, '0')}\0`), 124);
  h.set(enc(`${(o.mtime ?? 1_700_000_000).toString(8).padStart(11, '0')}\0`), 136);
  h[156] = type.charCodeAt(0);
  if (o.link) h.set(enc(o.link), 157);
  h.set(enc('ustar\0'), 257);
  h.set(enc('00'), 263);
  if (o.prefix) h.set(enc(o.prefix), 345);
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.set(enc(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
  return h;
}

const pad = (b: Uint8Array): Uint8Array => concat([b, new Uint8Array((512 - (b.length % 512)) % 512)]);

const paxRecord = (key: string, value: string): Uint8Array => {
  const body = ` ${key}=${value}\n`;
  let len = body.length + 1;
  while (String(len).length + body.length !== len) len = String(len).length + body.length;
  return enc(`${len}${body}`);
};

function tar(entries: readonly T[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    const data = e.data ?? new Uint8Array(0);
    parts.push(pad(header(enc(e.name), e.type ?? '0', data.length, e)), pad(data));
  }
  parts.push(new Uint8Array(1024));
  return concat(parts);
}

const longName = (name: string): Uint8Array => {
  const data = concat([enc(name), new Uint8Array(1)]);
  return concat([pad(header(enc('././@LongLink'), 'L', data.length)), pad(data)]);
};

const rustSample = (): Uint8Array =>
  tar([
    { name: 'docs/', type: '5' },
    { name: 'docs/a.md', data: enc('# A\n') },
    { name: 'b.txt', data: enc('bee\n') },
    { name: 'link', type: '2', link: '../../etc/passwd' },
    { name: 'pax', type: 'g' },
    { name: 'c.txt', data: enc('sea\n') },
  ]);

const findAll = (bytes: Uint8Array, sig: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i + sig.length <= bytes.length; i++) if (dec(bytes.subarray(i, i + sig.length)) === sig) out.push(i);
  return out;
};

const refuses = (p: Promise<unknown>, code: ArchiveError['code'], message: string | RegExp) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ArchiveError, `an ArchiveError, got ${String(e)}`);
    assert.equal(e.code, code);
    if (typeof message === 'string') assert.equal(e.message, message);
    else assert.match(e.message, message);
    return true;
  });

const list = (bytes: Uint8Array, name = 'a.bin', limits?: ArchiveLimits) => listArchiveBytes(bytes, name, inflate, limits);
const read = (bytes: Uint8Array, index: number, name: string, limits?: ArchiveLimits) =>
  readArchiveEntryBytes(bytes, 'a.bin', index, name, inflate, limits);

// ---- names ---------------------------------------------------------------------------------------------------------

test('sanitising drops everything that could name a place', () => {
  const clean = (raw: string) => sanitiseEntryName(raw, false)?.path;
  assert.equal(clean('../../evil.txt'), 'evil.txt');
  assert.equal(clean('/etc/passwd'), 'etc/passwd');
  assert.equal(clean('C:\\Windows\\win.ini'), 'Windows/win.ini');
  assert.equal(clean('a/../../b.txt'), 'a/b.txt');
  assert.equal(clean('//?/C:/x/y'), 'x/y');
  assert.equal(clean('\\\\?\\D:\\x'), 'x');
  assert.equal(clean('./a//b/./c'), 'a/b/c');
  assert.equal(clean('a/C:/b'), 'a/C:/b');
  assert.equal(clean('tab\there'), 'tab\ufffdhere');
  assert.equal(sanitiseEntryName('docs/', true)?.path, 'docs/');
  assert.equal(sanitiseEntryName('docs', true)?.path, 'docs/');
  for (const none of ['', '/', '..', '../..', 'C:', 'C:\\', '//?/', './.']) assert.equal(sanitiseEntryName(none, false), null, none);
  assert.equal(sanitiseEntryName('docs\\a.md', false)?.changed, false);
  assert.equal(sanitiseEntryName('docs/', true)?.changed, false);
  assert.equal(sanitiseEntryName('docs', true)?.changed, false);
  for (const raw of ['../../evil.txt', '/etc/passwd', 'C:\\Windows\\win.ini', 'a//b', 'x\u0001y']) {
    assert.equal(sanitiseEntryName(raw, false)?.changed, true, raw);
  }
  assert.equal(sanitiseEntryName('a/b/c', false)?.depth, 3);
});

test('the CRC-32 is the standard one', () => {
  assert.equal(crc32(enc('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

// ---- zip -----------------------------------------------------------------------------------------------------------

test('a zip lists names, sizes, dates and folders, and reads stored and deflated entries', async () => {
  const body = enc('hello hello hello hello hello hello');
  const bytes = zip(
    [
      { name: 'docs/', dir: true },
      { name: 'docs/a.md', data: enc('# A\n') },
      { name: 'docs\\b.md', data: body, method: 8 },
      { name: '../../evil.txt', data: enc('evil') },
      { name: 'C:\\Windows\\win.ini', data: enc('ini') },
    ],
    'made by a test',
  );
  const l = await list(bytes);
  assert.ok(l);
  assert.equal(l.format, 'zip');
  assert.equal(l.comment, 'made by a test');
  assert.equal(l.declared, 5);
  assert.equal(l.size, bytes.length);
  assert.equal(l.truncated, null);
  assert.deepEqual(
    l.entries.map((e) => [e.index, e.path, e.kind]),
    [[0, 'docs/', 'dir'], [1, 'docs/a.md', 'file'], [2, 'docs/b.md', 'file'], [3, 'evil.txt', 'file'], [4, 'Windows/win.ini', 'file']],
  );
  assert.equal(l.entries[1]?.size, 4);
  assert.equal(l.entries[1]?.packed, 4);
  assert.equal(l.entries[2]?.size, body.length);
  assert.ok((l.entries[2]?.packed ?? Infinity) < body.length);
  assert.equal(l.entries[1]?.mtime, '2024-03-05T14:30:10');
  assert.equal(l.entries[2]?.rawName, null, 'backslashes alone do not set rawName');
  assert.equal(l.entries[3]?.rawName, '../../evil.txt');
  assert.equal(l.entries[4]?.rawName, 'C:\\Windows\\win.ini');
  assert.ok(l.entries.every((e) => !e.encrypted && e.method === null && e.link === null));
  assert.equal(dec(await read(bytes, 1, 'docs/a.md')), '# A\n');
  assert.equal(dec(await read(bytes, 2, 'docs/b.md')), dec(body));
  assert.equal(dec(await read(bytes, 3, 'evil.txt')), 'evil');
  assert.equal(dec(await read(bytes, 4, 'Windows/win.ini')), 'ini');
  await refuses(read(bytes, 0, 'docs/'), 'invalid', 'A folder has nothing to open.');
  await refuses(read(bytes, 1, 'docs/other.md'), 'invalid', 'The archive changed since it was listed.');
  await refuses(read(bytes, 9, 'x'), 'invalid', 'The archive changed since it was listed.');
});

test('a zip name without the UTF-8 flag reads as UTF-8 when valid, else CP437; a Unicode path extra needs its CRC', async () => {
  const unicodePath = (header: Uint8Array, path: string, crc = crc32(header)): Uint8Array => {
    const p = enc(path);
    return concat([le(0x7075, 2), le(5 + p.length, 2), new Uint8Array([1]), le(crc, 4), p]);
  };
  const cp = Uint8Array.of(...enc('caf'), 0x82, ...enc('.txt'));
  const bytes = zip([
    { name: cp, data: enc('x'), flags: 0 },
    { name: enc('caf\u00e9-utf8.txt'), data: enc('y'), flags: 0 },
    { name: cp, data: enc('z'), flags: 0, extra: unicodePath(cp, 'caf\u00e9-up.txt') },
    { name: cp, data: enc('w'), flags: 0, extra: unicodePath(cp, 'nope.txt', 1) },
  ]);
  const l = await list(bytes);
  assert.deepEqual(
    l?.entries.map((e) => e.path),
    ['caf\u00e9.txt', 'caf\u00e9-utf8.txt', 'caf\u00e9-up.txt', 'caf\u00e9.txt'],
  );
});

test('a Unicode path past the name cap is skipped though its stored name is short', async () => {
  const unicodePath = (header: Uint8Array, path: string): Uint8Array => {
    const p = enc(path);
    return concat([le(0x7075, 2), le(5 + p.length, 2), new Uint8Array([1]), le(crc32(header), 4), p]);
  };
  const stored = enc('a.txt');
  const long = `${'u'.repeat(40)}.txt`;
  const bytes = zip([
    { name: stored, data: enc('abcd'), flags: 0, extra: unicodePath(stored, long) },
    { name: enc('b.txt'), data: enc('abcd'), flags: 0, extra: unicodePath(enc('b.txt'), 'short.txt') },
  ]);
  const l = await list(bytes, 'a.bin', { ...ARCHIVE_LIMITS, nameBytes: 20 });
  assert.deepEqual(l?.entries.map((e) => e.path), ['short.txt']);
});

test('extended-timestamp and zip64 extras are read', async () => {
  const utc = concat([le(0x5455, 2), le(5, 2), new Uint8Array([1]), le(1_700_000_000, 4)]);
  const sat = concat([le(0x0001, 2), le(24, 2), le(4, 4), le(0, 4), le(4, 4), le(0, 4), le(0, 4), le(0, 4)]);
  const bytes = zip([{ name: 'plain.txt', data: enc('abcd'), extra: utc }, { name: 'big.bin', data: enc('abcd'), extra: sat }]);
  // Saturate big.bin's sizes and offset in its central record so the 0x0001 extra carries them.
  const at = findAll(bytes, 'PK\x01\x02')[1]!;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lho = view.getUint32(at + 42, true);
  for (const field of [20, 24, 42]) view.setUint32(at + field, 0xffffffff, true);
  view.setUint32(at + 46 + 'big.bin'.length + 4 + 16, lho, true);
  const l = await list(bytes);
  assert.equal(l?.entries[0]?.mtime, '2023-11-14T22:13:20Z');
  assert.equal(l?.entries[1]?.size, 4);
  assert.equal(l?.entries[1]?.packed, 4);
  assert.equal(dec(await read(bytes, 1, 'big.bin')), 'abcd');
});

test('a zip64 end record, a prefix before the archive and an empty zip still list', async () => {
  const inner = zip([{ name: 'in.txt', data: enc('data') }]);
  const prefixed = concat([enc('MZ self-extractor stub ........'), inner]);
  const l = await list(prefixed);
  assert.equal(l?.format, 'zip');
  assert.equal(l?.entries[0]?.path, 'in.txt');
  assert.equal(dec(await read(prefixed, 0, 'in.txt')), 'data');

  const empty = await list(zip([]));
  assert.deepEqual([empty?.entries.length, empty?.declared], [0, 0]);

  const body = zip([{ name: 'a.txt', data: enc('abcd') }, { name: 'b.txt', data: enc('efgh') }]);
  const eocd = body.length - 22;
  const cdSize = new DataView(body.buffer, body.byteOffset).getUint32(eocd + 12, true);
  const cdOff = new DataView(body.buffer, body.byteOffset).getUint32(eocd + 16, true);
  const rec64 = concat([enc('PK\x06\x06'), le(44, 4), le(0, 4), le(45, 2), le(45, 2), le(0, 4), le(0, 4), le(2, 4), le(0, 4), le(2, 4), le(0, 4), le(cdSize, 4), le(0, 4), le(cdOff, 4), le(0, 4)]);
  const locator = concat([enc('PK\x06\x07'), le(0, 4), le(eocd, 4), le(0, 4), le(1, 4)]);
  const sat = Uint8Array.from(body.subarray(eocd, eocd + 22));
  sat.fill(0xff, 8, 20);
  sat.fill(0xff, 16, 20);
  sat.set(le(0, 2), 4);
  sat.set(le(0, 2), 6);
  const z64 = concat([body.subarray(0, eocd), rec64, locator, sat]);
  const l64 = await list(z64);
  assert.equal(l64?.declared, 2);
  assert.deepEqual(l64?.entries.map((e) => e.path), ['a.txt', 'b.txt']);
  assert.equal(dec(await read(z64, 1, 'b.txt')), 'efgh');
});

test('a zip bomb is refused by its declaration or by its output, with the Rust sentences', async () => {
  const zeros = new Uint8Array(17 * 1024 * 1024);
  const bytes = zip([
    { name: 'lie.bin', data: zeros, method: 8, declared: 1024 },
    { name: 'big.bin', data: enc('tiny'), method: 8, declared: 20 * 1024 * 1024 },
  ]);
  await refuses(read(bytes, 0, 'lie.bin'), 'refused', 'lie.bin unpacks past the 16 MB an entry may open with, though it declares 1.0 KB.');
  await refuses(read(bytes, 1, 'big.bin'), 'refused', 'big.bin is 20.0 MB unpacked, over the 16 MB an entry may open with.');
  assert.equal(ENTRY_CAP, 16 * 1024 * 1024);
});

test('a bad CRC, a wrong length, a flag and a method are each turned away', async () => {
  const bytes = zip([
    { name: 'crc.txt', data: enc('abcd'), crc: 1 },
    { name: 'len.txt', data: enc('abcdef'), method: 8, declared: 5 },
    { name: 'locked.txt', data: enc('abcd'), flags: 0x801 },
    { name: 'bz.txt', data: enc('abcd'), method: 12 },
    { name: 'aes.txt', data: enc('abcd'), method: 99 },
    { name: 'odd.txt', data: enc('abcd'), method: 77 },
    { name: 'pp.txt', data: enc('abcd'), method: 98 },
  ]);
  await refuses(read(bytes, 0, 'crc.txt'), 'invalid', 'crc.txt does not match its check (CRC-32): the archive is damaged.');
  await refuses(read(bytes, 1, 'len.txt'), 'invalid', 'len.txt unpacks to 6 bytes, not the 5 it declares: the archive is damaged.');
  await refuses(read(bytes, 2, 'locked.txt'), 'refused', 'This entry is encrypted. The app does not ask for archive passwords.');
  await refuses(read(bytes, 3, 'bz.txt'), 'unsupported', 'bz.txt is compressed with bzip2, which this build does not read: the desktop app does.');
  await refuses(read(bytes, 4, 'aes.txt'), 'refused', /encrypted/);
  await refuses(read(bytes, 5, 'odd.txt'), 'unsupported', /method 77/);
  await refuses(read(bytes, 6, 'pp.txt'), 'unsupported', 'pp.txt is compressed with ppmd, which the app does not read.');
  const l = await list(bytes);
  assert.deepEqual(l?.entries.map((e) => e.encrypted), [false, false, true, false, true, false, false]);
  assert.deepEqual(l?.entries.map((e) => e.method), [null, null, null, 'bzip2', 'AES', 'method 77', 'ppmd']);
});

test('the caps stop a zip listing and say so', async () => {
  const bytes = zip([
    ...Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt`, data: enc('x') })),
    { name: 'n'.repeat(40), data: enc('x') },
    { name: 'a/b/c/d/e.txt', data: enc('x') },
    { name: '..', data: enc('x') },
  ]);
  const base = ARCHIVE_LIMITS;
  const tight = await list(bytes, 'a.zip', { ...base, entries: 3 });
  assert.equal(tight?.entries.length, 3);
  assert.equal(tight?.declared, 8);
  assert.equal(tight?.truncated, 'Listed the first 3 entries; the archive declares 8.');
  const skips = await list(bytes, 'a.zip', { ...base, nameBytes: 20, depth: 4 });
  assert.equal(skips?.entries.length, 5);
  assert.equal(skips?.skipped, 3, 'too long, too deep and nothing left after sanitising');
  assert.equal(skips?.truncated, null);
  const names = await list(bytes, 'a.zip', { ...base, listedBytes: 12 });
  assert.equal(names?.entries.length, 2);
  assert.equal(names?.truncated, 'Listed the first 2 entries: their names reach the 16 MB a listing may hold.');
});

test('a zip comment counts toward the listing name bytes, as the Rust reader counts it', async () => {
  const bytes = zip([
    { name: 'a.txt', data: enc('x'), note: 'c'.repeat(40) },
    { name: 'b.txt', data: enc('x') },
  ]);
  const listing = await list(bytes, 'a.zip', { ...ARCHIVE_LIMITS, listedBytes: 12 });
  assert.equal(listing?.entries.length, 0, 'the first entry weighs its name and its comment: 45 bytes');
  assert.equal(listing?.truncated, 'Listed the first 0 entries: their names reach the 16 MB a listing may hold.');
});

test('a split zip is named and a damaged directory lists what came before it', async () => {
  const split = zip([{ name: 'a.txt', data: enc('x') }]);
  split[split.length - 22 + 4] = 1;
  await assert.rejects(list(split), (e: unknown) => e instanceof ArchiveError && e.code === 'unsupported' && e.message === 'a zip split across several files is not read.');

  const two = zip([{ name: 'a.txt', data: enc('x') }, { name: 'b.txt', data: enc('y') }]);
  const [first, second] = findAll(two, 'PK\x01\x02') as [number, number];
  two[second] = 0x58;
  const l = await list(two);
  assert.equal(l?.entries.length, 1);
  assert.match(l?.truncated ?? '', /^The listing stopped at a damaged part: /);
  two[first] = 0x58;
  await refuses(list(two), 'invalid', /^The listing could not be read: /);
});

// ---- tar and gzip --------------------------------------------------------------------------------------------------

test('a plain tar and a tar.gz list and read, counting ordinals the way the tar crate does', async () => {
  const plain = rustSample();
  for (const [bytes, format] of [[plain, 'tar'], [new Uint8Array(gzipSync(plain)), 'tar.gz']] as const) {
    const l = await list(bytes);
    assert.ok(l);
    assert.equal(l.format, format);
    assert.deepEqual(
      l.entries.map((e) => [e.index, e.path, e.kind]),
      [[0, 'docs/', 'dir'], [1, 'docs/a.md', 'file'], [2, 'b.txt', 'file'], [3, 'link', 'link'], [5, 'c.txt', 'file']],
    );
    assert.equal(l.entries[1]?.size, 4);
    assert.equal(l.entries[1]?.packed, null);
    assert.equal(l.entries[1]?.mtime, '2023-11-14T22:13:20Z');
    assert.equal(l.entries[3]?.link, '../../etc/passwd');
    assert.equal(l.truncated, null);
    assert.equal(l.size, bytes.length);
    assert.equal(l.unpacked, format === 'tar.gz' ? plain.length : null);
    assert.equal(dec(await read(bytes, 1, 'docs/a.md')), '# A\n');
    assert.equal(dec(await read(bytes, 5, 'c.txt')), 'sea\n');
    await refuses(read(bytes, 0, 'docs/'), 'invalid', 'A folder has nothing to open.');
    await refuses(read(bytes, 3, 'link'), 'invalid', 'link is a link to ../../etc/passwd: links are not followed.');
    await refuses(read(bytes, 2, 'nope'), 'invalid', 'The archive changed since it was listed.');
    await refuses(read(bytes, 4, 'pax'), 'invalid', 'pax is not a file.');
  }
});

test('a GNU long name, a PAX path, a ustar prefix and a base-256 size apply to their entry and take no ordinal', async () => {
  const longPath = `deep/${'d'.repeat(120)}/file.txt`;
  const paxPath = `pax/${'p'.repeat(130)}/note.md`;
  const pax = concat([paxRecord('path', paxPath), paxRecord('mtime', '1700000100.5')]);
  const base256 = new Uint8Array(12);
  base256[0] = 0x80;
  base256[11] = 3;
  const bytes = concat([
    pad(header(enc('first.txt'), '0', 2)), pad(enc('hi')),
    longName(longPath), pad(header(enc('truncated'), '0', 5)), pad(enc('long!')),
    pad(header(enc('././@PaxHeader'), 'x', pax.length)), pad(pax), pad(header(enc('short'), '0', 4)), pad(enc('pax!')),
    pad(header(enc('tail.txt'), '0', 3, { prefix: 'usr/dir' })), pad(enc('pre')),
    pad(header(enc('b256.bin'), '0', 3, { sizeField: base256 })), pad(enc('b25')),
    new Uint8Array(1024),
  ]);
  for (const archive of [bytes, new Uint8Array(gzipSync(bytes))]) {
    const l = await list(archive);
    assert.deepEqual(
      l?.entries.map((e) => [e.index, e.path]),
      [[0, 'first.txt'], [1, longPath], [2, paxPath], [3, 'usr/dir/tail.txt'], [4, 'b256.bin']],
    );
    assert.equal(l?.entries[2]?.mtime, '2023-11-14T22:15:00Z');
    assert.equal(l?.entries[4]?.size, 3);
    assert.equal(dec(await read(archive, 1, longPath)), 'long!');
    assert.equal(dec(await read(archive, 2, paxPath)), 'pax!');
    assert.equal(dec(await read(archive, 3, 'usr/dir/tail.txt')), 'pre');
    assert.equal(dec(await read(archive, 4, 'b256.bin')), 'b25');
  }
});

test('a tar lists hostile names as plain paths, caps its listing and refuses by declaration', async () => {
  const names = ['../../evil.txt', '/etc/passwd', 'C:\\Windows\\win.ini', 'a/../../b.txt'];
  const want = ['evil.txt', 'etc/passwd', 'Windows/win.ini', 'a/b.txt'];
  const hostile = tar(names.map((name) => ({ name, data: enc(name) })));
  const l = await list(hostile);
  l?.entries.forEach((e, i) => {
    assert.equal(e.path, want[i]);
    assert.equal(e.rawName, names[i]);
  });
  for (const [i, e] of (l?.entries ?? []).entries()) assert.equal(dec(await read(hostile, i, e.path)), names[i]);

  const many = tar([
    ...Array.from({ length: 5 }, () => ({ name: 'f.txt', data: enc('x') })),
    { name: 'a/b/c/d/e/f.txt', data: enc('x') },
    { name: 'a-name-that-is-long-enough.txt', data: enc('x') },
  ]);
  const base = ARCHIVE_LIMITS;
  const three = await list(many, 'a.tar', { ...base, entries: 3 });
  assert.equal(three?.entries.length, 3);
  assert.equal(three?.truncated, 'Listed the first 3 entries; more follow.');
  const seven = await list(many, 'a.tar', { ...base, entries: 7 });
  assert.deepEqual([seven?.entries.length, seven?.truncated], [7, null]);
  const skips = await list(many, 'a.tar', { ...base, depth: 3, nameBytes: 20 });
  assert.deepEqual([skips?.entries.length, skips?.skipped], [5, 2]);
  const names12 = await list(many, 'a.tar', { ...base, listedBytes: 12 });
  assert.equal(names12?.entries.length, 2);
  assert.equal(names12?.truncated, 'Listed the first 2 entries: their names reach the 16 MB a listing may hold.');

  const big = tar([{ name: 'big.bin', data: new Uint8Array(5_000).fill(7) }]);
  const tight = { ...base, entry: 1_000 };
  await refuses(read(big, 0, 'big.bin', tight), 'refused', 'big.bin is 4.9 KB unpacked, over the 16 MB an entry may open with.');
  assert.equal((await read(big, 0, 'big.bin')).length, 5_000);
  await refuses(read(big.subarray(0, 512 + 1_000), 0, 'big.bin'), 'invalid', 'big.bin could not be read: the archive is damaged.');
});

test('a damaged tar lists what came before the damage', async () => {
  const bytes = tar([{ name: 'a.txt', data: enc('x') }, { name: 'b.txt', data: enc('y') }]);
  const second = Uint8Array.from(bytes);
  second[1024 + 148] = 0x5a;
  const l = await list(second);
  assert.equal(l?.entries.length, 1);
  assert.match(l?.truncated ?? '', /^The listing stopped at a damaged part: /);
  assert.equal(l?.unpacked, null);
  const first = Uint8Array.from(bytes);
  first[148] = 0x5a;
  await refuses(list(first), 'invalid', /^The listing could not be read: /);
});

test('a lone gz is one entry named by its header or its file name', async () => {
  const gz = new Uint8Array(gzipSync(enc('lone file body')));
  const l = await listArchiveBytes(gz, 'notes.txt.gz', inflate);
  assert.equal(l?.format, 'gz');
  assert.equal(l?.entries.length, 1);
  assert.equal(l?.entries[0]?.path, 'notes.txt');
  assert.equal(l?.entries[0]?.size, 14);
  assert.equal(l?.entries[0]?.mtime, null);
  assert.equal(l?.unpacked, null);
  assert.equal(dec(await readArchiveEntryBytes(gz, 'notes.txt.gz', 0, 'notes.txt', inflate)), 'lone file body');
  await assert.rejects(readArchiveEntryBytes(gz, 'notes.txt.gz', 1, 'notes.txt', inflate), /changed since it was listed/);
  assert.equal((await listArchiveBytes(gz, 'x.gz', inflate))?.entries[0]?.path, 'x');
  assert.equal((await listArchiveBytes(gz, '', inflate))?.entries[0]?.path, 'file');

  // FNAME and MTIME in the header win over the file name.
  const raw = new Uint8Array(deflateRawSync(enc('named')));
  const named = concat([
    Uint8Array.of(0x1f, 0x8b, 8, 8), le(1_700_000_000, 4), Uint8Array.of(0, 3), enc('../up/inner.txt\0'), raw,
    le(crc32(enc('named')), 4), le(5, 4),
  ]);
  const n = await listArchiveBytes(named, 'ignored.gz', inflate);
  assert.equal(n?.entries[0]?.path, 'up/inner.txt');
  assert.equal(n?.entries[0]?.rawName, '../up/inner.txt');
  assert.equal(n?.entries[0]?.mtime, '2023-11-14T22:13:20Z');
  assert.equal(dec(await readArchiveEntryBytes(named, 'ignored.gz', 0, 'up/inner.txt', inflate)), 'named');
});

test('7z, bzip2 and xz are named and left to the desktop app; random bytes are not an archive', async () => {
  const sevenZ = concat([Uint8Array.of(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4), new Uint8Array(64)]);
  await refuses(list(sevenZ), 'unsupported', 'This build does not read 7z: the desktop app does.');
  await refuses(read(sevenZ, 0, 'x'), 'unsupported', 'This build does not read 7z: the desktop app does.');
  const bz = concat([enc('BZh9'), Uint8Array.of(0x31, 0x41, 0x59, 0x26, 0x53, 0x59), new Uint8Array(32)]);
  const xz = concat([Uint8Array.of(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00), new Uint8Array(32)]);
  for (const b of [bz, xz]) await refuses(list(b), 'unsupported', 'This build does not read bzip2 or xz: the desktop app does.');
  const iso = new Uint8Array(40_000);
  iso.set(enc('CD001'), 32_769);
  const desktopOnly: [Uint8Array, string][] = [
    [Uint8Array.of(0x28, 0xb5, 0x2f, 0xfd, 0x20, 4, 0, 0, 0, 0), 'Zstandard'],
    [concat([enc('Rar!'), Uint8Array.of(0x1a, 0x07, 0x01, 0x00), new Uint8Array(32)]), 'RAR'],
    [concat([enc('MSCF'), new Uint8Array(40)]), 'cabinets'],
    [concat([enc('!<arch>\n'), new Uint8Array(70)]), 'Debian packages or ar archives'],
    [iso, 'ISO images'],
  ];
  for (const [b, name] of desktopOnly) await refuses(list(b), 'unsupported', `This build does not read ${name}: the desktop app does.`);

  let seed = 7;
  const next = () => (seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0) & 0xff;
  const noise = Uint8Array.from({ length: 4_096 }, next);
  noise[0] = 0x41;
  assert.equal(await list(noise), null);
  assert.equal(await list(new Uint8Array(0)), null);
  assert.equal(await list(enc('# just a markdown file\n')), null);
  await refuses(read(noise, 0, 'x'), 'invalid', 'This file is not an archive.');
});

// ---- hostile input -------------------------------------------------------------------------------------------------

test('mutated archives end as null, a listing or an ArchiveError, never another throw', async () => {
  const base = zip(
    [
      { name: 'docs/', dir: true },
      { name: 'docs/a.md', data: enc('# A\n') },
      { name: 'b.txt', data: enc('hello hello hello hello'), method: 8 },
      { name: '../x.txt', data: enc('x') },
    ],
    'comment',
  );
  const tgz = new Uint8Array(gzipSync(rustSample()));
  const plain = concat([
    rustSample().subarray(0, 512 * 4),
    longName(`n/${'x'.repeat(150)}`),
    pad(header(enc('cut'), '0', 1)), pad(enc('z')),
    new Uint8Array(1024),
  ]);

  let seed = 20_261_026;
  const rnd = (n: number): number => {
    seed = (Math.imul(seed ^ (seed >>> 15), 2_246_822_519) + 0x9e3779b9) >>> 0;
    return seed % n;
  };
  const mutate = (src: Uint8Array): Uint8Array => {
    let b: Uint8Array = Uint8Array.from(src);
    for (let k = 1 + rnd(4); k > 0; k--) {
      switch (rnd(5)) {
        case 0:
          b[rnd(b.length)] = rnd(256);
          break;
        case 1:
          b[rnd(b.length)] ^= 1 << rnd(8);
          break;
        case 2:
          b = b.slice(0, rnd(b.length + 1));
          break;
        case 3: {
          const at = rnd(b.length + 1);
          b = concat([b.subarray(0, at), Uint8Array.from({ length: 1 + rnd(8) }, () => rnd(256)), b.subarray(at)]);
          break;
        }
        default: {
          const at = rnd(b.length);
          b.fill(0xff, at, Math.min(b.length, at + 1 + rnd(4)));
        }
      }
      if (b.length === 0) b = Uint8Array.of(rnd(256));
    }
    return b;
  };

  let listings = 0;
  for (let i = 0; i < 600; i++) {
    const src = [base, tgz, plain][i % 3]!;
    const bytes = mutate(src);
    try {
      const l = await list(bytes);
      if (l === null) continue;
      listings++;
      for (const e of l.entries.slice(0, 8)) {
        try {
          const out = await read(bytes, e.index, e.path);
          assert.ok(out instanceof Uint8Array);
        } catch (err) {
          assert.ok(err instanceof ArchiveError, `read threw ${String(err)} on mutation ${i}`);
        }
      }
    } catch (err) {
      assert.ok(err instanceof ArchiveError, `list threw ${String(err)} on mutation ${i}`);
    }
  }
  assert.ok(listings > 100, `most mutations still list (${listings})`);
});

// ---- the shared table, heads ----------------------------------------------------------------------

const shared = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../../apps/desktop/src-tauri/tests/fixtures/archives/${name}`, import.meta.url)));

interface SharedRow {
  index: number;
  path: string;
  size: number | null;
  offset: number;
  crc: number | null;
  host: string | null;
  mode: number | null;
  flags: number | null;
  comment: string | null;
  head: { hex: string; whole: boolean } | { refused: string };
}
interface SharedArchive {
  format: string;
  directory: { at: number; size: number } | null;
  entries: SharedRow[];
}
const table = JSON.parse(
  readFileSync(new URL('../../../../apps/desktop/src-tauri/tests/fixtures/archives/expected.json', import.meta.url), 'utf8'),
) as { maxEach: number; archives: Record<string, SharedArchive> };

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const wantsOf = (l: { entries: readonly { index: number; path: string }[] }) => l.entries.map((e) => ({ index: e.index, name: e.path }));

function checkShared(listing: Awaited<ReturnType<typeof listArchiveBytes>>, want: SharedArchive, shift: number): void {
  assert.ok(listing);
  assert.equal(listing.format, want.format);
  assert.deepEqual(listing.directory && { at: listing.directory.at - shift, size: listing.directory.size }, want.directory);
  assert.equal(listing.entries.length, want.entries.length);
  listing.entries.forEach((e, i) => {
    const w = want.entries[i]!;
    const got = { ...e, offset: e.offset === null ? null : e.offset - shift };
    for (const key of ['index', 'path', 'size', 'offset', 'crc', 'host', 'mode', 'flags', 'comment'] as const) {
      assert.deepEqual(got[key], w[key], `${w.path} ${key}`);
    }
  });
}

function checkHeads(heads: readonly ArchiveHeadLike[], want: SharedArchive): void {
  assert.equal(heads.length, want.entries.length);
  heads.forEach((h, i) => {
    const w = want.entries[i]!;
    assert.equal(h.index, w.index);
    if ('refused' in w.head) assert.deepEqual([h.refused, h.bytes.length, h.whole], [w.head.refused, 0, false], w.path);
    else assert.deepEqual([h.refused, hex(h.bytes), h.whole], [null, w.head.hex, w.head.whole], w.path);
  });
}

test('the shared table: entry by entry, the same offset, CRC, system, mode, flags, comment and heads as the Rust reader', async () => {
  for (const name of ['shared.zip', 'shared.tar.gz']) {
    const bytes = shared(name);
    const want = table.archives[name]!;
    const listing = await listArchiveBytes(bytes, name, inflate);
    checkShared(listing, want, 0);
    checkHeads(await readArchiveHeadsBytes(bytes, name, wantsOf(listing!), table.maxEach, inflate), want);
  }
});

test('a prefix shifts every offset and the directory by its length', async () => {
  const prefix = enc("MZ a self-extractor's stub, 31 b");
  const bytes = concat([prefix, shared('shared.zip')]);
  const want = table.archives['shared.zip']!;
  const listing = await listArchiveBytes(bytes, 'p.zip', inflate);
  checkShared(listing, want, prefix.length);
  checkHeads(await readArchiveHeadsBytes(bytes, 'p.zip', wantsOf(listing!), table.maxEach, inflate), want);
});

test('ten heads of a tar.gz come from one pass, in the order asked', async () => {
  const bytes = shared('shared.tar.gz');
  const listing = (await listArchiveBytes(bytes, 's.tar.gz', inflate))!;
  const passes: (number | undefined)[] = [];
  const counted: Inflate = (b, f, limit) => {
    passes.push(limit);
    return inflate(b, f, limit);
  };
  const wants = wantsOf(listing).slice(1, 11).reverse();
  const heads = await readArchiveHeadsBytes(bytes, 's.tar.gz', wants, 1024, counted);
  // A look at the first block, to know it for a tar, then the one pass.
  assert.deepEqual(passes, [512, ARCHIVE_LIMITS.stream + 1]);
  assert.deepEqual(heads.map((h) => h.index), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  for (const h of heads) {
    const i = h.index - 1;
    assert.equal(dec(h.bytes), `file ${i}\n`.repeat(i * 9 + 1));
    assert.ok(h.whole && h.refused === null);
  }
});

test('whole says whether the entry ended; maxEach is clamped to 1 and to the per-head cap', async () => {
  const bytes = shared('shared.tar.gz');
  const wants = [
    { index: 1, name: 'src/f00.txt' },
    { index: 13, name: 'src/big.txt' },
  ];
  const big = 'a big line of text\n'.repeat(280);
  let got = await readArchiveHeadsBytes(bytes, 's.tar.gz', wants, 100, inflate);
  assert.deepEqual([dec(got[0]!.bytes), got[0]!.whole], ['file 0\n', true]);
  assert.deepEqual([dec(got[1]!.bytes), got[1]!.whole], [big.slice(0, 100), false]);
  got = await readArchiveHeadsBytes(bytes, 's.tar.gz', wants.slice(1), 2 ** 30, inflate);
  assert.deepEqual([got[0]!.bytes.length, got[0]!.whole], [big.length, true]);
  got = await readArchiveHeadsBytes(bytes, 's.tar.gz', wants.slice(0, 1), 0, inflate);
  assert.deepEqual([dec(got[0]!.bytes), got[0]!.whole], ['f', false]);
});

test('heads stop at the budget and leave the rest out', async () => {
  const bytes = shared('shared.zip');
  const listing = (await listArchiveBytes(bytes, 's.zip', inflate))!;
  const tight: ArchiveLimits = { ...ARCHIVE_LIMITS, heads: 3 * 64, head: 64 };
  let got = await readArchiveHeadsBytes(bytes, 's.zip', wantsOf(listing), 64, inflate, tight);
  assert.deepEqual(got.map((h) => h.index), [0, 1, 2]);
  got = await readArchiveHeadsBytes(bytes, 's.zip', wantsOf(listing), 2 ** 20, inflate, tight);
  assert.equal(got.length, 3);
  assert.equal(ARCHIVE_LIMITS.heads / ARCHIVE_LIMITS.head, 64);
});

test('a want that does not match is refused and the call goes on; a file that is no archive throws', async () => {
  for (const [name, top] of [['shared.zip', 'docs/'], ['shared.tar.gz', 'src/']] as const) {
    const got = await readArchiveHeadsBytes(shared(name), name, [
      { index: 1, name: 'not/what/was/listed' },
      { index: 999, name: 'gone' },
      { index: 0, name: top },
    ], 64, inflate);
    assert.deepEqual(got.map((h) => h.refused), [
      'The archive changed since it was listed.',
      'The archive changed since it was listed.',
      'A folder has nothing to open.',
    ], name);
  }
  const lone = new Uint8Array(gzipSync(enc('a lone file, longer than eight bytes')));
  const got = await readArchiveHeadsBytes(lone, 'lone.txt.gz', [{ index: 0, name: 'lone.txt' }, { index: 0, name: 'other' }], 8, inflate);
  assert.deepEqual([dec(got[0]!.bytes), got[0]!.whole, got[1]!.refused], ['a lone f', false, 'The archive changed since it was listed.']);
  await assert.rejects(
    readArchiveHeadsBytes(enc('just some text, not an archive'), 'plain.txt', [{ index: 0, name: 'x' }], 8, inflate),
    (e: unknown) => e instanceof ArchiveError && e.message === 'This file is not an archive.',
  );
});

test('a read by offset refuses a local header that names another entry', async () => {
  const bytes = zip([{ name: 'a.txt', data: enc('aaaa') }, { name: 'b.txt', data: enc('bbbb') }]);
  // b.txt's directory record now gives a.txt's local header (offset 0).
  const cd = bytes.findIndex((_, i) => i > 0 && bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 1 && bytes[i + 3] === 2);
  const second = cd + 46 + 5;
  bytes.set(le(0, 4), second + 42);
  const listing = (await listArchiveBytes(bytes, 'm.zip', inflate))!;
  assert.equal(listing.entries[1]!.offset, 0);
  await assert.rejects(readArchiveEntryBytes(bytes, 'm.zip', 1, 'b.txt', inflate), /The archive changed since it was listed\./);
  const [head] = await readArchiveHeadsBytes(bytes, 'm.zip', [{ index: 1, name: 'b.txt' }], 64, inflate);
  assert.deepEqual([head!.refused, head!.bytes.length], ['The archive changed since it was listed.', 0]);
  assert.equal(dec(await readArchiveEntryBytes(bytes, 'm.zip', 0, 'a.txt', inflate)), 'aaaa');
});

// ---- a gzip bomb ---------------------------------------------------------------------------------------------------

/** Gunzips only as far as `limit`, as the page's inflate does, and records what each call was asked and gave. */
function stoppingGunzip(): { inflate: Inflate; calls: { limit: number | undefined; got: number }[] } {
  const calls: { limit: number | undefined; got: number }[] = [];
  const inflate: Inflate = (bytes, format, limit) =>
    format !== 'gzip'
      ? Promise.resolve(new Uint8Array(inflateRawSync(bytes)))
      : new Promise((resolve, reject) => {
          const z = createGunzip();
          const parts: Buffer[] = [];
          let n = 0;
          const done = (): void => {
            const out = new Uint8Array(Buffer.concat(parts));
            calls.push({ limit, got: out.length });
            resolve(out);
          };
          z.on('data', (chunk: Buffer) => {
            parts.push(chunk);
            n += chunk.length;
            if (limit !== undefined && n >= limit) {
              z.pause();
              z.destroy();
              done();
            }
          });
          z.on('end', done);
          z.on('error', reject);
          z.end(bytes);
        });
  return { inflate, calls };
}

test('a tar.gz that unpacks past the stream cap is unpacked only that far, and the listing says where it stopped', async () => {
  const bomb = new Uint8Array(gzipSync(tar([
    { name: 'a.txt', data: enc('a\n') },
    { name: 'zeros.bin', data: new Uint8Array(8 * 1024 * 1024) },
    { name: 'z.txt', data: enc('z\n') },
  ])));
  const limits: ArchiveLimits = { ...ARCHIVE_LIMITS, stream: 1024 * 1024 };
  const { inflate: stopping, calls } = stoppingGunzip();
  const l = await listArchiveBytes(bomb, 'bomb.tar.gz', stopping, limits);
  assert.deepEqual(l?.entries.map((e) => e.path), ['a.txt', 'zeros.bin']);
  assert.equal(l?.truncated, 'Listed the first 2 entries: the walk stops after 1 MB of unpacked stream.');
  assert.ok(calls.length > 0 && calls.every((c) => c.limit !== undefined && c.limit <= limits.stream + 1 && c.got < 2 * 1024 * 1024), JSON.stringify(calls));
  await refuses(readArchiveEntryBytes(bomb, 'bomb.tar.gz', 2, 'z.txt', stopping, limits), 'refused', /^z\.txt lies past the first 1 MB of the unpacked stream, further than the app walks\.$/);
});

test('a lone gz is unpacked only one byte past what an entry may open with', async () => {
  const bomb = new Uint8Array(gzipSync(new Uint8Array(4 * 1024 * 1024).fill(0x61)));
  const limits: ArchiveLimits = { ...ARCHIVE_LIMITS, entry: 64 * 1024 };
  const { inflate: stopping, calls } = stoppingGunzip();
  await refuses(readArchiveEntryBytes(bomb, 'a.txt.gz', 0, 'a.txt', stopping, limits), 'refused', /^a\.txt unpacks past the /);
  assert.ok(calls.length > 0 && calls.every((c) => c.limit !== undefined && c.got < 1024 * 1024), JSON.stringify(calls));
});

test('the stream cap is 1 GB, and every gzip stream is asked for no more than one byte past it', async () => {
  const gz = new Uint8Array(gzipSync(tar([{ name: 'a.txt', data: enc('a\n') }])));
  const { inflate: stopping, calls } = stoppingGunzip();
  assert.equal(ARCHIVE_LIMITS.stream, 1024 ** 3);
  assert.deepEqual((await listArchiveBytes(gz, 'a.tar.gz', stopping))?.entries.map((e) => e.path), ['a.txt']);
  assert.deepEqual(calls.map((c) => c.limit), [512, 1024 ** 3 + 1]);
});