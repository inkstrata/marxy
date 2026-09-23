// Folding Source mode edits back into the buffer (§01 fromText, §09 unchanged → keep bytes).

import { type Buffer, type Edit, contentHash, foldText, splice } from '@marxy/core';

export interface LeaveSourceResult {
  readonly buffer: Buffer;
  readonly changed: boolean;
  /** When `changed`, the one edit — the bytes of what differs, not the whole file — for `History.push`. */
  readonly edit: Edit | null;
}

/** Document text CodeMirror edits (no BOM prefix). */
export function cmDocText(buffer: Buffer): string {
  return buffer.bom ? buffer.text.slice(1) : buffer.text;
}

/**
 * Leaving Source: unchanged text keeps the original bytes; otherwise one splice over the part that
 * changed, so every byte outside it — a mixed file's line endings, a byte that is not UTF-8 — stays.
 */
export function leaveSourceMode(buffer: Buffer, docText: string): LeaveSourceResult {
  const fold = foldText(buffer, docText);
  if (fold === null) return { buffer, changed: false, edit: null };
  const edit: Edit = {
    range: fold.range,
    before: buffer.bytes.slice(fold.range.start, fold.range.end),
    after: fold.replacement,
    label: 'edit in Source',
  };
  return { buffer: splice(buffer, fold.range, fold.replacement), changed: true, edit };
}

/** True when every line ending in `bytes` is CRLF (ignoring a UTF-8 BOM). */
export function everyLineEndingIsCrlf(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  let sawBreak = false;
  for (; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      sawBreak = true;
      if (i === 0 || bytes[i - 1] !== 0x0d) return false;
    }
    if (bytes[i] === 0x0d && bytes[i + 1] !== 0x0a) return false;
  }
  return sawBreak || bytes.length === 0;
}

/** Stable fingerprint for unchanged-bytes checks in tests. */
export function bytesFingerprint(buffer: Buffer): string {
  return contentHash(buffer.bytes);
}
