// The fenced part under the cursor: what a command of the reader's own runs on in Source when nothing is selected
// and the cursor is inside a fence. Read from the text by CommonMark's fence rules (the same character, at least as
// many, nothing but spaces after the closing run), so it needs no parse; a fence left open runs to the end.

export interface FencePart {
  /** The content's first character: the line after the opening fence. */
  readonly from: number;
  /** Where the closing fence's line starts (or the end): the content keeps its last line break. */
  readonly to: number;
}

const OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** The content of the fenced block whose content holds `offset`, or null when it is in none. */
export function fenceAt(text: string, offset: number): FencePart | null {
  let at = 0;
  let open: { fence: string; from: number } | null = null;
  while (at <= text.length) {
    const nl = text.indexOf('\n', at);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(at, end).replace(/\r$/, '');
    const next = nl === -1 ? text.length + 1 : nl + 1;
    if (open === null) {
      const m = OPEN.exec(line);
      // A backtick fence's info string may not hold a backtick.
      if (m && !(m[1][0] === '`' && m[2].includes('`'))) open = { fence: m[1], from: Math.min(next, text.length) };
    } else {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === open.fence[0] && close[1].length >= open.fence.length) {
        if (offset >= open.from && offset <= at) return { from: open.from, to: at };
        open = null;
      }
    }
    if (open === null && at > offset) return null;
    at = next;
  }
  if (open !== null && offset >= open.from) return { from: open.from, to: text.length };
  return null;
}
