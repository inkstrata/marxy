// The order a folder's entries are listed in, and what sits either side of one file in it. The folder's page, the file
// crumb's menu and the keys that step through the folder all use this one order.
import { basename, sameFilePath } from './paths.ts';

/** Folders first, then by name, case and accents aside, numbers by value (img2 before img10). */
export function folderOrder<T extends { readonly path: string; readonly isDir: boolean }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => Number(b.isDir) - Number(a.isDir) || basename(a.path).localeCompare(basename(b.path), 'en', { sensitivity: 'base', numeric: true }));
}

export interface Beside {
  /** Where `path` stands among the folder's files, from 0. */
  readonly index: number;
  readonly count: number;
  readonly previous: string | null;
  readonly next: string | null;
}

/**
 * The files either side of `path` among the folder's entries, in `folderOrder`; none past either end. A file the listing
 * does not show under that spelling (a link, another case of a drive letter, one deleted while open) is matched by
 * `sameFilePath`, else put in at its place, so stepping still works from it.
 */
export function besideIn(entries: readonly { readonly path: string; readonly isDir: boolean }[], path: string): Beside {
  let files = folderOrder(entries.filter((e) => !e.isDir)).map((e) => e.path);
  let index = files.findIndex((f) => sameFilePath(f, path));
  if (index < 0) {
    files = folderOrder([...files.map((f) => ({ path: f, isDir: false })), { path, isDir: false }]).map((e) => e.path);
    index = files.indexOf(path);
  }
  return { index, count: files.length, previous: files[index - 1] ?? null, next: files[index + 1] ?? null };
}
