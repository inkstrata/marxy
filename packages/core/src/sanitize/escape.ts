// Escaping and character-reference decoding. Small on purpose: everything the sanitiser decides is
// decided on a decoded value, and everything it emits is escaped once, so no value can mean one
// thing to this code and another to the parser that reads the output (ADR-0009).

/** Text that is not markup: the three characters that could become markup again. */
export function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

/** A double-quoted attribute value. Escaped so exactly one decoding pass returns `value`. */
export function escapeAttribute(value: string): string {
  return value.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

/**
 * Re-escapes a value that may already contain character references, keeping the ones that are
 * well-formed and escaping any other `&`. Used for prose attributes (`alt`, `title`), where the
 * value is never scheme-parsed, so `&amp;` need not be resolved to decide anything and resolving it
 * would change what the reader sees.
 */
export function escapeAttributeKeepingReferences(value: string): string {
  return value
    .replace(/&(?!(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});)/g, '&amp;')
    .replace(/[<>"]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

/**
 * The named references worth resolving before a value is judged. Deliberately short: anything this
 * table does not know stays as the literal text `&name;`, which keeps an `&` in the value, and an
 * `&` in the part of a URL that decides its scheme is refused outright (`urls.ts`). A partial table
 * is therefore safe here in a way a partial deny-list never is.
 */
const NAMED_REFERENCES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'], ['AMP', '&'], ['lt', '<'], ['LT', '<'], ['gt', '>'], ['GT', '>'], ['quot', '"'],
  ['QUOT', '"'], ['apos', "'"], ['colon', ':'], ['sol', '/'], ['bsol', '\\'], ['num', '#'],
  ['percnt', '%'], ['excl', '!'], ['quest', '?'], ['lpar', '('], ['rpar', ')'], ['period', '.'],
  ['comma', ','], ['semi', ';'], ['equals', '='], ['commat', '@'], ['dollar', '$'], ['ast', '*'],
  ['plus', '+'], ['lowbar', '_'], ['hyphen', '-'], ['grave', '`'], ['NewLine', '\n'], ['Tab', '\t'],
  ['nbsp', '\u00a0'], ['sp', ' '],
]);

const REFERENCE = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});?/g;

/**
 * Decodes character references to a fixed point, so a value that only becomes dangerous after a
 * second decoding pass (`&amp;#x6a;avascript:`) is judged in its final form rather than its
 * innocent one. Four passes is far past anything a parser will do and terminates regardless.
 */
export function decodeReferences(value: string): string {
  let current = value;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = decodeOnce(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

function decodeOnce(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(REFERENCE, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_REFERENCES.get(body) ?? match;
  });
}
