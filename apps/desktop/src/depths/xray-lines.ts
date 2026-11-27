// X-ray's lines: the bytes of a part, widened to whole lines, as the file stores them. Pure.

export type LineEnd = '\n' | '\r\n' | '\r' | '';

export interface XrayLine {
  /** 1-based, as Source numbers it. */
  readonly number: number;
  /** The line's bytes decoded as UTF-8, its ending left off. */
  readonly text: string;
  readonly end: LineEnd;
}

export interface XrayLines {
  readonly lines: readonly XrayLine[];
  /** Whether each line's ending is drawn: the file has a CR in an ending, or more than one kind of ending. */
  readonly showEnds: boolean;
  /** The last line shown is the file's last and has no ending. */
  readonly noFinalNewline: boolean;
}

// As written: a leading BOM stays in the first line, as it is in the file.
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** Where the line holding `byte` starts. */
function lineStartAt(bytes: Uint8Array, byte: number): number {
  let i = Math.min(byte, bytes.length);
  while (i > 0 && bytes[i - 1] !== 0x0a && !(bytes[i - 1] === 0x0d && bytes[i] !== 0x0a)) i--;
  return i;
}

/** The kinds of line ending the file uses. */
export function endingsOf(bytes: Uint8Array): ReadonlySet<LineEnd> {
  const out = new Set<LineEnd>();
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) out.add('\n');
    else if (bytes[i] === 0x0d) {
      if (bytes[i + 1] === 0x0a) {
        out.add('\r\n');
        i++;
      } else out.add('\r');
    }
  }
  return out;
}

/**
 * The lines `[start, end)` touches, whole: from the start of the line holding `start` to the end of the line holding
 * the last byte before `end`, line breaks at the very end of the range not reaching into the next line.
 */
export function xrayLines(bytes: Uint8Array, start: number, end: number, endings: ReadonlySet<LineEnd> = endingsOf(bytes)): XrayLines {
  let e = Math.min(end, bytes.length);
  while (e > start && (bytes[e - 1] === 0x0a || bytes[e - 1] === 0x0d)) e--;
  let at = lineStartAt(bytes, start);
  let number = 1;
  for (let i = 0; i < at; i++) if (bytes[i] === 0x0a || (bytes[i] === 0x0d && bytes[i + 1] !== 0x0a)) number++;
  const lines: XrayLine[] = [];
  let last: LineEnd = '\n';
  do {
    let j = at;
    while (j < bytes.length && bytes[j] !== 0x0a && bytes[j] !== 0x0d) j++;
    const ending: LineEnd = j >= bytes.length ? '' : bytes[j] === 0x0a ? '\n' : bytes[j + 1] === 0x0a ? '\r\n' : '\r';
    lines.push({ number: number++, text: decoder.decode(bytes.subarray(at, j)), end: ending });
    last = ending;
    at = j + ending.length;
  } while (at < e && at < bytes.length);
  return {
    lines,
    showEnds: endings.has('\r\n') || endings.has('\r') || endings.size > 1,
    noFinalNewline: last === '' && bytes.length > 0,
  };
}

/** One run of a line as x-ray draws it: plain text, a tab, or a space at the line's end. */
export type XrayPiece = { readonly kind: 'text'; readonly value: string } | { readonly kind: 'tab' } | { readonly kind: 'trailing-space' };

/** A line cut into what x-ray marks itself: tabs anywhere, and spaces after the last other character. */
export function xrayPieces(text: string): XrayPiece[] {
  const tail = /[ \t]*$/.exec(text)!.index;
  const out: XrayPiece[] = [];
  let run = '';
  const flush = (): void => {
    if (run) out.push({ kind: 'text', value: run });
    run = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\t') {
      flush();
      out.push({ kind: 'tab' });
    } else if (ch === ' ' && i >= tail) {
      flush();
      out.push({ kind: 'trailing-space' });
    } else run += ch;
  }
  flush();
  return out;
}

/** How a line's ending is drawn. */
export function endGlyph(end: LineEnd): string {
  return end === '\r\n' ? '␍¬' : end === '\r' ? '␍' : end === '\n' ? '¬' : '';
}
