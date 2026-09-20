// Step 2 and 4 of docs/design/04-typeset.md: the ragged-right item stream and the break, over
// justif/core. The stream is the one `scripts/rag-model.mjs` measured (MARXY-19): word boxes, glue
// that stretches by `glueStretchEm` and never shrinks, penalty 50 after an explicit dash, and TeX's
// parfillskip ending. Pure: widths in, breakpoints out, so it runs in Node for tests.

import { INF_PENALTY, ItemType, breakParagraph, defaultBreakOptions, withSums, type Item } from 'justif/core';

/** What the measure step knows about each token, in token order. */
export type Measured =
  | { readonly kind: 'piece'; readonly width: number }
  | { readonly kind: 'space'; readonly width: number; readonly fontSize: number }
  | { readonly kind: 'dash' }
  | { readonly kind: 'hyphen'; readonly width: number };

export interface BreakSettings {
  readonly glueStretchEm: number;
  readonly dashPenalty: number;
  readonly tolerance: number;
}

export const DEFAULT_BREAK: BreakSettings = { glueStretchEm: 0.6, dashPenalty: 50, tolerance: 200 };

export interface Broken {
  /** Indices into the measured tokens after which a line ends; excludes the paragraph's end. */
  readonly after: readonly number[];
  /** True when justif had to set a line past the measure (the paragraph then falls back). */
  readonly overfull: boolean;
  /** The item stream's shape, for comparison with the research harness. */
  readonly counts: { readonly box: number; readonly glue: number; readonly penalty: number };
}

const RUN = { fontKey: 'marxy', space: { width: 0, stretch: 0, shrink: 0 }, hyphenWidth: 0, ratioAtMax: 1, ratioAtMin: 1 };

export function breakTokens(tokens: readonly Measured[], measure: number, settings: BreakSettings = DEFAULT_BREAK): Broken {
  const items: Item[] = [];
  const owner: number[] = [];
  const counts = { box: 0, glue: 0, penalty: 0 };
  tokens.forEach((token, i) => {
    if (token.kind === 'piece') {
      counts.box++;
      items.push({ type: ItemType.Box, width: token.width, run: 0, text: '', lp: 0, lpFirst: 0, rp: 0, hangStretch: 0, hangShrink: 0, expStretch: 0, expShrink: 0, trackStretch: 0, trackShrink: 0 } as Item);
    } else if (token.kind === 'space') {
      counts.glue++;
      items.push({ type: ItemType.Glue, width: token.width, stretch: settings.glueStretchEm * token.fontSize, stretchFil: 0, shrink: 0, run: 0 } as Item);
    } else if (token.kind === 'hyphen') {
      counts.penalty++;
      items.push({
        type: ItemType.Penalty,
        penalty: settings.dashPenalty,
        width: token.width,
        flagged: true,
        hyphen: true,
        rp: 0,
        run: 0,
      } as Item);
    } else {
      counts.penalty++;
      items.push({ type: ItemType.Penalty, penalty: settings.dashPenalty, width: 0, flagged: true, hyphen: false, rp: 0, run: 0 } as Item);
    }
    owner.push(i);
  });
  items.push({ type: ItemType.Glue, width: 0, stretch: 0, stretchFil: 1, shrink: 0, run: 0 } as Item);
  items.push({ type: ItemType.Penalty, penalty: -INF_PENALTY, width: 0, flagged: false, hyphen: false, rp: 0, run: 0 } as Item);
  const result = breakParagraph(withSums(items, [RUN]), measure, { ...defaultBreakOptions, tolerance: settings.tolerance });
  const after = result.breakpoints.slice(0, -1).map((bp) => owner[bp]!);
  return { after, overfull: result.overfull.some(Boolean), counts };
}
