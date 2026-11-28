import { listArchiveBytes, ARCHIVE_LIMITS } from '../../../../../packages/core/src/viewer/archive-read.ts';
import { archiveTree } from '../../../../../packages/core/src/viewer/archive.ts';
const te = new TextEncoder();
const crc = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return (b) => { let c = ~0; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; }; })();
function zip(names) {
  const parts = []; const cds = []; let off = 0;
  for (const n of names) {
    const nb = te.encode(n); const body = te.encode('x'); const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc(body), 14); h.writeUInt32LE(1, 18); h.writeUInt32LE(1, 22); h.writeUInt16LE(nb.length, 26);
    parts.push(h, nb, body);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc(body), 16); c.writeUInt32LE(1, 20); c.writeUInt32LE(1, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    cds.push(c, nb); off += 30 + nb.length + 1;
  }
  const cd = Buffer.concat(cds); const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(names.length, 8); e.writeUInt16LE(names.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, e]));
}
function tar(names) {
  const out = [];
  for (const n of names) { const h = Buffer.alloc(512); h.write(n, 0); h.write('0000644\0', 100); h.write('00000000001\0', 124); h.write('0', 156); h.write('ustar\0', 257); h.write('        ', 148); let s = 0; for (const x of h) s += x; h.write(s.toString(8).padStart(6, '0') + '\0 ', 148); out.push(h, Buffer.alloc(512, 0x78 === 0 ? 0 : 0)); }
  out.push(Buffer.alloc(1024)); return new Uint8Array(Buffer.concat(out));
}
const inflate = async () => { throw new Error('no'); };
const L = { ...ARCHIVE_LIMITS, entries: 10, nameBytes: 20, depth: 4, listedBytes: 100 };
async function show(label, bytes, lim = L) { const r = await listArchiveBytes(bytes, 'a', inflate, lim); const t = archiveTree(r.entries); console.log(label, 'entries', r.entries.length, 'skipped', r.skipped, 'trunc', JSON.stringify(r.truncated), 'declared', r.declared, 'treefiles', t.files); }
for (const mk of [['zip', zip], ['tar', tar]]) {
  const [k, f] = mk;
  for (const n of [9, 10, 11]) await show(`${k} entries ${n}`, f(Array.from({ length: n }, (_, i) => `f${i}`)));
  for (const n of [19, 20, 21]) await show(`${k} nameBytes ${n}`, f(['a'.repeat(n), 'ok']));
  for (const d of [3, 4, 5]) await show(`${k} depth ${d}`, f([Array.from({ length: d }, () => 'd').join('/') + '/f', 'ok']));
  for (const w of [9, 10, 11]) await show(`${k} listed w${w}`, f(Array.from({ length: 12 }, (_, i) => 'n'.repeat(w - String(i).length) + i)), { ...L, entries: 100 });
}
