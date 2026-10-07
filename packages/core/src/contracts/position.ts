/** Reading position. Reviewed contract (ADR-0018, ADR-0045): changes by pull request. Never a scroll offset. */
export interface ReadingPosition {
  readonly path: string;
  /** Byte offset of the first visible block's src.start. */
  readonly byteOffset: number;
  /** 0..1, how far through that block the viewport top sits. */
  readonly fraction: number;
  readonly mode: 'rendered' | 'source';
}
