// CommonMark line endings: CRLF, CR and LF all end a line. One helper so a
// later caller cannot assume LF (ADR-0003).

/** True if `text` contains any of the three CommonMark line endings. */
export const LINE_ENDING = /\r|\n/;

/** Splits on CRLF, CR or LF; a CRLF is one ending, not two. */
export const LINE_ENDINGS = /\r\n|\r|\n/;

/** The next CRLF, CR or LF at or after `from`, as the half-open range it occupies. */
export function nextLineEnding(raw: string, from: number): { start: number; end: number } | undefined {
  for (let index = from; index < raw.length; index++) {
    const character = raw[index];
    if (character === '\n') return { start: index, end: index + 1 };
    if (character === '\r') return { start: index, end: raw[index + 1] === '\n' ? index + 2 : index + 1 };
  }
  return undefined;
}

/** CommonMark line endings: CRLF, CR alone and LF alone all end a line. */
export function splitLines(text: string): string[] {
  return text.split(LINE_ENDINGS);
}
