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

const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Decode `bytes[from..]` and build its table from the bytes themselves. Valid UTF-8 takes the same
 * path as `byteOffsets`. Invalid UTF-8 decodes exactly as a non-fatal `TextDecoder` does (WHATWG
 * replacement, one U+FFFD per maximal invalid subpart), but each U+FFFD is charged the bytes it
 * replaced, not the three bytes U+FFFD would encode to — otherwise every offset after a stray
 * Latin-1 byte points past the bytes it names, and a splice there writes into the wrong place.
 */
export function decodeWithOffsets(bytes: Uint8Array, from = 0): { text: string; offsets: ByteOffsets } {
  const view = from === 0 ? bytes : bytes.subarray(from);
  let text: string | undefined;
  try {
    text = strict.decode(view);
  } catch {
    text = undefined;
  }
  if (text !== undefined) return { text, offsets: byteOffsets(text, from) };
  builds++;
  const units: number[] = [];
  const starts: number[] = [];
  const emit = (codePoint: number, start: number, end: number): void => {
    if (codePoint > 0xffff) {
      const v = codePoint - 0x10000;
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      // As in `byteOffsets`: the high surrogate owns the pair's bytes, the low one sits at their end.
      starts.push(start, end);
    } else {
      units.push(codePoint);
      starts.push(start);
    }
  };
  let needed = 0;
  let seen = 0;
  let codePoint = 0;
  let lower = 0x80;
  let upper = 0xbf;
  let start = 0;
  for (let i = 0; i < view.length; i++) {
    const byte = view[i]!;
    if (needed === 0) {
      start = i;
      if (byte <= 0x7f) {
        emit(byte, i, i + 1);
      } else if (byte >= 0xc2 && byte <= 0xdf) {
        needed = 1;
        codePoint = byte & 0x1f;
      } else if (byte >= 0xe0 && byte <= 0xef) {
        if (byte === 0xe0) lower = 0xa0;
        if (byte === 0xed) upper = 0x9f;
        needed = 2;
        codePoint = byte & 0x0f;
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        if (byte === 0xf0) lower = 0x90;
        if (byte === 0xf4) upper = 0x8f;
        needed = 3;
        codePoint = byte & 0x07;
      } else {
        emit(0xfffd, i, i + 1);
      }
      continue;
    }
    if (byte < lower || byte > upper) {
      // The sequence so far is one replacement, and this byte starts over (WHATWG "prepend").
      emit(0xfffd, start, i);
      needed = 0;
      seen = 0;
      codePoint = 0;
      lower = 0x80;
      upper = 0xbf;
      i--;
      continue;
    }
    lower = 0x80;
    upper = 0xbf;
    codePoint = (codePoint << 6) | (byte & 0x3f);
    seen++;
    if (seen === needed) {
      emit(codePoint, start, i + 1);
      needed = 0;
      seen = 0;
      codePoint = 0;
    }
  }
  if (needed !== 0) emit(0xfffd, start, view.length);
  let decoded = '';
  for (let i = 0; i < units.length; i += 8192) decoded += String.fromCharCode(...units.slice(i, i + 8192));
  const table = Uint32Array.from(starts);
  const length = units.length;
  return {
    text: decoded,
    offsets: {
      at: (offset: number) => from + (offset <= 0 ? (table[0] ?? 0) : offset >= length ? view.length : table[offset]!),
      byteLength: from + view.length,
    },
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
