// The Versions panel's words: when a copy was kept, why, how large, and the backup's totals.
// Pure. Nothing here says how a copy differs from the file: that is the comparison page's, when asked.
import type { VersionEntry, VersionReason } from '../versions/store.ts';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "Today, 14:02", "15 Oct, 08:27", "8 Oct 2025, 09:14". */
export function whenWords(time: number, now: number): string {
  const d = new Date(time);
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const n = new Date(now);
  if (d.toDateString() === n.toDateString()) return `Today, ${t}`;
  const month = d.toLocaleString('en-GB', { month: 'short' });
  return `${d.getDate()} ${month}${d.getFullYear() !== n.getFullYear() ? ` ${d.getFullYear()}` : ''}, ${t}`;
}

const WHY: Readonly<Record<VersionReason, string>> = {
  'before save': 'before your save',
  'before reload': 'before a replacement from outside',
  // Only an older Marxy kept these.
  read: 'when it was opened, by an older Marxy',
};

export const whyWords = (reason: VersionReason): string => WHY[reason];

/** "312 bytes", "4.1 KB", "1.8 MB". */
export function sizeWords(n: number): string {
  if (n < 1024) return plural(n, 'byte', 'bytes');
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const copiesWords = (n: number): string => (n === 1 ? '1 copy' : `${n.toLocaleString('en-GB')} copies`);

/** The copies "export all" could not read, named (the first three) for the notice that says it is done. */
export function skippedWords(names: readonly string[]): string {
  const named = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
  return `${names.length === 1 ? 'a copy' : copiesWords(names.length)} could not be read and ${names.length === 1 ? 'is' : 'are'} left out: ${named}`;
}

/** "41 copies of 12 files · 212 KB": every copy kept, of every file. */
export function inAllWords(files: readonly { readonly versions: readonly VersionEntry[] }[], bytes: number): string {
  const n = files.reduce((s, f) => s + f.versions.length, 0);
  return `${copiesWords(n)} of ${plural(files.length, 'file', 'files')} · ${sizeWords(bytes)}`;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The menu of Clear older than…: its words and the age past which a copy goes (null: every copy not kept for good). */
export const CLEAR_AGES: readonly (readonly [string, number | null])[] = [
  ['A day', DAY_MS],
  ['A week', 7 * DAY_MS],
  ['A month', 30 * DAY_MS],
  ['Every copy not kept for good', null],
];
