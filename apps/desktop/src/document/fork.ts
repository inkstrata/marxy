// *Fork this file* (W-14): the open document's bytes written beside it under a name that is free, never over a file.
//
// This writes beside the reader's files, so the rules are the strict ones (AGENTS.md commitments 2 to 4): nothing leaves the
// machine; the fork holds exactly the bytes it was given (BOM, line endings and bytes that are not text included); the original is never
// written; and a name is taken only after it has been looked for, one name at a time, at the moment of writing, never from a
// listing made earlier.
//
// THE ONE LIMIT. The shell has no exclusive create: `writeFileAtomic` stages a temporary file and renames it over the
// destination, and a rename replaces what is there. So "check that the name is free, then write" is two steps, and a file that
// another program puts at that name between them is replaced. The window is the shell's own time to stage, flush and rename
// the bytes (milliseconds for a document), and the check is the last thing done before the write: nothing else is awaited
// between them (`fork.test.ts` holds that). Closing the window needs a create-only write in the shell, which is a new
// privileged capability and so an ADR (ADR-0045); until then this is as close as the interface allows.
import { isWindowsPath, normalizePath } from '@marxy/core/src/index-model/paths.ts';

/** The most names tried: `(fork)`, then `(fork 2)` to `(fork 999)`. */
export const MAX_FORKS = 999;

/**
 * `notes.md` as `notes (fork).md` for `n` of 1, `notes (fork 2).md` for 2 and up; a name with no extension, or a dotfile, takes the
 * tag last. The folder is the path's own. A backslash separates only in a Windows path: on macOS and Linux it is a character in a name.
 */
export function forkPath(path: string, n: number): string {
  const separators = isWindowsPath(path) ? ['/', '\\'] : ['/'];
  const slash = Math.max(...separators.map((s) => path.lastIndexOf(s)));
  const dir = path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  const tag = ` (${n <= 1 ? 'fork' : `fork ${n}`})`;
  return `${dir}${fitStem(stem, bytesOf(tag) + bytesOf(ext))}${tag}${ext}`;
}

/** The longest name a file may have, in UTF-8 bytes (APFS, ext4). */
export const MAX_NAME_BYTES = 255;

const bytesOf = (text: string): number => new TextEncoder().encode(text).length;

/**
 * `stem` cut, a whole grapheme at a time, so that the stem and the `rest` (the tag and the extension) fit in a file name: the tag
 * makes a name 7 bytes longer or more, and a name that was already near the limit would otherwise be refused by the shell. Two long
 * names that share a start can then share a fork name; that is no harm, since a taken name is skipped. Left alone when `rest` alone
 * is too long to leave any room (the write is then refused with a notice that says the name is too long).
 */
function fitStem(stem: string, rest: number): string {
  const room = MAX_NAME_BYTES - rest;
  if (bytesOf(stem) <= room || room < 1) return stem;
  let out = '';
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(stem)) {
    if (bytesOf(out + segment) > room) break;
    out += segment;
  }
  return out;
}

/** What a fork needs of the shell. `AppShell` has all three. */
export interface ForkIo {
  /** `null` for a missing path, and also for a symlink and a deny-listed name: it cannot see those. */
  stat(path: string): Promise<unknown | null>;
  /** The path with every link resolved; rejects when nothing is there (a link that leads nowhere included). */
  realPath(path: string): Promise<string>;
  /** At most `maxBytes` of a regular file. Rejects `not-found` for a missing path and anything else for a path that is there but is not a regular file (a link, a folder), which `stat` and `realPath` cannot tell from a missing one when a link leads nowhere. */
  readHead(path: string, maxBytes: number): Promise<Uint8Array>;
  writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>;
}

export type ForkOutcome =
  /** `n` is the tag number: 1 for `(fork)`. */
  | { readonly result: 'written'; readonly path: string; readonly n: number }
  /** Nothing was written. `error` is the shell's, or ours (`code: 'exhausted'`) when no name was free; `path` is the name being written, when there was one. */
  | { readonly result: 'failed'; readonly error: unknown; readonly path?: string };

const isNotRegular = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'invalid';
const isNotFound = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'not-found';

/**
 * Whether anything is at `path`: a file, a folder, or a link that leads somewhere. `stat` alone is not enough, because it does
 * not see a symlink, and the shell writes *through* a symlink (the file it points at is replaced). A link is seen as a `realPath`
 * that is not where the name says: its folder's real path with the name on the end.
 */
export async function nameIsTaken(io: Pick<ForkIo, 'stat' | 'realPath' | 'readHead'>, path: string): Promise<boolean> {
  const normal = normalizePath(path);
  const slash = normal.lastIndexOf('/');
  // The folder first, so the last things looked at are the name itself.
  const dir = (await io.realPath(slash <= 0 ? '/' : normal.slice(0, slash))).replace(/\/+$/, '');
  if ((await io.stat(path)) !== null) return true;
  try {
    if (`${dir}/${normal.slice(slash + 1)}` !== (await io.realPath(path))) return true;
  } catch (error) {
    // Nothing there, or a link that leads nowhere: the head read below tells which.
    if (!isNotFound(error)) throw error;
  }
  try {
    await io.readHead(path, 0);
    return true;
  } catch (error) {
    // A missing path is free. Anything else that is there (a link that leads nowhere, a folder, a pipe) is taken: it is not ours to replace.
    if (isNotFound(error)) return false;
    if (isNotRegular(error)) return true;
    throw error;
  }
}

/**
 * Writes `bytes` at the first free fork name beside `from`. Never over a file; a failed write leaves nothing (the shell writes a
 * temporary file and renames it, so it publishes the whole file or none), and the original is not touched, read or named
 * in any call but the folder it is in.
 */
export async function writeFork(io: ForkIo, from: string, bytes: Uint8Array): Promise<ForkOutcome> {
  let writing: string | undefined;
  try {
    for (let n = 1; n <= MAX_FORKS; n++) {
      const candidate = forkPath(from, n);
      if (await nameIsTaken(io, candidate)) continue;
      // The last look is the line above and nothing is awaited between it and the write: see the note at the top.
      writing = candidate;
      await io.writeFileAtomic(candidate, bytes);
      return { result: 'written', path: candidate, n };
    }
    return { result: 'failed', error: Object.assign(new Error(`all ${MAX_FORKS} fork names beside this file are taken`), { code: 'exhausted' }) };
  } catch (error) {
    return { result: 'failed', error, ...(writing === undefined ? {} : { path: writing }) };
  }
}
