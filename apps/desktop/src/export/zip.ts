// A zip of files as stored (the Export panel's bundle, Versions' "export all"): store-only, so whoever opens it gets every
// file back byte for byte, with each entry's CRC-32 and the UTF-8 name flag. Pure; no dependency.

export interface ZipEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

const CRC_TABLE = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
/** General purpose flag bit 11: the name is UTF-8. */
const UTF8_NAME = 0x0800;

/** The most entries a zip without ZIP64 can count; past it the end record's count wraps and the zip is corrupt. */
export const ZIP_MOST_ENTRIES = 0xffff;

/** Thrown, before anything is built, for a zip of more entries than it can count. */
export class ZipTooLarge extends Error {}

/** The zip's bytes: a local header and the data for each entry, then the central directory and its end record. */
export function zipStore(entries: readonly ZipEntry[], when: Date = new Date()): Uint8Array {
  if (entries.length > ZIP_MOST_ENTRIES) throw new ZipTooLarge(`a zip holds at most ${ZIP_MOST_ENTRIES.toLocaleString('en')} files, and this one would hold ${entries.length.toLocaleString('en')}`);
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.path);
    const crc = crc32(e.bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, UTF8_NAME, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, e.bytes.length, true);
    local.setUint32(22, e.bytes.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 20, true);
    head.setUint16(8, UTF8_NAME, true);
    head.setUint16(10, 0, true);
    head.setUint16(12, time, true);
    head.setUint16(14, date, true);
    head.setUint32(16, crc, true);
    head.setUint32(20, e.bytes.length, true);
    head.setUint32(24, e.bytes.length, true);
    head.setUint16(28, name.length, true);
    head.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, e.bytes);
    central.push(new Uint8Array(head.buffer), name);
    offset += 30 + name.length + e.bytes.length;
  }
  const size = central.reduce((n, x) => n + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of all) {
    out.set(x, at);
    at += x.length;
  }
  return out;
}

/** SHA-256 in hex, through Web Crypto. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Each path made unique as it would be on disk: a second `a.md` becomes `a (2).md`. */
export function uniquePaths<T extends ZipEntry>(entries: readonly T[]): T[] {
  const seen = new Set<string>();
  return entries.map((e) => {
    let path = e.path;
    for (let i = 2; seen.has(path); i++) path = e.path.replace(/(\.[^./]*)?$/, ` (${i})$1`);
    seen.add(path);
    return path === e.path ? e : { ...e, path };
  });
}
