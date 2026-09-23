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
//
// Hyphenation follows TeX (docs/research/reader-typography/05-line-breaking.md, ADR-0033): a first
// pass with no hyphens is kept when every line is within \pretolerance, so text that sets well is
// never hyphenated; two hyphenated lines in a row cost \doublehyphendemerits and a hyphen that
// leaves only a fragment on the last line costs \finalhyphendemerits.

import type { Measured } from './items.ts';

export interface RaggedSettings {
  /** The per-line right-skip stretch, in em of the paragraph's font. */
  readonly stretchEm: number;
  /** TeX's \linepenalty. */
  readonly linePenalty: number;
  /** Penalty for ending a line after an explicit dash. */
  readonly dashPenalty: number;
  /** Penalty for ending a line at a hyphenation point (TeX's \hyphenpenalty). */
  readonly hyphenPenalty: number;
  /** Extra demerits for two dash- or hyphen-ended lines in a row (TeX's \doublehyphendemerits). */
  readonly doubleDashDemerits: number;
  /** Extra demerits when the second-to-last line ends in a hyphen (TeX's \finalhyphendemerits). */
  readonly finalHyphenDemerits: number;
  /** Worst badness the no-hyphen first pass may keep (TeX's \pretolerance); below 0 skips the pass. */
  readonly pretolerance: number;
}

export const DEFAULT_RAGGED: RaggedSettings = {
  stretchEm: 2,
  linePenalty: 10,
  dashPenalty: 50,
  hyphenPenalty: 50,
  doubleDashDemerits: 3000,
  finalHyphenDemerits: 5000,
  pretolerance: 100,
};

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
  const hasHyphens = tokens.some((t) => t.kind === 'hyphen');
  if (hasHyphens && settings.pretolerance >= 0) {
    const first = pass(tokens, measure, fontSize, settings, false);
    if (!first.overfull && first.worst <= settings.pretolerance) return { after: first.after, overfull: false };
  }
  const { after, overfull } = pass(tokens, measure, fontSize, settings, true);
  return { after, overfull };
}

function pass(tokens: readonly Measured[], measure: number, fontSize: number, settings: RaggedSettings, hyphenate: boolean): RaggedResult & { worst: number } {
  const n = tokens.length;
  const stretch = settings.stretchEm * fontSize;
  // prefix[i] = width of tokens[0..i).
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const t = tokens[i]!;
    prefix[i + 1] = prefix[i]! + (t.kind === 'piece' || t.kind === 'space' ? t.width : 0);
  }
  // Breakpoints: -1 is the paragraph's start; otherwise a space, dash or hyphen token index.
  const breaks: number[] = [-1];
  for (let i = 0; i < n; i++) {
    const kind = tokens[i]!.kind;
    if (kind === 'space' || kind === 'dash' || (kind === 'hyphen' && hyphenate)) breaks.push(i);
  }
  const lineStart = (b: number): number => b + 1;
  /** Width of a line from after break `from` up to token `to`, plus the hyphen drawn when `to` is one. */
  const width = (from: number, to: number): number => {
    const t = tokens[to];
    return prefix[to]! - prefix[lineStart(from)]! + (t?.kind === 'hyphen' ? t.width : 0);
  };
  const endsInDash = (b: number): boolean => b >= 0 && (tokens[b]!.kind === 'dash' || tokens[b]!.kind === 'hyphen');

  const best = new Float64Array(breaks.length).fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(breaks.length).fill(-1);
  const forced = new Uint8Array(breaks.length);
  best[0] = 0;
  for (let k = 1; k < breaks.length; k++) {
    const at = breaks[k]!;
    const dash = endsInDash(at);
    const penalty = tokens[at]!.kind === 'hyphen' ? settings.hyphenPenalty : settings.dashPenalty;
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
      let demerits = (settings.linePenalty + b) ** 2 + (dash ? penalty ** 2 : 0);
      if (dash && j > 0 && endsInDash(breaks[j]!)) demerits += settings.doubleDashDemerits;
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
    const cost = best[j]! + settings.linePenalty ** 2 + (j > 0 && tokens[breaks[j]!]!.kind === 'hyphen' ? settings.finalHyphenDemerits : 0);
    if (cost < endCost) { endCost = cost; end = j; overfull = false; }
  }
  const after: number[] = [];
  let worst = 0;
  for (let k = end; k > 0; k = prev[k]!) {
    after.push(breaks[k]!);
    if (forced[k]) overfull = true;
    worst = Math.max(worst, badness(measure - width(breaks[prev[k]!]!, breaks[k]!), stretch));
  }
  return { after: after.reverse(), overfull, worst };
}
