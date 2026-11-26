// Idle-time chunks for the paragraphs outside the viewport.
// WebKitGTK has no requestIdleCallback, so the fallback is a macrotask with an 8 ms budget.

/**
 * A chunk of work: `remaining` is the milliseconds left in its chunk; `idle`, where the engine says, is what is left of the
 * engine's own idle period (`requestIdleCallback`), which work that may run past the chunk keeps to.
 */
export type Work = (remaining: () => number, idle?: () => number) => void;

export interface Scheduler {
  /** Runs `work` later. */
  schedule(work: Work): void;
  /**
   * Runs `work` as `schedule` would, but no sooner than `ms` from now. Optional: the typesetter waits
   * only on a scheduler that has it, so a test's scheduler that runs work when it is told keeps doing so.
   */
  after?(ms: number, work: Work): void;
}

const CHUNK_MS = 8;

export function idleScheduler(): Scheduler {
  const idle = (globalThis as { requestIdleCallback?: (cb: (d: { timeRemaining(): number }) => void) => number }).requestIdleCallback;
  return {
    schedule(work) {
      if (idle !== undefined) {
        idle((d) => work(() => Math.min(d.timeRemaining(), CHUNK_MS), () => d.timeRemaining()));
        return;
      }
      setTimeout(() => {
        const start = performance.now();
        work(() => CHUNK_MS - (performance.now() - start));
      }, 0);
    },
    after(ms, work) {
      setTimeout(() => this.schedule(work), ms);
    },
  };
}

/** Runs everything at once, for tests and for the measurement harness. */
export function immediateScheduler(): Scheduler {
  return { schedule: (work) => work(() => Number.POSITIVE_INFINITY) };
}
