// An archive's entry opened into memory: read-only, in a tab of its own, up to 16 MB, with a
// line saying what it is, and in neither the Library, Recent nor the index. Its path is not a path on disk, only a name
// that keeps two entries apart (`archive-entry:3/docs/config.md`, the entry's own name last so its kind is read from its
// name): nothing may treat it as a location. Its bytes live here, in memory, while a tab may show it. Light on purpose:
// the open path reads it, so it imports nothing a document's first text would wait on.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { ContentSignals } from '@marxy/core/src/kind/registry.ts';
import { looksLikeMessage } from '@marxy/core/src/mail/sniff.ts';
import { magicOf, textTest } from '@marxy/core/src/viewer/bytes.ts';
import type { DocumentStore } from './store.ts';

export interface HeldEntry {
  readonly path: string;
  /** The archive's own path: on disk, or the `archive-entry:` path of the entry it was read from. */
  readonly archive: string;
  /** The entry's sanitised path inside it. */
  readonly name: string;
  readonly index: number;
  readonly bytes: Uint8Array;
  readonly mtimeMs: number | null;
  /**
   * What the archive is to it: an archive's entry, a message's attachment, or a database's cell. Only an
   * archive's entry is read by the shell's readers from where it lies.
   */
  readonly of: 'archive' | 'message' | 'cell';
  /** Only its beginning is held: the entry's whole size, which `bytes` falls short of. */
  readonly size?: number;
  /** 1 for an entry of an archive on disk, 2 for an entry of that entry, and so on. */
  readonly depth: number;
  /** What its tab says when it lands, where the opener knows better words than an entry's (a database's BLOB). */
  readonly said?: string;
}

const SHAPE = /^archive-entry:\d+\//;
/** Entries held at once; the oldest goes first, and a tab that still names it says to open it again. */
const HELD_CAP = 24;

const held = new Map<string, HeldEntry>();
const byKey = new Map<string, string>();
const dropped = new Set<(path: string) => void>();
/** Numbers are never reused, so a tab naming an entry let go cannot reach a newer one. */
const issued = { last: 0 };

const keyOf = (o: { archive: string; index: number; name: string }): string => `${o.archive}\u0000${o.index}\u0000${o.name}`;

export const isArchiveEntry = (path: string | null | undefined): boolean => typeof path === 'string' && SHAPE.test(path);

export const heldEntry = (path: string): HeldEntry | null => held.get(path) ?? previews.get(path) ?? tiles.get(path) ?? null;

/** Runs when an entry is let go (its blob URL, say). */
export function onEntryDropped(cb: (path: string) => void): void {
  dropped.add(cb);
}

/** Entries a pane has shown: one of these no pane shows now has no tab to come back to (the frame drops it). */
const landed = new Set<string>();

function drop(path: string): void {
  const gone = held.get(path);
  held.delete(path);
  landed.delete(path);
  if (gone && byKey.get(keyOf(gone)) === path) byKey.delete(keyOf(gone));
  for (const cb of dropped) cb(path);
  readFrom(path);
}

/** What was read from an entry let go goes with it: its previews, its tiles, and its own entries held for tabs. */
function readFrom(path: string): void {
  for (const [p, e] of [...previews]) if (e.archive === path) dropPreview(p);
  for (const [p, e] of [...tiles]) if (e.archive === path) dropTile(p);
  for (const [p, e] of [...held]) if (e.archive === path) drop(p);
}

/** An entry read from an entry: one level below what it was read from. A parent already gone counts as too deep. */
const depthUnder = (archive: string): number => (SHAPE.test(archive) ? (heldEntry(archive)?.depth ?? Number.POSITIVE_INFINITY) + 1 : 1);

/** The oldest entry held for a tab that no other is read from: a parent goes only with its last child. */
function evictOldest(): boolean {
  const parents = new Set([...held.values()].map((e) => e.archive));
  for (const p of held.keys()) {
    if (parents.has(p)) continue;
    drop(p);
    return true;
  }
  return false;
}

/** Holds an entry's bytes and gives it its path; the same entry asked for again keeps its path (and its tab). */
export function holdEntry(o: { archive: string; name: string; index: number; bytes: Uint8Array; mtimeMs: number | null; of?: 'archive' | 'message' | 'cell'; said?: string }): HeldEntry {
  const key = keyOf(o);
  const known = byKey.get(key);
  // Held again (the archive may have changed): what was made from the old bytes, its picture's URL, goes with them.
  if (known) for (const cb of dropped) cb(known);
  if (known) held.delete(known);
  const path = known ?? `archive-entry:${++issued.last}/${o.name}`;
  if (known) readFrom(known);
  const entry: HeldEntry = { path, archive: o.archive, name: o.name, index: o.index, bytes: o.bytes, mtimeMs: o.mtimeMs, of: o.of ?? 'archive', depth: depthUnder(o.archive), ...(o.said ? { said: o.said } : {}) };
  held.set(path, entry);
  byKey.set(key, path);
  while (held.size > HELD_CAP && evictOldest());
  return entry;
}

// Entries held for an archive page's preview: a pool of their own, so following the cursor through an
// archive never pushes out an entry a tab shows. `o` on a previewed entry moves it to the tabs' entries, not read again.
const PREVIEW_CAP = 6;
const previews = new Map<string, HeldEntry>();

function dropPreview(path: string): void {
  if (!previews.delete(path)) return;
  for (const cb of dropped) cb(path);
  readFrom(path);
}

/** Holds an entry's bytes (or its beginning: `size` is then its whole size) for a preview; the oldest of six goes first. */
export function holdPreview(o: { archive: string; name: string; index: number; bytes: Uint8Array; mtimeMs: number | null; size?: number }): HeldEntry {
  const path = `archive-entry:${++issued.last}/${o.name}`;
  const entry: HeldEntry = { path, archive: o.archive, name: o.name, index: o.index, bytes: o.bytes, mtimeMs: o.mtimeMs, of: 'archive', depth: depthUnder(o.archive), ...(o.size !== undefined ? { size: o.size } : {}) };
  previews.set(path, entry);
  while (previews.size > PREVIEW_CAP) dropPreview(previews.keys().next().value!);
  return entry;
}

/** Whether `path` is held for a preview, not for a tab. */
export const isPreviewHeld = (path: string): boolean => previews.has(path);

/**
 * A previewed entry, held whole, taken into the tabs' entries under the path it has; null when it is not in the pool or
 * only its beginning is held. An entry already held for a tab keeps its own path and the preview's copy is let go.
 */
export function promotePreview(path: string): HeldEntry | null {
  const e = previews.get(path);
  if (!e || e.size !== undefined) return null;
  if (byKey.has(keyOf(e))) {
    dropPreview(path);
    return held.get(byKey.get(keyOf(e))!) ?? null;
  }
  previews.delete(path);
  held.set(path, e);
  byKey.set(keyOf(e), path);
  while (held.size > HELD_CAP && evictOldest());
  return e;
}

/** Lets go of every preview of `archive`'s entries (its page went), or of the one at `path`. */
export function releasePreviews(o: { archive?: string; path?: string }): void {
  for (const [path, e] of [...previews]) if (path === o.path || (o.archive !== undefined && e.archive === o.archive)) dropPreview(path);
}

// Entries held for an archive's sheet: a pool of their own, apart from the tabs' and the previews', so
// a sheet scrolled through pushes out neither. The sheet bounds how many it keeps and lets each go as its tile leaves.
const TILE_CAP = 96;
const tiles = new Map<string, HeldEntry>();

function dropTile(path: string): void {
  if (!tiles.delete(path)) return;
  for (const cb of dropped) cb(path);
}

/** Holds an entry's bytes (or its beginning: `size` is then its whole size) for a sheet's tile. */
export function holdTile(o: { archive: string; name: string; index: number; bytes: Uint8Array; mtimeMs: number | null; size?: number }): HeldEntry {
  const path = `archive-entry:${++issued.last}/${o.name}`;
  const entry: HeldEntry = { path, archive: o.archive, name: o.name, index: o.index, bytes: o.bytes, mtimeMs: o.mtimeMs, of: 'archive', depth: depthUnder(o.archive), ...(o.size !== undefined ? { size: o.size } : {}) };
  tiles.set(path, entry);
  while (tiles.size > TILE_CAP) dropTile(tiles.keys().next().value!);
  return entry;
}

/** Lets go of a tile's entry, or every tile of `archive` (its page went). */
export function releaseTiles(o: { archive?: string; path?: string }): void {
  for (const [path, e] of [...tiles]) if (path === o.path || (o.archive !== undefined && e.archive === o.archive)) dropTile(path);
}

/** How many entries are held for tiles now. */
export const tilesHeld = (): number => tiles.size;

/**
 * Lets go of every entry a pane has shown that none of `shown` (what the panes show now) is: a tab is the only way back
 * to one, and the frame keeps none for an entry off screen, so its bytes (up to 16 MB each) are not held for nothing.
 */
export function releaseEntriesNotShown(shown: Iterable<string | null>): void {
  const now = new Set(shown);
  // An entry shown keeps what it was read from, so its address and its way back stay whole.
  const kept = new Set(now);
  for (const p of now) for (let e = p ? held.get(p) : undefined; e && SHAPE.test(e.archive); e = held.get(e.archive)) kept.add(e.archive);
  for (const path of [...held.keys()]) {
    if (now.has(path)) landed.add(path);
    else if (landed.has(path) && !kept.has(path) && held.has(path)) drop(path);
  }
}

/** "tidemark-0.5.0.zip › tidemark-0.5.0/docs/config.md", where a file's path would be said; null for any other path. */
export function entryWhere(path: string): string | null {
  const e = isArchiveEntry(path) ? heldEntry(path) : undefined;
  if (!e) return null;
  const outer = e.of === 'archive' && SHAPE.test(e.archive) ? entryWhere(e.archive) : null;
  return `${outer ?? basename(e.archive)} › ${e.name}`;
}

/**
 * An archive's entry named as the cursor addresses it, every level joined: `survey.zip!/backups/notes.tar.gz!/notes/a.md`.
 * Null for any other path, an attachment and a cell included.
 */
export function entryAddress(path: string): string | null {
  const e = isArchiveEntry(path) ? heldEntry(path) : undefined;
  if (!e || e.of !== 'archive') return null;
  return `${(SHAPE.test(e.archive) ? entryAddress(e.archive) : null) ?? basename(e.archive)}!/${e.name}`;
}

/** The line the entry's tab carries while it is open. */
export function entryLine(e: HeldEntry): string {
  if (e.said) return e.said;
  return `${e.of === 'message' ? 'An attachment of' : 'An entry of'} ${basename(e.archive)}, opened into memory when you asked: ${e.name}. It is not on disk, and nothing here can be edited.`;
}

/** Said when a save or an edit is asked of an entry. */
export function entryRefusal(path: string): string {
  const e = held.get(path);
  const name = basename(e?.name ?? path);
  return `${name} is ${e?.of === 'message' ? 'an attachment of' : 'an entry of'} ${e ? basename(e.archive) : 'an archive'}, opened into memory: it is not on disk, and nothing here can be edited or saved · nothing was written.`;
}

/** Said when a tab names an entry no longer held. */
export const entryGone = (path: string): string => `${basename(path)} is no longer held in memory: open it again from its archive or message.`;

const FORMAT_EXT: Readonly<Record<string, string>> = {
  PNG: 'png', JPEG: 'jpg', GIF: 'gif', WebP: 'webp', AVIF: 'avif', BMP: 'bmp', ICO: 'ico', TIFF: 'tif', HEIC: 'heic', 'JPEG XL': 'jxl', QOI: 'qoi', OpenEXR: 'exr',
  PDF: 'pdf', 'a zip archive': 'zip', gzip: 'gz', 'a 7z archive': '7z', 'a Windows program': 'exe', 'an SQLite database': 'sqlite',
};

/** What an entry's head says it is, as detection says it of a file: magic it knows, or a NUL, is binary. */
export function entrySignals(path: string): ContentSignals | null {
  const e = heldEntry(path);
  if (!e) return null;
  const head = e.bytes.subarray(0, 8192);
  if (head.length === 0) return { class: 'empty' };
  const magic = magicOf(head);
  const format = magic ? FORMAT_EXT[magic.format] : undefined;
  if (format || textTest(head).nul > 0) return { class: 'binary', format };
  // An attached message (message/rfc822) is mail by its headers whatever it was called.
  if (!/\.[^./]+$/.test(e.name.slice(e.name.lastIndexOf('/') + 1)) && looksLikeMessage(head)) return { class: 'text', lang: 'eml' };
  return { class: 'text' };
}

/**
 * The entry's store, read-only: an edit, a commit from Source, a save or a rename is refused and said, and nothing
 * changes. Reads pass through untouched.
 */
export function readOnlyStore(store: DocumentStore, say: (text: string) => void): DocumentStore {
  const path = store.snapshot().path;
  const refuse = (): void => say(entryRefusal(path));
  return Object.assign(Object.create(store) as DocumentStore, {
    apply: async () => {
      refuse();
      return false;
    },
    commitSource: async () => {
      refuse();
      return false;
    },
    save: async () => {
      refuse();
      return { result: 'failed' as const, error: Object.assign(new Error(entryRefusal(path)), { code: 'refused' }) };
    },
    rename: async () => {
      refuse();
      throw Object.assign(new Error(entryRefusal(path)), { code: 'refused' });
    },
  });
}

/** What a file read as lines past the read-only size says when Read is asked to change it. */
export const LINES_READ_ONLY_WORDS = 'Past 32 MB a file is only read here: Source edits it.';

/**
 * A file read as lines from 32 MB: every edit made outside Source's editor (the parts cursor, a transform, the Outline, a
 * replace from Search) is refused and said; the editor's own commit, undo, redo and saving pass through. Decided once per
 * open and held in either mode, so the Transform sheet is refused from Source too.
 */
export function editsOnlyInSource(store: DocumentStore, say: () => void): DocumentStore {
  return Object.assign(Object.create(store) as DocumentStore, {
    apply: async () => {
      say();
      return false;
    },
  });
}
