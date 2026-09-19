// The document buffer: the only place a document's bytes change (ADR-0003, ADR-0004). Story MARXY-93.

export type { Buffer } from './buffer.ts';
export {
  createBuffer,
  bytesOf,
  textOf,
  splice,
  fromText,
  byteToUtf16,
  utf16ToByte,
  contentHash,
  eolString,
  lineOf,
} from './buffer.ts';
export type { Edit } from './history.ts';
export { History } from './history.ts';
