// A picture's own structure: a PNG's chunks, a JPEG's segments, a WebP's RIFF chunks, each at its
// offset with its length, walked from the file's bytes a range at a time. Pure over a reader of ranges: nothing is decoded.
// A JPEG's scan runs to the next marker, so it is read through to find its end; past `SCAN_MAX` bytes the walk stops there.

export interface ImageChunk {
  /** Its name as the format writes it: `IHDR`, `APP1`, `VP8L`. */
  readonly type: string;
  readonly at: number;
  /** Its bytes, its header included. */
  readonly length: number;
  /** Its header's bytes: the type and length, which x-ray marks. */
  readonly head: number;
}

export interface ImageStructure {
  /** What a part is called in the format: `chunk` or `segment`. */
  readonly word: 'chunk' | 'segment';
  readonly chunks: readonly ImageChunk[];
  /** Why the walk stopped short of the file's end, when it did. */
  readonly stopped: string | null;
}

type Read = (at: number, n: number) => Promise<Uint8Array>;

const MAX_PARTS = 4096;
/** The most of a JPEG's scan data read through to find where it ends. */
export const SCAN_MAX = 32 * 1024 * 1024;
/** The most of a run of 0xFF fill bytes read between two JPEG markers. */
export const FILL_MAX = 1024 * 1024;

const ascii = (b: Uint8Array, from: number, n: number): string => String.fromCharCode(...b.subarray(from, from + n));
const u32be = (b: Uint8Array, o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u32le = (b: Uint8Array, o: number): number => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

const JPEG_NAMES: Readonly<Record<number, string>> = {
  0xd8: 'SOI', 0xd9: 'EOI', 0xda: 'SOS', 0xdb: 'DQT', 0xc4: 'DHT', 0xdd: 'DRI', 0xfe: 'COM', 0xcc: 'DAC', 0x01: 'TEM',
};

export function jpegName(m: number): string {
  if (JPEG_NAMES[m]) return JPEG_NAMES[m]!;
  if (m >= 0xe0 && m <= 0xef) return `APP${m - 0xe0}`;
  if (m >= 0xc0 && m <= 0xcf) return `SOF${m - 0xc0}`;
  if (m >= 0xd0 && m <= 0xd7) return `RST${m - 0xd0}`;
  return `0x${m.toString(16).toUpperCase().padStart(2, '0')}`;
}

async function png(read: Read, size: number): Promise<ImageStructure> {
  const chunks: ImageChunk[] = [{ type: 'signature', at: 0, length: 8, head: 8 }];
  let at = 8;
  while (at + 12 <= size && chunks.length < MAX_PARTS) {
    const h = await read(at, 8);
    if (h.length < 8) break;
    const length = 12 + u32be(h, 0);
    const type = ascii(h, 4, 4);
    chunks.push({ type, at, length: Math.min(length, size - at), head: 8 });
    at += length;
    if (type === 'IEND') break;
  }
  return { word: 'chunk', chunks, stopped: at < size && chunks.at(-1)?.type !== 'IEND' ? `the chunks stop at byte ${at}` : null };
}

async function webp(read: Read, size: number): Promise<ImageStructure> {
  const chunks: ImageChunk[] = [{ type: 'RIFF', at: 0, length: 12, head: 12 }];
  let at = 12;
  while (at + 8 <= size && chunks.length < MAX_PARTS) {
    const h = await read(at, 8);
    if (h.length < 8) break;
    const body = u32le(h, 4);
    chunks.push({ type: ascii(h, 0, 4).trim(), at, length: Math.min(8 + body, size - at), head: 8 });
    at += 8 + body + (body & 1);
  }
  return { word: 'chunk', chunks, stopped: null };
}

async function jpeg(read: Read, size: number): Promise<ImageStructure> {
  const chunks: ImageChunk[] = [{ type: 'SOI', at: 0, length: 2, head: 2 }];
  let at = 2;
  while (at + 2 <= size && chunks.length < MAX_PARTS) {
    const h = await read(at, 4);
    if (h[0] !== 0xff) return { word: 'segment', chunks, stopped: `no marker at byte ${at}` };
    const m = h[1]!;
    if (m === 0xff) {
      // Fill bytes: skipped a block at a time, and counted against FILL_MAX so a file of them cannot hold the walk.
      let p = at + 1;
      let found = false;
      while (p < size && p - at <= FILL_MAX) {
        const block = await read(p, Math.min(64 * 1024, size - p));
        if (block.length === 0) break;
        const i = block.findIndex((x) => x !== 0xff);
        if (i >= 0) {
          at = p + i - 1;
          found = true;
          break;
        }
        p += block.length;
      }
      if (!found) return { word: 'segment', chunks, stopped: p >= size ? 'the file ends in fill bytes' : `fill bytes run past ${FILL_MAX} bytes; read no further` };
      continue;
    }
    if (m === 0xd9 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      chunks.push({ type: jpegName(m), at, length: 2, head: 2 });
      at += 2;
      if (m === 0xd9) return { word: 'segment', chunks, stopped: null };
      continue;
    }
    let length = 2 + ((h[2]! << 8) | h[3]!);
    if (m === 0xda) {
      // The scan's data runs to the next marker that is not a stuffed byte or a restart.
      let end = at + length;
      const limit = Math.min(size, at + SCAN_MAX);
      let found = false;
      while (!found && end < limit) {
        const block = await read(end, Math.min(64 * 1024, limit - end));
        if (block.length === 0) break;
        for (let i = 0; i + 1 < block.length; i++) {
          const next = block[i + 1]!;
          if (block[i] === 0xff && next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7)) {
            end += i;
            found = true;
            break;
          }
        }
        if (!found) end += Math.max(1, block.length - 1);
      }
      length = end - at;
      if (!found) {
        chunks.push({ type: 'SOS', at, length: Math.min(length, size - at), head: 2 });
        return { word: 'segment', chunks, stopped: end >= size ? 'the file ends inside the scan' : `the scan is past ${SCAN_MAX} bytes; read no further` };
      }
    }
    chunks.push({ type: jpegName(m), at, length: Math.min(length, size - at), head: m === 0xda ? 2 + ((h[2]! << 8) | h[3]!) : 4 });
    at += length;
  }
  return { word: 'segment', chunks, stopped: at < size ? `the segments stop at byte ${at}` : null };
}

/** The structure of the picture whose first bytes are `head`, or null for a format not walked here (GIF, HEIC, SVG). */
export async function imageStructure(head: Uint8Array, size: number, read: Read): Promise<ImageStructure | null> {
  if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 3) === 'PNG') return png(read, size);
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return jpeg(read, size);
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return webp(read, size);
  return null;
}
