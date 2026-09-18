/** Reading position. FROZEN (ADR-0018). Never a scroll offset. */
export interface ReadingPosition {
  readonly path: string;
  /** Byte offset of the first visible block's src.start. */
  readonly byteOffset: number;
  /** 0..1, how far through that block the viewport top sits. */
  readonly fraction: number;
  readonly mode: 'rendered' | 'source';
}
