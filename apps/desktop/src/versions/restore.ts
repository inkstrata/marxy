// Restore to a copy (V-06, ADR-0072 item 7): an earlier version's bytes written beside the file as `name (version 14.32).md`, at
// the first free name (`(version 14.32 2)` and on), and never over anything: the rule and the code of *Fork this file* (W-14,
// `document/fork.ts`), whose one limit holds here too (the shell has no create-only write, so a file another program puts at the
// chosen name between the last look and the write is replaced; the window is the shell's own write time). The original is not
// read, written or named in any call: only its folder is looked at, for the copy's name.
import { taggedPath, writeBeside, type ForkIo, type ForkOutcome } from '../document/fork.ts';

/** The most names tried: `(version 14.32)`, then `(version 14.32 2)` to `(version 14.32 999)`. */
export const MAX_VERSION_COPIES = 999;

const two = (n: number): string => String(n).padStart(2, '0');

/** The local time of `time` as `14.32`: the hour and minute a version was kept, as its copy's name says them. */
export function hourMinute(time: number): string {
  const d = new Date(time);
  return `${two(d.getHours())}.${two(d.getMinutes())}`;
}

/** `notes.md` kept at 14.32 as `notes (version 14.32).md` for `n` of 1, `notes (version 14.32 2).md` for 2 and up. */
export function versionCopyPath(path: string, time: number, n: number): string {
  const tag = `version ${hourMinute(time)}`;
  return taggedPath(path, n <= 1 ? tag : `${tag} ${n}`);
}

/** Writes `bytes`, the version of `path` kept at `time`, at the first free copy name beside it. */
export function restoreToCopy(io: ForkIo, path: string, bytes: Uint8Array, time: number): Promise<ForkOutcome> {
  return writeBeside(io, (n) => versionCopyPath(path, time, n), bytes, { max: MAX_VERSION_COPIES, what: 'version copy names' });
}
