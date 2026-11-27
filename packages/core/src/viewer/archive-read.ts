// An archive listed, one entry read, and the first bytes of many read, from the archive's own bytes, in the shape of
// shell-api's `ArchiveListing` and `ArchiveHead` (the Rust reader's contract, `apps/desktop/src-tauri/src/archive`, whose
// sentences and rules this repeats) for the memory shell (the browser build and the tests). zip, tar, tar.gz and a lone gz; 7z, bzip2, xz,
// Zstandard, ar and Debian packages, cabinets, ISO images and RAR are named and left to the desktop app,
// as are zip entries packed with a method other than stored or deflate that the desktop app reads (`DESKTOP_METHODS`).
// Untrusted input: every read is bounds-checked and a malformed file is null, a partial listing or an `ArchiveError`,
// never another throw. Pure: no DOM, no I/O; deflate and gzip are unpacked by the caller's `inflate`.

/** shell-api's `ArchiveEntry`, restated here so core imports nothing. */
export interface ArchiveEntryLike {
  readonly index: number;
  readonly path: string;
  readonly kind: 'file' | 'dir' | 'link' | 'other';
  readonly size: number | null;
  readonly packed: number | null;
  readonly mtime: string | null;
  readonly encrypted: boolean;
  readonly method: string | null;
  readonly rawName: string | null;
  readonly link: string | null;
  readonly offset: number | null;
  readonly crc: number | null;
  readonly host: string | null;
  readonly mode: number | null;
  readonly flags: number | null;
  readonly comment: string | null;
}

/** shell-api's `ArchiveListing`, restated here so core imports nothing. */
export interface ArchiveListingLike {
  readonly format: string;
  readonly entries: readonly ArchiveEntryLike[];
  readonly comment: string | null;
  readonly truncated: string | null;
  readonly skipped: number;
  readonly declared: number | null;
  readonly size: number;
  readonly unpacked: number | null;
  readonly directory: { readonly at: number; readonly size: number } | null;
  readonly note?: string | null;
}

/** shell-api's `ArchiveHead`, restated here so core imports nothing. */
export interface ArchiveHeadLike {
  readonly index: number;
  readonly bytes: Uint8Array;
  readonly whole: boolean;
  readonly refused: string | null;
}

export interface HeadWant {
  readonly index: number;
  readonly name: string;
}

/**
 * Unpacks one stream; it may throw on damage, and bounding a bomb is its business. With `limit` it may stop once it holds
 * that many bytes (or more): the caller cuts, and a stream cut short there is not damage.
 */
export type Inflate = (bytes: Uint8Array, format: 'deflate-raw' | 'gzip', limit?: number) => Promise<Uint8Array>;

/** The most one entry may open with. */
export const ENTRY_CAP = 16 * 1024 * 1024;

export interface ArchiveLimits {
  /** Ordinals walked in one listing. */
  entries: number;
  /** Raw name length; a longer entry is skipped and counted. */
  nameBytes: number;
  /** Path segments; a deeper entry is skipped and counted. */
  depth: number;
  /** Sum of the listed names; past it the listing stops. */
  listedBytes: number;
  entry: number;
  /** The most one head may hold. */
  head: number;
  /** The bytes one heads call may return in all. */
  heads: number;
  /** Unpacked bytes of a compressed tar walked; the stream is asked for no more than one byte past it. */
  stream: number;
}

export const ARCHIVE_LIMITS: ArchiveLimits = {
  entries: 100_000,
  nameBytes: 1_024,
  depth: 64,
  listedBytes: 16 * 1024 * 1024,
  entry: ENTRY_CAP,
  head: 256 * 1024,
  heads: 16 * 1024 * 1024,
  // As the Rust walk counts a compressed tar's stream.
  stream: 1024 * 1024 * 1024,
};

/** Maps to the shell's `ShellError` codes: `refused`, `unsupported`, `invalid`. */
export class ArchiveError extends Error {
  readonly code: 'refused' | 'unsupported' | 'invalid';
  constructor(code: 'refused' | 'unsupported' | 'invalid', message: string) {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
  }
}

const invalid = (message: string): ArchiveError => new ArchiveError('invalid', message);

// ---- bytes, words and dates ----------------------------------------------------------------------------------------

const lossy = new TextDecoder('utf-8', { ignoreBOM: true });
const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

const utf8Length = (s: string): number => encoder.encode(s).length;

function strictUtf8(b: Uint8Array): string | null {
  try {
    return strict.decode(b);
  } catch {
    return null;
  }
}

const u8 = (b: Uint8Array, at: number): number => b[at] ?? 0;
const u16 = (b: Uint8Array, at: number): number => u8(b, at) | (u8(b, at + 1) << 8);
const u32 = (b: Uint8Array, at: number): number => u16(b, at) + u16(b, at + 2) * 0x1_0000;
// Past 2^53 this loses low bits, which only ever lands where every bounds check already says "past the end".
const u64 = (b: Uint8Array, at: number): number => u32(b, at) + u32(b, at + 4) * 0x1_0000_0000;

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0): boolean =>
  at >= 0 && at + sig.length <= b.length && sig.every((v, i) => b[at + i] === v);

const commas = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "512 bytes", "4.0 KB", "20.0 MB": 1024 units, one decimal from KB up, a tie rounding to even as Rust prints it. */
function sizeWords(n: number): string {
  if (n < 1024) return `${n} ${n === 1 ? 'byte' : 'bytes'}`;
  const [div, unit]: [number, string] = n < 1024 ** 2 ? [1024, 'KB'] : n < 1024 ** 3 ? [1024 ** 2, 'MB'] : [1024 ** 3, 'GB'];
  const t = (n * 10) / div;
  const floor = Math.floor(t);
  const frac = t - floor;
  const tenths = frac > 0.5 || (frac === 0.5 && floor % 2 === 1) ? floor + 1 : floor;
  return `${Math.floor(tenths / 10)}.${tenths % 10} ${unit}`;
}

/** A cap as the sentences name it: "1 GB", "16 MB", else as `sizeWords` says it. */
function capWords(n: number): string {
  for (const [div, unit] of [[1024 ** 3, 'GB'], [1024 ** 2, 'MB'], [1024, 'KB']] as const) {
    if (n >= div && n % div === 0) return `${n / div} ${unit}`;
  }
  return sizeWords(n);
}

const two = (n: number): string => String(n).padStart(2, '0');

/** "YYYY-MM-DDTHH:MM:SS" for Unix seconds, with a trailing "Z" when `utc`; null outside years 0 to 9999. */
function isoFromUnix(secs: number, utc: boolean): string | null {
  if (!Number.isFinite(secs) || Math.abs(secs) > 1e13) return null;
  const days = Math.floor(secs / 86_400);
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1_460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  if (y < 0 || y > 9999) return null;
  const t = secs - days * 86_400;
  const clock = `${two(Math.floor(t / 3_600))}:${two(Math.floor((t % 3_600) / 60))}:${two(t % 60)}`;
  return `${String(y).padStart(4, '0')}-${two(m)}-${two(d)}T${clock}${utc ? 'Z' : ''}`;
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- names ---------------------------------------------------------------------------------------------------------

const isDrive = (segment: string): boolean => /^[A-Za-z]:$/.test(segment);
const unsafeChar = (c: string): boolean => c < ' ' || c === '\u007f';

/**
 * Backslashes become slashes, control characters become U+FFFD, empty, `.` and `..` segments go, and so does a first
 * segment that is a drive (`C:`) or `?` (from `//?/`). Never absolute, never a drive or a `..`; null when nothing is
 * left. `changed` is a difference from the raw name beyond backslash-to-slash. A directory's path ends in `/`.
 */
export function sanitiseEntryName(decoded: string, dir: boolean): { path: string; depth: number; changed: boolean } | null {
  const norm = decoded.replace(/\\/g, '/');
  const cleaned = Array.from(norm, (c) => (unsafeChar(c) ? '�' : c)).join('');
  const segments = cleaned.split('/').filter((s) => s !== '' && s !== '.' && s !== '..');
  while (segments.length > 0 && (segments[0] === '?' || isDrive(segments[0]!))) segments.shift();
  if (segments.length === 0) return null;
  let path = segments.join('/');
  const changed = path !== norm.replace(/\/+$/, '');
  const depth = segments.length;
  if (dir) path += '/';
  return { path, depth, changed };
}

/** What the page shows of a link's target: control characters replaced, cut to the name length, never followed. */
const linkText = (raw: Uint8Array, limits: ArchiveLimits): string => shownText(lossy.decode(raw), limits);

/** Text for the page (a link's target, an entry's comment): control characters replaced, cut to the name length. */
function shownText(decoded: string, limits: ArchiveLimits): string {
  const text = Array.from(decoded, (c) => (unsafeChar(c) ? '�' : c)).join('');
  const bytes = encoder.encode(text);
  if (bytes.length <= limits.nameBytes) return text;
  let cut = limits.nameBytes;
  while (cut > 0 && (bytes[cut]! & 0xc0) === 0x80) cut--;
  return lossy.decode(bytes.subarray(0, cut));
}

// ---- messages shared by every format -------------------------------------------------------------------------------

const damaged = (name: string): ArchiveError => invalid(`${name} could not be read: the archive is damaged.`);
const changedSince = (): ArchiveError => invalid('The archive changed since it was listed.');
const folder = (): ArchiveError => invalid('A folder has nothing to open.');
const notArchive = (): ArchiveError => invalid('This file is not an archive.');
const encrypted = (): ArchiveError => new ArchiveError('refused', 'This entry is encrypted. The app does not ask for archive passwords.');
const unreadable = (why: string): ArchiveError => invalid(`The listing could not be read: ${why}.`);

const tooBigDeclared = (name: string, size: number): ArchiveError =>
  new ArchiveError('refused', `${name} is ${sizeWords(size)} unpacked, over the 16 MB an entry may open with.`);

const tooBigActual = (name: string, declared: number | null): ArchiveError =>
  new ArchiveError(
    'refused',
    declared === null
      ? `${name} unpacks past the 16 MB an entry may open with.`
      : `${name} unpacks past the 16 MB an entry may open with, though it declares ${sizeWords(declared)}.`,
  );

const liesPast = (name: string, stream: number): ArchiveError =>
  new ArchiveError('refused', `${name} lies past the first ${capWords(stream)} of the unpacked stream, further than the app walks.`);

const truncatedByNames = (listed: number): string =>
  `Listed the first ${commas(listed)} entries: their names reach the 16 MB a listing may hold.`;

// ---- zip -----------------------------------------------------------------------------------------------------------

const EOCD_SIG = [0x50, 0x4b, 0x05, 0x06] as const;
const EOCD64_SIG = [0x50, 0x4b, 0x06, 0x06] as const;
const LOCATOR_SIG = [0x50, 0x4b, 0x06, 0x07] as const;
const CD_SIG = [0x50, 0x4b, 0x01, 0x02] as const;
const LOCAL_SIG = [0x50, 0x4b, 0x03, 0x04] as const;
/** The end record is 22 bytes and its comment at most 65,535. */
const TAIL = 65_557;

const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

interface ZipEnd {
  base: number;
  cdOff: number;
  cdSize: number;
  declared: number;
  comment: Uint8Array;
}

/**
 * The end record found in the last 65,557 bytes (a prefixed archive has no magic at byte 0), the zip64 locator followed
 * when a field is saturated, and how far the archive is shifted from byte 0. Throws the sentence for what is wrong.
 */
function zipOpen(bytes: Uint8Array): ZipEnd {
  const len = bytes.length;
  const tailLen = Math.min(len, TAIL);
  const tailStart = len - tailLen;
  let at = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    const p = tailStart + i;
    if (startsWith(bytes, EOCD_SIG, p) && i + 22 + u16(bytes, p + 20) <= tailLen) {
      at = p;
      break;
    }
  }
  if (at < 0) throw invalid('This file is not a zip archive.');
  const commentLen = u16(bytes, at + 20);
  const comment = bytes.slice(at + 22, at + 22 + commentLen);
  let disk = u16(bytes, at + 4);
  let cdDisk = u16(bytes, at + 6);
  let onDisk = u16(bytes, at + 8);
  let total = u16(bytes, at + 10);
  let cdSize = u32(bytes, at + 12);
  let cdOff = u32(bytes, at + 16);
  const saturated =
    disk === 0xffff || cdDisk === 0xffff || onDisk === 0xffff || total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff;
  let endPos = at;
  if (saturated && at >= 20 && startsWith(bytes, LOCATOR_SIG, at - 20)) {
    // The record normally sits right before its locator; the declared offset is relative to the archive's own start,
    // which a prefix shifts.
    const candidates = [u64(bytes, at - 20 + 8), Math.max(0, at - 20 - 56)];
    const pos = candidates.find((c) => Number.isSafeInteger(c) && c + 56 <= len && startsWith(bytes, EOCD64_SIG, c));
    if (pos === undefined) throw unreadable('the zip64 end record is missing');
    endPos = pos;
    disk = u32(bytes, pos + 16);
    cdDisk = u32(bytes, pos + 20);
    onDisk = u64(bytes, pos + 24);
    total = u64(bytes, pos + 32);
    cdSize = u64(bytes, pos + 40);
    cdOff = u64(bytes, pos + 48);
  }
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) {
    throw new ArchiveError('unsupported', 'a zip split across several files is not read.');
  }
  const cdEnd = cdOff + cdSize;
  if (!(cdEnd <= len)) throw unreadable('the central directory lies past the end of the file');
  const base = Math.max(0, endPos - cdEnd);
  if (total > 0 && !startsWith(bytes, CD_SIG, base + cdOff)) throw unreadable('the central directory is missing');
  return { base, cdOff, cdSize, declared: total, comment };
}

interface ZipRec {
  name: Uint8Array;
  flags: number;
  method: number;
  crc: number;
  csize: number | null;
  size: number | null;
  lho: number | null;
  extAttr: number;
  madeBy: number;
  dos: readonly [number, number];
  utc: number | null;
  unicode: string | null;
  comment: Uint8Array;
}

/** The central directory, a record at a time; `next` is null after the declared count and a string names damage. */
class ZipDirectory {
  private pos: number;
  private readonly limit: number;
  private readonly bytes: Uint8Array;
  private readonly end: ZipEnd;
  private taken = 0;
  constructor(bytes: Uint8Array, end: ZipEnd) {
    this.bytes = bytes;
    this.end = end;
    this.pos = end.base + end.cdOff;
    this.limit = Math.min(bytes.length, this.pos + end.cdSize);
  }

  next(): ZipRec | null | string {
    if (this.taken >= this.end.declared) return null;
    this.taken++;
    const { bytes, pos } = this;
    if (pos + 46 > this.limit) return 'the central directory ends early';
    if (!startsWith(bytes, CD_SIG, pos)) return 'a central directory record is not where it should be';
    const n = u16(bytes, pos + 28);
    const x = u16(bytes, pos + 30);
    const c = u16(bytes, pos + 32);
    if (pos + 46 + n + x + c > this.limit) return 'the central directory ends early';
    this.pos = pos + 46 + n + x + c;
    const name = bytes.subarray(pos + 46, pos + 46 + n);
    const extra = bytes.subarray(pos + 46 + n, pos + 46 + n + x);
    const sat = (at: number): boolean => u32(bytes, pos + at) === 0xffffffff;
    const needSize = sat(24);
    const needCsize = sat(20);
    const needLho = sat(42);
    let size: number | null = needSize ? null : u32(bytes, pos + 24);
    let csize: number | null = needCsize ? null : u32(bytes, pos + 20);
    let lho: number | null = needLho ? null : u32(bytes, pos + 42);
    let utc: number | null = null;
    let unicode: string | null = null;
    let at = 0;
    while (at + 4 <= extra.length) {
      const id = u16(extra, at);
      const len = u16(extra, at + 2);
      if (at + 4 + len > extra.length) break;
      const data = extra.subarray(at + 4, at + 4 + len);
      at += 4 + len;
      if (id === 0x0001) {
        // In this order, each only when its 32-bit field is saturated.
        let off = 0;
        const take = (): number | null => {
          const v = off + 8 <= data.length ? u64(data, off) : null;
          off += 8;
          return v;
        };
        if (needSize) size = take();
        if (needCsize) csize = take();
        if (needLho) lho = take();
      } else if (id === 0x5455 && data.length >= 5 && (data[0]! & 1) !== 0) {
        utc = u32(data, 1) | 0;
      } else if (id === 0x7075 && data.length >= 5 && data[0] === 1 && crc32(name) === u32(data, 1)) {
        // Honoured only when written for this very header name.
        unicode = strictUtf8(data.subarray(5));
      }
    }
    return {
      name,
      flags: u16(bytes, pos + 8),
      method: u16(bytes, pos + 10),
      crc: u32(bytes, pos + 16),
      csize,
      size,
      lho,
      extAttr: u32(bytes, pos + 38),
      madeBy: u16(bytes, pos + 4),
      dos: [u16(bytes, pos + 12), u16(bytes, pos + 14)],
      utc,
      unicode,
      comment: bytes.subarray(pos + 46 + n + x, pos + 46 + n + x + c),
    };
  }
}

function decodeZipName(raw: Uint8Array, flags: number): string {
  if (flags & 0x800) return lossy.decode(raw);
  const text = strictUtf8(raw);
  if (text !== null) return text;
  let out = '';
  for (const b of raw) out += b < 0x80 ? String.fromCharCode(b) : (CP437_HIGH[b - 0x80] ?? '�');
  return out;
}

/** A DOS date and time: local, no zone, so it is given without a "Z". */
function dosText([time, date]: readonly [number, number]): string | null {
  const y = 1980 + (date >> 9);
  const m = (date >> 5) & 15;
  const d = date & 31;
  const h = time >> 11;
  const mi = (time >> 5) & 63;
  const s = (time & 31) * 2;
  if (date === 0 || m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return `${String(y).padStart(4, '0')}-${two(m)}-${two(d)}T${two(h)}:${two(mi)}:${two(s)}`;
}

/** Zip methods the desktop app reads beyond stored and deflate: Deflate64, bzip2, LZMA, Zstandard (93 and 20) and xz. */
const DESKTOP_METHODS: ReadonlySet<number> = new Set([9, 12, 14, 20, 93, 95]);

function methodLabel(method: number): string | null {
  switch (method) {
    case 0:
    case 8:
      return null;
    case 9:
      return 'deflate64';
    case 12:
      return 'bzip2';
    case 14:
      return 'lzma';
    case 20:
    case 93:
      return 'zstd';
    case 95:
      return 'xz';
    case 98:
      return 'ppmd';
    case 99:
      return 'AES';
    default:
      return `method ${method}`;
  }
}

const zipEncrypted = (rec: ZipRec): boolean => (rec.flags & 1) !== 0 || rec.method === 99;

const HOSTS: Readonly<Record<number, string>> = { 0: 'DOS or Windows', 3: 'Unix', 10: 'Windows NTFS', 11: 'VFAT', 19: 'macOS' };

/** The system that wrote the entry, from the high byte of "version made by". */
const hostName = (madeBy: number): string => HOSTS[madeBy >> 8] ?? `system ${madeBy >> 8}`;

/**
 * The entry as listed, or null when it is left out (name too long, too deep, or nothing left after sanitising). `base`
 * is how far a prefix shifts the archive in the file.
 */
function describeZip(rec: ZipRec, index: number, base: number, limits: ArchiveLimits): ArchiveEntryLike | null {
  if (rec.name.length > limits.nameBytes) return null;
  // The Info-ZIP Unicode path stands in for the name, so the cap holds for it too (as in archive/zip.rs).
  if (rec.unicode !== null && new TextEncoder().encode(rec.unicode).length > limits.nameBytes) return null;
  const decoded = rec.unicode ?? decodeZipName(rec.name, rec.flags);
  const mode = rec.madeBy >> 8 === 3 ? (rec.extAttr >>> 16) & 0o170000 : null;
  const dir = /[/\\]$/.test(decoded) || (rec.extAttr & 0x10) !== 0 || mode === 0o040000;
  let kind: ArchiveEntryLike['kind'] = 'file';
  if (dir) kind = 'dir';
  else if (mode === 0o120000) kind = 'link';
  else if (mode === 0o020000 || mode === 0o060000 || mode === 0o010000 || mode === 0o140000) kind = 'other';
  const clean = sanitiseEntryName(decoded, dir);
  if (clean === null || clean.depth > limits.depth) return null;
  return {
    index,
    path: clean.path,
    kind,
    size: rec.size,
    packed: rec.csize,
    mtime: rec.utc !== null ? isoFromUnix(rec.utc, true) : dosText(rec.dos),
    encrypted: zipEncrypted(rec),
    method: methodLabel(rec.method),
    rawName: clean.changed ? decoded : null,
    link: null,
    offset: rec.lho !== null ? base + rec.lho : null,
    crc: rec.crc,
    host: hostName(rec.madeBy),
    mode: rec.madeBy >> 8 === 3 && rec.extAttr >>> 16 !== 0 ? rec.extAttr >>> 16 : null,
    flags: rec.flags,
    comment: rec.comment.length > 0 ? shownText(decodeZipName(rec.comment, rec.flags), limits) : null,
  };
}

/** What a read needs of a listed entry. */
interface ZipSlot {
  readonly entry: ArchiveEntryLike;
  readonly rec: ZipRec;
}

/** The listing, and a slot for each entry in it by its index. */
function listZip(bytes: Uint8Array, limits: ArchiveLimits): { listing: ArchiveListingLike; slots: Map<number, ZipSlot> } {
  const end = zipOpen(bytes);
  const cd = new ZipDirectory(bytes, end);
  const entries: ArchiveEntryLike[] = [];
  const slots = new Map<number, ZipSlot>();
  let skipped = 0;
  let listed = 0;
  let truncated: string | null = null;
  let index = 0;
  for (;;) {
    if (index >= limits.entries) {
      if (index < end.declared) {
        truncated = `Listed the first ${commas(entries.length)} entries; the archive declares ${commas(end.declared)}.`;
      }
      break;
    }
    const rec = cd.next();
    if (rec === null) break;
    if (typeof rec === 'string') {
      if (entries.length === 0 && skipped === 0) throw unreadable(rec);
      truncated = `The listing stopped at a damaged part: ${rec}.`;
      break;
    }
    const entry = describeZip(rec, index, end.base, limits);
    if (entry === null) skipped++;
    else {
      // The Rust reader weighs the same four strings, so a nested archive is cut where a top-level one is.
      const bytesOfName = utf8Length(entry.path) + utf8Length(entry.rawName ?? '') + utf8Length(entry.comment ?? '') + utf8Length(entry.link ?? '');
      if (listed + bytesOfName > limits.listedBytes) {
        truncated = truncatedByNames(entries.length);
        break;
      }
      listed += bytesOfName;
      entries.push(entry);
      slots.set(index, { entry, rec });
    }
    index++;
  }
  const listing: ArchiveListingLike = {
    format: 'zip',
    entries,
    comment: end.comment.length > 0 ? lossy.decode(end.comment) : null,
    truncated,
    skipped,
    declared: end.declared,
    size: bytes.length,
    unpacked: null,
    directory: { at: end.base + end.cdOff, size: end.cdSize },
  };
  return { listing, slots };
}

function zipSlotAt(slots: Map<number, ZipSlot>, index: number, name: string): ZipSlot {
  const slot = slots.get(index);
  if (slot === undefined || slot.entry.path !== name) throw changedSince();
  return slot;
}

/** Whether a local header's name is the slot's: sanitised to the same path, or the very bytes the directory holds. */
function localNameIs(raw: Uint8Array, flags: number, slot: ZipSlot): boolean {
  if (raw.length === slot.rec.name.length && raw.every((b, i) => b === slot.rec.name[i])) return true;
  return sanitiseEntryName(decodeZipName(raw, flags), slot.entry.kind === 'dir')?.path === slot.entry.path;
}

/**
 * At most `cap` bytes of the entry and whether it ended inside them. One that ended is checked against its declared
 * size and its CRC-32; `declaredCap` refuses an entry that declares more before anything is read.
 */
async function zipEntryBytes(
  bytes: Uint8Array,
  slot: ZipSlot,
  name: string,
  cap: number,
  declaredCap: number | null,
  inflate: Inflate,
): Promise<{ out: Uint8Array; whole: boolean }> {
  const { entry, rec } = slot;
  if (entry.kind === 'dir') throw folder();
  if (entry.kind === 'link') throw invalid(`${name} is a link: links are not followed.`);
  if (entry.kind === 'other') throw invalid(`${name} is not a file.`);
  if (entry.encrypted) throw encrypted();
  if (DESKTOP_METHODS.has(rec.method)) {
    throw new ArchiveError('unsupported', `${name} is compressed with ${entry.method}, which this build does not read: the desktop app does.`);
  }
  if (rec.method !== 0 && rec.method !== 8) {
    throw new ArchiveError(
      'unsupported',
      `${name} is compressed with ${entry.method ?? 'an unknown method'}, which the app does not read.`,
    );
  }
  const { size: declared, csize: packed } = rec;
  const local = entry.offset;
  if (declared === null || packed === null || local === null) throw damaged(name);
  if (declaredCap !== null && declared > declaredCap) throw tooBigDeclared(name, declared);
  // An offset is trusted only once the header it lands on names the same entry.
  if (local + 30 > bytes.length || !startsWith(bytes, LOCAL_SIG, local)) throw changedSince();
  const n = u16(bytes, local + 26);
  if (local + 30 + n > bytes.length || !localNameIs(bytes.subarray(local + 30, local + 30 + n), u16(bytes, local + 6), slot)) {
    throw changedSince();
  }
  const data = local + 30 + n + u16(bytes, local + 28);
  const inFile = (k: number): boolean => data + k <= bytes.length;
  if (!inFile(packed) || (rec.method === 0 && (packed !== declared || !inFile(declared)))) throw damaged(name);
  let got: Uint8Array;
  if (rec.method === 0) got = bytes.subarray(data, data + Math.min(declared, cap + 1));
  else {
    try {
      got = await inflate(bytes.subarray(data, data + packed), 'deflate-raw', cap + 1);
    } catch {
      throw damaged(name);
    }
  }
  const whole = got.length <= cap;
  const out = got.slice(0, cap);
  if (whole) {
    if (out.length !== declared) {
      throw invalid(
        `${name} unpacks to ${commas(out.length)} bytes, not the ${commas(declared)} it declares: the archive is damaged.`,
      );
    }
    if (crc32(out) !== rec.crc) throw invalid(`${name} does not match its check (CRC-32): the archive is damaged.`);
  }
  return { out, whole };
}

async function readZip(bytes: Uint8Array, index: number, name: string, inflate: Inflate, limits: ArchiveLimits): Promise<Uint8Array> {
  const slot = zipSlotAt(listZip(bytes, limits).slots, index, name);
  const { out, whole } = await zipEntryBytes(bytes, slot, name, limits.entry, limits.entry, inflate);
  if (!whole) throw tooBigActual(name, slot.rec.size);
  return out;
}

// ---- tar -----------------------------------------------------------------------------------------------------------

const cutAtNul = (b: Uint8Array): Uint8Array => {
  const i = b.indexOf(0);
  return i < 0 ? b : b.subarray(0, i);
};

/** An octal field: up to the first NUL, trimmed; null when it is not a number. */
function octal(field: Uint8Array): number | null {
  let text = '';
  for (const b of cutAtNul(field)) text += String.fromCharCode(b);
  text = text.trim();
  return /^[0-7]+$/.test(text) ? Number.parseInt(text, 8) : null;
}

/** A tar number field: octal, or GNU's big-endian base-256 when the top bit is set. */
function tarNumber(field: Uint8Array): number | null {
  const first = field[0] ?? 0;
  if ((first & 0x80) === 0) return octal(field);
  if (first === 0xff) return null;
  let v = first & 0x7f;
  for (let i = 1; i < field.length; i++) {
    v = v * 256 + field[i]!;
    if (v > Number.MAX_SAFE_INTEGER) return null;
  }
  return v;
}

function headerSum(block: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : block[i]!;
  return sum;
}

/** A tar header block: `ustar` at 257, or a v7 header whose checksum field matches its bytes. */
function looksLikeTar(block: Uint8Array): boolean {
  if (block.length < 512) return false;
  if (startsWith(block, [0x75, 0x73, 0x74, 0x61, 0x72], 257)) return true;
  return octal(block.subarray(148, 156)) === headerSum(block);
}

interface TarItem {
  /** What the tar crate counts: real entries and `g` headers; long-name and `x` pseudo-headers fold into the next one. */
  ordinal: number;
  type: number;
  name: Uint8Array;
  link: Uint8Array | null;
  size: number;
  mtime: number | null;
  dataAt: number;
  /** The entry's own header, after any long-name or PAX header before it. */
  headerAt: number;
  mode: number | null;
}

function parsePax(data: Uint8Array, into: Map<string, Uint8Array>): void {
  let pos = 0;
  while (pos < data.length) {
    let len = 0;
    let at = pos;
    while (at < data.length && data[at]! >= 0x30 && data[at]! <= 0x39 && len < 1e9) len = len * 10 + data[at++]! - 0x30;
    if (at === pos || data[at] !== 0x20 || len < at - pos + 2 || pos + len > data.length) return;
    let record = data.subarray(at + 1, pos + len);
    if (record[record.length - 1] === 0x0a) record = record.subarray(0, record.length - 1);
    const eq = record.indexOf(0x3d);
    if (eq > 0) into.set(lossy.decode(record.subarray(0, eq)), record.subarray(eq + 1));
    pos += len;
  }
}

const paxNumber = (v: Uint8Array | undefined): number | null => {
  if (v === undefined) return null;
  const n = Number(lossy.decode(v));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

function headerPath(h: Uint8Array): Uint8Array {
  const name = cutAtNul(h.subarray(0, 100));
  const ustar = startsWith(h, [0x75, 0x73, 0x74, 0x61, 0x72, 0x00, 0x30, 0x30], 257);
  const prefix = ustar ? cutAtNul(h.subarray(345, 500)) : new Uint8Array(0);
  if (prefix.length === 0) return name;
  const joined = new Uint8Array(prefix.length + 1 + name.length);
  joined.set(prefix);
  joined[prefix.length] = 0x2f;
  joined.set(name, prefix.length + 1);
  return joined;
}

/** The tar's entries in order; the return value is the damage that ended the walk, null when it ended cleanly. */
function* tarItems(u: Uint8Array): Generator<TarItem, string | null> {
  let off = 0;
  let ordinal = 0;
  let longName: Uint8Array | null = null;
  let longLink: Uint8Array | null = null;
  let pax: Map<string, Uint8Array> | null = null;
  for (;;) {
    const pending = longName !== null || longLink !== null || pax !== null;
    if (off >= u.length) return pending ? 'an extended header has no entry after it' : null;
    if (off + 512 > u.length) return 'failed to read entire block';
    const h = u.subarray(off, off + 512);
    if (h.every((b) => b === 0)) return pending ? 'an extended header has no entry after it' : null;
    if (octal(h.subarray(148, 156)) !== headerSum(h)) return 'archive header checksum mismatch';
    let size = tarNumber(h.subarray(124, 136));
    if (size === null) return 'the size field is not a number';
    const type = h[156]!;
    const dataAt = off + 512;
    if (type === 0x4c || type === 0x4b || type === 0x78) {
      if (dataAt + size > u.length) return 'unexpected end of the archive inside a header';
      const data = u.subarray(dataAt, dataAt + size);
      if (type === 0x4c) longName = cutAtNul(data);
      else if (type === 0x4b) longLink = cutAtNul(data);
      else {
        pax ??= new Map<string, Uint8Array>();
        parsePax(data, pax);
      }
      off = dataAt + Math.ceil(size / 512) * 512;
      continue;
    }
    const global = type === 0x67;
    const ext = global ? null : pax;
    size = paxNumber(ext?.get('size')) ?? size;
    const linkHeader = cutAtNul(h.subarray(157, 257));
    const link = global ? null : (longLink ?? ext?.get('linkpath') ?? (linkHeader.length > 0 ? linkHeader : null));
    const fieldTime = octal(h.subarray(136, 148));
    yield {
      ordinal,
      type,
      name: global ? headerPath(h) : (longName ?? ext?.get('path') ?? headerPath(h)),
      link,
      size,
      mtime: paxNumber(ext?.get('mtime')) ?? fieldTime,
      dataAt,
      headerAt: off,
      mode: tarNumber(h.subarray(100, 108)),
    };
    ordinal++;
    longName = longLink = pax = null;
    off = dataAt + Math.ceil(size / 512) * 512;
  }
}

function tarKind(type: number, nameIsDir: boolean): ArchiveEntryLike['kind'] {
  const file = type === 0x30 || type === 0 || type === 0x37;
  if (type === 0x35 || (nameIsDir && file)) return 'dir';
  if (file) return 'file';
  if (type === 0x31 || type === 0x32) return 'link';
  return 'other';
}

function describeTar(item: TarItem, limits: ArchiveLimits): ArchiveEntryLike | null {
  if (item.name.length > limits.nameBytes) return null;
  const decoded = lossy.decode(item.name);
  const kind = tarKind(item.type, /[/\\]$/.test(decoded));
  const clean = sanitiseEntryName(decoded, kind === 'dir');
  if (clean === null || clean.depth > limits.depth) return null;
  return {
    index: item.ordinal,
    path: clean.path,
    kind,
    size: kind === 'file' ? item.size : null,
    packed: null,
    mtime: item.mtime !== null && item.mtime > 0 ? isoFromUnix(item.mtime, true) : null,
    encrypted: false,
    method: null,
    rawName: clean.changed ? decoded : null,
    link: kind === 'link' && item.link !== null ? linkText(item.link, limits) : null,
    offset: item.headerAt,
    crc: null,
    host: null,
    mode: item.mode,
    flags: null,
    comment: null,
  };
}

const streamStop = (listed: number, stream: number): string =>
  `Listed the first ${commas(listed)} entries: the walk stops after ${capWords(stream)} of unpacked stream.`;

function listTar(tar: Uint8Array, format: string, size: number, compressed: boolean, limits: ArchiveLimits): ArchiveListingLike {
  const { walking, tripped } = tarWalking(tar, limits.stream);
  const entries: ArchiveEntryLike[] = [];
  let skipped = 0;
  let listed = 0;
  let words: string | null = null;
  let damage: string | null = null;
  const items = tarItems(walking);
  for (;;) {
    const r = items.next();
    if (r.done) {
      damage = r.value;
      break;
    }
    const item = r.value;
    if (item.ordinal >= limits.entries) {
      words = `Listed the first ${commas(entries.length)} entries; more follow.`;
      break;
    }
    if (item.type === 0x67) continue;
    const entry = describeTar(item, limits);
    if (entry === null) skipped++;
    else {
      const bytesOfName = utf8Length(entry.path);
      if (listed + bytesOfName > limits.listedBytes) {
        words = truncatedByNames(entries.length);
        break;
      }
      listed += bytesOfName;
      entries.push(entry);
    }
  }
  if (words === null && tripped) {
    words = streamStop(entries.length, limits.stream);
    damage = null;
  }
  let truncated: string | null = words;
  if (truncated === null && damage !== null) {
    if (entries.length === 0 && skipped === 0) throw unreadable(damage);
    truncated = `The listing stopped at a damaged part: ${damage}.`;
  }
  return {
    format,
    entries,
    comment: null,
    truncated,
    skipped,
    declared: null,
    size,
    unpacked: compressed && truncated === null ? tar.length : null,
    directory: null,
  };
}

/**
 * At most `cap` bytes of the tar entry `item`, which must be the `name` listed at its ordinal, and whether it ended inside
 * them. `declaredCap` refuses an entry that declares more before anything is read.
 */
function tarEntryBytes(
  walking: Uint8Array,
  item: TarItem,
  name: string,
  limits: ArchiveLimits,
  cap: number,
  declaredCap: number | null,
  broken: () => ArchiveError,
): { out: Uint8Array; whole: boolean } {
  const listed = describeTar(item, limits);
  if (listed === null || listed.path !== name) throw changedSince();
  if (listed.kind === 'dir') throw folder();
  if (listed.kind === 'link') throw invalid(`${name} is a link to ${listed.link ?? ''}: links are not followed.`);
  if (listed.kind !== 'file') throw invalid(`${name} is not a file.`);
  if (declaredCap !== null && item.size > declaredCap) throw tooBigDeclared(name, item.size);
  const take = Math.min(item.size, cap + 1);
  if (item.dataAt + take > walking.length) throw broken();
  const whole = item.size <= cap;
  return { out: walking.slice(item.dataAt, item.dataAt + Math.min(take, cap)), whole };
}

/** The tar's stream cut at the walk's cap, and whether it was cut. */
function tarWalking(tar: Uint8Array, stream: number): { walking: Uint8Array; tripped: boolean } {
  const tripped = tar.length > stream;
  return { walking: tripped ? tar.subarray(0, stream) : tar, tripped };
}

function readTar(tar: Uint8Array, index: number, name: string, limits: ArchiveLimits): Uint8Array {
  const { walking, tripped } = tarWalking(tar, limits.stream);
  const broken = (): ArchiveError => (tripped ? liesPast(name, limits.stream) : damaged(name));
  const items = tarItems(walking);
  for (;;) {
    const r = items.next();
    if (r.done) throw r.value !== null ? broken() : tripped ? liesPast(name, limits.stream) : changedSince();
    const item = r.value;
    if (item.ordinal !== index) continue;
    const { out, whole } = tarEntryBytes(walking, item, name, limits, limits.entry, limits.entry, broken);
    if (!whole) throw tooBigActual(name, item.size);
    return out;
  }
}

/** The heads of `wants` from one pass over the tar, which stops after the last wanted ordinal. */
function tarHeads(tar: Uint8Array, wants: readonly HeadWant[], maxEach: number, limits: ArchiveLimits): ArchiveHeadLike[] {
  const { walking, tripped } = tarWalking(tar, limits.stream);
  const out: (ArchiveHeadLike | null)[] = wants.map(() => null);
  if (wants.length === 0) return [];
  const last = wants.reduce((m, w) => Math.max(m, w.index), 0);
  const items = tarItems(walking);
  let ended = false;
  let first = true;
  for (;;) {
    const r = items.next();
    if (r.done) {
      if (r.value !== null) {
        if (first && !tripped) throw unreadable(r.value);
        wants.forEach((w, i) => {
          out[i] ??= refusedHead(w.index, tripped ? liesPast(w.name, limits.stream) : damaged(w.name));
        });
      }
      break;
    }
    first = false;
    const item = r.value;
    const listed = describeTar(item, limits)?.path ?? null;
    let read: ArchiveHeadLike | null = null;
    wants.forEach((w, i) => {
      if (w.index !== item.ordinal) return;
      if (listed !== w.name) out[i] = refusedHead(w.index, changedSince());
      else {
        read ??= headOf(w.index, () => {
          const broken = (): ArchiveError => (tripped ? liesPast(w.name, limits.stream) : damaged(w.name));
          return tarEntryBytes(walking, item, w.name, limits, maxEach, null, broken);
        });
        out[i] = read;
      }
    });
    if (item.ordinal >= last) {
      ended = true;
      break;
    }
  }
  const past = !ended && tripped;
  return wants.map((w, i) => out[i] ?? refusedHead(w.index, past ? liesPast(w.name, limits.stream) : changedSince()));
}

const refusedHead = (index: number, e: ArchiveError): ArchiveHeadLike => ({ index, bytes: new Uint8Array(0), whole: false, refused: e.message });

/** A head from what `read` gives, or the refusal it threw; anything but an `ArchiveError` is the caller's. */
function headOf(index: number, read: () => { out: Uint8Array; whole: boolean }): ArchiveHeadLike {
  try {
    const { out, whole } = read();
    return { index, bytes: out, whole, refused: null };
  } catch (e) {
    if (e instanceof ArchiveError) return refusedHead(index, e);
    throw e;
  }
}

async function headOfAsync(index: number, read: () => Promise<{ out: Uint8Array; whole: boolean }>): Promise<ArchiveHeadLike> {
  try {
    const { out, whole } = await read();
    return { index, bytes: out, whole, refused: null };
  } catch (e) {
    if (e instanceof ArchiveError) return refusedHead(index, e);
    throw e;
  }
}

// ---- a lone gzip file ----------------------------------------------------------------------------------------------

/** A gzip header's FNAME and MTIME; null for each when the header does not say. */
function gzipHeader(b: Uint8Array): { name: Uint8Array | null; mtime: number | null } {
  if (b.length < 10) return { name: null, mtime: null };
  const m = u32(b, 4);
  const mtime = m !== 0 ? m : null;
  const flags = b[3]!;
  let at = 10;
  if (flags & 4) {
    at += 2 + u16(b, at);
    if (at > b.length) return { name: null, mtime };
  }
  if ((flags & 8) === 0) return { name: null, mtime };
  const stop = b.indexOf(0, at);
  // At most 4,096 bytes of name, then its NUL.
  if (stop < 0 || stop - at > 4_096) return { name: null, mtime };
  return { name: b.subarray(at, stop), mtime };
}

/** FNAME is Latin-1 by the format, but writers put UTF-8 in it; a name that is not UTF-8 reads as Latin-1. */
function gzipName(raw: Uint8Array): string {
  return strictUtf8(raw) ?? Array.from(raw, (b) => String.fromCharCode(b)).join('');
}

/** `notes.txt.gz` is `notes.txt`; `x.gz` is `x`. */
function stemOf(fileName: string): string {
  const last = fileName.split(/[\\/]/).pop() ?? '';
  const dot = last.lastIndexOf('.');
  const stem = dot > 0 ? last.slice(0, dot) : last;
  return sanitiseEntryName(stem, false)?.path ?? 'file';
}

function singleEntry(bytes: Uint8Array, fileName: string): ArchiveEntryLike {
  const { name, mtime } = gzipHeader(bytes);
  let path = stemOf(fileName);
  let rawName: string | null = null;
  if (name !== null) {
    const decoded = gzipName(name);
    const clean = sanitiseEntryName(decoded, false);
    if (clean !== null) {
      path = clean.path;
      rawName = clean.changed ? decoded : null;
    }
  }
  return {
    index: 0,
    path,
    kind: 'file',
    size: bytes.length >= 18 ? u32(bytes, bytes.length - 4) : null,
    packed: null,
    mtime: mtime !== null ? isoFromUnix(mtime, true) : null,
    encrypted: false,
    method: null,
    rawName,
    link: null,
    offset: null,
    crc: null,
    host: null,
    mode: null,
    flags: null,
    comment: null,
  };
}

// ---- detection and the two calls -----------------------------------------------------------------------------------

type Detected =
  | { readonly kind: 'zip' }
  | { readonly kind: 'tar'; readonly tar: Uint8Array; readonly gz: boolean }
  | { readonly kind: 'gz' };

const GZIP = [0x1f, 0x8b, 8] as const;

function isBzip2(head: Uint8Array): boolean {
  return (
    head.length >= 10 &&
    startsWith(head, [0x42, 0x5a, 0x68]) &&
    head[3]! >= 0x31 &&
    head[3]! <= 0x39 &&
    (startsWith(head, [0x31, 0x41, 0x59, 0x26, 0x53, 0x59], 4) || startsWith(head, [0x17, 0x72, 0x45, 0x38, 0x50, 0x90], 4))
  );
}

/** The formats only the desktop app lists, by their first bytes (an ISO image by its first volume descriptor). */
function desktopFormat(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x28, 0xb5, 0x2f, 0xfd])) return 'Zstandard';
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return 'RAR';
  if (startsWith(bytes, [0x4d, 0x53, 0x43, 0x46, 0, 0, 0, 0])) return 'cabinets';
  if (startsWith(bytes, [0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a])) return 'Debian packages or ar archives';
  if (startsWith(bytes, [0x43, 0x44, 0x30, 0x30, 0x31], 32769)) return 'ISO images';
  return null;
}

/** By bytes, never by extension. Null is a file this reader does not take for an archive. */
async function detect(bytes: Uint8Array, inflate: Inflate, limits: ArchiveLimits): Promise<Detected | null> {
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return { kind: 'zip' };
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    throw new ArchiveError('unsupported', 'This build does not read 7z: the desktop app does.');
  }
  if (startsWith(bytes, GZIP)) {
    let tar: Uint8Array | null = null;
    try {
      // Its first block says whether it is a tar; only a tar is unpacked further, and only one byte past the walk, so a
      // lone gz bomb costs a block here and a tar.gz bomb the cap, where the listing says the walk stopped.
      if (looksLikeTar((await inflate(bytes, 'gzip', 512)).subarray(0, 512))) tar = await inflate(bytes, 'gzip', limits.stream + 1);
    } catch {
      // A stream that will not open is a lone gz: the read says why.
    }
    return tar !== null ? { kind: 'tar', tar, gz: true } : { kind: 'gz' };
  }
  if (isBzip2(bytes) || startsWith(bytes, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) {
    throw new ArchiveError('unsupported', 'This build does not read bzip2 or xz: the desktop app does.');
  }
  const desktopOnly = desktopFormat(bytes);
  if (desktopOnly !== null) throw new ArchiveError('unsupported', `This build does not read ${desktopOnly}: the desktop app does.`);
  if (looksLikeTar(bytes.subarray(0, 512))) return { kind: 'tar', tar: bytes, gz: false };
  // A zip with something in front of it (a self-extractor) has no magic at byte 0.
  try {
    zipOpen(bytes);
    return { kind: 'zip' };
  } catch {
    return null;
  }
}

/** Anything not already an `ArchiveError` is a reader bug on hostile bytes: the page still gets a sentence. */
const asArchiveError = (e: unknown, what: string): ArchiveError =>
  e instanceof ArchiveError ? e : invalid(`${what}: the archive is damaged.`);

/** The listing of `bytes`; null when it is not an archive this reader takes. `fileName` names a lone `.gz`'s entry. */
export async function listArchiveBytes(
  bytes: Uint8Array,
  fileName: string,
  inflate: Inflate,
  limits: ArchiveLimits = ARCHIVE_LIMITS,
): Promise<ArchiveListingLike | null> {
  try {
    const found = await detect(bytes, inflate, limits);
    if (found === null) return null;
    if (found.kind === 'zip') return listZip(bytes, limits).listing;
    if (found.kind === 'tar') return listTar(found.tar, found.gz ? 'tar.gz' : 'tar', bytes.length, found.gz, limits);
    return {
      format: 'gz',
      entries: [singleEntry(bytes, fileName)],
      comment: null,
      truncated: null,
      skipped: 0,
      declared: null,
      size: bytes.length,
      unpacked: null,
      directory: null,
    };
  } catch (e) {
    throw asArchiveError(e, 'The listing could not be read');
  }
}

/** Entry `index` of `bytes`, which must be the `name` listed there; throws `ArchiveError` for what the Rust reader refuses. */
export async function readArchiveEntryBytes(
  bytes: Uint8Array,
  fileName: string,
  index: number,
  name: string,
  inflate: Inflate,
  limits: ArchiveLimits = ARCHIVE_LIMITS,
): Promise<Uint8Array> {
  try {
    const found = await detect(bytes, inflate, limits);
    if (found === null) throw notArchive();
    if (found.kind === 'zip') return await readZip(bytes, index, name, inflate, limits);
    if (found.kind === 'tar') return readTar(found.tar, index, name, limits);
    if (index !== 0 || singleEntry(bytes, fileName).path !== name) throw changedSince();
    let out: Uint8Array;
    try {
      out = await inflate(bytes, 'gzip', limits.entry + 1);
    } catch {
      throw damaged(name);
    }
    if (out.length > limits.entry) throw tooBigActual(name, null);
    return out;
  } catch (e) {
    throw asArchiveError(e, `${name} could not be read`);
  }
}

/**
 * The first bytes of each want, in the order of `wants`: at most `maxEach` (clamped to 1 to `limits.head`) each, and as
 * many wants as `limits.heads` holds at that size; the rest are left out. A want that cannot be answered is refused with
 * its sentence; only a fault reaching the archive itself throws. A compressed tar's heads come from one pass.
 */
export async function readArchiveHeadsBytes(
  bytes: Uint8Array,
  fileName: string,
  wants: readonly HeadWant[],
  maxEach: number,
  inflate: Inflate,
  limits: ArchiveLimits = ARCHIVE_LIMITS,
): Promise<ArchiveHeadLike[]> {
  const each = Math.min(Math.max(1, Number.isFinite(maxEach) ? Math.floor(maxEach) : 1), Math.max(1, limits.head));
  const served = wants.slice(0, Math.floor(limits.heads / each));
  try {
    const found = await detect(bytes, inflate, limits);
    if (found === null) throw notArchive();
    if (found.kind === 'tar') return tarHeads(found.tar, served, each, limits);
    if (found.kind === 'zip') {
      const { slots } = listZip(bytes, limits);
      const out: ArchiveHeadLike[] = [];
      for (const w of served) {
        out.push(await headOfAsync(w.index, () => zipEntryBytes(bytes, zipSlotAt(slots, w.index, w.name), w.name, each, null, inflate)));
      }
      return out;
    }
    const path = singleEntry(bytes, fileName).path;
    const out: ArchiveHeadLike[] = [];
    for (const w of served) {
      out.push(
        await headOfAsync(w.index, async () => {
          if (w.index !== 0 || w.name !== path) throw changedSince();
          let got: Uint8Array;
          try {
            got = await inflate(bytes, 'gzip', each + 1);
          } catch {
            throw damaged(w.name);
          }
          return { out: got.slice(0, each), whole: got.length <= each };
        }),
      );
    }
    return out;
  } catch (e) {
    throw asArchiveError(e, 'The listing could not be read');
  }
}
