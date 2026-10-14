// *Fork this file* (W-14): the open document's bytes written beside it under a name that is free, never over a file.
//
// This writes beside the reader's files, so the rules are the strict ones (AGENTS.md commitments 2 to 4): nothing leaves the
// machine; the fork holds exactly the bytes it was given (BOM, line endings and bytes that are not text included); the original is never
// written; and a name is taken only by a create-only write (`writeFileNew`, ADR-0074, F-85): the shell puts the bytes at the name only
// if nothing is there (a file, a folder, a link, a dangling link), in the same step that makes the name appear. So there is no "look,
// then write", no window for another program to win, and no symlink to write through: when anything is at a name the write fails
// `exists` and the next name is tried, each name once, at the moment of writing, and nothing is replaced.
import { isWindowsPath } from '@marxy/core/src/index-model/paths.ts';

/** The most names tried: `(fork)`, then `(fork 2)` to `(fork 999)`. */
export const MAX_FORKS = 999;

/**
 * `notes.md` as `notes (fork).md` for `n` of 1, `notes (fork 2).md` for 2 and up; a name with no extension, or a dotfile, takes the
 * tag last. The folder is the path's own. A backslash separates only in a Windows path: on macOS and Linux it is a character in a name.
 */
export function forkPath(path: string, n: number): string {
  return taggedPath(path, n <= 1 ? 'fork' : `fork ${n}`);
}

/**
 * `path` with ` (tag)` before its extension (`notes.md`, `version 14.32` → `notes (version 14.32).md`), in the path's own folder; a
 * name with no extension, or a dotfile, takes the tag last. The stem is cut to fit a file name. Restore to a copy (V-06) names its
 * copies with it.
 */
export function taggedPath(path: string, tag: string): string {
  const separators = isWindowsPath(path) ? ['/', '\\'] : ['/'];
  const slash = Math.max(...separators.map((s) => path.lastIndexOf(s)));
  const dir = path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  const bracketed = ` (${tag})`;
  return `${dir}${fitStem(stem, bytesOf(bracketed) + bytesOf(ext))}${bracketed}${ext}`;
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

/** What a fork needs of the shell. `AppShell` has it. */
export interface ForkIo {
  /** Create-only (ADR-0074): the bytes at `path` if nothing is there, else rejects `code: 'exists'` and writes nothing. */
  writeFileNew(path: string, bytes: Uint8Array): Promise<void>;
}

export type ForkOutcome =
  /** `n` is the tag number: 1 for `(fork)`. */
  | { readonly result: 'written'; readonly path: string; readonly n: number }
  /** Nothing was written. `error` is the shell's, or ours (`code: 'exhausted'`) when no name was free; `path` is the name being written, when there was one. */
  | { readonly result: 'failed'; readonly error: unknown; readonly path?: string };

/** The shell's refusal of a create-only write because something is at the name: the name is taken, try the next. */
export const isExists = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'exists';

/**
 * Writes `bytes` at the first free fork name beside `from`. Never over anything; a failed write leaves nothing (the shell writes a
 * temporary file and publishes it whole or not at all), and the original is not touched, read or named in any call but the folder it is in.
 */
export function writeFork(io: ForkIo, from: string, bytes: Uint8Array): Promise<ForkOutcome> {
  return writeBeside(io, (n) => forkPath(from, n), bytes, { max: MAX_FORKS, what: 'fork names' });
}

/**
 * Writes `bytes` at the first free name of `nameFor(1)`, `nameFor(2)`, ... `nameFor(max)`, each by a create-only write: a name with
 * anything at it (`exists`) is skipped, left exactly as it was, and any other failure ends the walk. The rule of `writeFork`, for
 * any copy written beside a reader's file (a fork, a conflict copy, a restored version). `what` names the names in the refusal
 * when none is free.
 */
export async function writeBeside(
  io: ForkIo,
  nameFor: (n: number) => string,
  bytes: Uint8Array,
  opts: { readonly max: number; readonly what: string },
): Promise<ForkOutcome> {
  let writing: string | undefined;
  try {
    for (let n = 1; n <= opts.max; n++) {
      const candidate = nameFor(n);
      writing = candidate;
      try {
        await io.writeFileNew(candidate, bytes);
      } catch (error) {
        if (isExists(error)) continue;
        throw error;
      }
      return { result: 'written', path: candidate, n };
    }
    return { result: 'failed', error: Object.assign(new Error(`all ${opts.max} ${opts.what} beside this file are taken`), { code: 'exhausted' }) };
  } catch (error) {
    return { result: 'failed', error, ...(writing === undefined ? {} : { path: writing }) };
  }
}
