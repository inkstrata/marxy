// The words Versions says: why a file gets no copies, what a listing that is not a list is, and why a copy was not kept.
import { keptWhen } from '../../commands/compare.ts';
import { whatHappened, type VersionFailure } from '../../versions/recorder.ts';
import type { Listing, NotKept } from '../../versions/store.ts';

// ---- the words ---------------------------------------------------------------------------------------------------------

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const MB = 1024 * 1024;

/** "312 bytes", "4.1 KB", "1.8 MB". */
export function sizeWords(n: number): string {
  if (n < 1024) return plural(n, 'byte', 'bytes');
  if (n < MB) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / MB).toFixed(1)} MB`;
}

/** Why the focused file gets no versions, in words. */
export function notKeptWords(no: NotKept): string {
  switch (no.kind) {
    case 'off':
      return 'Versions are off: config.toml says versions = false, so no new copies are kept.';
    case 'large':
      return `No versions are kept of this file: it is larger than ${sizeWords(no.limit)}, the large-file limit.`;
    case 'denied':
      return no.builtIn
        ? `No versions are kept of this file: it is in a ${no.rule} folder, which Marxy never reads into.`
        : `No versions are kept of this file: the [deny] rule ${no.rule} in collection.toml covers it.`;
    case 'scratch':
      return 'This document is not a file yet, so no versions are kept of it.';
    case 'own':
      return 'This is one of Marxy\'s own files, so no versions are kept of it.';
  }
}

/** What the tab says of a listing that is not a list of versions; null for one that is. */
export function listingNote(listing: Listing): string | null {
  switch (listing.kind) {
    case 'ok':
      return null;
    case 'none':
      return 'No earlier versions are kept yet.';
    case 'damaged':
      return `The record of this file's versions could not be read: ${listing.reason}. Its versions cannot be listed and no new ones are kept; Clear versions of this file starts it again.`;
    case 'newer':
      return 'A newer Marxy keeps this file\'s versions; this one leaves them as they are.';
    case 'unreadable':
      return `The record of this file's versions could not be read (${messageOf(listing.error)}).`;
  }
}

export const messageOf = (error: unknown): string => String((error as { message?: unknown } | null)?.message ?? error);

/** What a failed keep says: which copy, and why. The file itself is never touched by a keep. */
export function failureWords(failure: VersionFailure): string {
  const run = failure.count > 1 ? ` ${failure.count} copies of this file have not been kept since ${keptWhen(failure.since, Date.now())}.` : '';
  return `The last copy (${failure.reason}) could not be kept: ${messageOf(failure.error)}. ${whatHappened(failure.reason)}${run}`;
}

