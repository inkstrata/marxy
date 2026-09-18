/** Typesetting contract (ADR-0007). The implementation lands in Phase 1 (MARXY-20..024). */
export interface TypesetOptions {
  readonly justify: boolean;            /* default false: ragged-right through the same breaker */
  readonly hyphenate: boolean;
  readonly hangingPunctuation: 'none' | 'line-end-only' | 'all-line-edges';
  readonly lineBox: number;             /* px; every block height is rounded up to a multiple */
}
export interface Typesetter {
  /** Enhance paragraphs, list items and quotes under root; viewport first, rest in idle time. */
  attach(root: HTMLElement, opts: TypesetOptions): { readonly ready: Promise<void>; relayout(): void; destroy(): void };
}
