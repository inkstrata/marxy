// A mail message as it travels (RFC 5322 headers, MIME parts), read in core so the
// browser build and the app read it alike from the store's own bytes. Bounded: parts, depth, headers and the message's
// size are capped, and a cap that cuts says so. Nothing is fetched, run or written. Pure: no DOM, no I/O.
import { type Budget, budget, figure } from '../util/budget.ts';
import { pushAll } from '../util/spread.ts';

/** What one message may cost. Past `messageBytes` the message is not read as one: Source has its text. */
export const MAIL_LIMITS = {
  messageBytes: 64 * 1024 * 1024,
  parts: 500,
  depth: 12,
  headers: 1_000,
  headerBytes: 256 * 1024,
  /** Lines beginning `--` indexed in one message, for every level's delimiters to be looked for among. */
  dashLines: 1_000_000,
} as const;

export interface MailHeader {
  /** As written, its case kept. */
  readonly name: string;
  /** As written, unfolded. */
  readonly raw: string;
  /** Encoded words read (RFC 2047). */
  readonly value: string;
}

export interface MailPart {
  /** "1", "1.2", "1.2.1": where it sits in the tree. */
  readonly id: string;
  /** Lowercased `type/subtype`. */
  readonly type: string;
  readonly params: Readonly<Record<string, string>>;
  readonly charset: string | null;
  /** Lowercased Content-Transfer-Encoding, `7bit` when none is said. */
  readonly encoding: string;
  readonly disposition: 'inline' | 'attachment' | null;
  readonly filename: string | null;
  /** Its Content-ID without the angle brackets. */
  readonly cid: string | null;
  readonly headers: readonly MailHeader[];
  readonly children: readonly MailPart[];
  readonly depth: number;
  /** The decoded body's length (a leaf's). */
  readonly size: number;
  /** A leaf's body, its transfer encoding undone. */
  bytes(): Uint8Array;
  /** A text leaf's body in its charset, or null for any other part. */
  text(): string | null;
}

export interface MailAddress {
  readonly name: string;
  readonly address: string;
}

export interface MailDate {
  readonly raw: string;
  /** Its parts in the message's own zone, or null when the date does not read. */
  readonly when: { readonly year: number; readonly month: number; readonly day: number; readonly weekday: number; readonly hour: number; readonly minute: number; readonly second: number | null; readonly zone: string } | null;
}

export interface MailMessage {
  readonly headers: readonly MailHeader[];
  readonly root: MailPart;
  readonly subject: string;
  readonly from: readonly MailAddress[];
  readonly to: readonly MailAddress[];
  readonly cc: readonly MailAddress[];
  /** Kept by the sender's own copy (a draft, a sent item, an Outlook message); a message as delivered has none. */
  readonly bcc: readonly MailAddress[];
  readonly date: MailDate | null;
  /** The part read as the message's HTML, and as its text; either may be missing. */
  readonly html: MailPart | null;
  readonly text: MailPart | null;
  readonly attachments: readonly MailPart[];
  /** Parts named by Content-ID, which the HTML part draws (`cid:`). */
  readonly inline: ReadonlyMap<string, MailPart>;
  /** Every part, depth first. */
  readonly parts: readonly MailPart[];
  /** Leaves: the parts that carry a body. */
  readonly leaves: number;
  /** What a cap cut, in a sentence each. */
  readonly capped: readonly string[];
}

const latin1 = (bytes: Uint8Array, from = 0, to = bytes.length): string => {
  let out = '';
  for (let i = from; i < to; i += 8192) out += String.fromCharCode(...bytes.subarray(i, Math.min(to, i + 8192)));
  return out;
};

/** Text in `charset`, read as UTF-8 when the label is unknown or missing (US-ASCII is a subset of both). */
export function decodeCharset(bytes: Uint8Array, charset: string | null): string {
  const label = (charset ?? 'utf-8').trim().toLowerCase().replace(/\*.*$/, '');
  try {
    return new TextDecoder(label === 'us-ascii' || label === 'ascii' || label === '' ? 'utf-8' : label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

const B64 = new Int16Array(256).fill(-1);
for (let i = 0; i < 64; i++) B64['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.charCodeAt(i)] = i;

/** Base64, anything outside its alphabet skipped (line breaks, stray spaces), stopping at padding. */
export function decodeBase64(src: Uint8Array | string): Uint8Array {
  const n = src.length;
  const out = new Uint8Array(Math.floor((n * 3) / 4) + 3);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < n; i++) {
    const c = typeof src === 'string' ? src.charCodeAt(i) : src[i]!;
    if (c === 0x3d) break;
    const v = c < 256 ? B64[c]! : -1;
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.slice(0, o);
}

const hexVal = (c: number): number => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1);

/** Quoted-printable: `=XX` read, a soft line break (`=` at a line's end) joined; `inWord` reads `_` as a space (Q words). */
export function decodeQuotedPrintable(src: Uint8Array, inWord = false): Uint8Array {
  const out = new Uint8Array(src.length);
  let o = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === 0x3d) {
      const a = hexVal(src[i + 1] ?? -1);
      const b = hexVal(src[i + 2] ?? -1);
      if (a >= 0 && b >= 0) {
        out[o++] = (a << 4) | b;
        i += 2;
        continue;
      }
      // A soft break: `=`, spaces a sender left, then the line's end.
      let j = i + 1;
      while (src[j] === 0x20 || src[j] === 0x09) j++;
      if (src[j] === 0x0d && src[j + 1] === 0x0a) {
        i = j + 1;
        continue;
      }
      if (src[j] === 0x0a) {
        i = j;
        continue;
      }
      out[o++] = c;
      continue;
    }
    out[o++] = inWord && c === 0x5f ? 0x20 : c;
  }
  return out.slice(0, o);
}

const ENCODED_WORD = /=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g;

/** A header value with its encoded words read (RFC 2047); white space between two encoded words goes, as the RFC says. */
export function decodeWords(value: string): string {
  return value
    .replace(/(=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)/g, '$1')
    .replace(ENCODED_WORD, (whole, charset: string, enc: string, text: string) => {
      const raw = Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
      const bytes = enc.toLowerCase() === 'b' ? decodeBase64(text) : decodeQuotedPrintable(raw, true);
      try {
        return new TextDecoder(charset.replace(/\*.*$/, '').toLowerCase(), { fatal: false }).decode(bytes);
      } catch {
        return whole;
      }
    });
}

/** The header block's text: UTF-8 when it reads as UTF-8 (RFC 6532), else each byte its own character. */
function headerText(bytes: Uint8Array, from: number, to: number): string {
  const slice = bytes.subarray(from, to);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(slice);
  } catch {
    return latin1(slice);
  }
}

/** Where the header block ends (the empty line) and the body starts; the body is empty when there is no empty line. */
function splitHead(bytes: Uint8Array, from: number, to: number): { headEnd: number; bodyStart: number } {
  // A part may start with the empty line: no headers at all.
  if (bytes[from] === 0x0a) return { headEnd: from, bodyStart: from + 1 };
  if (bytes[from] === 0x0d && bytes[from + 1] === 0x0a) return { headEnd: from, bodyStart: from + 2 };
  for (let i = from; i < to; i++) {
    if (bytes[i] !== 0x0a) continue;
    if (bytes[i + 1] === 0x0a) return { headEnd: i + 1, bodyStart: i + 2 };
    if (bytes[i + 1] === 0x0d && bytes[i + 2] === 0x0a) return { headEnd: i + 1, bodyStart: i + 3 };
  }
  return { headEnd: to, bodyStart: to };
}

function parseHeaders(text: string, capped: string[]): MailHeader[] {
  const out: MailHeader[] = [];
  const lines = text.split(/\r?\n/);
  let current: string | null = null;
  // Set by a header past the limit, not by reaching it: a part of exactly the limit lost nothing.
  let over = false;
  const push = (): void => {
    if (current === null) return;
    const colon = current.indexOf(':');
    if (colon > 0) {
      const name = current.slice(0, colon).trim();
      const raw = current.slice(colon + 1).trim();
      if (/^[\x21-\x39\x3b-\x7e]+$/.test(name)) {
        if (out.length >= MAIL_LIMITS.headers) over = true;
        else out.push({ name, raw, value: decodeWords(raw) });
      }
    }
    current = null;
  };
  for (const line of lines) {
    if (/^[ \t]/.test(line) && current !== null) {
      current += ` ${line.trim()}`;
      continue;
    }
    push();
    if (over) break;
    if (line !== '') current = line;
  }
  push();
  if (over) capped.push(`Only the first ${MAIL_LIMITS.headers.toLocaleString('en-GB')} headers of a part are read.`);
  return out;
}

/**
 * A structured header's value and its parameters (`text/html; charset="utf-8"`): quoted strings read, and RFC 2231's
 * continuations and charsets (`filename*=utf-8''tide%20table.csv`, `name*0=`, `name*1=`) joined and decoded.
 */
export function parseParams(value: string): { value: string; params: Record<string, string> } {
  const parts: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === '"') quoted = !quoted;
    if (ch === '\\' && quoted && i + 1 < value.length) {
      cur += value[++i];
      continue;
    }
    if (ch === ';' && !quoted) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  const main = (parts.shift() ?? '').trim().toLowerCase();
  const params: Record<string, string> = Object.create(null);
  const pieces = new Map<string, { n: number; v: string; ext: boolean }[]>();
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq <= 0) continue;
    const key = p.slice(0, eq).trim().toLowerCase();
    let v = p.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
    const m = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(key);
    if (!m) continue;
    const name = m[1]!;
    if (m[2] === undefined && m[3] === undefined) {
      if (!(name in params)) params[name] = v;
      continue;
    }
    const list = pieces.get(name) ?? [];
    list.push({ n: m[2] === undefined ? 0 : Number(m[2]), v, ext: m[3] !== undefined });
    pieces.set(name, list);
  }
  for (const [name, list] of pieces) {
    list.sort((a, b) => a.n - b.n);
    let charset = 'utf-8';
    const bytes: number[] = [];
    list.forEach((piece, i) => {
      let v = piece.v;
      if (piece.ext && i === 0) {
        const m = /^([^']*)'[^']*'(.*)$/.exec(v);
        if (m) {
          charset = m[1] || 'utf-8';
          v = m[2]!;
        }
      }
      if (piece.ext) {
        for (let k = 0; k < v.length; k++) {
          if (v[k] === '%' && /^[0-9a-f]{2}$/i.test(v.slice(k + 1, k + 3))) {
            bytes.push(parseInt(v.slice(k + 1, k + 3), 16));
            k += 2;
          } else pushAll(bytes, new TextEncoder().encode(v[k]!));
        }
      } else for (const byte of new TextEncoder().encode(v)) bytes.push(byte);
    });
    params[name] = decodeCharset(Uint8Array.from(bytes), charset);
  }
  return { value: main, params };
}

const headerOf = (headers: readonly MailHeader[], name: string): MailHeader | undefined => headers.find((h) => h.name.toLowerCase() === name);

/**
 * The lines of a message that begin `--`, the only lines a delimiter can be, found once for every level of nesting.
 * Looking for each level's delimiters line by line instead rescans its whole range once per level. At most
 * `MAIL_LIMITS.dashLines` are kept; `to` is where the index stops being whole (the message's end unless it was cut).
 */
interface DashLines {
  readonly from: number;
  readonly at: number[];
  readonly to: number;
}

function dashLines(bytes: Uint8Array, from: number): DashLines {
  const at: number[] = [];
  const room = budget(MAIL_LIMITS.dashLines);
  let to = bytes.length;
  // Looked for by the dash, not the line break: most lines of a message do not hold one.
  for (let p = bytes.indexOf(0x2d, from + 1); p !== -1; p = bytes.indexOf(0x2d, p + 2)) {
    // A dash that does not begin a line leaves the byte after it no line start either: the search goes on past both.
    if (bytes[p - 1] !== 0x0a || bytes[p + 1] !== 0x2d) continue;
    if (!room.take()) {
      to = p;
      break;
    }
    at.push(p);
  }
  return { from, at, to };
}

/** The first index in `xs` (ascending) whose value is greater than `v`. */
function firstAbove(xs: readonly number[], v: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid]! > v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

interface Delimiter {
  readonly start: number;
  readonly next: number;
  readonly close: boolean;
}

/**
 * The first `most` delimiter lines of a multipart body: each `--boundary` line's start and the byte after its line end.
 * `cut` when the dash-line index stopped inside the range before a closing delimiter or `most` was reached: what
 * follows the last delimiter found has no known end.
 */
function delimiters(w: Walk, from: number, to: number, boundary: string, most: number): { marks: Delimiter[]; cut: boolean } {
  const bytes = w.bytes;
  const mark = Uint8Array.from(`--${boundary}`, (c) => c.charCodeAt(0) & 0xff);
  // The outermost body comes first and every other lies inside it, so one index from there serves them all.
  if (!w.dash || from < w.dash.from) w.dash = dashLines(bytes, from);
  const dash = w.dash;
  const known = Math.min(to, dash.to);
  const marks: Delimiter[] = [];
  const at = (lineStart: number): boolean => {
    let lineEnd = bytes.indexOf(0x0a, lineStart);
    if (lineEnd === -1 || lineEnd >= to) lineEnd = to;
    if (lineEnd - lineStart < mark.length) return false;
    for (let j = 0; j < mark.length; j++) if (bytes[lineStart + j] !== mark[j]) return false;
    const after = lineStart + mark.length;
    const close = bytes[after] === 0x2d && bytes[after + 1] === 0x2d;
    // Only white space may follow the boundary (or its closing `--`) on its line.
    let j = close ? after + 2 : after;
    while (j < lineEnd && (bytes[j] === 0x20 || bytes[j] === 0x09 || bytes[j] === 0x0d)) j++;
    if (j !== lineEnd) return false;
    // The line break before a delimiter belongs to it, not to the part above.
    let start = lineStart;
    if (start > from && bytes[start - 1] === 0x0a) start--;
    if (start > from && bytes[start - 1] === 0x0d) start--;
    marks.push({ start, next: Math.min(to, lineEnd + 1), close });
    return close;
  };
  // The range's own first line, then the indexed line starts inside it.
  if (from < known && at(from)) return { marks, cut: false };
  for (let k = firstAbove(dash.at, from); k < dash.at.length && marks.length < most; k++) {
    const lineStart = dash.at[k]!;
    if (lineStart >= known) break;
    if (at(lineStart)) return { marks, cut: false };
  }
  return { marks, cut: marks.length < most && known < to };
}

function decodeBody(bytes: Uint8Array, encoding: string): Uint8Array {
  if (encoding === 'base64') return decodeBase64(bytes);
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(bytes);
  return bytes.slice();
}

interface Walk {
  readonly bytes: Uint8Array;
  readonly capped: string[];
  /** Parts read, the message's own included. */
  readonly parts: Budget;
  /** The lines that begin `--`, indexed on the first multipart body read. */
  dash?: DashLines;
}

function readPart(w: Walk, from: number, to: number, id: string, depth: number, parentType: string | null): MailPart {
  const { headEnd, bodyStart } = splitHead(w.bytes, from, to);
  const headEndCapped = Math.min(headEnd, from + MAIL_LIMITS.headerBytes);
  if (headEndCapped < headEnd) w.capped.push(`A part's headers past ${MAIL_LIMITS.headerBytes / 1024} KB are not read.`);
  const headers = parseHeaders(headerText(w.bytes, from, headEndCapped), w.capped);
  // A part of a multipart/digest is a message unless it says otherwise.
  const fallback = parentType === 'multipart/digest' ? 'message/rfc822' : 'text/plain';
  const ct = parseParams(headerOf(headers, 'content-type')?.raw ?? fallback);
  const type = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(ct.value) ? ct.value : 'text/plain';
  const cd = headerOf(headers, 'content-disposition');
  const disp = cd ? parseParams(cd.raw) : null;
  const encoding = (headerOf(headers, 'content-transfer-encoding')?.raw ?? '7bit').trim().toLowerCase();
  const cidRaw = headerOf(headers, 'content-id')?.raw.trim() ?? '';
  const cid = cidRaw === '' ? null : cidRaw.replace(/^<|>$/g, '');
  const filename = disp?.params.filename ?? ct.params.name ?? null;
  const children: MailPart[] = [];
  let body: Uint8Array | null = null;
  let size = 0;
  const boundary = ct.params.boundary;
  if (type.startsWith('multipart/') && boundary) {
    if (depth >= MAIL_LIMITS.depth) w.capped.push(`Parts nested past ${MAIL_LIMITS.depth} levels are not read.`);
    else {
      // One more delimiter than the parts still allowed: it ends the last part read, or shows there were more.
      const { marks, cut } = delimiters(w, bodyStart, to, boundary, w.parts.limit - w.parts.used + 1);
      for (let i = 0; i < marks.length; i++) {
        const open = marks[i]!;
        if (open.close) break;
        // Past the index, a last part has no known end: running it to the parent's end would show the parts after it
        // as its body, so it is left out.
        if (cut && i + 1 === marks.length) {
          w.capped.push(`Past ${figure(MAIL_LIMITS.dashLines)} lines beginning “--”, a part whose end was not found is not read.`);
          break;
        }
        const end = i + 1 < marks.length ? marks[i + 1]!.start : to;
        if (!w.parts.take()) {
          w.capped.push(`Only the first ${figure(w.parts.limit)} parts are read.`);
          break;
        }
        children.push(readPart(w, open.next, end, `${id}.${children.length + 1}`, depth + 1, type));
      }
    }
  } else {
    body = decodeBody(w.bytes.subarray(bodyStart, to), encoding);
    size = body.length;
  }
  const charset = ct.params.charset ?? null;
  const leafBody = body;
  let text: string | null | undefined;
  return {
    id,
    type,
    params: ct.params,
    charset,
    encoding,
    disposition: disp ? (disp.value === 'attachment' ? 'attachment' : 'inline') : null,
    filename: filename === null ? null : decodeWords(filename),
    cid,
    headers,
    children,
    depth,
    size,
    bytes: () => leafBody ?? new Uint8Array(),
    text() {
      if (text !== undefined) return text;
      text = leafBody && type.startsWith('text/') ? decodeCharset(leafBody, charset) : null;
      return text;
    },
  };
}

// The two readings below were the regexes /^(.*?)<([^>]*)>\s*$/ and /\s*\(.*\)\s*$/, which backtrack in the
// square of a header of `<` or `(` or spaces (80, 000 took 7 s). Same answers, by index.
/** `.` in those regexes: anything but these. */
const isLineTerminator = (c: number): boolean => c === 10 || c === 13 || c === 0x2028 || c === 0x2029;

/** `Name <address>` of a trimmed piece: the first `<` after which the only `>` is the last character. */
function angleAddress(s: string): { name: string; address: string } | null {
  if (s.length < 2 || !s.endsWith('>')) return null;
  const open = s.indexOf('<', s.lastIndexOf('>', s.length - 2) + 1);
  if (open === -1 || open > s.length - 2) return null;
  for (let i = 0; i < open; i++) if (isLineTerminator(s.charCodeAt(i))) return null;
  return { name: s.slice(0, open), address: s.slice(open + 1, -1) };
}

/** A trimmed piece without a trailing `(comment)` on its last line, nor the space before it. */
function withoutComment(s: string): string {
  if (!s.endsWith(')')) return s;
  let lineStart = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    if (isLineTerminator(s.charCodeAt(i))) {
      lineStart = i + 1;
      break;
    }
  }
  const open = s.indexOf('(', lineStart);
  return open === -1 || open > s.length - 2 ? s : s.slice(0, open).trimEnd();
}

/** `"Harbour Office" <office@harbour.example>, notices@harbour.example`: each address, its name's words read. */
export function parseAddresses(value: string): MailAddress[] {
  const out: MailAddress[] = [];
  let cur = '';
  let quoted = false;
  let angle = false;
  const flush = (): void => {
    const s = cur.trim();
    cur = '';
    if (s === '') return;
    // A group (`Team: a@x, b@y;`) is its addresses; its name goes.
    const m = angleAddress(s);
    if (m) out.push({ name: decodeWords(m.name.trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1')).trim(), address: m.address.trim() });
    else out.push({ name: '', address: withoutComment(s) });
  };
  for (const ch of value) {
    if (ch === '"' && !angle) quoted = !quoted;
    else if (ch === '<' && !quoted) angle = true;
    else if (ch === '>' && !quoted) angle = false;
    if ((ch === ',' || ch === ';') && !quoted && !angle) {
      flush();
      continue;
    }
    if (ch === ':' && !quoted && !angle && !/@/.test(cur)) {
      cur = '';
      continue;
    }
    cur += ch;
  }
  flush();
  return out.filter((a) => a.address !== '' || a.name !== '');
}

export { looksLikeMessage } from './sniff.ts';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ZONES: Readonly<Record<string, string>> = { UT: '+0000', GMT: '+0000', Z: '+0000', EST: '-0500', EDT: '-0400', CST: '-0600', CDT: '-0500', MST: '-0700', MDT: '-0600', PST: '-0800', PDT: '-0700' };

/** `Mon, 02 Nov 2026 08:14:09 +0000` read as written, in the message's own zone: nothing is moved to the reader's. */
export function parseMailDate(raw: string): MailDate {
  const m = /^\s*(?:[A-Za-z]{3},?\s*)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[A-Za-z]{1,5})?/.exec(raw);
  if (!m) return { raw, when: null };
  const month = MONTHS.indexOf(m[2]!.toLowerCase());
  let year = Number(m[3]);
  if (year < 50) year += 2000;
  else if (year < 100) year += 1900;
  const day = Number(m[1]);
  if (month < 0 || day < 1 || day > 31) return { raw, when: null };
  const zoneWord = m[7] ?? '';
  const zone = /^[+-]\d{4}$/.test(zoneWord) ? zoneWord : ZONES[zoneWord.toUpperCase()] ?? '-0000';
  const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
  return { raw, when: { year, month: month + 1, day, weekday, hour: Number(m[4]), minute: Number(m[5]), second: m[6] === undefined ? null : Number(m[6]), zone } };
}

function* walk(part: MailPart): Generator<MailPart> {
  yield part;
  for (const c of part.children) yield* walk(c);
}

/** The body the message is read as: in an alternative, the last part of each kind (MIME orders them plainest first). */
function bodies(root: MailPart): { html: MailPart | null; text: MailPart | null; related: Set<MailPart> } {
  let html: MailPart | null = null;
  let text: MailPart | null = null;
  const related = new Set<MailPart>();
  const visit = (p: MailPart): void => {
    if (p.type === 'message/rfc822' || p.disposition === 'attachment') return;
    if (p.type === 'multipart/alternative') {
      for (const c of p.children) visit(c);
      return;
    }
    if (p.type === 'multipart/related') {
      // The first part is the body (or the one `start` names); the rest are what it draws.
      const start = p.params.start?.replace(/^<|>$/g, '');
      const first = (start ? p.children.find((c) => c.cid === start) : undefined) ?? p.children[0];
      for (const c of p.children) if (c !== first && c.children.length === 0) related.add(c);
      if (first) visit(first);
      return;
    }
    if (p.type.startsWith('multipart/')) {
      // Mixed: the first readable part is the body; what follows it is attached.
      for (const c of p.children) {
        if (html || text) break;
        visit(c);
      }
      return;
    }
    if (p.type === 'text/html') html = p;
    else if (p.type === 'text/plain' && !p.filename) text = p;
  };
  visit(root);
  return { html, text, related };
}

/** Reads `bytes` as a message. Past `MAIL_LIMITS.messageBytes` it throws: the page says so and Source has the text. */
export function parseMessage(bytes: Uint8Array): MailMessage {
  if (bytes.length > MAIL_LIMITS.messageBytes) throw new Error(`The message is ${Math.round(bytes.length / 1048576)} MB, past the ${MAIL_LIMITS.messageBytes / 1048576} MB read as a message.`);
  const capped: string[] = [];
  const w: Walk = { bytes, capped, parts: budget(MAIL_LIMITS.parts) };
  w.parts.take();
  const root = readPart(w, 0, bytes.length, '1', 0, null);
  const parts = [...walk(root)];
  const { html, text, related } = bodies(root);
  const inline = new Map<string, MailPart>();
  for (const p of parts) if (p.cid && p.children.length === 0 && !inline.has(p.cid)) inline.set(p.cid, p);
  const attachments = parts.filter((p) => p.children.length === 0 && p !== html && p !== text && !(related.has(p) && p.cid && p.disposition !== 'attachment') && p !== root);
  // A message of one part that is neither its text nor its HTML (a lone PDF) is that part, attached.
  if (root.children.length === 0 && root !== html && root !== text) attachments.push(root);
  const get = (name: string): string => headerOf(root.headers, name)?.value ?? '';
  const dateRaw = headerOf(root.headers, 'date')?.raw;
  return {
    headers: root.headers,
    root,
    subject: get('subject'),
    from: parseAddresses(headerOf(root.headers, 'from')?.raw ?? ''),
    to: parseAddresses(headerOf(root.headers, 'to')?.raw ?? ''),
    cc: parseAddresses(headerOf(root.headers, 'cc')?.raw ?? ''),
    bcc: parseAddresses(headerOf(root.headers, 'bcc')?.raw ?? ''),
    date: dateRaw === undefined ? null : parseMailDate(dateRaw),
    html,
    text,
    attachments,
    inline,
    parts,
    leaves: parts.filter((p) => p.children.length === 0).length,
    capped: [...new Set(capped)],
  };
}

/** Each line of a text part: its quote level (one per `>`), and whether it is in the signature (after `-- `). */
export interface TextLine {
  readonly text: string;
  readonly level: number;
  readonly signature: boolean;
}

export function textLines(text: string): TextLine[] {
  let signature = false;
  return text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((line) => {
    if (line === '-- ' || (line === '--' && !signature)) signature = true;
    const q = /^(?:>[ \t]?)+/.exec(line)?.[0] ?? '';
    const level = (q.match(/>/g) ?? []).length;
    return { text: line.slice(q.length), level, signature };
  });
}
