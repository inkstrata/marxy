// The shell as the viewers see an archive's entry held in memory (`document/entries.ts`): the image page, the file
// card and its bytes read it from memory, its picture or recording is played through a blob URL, and nothing of it names
// a place on disk. A database, a workbook, a font or a recording is read by the shell's own readers from the archive, by
// the entry's index and name. An entry that is itself an archive is listed and read from the held bytes
// by core's reader (`archive-nested.ts`), never by the shell. Any other path goes to the shell itself.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { imageFactsFromBytes, imageFormatOf } from '@marxy/core/src/viewer/image-facts.ts';
import { mimeOfExtension } from '@marxy/core/src/viewer/media.ts';
import type { ArchiveEntryRef, FileStat, ImageFacts } from '@marxy/shell-api';
import type { AppShell } from '../app-types.ts';
import { entryGone, heldEntry, isArchiveEntry, onEntryDropped, type HeldEntry } from '../document/entries.ts';
import { boundedInflate } from './archive-bytes.ts';
import { headsHeld, listHeld, readHeld } from './archive-nested.ts';

const MIME: Readonly<Record<string, string>> = {
  png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
};

const urls = new Map<string, string>();
onEntryDropped((path) => {
  const url = urls.get(path);
  if (url) URL.revokeObjectURL(url);
  urls.delete(path);
});

function blobUrl(e: HeldEntry): string {
  let url = urls.get(e.path);
  if (!url) {
    const format = imageFormatOf(e.bytes);
    // A recording is played from the blob: its player is told its type by the entry's name, as a file's is.
    const media = mimeOfExtension(e.name.slice(e.name.lastIndexOf('.') + 1).toLowerCase()).split(';')[0];
    url = URL.createObjectURL(new Blob([e.bytes.slice()], { type: (format && MIME[format]) || media || 'application/octet-stream' }));
    urls.set(e.path, url);
  }
  return url;
}

const inflate = (packed: Uint8Array, limit?: number): Promise<Uint8Array> => boundedInflate(packed, 'deflate', limit);

/** Said of a database, workbook, font or recording two levels down or deeper, which the shell's readers cannot reach. */
export const nestedReader = (e: HeldEntry): string =>
  `${basename(e.name)} is inside ${basename(e.archive)}, itself inside an archive: a database, workbook, font or recording is read only from an archive on disk, not from one held in memory.`;

export function entryShell(shell: AppShell): AppShell {
  const gone = (path: string): Error => Object.assign(new Error(entryGone(path)), { code: 'not-found', path });
  const noPlace = (path: string): Error =>
    Object.assign(new Error(`${basename(path)} is an entry of an archive, held in memory: it has no folder and no place on disk.`), { code: 'unsupported', path });
  /** The archive a reader reads an entry from, and which entry; a message's attachment or a database's cell has none. */
  const inArchive = (path: string): { archive: string; at: ArchiveEntryRef } => {
    const e = heldEntry(path);
    if (!e) throw gone(path);
    if (e.of !== 'archive') throw noPlace(path);
    // The shell reads from an archive on disk only: an entry of an entry has none to name.
    if (isArchiveEntry(e.archive)) throw Object.assign(new Error(nestedReader(e)), { code: 'unsupported', path });
    return { archive: e.archive, at: { index: e.index, name: e.name } };
  };
  // A path that is not an entry passes through whole, its `inArchive` included: a preview's viewer wraps a shell that is
  // already an entry's shell, so the outer layer carries the inner one's call.
  const { fontFacts, fontGlyph, mediaFacts, mediaEnvelope } = shell;
  const readers: Partial<AppShell> = {
    ...(fontFacts && {
      fontFacts(path: string, given?: ArchiveEntryRef) {
        if (!isArchiveEntry(path)) return fontFacts.call(shell, path, given);
        const { archive, at } = inArchive(path);
        return fontFacts.call(shell, archive, at);
      },
    }),
    ...(fontGlyph && {
      fontGlyph(path: string, face: number, code: number, given?: ArchiveEntryRef) {
        if (!isArchiveEntry(path)) return fontGlyph.call(shell, path, face, code, given);
        const { archive, at } = inArchive(path);
        return fontGlyph.call(shell, archive, face, code, at);
      },
    }),
    ...(mediaFacts && {
      mediaFacts(path: string, given?: ArchiveEntryRef) {
        if (!isArchiveEntry(path)) return mediaFacts.call(shell, path, given);
        const { archive, at } = inArchive(path);
        return mediaFacts.call(shell, archive, at);
      },
    }),
    ...(mediaEnvelope && {
      mediaEnvelope(path: string, buckets: number, given?: ArchiveEntryRef) {
        if (!isArchiveEntry(path)) return mediaEnvelope.call(shell, path, buckets, given);
        const { archive, at } = inArchive(path);
        return mediaEnvelope.call(shell, archive, buckets, at);
      },
    }),
  };
  return Object.assign(Object.create(shell) as AppShell, readers, {
    async stat(path: string): Promise<FileStat | null> {
      if (!isArchiveEntry(path)) return shell.stat(path);
      const e = heldEntry(path);
      return e ? { path, size: e.bytes.length, mtimeMs: e.mtimeMs ?? 0, isDir: false } : null;
    },
    async readHead(path: string, maxBytes: number): Promise<Uint8Array> {
      if (!isArchiveEntry(path)) return shell.readHead(path, maxBytes);
      const e = heldEntry(path);
      if (!e) throw gone(path);
      return e.bytes.slice(0, Math.min(maxBytes, 256 * 1024));
    },
    async readRange(path: string, offset: number, length: number): Promise<Uint8Array> {
      if (!isArchiveEntry(path)) return shell.readRange(path, offset, length);
      const e = heldEntry(path);
      if (!e) throw gone(path);
      const from = Math.max(0, offset);
      return e.bytes.slice(from, from + Math.max(0, length));
    },
    async imageFacts(path: string): Promise<ImageFacts | null> {
      if (!isArchiveEntry(path)) return shell.imageFacts(path);
      const e = heldEntry(path);
      if (!e) return null;
      const facts = (await imageFactsFromBytes(e.bytes, { inflate, system: 'this system' })) as ImageFacts | null;
      // The shell decodes only a file on disk; an entry the webview cannot draw is the card, which says so.
      if (facts?.show === 'decoded') return { ...facts, show: 'none', why: 'An entry held in memory is drawn by the webview alone, which cannot draw this format.' };
      return facts;
    },
    fileUrl(path: string): string {
      const e = isArchiveEntry(path) ? heldEntry(path) : null;
      return e ? blobUrl(e) : shell.fileUrl(path);
    },
    async readDir(dir: string) {
      if (isArchiveEntry(dir)) throw noPlace(dir);
      return shell.readDir(dir);
    },
    async allowAssetScope(dir: string): Promise<void> {
      if (!isArchiveEntry(dir)) return shell.allowAssetScope(dir);
    },
    async listArchive(path: string) {
      if (!isArchiveEntry(path)) return shell.listArchive(path);
      const e = heldEntry(path);
      if (!e) throw gone(path);
      return listHeld(e);
    },
    async readArchiveEntry(path: string, index: number, name: string) {
      if (!isArchiveEntry(path)) return shell.readArchiveEntry(path, index, name);
      const e = heldEntry(path);
      if (!e) throw gone(path);
      return readHeld(e, index, name);
    },
    async readArchiveHeads(path: string, wants: readonly { index: number; name: string }[], maxEach: number) {
      if (!isArchiveEntry(path)) return shell.readArchiveHeads(path, wants, maxEach);
      const e = heldEntry(path);
      if (!e) throw gone(path);
      return headsHeld(e, wants, maxEach);
    },
    async tablesOpen(path: string, alone?: boolean, given?: ArchiveEntryRef) {
      if (!isArchiveEntry(path)) return shell.tablesOpen(path, alone, given);
      const { archive, at } = inArchive(path);
      return shell.tablesOpen(archive, false, at);
    },
    async tablesRows(path: string, part: string, from: number, count: number, alone?: boolean, full?: boolean, given?: ArchiveEntryRef) {
      if (!isArchiveEntry(path)) return shell.tablesRows(path, part, from, count, alone, full, given);
      const { archive, at } = inArchive(path);
      return shell.tablesRows(archive, part, from, count, false, full, at);
    },
    async tablesBlob(path: string, part: string, rowid: number | null, row: number, column: string, max: number, alone?: boolean, given?: ArchiveEntryRef) {
      if (!isArchiveEntry(path)) return shell.tablesBlob(path, part, rowid, row, column, max, alone, given);
      const { archive, at } = inArchive(path);
      return shell.tablesBlob(archive, part, rowid, row, column, max, false, at);
    },
    openInSystem: undefined,
  });
}
