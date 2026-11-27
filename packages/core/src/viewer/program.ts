// A Windows program or library (.exe, .dll, .sys, .ocx, .scr: the PE format) read from its own bytes, by range: what it
// says of itself in its version resource, what it was built for, when it says it was built, and whether it carries a
// signature. Every one of these is the file's own claim. Nothing here runs, loads or verifies it: a signature is only
// found, never checked. The bytes are untrusted, so every offset is checked against the file, the walk is capped (sections,
// resource depth, bytes read) and a cycle in the resource tree is caught. Pure: no DOM, no I/O beyond the `ReadAt` given.

/** The most bytes read from one file, in all. */
export const PROGRAM_READ_MAX = 16 * 1024 * 1024;
/** The most of one string that is kept, in bytes of the file; the rest is dropped and the facts say so. */
export const PROGRAM_STRING_MAX = 32 * 1024;
/** A header naming more sections than this is not read. */
export const PROGRAM_SECTIONS_MAX = 96;
/** The resource tree is type, name, language: a directory any deeper is damage. */
export const PROGRAM_RESOURCE_DEPTH = 3;

const PAGE = 64 * 1024;
const ENTRIES_MAX = 4096;
const NODES_MAX = 512;
const DEBUG_ENTRIES_MAX = 64;
const TABLES_MAX = 32;
/** A claim longer than this is shown cut, with an ellipsis. */
export const PROGRAM_CLAIM_SHOWN = 200;
const RT_VERSION = 16;
const IMAGE_DEBUG_TYPE_REPRO = 16;

/** Reads `length` bytes at `offset`; a short answer means the file ended. */
export type ReadAt = (offset: number, length: number) => Promise<Uint8Array>;

export type Machine = 'x86' | 'x64' | 'ARM64' | 'ARM' | 'Itanium';

export interface ProgramFacts {
  readonly product: string | null;
  /** The product version as the strings say it, else from the fixed version block. */
  readonly version: string | null;
  readonly company: string | null;
  readonly description: string | null;
  /** The header's machine, or null with `machineCode` when it is one the card does not name. */
  readonly machine: Machine | null;
  readonly machineCode: number;
  /** From the optional header's magic (PE32 or PE32+); null when the header is cut short before it. */
  readonly bits: 32 | 64 | null;
  /** 2 a window, 3 a console, 1 native (a driver); the header's number, or null when the header is cut short before it. */
  readonly subsystem: number | null;
  /** The header marks it a library (a DLL, an OCX). */
  readonly library: boolean;
  /** A .NET assembly that runs on any CPU, whatever its header's machine says. */
  readonly anyCpu: boolean;
  readonly dotnet: boolean;
  /** Milliseconds, or null when the stamp is zero, a reproducible-build hash, later than now, or its debug entry unread. */
  readonly built: number | null;
  /** Why `built` is null when the header holds a stamp. */
  readonly stampNot: 'hash' | 'later' | null;
  /** Found, not verified: an entry pointing at a certificate inside the file; one pointing outside it; none. */
  readonly signature: 'present' | 'outside' | 'none';
  /** It carries a version resource. */
  readonly hasVersion: boolean;
  /** A part that could not be read, said plainly; the rest of the facts stand. */
  readonly damaged: string | null;
  /** A string was longer than `PROGRAM_STRING_MAX` and was cut. */
  readonly cut: boolean;
}

export type ProgramRead =
  | { readonly ok: true; readonly facts: ProgramFacts }
  /** `notProgram`: the bytes do not begin as one (a text file under a program's name), so it is a plain file. */
  | { readonly ok: false; readonly reason: string; readonly notProgram?: boolean };

class Damaged extends Error {}
const bad = (reason: string): never => {
  throw new Damaged(reason);
};

const UNSAFE = /[\u0000-\u001f\u007f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
/** A string for display: controls, zero-width marks and the bidirectional overrides that could disguise a name become a replacement mark. */
const clean = (s: string): string => s.replace(UNSAFE, '\ufffd').trim();
const utf16 = new TextDecoder('utf-16le');

const MACHINES: Readonly<Record<number, Machine>> = { 0x14c: 'x86', 0x8664: 'x64', 0xaa64: 'ARM64', 0x1c0: 'ARM', 0x1c4: 'ARM', 0x200: 'Itanium' };

/** Reads pages of the file once each, and refuses to read past the end or past `PROGRAM_READ_MAX` in all. */
class Source {
  private readonly pages = new Map<number, Uint8Array>();
  private used = 0;
  private readonly readAt: ReadAt;
  readonly size: number;
  constructor(readAt: ReadAt, size: number) {
    this.readAt = readAt;
    this.size = size;
  }

  private async page(n: number): Promise<Uint8Array> {
    const have = this.pages.get(n);
    if (have) return have;
    const start = n * PAGE;
    const want = Math.min(PAGE, this.size - start);
    if (this.used + want > PROGRAM_READ_MAX) bad(`it asks for more than the ${PROGRAM_READ_MAX / 1024 / 1024} MB the app reads of a program`);
    this.used += want;
    const got = await this.readAt(start, want);
    if (got.length < want) bad('it ends sooner than its size says');
    const page = got.length === want ? got : got.subarray(0, want);
    this.pages.set(n, page);
    return page;
  }

  /** Exactly `n` bytes at `at`, or damage named by `what`. */
  async bytes(at: number, n: number, what: string): Promise<Uint8Array> {
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(n) || at < 0 || n < 0 || at + n > this.size) bad(`its ${what} runs past the end of the file`);
    if (n === 0) return new Uint8Array(0);
    const first = Math.floor(at / PAGE);
    const last = Math.floor((at + n - 1) / PAGE);
    if (first === last) {
      const p = await this.page(first);
      return p.subarray(at - first * PAGE, at - first * PAGE + n);
    }
    const out = new Uint8Array(n);
    for (let i = first; i <= last; i++) {
      const p = await this.page(i);
      const from = Math.max(at, i * PAGE);
      const to = Math.min(at + n, i * PAGE + p.length);
      out.set(p.subarray(from - i * PAGE, to - i * PAGE), from - at);
    }
    return out;
  }

  async view(at: number, n: number, what: string): Promise<DataView> {
    const b = await this.bytes(at, n, what);
    return new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
}

interface Section {
  readonly va: number;
  readonly vsize: number;
  readonly raw: number;
  readonly rawSize: number;
}

/** The file offset of an address in the loaded image, or null when no section holds it. */
function offsetOf(sections: readonly Section[], rva: number, n: number): number | null {
  for (const s of sections) {
    const span = Math.max(s.vsize, s.rawSize);
    if (rva >= s.va && rva + n <= s.va + span && rva - s.va + n <= s.rawSize) return s.raw + (rva - s.va);
  }
  return null;
}

export interface VersionStrings {
  product: string | null;
  productVersion: string | null;
  company: string | null;
  description: string | null;
  fixedVersion: string | null;
  cut: boolean;
}

/**
 * The version block's strings, from the string table of the language its Translation lists first (else the first table
 * that names any of them), and the fixed block's product version. These are the file's own strings: Windows' file
 * properties can show another version, taken from a language resource file (.mui) beside it, which this does not read.
 */
export function readVersionBlock(b: Uint8Array): VersionStrings {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: VersionStrings = { product: null, productVersion: null, company: null, description: null, fixedVersion: null, cut: false };
  let nodes = 0;
  const align = (n: number): number => (n + 3) & ~3;
  interface Node {
    readonly key: string;
    readonly type: number;
    readonly valueLen: number;
    readonly valueAt: number;
    readonly childAt: number;
    readonly end: number;
  }
  const node = (at: number, limit: number): Node | null => {
    if (++nodes > NODES_MAX) bad(`its version block holds more than ${NODES_MAX} entries`);
    if (at + 6 > limit) return null;
    const len = v.getUint16(at, true);
    if (len === 0) return null;
    if (len < 6 || at + len > limit) bad('its version block has an entry that runs past its end');
    const end = at + len;
    const valueLen = v.getUint16(at + 2, true);
    const type = v.getUint16(at + 4, true);
    let i = at + 6;
    while (i + 2 <= end && (b[i] !== 0 || b[i + 1] !== 0)) i += 2;
    const key = utf16.decode(b.subarray(at + 6, i));
    const valueAt = align(i + 2);
    const valueBytes = type === 1 ? valueLen * 2 : valueLen;
    return { key, type, valueLen, valueAt, childAt: Math.min(end, align(valueAt + valueBytes)), end };
  };
  const children = function* (parent: Node): Generator<Node> {
    let at = parent.childAt;
    while (at < parent.end) {
      const n = node(at, parent.end);
      if (!n) return;
      yield n;
      at = align(n.end);
    }
  };
  const text = (n: Node): string | null => {
    let i = n.valueAt;
    while (i + 2 <= n.end && (b[i] !== 0 || b[i + 1] !== 0)) i += 2;
    let len = i - n.valueAt;
    if (len > PROGRAM_STRING_MAX) {
      out.cut = true;
      len = PROGRAM_STRING_MAX;
    }
    const s = clean(utf16.decode(b.subarray(n.valueAt, n.valueAt + len)));
    return s || null;
  };

  const root = node(0, b.length);
  if (!root || root.key !== 'VS_VERSION_INFO') bad('its version resource does not begin VS_VERSION_INFO');
  if (root!.valueLen >= 52 && root!.valueAt + 52 <= root!.end && v.getUint32(root!.valueAt, true) === 0xfeef04bd) {
    const ms = v.getUint32(root!.valueAt + 16, true);
    const ls = v.getUint32(root!.valueAt + 20, true);
    if (ms !== 0 || ls !== 0) out.fixedVersion = `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}`;
  }
  const tables: { key: string; found: Partial<Record<string, string | null>> }[] = [];
  let first: string | null = null;
  for (const info of children(root!)) {
    if (info.key === 'StringFileInfo') {
      for (const table of children(info)) {
        if (tables.length >= TABLES_MAX) break;
        const found: Partial<Record<string, string | null>> = {};
        for (const s of children(table)) found[s.key] = text(s);
        tables.push({ key: table.key.toUpperCase(), found });
      }
    } else if (info.key === 'VarFileInfo' && first === null) {
      for (const tr of children(info)) {
        if (tr.key !== 'Translation' || tr.valueLen < 4 || tr.valueAt + 4 > tr.end) continue;
        const hex = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
        first = `${hex(v.getUint16(tr.valueAt, true))}${hex(v.getUint16(tr.valueAt + 2, true))}`;
        break;
      }
    }
  }
  const names = (t: (typeof tables)[number]): boolean => !!(t.found.ProductName || t.found.ProductVersion || t.found.CompanyName || t.found.FileDescription);
  const chosen = tables.find((t) => t.key === first && names(t)) ?? tables.find(names);
  if (chosen) {
    out.product = chosen.found.ProductName ?? null;
    out.productVersion = chosen.found.ProductVersion ?? null;
    out.company = chosen.found.CompanyName ?? null;
    out.description = chosen.found.FileDescription ?? null;
  }
  return out;
}

/** The version resource's bytes: type 16, its first name, its first language, walked no deeper than three levels. */
async function versionResource(src: Source, sections: readonly Section[], rsrcRva: number, rsrcSize: number): Promise<Uint8Array | null> {
  const base = offsetOf(sections, rsrcRva, 16);
  if (base === null) bad('its resource directory is in no section');
  const span = Math.min(rsrcSize, src.size - base!);
  const seen = new Set<number>();
  const entries = async (dir: number, depth: number): Promise<{ id: number; named: boolean; target: number }[]> => {
    if (depth > PROGRAM_RESOURCE_DEPTH) bad(`its resource tree goes deeper than ${PROGRAM_RESOURCE_DEPTH} levels`);
    if (seen.has(dir)) bad('its resource tree loops back on itself');
    seen.add(dir);
    if (dir + 16 > span) bad('its resource tree points past the end of its section');
    const h = await src.view(base! + dir, 16, 'resource tree');
    const count = h.getUint16(12, true) + h.getUint16(14, true);
    if (count > ENTRIES_MAX || dir + 16 + count * 8 > span) bad(`its resource tree has a directory of ${count} entries, more than its section holds`);
    const e = await src.view(base! + dir + 16, count * 8, 'resource tree');
    return Array.from({ length: count }, (_, i) => {
      const name = e.getUint32(i * 8, true);
      return { id: name & 0xffff, named: (name & 0x80000000) !== 0, target: e.getUint32(i * 8 + 4, true) };
    });
  };
  const sub = (target: number): number | null => ((target & 0x80000000) !== 0 ? target & 0x7fffffff : null);

  const types = await entries(0, 1);
  const version = types.find((t) => !t.named && t.id === RT_VERSION);
  if (!version) return null;
  const namesAt = sub(version.target);
  if (namesAt === null) bad('its version resource is not a directory');
  const names = await entries(namesAt!, 2);
  if (names.length === 0) return null;
  const langsAt = sub(names[0]!.target);
  if (langsAt === null) bad('its version resource is not a directory');
  const langs = await entries(langsAt!, 3);
  if (langs.length === 0) return null;
  const leaf = langs[0]!.target;
  if (sub(leaf) !== null) bad(`its resource tree goes deeper than ${PROGRAM_RESOURCE_DEPTH} levels`);
  if (leaf + 16 > span) bad('its resource tree points past the end of its section');
  const d = await src.view(base! + leaf, 16, 'resource tree');
  const rva = d.getUint32(0, true);
  const size = d.getUint32(4, true);
  // VS_VERSIONINFO's own length is 16 bits: a larger block is not one.
  if (size < 6 || size > 0xffff) bad(`its version resource claims ${size} bytes`);
  const at = offsetOf(sections, rva, size);
  if (at === null) bad('its version resource points past the end of the file');
  return src.bytes(at!, size, 'version resource');
}

async function read(src: Source, now: number): Promise<ProgramFacts> {
  const size = src.size;
  if (size < 0x40) bad('it is shorter than the 64 bytes of a DOS header');
  const dos = await src.view(0, 0x40, 'DOS header');
  const peAt = dos.getUint32(0x3c, true);
  // A tiny PE can lay its header over the DOS stub, from offset 4 on.
  if (peAt < 4 || peAt + 24 > size) bad('its DOS header points past the end of the file for the PE header');
  const coff = await src.view(peAt, 24, 'PE header');
  if (coff.getUint32(0, true) !== 0x00004550) bad('it has a DOS header but no PE header: an MS-DOS program, which the card does not read');
  const machineCode = coff.getUint16(4, true);
  const sectionCount = coff.getUint16(6, true);
  const stamp = coff.getUint32(8, true);
  const optSize = coff.getUint16(20, true);
  const characteristics = coff.getUint16(22, true);
  if (sectionCount > PROGRAM_SECTIONS_MAX) bad(`it names ${sectionCount} sections, more than the ${PROGRAM_SECTIONS_MAX} the app reads`);

  let damaged: string | null = null;
  const note = (e: unknown): void => {
    if (!(e instanceof Damaged)) throw e;
    damaged ??= e.message;
  };
  // A file cut inside the optional header or the section table keeps what the PE header already said.
  let plus: boolean | null = null;
  let subsystem: number | null = null;
  let dir = (_i: number): { at: number; size: number } => ({ at: 0, size: 0 });
  let sections: Section[] = [];
  let whole = false;
  try {
    if (optSize < 2) bad('it has no optional header');
    const optAt = peAt + 24;
    const have = Math.min(optSize, 240, size - optAt);
    if (have < 2) bad('it is cut short before its optional header');
    const opt = await src.view(optAt, have, 'optional header');
    const magic = opt.getUint16(0, true);
    if (magic !== 0x10b && magic !== 0x20b) bad(`its optional header is neither PE32 nor PE32+ (magic ${magic.toString(16)})`);
    plus = magic === 0x20b;
    if (opt.byteLength >= 70) subsystem = opt.getUint16(68, true);
    const dirsAt = plus ? 112 : 96;
    if (opt.byteLength < Math.min(optSize, dirsAt)) bad('it is cut short inside its optional header');
    if (opt.byteLength < dirsAt) bad('its optional header is too short');
    const dirCount = Math.min(opt.getUint32(dirsAt - 4, true), 16, Math.floor((opt.byteLength - dirsAt) / 8));
    dir = (i) => (i < dirCount ? { at: opt.getUint32(dirsAt + i * 8, true), size: opt.getUint32(dirsAt + i * 8 + 4, true) } : { at: 0, size: 0 });
    if (optAt + optSize + sectionCount * 40 > size) bad('it is cut short inside its section table');
    const table = await src.view(optAt + optSize, sectionCount * 40, 'section table');
    sections = Array.from({ length: sectionCount }, (_, i) => ({
      vsize: table.getUint32(i * 40 + 8, true),
      va: table.getUint32(i * 40 + 12, true),
      rawSize: table.getUint32(i * 40 + 16, true),
      raw: table.getUint32(i * 40 + 20, true),
    }));
    whole = true;
  } catch (e) {
    note(e);
  }

  const lastByte = Math.max(0, ...sections.filter((s) => s.rawSize > 0).map((s) => s.raw + s.rawSize));
  if (lastByte > size) damaged ??= `it is ${(lastByte - size).toLocaleString('en-GB')} bytes shorter than its sections say: the file is cut short`;

  let strings: VersionStrings | null = null;
  const rsrc = dir(2);
  if (whole && rsrc.at !== 0 && rsrc.size !== 0) {
    try {
      const block = await versionResource(src, sections, rsrc.at, rsrc.size);
      if (block) strings = readVersionBlock(block);
    } catch (e) {
      note(e);
    }
  }

  // A reproducible build writes a hash where the time would be, and says so in a debug entry.
  let stampNot: 'hash' | 'later' | null = null;
  // A debug entry that cannot be read may have said the stamp is a hash: in a damaged file it is not shown as a time.
  let debugUnread = false;
  const debug = dir(6);
  if (stamp !== 0 && debug.at !== 0 && debug.size >= 28) {
    debugUnread = true;
    try {
      const n = Math.min(Math.floor(debug.size / 28), DEBUG_ENTRIES_MAX);
      const at = offsetOf(sections, debug.at, n * 28);
      if (at !== null) {
        const d = await src.view(at, n * 28, 'debug directory');
        for (let i = 0; i < n; i++) if (d.getUint32(i * 28 + 12, true) === IMAGE_DEBUG_TYPE_REPRO) stampNot = 'hash';
        debugUnread = false;
      }
    } catch (e) {
      note(e);
    }
  }
  // Older reproducible builds left no debug entry; a stamp later than now is not a time it was built.
  if (stamp !== 0 && stampNot === null && stamp * 1000 > now) stampNot = 'later';

  let dotnet = false;
  let anyCpu = false;
  const clr = dir(14);
  if (whole && clr.at !== 0 && clr.size >= 20) {
    dotnet = true;
    try {
      const at = offsetOf(sections, clr.at, 20);
      if (at !== null) {
        const flags = (await src.view(at + 16, 4, '.NET header')).getUint32(0, true);
        anyCpu = machineCode === 0x14c && (flags & 1) !== 0 && (flags & 2) === 0;
      }
    } catch (e) {
      note(e);
    }
  }

  // The certificate table's entry is a file offset, not an address. The certificate is found, never verified.
  let signature: ProgramFacts['signature'] = 'none';
  const cert = dir(4);
  if (cert.size !== 0) {
    signature = 'outside';
    if (cert.size >= 8 && cert.at + cert.size <= size) {
      try {
        const c = await src.view(cert.at, 8, 'certificate table');
        const len = c.getUint32(0, true);
        if (len >= 8 && len <= cert.size) signature = 'present';
      } catch (e) {
        note(e);
      }
    }
  }

  return {
    product: strings?.product ?? null,
    version: strings?.productVersion ?? strings?.fixedVersion ?? null,
    company: strings?.company ?? null,
    description: strings?.description ?? null,
    machine: MACHINES[machineCode] ?? null,
    machineCode,
    bits: plus === null ? null : plus ? 64 : 32,
    subsystem,
    library: (characteristics & 0x2000) !== 0,
    anyCpu,
    dotnet,
    built: stamp !== 0 && stampNot === null && !(debugUnread && damaged !== null) ? stamp * 1000 : null,
    stampNot: stamp !== 0 ? stampNot : null,
    signature,
    hasVersion: strings !== null,
    damaged,
    cut: strings?.cut ?? false,
  };
}

/** What a PE file says of itself, read by range from `readAt`, or why it cannot be read. Never throws. */
export async function readProgram(readAt: ReadAt, size: number, now: number = Date.now()): Promise<ProgramRead> {
  const src = new Source(readAt, size);
  try {
    const head = size >= 2 ? await src.bytes(0, 2, 'header') : new Uint8Array(0);
    if (head[0] !== 0x4d || head[1] !== 0x5a) return { ok: false, reason: 'Its bytes do not begin MZ, so it is not a Windows program.', notProgram: true };
    return { ok: true, facts: await read(src, now) };
  } catch (e) {
    return { ok: false, reason: e instanceof Damaged ? `The program is damaged: ${e.message}.` : 'The program could not be read: its bytes do not follow the PE format.' };
  }
}

/** A buffer as a `ReadAt`, for bytes already held. */
export const readAtBytes =
  (bytes: Uint8Array): ReadAt =>
  async (offset, length) =>
    bytes.subarray(offset, offset + length);

/** "x64, 64-bit · a window program", "ARM64, 64-bit · a library", "any CPU (.NET) · a console program". */
export function builtForWords(f: ProgramFacts): string {
  const name = f.machine ?? `machine 0x${f.machineCode.toString(16).toUpperCase().padStart(4, '0')}`;
  // The width is the optional header's (PE32 or PE32+), not the machine's: the two can disagree in a crafted file.
  const arch = f.anyCpu ? 'any CPU (.NET)' : f.bits === null ? name : `${name}, ${f.bits}-bit`;
  const role = f.subsystem === null
    ? f.library
      ? 'a library'
      : 'a kind its cut header does not say'
    : f.subsystem === 1
    ? 'a driver'
    : f.library
      ? 'a library'
      : f.subsystem === 3
        ? 'a console program'
        : f.subsystem === 2
          ? 'a window program'
          : f.subsystem >= 10 && f.subsystem <= 13
            ? 'an EFI program'
            : `subsystem ${f.subsystem}`;
  return `${arch} · ${role}`;
}

/** What the card calls it: "A Windows program", "A Windows library", "A Windows driver". */
export function programKicker(f: ProgramFacts): string {
  return f.subsystem === 1 ? 'A Windows driver' : f.library ? 'A Windows library' : 'A Windows program';
}

export interface ProgramRow {
  readonly label: string;
  readonly value: string;
  /** A quieter line under the value. */
  readonly note?: string;
  /** Times are milliseconds; the card words them. */
  readonly time?: number;
}

const CLAIM = 'the file’s own claim';

/** The rows the card shows, in order; a claim the file does not make has no row. */
export function programRows(f: ProgramFacts): ProgramRow[] {
  const rows: ProgramRow[] = [];
  const shown = (s: string): string => (s.length > PROGRAM_CLAIM_SHOWN ? `${s.slice(0, PROGRAM_CLAIM_SHOWN - 1)}…` : s);
  if (f.product) rows.push({ label: 'product', value: shown(f.product), note: CLAIM });
  if (f.version) rows.push({ label: 'version', value: shown(f.version), note: CLAIM });
  if (f.company) rows.push({ label: 'company', value: shown(f.company), note: CLAIM });
  if (f.description) rows.push({ label: 'description', value: shown(f.description), note: CLAIM });
  if (!f.hasVersion && !f.damaged) rows.push({ label: 'version', value: 'none: it carries no version resource' });
  rows.push({ label: 'built for', value: builtForWords(f), note: `${CLAIM}, from its header` });
  if (f.built !== null) rows.push({ label: 'built', value: '', time: f.built, note: `${CLAIM}: a build can write any time` });
  else if (f.stampNot === 'hash') rows.push({ label: 'built', value: 'not said: a reproducible build writes a hash there, not a time' });
  rows.push({
    label: 'signature',
    value: f.signature === 'present' ? 'Signature present, not verified' : f.signature === 'outside' ? 'A signature entry that points outside the file, not verified' : 'No signature',
    note: f.signature === 'none' ? 'none in the file itself; Windows can vouch for a file from a catalog elsewhere, which the app does not look at' : 'found in the file; the app never checks who signed it or whether it still holds',
  });
  if (f.damaged) rows.push({ label: 'damaged', value: `${f.damaged[0]!.toUpperCase()}${f.damaged.slice(1)}.` });
  if (f.cut) rows.push({ label: 'cut', value: `a string longer than ${PROGRAM_STRING_MAX / 1024} KB was cut short` });
  return rows;
}
