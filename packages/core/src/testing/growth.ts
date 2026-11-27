// How work grows with its input: the same function timed on an input and on one `factor` times bigger, as an
// exponent. Linear work gives about 1, work that also sorts a little more, about 1.1, and work that scans the
// whole input once per part of it, about 2. A test holds the exponent under a bound, so a whole-document pass
// that creeps into a per-item loop fails here, on the developer's machine and in CI, long before a reader opens
// a 5 MB file. Imported only by tests (core takes no Node built-ins in source).
//
// The clock is this thread's CPU time (testing/cpu-clock.ts), not the wall clock: on a machine busy with other work
// the wall clock made linear work look quadratic, because the bigger input's runs met more of the contention. A run
// is repeated until the clock has moved well past its step, and each size keeps its fastest time, interleaved with the
// other size's runs. Windows charges CPU time in ticks of about 15.6 ms, so there a timing of 40 ms could be off by
// 40%, which is an error of about 0.3 in the exponent, all the headroom a bound of 1.45 leaves linear work; twelve
// ticks (about 190 ms) bring it under 0.1.

import { CPU_TICK_MS, cpuNow } from './cpu-clock.ts';

/** The CPU time one run takes, repeating it until at least this much has passed, so short runs are resolved. */
const RESOLVE_MS = Math.max(40, 12 * CPU_TICK_MS);

export interface Growth {
  /** Bytes (or items) of the small and the large input, as `make` was asked for them. */
  small: number;
  large: number;
  /** The fastest run of each, in milliseconds of CPU time. */
  smallMs: number;
  largeMs: number;
  /** log(largeMs / smallMs) / log(large / small): 1 is linear, 2 quadratic. */
  exponent: number;
}

export interface GrowthOptions {
  /** Size of the small input. */
  small: number;
  /** The large input is this many times the small one (default 4). */
  factor?: number;
  /** Timed runs of each size, after one untimed run of each (default 5). */
  runs?: number;
}

export function growth<T>(make: (size: number) => T, run: (input: T) => unknown, options: GrowthOptions): Growth {
  const factor = options.factor ?? 4;
  const runs = options.runs ?? 5;
  const small = options.small;
  const large = small * factor;
  const a = make(small);
  const b = make(large);
  const time = (input: T): number => {
    const t = cpuNow();
    let n = 0;
    let took = 0;
    do {
      run(input);
      n++;
      took = cpuNow() - t;
    } while (took < RESOLVE_MS);
    return took / n;
  };
  time(a);
  time(b);
  let smallMs = Number.POSITIVE_INFINITY;
  let largeMs = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    smallMs = Math.min(smallMs, time(a));
    largeMs = Math.min(largeMs, time(b));
  }
  // A floor of a hundredth of a millisecond keeps a run too fast to time from dividing by zero.
  const exponent = Math.log(Math.max(largeMs, 0.01) / Math.max(smallMs, 0.01)) / Math.log(factor);
  return { small, large, smallMs, largeMs, exponent };
}

/** One line for an assertion message: sizes, times and the exponent. */
export function describeGrowth(what: string, g: Growth): string {
  const kb = (n: number): string => `${Math.round(n / 1024)} KB`;
  return `${what}: ${kb(g.small)} in ${g.smallMs.toFixed(1)} ms, ${kb(g.large)} in ${g.largeMs.toFixed(1)} ms, exponent ${g.exponent.toFixed(2)}`;
}
