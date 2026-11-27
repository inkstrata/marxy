// How much of a code file is coloured (the tiers). The full page colours every line, what is in view first
// and the rest a piece at a time; past 2 MB, or with a line past 10,000 characters, a file is plain text, every line and
// no colour, unless the reader asks for colour anyway, which colours only what is in view. The file is the same in every
// tier, and no tier refuses it.
//
// Pure: no DOM. Measured on the bytes, so the store need not be decoded to decide.

/** The most bytes the full page colours ("no colour past 2 MB"). */
export const COLOUR_ALL_BYTES = 2 * 1024 * 1024;
/** A line longer than this marks the file as made by a machine (a bundle, a dump): plain text, as past 2 MB. */
export const COLOUR_LINE_CHARS = 10_000;

/** Why a file is plain text: its size, or a line too long. */
export type PlainWhy = 'size' | 'line';

export type ColourTier =
  /** Every line coloured: what is in view first, the rest a piece at a time. */
  | { readonly tier: 'full' }
  /** No colour; `anyway` is the reader's choice to colour what is in view, a screen at a time. */
  | { readonly tier: 'plain'; readonly why: PlainWhy; readonly anyway: boolean };

/** The characters in the longest line of `bytes` (UTF-8), stopping once one passes `stop`. */
export function longestLine(bytes: Uint8Array, stop = Number.POSITIVE_INFINITY): number {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x0a || b === 0x0d) {
      if (run > longest) longest = run;
      if (longest > stop) return longest;
      run = 0;
    } else if ((b & 0xc0) !== 0x80) run++;
  }
  return Math.max(longest, run);
}

/** The tier of a file of `bytes`; `anyway` is the reader's choice (the Reading card's "Colour it anyway"). */
export function colourTier(bytes: Uint8Array, anyway = false): ColourTier {
  if (bytes.length > COLOUR_ALL_BYTES) return { tier: 'plain', why: 'size', anyway };
  if (bytes.length > COLOUR_LINE_CHARS && longestLine(bytes, COLOUR_LINE_CHARS) > COLOUR_LINE_CHARS) return { tier: 'plain', why: 'line', anyway };
  return { tier: 'full' };
}

/** "2 MB": the size the full page colours to, as the page says it. */
const ALL_WORDS = `${COLOUR_ALL_BYTES / (1024 * 1024)} MB`;
const LINE_WORDS = COLOUR_LINE_CHARS.toLocaleString('en-US');

/** What the pane's head says of a tier, in grey, or null for the full page, which says nothing. */
export function tierHeadWords(tier: ColourTier): string | null {
  if (tier.tier === 'full') return null;
  if (tier.anyway) return 'Coloured as you scroll · your choice';
  return tier.why === 'size' ? `Plain text · no colour past ${ALL_WORDS}` : `Plain text · no colour with lines past ${LINE_WORDS} characters`;
}

/** Why the file is in its tier, for the Reading card: "by its size: 5.1 MB, past the 2 MB a full page is made for". */
export function tierWhyWords(tier: ColourTier, bytes: number, longest?: number): string {
  if (tier.tier === 'full') return `${sizeWords(bytes)}, within the ${ALL_WORDS} a full page is made for`;
  if (tier.why === 'size') return `by its size: ${sizeWords(bytes)}, past the ${ALL_WORDS} a full page is made for`;
  return `by a line of ${(longest ?? COLOUR_LINE_CHARS + 1).toLocaleString('en-US')} characters, past the ${LINE_WORDS} a full page is made for`;
}

/** The three tiers as the Reading card lists them, and which one the file is in. */
export function tierList(tier: ColourTier): { readonly items: readonly { readonly name: string; readonly words: string }[]; readonly at: number } {
  return {
    items: [
      { name: 'The full page', words: `colour, what is in view first, up to ${ALL_WORDS}` },
      { name: 'Plain text', words: `no colour, every line, past ${ALL_WORDS} or with a line past ${LINE_WORDS} characters` },
      { name: 'The bytes', words: 'when it is not text' },
    ],
    at: tier.tier === 'full' ? 0 : 1,
  };
}

function sizeWords(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
