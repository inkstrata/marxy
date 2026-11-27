// The facts of the pictures the shell decodes by hand or through `image` beyond the common web formats: the PNM family,
// farbfeld, DDS, a Photoshop file and an SVGZ, in the words and sentences of the Rust `image_facts` (src-tauri/src/facts,
// decode/psd.rs, decode/svgz.rs), for the memory shell and the browser build. Untrusted input: every read is bounds-checked
// and a malformed file is null, never a throw. Pure: no DOM, no I/O; an SVGZ is unpacked by the caller's `gunzip`.

export interface PictureRead {
  width: number;
  height: number;
  bitDepth: number | null;
  channels: string | null;
  /** Why the file, read, is not drawn after all. */
  refused?: string;
  /** What is drawn, where it is not the file's own pixels: a PSD's thumbnail. */
  note?: string;
}

const ascii = (u: Uint8Array, at: number, n: number): string => {
  let s = '';
  for (let i = at; i < at + n && i < u.length; i++) s += String.fromCharCode(u[i]!);
  return s;
};
const be16 = (u: Uint8Array, at: number): number => ((u[at] ?? 0) << 8) | (u[at + 1] ?? 0);
const be32 = (u: Uint8Array, at: number): number => be16(u, at) * 0x10000 + be16(u, at + 2);
const le32 = (u: Uint8Array, at: number): number => ((u[at] ?? 0) | ((u[at + 1] ?? 0) << 8) | ((u[at + 2] ?? 0) << 16)) + (u[at + 3] ?? 0) * 0x1000000;

/** As the decoder's pixel budget (`decode::MAX_PIXELS`). */
const MAX_PIXELS = 2 ** 26;
/** As `svgz::MAX_UNPACKED`. */
export const SVGZ_MAX_UNPACKED = 16 * 1024 * 1024;

export const PSD_NO_PREVIEW =
  "This Photoshop file was saved without a preview: it holds no thumbnail, and its flattened image was left out (Photoshop's Maximize Compatibility was off). Marxy does not draw layers.";
export const SVGZ_TOO_LARGE = `This SVGZ unpacks to more than ${SVGZ_MAX_UNPACKED / (1024 * 1024)} MB, past the most Marxy unpacks, so it is not drawn.`;
export const SVGZ_DAMAGED = 'This SVGZ does not unpack: its gzip stream is damaged.';

/** The picture format the bytes are, by a magic strong enough to name it (PNM's needs its header's shape too). */
export function pictureFormatOf(u: Uint8Array): string | null {
  if (ascii(u, 0, 4) === '8BPS' && (be16(u, 4) === 1 || be16(u, 4) === 2)) return 'psd';
  if (ascii(u, 0, 8) === 'farbfeld') return 'farbfeld';
  if (ascii(u, 0, 4) === 'DDS ' && le32(u, 4) === 124) return 'dds';
  const head = ascii(u, 0, 1024);
  if (/^P7\s/.test(head) && head.includes('ENDHDR')) return 'pam';
  const m = /^P([1-6])\s+(?:#[^\n]*\n\s*)*\d+\s+(?:#[^\n]*\n\s*)*\d+/.exec(head);
  if (m) return ({ 1: 'pbm', 4: 'pbm', 2: 'pgm', 5: 'pgm', 3: 'ppm', 6: 'ppm' } as Record<string, string>)[m[1]!]!;
  return null;
}

function pnm(u: Uint8Array, format: string): PictureRead | null {
  const text = ascii(u, 2, 4096);
  let width: number;
  let height: number;
  let max: number;
  let channels: string;
  if (format === 'pam') {
    const header = text.slice(0, Math.max(0, text.indexOf('ENDHDR')));
    const value = (key: string): string | undefined => new RegExp(`^\\s*${key}\\s+(\\S+)`, 'm').exec(header)?.[1];
    const n = (key: string): number => Number(value(key) ?? NaN);
    width = n('WIDTH');
    height = n('HEIGHT');
    max = Number.isFinite(n('MAXVAL')) ? n('MAXVAL') : 1;
    const tuple = value('TUPLTYPE') ?? '';
    const depth = n('DEPTH');
    channels = /^(BLACKANDWHITE|GRAYSCALE)$/.test(tuple)
      ? 'Gray'
      : /_ALPHA$/.test(tuple) && tuple !== 'RGB_ALPHA'
        ? 'GrayA'
        : tuple === 'RGB'
          ? 'RGB'
          : tuple === 'RGB_ALPHA'
            ? 'RGBA'
            : (['Gray', 'GrayA', 'RGB'][depth - 1] ?? 'RGBA');
  } else {
    const numbers = text
      .split('\n')
      .map((l) => l.split('#')[0]!)
      .join(' ')
      .trim()
      .split(/\s+/)
      .map(Number);
    width = numbers[0] ?? NaN;
    height = numbers[1] ?? NaN;
    max = format === 'pbm' ? 1 : (numbers[2] ?? NaN);
    channels = format === 'ppm' ? 'RGB' : 'Gray';
  }
  if (![width, height, max].every(Number.isInteger) || max < 1 || max > 65535) return null;
  return { width, height, bitDepth: 32 - Math.clz32(max), channels };
}

function farbfeld(u: Uint8Array): PictureRead {
  const width = be32(u, 8);
  const height = be32(u, 12);
  const need = 16 + width * height * 8;
  const f: PictureRead = { width, height, bitDepth: 16, channels: 'RGBA' };
  if (u.length < need) f.refused = `This farbfeld file is cut short: it holds ${u.length} bytes of the ${need} its pixels need.`;
  return f;
}

function dds(u: Uint8Array): PictureRead | null {
  if (u.length < 128) return null;
  const height = le32(u, 12);
  const width = le32(u, 16);
  const compressed = (le32(u, 80) & 0x4) !== 0;
  const fourcc = ascii(u, 84, 4);
  // As `image`'s DDS reader: the flags it requires and knows, the pixel format block's size, a DX10 header's fields.
  const REQUIRED = 0x1 | 0x2 | 0x4 | 0x1000;
  const KNOWN = REQUIRED | 0x8 | 0x20000 | 0x80000 | 0x800000;
  const flags = le32(u, 8);
  const dx10 = compressed && fourcc === 'DX10';
  const fault =
    (flags & (REQUIRED | ~KNOWN)) !== REQUIRED
      ? `its flags, 0x${flags.toString(16)}, lack the caps, height, width or pixel format, or name ones it does not know`
      : le32(u, 76) !== 32
        ? `its pixel format block says ${le32(u, 76)} bytes, not 32`
        : dx10 &&
            (u.length < 148 ||
              le32(u, 128) > 132 ||
              le32(u, 132) < 2 ||
              le32(u, 132) > 4 ||
              (le32(u, 136) !== 0 && le32(u, 136) !== 4) ||
              (le32(u, 132) === 4 && le32(u, 140) !== 1) ||
              le32(u, 144) > 4)
          ? 'its DX10 header is out of range'
          : null;
  if (fault) return { width, height, bitDepth: 8, channels: fourcc === 'DXT1' ? 'RGB' : 'RGBA', refused: `This DDS's header is not one Marxy's decoder reads: ${fault}.` };
  let headerLen = 128;
  let block: number | null = null;
  let name: string | null = null;
  if (!compressed) name = '';
  else if (fourcc === 'DXT1') block = 8;
  else if (fourcc === 'DXT3' || fourcc === 'DXT5') block = 16;
  else if (fourcc === 'DX10') {
    headerLen += 20;
    const dxgi = le32(u, 128);
    if (dxgi >= 70 && dxgi <= 72) block = 8;
    else if (dxgi >= 73 && dxgi <= 78) block = 16;
    else name = dxgi >= 79 && dxgi <= 81 ? 'BC4' : dxgi >= 82 && dxgi <= 84 ? 'BC5' : dxgi >= 94 && dxgi <= 96 ? 'BC6H' : dxgi >= 97 && dxgi <= 99 ? 'BC7' : `DXGI format ${dxgi}`;
  } else name = /^(ATI1|BC4U|BC4S)$/.test(fourcc) ? 'BC4' : /^(ATI2|BC5U|BC5S)$/.test(fourcc) ? 'BC5' : fourcc.trim();
  const f: PictureRead = { width, height, bitDepth: 8, channels: fourcc === 'DXT1' ? 'RGB' : 'RGBA' };
  if (name === '') f.refused = 'This DDS holds uncompressed pixels; Marxy draws only the block-compressed BC1 to BC3 (DXT1, DXT3, DXT5).';
  else if (name !== null) f.refused = `This DDS is compressed as ${name}; Marxy draws only BC1 to BC3 (DXT1, DXT3, DXT5).`;
  else if (width % 4 !== 0 || height % 4 !== 0) f.refused = `This DDS is ${width} by ${height}, not whole 4-pixel blocks, which Marxy's decoder needs.`;
  else {
    const need = headerLen + Math.ceil(width / 4) * Math.ceil(height / 4) * block!;
    if (u.length < need) f.refused = `This DDS is cut short: it holds ${u.length} bytes of the ${need} its first image needs.`;
  }
  return f;
}

/** Why a PSD's preview cannot be drawn, as `psd::find` says it; or where its thumbnail's JPEG starts when that is the preview; or null when the flattened image is. */
function psdPreview(u: Uint8Array, psb: boolean, channels: number, width: number, height: number, depth: number, mode: number): string | { thumbAt: number } | null {
  const damaged = (what: string): string => `This Photoshop file is damaged: ${what}.`;
  const len = u.length;
  if (len < 30) return damaged('it ends inside its header');
  const modeLen = be32(u, 26);
  const palette = mode === 2 && modeLen >= 768 && 30 + 768 <= len;
  let at = 30 + modeLen;
  if (at + 4 > len) return damaged('its colour data runs past the end of the file');
  const resStart = at + 4;
  const resEnd = resStart + be32(u, at);
  if (resEnd > len) return damaged('its image resources run past the end of the file');
  let merged: boolean | null = null;
  let thumb: number | null = null;
  let p = resStart;
  for (let i = 0; i < 4096 && p + 12 <= resEnd && ascii(u, p, 4) === '8BIM'; i++) {
    const id = be16(u, p + 4);
    const nameField = Math.ceil((1 + (u[p + 6] ?? 0)) / 2) * 2;
    const sizeAt = p + 6 + nameField;
    if (sizeAt + 4 > resEnd) return damaged("a resource's name runs past its section");
    const size = be32(u, sizeAt);
    const data = sizeAt + 4;
    if (data + size > resEnd) return damaged('a resource runs past the end of its section');
    if (id === 1057 && size >= 5) merged = u[data + 4] !== 0;
    if (id === 1036 && size > 28 && be32(u, data) === 1) thumb = data + 28;
    p = data + size + (size & 1);
  }
  const layWidth = psb ? 8 : 4;
  if (resEnd + layWidth > len) return damaged('it ends before its layers');
  const layLen = psb ? be32(u, resEnd) * 2 ** 32 + be32(u, resEnd + 4) : be32(u, resEnd);
  const imageAt = resEnd + layWidth + layLen;
  if (imageAt > len) return damaged('its layers run past the end of the file');
  const composite = ((): string | null => {
    if (merged === false) return PSD_NO_PREVIEW;
    const kinds: Record<number, [number, readonly number[]]> = { 0: [1, [1]], 1: [1, [8, 16]], 8: [1, [8, 16]], 2: [1, palette ? [8] : []], 3: [3, [8, 16]], 4: [4, [8, 16]] };
    const kind = kinds[mode];
    const what = mode === 7 ? 'multichannel colour' : mode === 9 ? 'Lab colour' : !kind ? `colour mode ${mode}` : !kind[1].includes(depth) ? `${depth}-bit samples` : channels < kind[0] ? `${channels} channels` : null;
    if (what) return `This Photoshop file holds no thumbnail, and its flattened image is in ${what}, which Marxy does not draw.`;
    if (width * height > MAX_PIXELS) {
      return `This Photoshop file holds no thumbnail, and its flattened image is too large to draw: ${width} x ${height} is ${width * height} pixels, past the ${MAX_PIXELS} a decode may hold.`;
    }
    if (imageAt + 2 > len) return damaged('it ends before its flattened image');
    const compression = be16(u, imageAt);
    const rowBytes = depth === 1 ? Math.ceil(width / 8) : width * (depth / 8);
    const needed = compression === 0 ? kind![0] * height * rowBytes : compression === 1 ? channels * height * (psb ? 4 : 2) : null;
    if (needed === null) return 'This Photoshop file holds no thumbnail, and its flattened image is zip-compressed, which Marxy does not draw.';
    if (imageAt + 2 + needed > len) return damaged('its flattened image is cut short');
    return null;
  })();
  if (composite === null) return null;
  return thumb === null ? composite : { thumbAt: thumb };
}

/** A JPEG's size from its first frame header, starting at `at`; null when it does not read. */
function jpegSize(u: Uint8Array, at: number): [number, number] | null {
  if (u[at] !== 0xff || u[at + 1] !== 0xd8) return null;
  let p = at + 2;
  for (let i = 0; i < 4096 && p + 4 <= u.length; i++) {
    if (u[p] !== 0xff) return null;
    const m = u[p + 1]!;
    if (m === 0xff) {
      p++;
      continue;
    }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return p + 9 <= u.length ? [be16(u, p + 7), be16(u, p + 5)] : null;
    if (m === 0xda || m === 0xd9) return null;
    p += 2 + be16(u, p + 2);
  }
  return null;
}

/** As `psd::thumbnail_shown`: the file's size within the budget and the same shape to a thumbnail pixel, else the thumbnail's. */
export function thumbnailShown(file: [number, number], thumb: [number, number]): [number, number] {
  const [w, h] = file;
  const [tw, th] = thumb;
  return w * h <= MAX_PIXELS && Math.abs(tw * h - th * w) <= Math.max(w, h) ? file : thumb;
}

function psd(u: Uint8Array): PictureRead | null {
  if (u.length < 26) return null;
  const psb = be16(u, 4) === 2;
  const channels = be16(u, 12);
  const height = be32(u, 14);
  const width = be32(u, 18);
  const depth = be16(u, 22);
  const mode = be16(u, 24);
  const side = psb ? 300_000 : 30_000;
  if (!width || !height || width > side || height > side || channels < 1 || channels > 56 || ![1, 8, 16, 32].includes(depth)) return null;
  const named: Record<number, string> = { 0: 'Gray', 1: 'Gray', 8: 'Gray', 2: 'Indexed', 3: 'RGB', 4: 'CMYK', 9: 'Lab' };
  const f: PictureRead = { width, height, bitDepth: depth, channels: named[mode] ?? null };
  const preview = psdPreview(u, psb, channels, width, height, depth, mode);
  if (typeof preview === 'string') f.refused = preview;
  else if (preview) {
    const thumb = jpegSize(u, preview.thumbAt) ?? [0, 0];
    const shown = thumbnailShown([width, height], thumb);
    if (shown[0] === width && shown[1] === height) {
      f.note = `Drawn from the thumbnail Photoshop stores (${thumb[0]} by ${thumb[1]}), enlarged to the file's size: the file's flattened image is not one Marxy can draw.`;
    } else {
      [f.width, f.height] = shown;
      f.note = `Drawn from the thumbnail Photoshop stores, at its own ${thumb[0]} by ${thumb[1]}: the file is ${width} by ${height}, which Marxy does not decode in full.`;
    }
  }
  return f;
}

/** The facts of a picture `pictureFormatOf` named, or null when its header does not read. */
export function pictureFacts(u: Uint8Array, format: string): PictureRead | null {
  if (format === 'psd') return psd(u);
  if (format === 'farbfeld') return u.length >= 16 ? farbfeld(u) : null;
  if (format === 'dds') return dds(u);
  return pnm(u, format);
}
