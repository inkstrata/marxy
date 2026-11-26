// What Export offers for a page of the app's own ("Export, for these pages"): the file as it is, every byte
// under a name the reader chooses, and for an archive its listing as text. Nothing is converted: the app would be
// inventing a page that is not there.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { extensionOf, firstBytes, sizeWords } from '@marxy/core/src/viewer/bytes.ts';
import type { ArchiveListing } from '@marxy/shell-api';
import type { AppShell } from '../app-types.ts';
import type { ViewedFile } from './file.ts';
import type { ViewerExport } from './types.ts';

/** The most Export copies through the page: the read cap of a document, so a copy never holds more than an open would. */
export const EXPORT_BYTES_MAX = 256 * 1024 * 1024;
/** One read at a time while the bytes are gathered. */
const PIECE = 16 * 1024 * 1024;

const enc = new TextEncoder();

/** The file's own bytes, read in ranges; rejects past the cap, or when the file is shorter than its page says. */
export async function bytesOf(shell: Pick<AppShell, 'readRange'>, file: ViewedFile): Promise<Uint8Array> {
  const name = basename(file.path);
  if (file.size > EXPORT_BYTES_MAX) {
    throw new Error(`${name} is ${sizeWords(file.size)}, past the ${sizeWords(EXPORT_BYTES_MAX)} Export copies through the page; Show in folder, and copy it there`);
  }
  const out = new Uint8Array(file.size);
  let at = 0;
  while (at < file.size) {
    const piece = await shell.readRange(file.path, at, Math.min(PIECE, file.size - at));
    if (piece.length === 0) break;
    out.set(piece.subarray(0, file.size - at), at);
    at += piece.length;
  }
  if (at < file.size) throw new Error(`${name} changed while it was read`);
  return out;
}

/** The file's own bytes, as Export writes them; `what` names it in the dialog ("The image, as it is"). */
export function asItIs(shell: Pick<AppShell, 'readRange'>, file: ViewedFile, what: 'file' | 'image' | 'archive'): ViewerExport {
  return {
    id: 'bytes',
    name: `The ${what}, as it is`,
    sub: 'every byte, under a name you choose',
    extension: extensionOf(file.path) || 'bin',
    async build() {
      const bytes = await bytesOf(shell, file);
      const { hex } = firstBytes(file.head, 8);
      const preview = `${basename(file.path)}: ${sizeWords(file.size)}${file.size > 0 ? `, starting ${hex}` : ''}.\n\nThe file as it is, byte for byte, saved through the system’s save dialog under a name you choose. Nothing is converted.`;
      return { bytes, preview };
    },
  };
}

/** An archive's listing as plain text: one entry a line, its unpacked size and its date as the archive gives it. */
export function listingText(listing: Pick<ArchiveListing, 'entries' | 'truncated'>): string {
  const lines = listing.entries.map((e) => {
    const path = e.kind === 'dir' && !e.path.endsWith('/') ? `${e.path}/` : e.path;
    const size = e.kind === 'dir' || e.size === null ? '' : String(e.size);
    const date = e.mtime ? e.mtime.replace('T', ' ').replace(/:\d\d(\.\d+)?Z?$/, '').replace(/Z$/, '') : '';
    return `${path.padEnd(48)} ${size.padStart(12)}  ${date}`.trimEnd();
  });
  if (listing.truncated) lines.push('', listing.truncated);
  return `${lines.join('\n')}\n`;
}

/** The archive's listing, as Export writes it. */
export function listingExport(listing: ArchiveListing): ViewerExport {
  return {
    id: 'listing',
    name: 'The listing',
    sub: 'every entry, its size and date',
    extension: 'txt',
    async build() {
      const text = listingText(listing);
      return { bytes: enc.encode(text), preview: text };
    },
  };
}
