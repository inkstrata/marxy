// Text that is not UTF-8: how each open file's bytes were read, and the reader's encoding choices. A file that is UTF-8
// is read as it always was and nothing is held for it. Any other is read through the shell's `decodeText` (Rust; the
// memory shell's port in the browser dev loop): the store holds the text as UTF-8, and what is held here takes a place
// in it back to the file's bytes (`fileOffset`) and the text back to the file's encoding on a save (`encodedIo`).
import { bufferOffsetOf, fileOffsetOf, type DecodedText, type EncodingFound, type EncodingReadings } from '@marxy/core/src/encoding/byte-map.ts';
import { bomOf, firstNotUtf8Offset } from '@marxy/core/src/encoding/decode.ts';
import { fileKey, normalizePath } from '@marxy/core/src/index-model/paths.ts';
import type { ContentSignals } from '@marxy/core/src/kind/registry.ts';
import type { AppShell } from '../app.ts';
import type { StoreIo } from './store.ts';

export type EncodingShell = Pick<AppShell, 'decodeText' | 'encodeText' | 'encodingReadings'>;

interface Held {
  readonly found: EncodingFound;
  readonly map: DecodedText['map'];
  /** The page's text these were made for. */
  readonly text: Uint8Array;
  /** The file's bytes as last read or written. */
  readonly raw: Uint8Array;
}

const held = new Map<string, Held>();
/** The last decode of bytes read from disk and not yet adopted (a live reload's look): adopted when the store records them. */
const looked = new Map<string, Held>();
// One file, one entry, however its path is spelled (a Windows path in another case, `.` and `..`).
const key = (path: string): string => fileKey(path);

/** How `path`'s bytes were read, when they are not UTF-8 (or the reader chose an encoding); null for UTF-8. */
export function heldEncoding(path: string | null): Held | null {
  return path === null ? null : (held.get(key(path)) ?? null);
}

export function forgetEncoding(path: string): void {
  held.delete(key(path));
  looked.delete(key(path));
}

function hold(path: string, decoded: DecodedText, raw: Uint8Array): Held {
  const h: Held = { found: decoded.found, map: decoded.map, text: decoded.text, raw };
  held.set(key(path), h);
  return h;
}

// ---- the reader's choices (readings.json's `encodings`) -----------------------------------------------------------

/** By `key`; `path` is the spelling readings.json keeps it under. */
const choices = new Map<string, { readonly path: string; readonly label: string }>();
const listeners = new Set<(path: string) => void>();

export const encodingChoiceOf = (path: string): string | null => choices.get(key(path))?.label ?? null;

/** Reads `path` as `label` from now on (null: as its bytes say). The open file is read again by the caller. */
export function chooseEncoding(path: string, label: string | null): void {
  if (label === null) choices.delete(key(path));
  else choices.set(key(path), { path: normalizePath(path), label });
  for (const cb of [...listeners]) cb(path);
}

export function onEncodingChoice(cb: (path: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function encodingChoicesNow(): Record<string, string> {
  const rows = [...choices.values()].map(({ path, label }): [string, string] => [path, label]);
  return Object.fromEntries(rows.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** readings.json's choices, as read at launch; one made before the file was read (`touched`) wins over it. */
export function restoreEncodingChoices(saved: Readonly<Record<string, string>>, touched: ReadonlySet<string>): void {
  const touchedKeys = new Set([...touched].map(key));
  for (const [path, label] of Object.entries(saved)) {
    if (touchedKeys.has(key(path)) || choices.get(key(path))?.label === label) continue;
    choices.set(key(path), { path: normalizePath(path), label });
    // A file already open (the launch's) is read again under the choice it was kept with.
    for (const cb of [...listeners]) cb(path);
  }
}

export function clearEncodingChoices(): void {
  choices.clear();
}

// ---- reading -------------------------------------------------------------------------------------------------------

const DETECTED_NOT_UTF8 = new Set(['utf-16le', 'utf-16be', 'utf-32le', 'utf-32be', '8-bit']);
/** detect.rs reads this much of the head; past it, a byte that is not UTF-8 is found here. */
const HEAD_CHECKED = 8 * 1024;

/** Whether bytes read from `path` are read through `decodeText`: a choice, a BOM that is not UTF-8's, or bytes that are not UTF-8. */
function needsDecoding(path: string, raw: Uint8Array, signals: ContentSignals | null): boolean {
  if (encodingChoiceOf(path) !== null) return true;
  if (signals?.class === 'text' && signals.encoding !== undefined) {
    if (DETECTED_NOT_UTF8.has(signals.encoding)) return true;
    // The head was UTF-8; only the rest is looked at.
    if (raw.length <= HEAD_CHECKED) return false;
    return firstNotUtf8Offset(raw, HEAD_CHECKED - 4 > 0 ? backToCharStart(raw, HEAD_CHECKED - 4) : 0) >= 0;
  }
  const bom = bomOf(raw);
  if (bom) return bom.label !== 'utf-8';
  return firstNotUtf8Offset(raw) >= 0;
}

function backToCharStart(raw: Uint8Array, at: number): number {
  let i = at;
  while (i > 0 && (raw[i]! & 0xc0) === 0x80) i--;
  return i;
}

/**
 * The bytes the store holds for `raw`, read from `path`: `raw` itself when it is UTF-8 (nothing is held), else its text as
 * UTF-8, with how it was read held for the page. A shell without `decodeText` reads every file as UTF-8, as before.
 */
export async function textForStore(shell: EncodingShell, path: string, raw: Uint8Array, signals: ContentSignals | null): Promise<Uint8Array> {
  if (!shell.decodeText || !needsDecoding(path, raw, signals)) {
    forgetEncoding(path);
    return raw;
  }
  const decoded = await shell.decodeText(raw, encodingChoiceOf(path));
  if (decoded.map.kind === 'identity' && decoded.found.how !== 'chosen') {
    forgetEncoding(path);
    return raw;
  }
  return hold(path, decoded, raw).text;
}

/**
 * New bytes from disk for a file held here (a live reload's look): decoded as the file is read now, and adopted (held)
 * only when the store records them. A file not held is read as before, unless its new bytes are no longer UTF-8.
 */
export async function lookForStore(shell: EncodingShell, path: string, raw: Uint8Array): Promise<Uint8Array> {
  const now = heldEncoding(path);
  if (!shell.decodeText || (!now && !needsDecoding(path, raw, null))) return raw;
  const decoded = await shell.decodeText(raw, encodingChoiceOf(path));
  if (!now && decoded.map.kind === 'identity') return raw;
  const h: Held = { found: decoded.found, map: decoded.map, text: decoded.text, raw };
  looked.set(key(path), h);
  return h.text;
}

/** Files read again as UTF-8 by a choice (back to as they are), not yet adopted: what is held for them goes when they are. */
const backToUtf8 = new Set<string>();

/**
 * The file's bytes `raw` read again under the choice made now, staged for the store's reload to adopt (`adoptReread`):
 * the text, and the place in it of each of the file's bytes.
 */
export async function stageReread(shell: EncodingShell, path: string, raw: Uint8Array): Promise<{ readonly text: Uint8Array; toBuffer(f: number): number }> {
  const k = key(path);
  looked.delete(k);
  backToUtf8.delete(k);
  const asUtf8 = { text: raw, toBuffer: (f: number) => Math.min(f, raw.length) };
  if (!shell.decodeText || !needsDecoding(path, raw, null)) {
    backToUtf8.add(k);
    return asUtf8;
  }
  const d = await shell.decodeText(raw, encodingChoiceOf(path));
  if (d.map.kind === 'identity' && d.found.how !== 'chosen') {
    backToUtf8.add(k);
    return asUtf8;
  }
  const h: Held = { found: d.found, map: d.map, text: d.text, raw };
  looked.set(k, h);
  return { text: h.text, toBuffer: (f) => bufferOffsetOf(h.found, h.map, h.text, f) };
}

/** What `stageReread` staged is now how the file is read, whether or not the store's reload recorded it. */
export function adoptReread(path: string): void {
  const k = key(path);
  const next = looked.get(k);
  if (next) held.set(k, next);
  else if (backToUtf8.has(k)) held.delete(k);
  looked.delete(k);
  backToUtf8.delete(k);
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a === b || (a.length === b.length && a.every((v, i) => v === b[i]));

/** How many stores' io follow each path: what is held for a path goes when the last of them closes. */
const following = new Map<string, number>();
const follow = (path: string, by: number): void => {
  const k = key(path);
  const n = (following.get(k) ?? 0) + by;
  if (n > 0) following.set(k, n);
  else following.delete(k);
};

/**
 * What is held for `from` is now `to`'s: the store's file was renamed, or saved under a new name. `from` keeps its
 * own while another store still follows it.
 */
function moveHeld(from: string, to: string, keep: boolean): void {
  const [a, b] = [key(from), key(to)];
  const h = held.get(a);
  if (h) held.set(b, h);
  else held.delete(b);
  looked.delete(b);
  backToUtf8.delete(b);
  if (keep) return;
  held.delete(a);
  looked.delete(a);
  backToUtf8.delete(a);
}

/**
 * The store's own io, writing and reading `path` in its encoding: the text goes back to the file's bytes on a save. Given
 * the store's `path`, what is held follows the store: to a new name (a rename, a Save As, which writes the encoding and
 * byte-order mark the file was read in), and away when the store closes.
 */
export function encodedIo(io: StoreIo, shell: EncodingShell, path?: string): StoreIo {
  let current = path;
  if (current !== undefined) follow(current, 1);
  /** The store now answers to `to`. */
  const moveTo = (to: string): void => {
    if (current === undefined || key(current) === key(to)) return;
    moveHeld(current, to, (following.get(key(current)) ?? 0) > 1);
    follow(current, -1);
    follow(to, 1);
    current = to;
  };
  /** The path whose encoding a write to `to` is in: the store's own, for a Save As or a copy beside the file. */
  const readAs = (to: string): string => current ?? to;
  const encodeFor = (path: string, text: Uint8Array): Promise<Uint8Array> => encodeAs(shell, path, text);
  /**
   * The file's bytes for the store's baseline text, for the shell to check: what is held when the text is what was held.
   * Otherwise the file is read and decoded, and its bytes stand only if they read as that text; the shell's own record of
   * the last read is never the fallback, since Marxy's own reads and writes of the file move it.
   */
  const expectedFile = async (path: string, expected: Uint8Array): Promise<Uint8Array> => {
    const held = fileBytesOfText(readAs(path), expected);
    if (held) return held;
    if (!io.peekFile || !shell.decodeText) {
      throw Object.assign(new Error(`${path}: what was read cannot be told apart from what is on disk now; refusing to overwrite`), { code: 'changed' });
    }
    let raw: Uint8Array;
    try {
      raw = await io.peekFile(path);
    } catch {
      // Gone: nothing to compare. The shell writes only while the name is still free.
      return expected;
    }
    const now = await shell.decodeText(raw, encodingChoiceOf(readAs(path)));
    if (sameBytes(now.text, expected)) return raw;
    throw Object.assign(new Error(`${path}: changed on disk since it was opened; refusing to overwrite`), { code: 'changed' });
  };
  /** The baseline text of the last save in place and the file's bytes the shell checked it against. */
  let replaced: { readonly key: string; readonly text: Uint8Array; readonly file: Uint8Array } | null = null;
  const out: StoreIo = {
    ...io,
    async writeFileAtomic(path, text, expected) {
      const h = heldEncoding(readAs(path));
      const bytes = await encodeFor(readAs(path), text);
      const file = expected === undefined ? undefined : await expectedFile(path, expected);
      await io.writeFileAtomic(path, bytes, file);
      // What the shell found on disk and replaced, for the copy kept after a save in place: by then what is held is the new bytes.
      replaced = expected !== undefined && file !== undefined ? { key: key(path), text: expected, file } : null;
      // Moved only once written: a Save As that fails leaves the store, and what is held for it, where they were.
      moveTo(path);
      if (!h || bytes === text) return;
      // A table names the characters of the text it was made for: the written bytes are read again for a new one.
      if (h.map.kind === 'table' && shell.decodeText) hold(path, await shell.decodeText(bytes, encodingChoiceOf(path)), bytes);
      else held.set(key(path), { ...h, text, raw: bytes, found: { ...h.found, fileBytes: bytes.length } });
    },
    // Always there, guard or not: a reload's text is adopted here, before the store tells anyone it changed.
    recordRead: (path, text) => {
      // A rename records the bytes at the new name before the store moves there.
      moveTo(path);
      const k = key(path);
      const next = looked.get(k);
      if (next && sameBytes(next.text, text)) {
        held.set(k, next);
        looked.delete(k);
        return io.recordRead?.(path, next.raw);
      }
      if (backToUtf8.has(k) && sameBytes(text, held.get(k)?.raw ?? new Uint8Array(0))) {
        held.delete(k);
        backToUtf8.delete(k);
      }
      const h = held.get(k);
      // The bytes the stale-write guard compares with disk are the file's, never the page's text.
      if (h) return sameBytes(h.text, text) ? io.recordRead?.(path, h.raw) : undefined;
      io.recordRead?.(path, text);
    },
    peekFile: io.peekFile
      ? async (path) => {
          const raw = await io.peekFile!(path);
          const h = heldEncoding(path);
          if (!h || !shell.decodeText) return raw;
          return (await shell.decodeText(raw, encodingChoiceOf(path))).text;
        }
      : undefined,
    // The copy kept before a save is of the file, in its own encoding: what is held when the text is what was held, else the
    // file read again as it is (a Save As onto a file that changed), else the text written back as the save would write it.
    beforeOverwrite: io.beforeOverwrite
      ? async (path, replacing) => {
          const saved = replaced !== null && replaced.key === key(path) && sameBytes(replaced.text, replacing) ? replaced.file : null;
          replaced = null;
          let file = saved ?? fileBytesOfText(path, replacing);
          if (file === null && io.peekFile) file = await io.peekFile(path).catch(() => null);
          if (file === null) file = await encodeFor(path, replacing).catch(() => null);
          if (file === null) {
            console.warn(`marxy: no copy of ${path} was kept before the save: its bytes on disk could not be had`);
            return;
          }
          return io.beforeOverwrite!(path, file);
        }
      : undefined,
    // A copy beside the file ("(mine)") is the file's: in its encoding, or not written at all.
    writeFileNew: io.writeFileNew ? async (path, text) => io.writeFileNew!(path, await fileBytesFor(shell, readAs(path), text)) : undefined,
    closed: (path) => {
      io.closed?.(path);
      const at = current ?? path;
      if (current !== undefined) follow(current, -1);
      current = undefined;
      if (!following.has(key(at))) forgetEncoding(at);
    },
  };
  return out;
}

// ---- kept copies ----------------------------------------------------------------------------------------------------
// A version is the file's own bytes, as another program would open it; the store holds the page's text (UTF-8). These
// two are the only ways between them, so a copy is never spliced into a store as text, nor kept as one.

/**
 * The file's bytes for `text`, `path`'s page text as last read or written: the text itself for a UTF-8 file, the bytes
 * held for it otherwise; null when what is held is of other text, so there is no knowing the file's bytes from here.
 */
export function fileBytesOfText(path: string, text: Uint8Array): Uint8Array | null {
  const h = heldEncoding(path);
  if (!h) return text;
  return sameBytes(h.text, text) ? h.raw : null;
}

/** `text`, `path`'s page text, in the encoding `path` was read in; rejects, writing nothing, when that would change its bytes. */
async function encodeAs(shell: EncodingShell, path: string, text: Uint8Array): Promise<Uint8Array> {
  const h = heldEncoding(path);
  if (!h || h.found.label === 'utf-8') return text;
  if (!h.found.writable) {
    throw new Error(`${h.found.unreadable > 0 ? `${h.found.unreadable} of its bytes cannot be read as ${h.found.name}` : `its bytes do not come back the same from ${h.found.name}`}, so saving would change them; it was not saved. The bytes are as they were.`);
  }
  if (!shell.encodeText) throw new Error(`This shell cannot write ${h.found.name}; it was not saved.`);
  return shell.encodeText(text, h.found.label, h.found.bom > 0);
}

/**
 * The file's bytes for `text`, `path`'s page text, to write elsewhere (a fork, a copy beside it): the bytes held for
 * it when the text is what was held, else the text in `path`'s encoding. Rejects with `code: 'encoding'` and the
 * encoding's `name` when that encoding cannot hold it, so the refusal can say what the reader can do instead.
 */
export async function fileBytesFor(shell: EncodingShell, path: string, text: Uint8Array): Promise<Uint8Array> {
  const held = fileBytesOfText(path, text);
  if (held) return held;
  try {
    return await encodeAs(shell, path, text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(message), { code: 'encoding', encoding: heldEncoding(path)?.found.name ?? 'its encoding', cause: error });
  }
}

/** A kept copy of `path` (the file's bytes) as the text its store holds: read in the encoding the open file is read in now. */
export async function textOfFileBytes(shell: EncodingShell, path: string, file: Uint8Array): Promise<Uint8Array> {
  const h = heldEncoding(path);
  if (!h || !shell.decodeText) return file;
  return (await shell.decodeText(file, h.found.label)).text;
}

// ---- places ---------------------------------------------------------------------------------------------------------

/** The file's byte for the page's `b` in `path` (the page's bytes are `text`); `b` itself for a UTF-8 file. */
export function fileOffset(path: string | null, text: Uint8Array, b: number): number {
  const h = heldEncoding(path);
  return h ? fileOffsetOf(h.found, h.map, text, b) : b;
}

/** The page's byte for the file's `f` in `path`; `f` itself for a UTF-8 file. */
export function bufferOffset(path: string | null, text: Uint8Array, f: number): number {
  const h = heldEncoding(path);
  return h ? bufferOffsetOf(h.found, h.map, text, f) : f;
}

/** The file's size on disk, for a file held here; null for a UTF-8 file (its buffer is its bytes). */
export function fileBytesOf(path: string | null): number | null {
  return heldEncoding(path)?.found.fileBytes ?? null;
}

/** Read with encoding...'s rows for `path`, from the bytes last read. */
export async function readingsFor(shell: EncodingShell, path: string, raw: Uint8Array): Promise<EncodingReadings | null> {
  if (!shell.encodingReadings) return null;
  return shell.encodingReadings(heldEncoding(path)?.raw ?? raw);
}
