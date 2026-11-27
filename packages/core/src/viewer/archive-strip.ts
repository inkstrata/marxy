// The file as stored: an archive drawn from its first byte to its
// last in the order written. A zip: bytes before the first entry, each entry's local header and data, the central
// directory, the end record, and bytes no part claims. A plain tar: each entry's headers and data blocks, then the end
// blocks. A compressed tar or a lone gz, bz2 or xz: one packed stream between its header and trailer. A 7z: its
// signature header, the packed blocks, then the header that lists the entries. Pure: no DOM, no I/O; the few bytes it
// reads (the tail, a local header, the directory) are handed to it.
//
// The segments always cover every byte of the file exactly once, in order: each starts where the one before ended, and
// what the listing cannot place is drawn as bytes no part claims rather than left out.

import type { ArchiveEntryLike, ArchiveListingLike } from './archive-read.ts';

export type StripKind =
  /** Bytes before a zip's first entry: a prefix, a stub, or anything the directory does not name. */
  | 'before'
  /** One entry: its header (`header` bytes) then its data. */
  | 'entry'
  /** Many consecutive entries too small to draw apart (`gatherStrip`). */
  | 'entries'
  | 'directory'
  /** A zip64 end record and its locator, between the directory and the end record. */
  | 'zip64'
  /** A zip's end record and its comment. */
  | 'end'
  /** A tar's two zero blocks and the padding to its record size. */
  | 'tar-end'
  /** A compressed stream's own header and trailer, and the stream between. */
  | 'stream-head'
  | 'stream'
  | 'stream-tail'
  /** Bytes no part of the archive claims: drawn in the warning colour. */
  | 'stray';

export interface StripSegment {
  readonly kind: StripKind;
  /** The first byte, and one past the last. */
  readonly from: number;
  readonly to: number;
  /** An entry's index; a gathered run's first. */
  readonly index?: number;
  /** A gathered run's last entry index, and how many it holds. */
  readonly last?: number;
  readonly count?: number;
  /** An entry's bytes before its data: its header (in a tar, any extension header before it). */
  readonly header?: number;
}

/** What the strip is made from beyond the listing: where a zip's end record lies, read from the file's tail. */
export interface StripFacts {
  readonly end?: { readonly at: number; readonly size: number } | null;
  /** The file's first bytes: a gzip header's length is read from them. */
  readonly head?: Uint8Array;
}

const u16 = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8);
const u32 = (b: Uint8Array, at: number): number => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

/** A tar's header and data blocks are 512 bytes. */
export const TAR_BLOCK = 512;

/**
 * The strip for `listing`. Every byte from 0 to `listing.size` lies in exactly one segment; segments are in file order
 * and none is empty.
 */
export function archiveStrip(listing: ArchiveListingLike, facts: StripFacts = {}): StripSegment[] {
  const size = listing.size;
  const out: StripSegment[] = [];
  let at = 0;
  const push = (kind: StripKind, to: number, more: Partial<StripSegment> = {}): void => {
    const end = Math.min(size, Math.max(at, to));
    if (end <= at) return;
    out.push({ kind, from: at, to: end, ...more });
    at = end;
  };
  if (listing.format === 'zip') zipStrip(listing, facts, push, () => at);
  else if (listing.format === 'tar') tarStrip(listing, push, () => at);
  else if (listing.format === '7z') sevenZStrip(listing, push);
  else streamStrip(listing.format, size, facts.head, push);
  if (at < size) push(listing.format === 'tar' ? 'tar-end' : 'stray', size);
  return out;
}

type Push = (kind: StripKind, to: number, more?: Partial<StripSegment>) => void;

function placed(entries: readonly ArchiveEntryLike[]): ArchiveEntryLike[] {
  return entries.filter((e) => e.offset !== null && Number.isFinite(e.offset)).sort((a, b) => a.offset! - b.offset! || a.index - b.index);
}

function zipStrip(listing: ArchiveListingLike, facts: StripFacts, push: Push, now: () => number): void {
  const size = listing.size;
  const dir = listing.directory;
  const list = placed(listing.entries);
  const dirAt = dir ? dir.at : (facts.end?.at ?? size);
  if (list.length > 0) push('before', list[0]!.offset!);
  list.forEach((e, i) => {
    const next = i + 1 < list.length ? list[i + 1]!.offset! : dirAt;
    // Two directory records naming one local header: the second has no bytes of its own.
    if (e.offset! < now()) return;
    if (e.offset! > now()) push('stray', e.offset!);
    const span = Math.max(0, Math.min(next, size) - e.offset!);
    const packed = e.packed ?? 0;
    // A data descriptor, if any, is counted with the header: where it ends is only known from the local header itself.
    push('entry', next, { index: e.index, header: packed <= span ? span - packed : span });
  });
  if (dir) {
    if (dir.at > now()) push('stray', dir.at);
    push('directory', dir.at + dir.size);
  }
  const end = facts.end;
  if (end && end.at >= now()) {
    // A zip64 end record and its locator sit between the directory and the end record; anything else there is stray.
    if (end.at > now()) push(end.at - now() === 76 ? 'zip64' : 'stray', end.at);
    push('end', end.at + end.size);
  } else push('end', size);
}

function tarStrip(listing: ArchiveListingLike, push: Push, now: () => number): void {
  const list = placed(listing.entries);
  for (const e of list) {
    if (e.offset! < now()) continue;
    const data = e.kind === 'file' ? (e.size ?? 0) : 0;
    const to = e.offset! + TAR_BLOCK + Math.ceil(data / TAR_BLOCK) * TAR_BLOCK;
    push('entry', to, { index: e.index, header: e.offset! + TAR_BLOCK - now() });
  }
}

/** A 7z's signature header: the magic, the version and where the header that lists the entries lies. */
export const SEVEN_Z_START = 32;

/** A 7z: its signature header, the packed blocks, then the header that lists the entries (the listing's `directory`). */
function sevenZStrip(listing: ArchiveListingLike, push: Push): void {
  push('stream-head', SEVEN_Z_START);
  const dir = listing.directory;
  // A header the shell found by searching (the signature header was zeroed by a writer that never finished) has no
  // place to draw: the rest is drawn as packed.
  if (!dir || dir.at < SEVEN_Z_START) {
    push('stream', listing.size);
    return;
  }
  push('stream', dir.at);
  push('directory', dir.at + dir.size);
}

/** A gzip header's length from its flags, or 10 when the bytes given end inside it. */
export function gzipHeaderLength(b: Uint8Array | undefined): number {
  if (!b || b.length < 10 || b[0] !== 0x1f || b[1] !== 0x8b) return 10;
  const flags = b[3]!;
  let at = 10;
  if (flags & 4) {
    if (at + 2 > b.length) return 10;
    at += 2 + u16(b, at);
  }
  for (const bit of [8, 16]) {
    if (!(flags & bit)) continue;
    const nul = b.indexOf(0, at);
    if (nul < 0) return 10;
    at = nul + 1;
  }
  if (flags & 2) at += 2;
  return at <= b.length ? at : 10;
}

/** A packed stream's header and trailer, as far as each format fixes them. */
export function streamFrame(format: string, head?: Uint8Array): { head: number; tail: number } {
  const c = format.replace(/^tar\./, '');
  if (c === 'gz') return { head: gzipHeaderLength(head), tail: 8 };
  if (c === 'xz') return { head: 12, tail: 12 };
  // bzip2's end-of-stream marker and checksum are not byte-aligned: only its four-byte signature is said.
  if (c === 'bz2') return { head: 4, tail: 0 };
  return { head: 0, tail: 0 };
}

function streamStrip(format: string, size: number, head: Uint8Array | undefined, push: Push): void {
  const f = streamFrame(format, head);
  if (f.head + f.tail > size) {
    push('stream', size);
    return;
  }
  push('stream-head', f.head);
  push('stream', size - f.tail);
  push('stream-tail', size);
}

/**
 * Runs of entries too small to draw apart joined into one `entries` segment, until at most `max` remain. A segment
 * narrower than `bytes / max` is small; neighbouring small entries are joined. Coverage is kept: a joined run spans from
 * its first entry's first byte to its last entry's last.
 */
export function gatherStrip(segs: readonly StripSegment[], max: number): StripSegment[] {
  if (segs.length <= max) return [...segs];
  const total = segs.length > 0 ? segs[segs.length - 1]!.to - segs[0]!.from : 0;
  let small = total / max;
  let out: StripSegment[] = [...segs];
  for (let round = 0; round < 32 && out.length > max; round++) {
    const next: StripSegment[] = [];
    for (const s of out) {
      const prev = next[next.length - 1];
      const joinable = (x: StripSegment): boolean => (x.kind === 'entry' || x.kind === 'entries') && x.to - x.from < small;
      if (prev && joinable(prev) && joinable(s) && prev.to === s.from) {
        next[next.length - 1] = {
          kind: 'entries',
          from: prev.from,
          to: s.to,
          index: prev.index!,
          last: s.kind === 'entries' ? s.last! : s.index!,
          count: (prev.count ?? 1) + (s.count ?? 1),
        };
      } else next.push(s);
    }
    out = next;
    small *= 2;
  }
  return out;
}

/** Whether `seg` stands for entry `index`. */
export function stripHolds(seg: StripSegment, index: number, order: ReadonlyMap<number, number>): boolean {
  if (seg.kind === 'entry') return seg.index === index;
  if (seg.kind !== 'entries') return false;
  const at = order.get(index);
  const a = order.get(seg.index!);
  const b = order.get(seg.last!);
  return at !== undefined && a !== undefined && b !== undefined && a <= at && at <= b;
}

/**
 * Widths in px for `segs` across `width`: to scale, with every segment at least `floor` px wide; the room the floors take
 * is taken from the wide ones. With more segments than floors fit, all share the width by bytes.
 */
export function stripLayout(segs: readonly StripSegment[], width: number, floor: number): { x: number; w: number }[] {
  const n = segs.length;
  if (n === 0 || width <= 0) return segs.map(() => ({ x: 0, w: 0 }));
  const bytes = segs.map((s) => s.to - s.from);
  const total = bytes.reduce((a, b) => a + b, 0) || 1;
  const w = new Array<number>(n).fill(0);
  if (floor * n >= width) bytes.forEach((b, i) => (w[i] = (b / total) * width));
  else {
    const fixed = new Set<number>();
    for (let round = 0; round < n; round++) {
      const room = width - fixed.size * floor;
      const left = bytes.reduce((s, b, i) => (fixed.has(i) ? s : s + b), 0) || 1;
      let changed = false;
      for (let i = 0; i < n; i++) {
        if (fixed.has(i)) continue;
        const v = (bytes[i]! / left) * room;
        if (v < floor) {
          fixed.add(i);
          changed = true;
        }
      }
      if (!changed) {
        for (let i = 0; i < n; i++) w[i] = fixed.has(i) ? floor : (bytes[i]! / left) * room;
        break;
      }
    }
  }
  let x = 0;
  return w.map((v) => {
    const out = { x, w: v };
    x += v;
    return out;
  });
}

// ---- a zip's stored records ------------------------------------------------------------------------------------------

const EOCD = 0x06054b50;
const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;

/**
 * The end record in a zip's last bytes (`tail`, which begins at file byte `tailAt`): where it lies and its length with
 * its comment. The last signature whose comment reaches exactly to the end wins; else the last signature at all.
 */
export function zipEndIn(tail: Uint8Array, tailAt: number): { at: number; size: number } | null {
  let loose: { at: number; size: number } | null = null;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) !== EOCD) continue;
    const size = 22 + u16(tail, i + 20);
    if (i + size === tail.length) return { at: tailAt + i, size };
    if (!loose && i + size <= tail.length) loose = { at: tailAt + i, size };
  }
  return loose;
}

export interface LocalHeader {
  readonly version: number;
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly packed: number;
  readonly size: number;
  readonly nameLength: number;
  readonly extraLength: number;
  /** 30 plus the name and the extra field: where the data begins, from the header's first byte. */
  readonly length: number;
}

/** A zip local header from its first 30 bytes; null when they are not one. */
export function localHeaderOf(b: Uint8Array): LocalHeader | null {
  if (b.length < 30 || u32(b, 0) !== LOCAL) return null;
  const nameLength = u16(b, 26);
  const extraLength = u16(b, 28);
  return { version: u16(b, 4), flags: u16(b, 6), method: u16(b, 8), crc: u32(b, 14), packed: u32(b, 18), size: u32(b, 22), nameLength, extraLength, length: 30 + nameLength + extraLength };
}

/**
 * Each central directory record's method, by its place in the directory (an entry's `index`). Stops at the first record
 * that is not one.
 */
export function zipMethods(cd: Uint8Array): number[] {
  const out: number[] = [];
  let at = 0;
  while (at + 46 <= cd.length && u32(cd, at) === CENTRAL) {
    out.push(u16(cd, at + 10));
    at += 46 + u16(cd, at + 28) + u16(cd, at + 30) + u16(cd, at + 32);
  }
  return out;
}

const METHODS: Readonly<Record<number, string>> = {
  0: 'stored',
  1: 'shrunk',
  6: 'imploded',
  8: 'deflate',
  9: 'deflate64',
  12: 'bzip2',
  14: 'lzma',
  20: 'zstd',
  93: 'zstd',
  95: 'xz',
  96: 'jpeg',
  97: 'wavpack',
  98: 'ppmd',
  99: 'AES',
};

/** A zip method's name: "stored", "deflate", "method 42". */
export const methodName = (m: number): string => METHODS[m] ?? `method ${m}`;

/**
 * An entry's method when no directory was read: the name the listing gives one it does not read, else stored when it
 * takes as many bytes packed as unpacked and deflate when not. Only a guess: the desktop app also reads Deflate64,
 * bzip2, LZMA, Zstandard and xz entries without naming them in the listing, which only the directory tells apart.
 */
export function methodByListing(e: ArchiveEntryLike): string | null {
  if (e.method) return e.method;
  if (e.packed === null || e.size === null) return null;
  return e.packed === e.size ? 'stored' : 'deflate';
}

/** What a zip's general-purpose flags say, bit by bit. */
export function flagWords(flags: number): string[] {
  const out: string[] = [];
  if (flags & 1) out.push('encrypted');
  if (flags & 8) out.push('sizes after the data');
  if (flags & 0x40) out.push('strong encryption');
  if (flags & 0x800) out.push('its name is UTF-8');
  return out;
}

/** `rwxr-xr-x` from a mode's permission bits, with the kind of file first where it is not a plain file. */
export function modeWords(mode: number): string {
  const kind = mode & 0o170000;
  const lead = kind === 0o040000 ? 'd' : kind === 0o120000 ? 'l' : '-';
  const rwx = (bits: number, special: boolean, s: string): string =>
    `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${special ? (bits & 1 ? s : s.toUpperCase()) : bits & 1 ? 'x' : '-'}`;
  return `${lead}${rwx(mode >> 6, (mode & 0o4000) !== 0, 's')}${rwx(mode >> 3, (mode & 0o2000) !== 0, 's')}${rwx(mode, (mode & 0o1000) !== 0, 't')}`;
}

/** The permission bits in octal, as `chmod` takes them: "755", "4755". */
export const modeOctal = (mode: number): string => (mode & 0o7777).toString(8).padStart(3, '0');
