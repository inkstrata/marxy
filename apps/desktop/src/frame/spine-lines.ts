// Lines to bytes for the spine's marks. Pure. The changes count lines by LF alone (core's diff
// keeps a CR on its line); notes count CRLF, LF or a lone CR as one ending (notes/anchor.ts `linesOf`).
import type { SpineRange } from './spine.ts';

/** The byte each line starts at; `loneCr` also ends a line at a CR not followed by LF. */
export function lineStarts(bytes: Uint8Array, loneCr = false): number[] {
  const out = [0];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0a) out.push(i + 1);
    else if (loneCr && b === 0x0d && bytes[i + 1] !== 0x0a) out.push(i + 1);
  }
  return out;
}

/** The first line of each run of consecutive lines: one edit mark per stretch, as the prototype draws them. */
export function runStarts(lines: readonly number[]): number[] {
  const out: number[] = [];
  let last = -2;
  for (const l of [...lines].sort((a, b) => a - b)) {
    if (l - last > 1) out.push(l);
    last = l;
  }
  return out;
}

/** Each line as the span of bytes it starts at; a line past the end is left out. */
export function lineRanges(lines: readonly number[], starts: readonly number[]): SpineRange[] {
  const out: SpineRange[] = [];
  for (const l of lines) {
    const start = starts[l];
    if (start === undefined) continue;
    out.push({ start, end: starts[l + 1] ?? start });
  }
  return out;
}
