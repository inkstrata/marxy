// The shape of a transform definition (J-03). A definition is the body only; the registry wraps it so every
// transform keeps the file's line endings and byte-order mark (ADR-0004, fidelity).

/** Optional facts a caller knows and the text does not (the fence's language, for `fence`). */
export interface TransformContext {
  readonly lang?: string;
}

/**
 * - `edit`: the output is the input with some bytes changed. Line endings and a leading BOM are kept.
 * - `derive`: the output is new text made from the input (an extract, a conversion). It uses the input's line
 *   ending, and carries no BOM (a BOM is the file's, not the text's).
 * - `literal`: the output quotes the input's characters exactly (`json-string`), so line endings are content and
 *   are not normalised.
 */
export type TransformKind = 'edit' | 'derive' | 'literal';

export interface TransformDef {
  readonly id: string;
  readonly kind: TransformKind;
  /** The transform leaves code blocks, math blocks and front matter byte for byte (tested). */
  readonly outsideCode?: true;
  /** `fn(fn(x)) === fn(x)` (tested). */
  readonly idempotent?: true;
  /** The body sees the text with its own line endings (BOM still set aside): for a transform that moves whole lines. */
  readonly raw?: true;
  /** The body, on LF text. For `literal` or `raw`, on the text as given. */
  readonly run: (text: string, ctx: TransformContext) => string;
}
