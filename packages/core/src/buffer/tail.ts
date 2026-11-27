// Following a file that grows: what to read of it, and whether what came back is the old file plus new bytes. Pure.
import { firstNotUtf8Offset } from '../encoding/decode.ts';

/** The start and the end of the held bytes are read again, this much of each, to show the file still holds what is held. */
export const TAIL_CHECK_BYTES = 64 * 1024;

/**
 * A read of a file that grew: from `at`, `length` bytes, the first `check` of them the held file's own last bytes; and
 * `head` bytes from the file's start (0 when the range read already starts there), read to compare with the held start.
 */
export interface TailRead {
  readonly at: number;
  readonly check: number;
  readonly length: number;
  readonly head: number;
}

/** What to read of a file now `size` bytes long when `held` bytes of it are held; null when it did not grow. */
export function tailRead(held: number, size: number): TailRead | null {
  if (!(size > held)) return null;
  const check = Math.min(held, TAIL_CHECK_BYTES);
  const at = held - check;
  return { at, check, length: size - at, head: at > 0 ? Math.min(held, TAIL_CHECK_BYTES) : 0 };
}

/**
 * The bytes the file gained, from `read` (the bytes `plan` asked for) and `head` (its first `plan.head` bytes). Null, so the
 * caller reads the whole file as it always did, when the file is not the held bytes plus more: it came back short (it
 * shrank while read), the old start or end is not what is held (rotated, rewritten, truncated and grown again), or the new
 * bytes are not UTF-8, which the whole file may then need decoding for.
 */
export function appendedBytes(held: Uint8Array, plan: TailRead, read: Uint8Array, head: Uint8Array | null = null): Uint8Array | null {
  if (read.length !== plan.length || plan.at + plan.check !== held.length) return null;
  if (plan.head > 0) {
    if (head === null || head.length !== plan.head) return null;
    for (let i = 0; i < plan.head; i++) if (head[i] !== held[i]) return null;
  }
  for (let i = 0; i < plan.check; i++) if (read[i] !== held[plan.at + i]) return null;
  // The check, a few bytes of it, joins the window so a character cut at the old end is read whole.
  let from = Math.max(0, plan.check - 4);
  while (from < plan.check && (read[from]! & 0xc0) === 0x80) from++;
  if (firstNotUtf8Offset(read.subarray(from)) >= 0) return null;
  return read.subarray(plan.check);
}
