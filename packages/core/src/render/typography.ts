// Smart typography as a render-time text-run transform. The file's bytes are never touched (ADR-0003, D-A13).

/** Context the renderer computes per paragraph; only `atParagraphEnd` plus a long enough paragraph trigger widont. */
export interface SmartenContext {
  readonly atParagraphEnd: boolean;
  readonly wordsInParagraph: number;
}

/** A paragraph this short has no last-word widow worth joining. */
const WIDONT_MIN_WORDS = 8;

const OPENING_DOUBLE = '\u201c';
const CLOSING_DOUBLE = '\u201d';
const OPENING_SINGLE = '\u2018';
const CLOSING_SINGLE = '\u2019';
const EN_DASH = '\u2013';
const EM_DASH = '\u2014';
const ELLIPSIS = '\u2026';
const NBSP = '\u00a0';

/**
 * Applies the D-A13 rule table to one text run. Idempotent: a second pass returns the same string.
 * Never used on the source buffer.
 */
export function smarten(text: string, ctx: SmartenContext): string {
  let out = text.replace(/---/g, EM_DASH).replace(/--/g, EN_DASH).replace(/\.\.\./g, ELLIPSIS);
  out = applyQuotes(out);
  if (ctx.atParagraphEnd && ctx.wordsInParagraph >= WIDONT_MIN_WORDS) out = applyWidont(out);
  return out;
}

function applyQuotes(text: string): string {
  let out = '';
  let previous: string | undefined;
  for (const char of text) {
    let next = char;
    if (char === '"') next = isOpeningContext(previous) ? OPENING_DOUBLE : CLOSING_DOUBLE;
    else if (char === "'") next = isOpeningContext(previous) ? OPENING_SINGLE : CLOSING_SINGLE;
    out += next;
    previous = next;
  }
  return out;
}

function isOpeningContext(previous: string | undefined): boolean {
  return previous === undefined || previous === ' ' || previous === '\t' || previous === '\n' || previous === '\r' || previous === '(' || previous === '[';
}

function applyWidont(text: string): string {
  // Prefer an existing NBSP so a second pass does not walk back to an earlier breaking space.
  const lastSpace = text.lastIndexOf(' ');
  const lastNbsp = text.lastIndexOf(NBSP);
  if (lastNbsp > lastSpace) return text;
  if (lastSpace < 0) return text;
  return `${text.slice(0, lastSpace)}${NBSP}${text.slice(lastSpace + 1)}`;
}
