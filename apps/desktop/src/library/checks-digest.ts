// What the library checks learn from a file's bytes (Q-06): its shingles (near-duplicates) and the paths its prose names
// (broken paths). Pure; run in the checks' worker (checks.worker.ts), or on the page where no worker can run.
import { CONTENT_SEARCH_LIMITS } from '@marxy/core/src/index-model/content-search.ts';
import { mentionsOf } from '@marxy/core/src/index-model/broken-paths.ts';
import { shingles } from '@marxy/core/src/index-model/near-dup.ts';

export interface DigestWant {
  readonly shingles: boolean;
  readonly mentions: boolean;
}

export interface Digested {
  readonly shingles?: Uint32Array;
  readonly mentions?: string[];
}

const decoder = new TextDecoder('utf-8');

/** The facts `want` asks for. A binary file (a NUL early on) has no words and names no path. */
export function digestHere(data: Uint8Array, want: DigestWant): Digested {
  const binary = data.subarray(0, CONTENT_SEARCH_LIMITS.binarySniffBytes).includes(0);
  const text = binary ? '' : decoder.decode(data);
  return {
    ...(want.shingles ? { shingles: shingles(text) } : {}),
    ...(want.mentions ? { mentions: mentionsOf(text) } : {}),
  };
}

export type Digest = (data: Uint8Array, want: DigestWant) => Promise<Digested>;

/** The page's own digest, for tests and for an engine without module workers. */
export const digestOnPage: Digest = async (data, want) => digestHere(data, want);

/**
 * A digest in a module worker, started on first use. A worker that cannot load (a CSP, an engine without module workers) is
 * given up on once, and every job it held is done on the page instead: slower, never lost.
 */
export function workerDigest(): Digest {
  let worker: Worker | null | undefined;
  let next = 0;
  const pending = new Map<number, { readonly data: Uint8Array; readonly want: DigestWant; readonly resolve: (d: Digested) => void }>();
  const start = (): Worker | null => {
    if (typeof Worker === 'undefined') return null;
    try {
      const w = new Worker(new URL('./checks.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number } & Digested>) => {
        const job = pending.get(e.data.id);
        pending.delete(e.data.id);
        job?.resolve({ ...(e.data.shingles ? { shingles: e.data.shingles } : {}), ...(e.data.mentions ? { mentions: e.data.mentions } : {}) });
      };
      w.onerror = () => {
        worker = null;
        w.terminate();
        const jobs = [...pending.values()];
        pending.clear();
        for (const job of jobs) job.resolve(digestHere(job.data, job.want));
      };
      return w;
    } catch {
      return null;
    }
  };
  return (data, want) => {
    if (worker === undefined) worker = start();
    const w = worker;
    if (w === null) return Promise.resolve(digestHere(data, want));
    return new Promise((resolve) => {
      const id = next++;
      pending.set(id, { data, want, resolve });
      // A copy crosses (the page keeps the bytes for the fallback above).
      w.postMessage({ id, data: data.slice(), want });
    });
  };
}
