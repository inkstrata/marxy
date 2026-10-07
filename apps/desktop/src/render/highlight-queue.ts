// The highlight worker's job queue (B-21). Tokenising is never cut off by time, so one slow block can
// hold the worker; what must not happen is every later block, and the next document's, waiting behind
// work nobody will see. Jobs run one at a time with a task boundary between them, so a `drop` message
// is handled before the next job starts, and a dropped job is never run.

export interface Job {
  readonly id: number;
}

export class JobQueue<T extends Job> {
  private readonly queue: T[] = [];
  private draining = false;

  private readonly run: (job: T) => Promise<void>;
  private readonly nextTask: (fn: () => void) => void;

  constructor(run: (job: T) => Promise<void>, nextTask: (fn: () => void) => void = (fn) => void setTimeout(fn, 0)) {
    this.run = run;
    this.nextTask = nextTask;
  }

  push(job: T): void {
    this.queue.push(job);
    if (!this.draining) {
      this.draining = true;
      this.nextTask(() => void this.drain());
    }
  }

  /** Removes queued jobs by id; returns the ids that were still queued (the running job is not among them). */
  drop(ids: Iterable<number>): number[] {
    const gone = new Set(ids);
    const dropped: number[] = [];
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (gone.has(this.queue[i]!.id)) dropped.unshift(this.queue.splice(i, 1)[0]!.id);
    }
    return dropped;
  }

  private async drain(): Promise<void> {
    const job = this.queue.shift();
    if (!job) {
      this.draining = false;
      return;
    }
    try {
      await this.run(job);
    } catch {
      // One job failing is that job's problem; the rest still run.
    } finally {
      this.nextTask(() => void this.drain());
    }
  }
}

/** The ids of pending jobs whose block has left the page (its document closed, or it was replaced). */
export function closedJobIds(pending: ReadonlyMap<number, { readonly block: { readonly isConnected: boolean } }>): number[] {
  const ids: number[] = [];
  for (const [id, job] of pending) if (!job.block.isConnected) ids.push(id);
  return ids;
}
