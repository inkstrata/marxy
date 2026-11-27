// What in an archive needs a careful look, found from the listing and the entries' first bytes before
// anything is unpacked: each said in one or two words for the list and in a full sentence for the preview's head and the
// lede. Pure.
import { invisibleSegments } from '../render/invisibles.ts';
import type { ArchiveEntryLike, ArchiveListingLike } from './archive-read.ts';
import type { EntryReading } from './archive-reading.ts';

export type Care = 'climbs-out' | 'from-root' | 'misleading' | 'not-its-name' | 'named-twice' | 'swells' | 'encrypted';

export interface CareSaid {
  readonly care: Care;
  readonly words: string;
  readonly sentence: string;
}

/** An entry swells when it unpacks to at least this many times its packed size, and to at least `SWELL_FLOOR` bytes. */
export const SWELL_RATIO = 100;
/** Below a megabyte a high ratio is a run of blank lines, not a bomb. */
export const SWELL_FLOOR = 1024 * 1024;

const n2 = (n: number): string => n.toLocaleString('en-GB');

/** The raw name leads above the folder it is unpacked into: a `..` that is not undone by a folder before it. */
export function climbsOut(raw: string): boolean {
  let depth = 0;
  for (const seg of raw.replace(/\\/g, '/').split('/')) {
    if (seg === '..') {
      if (--depth < 0) return true;
    } else if (seg !== '' && seg !== '.') depth++;
  }
  return false;
}

/** The raw name starts at the root of a disk: a slash, or a drive. */
export const fromRoot = (raw: string): boolean => /^[/\\]|^[A-Za-z]:/.test(raw);

/** A name holding a character that hides or reorders the rest: the characters Read draws as marks. */
export function misleadingName(path: string): boolean {
  if (/^[\x20-\x7e]*$/.test(path)) return false;
  return invisibleSegments(path, { inCode: false, sourceStart: 1 }).some((s) => s.kind !== 'text');
}

/** How many times its packed size an entry unpacks to, when it swells; null when it does not. */
export function swellsBy(e: Pick<ArchiveEntryLike, 'size' | 'packed'>): number | null {
  if (e.size === null || e.packed === null || e.size < SWELL_FLOOR) return null;
  const ratio = e.size / Math.max(1, e.packed);
  return ratio >= SWELL_RATIO ? Math.round(ratio) : null;
}

/** Every entry that needs care, by index, each with what it needs in the order the list says them. */
export function careOf(listing: ArchiveListingLike, readings?: ReadonlyMap<number, EntryReading>): ReadonlyMap<number, readonly CareSaid[]> {
  const out = new Map<number, CareSaid[]>();
  const add = (i: number, said: CareSaid): void => {
    const list = out.get(i);
    if (list) list.push(said);
    else out.set(i, [said]);
  };
  const seen = new Map<string, number>();
  const twice = new Set<number>();
  for (const e of listing.entries) {
    if (e.kind === 'dir') continue;
    const first = seen.get(e.path);
    if (first === undefined) seen.set(e.path, e.index);
    else twice.add(first).add(e.index);
  }
  for (const e of listing.entries) {
    if (e.kind === 'dir') continue;
    const raw = e.rawName;
    if (raw !== null && climbsOut(raw)) {
      add(e.index, { care: 'climbs-out', words: 'climbs out', sentence: `The archive names it ${raw}: unpacked as written, it would land outside the folder it is unpacked into.` });
    }
    if (raw !== null && fromRoot(raw)) {
      add(e.index, { care: 'from-root', words: 'starts at the root', sentence: `The archive names it ${raw}: unpacked as written, it would land at the root of a disk.` });
    }
    if (misleadingName(e.path)) {
      add(e.index, { care: 'misleading', words: 'misleading name', sentence: 'Its name holds a character that hides or reorders the rest; it is drawn here as written, with that character shown.' });
    }
    const rd = readings?.get(e.index);
    if (rd?.disagrees) {
      const ext = rd.ext ? `.${rd.ext}` : 'nothing';
      add(e.index, { care: 'not-its-name', words: rd.ext ? `not a .${rd.ext}` : 'not its name', sentence: `Its name says ${ext}; its bytes are ${rd.label}.` });
    }
    if (twice.has(e.index)) {
      add(e.index, { care: 'named-twice', words: 'named twice', sentence: 'Another entry has this path: which one is kept depends on the tool that unpacks it.' });
    }
    const swell = swellsBy(e);
    if (swell !== null) {
      add(e.index, { care: 'swells', words: `swells ${n2(swell)}×`, sentence: `It unpacks to ${n2(swell)} times its packed size: ${n2(e.size!)} bytes from ${n2(e.packed!)}.` });
    }
    if (e.encrypted) {
      add(e.index, { care: 'encrypted', words: 'encrypted', sentence: 'Its contents are encrypted: its name, sizes and date are written in the clear, and the rest is not read here.' });
    }
  }
  return out;
}
