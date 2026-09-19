// The document as bytes, and the only way those bytes change (ADR-0003, ADR-0004).
// Splice concatenates; nothing here re-serialises or normalises the file.

import type { Source } from '../contracts/ast.ts';
import { byteOffsets, type ByteOffsets } from '../parse/byte-offsets.ts';

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const encoder = new TextEncoder();

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

const utf16Cache = new WeakMap<object, Uint32Array>();

/** A document's bytes and the tables derived from them. One buffer is one file (ADR-0003). */
export interface Buffer {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly text: string;
  readonly bom: boolean;
  readonly eol: 'lf' | 'crlf' | 'mixed' | 'none';
  readonly version: number;
  readonly offsets: ByteOffsets;
}

/** Decode `bytes` as-is: no BOM strip, no line-ending conversion, no trailing newline. */
export function createBuffer(path: string, bytes: Uint8Array): Buffer {
  return makeBuffer(path, new Uint8Array(bytes), 0);
}

/** A view of `buffer.bytes` over `range`, not a copy. */
export function bytesOf(buffer: Buffer, range: Source): Uint8Array {
  return buffer.bytes.subarray(range.start, range.end);
}

/**
 * Decode the bytes in `range`. Throws if `start` or `end` is a UTF-8 continuation byte,
 * so a caller cannot cut a code point in half and write the fragments back.
 */
export function textOf(buffer: Buffer, range: Source): string {
  assertUtf8Boundary(buffer.bytes, range.start);
  assertUtf8Boundary(buffer.bytes, range.end);
  return decoder.decode(buffer.bytes.subarray(range.start, range.end));
}

/**
 * Replace `[range.start, range.end)` by concatenating. Pure: a new buffer, `version + 1`.
 * The only function that produces new document bytes.
 */
export function splice(
  buffer: Buffer,
  range: Source,
  replacement: string | Uint8Array,
): Buffer {
  const encoded = typeof replacement === 'string' ? encoder.encode(replacement) : replacement;
  const { bytes } = buffer;
  const next = new Uint8Array(range.start + encoded.length + (bytes.length - range.end));
  next.set(bytes.subarray(0, range.start), 0);
  next.set(encoded, range.start);
  next.set(bytes.subarray(range.end), range.start + encoded.length);
  return makeBuffer(buffer.path, next, buffer.version + 1);
}

/**
 * Encode `text` using `like`'s line endings and BOM. Used when Source mode folds back
 * into the buffer — the file's convention, not the editor's, wins.
 */
export function fromText(path: string, text: string, like: Buffer): Buffer {
  const eol = eolString(like);
  let next = text.replace(/\r\n|\n/g, eol);
  if (like.bom && !next.startsWith('\uFEFF')) next = `\uFEFF${next}`;
  return createBuffer(path, encoder.encode(next));
}

/** CodeMirror's UTF-16 offset for `byte`. ASCII is identity; otherwise a cached inverse table. */
export function byteToUtf16(buffer: Buffer, byte: number): number {
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

/** Byte offset of UTF-16 code unit `cu`. The table from `byte-offsets.ts`, not a second scan. */
export function utf16ToByte(buffer: Buffer, cu: number): number {
  return buffer.offsets.at(cu);
}

/** FNV-1a 64 of `bytes` as 16 lowercase hex chars. Empty input is the offset basis. */
export function contentHash(bytes: Uint8Array): string {
  let hash = FNV_OFFSET;
  for (const octet of bytes) {
    hash ^= BigInt(octet);
    hash = (hash * FNV_PRIME) & FNV_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Line ending to write. `crlf` → CRLF; `lf` and `none` → LF; `mixed` → the ending of
 * the line that contains `atByte`, or LF when `atByte` is omitted (fromText).
 */
export function eolString(buffer: Buffer, atByte?: number): '\n' | '\r\n' {
  if (buffer.eol === 'crlf') return '\r\n';
  if (buffer.eol === 'mixed' && atByte !== undefined) return endingAt(buffer.bytes, atByte);
  return '\n';
}

/** 1-based line number of `byte`. CRLF is one ending, not two. */
export function lineOf(buffer: Buffer, byte: number): number {
  const { bytes } = buffer;
  const limit = byte < 0 ? 0 : byte > bytes.length ? bytes.length : byte;
  let line = 1;
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) {
      i += 1;
      if (i < limit) line += 1;
    } else if (bytes[i] === 0x0a || bytes[i] === 0x0d) {
      line += 1;
    }
  }
  return line;
}

function makeBuffer(path: string, bytes: Uint8Array, version: number): Buffer {
  const text = decoder.decode(bytes);
  return {
    path,
    bytes,
    text,
    bom: bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    eol: detectEol(bytes),
    version,
    offsets: byteOffsets(text),
  };
}

function detectEol(bytes: Uint8Array): Buffer['eol'] {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) {
      crlf += 1;
      i += 1;
    } else if (bytes[i] === 0x0a) {
      lf += 1;
    }
  }
  if (crlf === 0 && lf === 0) return 'none';
  if (crlf > 0 && lf === 0) return 'crlf';
  if (lf > 0 && crlf === 0) return 'lf';
  return 'mixed';
}

function endingAt(bytes: Uint8Array, atByte: number): '\n' | '\r\n' {
  const start = atByte < 0 ? 0 : atByte > bytes.length ? bytes.length : atByte;
  for (let i = start; i < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) return '\r\n';
    if (bytes[i] === 0x0a) return '\n';
  }
  return '\n';
}

function assertUtf8Boundary(bytes: Uint8Array, offset: number): void {
  if (offset < 0 || offset > bytes.length) {
    throw new RangeError(`byte offset ${offset} is outside 0..${bytes.length}`);
  }
  if (offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80) {
    throw new RangeError(`byte offset ${offset} is a UTF-8 continuation byte`);
  }
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
