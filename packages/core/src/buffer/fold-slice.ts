// The slice fold: the smallest splice that turns one slice of a buffer into the editor's text for it.
// `foldText` does this for the whole file; this is the same rule for a block shown in place (ADR-0048). The editor's
// text is the slice's Source text (`sourceTextOfRange`, ADR-0069): each byte that is not UTF-8 is its own code unit, so
// the fold is exact here as it is for the whole file, and a stray byte the reader did not edit keeps its bytes.

import type { Source } from '../contracts/ast.ts';
import { byteToSourceOffset, encodeSourceText, sourceTextOf } from './source-text.ts';
import type { Buffer } from './buffer.ts';

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** A line feed that is not the second half of a CRLF. */
const BARE_LF = /(?<!\r)\n/;
const EVERY_BARE_LF = /(?<!\r)\n/g;

const isHigh = (code: number): boolean => code >= 0xd800 && code < 0xdc00;
const isLow = (code: number): boolean => code >= 0xdc00 && code < 0xe000;

/** The line ending the first line of `text` uses, if it has one. */
function firstEnding(text: string): '\r\n' | '\n' | '\r' | undefined {
  const at = text.search(/[\r\n]/);
  if (at < 0) return undefined;
  if (text[at] === '\n') return '\n';
  return text[at + 1] === '\n' ? '\r\n' : '\r';
}

/**
 * Fold the editor's `text` for `slice` back into `buffer` as one splice: the bytes of the part that
 * differs and nothing else. `text` is a Source text (`sourceTextOfRange`): the part that differs is written as the
 * bytes the text names, a stray byte's code unit as that byte and a U+FFFD as `EF BF BD`; bytes of the slice before and
 * after that part keep their own endings and their own (even invalid) bytes. A new line break (a bare LF) follows the slice's
 * first line ending, else the file's if it is CRLF, else LF, unless the part replaced holds a bare LF of its own (a block
 * that mixes endings): then no ending in the text is rewritten (F-40). `replacement` is those bytes; `text` in the result is their
 * reading decode. `null` if no byte differs. Pure; takes no DOM.
 */
export function foldSlice(
  buffer: Buffer,
  slice: Source,
  text: string,
): { range: Source; replacement: Uint8Array; text: string } | null {
  const { text: whole, offsets } = sourceTextOf(buffer);
  const base = byteToSourceOffset(buffer, slice.start);
  const stop = byteToSourceOffset(buffer, slice.end);
  // As `textOf`: a slice may not begin or end inside a character.
  if (base < 0 || stop < 0) throw new RangeError(`byte offset ${base < 0 ? slice.start : slice.end} is a UTF-8 continuation byte`);
  const old = whole.slice(base, stop);
  const limit = Math.min(old.length, text.length);
  let prefix = 0;
  while (prefix < limit && old.charCodeAt(prefix) === text.charCodeAt(prefix)) prefix++;
  if (prefix === old.length && prefix === text.length) return null;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    old.charCodeAt(old.length - 1 - suffix) === text.charCodeAt(text.length - 1 - suffix)
  ) {
    suffix++;
  }
  const cuts = (s: string, at: number): boolean =>
    at > 0 &&
    at < s.length &&
    ((isHigh(s.charCodeAt(at - 1)) && isLow(s.charCodeAt(at))) || (s[at - 1] === '\r' && s[at] === '\n'));
  // Never cut a surrogate pair or a CRLF, in the editor's text or in the old slice's.
  while (prefix > 0 && (cuts(text, prefix) || cuts(old, prefix))) prefix--;
  while (suffix > 0 && (cuts(text, text.length - suffix) || cuts(old, old.length - suffix))) suffix--;
  const middle = text.slice(prefix, text.length - suffix);
  const ending = firstEnding(old) ?? (buffer.eol === 'crlf' ? '\r\n' : '\n');
  // The editor's own line break is a bare LF, and a new one follows the block's first ending. Only a bare LF is
  // converted, and only when the part replaced has none of its own: otherwise the text cannot say which LF the
  // reader made, and a converted one would rewrite an ending the reader did not touch (a CRLF or a lone CR in the
  // middle is always the file's own, and stays). A new line break in a block that mixes endings, edited across one
  // of its bare LFs, is so written as the editor made it (F-40).
  const oldMiddle = old.slice(prefix, old.length - suffix);
  const converted = ending === '\n' || BARE_LF.test(oldMiddle) ? middle : middle.replace(EVERY_BARE_LF, ending);
  const replacement = encodeSourceText(converted);
  const start = offsets.at(base + prefix);
  const end = offsets.at(base + old.length - suffix);
  // Different text can name the same bytes (two stray bytes made adjacent spell a character): nothing to write.
  if (end - start === replacement.length && replacement.every((byte, i) => byte === buffer.bytes[start + i])) return null;
  return {
    range: { file: slice.file, start, end },
    replacement,
    text: decoder.decode(replacement),
  };
}
