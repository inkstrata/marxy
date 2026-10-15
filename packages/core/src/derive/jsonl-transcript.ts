// The `jsonl-transcript` deriver (ADR-0061, K-12): a JSONL session read as the conversation it records, as a read-only
// tree beside the AST. A pure function of the bytes: no DOM, no Node built-ins, no I/O, and nothing it makes is ever
// written back (ADR-0061 item 6).
//
// The file is read a line at a time, because JSONL lines are independent (item 8): `createTranscriptDeriver` reads a
// slice of lines per `step`, so the first screen of turns needs only the first lines (commitment 5). Each line is checked
// as JSON by a scanner over its bytes that keeps the byte range of every value, so a leaf's `src` is exactly its string
// token, quotes included, and its value is the decoding of exactly those bytes (item 3): the bytes are decoded as UTF-8
// the way `TextDecoder` does (U+FFFD for each invalid sequence, its place kept in `replaced`), then unescaped the way
// `JSON.parse` does. `derive/invariants.ts` checks both against `TextDecoder` and `JSON.parse` themselves.
//
// What a line is read as:
// - a `user` or `assistant` message (a Claude Code line: `type` and `message.role`; or any line with a top-level `role`
//   and `content`): its text, thinking, tool calls and tool results become leaves of turns;
// - a record of another type (`summary`, `system`, a file snapshot…), or a message with no text: dropped, and counted
//   by its type, a type the deriver knows apart from one it does not (item 7);
// - a blank line: dropped as `blank`;
// - a line that is not JSON: an `unreadable` row; the last line, with no newline and not yet JSON, is `pending`.
//
// Nothing about a line's session, model, cost, token use or time is read into the tree.
import type { Source } from '../contracts/ast.ts';
import type {
  DerivedText,
  DerivedTextRole,
  DerivedThinking,
  DerivedTool,
  DerivedTranscript,
  DerivedTurn,
  DroppedRecord,
  TranscriptPending,
  TranscriptUnreadable,
  TurnSpeaker,
  UnshownValue,
} from '../contracts/derived.ts';

// ---- JSON over bytes ---------------------------------------------------------------------------------------------------

/** A JSON value and the bytes it was read from. A string's range is its token, quotes included. */
export type JsonValue = JsonObject | JsonArray | JsonString | JsonAtom;
export interface JsonObject {
  readonly k: 'o';
  readonly s: number;
  e: number;
  readonly keys: JsonString[];
  readonly vals: JsonValue[];
}
export interface JsonArray {
  readonly k: 'a';
  readonly s: number;
  e: number;
  readonly items: JsonValue[];
}
export interface JsonString {
  readonly k: 's';
  readonly s: number;
  readonly e: number;
  /** The token holds a backslash escape. */
  readonly esc: boolean;
  /** The token holds a byte of 0x80 or more. */
  readonly high: boolean;
}
export interface JsonAtom {
  readonly k: 'n' | 't' | 'f' | 'z';
  readonly s: number;
  readonly e: number;
}

const isWs = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isHex = (c: number): boolean => isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);

function skipWs(b: Uint8Array, i: number, e: number): number {
  while (i < e && isWs(b[i]!)) i++;
  return i;
}

let stringEsc = false;
let stringHigh = false;
/** The end (one past the closing quote) of the string token at `i`, or -1. Sets `stringEsc` and `stringHigh`. */
function scanString(b: Uint8Array, i: number, e: number): number {
  let esc = false;
  let high = false;
  let j = i + 1;
  while (j < e) {
    const c = b[j]!;
    if (c === 0x22) {
      stringEsc = esc;
      stringHigh = high;
      return j + 1;
    }
    if (c === 0x5c) {
      esc = true;
      if (j + 1 >= e) return -1;
      const n = b[j + 1]!;
      if (n === 0x75) {
        if (j + 6 > e || !isHex(b[j + 2]!) || !isHex(b[j + 3]!) || !isHex(b[j + 4]!) || !isHex(b[j + 5]!)) return -1;
        j += 6;
        continue;
      }
      // " \ / b f n r t
      if (n === 0x22 || n === 0x5c || n === 0x2f || n === 0x62 || n === 0x66 || n === 0x6e || n === 0x72 || n === 0x74) {
        j += 2;
        continue;
      }
      return -1;
    }
    // A raw control character is not allowed in a JSON string; a byte of 0x80 or more decodes to a character that is.
    if (c < 0x20) return -1;
    if (c >= 0x80) high = true;
    j++;
  }
  return -1;
}

/** The end of the number at `i`, by JSON's grammar, or -1. */
function scanNumber(b: Uint8Array, i: number, e: number): number {
  let j = i;
  if (b[j] === 0x2d) j++;
  if (j >= e) return -1;
  if (b[j] === 0x30) j++;
  else if (b[j]! >= 0x31 && b[j]! <= 0x39) while (j < e && isDigit(b[j]!)) j++;
  else return -1;
  if (j < e && b[j] === 0x2e) {
    j++;
    if (j >= e || !isDigit(b[j]!)) return -1;
    while (j < e && isDigit(b[j]!)) j++;
  }
  if (j < e && (b[j] === 0x65 || b[j] === 0x45)) {
    j++;
    if (j < e && (b[j] === 0x2b || b[j] === 0x2d)) j++;
    if (j >= e || !isDigit(b[j]!)) return -1;
    while (j < e && isDigit(b[j]!)) j++;
  }
  return j;
}

function literalAt(b: Uint8Array, i: number, e: number, word: string): boolean {
  if (i + word.length > e) return false;
  for (let k = 0; k < word.length; k++) if (b[i + k] !== word.charCodeAt(k)) return false;
  return true;
}

/**
 * The JSON value `bytes[s, e)` holds, with whitespace around it, or null when those bytes are not exactly one JSON value.
 * Iterative, so a line nested a million deep is read, not a stack overflow. A byte of 0x80 or more is allowed only inside
 * a string, which is where `JSON.parse` over the line's UTF-8 decoding allows the character it becomes.
 */
export function parseJsonBytes(b: Uint8Array, s: number, e: number): JsonValue | null {
  const stack: (JsonObject | JsonArray)[] = [];
  let i = s;
  for (;;) {
    // A value starts at i.
    i = skipWs(b, i, e);
    if (i >= e) return null;
    const c = b[i]!;
    let v: JsonValue;
    if (c === 0x7b) {
      const o: JsonObject = { k: 'o', s: i, e: -1, keys: [], vals: [] };
      i = skipWs(b, i + 1, e);
      if (i < e && b[i] === 0x7d) {
        o.e = i + 1;
        i++;
        v = o;
      } else {
        if (i >= e || b[i] !== 0x22) return null;
        const end = scanString(b, i, e);
        if (end < 0) return null;
        o.keys.push({ k: 's', s: i, e: end, esc: stringEsc, high: stringHigh });
        i = skipWs(b, end, e);
        if (i >= e || b[i] !== 0x3a) return null;
        i++;
        stack.push(o);
        continue;
      }
    } else if (c === 0x5b) {
      const a: JsonArray = { k: 'a', s: i, e: -1, items: [] };
      i = skipWs(b, i + 1, e);
      if (i < e && b[i] === 0x5d) {
        a.e = i + 1;
        i++;
        v = a;
      } else {
        stack.push(a);
        continue;
      }
    } else if (c === 0x22) {
      const end = scanString(b, i, e);
      if (end < 0) return null;
      v = { k: 's', s: i, e: end, esc: stringEsc, high: stringHigh };
      i = end;
    } else if (c === 0x2d || isDigit(c)) {
      const end = scanNumber(b, i, e);
      if (end < 0) return null;
      v = { k: 'n', s: i, e: end };
      i = end;
    } else if (literalAt(b, i, e, 'true')) {
      v = { k: 't', s: i, e: i + 4 };
      i += 4;
    } else if (literalAt(b, i, e, 'false')) {
      v = { k: 'f', s: i, e: i + 5 };
      i += 5;
    } else if (literalAt(b, i, e, 'null')) {
      v = { k: 'z', s: i, e: i + 4 };
      i += 4;
    } else return null;
    // Attach v to its container and close what it closes; stop at the next value to read.
    for (;;) {
      const top = stack[stack.length - 1];
      if (top === undefined) {
        return skipWs(b, i, e) === e ? v : null;
      }
      if (top.k === 'o') top.vals.push(v);
      else top.items.push(v);
      i = skipWs(b, i, e);
      if (i >= e) return null;
      const d = b[i]!;
      if (d === 0x2c) {
        i = skipWs(b, i + 1, e);
        if (top.k === 'o') {
          if (i >= e || b[i] !== 0x22) return null;
          const end = scanString(b, i, e);
          if (end < 0) return null;
          top.keys.push({ k: 's', s: i, e: end, esc: stringEsc, high: stringHigh });
          i = skipWs(b, end, e);
          if (i >= e || b[i] !== 0x3a) return null;
          i++;
        }
        break;
      }
      if ((top.k === 'o' && d === 0x7d) || (top.k === 'a' && d === 0x5d)) {
        top.e = i + 1;
        i++;
        stack.pop();
        v = top;
        continue;
      }
      return null;
    }
  }
}

// ---- decoding a string token --------------------------------------------------------------------------------------------

const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });

/** Whether `b[s, e)` is valid UTF-8 (the WHATWG decoder's rules). */
function validUtf8(b: Uint8Array, s: number, e: number): boolean {
  let i = s;
  while (i < e) {
    const c = b[i]!;
    if (c < 0x80) {
      i++;
      continue;
    }
    let need: number;
    let lo = 0x80;
    let hi = 0xbf;
    if (c >= 0xc2 && c <= 0xdf) need = 1;
    else if (c >= 0xe0 && c <= 0xef) {
      need = 2;
      if (c === 0xe0) lo = 0xa0;
      if (c === 0xed) hi = 0x9f;
    } else if (c >= 0xf0 && c <= 0xf4) {
      need = 3;
      if (c === 0xf0) lo = 0x90;
      if (c === 0xf4) hi = 0x8f;
    } else return false;
    i++;
    for (let k = 0; k < need; k++, i++) {
      if (i >= e) return false;
      const n = b[i]!;
      if (n < lo || n > hi) return false;
      lo = 0x80;
      hi = 0xbf;
    }
  }
  return true;
}

/**
 * `b[s, e)` decoded as the WHATWG UTF-8 decoder does, with the UTF-16 offset of every U+FFFD it put in place of an
 * invalid sequence (a U+FFFD the bytes spell, `EF BF BD`, is not one of them).
 */
function decodeUtf8Marking(b: Uint8Array, s: number, e: number): { text: string; marks: number[] } {
  const out: string[] = [];
  const marks: number[] = [];
  let length = 0;
  let cp = 0;
  let need = 0;
  let seen = 0;
  let lo = 0x80;
  let hi = 0xbf;
  const emit = (code: number): void => {
    const ch = String.fromCodePoint(code);
    out.push(ch);
    length += ch.length;
  };
  const replace = (): void => {
    marks.push(length);
    out.push('�');
    length += 1;
  };
  for (let i = s; i < e; i++) {
    const c = b[i]!;
    if (need === 0) {
      if (c <= 0x7f) emit(c);
      else if (c >= 0xc2 && c <= 0xdf) {
        need = 1;
        cp = c & 0x1f;
      } else if (c >= 0xe0 && c <= 0xef) {
        if (c === 0xe0) lo = 0xa0;
        if (c === 0xed) hi = 0x9f;
        need = 2;
        cp = c & 0x0f;
      } else if (c >= 0xf0 && c <= 0xf4) {
        if (c === 0xf0) lo = 0x90;
        if (c === 0xf4) hi = 0x8f;
        need = 3;
        cp = c & 0x07;
      } else replace();
      continue;
    }
    if (c < lo || c > hi) {
      cp = 0;
      need = 0;
      seen = 0;
      lo = 0x80;
      hi = 0xbf;
      replace();
      i--; // the byte is read again as the start of what follows
      continue;
    }
    lo = 0x80;
    hi = 0xbf;
    cp = (cp << 6) | (c & 0x3f);
    seen++;
    if (seen === need) {
      emit(cp);
      cp = 0;
      need = 0;
      seen = 0;
    }
  }
  if (need !== 0) replace();
  return { text: out.join(''), marks };
}

const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * `text` (a string token's body, decoded) with its JSON escapes read as `JSON.parse` reads them; `marks`, offsets in
 * `text`, are carried through to offsets in the result. A `\uXXXX` is one UTF-16 unit, so a lone surrogate stays one.
 */
function unescapeJson(text: string, marks: readonly number[]): { value: string; replaced: number[] } {
  if (text.indexOf('\\') < 0) return { value: text, replaced: [...marks] };
  const parts: string[] = [];
  const replaced: number[] = [];
  let m = 0;
  let length = 0;
  let i = 0;
  const copy = (to: number): void => {
    // Marks in [i, to) land at their place in the copied run.
    while (m < marks.length && marks[m]! < to) {
      replaced.push(length + (marks[m]! - i));
      m++;
    }
    parts.push(text.slice(i, to));
    length += to - i;
  };
  for (;;) {
    const at = text.indexOf('\\', i);
    if (at < 0) {
      copy(text.length);
      break;
    }
    copy(at);
    const n = text[at + 1]!;
    if (n === 'u') {
      parts.push(String.fromCharCode(Number.parseInt(text.slice(at + 2, at + 6), 16)));
      length += 1;
      i = at + 6;
    } else {
      parts.push(ESCAPES[n]!);
      length += 1;
      i = at + 2;
    }
  }
  return { value: parts.join(''), replaced };
}

/** The decoding of a string token: its value, and where the UTF-8 decoding put a U+FFFD of its own. */
export function decodeJsonString(b: Uint8Array, token: JsonString | { s: number; e: number; esc?: boolean; high?: boolean }): { value: string; replaced: number[] } {
  const s = token.s + 1;
  const e = token.e - 1;
  const high = token.high ?? true;
  const esc = token.esc ?? true;
  if (!high || validUtf8(b, s, e)) {
    const text = utf8.decode(b.subarray(s, e));
    return esc ? unescapeJson(text, []) : { value: text, replaced: [] };
  }
  const { text, marks } = decodeUtf8Marking(b, s, e);
  return unescapeJson(text, marks);
}

/** Whether `value` holds a UTF-16 unit of a surrogate pair standing alone. */
export function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = value.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) {
        i++;
        continue;
      }
      return true;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

// ---- reading records ----------------------------------------------------------------------------------------------------

/** Whether string token `t` is exactly the ASCII word `name` (decoded, so an escaped spelling of it counts). */
function keyIs(b: Uint8Array, t: JsonString, name: string): boolean {
  if (!t.esc && !t.high) {
    if (t.e - t.s - 2 !== name.length) return false;
    for (let k = 0; k < name.length; k++) if (b[t.s + 1 + k] !== name.charCodeAt(k)) return false;
    return true;
  }
  return decodeJsonString(b, t).value === name;
}

/** The value of key `name` in `o` (the last one, as `JSON.parse` keeps), or undefined. */
function field(b: Uint8Array, o: JsonValue | undefined, name: string): JsonValue | undefined {
  if (o === undefined || o.k !== 'o') return undefined;
  for (let k = o.keys.length - 1; k >= 0; k--) if (keyIs(b, o.keys[k]!, name)) return o.vals[k];
  return undefined;
}

/** A short string field's decoded value (a type, a role, a name, an id), or undefined. */
function str(b: Uint8Array, v: JsonValue | undefined): string | undefined {
  return v !== undefined && v.k === 's' ? decodeJsonString(b, v).value : undefined;
}

/** Record types a session holds that are not conversation, and which the deriver knows to leave out. */
export const KNOWN_RECORDS: ReadonlySet<string> = new Set([
  'summary',
  'system',
  'developer',
  'file-history-snapshot',
  'queue-operation',
  'progress',
  'custom-title',
  'user',
  'assistant',
  'blank',
]);

// ---- the tree, built as it is read ---------------------------------------------------------------------------------------

type Writable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };
type WText = Writable<DerivedText>;
type WTool = Writable<DerivedTool> & { children: DerivedText[]; from: Source[]; unshown: UnshownValue[] };
type WThinking = Writable<DerivedThinking>;
type WTurn = Writable<DerivedTurn> & { children: (DerivedText | DerivedTool | DerivedThinking)[]; from: Source[]; unshown: UnshownValue[] };
type WTranscript = Writable<DerivedTranscript> & {
  from: Source[];
  children: (DerivedTurn | TranscriptUnreadable | TranscriptPending)[];
  dropped: DroppedRecord[];
};

export interface TranscriptDeriver {
  /** The tree as far as it has been read. It grows in place with each `step`; its last child may still grow. */
  readonly tree: DerivedTranscript;
  /** Reads lines until about `budgetBytes` more bytes are read (at least one line). True when the whole file is read. */
  step(budgetBytes: number): boolean;
  readonly done: boolean;
  /** How many steps have read lines. */
  readonly slices: number;
  /** Bytes read so far. */
  readonly bytesRead: number;
  /** Lines read so far. */
  readonly lines: number;
  /** How many of the root's children are final: every one but the last until the file is read, then all. */
  readonly settled: number;
  /**
   * The bytes grew (ADR-0061 item 8: an agent appends to its log): reads on from where `bytes` still agrees with `next`, so
   * only the new lines are derived. An unfinished last line is read again, its effect on the tree undone first. Returns
   * the number of root children that kept their place and content (rows the view may keep), or -1 when `next` does not
   * begin with every byte this deriver has relied on, so the tree must be derived again from the start.
   */
  extend(next: Uint8Array): number;
}

/** The first `n` bytes a step reads by default: more than a screen of turns. */
export const FIRST_SLICE_BYTES = 64 * 1024;

/**
 * A deriver over `bytes`, read a slice of lines per `step`. `file` names the file in every `Source`. A leading UTF-8
 * byte-order mark is read as part of the first line and skipped before its JSON.
 */
export function createTranscriptDeriver(bytes: Uint8Array, file: string): TranscriptDeriver {
  let b = bytes;
  let n = b.length;
  const src = (start: number, end: number): Source => ({ file, start, end });
  const tree: WTranscript = {
    type: 'transcript',
    deriver: 'jsonl-transcript',
    src: src(0, 0),
    from: [],
    children: [],
    dropped: [],
  };
  let at = 0;
  let line = 0;
  let slices = 0;
  /** The turn the next message of its speaker joins; null after an unreadable line. */
  let turn: WTurn | null = null;
  /** The calls of the current agent turn without a result yet, by id. */
  let open = new Map<string, WTool>();

  const closeTurn = (): void => {
    turn = null;
    open = new Map();
  };
  const hull = (from: readonly Source[]): Source => src(from[0]!.start, from[from.length - 1]!.end);

  /** The turn of `speaker` that the line `lineSrc` adds to: the current one, or a new one. */
  const turnFor = (speaker: TurnSpeaker, lineSrc: Source): WTurn => {
    if (turn === null || turn.speaker !== speaker) {
      closeTurn();
      const fresh: WTurn = { type: 'turn', speaker, src: lineSrc, from: [], children: [], unshown: [] };
      tree.children.push(fresh);
      turn = fresh;
    }
    const t = turn;
    const last = t.from[t.from.length - 1];
    if (last === undefined || last.start !== lineSrc.start) t.from.push(lineSrc);
    t.src = hull(t.from);
    return t;
  };

  const leaf = (token: JsonString, role: DerivedTextRole, syntax: 'markdown' | 'plain', key?: string): DerivedText => {
    const { value, replaced } = decodeJsonString(b, token);
    // Only well-formed text from valid UTF-8 is read as Markdown (ADR-0061 item 3).
    const plain = replaced.length > 0 || hasLoneSurrogate(value);
    const s = src(token.s, token.e);
    const made: WText = { type: 'derivedText', src: s, from: [s], value, decoding: 'json-string', syntax: plain ? 'plain' : syntax, role, replaced };
    if (key !== undefined) made.key = key;
    return made;
  };

  /** What a value is, for a count: its block's `type` when it is an object that names one, else its JSON kind. */
  const whatOf = (v: JsonValue): string => {
    if (v.k === 'o') return str(b, field(b, v, 'type')) ?? 'object';
    return v.k === 'a' ? 'array' : v.k === 'n' ? 'number' : v.k === 'z' ? 'null' : v.k === 's' ? 'string' : 'boolean';
  };
  const unshownOf = (v: JsonValue, key?: string): UnshownValue => {
    const u: { src: Source; what: string; key?: string } = { src: src(v.s, v.e), what: whatOf(v) };
    if (key !== undefined) u.key = key;
    return u;
  };

  /** The text leaves of a result's `content`: a string, or an array of text blocks (and strings); the rest into `unshown`. */
  const contentLeaves = (content: JsonValue | undefined, role: DerivedTextRole, syntax: 'markdown' | 'plain', unshown: UnshownValue[]): DerivedText[] => {
    if (content === undefined) return [];
    if (content.k === 's') return [leaf(content, role, syntax)];
    if (content.k !== 'a') return [];
    const out: DerivedText[] = [];
    for (const item of content.items) {
      if (item.k === 's') out.push(leaf(item, role, syntax));
      else {
        const t = item.k === 'o' && str(b, field(b, item, 'type')) === 'text' ? field(b, item, 'text') : undefined;
        if (t?.k === 's') out.push(leaf(t, role, syntax));
        else unshown.push(unshownOf(item));
      }
    }
    return out;
  };

  /** A tool result block (`tool_result`), or a `role: tool` line's object: joined to its call, or a unit of its own. */
  const result = (block: JsonObject, id: string | undefined, lineSrc: Source): number => {
    const unshown: UnshownValue[] = [];
    const leaves = contentLeaves(field(b, block, 'content'), 'tool-output', 'plain', unshown);
    if (leaves.length === 0) return 0;
    const failed = field(b, block, 'is_error')?.k === 't';
    const call = id === undefined ? undefined : open.get(id);
    if (call !== undefined && turn !== null) {
      open.delete(id!);
      turnFor('agent', lineSrc);
      call.from.push(src(block.s, block.e));
      call.src = hull(call.from);
      call.children.push(...leaves);
      call.unshown.push(...unshown);
      call.answered = true;
      call.failed = failed;
      return leaves.length;
    }
    const t = turnFor('agent', lineSrc);
    const s = src(block.s, block.e);
    const unit: WTool = { type: 'tool', src: s, from: [s], children: leaves, answered: true, orphan: true, failed, unshown };
    t.children.push(unit);
    return leaves.length;
  };

  /**
   * The blocks of one message; returns how many leaves it made. A block that is not text, thinking or a tool is counted in
   * the turn's `unshown`. In a prompt, a tool's result is read before the prompt's own text: it answers a call of the turn
   * before, which the prompt's turn would otherwise close.
   */
  const message = (speaker: TurnSpeaker, content: JsonValue | undefined, lineSrc: Source): number => {
    if (content === undefined) return 0;
    const textSyntax = speaker === 'agent' ? 'markdown' : 'plain';
    if (content.k === 's') {
      turnFor(speaker, lineSrc).children.push(leaf(content, 'text', textSyntax));
      return 1;
    }
    if (content.k !== 'a') return 0;
    let made = 0;
    const unshown: UnshownValue[] = [];
    const kindOf = (block: JsonValue): string | undefined => (block.k === 'o' ? str(b, field(b, block, 'type')) : undefined);
    const results = speaker === 'you' ? content.items.filter((block) => kindOf(block) === 'tool_result') : [];
    for (const block of results) made += result(block as JsonObject, str(b, field(b, block, 'tool_use_id')), lineSrc);
    for (const block of content.items) {
      if (block.k === 's') {
        turnFor(speaker, lineSrc).children.push(leaf(block, 'text', textSyntax));
        made++;
        continue;
      }
      const kind = kindOf(block);
      if (block.k !== 'o') {
        unshown.push(unshownOf(block));
        continue;
      }
      if (kind === 'tool_result') {
        if (speaker !== 'you') made += result(block, str(b, field(b, block, 'tool_use_id')), lineSrc);
        continue;
      }
      if (kind === 'text') {
        const t = field(b, block, 'text');
        if (t?.k !== 's') {
          unshown.push(unshownOf(block));
          continue;
        }
        turnFor(speaker, lineSrc).children.push(leaf(t, 'text', textSyntax));
        made++;
      } else if (kind === 'thinking' && speaker === 'agent' && field(b, block, 'thinking')?.k === 's') {
        const t = field(b, block, 'thinking') as JsonString;
        const s = src(block.s, block.e);
        const node: WThinking = { type: 'thinking', src: s, from: [s], children: [leaf(t, 'thinking', 'markdown')] };
        turnFor('agent', lineSrc).children.push(node);
        made++;
      } else if (kind === 'tool_use' && speaker === 'agent' && field(b, block, 'name')?.k === 's') {
        const name = field(b, block, 'name') as JsonString;
        const children: DerivedText[] = [leaf(name, 'tool-name', 'plain')];
        const inputs: UnshownValue[] = [];
        const input = field(b, block, 'input');
        if (input?.k === 'o') {
          for (let k = 0; k < input.keys.length; k++) {
            const v = input.vals[k]!;
            const key = decodeJsonString(b, input.keys[k]!).value;
            if (v.k === 's') children.push(leaf(v, 'tool-input', 'plain', key));
            else inputs.push(unshownOf(v, key));
          }
        } else if (input !== undefined) inputs.push(unshownOf(input, 'input'));
        const s = src(block.s, block.e);
        const unit: WTool = { type: 'tool', src: s, from: [s], children, answered: false, orphan: false, failed: false, unshown: inputs };
        turnFor('agent', lineSrc).children.push(unit);
        const id = str(b, field(b, block, 'id'));
        if (id !== undefined && !open.has(id)) open.set(id, unit);
        made += children.length;
      } else unshown.push(unshownOf(block));
    }
    // Counted on the turn the line went into; a line that showed nothing is dropped and counted as a whole instead.
    const into = turn as WTurn | null;
    if (made > 0 && into !== null && unshown.length > 0) into.unshown.push(...unshown);
    return made;
  };

  const drop = (lineSrc: Source, record: string, known: boolean): void => {
    tree.dropped.push({ src: lineSrc, record, known, line });
  };

  /** One line, `[start, end)` with its newline (`body` ends before it). */
  const readLine = (start: number, body: number, end: number, last: boolean): void => {
    line++;
    const lineSrc = src(start, end);
    tree.from.push(lineSrc);
    // A byte-order mark before the first line's JSON is the file's, not the line's value.
    const from = start === 0 && body >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : start;
    if (skipWs(b, from, body) === body) {
      drop(lineSrc, 'blank', true);
      return;
    }
    const value = parseJsonBytes(b, from, body);
    if (value === null) {
      closeTurn();
      if (last && end === n && (end === 0 || b[end - 1] !== 0x0a)) {
        const pending: TranscriptPending = { type: 'pending', src: lineSrc, from: [lineSrc], line };
        tree.children.push(pending);
      } else {
        const unreadable: TranscriptUnreadable = { type: 'unreadable', src: lineSrc, from: [lineSrc], line };
        tree.children.push(unreadable);
      }
      return;
    }
    if (value.k !== 'o') {
      drop(lineSrc, '(not an object)', false);
      return;
    }
    const type = str(b, field(b, value, 'type'));
    const msg = field(b, value, 'message');
    const role = str(b, field(b, msg, 'role')) ?? str(b, field(b, value, 'role'));
    const content = field(b, msg, 'content') ?? field(b, value, 'content');
    const record = type ?? role ?? '(no type)';
    let made = 0;
    if (role === 'user' && (type === undefined || type === 'user' || msg !== undefined)) made = message('you', content, lineSrc);
    else if (role === 'assistant' && (type === undefined || type === 'assistant' || msg !== undefined)) made = message('agent', content, lineSrc);
    else if (role === 'tool' && type === undefined) made = result(value, str(b, field(b, value, 'tool_call_id')), lineSrc);
    else {
      drop(lineSrc, record, KNOWN_RECORDS.has(record));
      return;
    }
    // A message with no text (an image alone, redacted thinking) is a known record left out, and counted.
    if (made === 0) drop(lineSrc, record, true);
  };

  /**
   * What reading the unfinished last line (no newline) changed, kept so that line can be read again once more bytes come
   * (`extend`): the lengths of every list it can grow, the turn and the open calls it can change, and the calls' fields.
   */
  interface Before {
    readonly at: number;
    readonly line: number;
    readonly from: number;
    readonly dropped: number;
    readonly children: number;
    readonly turn: WTurn | null;
    readonly turnState: { from: number; children: number; unshown: number; src: Source } | null;
    readonly open: Map<string, WTool>;
    readonly calls: { tool: WTool; from: number; children: number; unshown: number; src: Source; answered: boolean; failed: boolean }[];
  }
  let before: Before | null = null;
  const remember = (): Before => ({
    at,
    line,
    from: tree.from.length,
    dropped: tree.dropped.length,
    children: tree.children.length,
    turn,
    turnState: turn ? { from: turn.from.length, children: turn.children.length, unshown: turn.unshown.length, src: turn.src } : null,
    open: new Map(open),
    calls: [...open.values()].map((tool) => ({ tool, from: tool.from.length, children: tool.children.length, unshown: tool.unshown.length, src: tool.src, answered: tool.answered, failed: tool.failed })),
  });
  const undo = (k: Before): void => {
    at = k.at;
    line = k.line;
    tree.from.length = k.from;
    tree.dropped.length = k.dropped;
    tree.children.length = k.children;
    turn = k.turn;
    if (turn && k.turnState) {
      turn.from.length = k.turnState.from;
      turn.children.length = k.turnState.children;
      turn.unshown.length = k.turnState.unshown;
      turn.src = k.turnState.src;
    }
    open = new Map(k.open);
    for (const c of k.calls) {
      c.tool.from.length = c.from;
      c.tool.children.length = c.children;
      c.tool.unshown.length = c.unshown;
      c.tool.src = c.src;
      c.tool.answered = c.answered;
      c.tool.failed = c.failed;
    }
    tree.src = src(0, at);
  };

  const step = (budgetBytes: number): boolean => {
    if (at >= n) return true;
    slices++;
    const stop = at + Math.max(1, budgetBytes);
    while (at < n) {
      let nl = b.indexOf(0x0a, at);
      const last = nl < 0;
      if (last) nl = n;
      const end = last ? n : nl + 1;
      if (last) before = remember();
      readLine(at, nl, end, last);
      at = end;
      tree.src = src(0, at);
      if (at >= stop) break;
    }
    // The turn and the open calls are kept at the end of the bytes: an appended line joins the turn it continues.
    return at >= n;
  };

  const extend = (next: Uint8Array): number => {
    // The bytes the tree relied on: every line read whole, and not the unfinished last one, which is read again.
    const keep = before !== null && at >= n ? before.at : at;
    if (next.length < keep) return -1;
    if (next !== b) {
      for (let i = 0; i < keep; i++) if (next[i] !== b[i]) return -1;
    }
    let kept = tree.children.length;
    if (before !== null && at >= n) {
      undo(before);
      kept = tree.children.length;
    }
    before = null;
    b = next;
    n = next.length;
    // The last row may still grow with the lines that follow (a turn the new lines continue).
    return turn !== null && tree.children[tree.children.length - 1] === turn ? Math.max(0, kept - 1) : kept;
  };

  return {
    tree,
    step,
    extend,
    get done() {
      return at >= n;
    },
    get slices() {
      return slices;
    },
    get bytesRead() {
      return at;
    },
    get lines() {
      return line;
    },
    get settled() {
      return at >= n ? tree.children.length : Math.max(0, tree.children.length - 1);
    },
  };
}

/** The whole tree of `bytes`, read at once. */
export function deriveTranscript(bytes: Uint8Array, file: string): DerivedTranscript {
  const d = createTranscriptDeriver(bytes, file);
  while (!d.step(Number.MAX_SAFE_INTEGER)) {
    /* read on */
  }
  return d.tree;
}

/** Whether `path` names a file this deriver reads (a `.jsonl`); the kind must also be `transcript` for Read to use it. */
export const derivesTranscript = (path: string | null | undefined): boolean => path != null && /\.jsonl$/i.test(path);

/** The 1-based line holding byte `at` (the last line for `at` past the end). */
export function lineOfByte(tree: DerivedTranscript, at: number): number {
  const lines = tree.from;
  let lo = 0;
  let hi = lines.length - 1;
  if (hi < 0) return 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid]!.start <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** The first byte of the line holding byte `at`. */
export function lineStartOf(tree: DerivedTranscript, at: number): number {
  return tree.from[lineOfByte(tree, at) - 1]?.start ?? 0;
}
