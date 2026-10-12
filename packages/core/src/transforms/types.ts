// The shape of a transform definition (J-03). A definition is the body only; the registry wraps it so every
// transform keeps the file's line endings and byte-order mark (ADR-0004, fidelity).
import type { Document } from '../contracts/ast.ts';

/**
 * A parse the caller already holds: `doc` is `parseMarkdown` of exactly the bytes of `text` (F-60). A cache and
 * nothing more: it is used only when `text` is the very string the transform body is about to read, and then
 * gives the same result the body would have got by parsing. With any other text it is ignored.
 *
 * The default-options contract (F-60.1): `doc` must have been made with the standard parse options, as
 * `parseMarkdown(bytes)` or `parseMarkdown(bytes, { file })` makes it, never with `gfm`, `frontmatter` or `math`
 * turned off, because the transform bodies parse with the defaults and a parse made otherwise would read
 * differently. Core cannot see the options a parse was made with, so this is the caller's promise, and the one
 * app caller is the document store, which only ever parses with the defaults. A cheap check backs it: the parse's
 * root must end at the text's UTF-8 byte length (`parseFits` in `prose.ts`), or the parse is ignored.
 */
export interface ParsedText {
  readonly text: string;
  readonly doc: Document;
}

/** Optional facts a caller knows and the text does not (the fence's language, for `fence`). */
export interface TransformContext {
  readonly lang?: string;
  /** An optional, already-made parse of the text (F-60). Never changes the result; see `ParsedText`. */
  readonly parsed?: ParsedText;
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
