// The bounded reader behind the library's content keys (`words:`, `has:`, `tasks:`; Q-03). There is no content
// index (ADR-0062 item 5), so a file is measured by reading it, and only the files the index keys left are read.
// Each is read at most once while the library is open (a measure is kept with the stamp of the file it measured),
// by `shell.readHead` and never `readFile`, which arms the stale-write guard: reading the index must never be able
// to make a later save of the reader's file refuse. No read is longer than the shell's own cap, and all together are
// held to `CONTENT_SEARCH_LIMITS.maxTotalBytes`; past that the files not reached are counted, not guessed at.
import type { IndexEntry } from '@marxy/core';
import { CONTENT_SEARCH_LIMITS } from '@marxy/core/src/index-model/content-search.ts';
import { measureText, type Measured } from '@marxy/core/src/index-model/query-eval.ts';

/** The most one read returns (the shell caps `readHead` here, and so does the memory shell). */
export const MEASURE_READ_BYTES = 256 * 1024;
const CONCURRENCY = 6;

export type ReadHead = (path: string, maxBytes: number) => Promise<Uint8Array>;

const stampOf = (e: IndexEntry): string => `${e.mtimeMs}:${e.size}`;

/** The measures taken so far, each good only for the file it measured. */
export class MeasureCache {
  private readonly held = new Map<string, { readonly stamp: string; readonly measured: Measured }>();
  /** Bytes read since the cache was made: the budget is for the whole library session, not each query. */
  bytesRead = 0;

  get(entry: IndexEntry): Measured | undefined {
    const m = this.held.get(entry.path);
    return m !== undefined && m.stamp === stampOf(entry) ? m.measured : undefined;
  }

  set(entry: IndexEntry, measured: Measured): void {
    this.held.set(entry.path, { stamp: stampOf(entry), measured });
  }

  /** The measures of `entries` that are current, by path: what the evaluator is given. */
  forEntries(entries: readonly IndexEntry[]): Map<string, Measured> {
    const out = new Map<string, Measured>();
    for (const e of entries) {
      const m = this.get(e);
      if (m !== undefined) out.set(e.path, m);
    }
    return out;
  }
}

export interface MeasureResult {
  /** Files that now have a measure (this call's and earlier ones). */
  readonly measured: number;
  /** Files asked about. */
  readonly of: number;
  /** The budget ran out before every file was reached. */
  readonly overBudget: boolean;
  /** Reads started in this call. */
  readonly reads: number;
}

export interface MeasureOptions {
  readonly signal?: AbortSignal;
  readonly budgetBytes?: number;
  /** Called after each file, with the counts so far. */
  readonly onProgress?: (measured: number, of: number) => void;
}

/** A measure of text read from the start of a file `size` bytes long: a floor when the read stopped short of it. */
export function measureBytes(bytes: Uint8Array, size: number): Measured {
  // A NUL early on marks a binary file: it has no words, and its bytes are not text to count.
  if (bytes.subarray(0, CONTENT_SEARCH_LIMITS.binarySniffBytes).includes(0)) return { words: 0, hasCode: false, hasPaths: false, hasLinks: false, openTasks: 0 };
  const measure = measureText(new TextDecoder('utf-8').decode(bytes));
  return bytes.length < size ? { ...measure, truncated: true } : measure;
}

/**
 * Measures the entries the cache does not hold yet, `CONCURRENCY` at a time. A file that cannot be read has an empty
 * measure (it matches no `words:>`), so it is not asked again. Stops, without an error, when `signal` aborts.
 */
export async function measureFiles(
  entries: readonly IndexEntry[],
  read: ReadHead,
  cache: MeasureCache,
  opts: MeasureOptions = {},
): Promise<MeasureResult> {
  const budget = opts.budgetBytes ?? CONTENT_SEARCH_LIMITS.maxTotalBytes;
  const todo = entries.filter((e) => cache.get(e) === undefined);
  let measured = entries.length - todo.length;
  let reads = 0;
  let overBudget = false;
  let next = 0;
  const aborted = (): boolean => opts.signal?.aborted === true;
  const worker = async (): Promise<void> => {
    while (!aborted()) {
      if (cache.bytesRead >= budget) {
        overBudget = true;
        return;
      }
      const entry = todo[next++];
      if (entry === undefined) return;
      reads++;
      let bytes: Uint8Array | null = null;
      try {
        bytes = await read(entry.path, MEASURE_READ_BYTES);
      } catch {
        bytes = null;
      }
      if (aborted()) return;
      cache.bytesRead += bytes?.length ?? 0;
      cache.set(entry, bytes === null ? { words: 0, hasCode: false, hasPaths: false, hasLinks: false, openTasks: 0 } : measureBytes(bytes, entry.size));
      measured++;
      opts.onProgress?.(measured, entries.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return { measured, of: entries.length, overBudget, reads };
}
