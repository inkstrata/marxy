// What Reveal puts back on a text kind's reading, worked out from the bytes the reading's own
// provenance names: the text between a tree's nodes (quotes, colons, commas, brackets, a list's dashes, comments), a
// delimited row's fields as written, and a record's fields the reading did not draw. Pure: no DOM is read here.

/** The bytes between two parts, split as the reader reads them. */
export interface Gap {
  /** What ends the part before: its comma, or a holder's opening bracket. */
  readonly trail: string;
  /** Whole lines between the two (a comment, a blank line is left out). */
  readonly lines: readonly string[];
  /** What leads the part after: its key and colon, a list's dash. */
  readonly lead: string;
}

/**
 * Splits the text between two parts. Across lines, what is on the first line ends the part before and what is on the last
 * leads the part after; on one line, a comma or semicolon ends the part before and the rest leads the next.
 */
export function splitGap(text: string): Gap {
  const nl = text.search(/\r?\n|\r/);
  if (nl < 0) {
    const m = /^\s*[,;]?/.exec(text)![0];
    return { trail: m.trim(), lines: [], lead: text.slice(m.length).trim() };
  }
  const all = text.split(/\r\n|\n|\r/);
  return { trail: all[0]!.trim(), lines: all.slice(1, -1).map((l) => l.trim()).filter((l) => l !== ''), lead: all.at(-1)!.trim() };
}

/** `text` around the first `key` in it, or null when the key is not written there. */
export function around(text: string, key: string): { before: string; after: string } | null {
  if (key === '') return null;
  const at = text.indexOf(key);
  return at < 0 ? null : { before: text.slice(0, at), after: text.slice(at + key.length) };
}

/**
 * A value's place in what its range holds (`name: gauges`, `"gauges"`): the value as written with its quotes, and what is
 * written before and after it. `shown` is the value as the reading drew it; when it is not there as written (an escape),
 * the whole range is the value.
 */
export function valueIn(raw: string, shown: string): { before: string; value: string; after: string } {
  const cut = (s: number, e: number) => ({ before: raw.slice(0, s), value: raw.slice(s, e), after: raw.slice(e) });
  if (shown === '') return cut(0, raw.length);
  for (const q of ['"', "'"]) {
    const at = raw.indexOf(`${q}${shown}${q}`);
    if (at >= 0) return cut(at, at + shown.length + 2);
  }
  // Unquoted, it is after the key's colon or equals sign when the range holds the key.
  const sep = /[:=]/.exec(raw);
  const at = raw.indexOf(shown, sep ? sep.index + 1 : 0);
  return at < 0 ? cut(0, raw.length) : cut(at, at + shown.length);
}

/** A delimited line's fields as written, quotes and all; a quoted field may hold the delimiter. */
export function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '""';
        i++;
      } else {
        if (c === '"') quoted = false;
        field += c;
      }
    } else if (c === '"' && field.trim() === '') {
      quoted = true;
      field += c;
    } else if (c === delim) {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

/** The delimiter written between two header fields: the first of `, ; tab |` in the gap. */
export function delimiterIn(gap: string): string {
  return /[,;\t|]/.exec(gap)?.[0] ?? ',';
}

const MAX_VALUE = 80;

function valueWords(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}…` : s;
  }
  return Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v).length}}`;
}

/**
 * The fields of a transcript's record the reading did not draw: every top-level field but the message's text, and the
 * message's own fields but its role and content, each `key: value` (a long value cut, a map or list as its size).
 */
export function droppedFields(record: unknown): string[] {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(record as Record<string, unknown>)) {
    if (k === 'message' && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const [mk, mv] of Object.entries(v as Record<string, unknown>)) if (mk !== 'content' && mk !== 'role') out.push(`message.${mk}: ${valueWords(mv)}`);
      continue;
    }
    out.push(`${k}: ${valueWords(v)}`);
  }
  return out;
}
