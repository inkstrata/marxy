// An archive inside an archive: an entry held in memory that is itself an archive is
// listed, and its entries read, by core's reader from the bytes the page already holds, in both shells. Nothing goes back
// to the shell, so no shell call ever names an `archive-entry:` path. Three levels at most, the archive on disk the first:
// each held archive is at most 16 MB before it is listed, under the reader's own caps (100,000 entries, an entry's 16 MB,
// a gzip stream inflated only as far as `boundedInflate` lets it), so a nested bomb is never walked.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { ENTRY_CAP, listArchiveBytes, readArchiveEntryBytes, readArchiveHeadsBytes, type HeadWant } from '@marxy/core/src/viewer/archive-read.ts';
import { shortSize } from '@marxy/core/src/viewer/archive.ts';
import type { ArchiveHead, ArchiveListing } from '@marxy/shell-api';
import type { HeldEntry } from '../document/entries.ts';
import { archiveCall, boundedInflate, PAGE_ARCHIVE_LIMITS } from './archive-bytes.ts';

/** Levels listed, the archive on disk counted: an entry held at this depth or deeper is not listed. */
export const NESTED_LEVELS = 3;

/** Whether an entry this deep, were it an archive, is listed. */
export const nestedListed = (depth: number): boolean => depth < NESTED_LEVELS;

const refused = (path: string, text: string): Error => Object.assign(new Error(text), { code: 'refused', path });

const BZIP2_OR_XZ = (b: Uint8Array): boolean =>
  (b[0] === 0x42 && b[1] === 0x5a && b[2] === 0x68 && b[3]! >= 0x31 && b[3]! <= 0x39) ||
  (b[0] === 0xfd && b[1] === 0x37 && b[2] === 0x7a && b[3] === 0x58 && b[4] === 0x5a && b[5] === 0x00);

/** Why a held entry is not read as an archive, or null when it is. */
export function nestedRefusal(e: HeldEntry): string | null {
  if (!nestedListed(e.depth)) return 'An archive three levels down is not listed, so a nested bomb is never walked.';
  const size = e.size ?? e.bytes.length;
  if (e.size !== undefined || size > ENTRY_CAP) {
    return `${basename(e.name)} is ${shortSize(size)}: an archive inside an archive is listed only up to ${shortSize(ENTRY_CAP)}, so a nested bomb is never walked.`;
  }
  // core's reader reads neither in the page; the Rust shell does, but only from a file on disk.
  if (BZIP2_OR_XZ(e.bytes)) return `${basename(e.name)} is packed with bzip2 or xz, which is read only from an archive on disk, not from one held in memory.`;
  return null;
}

function readable(e: HeldEntry): void {
  const why = nestedRefusal(e);
  if (why) throw refused(e.path, why);
}

export async function listHeld(e: HeldEntry): Promise<ArchiveListing | null> {
  readable(e);
  return (await archiveCall(e.path, () => listArchiveBytes(e.bytes, basename(e.name), boundedInflate, PAGE_ARCHIVE_LIMITS))) as ArchiveListing | null;
}

export async function readHeld(e: HeldEntry, index: number, name: string): Promise<Uint8Array> {
  readable(e);
  return archiveCall(e.path, () => readArchiveEntryBytes(e.bytes, basename(e.name), index, name, boundedInflate, PAGE_ARCHIVE_LIMITS));
}

export async function headsHeld(e: HeldEntry, wants: readonly HeadWant[], maxEach: number): Promise<readonly ArchiveHead[]> {
  readable(e);
  return archiveCall(e.path, () => readArchiveHeadsBytes(e.bytes, basename(e.name), wants, maxEach, boundedInflate, PAGE_ARCHIVE_LIMITS));
}
