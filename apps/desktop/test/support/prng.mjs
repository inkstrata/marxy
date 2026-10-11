// A seeded PRNG for tests that must replay: the same seed gives the same sequence, on every machine.
// mulberry32, as in `src/document/store.test.ts` (kept there as it is). No `Math.random`, no clock.

/** `rand()` in [0, 1). */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The helpers a walk draws with, over one `rand`. */
export function drawers(rand) {
  /** An integer in [0, n). */
  const int = (n) => Math.floor(rand() * n);
  /** One of `xs`. */
  const pick = (xs) => xs[int(xs.length)];
  /** True with probability `p`. */
  const chance = (p) => rand() < p;
  /** One of `entries` ([[item, weight], ...]) in proportion to its weight. */
  const weighted = (entries) => {
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let at = rand() * total;
    for (const [item, w] of entries) {
      at -= w;
      if (at < 0) return item;
    }
    return entries[entries.length - 1][0];
  };
  return { int, pick, chance, weighted };
}
