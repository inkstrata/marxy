// Core's archive reader run in the page, over bytes the page holds: the memory shell's archives, and an archive held in
// memory as an entry of another in either shell. Light: no stand-ins, nothing of the demo.
import { ARCHIVE_LIMITS, ArchiveError, ENTRY_CAP, type ArchiveLimits } from '@marxy/core/src/viewer/archive-read.ts';

/**
 * The reader's limits in the page. A whole gzip stream (a tar.gz) is inflated for its listing, so the walk stops at 256 MB,
 * where the Rust shell walks 1 GB; `boundedInflate` reads its gzip cap from here, so the two cannot disagree.
 */
export const PAGE_ARCHIVE_LIMITS: ArchiveLimits = { ...ARCHIVE_LIMITS, stream: 256 * 1024 * 1024 };

/**
 * Inflates in the page, stopping one byte past what the caller may hold (an entry's 16 MB, a listing's stream), so a bomb
 * never fills memory: the reader sees the extra byte and refuses. A head's `limit` stops it sooner.
 */
export async function boundedInflate(packed: Uint8Array, format: 'deflate-raw' | 'deflate' | 'gzip', limit?: number): Promise<Uint8Array> {
  const cap = Math.min(limit ?? Number.POSITIVE_INFINITY, (format === 'gzip' ? PAGE_ARCHIVE_LIMITS.stream : ENTRY_CAP) + 1);
  const reader = new Blob([packed.slice()]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  while (n < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
  }
  if (n >= cap) await reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(n, cap));
  let at = 0;
  for (const p of parts) {
    const take = Math.min(p.length, out.length - at);
    out.set(p.subarray(0, take), at);
    at += take;
    if (at >= out.length) break;
  }
  return out;
}

/** The reader's refusals as shell errors, with the code the Tauri shell gives the same case. */
export async function archiveCall<T>(path: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ArchiveError) throw Object.assign(new Error(e.message), { code: e.code, path });
    throw e;
  }
}
