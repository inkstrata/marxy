// The one owner of giving the event loop back. A long job done in slices awaits `yieldToMain` between them, so the
// frames, the scrolling and the keys of another pane run in the gaps; `runSliced` is that loop for a job that can be
// written as steps.
//
// The yield is a task of its own through a message channel, not a timer: a timer nested a few deep waits at least four
// milliseconds, which at a slice every few milliseconds is most of the time. WebKit has no `scheduler.yield`,
// `scheduler.postTask` or stable `requestIdleCallback`, so there is nothing better to prefer; where there is no channel
// (a test without a DOM) a timer stands in.
//
// Three lanes say who goes first when more than one job is waiting for its turn. They are the research's three
// (docs/research/large-files): `input` is what the reader just asked for (open, find, sort, filter); `viewport`
// is what is on or near the screen (highlighting the blocks in view); `background` is what nobody is waiting on (the
// outline, panels). One message resolves one waiter, the highest lane's first, so with one lane busy the yield costs
// what a bare message costs. A waiter that has waited `STARVE_MS` goes ahead of a higher lane's, so a lane that is
// always busy cannot hold a lower one off for more than that.

export type Lane = 'input' | 'viewport' | 'background';

/** Highest first. */
const LANES: readonly Lane[] = ['input', 'viewport', 'background'];
/** How long a waiter can be held behind a higher lane before it is let through. */
export const STARVE_MS = 100;
/** A slice of work holds the main thread about this long (React's scheduler uses 5; the research says 5 to 8). */
export const DEFAULT_BUDGET_MS = 8;

interface Waiter {
  readonly resume: () => void;
  readonly since: number;
}

const queues: Record<Lane, Waiter[]> = { input: [], viewport: [], background: [] };
let channel: MessageChannel | null = null;
/** The clock the waiters age by; a test replaces it. */
let clock: () => number = () => performance.now();

/** Resumes the waiter whose turn it is: the longest-starved one past `STARVE_MS`, else the highest lane's first. */
function pump(): void {
  const now = clock();
  let starved: Lane | null = null;
  let oldest = now - STARVE_MS;
  for (const lane of LANES) {
    const head = queues[lane][0];
    if (head && head.since < oldest) {
      starved = lane;
      oldest = head.since;
    }
  }
  const lane = starved ?? LANES.find((l) => queues[l].length > 0);
  if (lane) queues[lane].shift()!.resume();
  if (!LANES.some((l) => queues[l].length > 0)) idle();
}

/** Node's message ports keep the process alive while listened to; a browser's have no such thing. */
type Holdable = { ref?: () => void; unref?: () => void };
const idle = (): void => (channel?.port1 as Holdable | undefined)?.unref?.();

function post(): void {
  if (typeof MessageChannel === 'undefined') {
    setTimeout(pump, 0);
    return;
  }
  if (channel === null) {
    channel = new MessageChannel();
    channel.port1.onmessage = pump;
  }
  (channel.port1 as Holdable).ref?.();
  channel.port2.postMessage(null);
}

/** Resolves in a task of its own, after the tasks already queued (input, frames) and the waiters of higher lanes. */
export function yieldToMain(lane: Lane = 'input'): Promise<void> {
  return new Promise((resolve) => {
    queues[lane].push({ resume: resolve, since: clock() });
    post();
  });
}

/**
 * A guard for work that a newer request replaces: `begin()` starts a run and returns a function that is true once
 * another run has begun (or `cancel()` was called). The cancellation by generation that `runSliced`'s `stale` takes.
 */
export function generationGuard(): { begin(): () => boolean; cancel(): void } {
  let generation = 0;
  return {
    begin() {
      const mine = ++generation;
      return () => generation !== mine;
    },
    cancel() {
      generation++;
    },
  };
}

/** What a step is told of its slice. */
export interface Slice {
  /** Whether the budget is spent: a step stops at its next boundary and returns `'more'`. */
  expired(): boolean;
  /** Milliseconds left of the budget (zero or less once spent). */
  remaining(): number;
}

/** `'done'`: nothing left to do. `'more'`: call again, after a yield. */
export type StepResult = 'done' | 'more';

export interface SlicedOptions {
  /** Milliseconds of work a slice may hold the main thread; defaults to `DEFAULT_BUDGET_MS`. */
  readonly budgetMs?: number;
  /** Stops the run at the next boundary: the step is not called again. */
  readonly signal?: AbortSignal;
  /** True once the run is replaced (see `generationGuard`); checked at the same boundaries as `signal`. */
  readonly stale?: () => boolean;
  /** Who goes first when jobs are waiting for their turn; defaults to `input`. */
  readonly lane?: Lane;
}

/**
 * Runs `step` in slices until it says it is done or the run is cancelled. Cancellation is checked before the first
 * slice and after every yield, so a cancelled run never starts a slice it would throw away. Resolves `'done'` or
 * `'cancelled'`; a step that throws rejects the run.
 */
export async function runSliced(step: (slice: Slice) => StepResult | Promise<StepResult>, opts: SlicedOptions = {}): Promise<'done' | 'cancelled'> {
  const budget = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const lane = opts.lane ?? 'input';
  const cancelled = () => opts.signal?.aborted === true || opts.stale?.() === true;
  for (;;) {
    if (cancelled()) return 'cancelled';
    const deadline = clock() + budget;
    const slice: Slice = { expired: () => clock() >= deadline, remaining: () => deadline - clock() };
    if ((await step(slice)) === 'done') return 'done';
    await yieldToMain(lane);
  }
}

/** For tests: the waiters now queued, and a clock they age by. */
export const testing = {
  waiting: (): Record<Lane, number> => ({ input: queues.input.length, viewport: queues.viewport.length, background: queues.background.length }),
  setClock(fn: (() => number) | null): void {
    clock = fn ?? (() => performance.now());
  },
};
