// Ragged-right total-fit line breaking: Knuth and Plass's own formulation of unjustified setting,
// TeX's `\rightskip = 0pt plus S`. Every line gets the same stretch S at its end, whatever it holds,
// and the paragraph minimises the sum over its lines of (linePenalty + badness)², badness being
// 100·(shortfall / S)³. The last line is free (parfillskip).
//
// Why not justif/core here: justif is a justification engine and has no right-skip. The MARXY-19
// harness approximated one by giving every word space a little stretch, which prices a line's
// shortfall by how many spaces it has. A line holding a long code span has few spaces, so its
// shortfall looks expensive, and the breaker shortens the lines around it instead: on
// 01-long-technical.md that made the rag worse than the engine's own wrapping (see RESEARCH.md,
// "Rendered"). TeX's trick for a per-line stretch needs negative glue, which justif forbids. This
// breaker is that trick without the trick: the stretch belongs to the line. Pure; runs in Node.

import type { Measured } from './items.ts';

export interface RaggedSettings {
  /** The per-line right-skip stretch, in em of the paragraph's font. */
  readonly stretchEm: number;
  /** TeX's \linepenalty. */
  readonly linePenalty: number;
  /** Penalty for ending a line after an explicit dash. */
  readonly dashPenalty: number;
  /** Extra demerits for two dash-ended lines in a row (TeX's \doublehyphendemerits). */
  readonly doubleDashDemerits: number;
}

export const DEFAULT_RAGGED: RaggedSettings = { stretchEm: 2, linePenalty: 10, dashPenalty: 50, doubleDashDemerits: 3000 };

export interface RaggedResult {
  /** Token indices (a space or a dash) after which a line ends; excludes the paragraph's end. */
  readonly after: readonly number[];
  /** A line had to be set past the measure (one piece wider than it). */
  readonly overfull: boolean;
}

const INF_BAD = 10000;

/** TeX's badness, 100·(t/s)³ capped at 10000. */
export function badness(shortfall: number, stretch: number): number {
  if (shortfall <= 0) return 0;
  if (stretch <= 0) return INF_BAD;
  return Math.min(INF_BAD, 100 * (shortfall / stretch) ** 3);
}

/**
 * Breaks a measured paragraph. `fontSize` is the paragraph's, for the stretch in em. O(n × pieces per
 * line): each break looks back only as far as a line can reach.
 */
export function breakRagged(tokens: readonly Measured[], measure: number, fontSize: number, settings: RaggedSettings = DEFAULT_RAGGED): RaggedResult {
  const n = tokens.length;
  const stretch = settings.stretchEm * fontSize;
  // prefix[i] = width of tokens[0..i).
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const t = tokens[i]!;
    prefix[i + 1] = prefix[i]! + (t.kind === 'dash' ? 0 : t.width);
  }
  // Breakpoints: -1 is the paragraph's start; otherwise a space or dash token index.
  const breaks: number[] = [-1];
  for (let i = 0; i < n; i++) if (tokens[i]!.kind !== 'piece') breaks.push(i);
  const lineStart = (b: number): number => b + 1;
  /** Width of a line from after break `from` up to (not including) token `to`. */
  const width = (from: number, to: number): number => prefix[to]! - prefix[lineStart(from)]!;

  const best = new Float64Array(breaks.length).fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(breaks.length).fill(-1);
  const forced = new Uint8Array(breaks.length);
  best[0] = 0;
  for (let k = 1; k < breaks.length; k++) {
    const at = breaks[k]!;
    const dash = tokens[at]!.kind === 'dash';
    for (let j = k - 1; j >= 0; j--) {
      if (best[j] === Number.POSITIVE_INFINITY) continue;
      const w = width(breaks[j]!, at);
      if (w > measure) {
        // One piece wider than the measure has nowhere else to go: allow it, flagged.
        if (j === k - 1 && best[j]! < Number.POSITIVE_INFINITY) {
          const cost = best[j]! + INF_BAD * INF_BAD;
          if (cost < best[k]!) { best[k] = cost; prev[k] = j; forced[k] = 1; }
        }
        break;
      }
      const b = badness(measure - w, stretch);
      let demerits = (settings.linePenalty + b) ** 2 + (dash ? settings.dashPenalty ** 2 : 0);
      if (dash && j > 0 && tokens[breaks[j]!]!.kind === 'dash') demerits += settings.doubleDashDemerits;
      const cost = best[j]! + demerits;
      if (cost < best[k]!) { best[k] = cost; prev[k] = j; forced[k] = 0; }
    }
  }
  // The last line: free when it fits (parfillskip), from the cheapest reachable break.
  let end = -1;
  let endCost = Number.POSITIVE_INFINITY;
  let overfull = false;
  for (let j = breaks.length - 1; j >= 0; j--) {
    if (best[j] === Number.POSITIVE_INFINITY) continue;
    const w = width(breaks[j]!, n);
    if (w > measure) {
      if (end === -1) { end = j; endCost = best[j]!; overfull = true; }
      break;
    }
    const cost = best[j]! + settings.linePenalty ** 2;
    if (cost < endCost) { endCost = cost; end = j; overfull = false; }
  }
  const after: number[] = [];
  for (let k = end; k > 0; k = prev[k]!) {
    after.push(breaks[k]!);
    if (forced[k]) overfull = true;
  }
  return { after: after.reverse(), overfull };
}
