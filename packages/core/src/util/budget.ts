// What a reader may spend on an untrusted file: a limit, the work counted against it, and the work it refused, so the
// reader can stop early and say so plainly. Work is anything countable: bytes, characters, items, steps, or levels
// held at once (take on the way in, give back on the way out). Pure: no DOM, no I/O.

export interface Budget {
  /** The most work that may be counted. */
  readonly limit: number;
  /** Work counted so far. */
  readonly used: number;
  /** Work refused because counting it would have passed the limit. */
  readonly refused: number;
  /** Whether anything was refused: the reader stopped early and should say so. */
  readonly hit: boolean;
  /** Counts `n` more and answers true, or, when that would pass the limit, counts it refused and answers false. */
  take(n?: number): boolean;
  /** Gives back `n` taken, as when a reader leaves a level it went into. */
  give(n?: number): void;
}

export function budget(limit: number): Budget {
  let used = 0;
  let refused = 0;
  return {
    limit,
    get used() {
      return used;
    },
    get refused() {
      return refused;
    },
    get hit() {
      return refused > 0;
    },
    take(n = 1) {
      if (used + n > limit) {
        refused += n;
        return false;
      }
      used += n;
      return true;
    },
    give(n = 1) {
      used = Math.max(0, used - n);
    },
  };
}

/** A count as the readers write it to the reader: `12,345`. */
export const figure = (n: number): string => n.toLocaleString('en-GB');
