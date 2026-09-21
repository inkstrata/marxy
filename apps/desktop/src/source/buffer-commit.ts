// Folding Source mode edits back into the buffer (§01 fromText, §09 unchanged → keep bytes).

import type { Source } from '@marxy/core';
import { type Buffer, type Edit, contentHash, fromText } from '@marxy/core';

export type LeaveSourceNotice = { readonly kind: 'mixed-to-lf'; readonly message: string };

export interface LeaveSourceResult {
  readonly buffer: Buffer;
  readonly changed: boolean;
  readonly notice: LeaveSourceNotice | null;
  /** When `changed`, one edit covering the whole document for `History.push`. */
  readonly edit: Edit | null;
}

/** Document text CodeMirror edits (no BOM prefix). */
export function cmDocText(buffer: Buffer): string {
  return buffer.bom ? buffer.text.slice(1) : buffer.text;
}

/**
 * Leaving Source: unchanged text keeps the original bytes; otherwise `fromText` and one history edit.
 */
export function leaveSourceMode(buffer: Buffer, docText: string): LeaveSourceResult {
  const prior = cmDocText(buffer);
  if (docText === prior) {
    return { buffer, changed: false, notice: null, edit: null };
  }
  const wasMixed = buffer.eol === 'mixed';
  const next = fromText(buffer.path, docText, buffer);
  const range: Source = { file: buffer.path, start: 0, end: buffer.bytes.length };
  const edit: Edit = {
    range,
    before: buffer.bytes,
    after: next.bytes,
    label: 'edit in Source',
  };
  const notice: LeaveSourceNotice | null = wasMixed
    ? {
        kind: 'mixed-to-lf',
        message: 'Line endings were mixed; editing in Source normalised the file to LF.',
      }
    : null;
  return { buffer: next, changed: true, notice, edit };
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
