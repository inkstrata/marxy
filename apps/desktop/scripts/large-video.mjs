// A real MP4 past 2 GB that costs a few kilobytes of disk, for check:tauri's seek through marxy-file://.
// The frames are VP9, encoded in the page (WebCodecs) and handed here; the file is ftyp, moov, a `free` box `gap` bytes
// long that is never written (the file is sparse), then mdat. Every sample sits past the gap, so a player must seek there
// by Range to show a frame. Every frame is a key frame (no stss), so any time can be shown on its own.
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, writeSync } from 'node:fs';

const u8 = (n) => Buffer.from([n & 0xff]);
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const zeros = (n) => Buffer.alloc(n);
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]); };
const full = (type, version, flags, ...parts) => box(type, u8(version), Buffer.from([(flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...parts);
const MATRIX = Buffer.concat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);

/** The moov box for `sizes.length` frames at `fps`, the samples at `offsets`. */
function moov({ width, height, fps, sizes, offsets }) {
  const timescale = 1000;
  const delta = timescale / fps;
  const duration = sizes.length * delta;
  // vp09.00.10.08: profile 0, level 1.0, 8 bit, 4:2:0, BT.709.
  const vpcC = full('vpcC', 1, 0, u8(0), u8(10), u8((8 << 4) | (1 << 1)), u8(1), u8(1), u8(1), u16(0));
  const vp09 = box('vp09', zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x480000), u32(0x480000), zeros(4), u16(1), zeros(32), u16(0x18), u16(0xffff), vpcC);
  const stbl = box('stbl',
    full('stsd', 0, 0, u32(1), vp09),
    full('stts', 0, 0, u32(1), u32(sizes.length), u32(delta)),
    full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
    full('stsz', 0, 0, u32(0), u32(sizes.length), ...sizes.map(u32)),
    full('stco', 0, 0, u32(offsets.length), ...offsets.map(u32)));
  const minf = box('minf', full('vmhd', 0, 1, zeros(8)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl);
  const mdia = box('mdia',
    full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0)),
    full('hdlr', 0, 0, u32(0), Buffer.from('vide'), zeros(12), Buffer.from('VideoHandler\0')),
    minf);
  const trak = box('trak',
    full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(duration), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16)),
    mdia);
  return box('moov', full('mvhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)), trak);
}

/** Writes the MP4 to `file`, sparse on NTFS, and returns its size and where its samples start. */
export function writeLargeMp4(file, { width, height, fps, frames, gap }) {
  const ftyp = box('ftyp', Buffer.from('isom'), u32(512), Buffer.from('isomiso2mp41'));
  const sizes = frames.map((f) => f.length);
  const head = ftyp.length + moov({ width, height, fps, sizes, offsets: sizes.map(() => 0) }).length;
  const mdatAt = head + gap;
  if (mdatAt + 8 + sizes.reduce((a, b) => a + b, 0) > 0xffffffff) throw new Error('stco offsets are 32-bit');
  const offsets = [];
  let at = mdatAt + 8;
  for (const size of sizes) { offsets.push(at); at += size; }
  const fd = openSync(file, 'w');
  closeSync(fd);
  // Before any write past the end, or NTFS fills the gap with zeros on disk.
  if (process.platform === 'win32') execFileSync('fsutil', ['sparse', 'setflag', file], { stdio: 'ignore' });
  const out = openSync(file, 'r+');
  try {
    const front = Buffer.concat([ftyp, moov({ width, height, fps, sizes, offsets }), u32(gap), Buffer.from('free')]);
    writeSync(out, front, 0, front.length, 0);
    const mdat = Buffer.concat([u32(8 + sizes.reduce((a, b) => a + b, 0)), Buffer.from('mdat'), ...frames]);
    writeSync(out, mdat, 0, mdat.length, mdatAt);
  } finally {
    closeSync(out);
  }
  return { size: mdatAt + 8 + sizes.reduce((a, b) => a + b, 0), samplesAt: mdatAt + 8 };
}

/** The colour of frame `i` of `n` as the page paints it, `hsl(i * 360 / n, 100%, 50%)`. */
export function frameColour(i, n) {
  const h = (i * 360) / n / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  return [r, g, b].map((c) => Math.round(c * 255));
}
