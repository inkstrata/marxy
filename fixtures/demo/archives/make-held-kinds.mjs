// Writes held-kinds.zip beside this file: a database, a workbook, a font and a recording the demo already holds, for
// the readers that take an archive's entry from memory. Built by hand, as make-shared.mjs builds its
// zips, so neither reader under test writes its own fixture. usage: node make-held-kinds.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

const here = new URL('./', import.meta.url);
const demo = new URL('../', here);
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

const DOS_TIME = (9 << 11) | (0 << 5) | 0;
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 18;

// The workbook is a zip already: stored, as an archiver would leave it.
const entries = [
  { name: 'data/gauges.sqlite', method: 8 },
  { name: 'sheets/tide-log-2026.xlsx', method: 0 },
  { name: 'fonts/TidemarkSans-Regular.ttf', method: 8 },
  { name: 'media/bell-buoy.wav', method: 8 },
].map((e) => ({ ...e, data: new Uint8Array(readFileSync(new URL(e.name, demo))) }));

const locals = [];
const centrals = [];
let offset = 0;
for (const e of entries) {
  const name = enc(e.name);
  const packed = e.method === 8 ? new Uint8Array(deflateRawSync(e.data, { level: 9 })) : e.data;
  const crc = crc32(e.data);
  const common = [le(20, 2), le(0, 2), le(e.method, 2), le(DOS_TIME, 2), le(DOS_DATE, 2), le(crc, 4), le(packed.length, 4), le(e.data.length, 4), le(name.length, 2), le(0, 2)];
  const local = concat([le(0x04034b50, 4), ...common, name, packed]);
  centrals.push(concat([le(0x02014b50, 4), le(0x0314, 2), ...common, le(0, 2), le(0, 2), le(0, 2), le(0o100644 * 0x1_0000, 4), le(offset, 4), name]));
  locals.push(local);
  offset += local.length;
}
const directory = concat(centrals);
const end = concat([le(0x06054b50, 4), le(0, 2), le(0, 2), le(entries.length, 2), le(entries.length, 2), le(directory.length, 4), le(offset, 4), le(0, 2)]);
writeFileSync(new URL('held-kinds.zip', here), concat([...locals, directory, end]));
