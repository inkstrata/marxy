// Idle-time chunks for the paragraphs outside the viewport (docs/design/04-typeset.md §Scheduling).
// WebKitGTK has no requestIdleCallback, so the fallback is a macrotask with an 8 ms budget.

export interface Scheduler {
  /** Runs `work` later; `work` is given a function returning the milliseconds left in its chunk. */
  schedule(work: (remaining: () => number) => void): void;
}

const CHUNK_MS = 8;

export function idleScheduler(): Scheduler {
  const idle = (globalThis as { requestIdleCallback?: (cb: (d: { timeRemaining(): number }) => void) => number }).requestIdleCallback;
  return {
    schedule(work) {
      if (idle !== undefined) {
        idle((d) => work(() => Math.min(d.timeRemaining(), CHUNK_MS)));
        return;
      }
      setTimeout(() => {
        const start = performance.now();
        work(() => CHUNK_MS - (performance.now() - start));
      }, 0);
    },
  };
}

/** Runs everything at once, for tests and for the measurement harness. */
export function immediateScheduler(): Scheduler {
  return { schedule: (work) => work(() => Number.POSITIVE_INFINITY) };
}
