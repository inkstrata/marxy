// An image's facts read from its own bytes, in the shape of shell-api's `ImageFacts` (the Rust `image_facts` command's
// contract): enough of PNG, JPEG, GIF, WebP, BMP, ICO, SVG, HEIF's and AVIF's item boxes, and the pictures of
// `picture-facts.ts` (PNM, farbfeld, DDS, PSD, SVGZ) for the memory shell (the browser build and the tests) and
// for the page when the shell has no reader. Untrusted input: every read is bounds-checked and a malformed file is null
// or partial, never a throw. Pure: no DOM, no I/O; an ICC profile packed with zlib is unpacked by the caller's `inflate`.

import { pictureFacts, pictureFormatOf, SVGZ_DAMAGED, SVGZ_MAX_UNPACKED, SVGZ_TOO_LARGE } from './picture-facts.ts';
import { budget } from '../util/budget.ts';

export interface ImageExif {
  camera?: string;
  lens?: string;
  exposure?: string;
  aperture?: string;
  iso?: number;
  focalLength?: string;
  taken?: string;
  software?: string;
}

/** shell-api's `ImageFacts`, restated here so core imports nothing (the desktop's typecheck holds the two equal). */
export interface ImageFactsLike {
  format: string;
  width: number;
  height: number;
  orientation: number;
  bitDepth: number | null;
  channels: string | null;
  colorProfile: string | null;
  frames: number;
  show: 'webview' | 'decoded' | 'none';
  why: string | null;
  exif: ImageExif | null;
  location: { lat: number; lon: number } | null;
  /** What is drawn, where it is not the file's own pixels (a PSD's thumbnail); absent otherwise. */
  note?: string | null;
}

export interface FactsOptions {
  /**
   * Unpacks zlib (deflate with a header); absent, a PNG's packed ICC profile is named by its keyword only. With `limit`
   * it may stop once it holds that many bytes (or more).
   */
  inflate?: (packed: Uint8Array, limit?: number) => Promise<Uint8Array>;
  /** Formats this reader's system draws; the rest are `show: "none"` with `why`. */
  drawable?: ReadonlySet<string>;
  /** The system's name, for `why`: "Windows", "this browser". */
  system?: string;
  /** A Windows without the codec: the HEIC sentence names the two Store extensions that would draw it. */
  windows?: boolean;
  /** The file's lower-case extension: only a name says a gzip stream is an SVGZ. */
  extension?: string;
  /** Unpacks gzip, stopping once past `cap` bytes (so a bomb costs at most that); null when the stream is damaged. */
  gunzip?: (packed: Uint8Array, cap: number) => Promise<Uint8Array | null>;
}

const DEFAULT_DRAWABLE: ReadonlySet<string> = new Set(['png', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']);

const ascii = (u: Uint8Array, at: number, n: number): string => {
  let s = '';
  for (let i = at; i < at + n && i < u.length; i++) s += String.fromCharCode(u[i]!);
  return s;
};

/** A reader over `u` that answers 0 past its end rather than throwing. */
class Reader {
  readonly u: Uint8Array;
  readonly le: boolean;
  readonly base: number;
  constructor(u: Uint8Array, le: boolean, base = 0) {
    this.u = u;
    this.le = le;
    this.base = base;
  }
  u8(o: number): number {
    return this.u[this.base + o] ?? 0;
  }
  u16(o: number): number {
    const a = this.u8(o);
    const b = this.u8(o + 1);
    return this.le ? a | (b << 8) : (a << 8) | b;
  }
  u32(o: number): number {
    const a = this.u16(o);
    const b = this.u16(o + 2);
    return (this.le ? a + b * 0x10000 : a * 0x10000 + b) >>> 0;
  }
  within(o: number, n: number): boolean {
    return o >= 0 && this.base + o + n <= this.u.length;
  }
}

// ---- EXIF (a TIFF structure) ---------------------------------------------------------------------------------------

type TagValue = number | string | readonly [number, number][] | readonly number[];

const TYPE_SIZE: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function readIfd(r: Reader, at: number): Map<number, TagValue> {
  const tags = new Map<number, TagValue>();
  if (!r.within(at, 2)) return tags;
  const n = Math.min(r.u16(at), 512);
  for (let i = 0; i < n; i++) {
    const e = at + 2 + i * 12;
    if (!r.within(e, 12)) break;
    const tag = r.u16(e);
    const type = r.u16(e + 2);
    const count = r.u32(e + 4);
    const size = (TYPE_SIZE[type] ?? 0) * count;
    if (size === 0 || count > 1 << 16) continue;
    const off = size <= 4 ? e + 8 : r.u32(e + 8);
    if (!r.within(off, size)) continue;
    if (type === 2) tags.set(tag, ascii(r.u, r.base + off, count).replace(/\0[\s\S]*$/, '').trim());
    else if (type === 5 || type === 10) {
      const v: [number, number][] = [];
      for (let k = 0; k < count && k < 8; k++) v.push([r.u32(off + k * 8), r.u32(off + k * 8 + 4)]);
      tags.set(tag, v);
    } else if (type === 3) tags.set(tag, count === 1 ? r.u16(off) : Array.from({ length: Math.min(count, 8) }, (_, k) => r.u16(off + k * 2)));
    else if (type === 4 || type === 9) tags.set(tag, count === 1 ? r.u32(off) : Array.from({ length: Math.min(count, 8) }, (_, k) => r.u32(off + k * 4)));
    else if (type === 1 || type === 7) tags.set(tag, count === 1 ? r.u8(off) : Array.from({ length: Math.min(count, 8) }, (_, k) => r.u8(off + k)));
  }
  return tags;
}

const rational = (v: TagValue | undefined, k = 0): number | null => {
  if (!Array.isArray(v)) return null;
  const pair = v[k] as [number, number] | undefined;
  return pair && pair[1] ? pair[0] / pair[1] : null;
};
const str = (v: TagValue | undefined): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: TagValue | undefined): number | undefined => (typeof v === 'number' ? v : Array.isArray(v) && typeof v[0] === 'number' ? (v[0] as number) : undefined);

const trimNumber = (n: number): string => (Math.round(n * 10) / 10).toString();

export interface ExifRead {
  orientation: number;
  exif: ImageExif | null;
  location: { lat: number; lon: number } | null;
}

/** Orientation, the camera's notes and the place, from a TIFF structure at `u[at]` (EXIF's body). */
export function readExif(u: Uint8Array, at = 0): ExifRead {
  const none: ExifRead = { orientation: 1, exif: null, location: null };
  const order = ascii(u, at, 2);
  if (order !== 'II' && order !== 'MM') return none;
  const r = new Reader(u, order === 'II', at);
  if (r.u16(2) !== 42) return none;
  const ifd0 = readIfd(r, r.u32(4));
  const sub = typeof ifd0.get(0x8769) === 'number' ? readIfd(r, ifd0.get(0x8769) as number) : new Map<number, TagValue>();
  const gps = typeof ifd0.get(0x8825) === 'number' ? readIfd(r, ifd0.get(0x8825) as number) : new Map<number, TagValue>();
  const o = num(ifd0.get(0x112)) ?? 1;
  const exif: ImageExif = {};
  const make = str(ifd0.get(0x10f));
  const model = str(ifd0.get(0x110));
  // Many cameras repeat the maker in the model ("Canon" "Canon EOS R5").
  const camera = model && make && model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0]!) ? model : [make, model].filter(Boolean).join(' ');
  if (camera) exif.camera = camera;
  const lens = str(sub.get(0xa434));
  if (lens) exif.lens = lens;
  const et = rational(sub.get(0x829a));
  if (et !== null && et > 0) exif.exposure = et < 1 ? `1/${Math.round(1 / et)} s` : `${trimNumber(et)} s`;
  const fn = rational(sub.get(0x829d));
  if (fn !== null && fn > 0) exif.aperture = `f/${trimNumber(fn)}`;
  const iso = num(sub.get(0x8827));
  if (iso !== undefined && iso > 0) exif.iso = iso;
  const fl = rational(sub.get(0x920a));
  if (fl !== null && fl > 0) exif.focalLength = `${trimNumber(fl)} mm`;
  const taken = str(sub.get(0x9003)) ?? str(ifd0.get(0x132));
  if (taken) exif.taken = taken;
  const software = str(ifd0.get(0x131));
  if (software) exif.software = software;
  let location: ExifRead['location'] = null;
  const dms = (v: TagValue | undefined): number | null => {
    const d = rational(v, 0);
    const m = rational(v, 1);
    const s = rational(v, 2);
    return d === null ? null : d + (m ?? 0) / 60 + (s ?? 0) / 3600;
  };
  const lat = dms(gps.get(2));
  const lon = dms(gps.get(4));
  if (lat !== null && lon !== null) {
    location = { lat: str(gps.get(1)) === 'S' ? -lat : lat, lon: str(gps.get(3)) === 'W' ? -lon : lon };
  }
  return { orientation: o >= 1 && o <= 8 ? o : 1, exif: Object.keys(exif).length > 0 ? exif : null, location };
}

// ---- ICC -----------------------------------------------------------------------------------------------------------

/** The most bytes of an ICC profile read, as of a HEIF's `meta`: a real profile is a few kilobytes, rarely a megabyte. */
export const ICC_MAX_BYTES = 4 * 1024 * 1024;

/** The colour row for a profile past `ICC_MAX_BYTES`: its name, and that it was not read. */
const iccPast = (name: string): string => `${name} (over ${ICC_MAX_BYTES / (1024 * 1024)} MB, not read)`;

/** An ICC profile's description (its `desc` tag, v2 `desc` or v4 `mluc`), or null. */
export function iccDescription(icc: Uint8Array): string | null {
  const r = new Reader(icc, false);
  if (!r.within(128, 4)) return null;
  const n = Math.min(r.u32(128), 100);
  for (let i = 0; i < n; i++) {
    const e = 132 + i * 12;
    if (!r.within(e, 12)) return null;
    if (ascii(icc, e, 4) !== 'desc') continue;
    const off = r.u32(e + 4);
    const size = r.u32(e + 8);
    if (!r.within(off, Math.min(size, 12))) return null;
    const type = ascii(icc, off, 4);
    if (type === 'desc') {
      const len = r.u32(off + 8);
      return ascii(icc, off + 12, Math.min(len, 256)).replace(/\0[\s\S]*$/, '').trim() || null;
    }
    if (type === 'mluc') {
      const recSize = r.u32(off + 12);
      if (r.u32(off + 8) < 1 || recSize < 12) return null;
      const len = r.u32(off + 16 + 4);
      const at = r.u32(off + 16 + 8);
      let s = '';
      for (let k = 0; k + 1 < len && k < 512; k += 2) s += String.fromCharCode(r.u16(off + at + k));
      return s.replace(/\0[\s\S]*$/, '').trim() || null;
    }
    return null;
  }
  return null;
}

// ---- the formats ---------------------------------------------------------------------------------------------------

type Read = Omit<ImageFactsLike, 'show' | 'why'>;

const base = (format: string): Read => ({ format, width: 0, height: 0, orientation: 1, bitDepth: null, channels: null, colorProfile: null, frames: 1, exif: null, location: null });

const PNG_CHANNELS: Readonly<Record<number, string>> = { 0: 'Gray', 2: 'RGB', 3: 'Indexed', 4: 'GrayA', 6: 'RGBA' };

async function png(u: Uint8Array, opts: FactsOptions): Promise<Read> {
  const f = base('png');
  const r = new Reader(u, false);
  f.width = r.u32(16);
  f.height = r.u32(20);
  f.bitDepth = r.u8(24);
  const colour = r.u8(25);
  f.channels = PNG_CHANNELS[colour] ?? null;
  for (let at = 8; r.within(at, 8); ) {
    const len = r.u32(at);
    const type = ascii(u, at + 4, 4);
    const data = at + 8;
    if (type === 'IDAT' || type === 'IEND') break;
    if (type === 'tRNS' && (colour === 0 || colour === 2)) f.channels = colour === 0 ? 'GrayA' : 'RGBA';
    if (type === 'acTL') f.frames = Math.max(1, r.u32(data));
    if (type === 'sRGB' && f.colorProfile === null) f.colorProfile = 'sRGB';
    if (type === 'iCCP' && r.within(data, len)) {
      const body = u.subarray(data, data + len);
      const nul = body.indexOf(0);
      const keyword = ascii(body, 0, Math.max(0, nul));
      f.colorProfile = keyword || 'an embedded profile';
      if (opts.inflate && nul >= 0) {
        try {
          // One byte past the limit says the profile is longer, without unpacking the rest of a bomb.
          const icc = await opts.inflate(body.subarray(nul + 2), ICC_MAX_BYTES + 1);
          f.colorProfile = icc.length > ICC_MAX_BYTES ? iccPast(f.colorProfile) : (iccDescription(icc) ?? f.colorProfile);
        } catch {
          // A profile that does not unpack keeps its keyword.
        }
      }
    }
    if (type === 'eXIf' && r.within(data, len)) Object.assign(f, readExif(u, data));
    at = data + len + 4;
  }
  return f;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpeg(u: Uint8Array): Read {
  const f = base('jpeg');
  const r = new Reader(u, false);
  const icc: Uint8Array[] = [];
  const iccBytes = budget(ICC_MAX_BYTES);
  for (let at = 2; r.within(at, 4); ) {
    if (r.u8(at) !== 0xff) break;
    const marker = r.u8(at + 1);
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const len = r.u16(at + 2);
    const data = at + 4;
    if (marker === 0xe1 && ascii(u, data, 6) === 'Exif\0\0') Object.assign(f, readExif(u, data + 6));
    if (marker === 0xe2 && ascii(u, data, 12) === 'ICC_PROFILE\0' && r.within(data, len - 2)) {
      const part = u.subarray(data + 14, data + len - 2);
      if (iccBytes.take(part.length)) icc.push(part);
    }
    if (SOF.has(marker)) {
      f.bitDepth = r.u8(data);
      f.height = r.u16(data + 1);
      f.width = r.u16(data + 3);
      const comps = r.u8(data + 5);
      f.channels = comps === 1 ? 'Gray' : comps === 3 ? 'RGB' : null;
    }
    at = data + len - 2;
  }
  if (iccBytes.hit) f.colorProfile = iccPast('an embedded profile');
  else if (icc.length > 0) {
    const all = new Uint8Array(icc.reduce((n, p) => n + p.length, 0));
    let k = 0;
    for (const p of icc) {
      all.set(p, k);
      k += p.length;
    }
    f.colorProfile = iccDescription(all) ?? 'an embedded profile';
  }
  return f;
}

function gif(u: Uint8Array): Read {
  const f = base('gif');
  const r = new Reader(u, true);
  f.width = r.u16(6);
  f.height = r.u16(8);
  f.channels = 'Indexed';
  f.bitDepth = 8;
  const packed = r.u8(10);
  let at = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
  let frames = 0;
  let transparent = false;
  const skipBlocks = (o: number): number => {
    let p = o;
    while (r.within(p, 1)) {
      const n = r.u8(p);
      p += 1 + n;
      if (n === 0) break;
    }
    return p;
  };
  for (let guard = 0; r.within(at, 1) && guard < 100_000; guard++) {
    const b = r.u8(at);
    if (b === 0x3b) break;
    if (b === 0x21) {
      if (r.u8(at + 1) === 0xf9 && r.u8(at + 3) & 1) transparent = true;
      at = skipBlocks(at + 2);
    } else if (b === 0x2c) {
      frames++;
      const lp = r.u8(at + 9);
      at += 10 + (lp & 0x80 ? 3 * (1 << ((lp & 7) + 1)) : 0);
      at = skipBlocks(at + 1);
    } else break;
  }
  f.frames = Math.max(1, frames);
  if (transparent) f.channels = 'Indexed';
  return f;
}

async function webp(u: Uint8Array, opts: FactsOptions): Promise<Read> {
  const f = base('webp');
  const r = new Reader(u, true);
  f.bitDepth = 8;
  f.channels = 'RGB';
  let frames = 0;
  for (let at = 12; r.within(at, 8); ) {
    const type = ascii(u, at, 4);
    const len = r.u32(at + 4);
    const data = at + 8;
    if (type === 'VP8 ' && f.width === 0) {
      f.width = r.u16(data + 6) & 0x3fff;
      f.height = r.u16(data + 8) & 0x3fff;
    } else if (type === 'VP8L' && f.width === 0) {
      const bits = r.u32(data + 1);
      f.width = (bits & 0x3fff) + 1;
      f.height = ((bits >>> 14) & 0x3fff) + 1;
      if ((bits >>> 28) & 1) f.channels = 'RGBA';
    } else if (type === 'VP8X') {
      const flags = r.u8(data);
      if (flags & 0x10) f.channels = 'RGBA';
      f.width = (r.u8(data + 4) | (r.u8(data + 5) << 8) | (r.u8(data + 6) << 16)) + 1;
      f.height = (r.u8(data + 7) | (r.u8(data + 8) << 8) | (r.u8(data + 9) << 16)) + 1;
    } else if (type === 'ANMF') frames++;
    else if (type === 'ALPH') f.channels = 'RGBA';
    else if (type === 'EXIF' && r.within(data, len)) Object.assign(f, readExif(u, ascii(u, data, 6) === 'Exif\0\0' ? data + 6 : data));
    else if (type === 'ICCP' && r.within(data, len)) f.colorProfile = iccDescription(u.subarray(data, data + len)) ?? 'an embedded profile';
    at = data + len + (len & 1);
  }
  f.frames = Math.max(1, frames);
  void opts;
  return f;
}

function bmp(u: Uint8Array): Read {
  const f = base('bmp');
  const r = new Reader(u, true);
  f.width = r.u32(18) | 0;
  f.height = Math.abs(r.u32(22) | 0);
  const bpp = r.u16(28);
  f.bitDepth = bpp <= 8 ? bpp : 8;
  f.channels = bpp <= 8 ? 'Indexed' : bpp === 32 ? 'RGBA' : 'RGB';
  return f;
}

function ico(u: Uint8Array): Read {
  const f = base('ico');
  const r = new Reader(u, true);
  const n = r.u16(4);
  // The largest picture in the directory is the one a viewer shows.
  for (let i = 0; i < n && i < 64; i++) {
    const e = 6 + i * 16;
    if (!r.within(e, 16)) break;
    const w = r.u8(e) || 256;
    const h = r.u8(e + 1) || 256;
    if (w * h > f.width * f.height) {
      f.width = w;
      f.height = h;
      const bpp = r.u16(e + 6);
      f.bitDepth = bpp > 8 ? 8 : bpp || null;
      f.channels = bpp === 32 ? 'RGBA' : bpp > 8 ? 'RGB' : bpp > 0 ? 'Indexed' : null;
    }
  }
  f.frames = Math.max(1, n);
  return f;
}

// ---- HEIF and AVIF (ISO base media boxes) --------------------------------------------------------------------------

/** The most bytes of `meta` read, as the Rust reader holds it; a grid image's item tables are a few kilobytes. */
const MAX_META_BYTES = 4 * 1024 * 1024;

/** The boxes in `u[from, to)`: type and content range. A size that runs past the end stops the walk. */
function boxes(u: Uint8Array, from: number, to: number): { type: string; s: number; e: number }[] {
  const r = new Reader(u, false);
  const out: { type: string; s: number; e: number }[] = [];
  for (let at = from; at + 8 <= to && out.length < 4096; ) {
    let size = r.u32(at);
    let header = 8;
    if (size === 1) {
      size = r.u32(at + 8) * 0x1_0000_0000 + r.u32(at + 12);
      header = 16;
    } else if (size === 0) size = to - at;
    if (size < header || at + size > to) break;
    out.push({ type: ascii(u, at + 4, 4), s: at + header, e: at + size });
    at += size;
  }
  return out;
}

/**
 * EXIF orientation (1-8) for HEIF's `irot` and `imir`, as `isobmff.rs`'s `orientation`: the turn before the mirror,
 * as Windows' decoder draws it whatever the order listed (MIAF files list clap, irot, imir anyway); `imir` 1 swaps left
 * and right, 0 top and bottom.
 */
function heifOrientation(listed: readonly [number, number][]): number {
  const transforms = [...listed].sort((a, b) => a[0] - b[0]);
  let flip = false;
  let quarters = 0;
  for (const [kind, value] of transforms) {
    if (kind === 0) quarters = (quarters + 4 - (value & 3)) % 4;
    else if (value === 1) {
      flip = !flip;
      quarters = (4 - quarters) % 4;
    } else {
      flip = !flip;
      quarters = (4 - ((quarters + 2) % 4)) % 4;
    }
  }
  const table: Record<string, number> = { 'false0': 1, 'true0': 2, 'false2': 3, 'true2': 4, 'true3': 5, 'false1': 6, 'true1': 7, 'false3': 8 };
  return table[`${flip}${quarters}`] ?? 1;
}

/** The primary item's size (`ispe`, cropped by `clap`), depth, channels and turn; width 0 when the boxes do not say. */
function heif(u: Uint8Array, format: string): Read {
  const f = base(format);
  const r = new Reader(u, false);
  const meta = boxes(u, 0, u.length).find((b) => b.type === 'meta');
  if (!meta || meta.e - meta.s > MAX_META_BYTES + 4) return f;
  const inMeta = boxes(u, meta.s + 4, meta.e);
  const pitm = inMeta.find((b) => b.type === 'pitm');
  const primary = pitm ? (r.u8(pitm.s) === 0 ? r.u16(pitm.s + 4) : r.u32(pitm.s + 4)) : null;
  const iprp = inMeta.find((b) => b.type === 'iprp');
  if (!iprp) return f;
  const inIprp = boxes(u, iprp.s, iprp.e);
  const ipco = inIprp.find((b) => b.type === 'ipco');
  const ipma = inIprp.find((b) => b.type === 'ipma');
  const props = ipco ? boxes(u, ipco.s, ipco.e) : [];
  const associated: number[] = [];
  if (ipma) {
    const version = r.u8(ipma.s);
    const wide = (r.u8(ipma.s + 3) & 1) === 1;
    const count = Math.min(r.u32(ipma.s + 4), 65_536);
    let at = ipma.s + 8;
    for (let i = 0; i < count && at < ipma.e && associated.length === 0; i++) {
      const id = version < 1 ? r.u16(at) : r.u32(at);
      at += version < 1 ? 2 : 4;
      const n = r.u8(at);
      at += 1;
      if (primary === null || primary === id) {
        for (let k = 0; k < n && at + k * (wide ? 2 : 1) < ipma.e; k++) associated.push(wide ? r.u16(at + k * 2) & 0x7fff : r.u8(at + k) & 0x7f);
      }
      at += n * (wide ? 2 : 1);
    }
  }
  const transforms: [number, number][] = [];
  let clap: [number, number] | null = null;
  for (const i of associated) {
    const p = props[i - 1];
    if (!p) continue;
    if (p.type === 'ispe' && r.within(p.s, 12)) {
      f.width = r.u32(p.s + 4);
      f.height = r.u32(p.s + 8);
    } else if (p.type === 'clap' && r.within(p.s, 16)) {
      const side = (at: number): number => {
        const n = r.u32(at);
        const d = r.u32(at + 4);
        return d > 0 && n >= d ? Math.floor(n / d) : 0;
      };
      const w = side(p.s);
      const h = side(p.s + 8);
      if (w > 0 && h > 0) clap = [w, h];
    } else if (p.type === 'pixi' && r.within(p.s, 6)) {
      const n = r.u8(p.s + 4);
      f.bitDepth = r.u8(p.s + 5);
      f.channels = n === 1 ? 'Gray' : n === 3 ? 'RGB' : null;
    } else if (p.type === 'irot' && r.within(p.s, 1)) transforms.push([0, r.u8(p.s)]);
    else if (p.type === 'imir' && r.within(p.s, 1)) transforms.push([1, r.u8(p.s) & 1]);
  }
  if (clap && clap[0] <= f.width && clap[1] <= f.height) [f.width, f.height] = clap;
  f.orientation = heifOrientation(transforms);
  if (props.some((p) => p.type === 'auxC' && ascii(u, p.s, Math.min(p.e - p.s, 256)).includes('alpha'))) f.channels = f.channels === 'Gray' ? 'GrayA' : 'RGBA';
  if (f.width === 0 || f.height === 0) {
    f.width = 0;
    f.height = 0;
  }
  return f;
}

const svgLength = (v: string | undefined): number => {
  if (!v) return 0;
  const m = /^\s*([\d.]+)\s*(px)?\s*$/.exec(v);
  return m ? Math.round(Number(m[1])) : 0;
};

/** An SVG's size: its width and height, else its viewBox's; the first tag only, read as text. */
export function svgFacts(text: string): Read | null {
  const open = /<svg\b[^>]*>/i.exec(text);
  if (!open) return null;
  const attr = (name: string): string | undefined => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(open[0])?.[1];
  const f = base('svg');
  f.width = svgLength(attr('width'));
  f.height = svgLength(attr('height'));
  const box = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if ((f.width === 0 || f.height === 0) && box && box.length === 4 && box.every(Number.isFinite)) {
    f.width = f.width || Math.round(box[2]!);
    f.height = f.height || Math.round(box[3]!);
  }
  return f;
}

/** Scripts an SVG holds (a `<script>` or an `on…` handler): drawn as an image, none of them runs. */
export function svgScripts(text: string): number {
  return (text.match(/<script\b/gi)?.length ?? 0) + (text.match(/\son[a-z]+\s*=/gi)?.length ?? 0);
}

/** The format the bytes are, as the contract names it, or null. */
export function imageFormatOf(u: Uint8Array): string | null {
  if (u[0] === 0x89 && ascii(u, 1, 3) === 'PNG') return 'png';
  if (u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return 'jpeg';
  if (ascii(u, 0, 4) === 'GIF8') return 'gif';
  if (ascii(u, 0, 4) === 'RIFF' && ascii(u, 8, 4) === 'WEBP') return 'webp';
  if (ascii(u, 0, 2) === 'BM') return 'bmp';
  if (u[0] === 0 && u[1] === 0 && u[2] === 1 && u[3] === 0) return 'ico';
  if (ascii(u, 4, 4) === 'ftyp') {
    const brand = ascii(u, 8, 4);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return 'heic';
  }
  if (ascii(u, 0, 4) === 'qoif') return 'qoi';
  if (u[0] === 0x76 && u[1] === 0x2f && u[2] === 0x31 && u[3] === 0x01) return 'exr';
  if (ascii(u, 0, 2) === '#?') return 'hdr';
  if ((u[0] === 0xff && u[1] === 0x0a) || ascii(u, 4, 4) === 'JXL ') return 'jxl';
  if ((ascii(u, 0, 2) === 'II' && u[2] === 0x2a) || (ascii(u, 0, 2) === 'MM' && u[3] === 0x2a)) return 'tiff';
  const picture = pictureFormatOf(u);
  if (picture) return picture;
  const head = ascii(u, 0, 512).replace(/^﻿?\s*/, '');
  if (opensSvg(head)) return 'svg';
  return null;
}

/**
 * Whether `head` opens an SVG: an XML declaration, comments and an SVG doctype may come before `<svg`. Scanned, each
 * declaration and comment ending at its first close: the regex this replaces backtracked exponentially on `<!---->` runs.
 */
function opensSvg(head: string): boolean {
  let i = 0;
  const space = (): void => {
    while (i < head.length && /\s/.test(head[i]!)) i++;
  };
  const opens = (word: string): boolean => head.slice(i, i + word.length).toLowerCase() === word;
  if (opens('<?xml')) {
    const close = head.indexOf('?>', i + 5);
    if (close < 0) return false;
    i = close + 2;
    space();
  }
  while (head.startsWith('<!--', i)) {
    const close = head.indexOf('-->', i + 4);
    if (close < 0) return false;
    i = close + 3;
    space();
  }
  if (opens('<!doctype svg')) {
    const close = head.indexOf('>', i + 13);
    if (close < 0) return false;
    i = close + 1;
    space();
  }
  return opens('<svg') && !/\w/.test(head[i + 4] ?? '');
}

/** As the Rust facts' `HEIC_WINDOWS_WHY`: on Windows the system's own codec comes from two Store extensions. */
export const HEIC_WINDOWS_WHY =
  'This system cannot draw HEIC: Windows draws it with the HEIF Image Extension and the HEVC Video Extension from the Microsoft Store, and this one has not got both. Marxy does not carry a decoder of its own.';

const SYSTEM_DRAWS = (format: string, system: string, windows: boolean): string =>
  format === 'heic'
    ? windows
      ? HEIC_WINDOWS_WHY
      : `This system cannot draw HEIC: ${system} has no decoder for it built in, and the app does not ship one.`
    : `This system cannot draw ${format.toUpperCase()}: ${system} has no decoder for it.`;

/**
 * The facts `bytes` hold, as `image_facts` gives them, or null when the bytes are no image this reader knows. A format
 * the system does not draw is `show: "none"`, with the sentence the file card says.
 */
export async function imageFactsFromBytes(bytes: Uint8Array, opts: FactsOptions = {}): Promise<ImageFactsLike | null> {
  if (opts.extension === 'svgz' && bytes[0] === 0x1f && bytes[1] === 0x8b) return svgzFacts(bytes, opts);
  const format = imageFormatOf(bytes);
  if (format === null) return null;
  let f: Read | null;
  let refused: string | undefined;
  try {
    if (format === 'png') f = await png(bytes, opts);
    else if (format === 'jpeg') f = jpeg(bytes);
    else if (format === 'gif') f = gif(bytes);
    else if (format === 'webp') f = await webp(bytes, opts);
    else if (format === 'bmp') f = bmp(bytes);
    else if (format === 'ico') f = ico(bytes);
    else if (format === 'svg') f = svgFacts(new TextDecoder().decode(bytes.subarray(0, 64 * 1024)));
    else if (format === 'avif' || format === 'heic') f = heif(bytes, format);
    else if (['pbm', 'pgm', 'ppm', 'pam', 'farbfeld', 'dds', 'psd'].includes(format)) {
      const p = pictureFacts(bytes, format);
      f = p && { ...base(format), width: p.width, height: p.height, bitDepth: p.bitDepth, channels: p.channels, ...(p.note ? { note: p.note } : {}) };
      refused = p?.refused;
    } else f = base(format);
  } catch {
    f = base(format);
  }
  if (f === null) return null;
  if (refused) return { ...f, show: 'none', why: refused };
  const drawable = (opts.drawable ?? DEFAULT_DRAWABLE).has(format);
  return { ...f, show: drawable ? 'webview' : 'none', why: drawable ? null : SYSTEM_DRAWS(format, opts.system ?? 'this system', opts.windows === true) };
}

/** An SVGZ's facts from the SVG it unpacks to, within the shell's cap; refused past it or when it does not unpack. */
async function svgzFacts(bytes: Uint8Array, opts: FactsOptions): Promise<ImageFactsLike> {
  const f = base('svgz');
  const unpacked = opts.gunzip ? await opts.gunzip(bytes, SVGZ_MAX_UNPACKED).catch(() => null) : undefined;
  const refused = unpacked === null ? SVGZ_DAMAGED : unpacked && unpacked.length > SVGZ_MAX_UNPACKED ? SVGZ_TOO_LARGE : null;
  if (refused) return { ...f, show: 'none', why: refused };
  const svg = unpacked ? svgFacts(new TextDecoder().decode(unpacked.subarray(0, 64 * 1024))) : null;
  if (unpacked && !svg) return { ...f, show: 'none', why: 'This SVGZ unpacks to something that is not an SVG.' };
  const drawable = (opts.drawable ?? DEFAULT_DRAWABLE).has('svgz');
  return { ...f, width: svg?.width ?? 0, height: svg?.height ?? 0, show: drawable ? 'webview' : 'none', why: drawable ? null : SYSTEM_DRAWS('svgz', opts.system ?? 'this system', opts.windows === true) };
}
