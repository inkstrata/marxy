// Byte offsets (UTF-8) to and from string indices, for operations that act on a slice of text.

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** The string index of `byteOffset` bytes into `text`; throws `RangeError` inside a multi-byte sequence or past the end. */
export function byteToStringOffset(text: string, byteOffset: number): number {
  if (!Number.isInteger(byteOffset) || byteOffset < 0) throw new RangeError(`byte offset ${byteOffset} is not a non-negative integer`);
  let bytes = 0;
  let index = 0;
  while (bytes < byteOffset && index < text.length) {
    const cp = text.codePointAt(index)!;
    bytes += utf8Length(cp);
    index += cp > 0xffff ? 2 : 1;
  }
  if (bytes !== byteOffset) throw new RangeError(`byte offset ${byteOffset} is not on a character boundary or is past the end`);
  return index;
}

/** The UTF-8 byte count of `text.slice(0, index)`; throws `RangeError` if `index` is out of range or splits a surrogate pair. */
export function stringToByteOffset(text: string, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index > text.length) throw new RangeError(`string index ${index} is out of range`);
  let bytes = 0;
  let i = 0;
  while (i < index) {
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    if (i + width > index) throw new RangeError(`string index ${index} splits a surrogate pair`);
    bytes += utf8Length(cp);
    i += width;
  }
  return bytes;
}
