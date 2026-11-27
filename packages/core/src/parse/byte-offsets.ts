// Converts micromark's UTF-16 code-unit offsets to UTF-8 byte offsets, once per document.
// The AST contract counts bytes, because operations splice the file's bytes; micromark
// counts code units, because it works on a JavaScript string. One table bridges the two.

/** Number of tables built in this process. Exported so a test can assert "once per document". */
let builds = 0;
export const byteOffsetTableBuilds = (): number => builds;

/** A decode of bytes and its table, as `decodeWithOffsets` gives it. */
export interface Decoded {
  readonly text: string;
  readonly offsets: ByteOffsets;
}

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
  // Typed and sized once (a byte gives at most one code unit), not number[] (35 bytes were held per byte decoded).
  const units = new Uint16Array(view.length);
  const starts = new Uint32Array(view.length);
  let length = 0;
  const emit = (codePoint: number, start: number, end: number): void => {
    if (codePoint > 0xffff) {
      const v = codePoint - 0x10000;
      units[length] = 0xd800 + (v >> 10);
      units[length + 1] = 0xdc00 + (v & 0x3ff);
      // As in `byteOffsets`: the high surrogate owns the pair's bytes, the low one sits at their end.
      starts[length] = start;
      starts[length + 1] = end;
      length += 2;
    } else {
      units[length] = codePoint;
      starts[length++] = start;
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
  for (let i = 0; i < length; i += 8192) decoded += String.fromCharCode(...units.subarray(i, Math.min(i + 8192, length)));
  return { text: decoded, offsets: tableOffsets(length === starts.length ? starts : starts.slice(0, length), from, view.length) };
}

/**
 * The table of a decode that was not valid UTF-8. Its own function, so the closure holds the table alone: one made beside
 * `emit` shared its context and kept the decode's scratch arrays for as long as the offsets lived.
 */
function tableOffsets(table: Uint32Array, from: number, bytes: number): ByteOffsets {
  const length = table.length;
  return {
    at: (offset: number) => from + (offset <= 0 ? (table[0] ?? 0) : offset >= length ? bytes : table[offset]!),
    byteLength: from + bytes,
  };
}

/**
 * `decoded`, the decode of a whole file (`decodeWithOffsets(bytes)`), from its code unit `from` on: what decoding the bytes
 * after that unit would give, made without decoding again. For a parse handed the text a store already holds.
 */
export function decodedFrom(decoded: Decoded, from: number): { text: string; offsets: ByteOffsets } {
  if (from === 0) return { text: decoded.text, offsets: decoded.offsets };
  const { text, offsets } = decoded;
  const length = text.length - from;
  return {
    text: text.slice(from),
    offsets: { at: (offset: number) => offsets.at(from + (offset < 0 ? 0 : offset > length ? length : offset)), byteLength: offsets.byteLength },
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

// Here rather than in buffer.ts, which source-text.ts imports: the two would otherwise import each other.
const utf16Cache = new WeakMap<object, Uint32Array>();

/** CodeMirror's UTF-16 offset for `byte`. ASCII is identity; otherwise a cached inverse table. */
export function byteToUtf16(buffer: { readonly text: string; readonly offsets: ByteOffsets }, byte: number): number {
  const { text, offsets } = buffer;
  const clamped = byte < 0 ? 0 : byte > offsets.byteLength ? offsets.byteLength : byte;
  if (offsets.byteLength === text.length) return clamped;
  let inverse = utf16Cache.get(buffer);
  if (!inverse) {
    inverse = invertOffsets(text, offsets);
    utf16Cache.set(buffer, inverse);
  }
  return inverse[clamped]!;
}

function invertOffsets(text: string, offsets: ByteOffsets): Uint32Array {
  const inverse = new Uint32Array(offsets.byteLength + 1);
  for (let i = 0; i < text.length; i++) {
    const from = offsets.at(i);
    const to = offsets.at(i + 1);
    for (let b = from; b < to; b++) inverse[b] = i;
  }
  inverse[offsets.byteLength] = text.length;
  return inverse;
}
