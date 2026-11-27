// Writes shared.zip, shared.tar.gz and expected.json beside this file: the table the Rust reader (src/archive) and its
// TypeScript twin (packages/core/src/viewer/archive-read.ts) both test against, entry by entry. The archives are built
// by hand here, independent of both readers. usage: node make-shared.mjs
import { writeFileSync } from 'node:fs';
import { deflateRawSync, gzipSync } from 'node:zlib';

const here = new URL('./', import.meta.url);
const enc = (s) => new TextEncoder().encode(s);
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const le = (n, width) => {
  const b = new Uint8Array(width);
  for (let i = 0; i < width; i++) b[i] = Math.floor(n / 2 ** (8 * i)) & 0xff;
  return b;
};
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** The size each expected head is asked at. */
const MAX_EACH = 64;
const FOLDER = 'A folder has nothing to open.';
const ENCRYPTED = 'This entry is encrypted. The app does not ask for archive passwords.';

const headOf = (data, refused) =>
  refused !== undefined ? { refused } : { hex: hex(data.subarray(0, MAX_EACH)), whole: data.length <= MAX_EACH };

// ---- the zip ---------------------------------------------------------------------------------------------------------

const DOS_TIME = (14 << 11) | (30 << 5) | 5;
const DOS_DATE = ((2024 - 1980) << 9) | (3 << 5) | 5;
const unix = (mode) => mode * 0x1_0000;

const zipEntries = [
  { name: 'docs/', madeBy: 0x031e, ext: unix(0o40755) + 0x10, data: enc(''), refused: FOLDER },
  {
    name: 'docs/readme.md',
    madeBy: 0x031e,
    ext: unix(0o100644),
    method: 8,
    data: enc(`# Read me\n\n${'A line of the readme.\n'.repeat(40)}`),
    comment: enc('the first thing to read'),
    shown: 'the first thing to read',
  },
  {
    name: 'notes.txt',
    madeBy: 0x0014,
    ext: 0x20,
    flags: 0x800,
    data: enc('notes\n'),
    comment: enc('café\tnotes'),
    shown: 'café�notes',
  },
  { name: 'run.sh', madeBy: 0x0314, ext: unix(0o100755), data: enc('#!/bin/sh\necho hi\n') },
  {
    name: 'locked.bin',
    madeBy: 0x0a14,
    ext: 0x20,
    flags: 0x0001,
    data: Uint8Array.from({ length: 16 }, (_, i) => i),
    refused: ENCRYPTED,
  },
  { name: 'mac.txt', madeBy: 0x1314, ext: 0, method: 8, data: enc('mac line\n'.repeat(30)) },
  { name: 'odd.dat', madeBy: 0x0714, ext: 0, data: Uint8Array.of(1, 2, 3, 4) },
];

const HOSTS = { 0: 'DOS or Windows', 3: 'Unix', 10: 'Windows NTFS', 11: 'VFAT', 19: 'macOS' };

function buildZip() {
  const locals = [];
  const central = [];
  const expected = [];
  let offset = 0;
  zipEntries.forEach((e, index) => {
    const name = enc(e.name);
    const method = e.method ?? 0;
    const flags = e.flags ?? 0;
    const packed = method === 8 ? new Uint8Array(deflateRawSync(e.data, { level: 9 })) : e.data;
    const crc = crc32(e.data);
    const comment = e.comment ?? new Uint8Array(0);
    const local = concat([
      enc('PK\x03\x04'), le(20, 2), le(flags, 2), le(method, 2), le(DOS_TIME, 2), le(DOS_DATE, 2),
      le(crc, 4), le(packed.length, 4), le(e.data.length, 4), le(name.length, 2), le(0, 2), name, packed,
    ]);
    central.push(
      concat([
        enc('PK\x01\x02'), le(e.madeBy, 2), le(20, 2), le(flags, 2), le(method, 2), le(DOS_TIME, 2), le(DOS_DATE, 2),
        le(crc, 4), le(packed.length, 4), le(e.data.length, 4), le(name.length, 2), le(0, 2), le(comment.length, 2),
        le(0, 2), le(0, 2), le(e.ext, 4), le(offset, 4), name, comment,
      ]),
    );
    const host = e.madeBy >> 8;
    const mode = host === 3 && Math.floor(e.ext / 0x1_0000) !== 0 ? Math.floor(e.ext / 0x1_0000) : null;
    expected.push({
      index,
      path: e.name,
      size: e.data.length,
      offset,
      crc,
      host: HOSTS[host] ?? `system ${host}`,
      mode,
      flags,
      comment: e.shown ?? null,
      head: headOf(e.data, e.refused),
    });
    locals.push(local);
    offset += local.length;
  });
  const cd = concat(central);
  const archiveComment = enc('shared fixture');
  const end = concat([
    enc('PK\x05\x06'), le(0, 2), le(0, 2), le(zipEntries.length, 2), le(zipEntries.length, 2),
    le(cd.length, 4), le(offset, 4), le(archiveComment.length, 2), archiveComment,
  ]);
  return {
    bytes: concat([...locals, cd, end]),
    expected: { format: 'zip', directory: { at: offset, size: cd.length }, entries: expected },
  };
}

// ---- the tar.gz ------------------------------------------------------------------------------------------------------

const octal = (n, width) => enc(`${n.toString(8).padStart(width - 1, '0')}\0`);

function tarHeader(name, mode, size, type) {
  const h = new Uint8Array(512);
  h.set(enc(name), 0);
  h.set(octal(mode, 8), 100);
  h.set(octal(0, 8), 108);
  h.set(octal(0, 8), 116);
  h.set(octal(size, 12), 124);
  h.set(octal(1_700_000_000, 12), 136);
  h.fill(0x20, 148, 156);
  h[156] = type.charCodeAt(0);
  h.set(enc('ustar\x0000'), 257);
  const sum = h.reduce((a, b) => a + b, 0);
  h.set(enc(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
  return h;
}

function buildTarGz() {
  const files = [{ name: 'src/', mode: 0o755, type: '5', data: new Uint8Array(0), refused: FOLDER }];
  for (let i = 0; i <= 10; i++) {
    files.push({ name: `src/f${String(i).padStart(2, '0')}.txt`, mode: 0o644, type: '0', data: enc(`file ${i}\n`.repeat(i * 9 + 1)) });
  }
  files.push({ name: 'src/run.sh', mode: 0o755, type: '0', data: enc('#!/bin/sh\n') });
  files.push({ name: 'src/big.txt', mode: 0o644, type: '0', data: enc('a big line of text\n'.repeat(280)) });
  const parts = [];
  const expected = [];
  let offset = 0;
  files.forEach((f, index) => {
    const header = tarHeader(f.name, f.mode, f.data.length, f.type);
    const padded = new Uint8Array(Math.ceil(f.data.length / 512) * 512);
    padded.set(f.data);
    expected.push({
      index,
      path: f.name,
      size: f.type === '0' ? f.data.length : null,
      offset,
      crc: null,
      host: null,
      mode: f.mode,
      flags: null,
      comment: null,
      head: headOf(f.data, f.refused),
    });
    parts.push(header, padded);
    offset += 512 + padded.length;
  });
  parts.push(new Uint8Array(1024));
  return {
    bytes: new Uint8Array(gzipSync(concat(parts), { level: 9 })),
    expected: { format: 'tar.gz', directory: null, entries: expected },
  };
}

const zip = buildZip();
const tgz = buildTarGz();
writeFileSync(new URL('shared.zip', here), zip.bytes);
writeFileSync(new URL('shared.tar.gz', here), tgz.bytes);
const table = {
  _note: 'Written by make-shared.mjs. Read by src/archive (Rust) and packages/core/src/viewer/archive-read.test.ts.',
  maxEach: MAX_EACH,
  archives: { 'shared.zip': zip.expected, 'shared.tar.gz': tgz.expected },
};
writeFileSync(new URL('expected.json', here), `${JSON.stringify(table, null, 2)}\n`);
