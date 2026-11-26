// The document buffer: the only place a document's bytes change.

export type { Buffer, Edit } from './buffer.ts';
export {
  createBuffer,
  bytesOf,
  textOf,
  splice,
  fromText,
  foldText,
  byteToUtf16,
  utf16ToByte,
  contentHash,
  eolString,
  lineOf,
} from './buffer.ts';
export { foldSlice } from './fold-slice.ts';
export type { SourceText } from './source-text.ts';
export {
  STRAY_BASE,
  sourceTextOf,
  strayByteOf,
  holdsStrayBytes,
  encodeSourceText,
  readableText,
  sourceToTextOffset,
  textToSourceOffset,
  byteToSourceOffset,
  sourceTextOfRange,
} from './source-text.ts';
