// What the measure step knows about each token, in token order: the input of the ragged breaker (ragged.ts).
// The justif/core item stream that used to live here is gone (B-17); justif now supplies hyphenation
// patterns and the hanging-punctuation tables only.

/** What the measure step knows about each token, in token order. */
export type Measured =
  | { readonly kind: 'piece'; readonly width: number }
  | { readonly kind: 'space'; readonly width: number; readonly fontSize: number }
  | { readonly kind: 'dash' }
  | { readonly kind: 'hyphen'; readonly width: number };
