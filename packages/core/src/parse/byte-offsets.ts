// Converts micromark's UTF-16 code-unit offsets to UTF-8 byte offsets, once per document (ADR-0021).
// The AST contract (ADR-0003) counts bytes, because operations splice the file's bytes; micromark
// counts code units, because it works on a JavaScript string. One table bridges the two.

/** Number of tables built in this process. Exported so a test can assert "once per document". */
let builds = 0;
export const byteOffsetTableBuilds = (): number => builds;

export interface ByteOffsets {
  /** Byte offset of the code unit at `utf16Offset`; defined for 0..length inclusive. */
  readonly at: (utf16Offset: number) => number;
  /** Total bytes of the string this table was built from, plus `base`. */
  readonly byteLength: number;
}

/**
 * Build the conversion for one document. `base` is added to every result, so a caller that stripped
 * a byte-order mark before parsing still reports offsets into the original file.
 */
export function byteOffsets(text: string, base = 0): ByteOffsets {
  builds++;
  if (isAscii(text)) {
    // One byte per code unit: the table would be the identity, so skip the allocation.
    return { at: (offset: number) => base + offset, byteLength: base + text.length };
  }
  const table = new Uint32Array(text.length + 1);
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    table[i] = bytes;
    bytes += utf8Length(text, i);
  }
  table[text.length] = bytes;
  return {
    at: (offset: number) => {
      const clamped = offset < 0 ? 0 : offset > text.length ? text.length : offset;
      return base + table[clamped]!;
    },
    byteLength: base + bytes,
  };
}

/** Bytes contributed by the code unit at `i`; a high surrogate carries all four of its pair's bytes. */
function utf8Length(text: string, i: number): number {
  const code = text.charCodeAt(i);
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code >= 0xd800 && code < 0xdc00) {
    const next = text.charCodeAt(i + 1);
    // A high surrogate followed by a low one is one 4-byte character; the low surrogate adds none.
    return next >= 0xdc00 && next < 0xe000 ? 4 : 3;
  }
  if (code >= 0xdc00 && code < 0xe000) {
    const previous = text.charCodeAt(i - 1);
    return previous >= 0xd800 && previous < 0xdc00 ? 0 : 3;
  }
  return 3;
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return false;
  return true;
}
