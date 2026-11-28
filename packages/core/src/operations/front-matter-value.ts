// The front matter's top-level keys and their scalar values, read from the document's bytes for the Metadata tab. Pure: bytes
// in, a list out. Nothing is written: a value is changed in Source, as bytes.
//
// What is a scalar here: one line, `key: value` (YAML) or `key = value` (TOML), where the value is a plain word (YAML) or a
// bare literal (TOML), or one pair of quotes on that line. Anything else is listed as written with the reason it is not read as
// a scalar: a `|` or `>` block, an anchor, an alias, a tag, a flow list or mapping, a value that runs over several lines, an
// empty value, a key that appears twice, a TOML array, inline table or multi-line string, and every key below a TOML `[table]`.
// A front matter with a line this reader does not understand is `unreadable` as a whole.
import type { Document } from '../contracts/ast.ts';
import { utf8Length } from '../util/count.ts';

export type Quoting = 'plain' | 'double' | 'single';
export type FrontMatterFormat = 'yaml' | 'toml';

/** One top-level key of the front matter, as the Metadata tab lists it. */
export interface FrontMatterValue {
  readonly key: string;
  /** The value as a reader reads it: a quoted one unquoted and unescaped, anything else as written (a longer one over lines). */
  readonly value: string;
  /** How the value is written, when it is one scalar on one line. */
  readonly quoting: Quoting | null;
  /** 1-based line in the file where the key is, and the byte offset of that line's start. */
  readonly line: number;
  readonly lineStart: number;
  /** Why the value is not read as one scalar, or null when it is. */
  readonly refusal: string | null;
}

export interface FrontMatterValues {
  readonly format: FrontMatterFormat;
  readonly values: readonly FrontMatterValue[];
  /** Set when a line was not understood, so no value is read as a scalar; every value then carries it as its refusal. */
  readonly unreadable: string | null;
}

interface Entry {
  readonly key: string;
  readonly line: number;
  readonly value: string;
  readonly quoting: Quoting | null;
  /** UTF-16 range of the token inside the block, when the value is one scalar. */
  readonly token: { readonly from: number; readonly to: number } | null;
  readonly refusal: string | null;
}

interface Scan {
  readonly format: FrontMatterFormat;
  readonly entries: readonly Entry[];
  readonly lineStarts: readonly number[];
  readonly unreadable: string | null;
}

interface Ln {
  readonly text: string;
  readonly at: number;
}

// ---- reading the block ----------------------------------------------------------------------------------------------------

function splitLines(block: string): Ln[] {
  const out: Ln[] = [];
  let pos = 0;
  for (const m of block.matchAll(/\r\n|\r|\n/g)) {
    out.push({ text: block.slice(pos, m.index), at: pos });
    pos = m.index + m[0].length;
  }
  out.push({ text: block.slice(pos), at: pos });
  return out;
}

const blank = (t: string): boolean => t.trim() === '';
const WS = /[ \t]/;

function dedent(text: string): string {
  const lines = text.split(/\r\n|\r|\n/);
  let min = Infinity;
  for (const l of lines) if (!blank(l)) min = Math.min(min, /^[ \t]*/.exec(l)![0].length);
  if (!Number.isFinite(min) || min === 0) return lines.join('\n');
  return lines.map((l) => l.slice(Math.min(min, /^[ \t]*/.exec(l)![0].length))).join('\n');
}

/** Whether a quote or a bracket may begin a node right after `before` (the text of the line before it). */
function startsNode(before: string): boolean {
  const t = before.trimEnd();
  return t === '' || /[:\-?,[{]$/.test(t) || /(^|\s)[&!][^\s]*$/.test(t);
}

/** The YAML double-quoted escapes this reader knows; null for any other. */
function decodeYamlDouble(inner: string): string | null {
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = inner[++i];
    const simple: Record<string, string> = { '0': '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\u0085', _: '\u00a0', L: '\u2028', P: '\u2029' };
    if (e !== undefined && e in simple) out += simple[e];
    else if (e === 'x' || e === 'u' || e === 'U') {
      const width = e === 'x' ? 2 : e === 'u' ? 4 : 8;
      const hex = inner.slice(i + 1, i + 1 + width);
      if (hex.length !== width || !/^[0-9a-fA-F]+$/.test(hex)) return null;
      const cp = Number.parseInt(hex, 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
      out += String.fromCodePoint(cp);
      i += width;
    } else return null;
  }
  return out;
}

/** The TOML basic-string escapes this reader knows; null for any other. */
function decodeTomlBasic(inner: string): string | null {
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = inner[++i];
    const simple: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };
    if (e !== undefined && e in simple) out += simple[e];
    else if (e === 'u' || e === 'U') {
      const width = e === 'u' ? 4 : 8;
      const hex = inner.slice(i + 1, i + 1 + width);
      if (hex.length !== width || !/^[0-9a-fA-F]+$/.test(hex)) return null;
      const cp = Number.parseInt(hex, 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
      out += String.fromCodePoint(cp);
      i += width;
    } else return null;
  }
  return out;
}

const TOML_BARE =
  /^(?:true|false|[-+]?(?:inf|nan)|[-+]?(?:0|[1-9](?:_?[0-9])*)(?:\.[0-9](?:_?[0-9])*)?(?:[eE][-+]?[0-9](?:_?[0-9])*)?|[-+]?0x[0-9a-fA-F](?:_?[0-9a-fA-F])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*|[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[Tt ][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:[Zz]|[-+][0-9]{2}:[0-9]{2})?)?|[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?)$/;

// ---- YAML -----------------------------------------------------------------------------------------------------------------

const YAML_KEY_DOUBLE = /^"((?:[^"\\]|\\.)*)"[ \t]*:(?=[ \t]|$)/;
const YAML_KEY_SINGLE = /^'((?:[^']|'')*)'[ \t]*:(?=[ \t]|$)/;
const YAML_KEY_BARE = /^((?:[^\s"'#[\]{},&*!|>%@`:?-]|[-?:][^\s])[^\n]*?)[ \t]*:(?=[ \t]|$)/;

/** Where a quote opened at (line, col) closes: the line and the column after it, or null when the block ends first. */
function closeQuote(lines: readonly Ln[], line: number, col: number, end: number, quote: '"' | "'"): { line: number; col: number } | null {
  for (let l = line; l < end; l++) {
    const t = lines[l]!.text;
    for (let c = l === line ? col : 0; c < t.length; c++) {
      const ch = t[c]!;
      if (quote === '"') {
        if (ch === '\\') c++;
        else if (ch === '"') return { line: l, col: c + 1 };
      } else if (ch === "'") {
        if (t[c + 1] === "'") c++;
        else return { line: l, col: c + 1 };
      }
    }
  }
  return null;
}

/** Where a YAML flow collection opened at (line, col) closes, or null when the block ends first. */
function closeFlow(lines: readonly Ln[], line: number, col: number, end: number): { line: number; col: number } | null {
  let depth = 0;
  let quote = '';
  for (let l = line; l < end; l++) {
    const t = lines[l]!.text;
    for (let c = l === line ? col : 0; c < t.length; c++) {
      const ch = t[c]!;
      if (quote === '"') {
        if (ch === '\\') c++;
        else if (ch === '"') quote = '';
      } else if (quote === "'") {
        if (ch === "'") {
          if (t[c + 1] === "'") c++;
          else quote = '';
        }
      } else if (ch === '#' && (c === 0 || WS.test(t[c - 1]!))) break;
      else if ((ch === '"' || ch === "'") && startsNode(t.slice(0, c))) quote = ch;
      else if (ch === '[' || ch === '{') depth++;
      else if ((ch === ']' || ch === '}') && depth > 0) {
        depth--;
        if (depth === 0) return { line: l, col: c + 1 };
      }
    }
  }
  return null;
}

/** The line after the indented lines (and the blank ones between) that follow `from`; `from` itself when none does. */
function indentedRun(lines: readonly Ln[], from: number, end: number): number {
  let last = from - 1;
  for (let l = from; l < end; l++) {
    const t = lines[l]!.text;
    if (blank(t)) continue;
    if (!WS.test(t[0]!)) break;
    last = l;
  }
  return last + 1;
}

/** The line after the children of an empty value: indented lines, blank lines, comments and `- ` entries at the margin. */
function childrenRun(lines: readonly Ln[], from: number, end: number): number {
  let last = from - 1;
  for (let l = from; l < end; l++) {
    const t = lines[l]!.text;
    if (blank(t)) continue;
    if (WS.test(t[0]!) || t[0] === '#' || /^-(?:[ \t]|$)/.test(t)) last = l;
    else break;
  }
  return last + 1;
}

const lineEnd = (lines: readonly Ln[], l: number): number => lines[l]!.at + lines[l]!.text.length;

/** The tail after a value's last character: nothing, or a comment set off by a space. */
const tailOk = (tail: string): boolean => /^[ \t]*$/.test(tail) || /^[ \t]+#/.test(tail);

function scanYaml(block: string, lines: readonly Ln[], from: number, end: number): { entries: Entry[]; unreadable: string | null } {
  const entries: Entry[] = [];
  let i = from;
  const bad = (why: string): { entries: Entry[]; unreadable: string } => ({ entries, unreadable: why });
  while (i < end) {
    const t = lines[i]!.text;
    if (blank(t) || t[0] === '#') {
      i++;
      continue;
    }
    if (WS.test(t[0]!)) return bad(`line ${i + 1} is indented outside any key`);
    let key: string | undefined;
    let afterColon = 0;
    const dq = YAML_KEY_DOUBLE.exec(t);
    const sq = dq ? null : YAML_KEY_SINGLE.exec(t);
    const bare = dq || sq ? null : YAML_KEY_BARE.exec(t);
    if (dq) {
      const decoded = decodeYamlDouble(dq[1]!);
      if (decoded === null) return bad(`the key on line ${i + 1} uses an escape that is not read`);
      key = decoded;
      afterColon = dq[0].length;
    } else if (sq) {
      key = sq[1]!.replace(/''/g, "'");
      afterColon = sq[0].length;
    } else if (bare && !/[ \t]#/.test(bare[1]!)) {
      key = bare[1]!;
      afterColon = bare[0].length;
    }
    if (key === undefined) return bad(`line ${i + 1} is not a key and a value`);

    let p = afterColon;
    while (p < t.length && WS.test(t[p]!)) p++;
    const spaced = p > afterColon;
    const keyLine = i;
    const valueAt = lines[i]!.at + p;
    let refusal: string | null = null;
    let quoting: Quoting | null = null;
    let value = '';
    let token: { from: number; to: number } | null = null;
    let next = i + 1;
    // The text shown for a value that is not one scalar: from where it starts to the end of its last line.
    let showFrom = valueAt;
    let showTo = lineEnd(lines, i);
    const spans = (lastLine: number): void => {
      showTo = lineEnd(lines, lastLine);
      next = lastLine + 1;
    };

    // Node properties: an anchor or a tag in front of the value.
    let props = '';
    let q = p;
    for (;;) {
      const m = /^([&!])[^\s]*/.exec(t.slice(q));
      if (!m) break;
      if (m[1] === '&') props = 'anchor';
      else if (props === '') props = 'tag';
      q += m[0].length;
      while (q < t.length && WS.test(t[q]!)) q++;
    }
    const propsReason = props === 'anchor' ? 'It has an anchor (&name), which other keys may point at' : props === 'tag' ? 'It has a tag (!…), which says how to read it' : null;
    const c = q < t.length ? t[q]! : '';
    const tail = (from: number): string => t.slice(from);

    if (c === '' || (c === '#' && (q > afterColon || spaced))) {
      // Nothing on the line: empty, a list or a mapping below, or a block after properties.
      const last = childrenRun(lines, i + 1, end) - 1;
      if (last > i) {
        spans(last);
        showFrom = lineEnd(lines, i);
        refusal = propsReason ?? 'It is a list or a mapping, not one value';
      } else refusal = propsReason ?? 'It has no value yet; add one in Source';
    } else if (c === '"' || c === "'") {
      const closed = closeQuote(lines, i, q + 1, end, c);
      if (closed === null) return bad(`the quoted value on line ${i + 1} is never closed`);
      if (closed.line > i) {
        spans(closed.line);
        refusal = propsReason ?? 'It runs over several lines';
      } else if (!tailOk(tail(closed.col))) {
        refusal = propsReason ?? 'Text follows its closing quote';
      } else {
        const inner = t.slice(q + 1, closed.col - 1);
        const decoded = c === '"' ? decodeYamlDouble(inner) : inner.replace(/''/g, "'");
        quoting = c === '"' ? 'double' : 'single';
        value = decoded ?? inner;
        showTo = lines[i]!.at + closed.col;
        if (decoded === null) refusal = 'It uses an escape that is not read';
        else if (propsReason === null) token = { from: lines[i]!.at + q, to: lines[i]!.at + closed.col };
        else refusal = propsReason;
        showFrom = lines[i]!.at + q;
      }
    } else if (c === '|' || c === '>') {
      let last = i;
      for (let l = i + 1; l < end; l++) {
        const x = lines[l]!.text;
        if (blank(x) || WS.test(x[0]!)) last = blank(x) ? last : l;
        else break;
      }
      spans(last);
      refusal = propsReason ?? 'It is a block of text (| or >) over several lines';
    } else if (c === '[' || c === '{') {
      const closed = closeFlow(lines, i, q, end);
      if (closed === null) return bad(`the list or mapping on line ${i + 1} is never closed`);
      spans(closed.line);
      refusal = propsReason ?? (c === '[' ? 'It is a list written inline' : 'It is a mapping written inline');
    } else if (c === '*') {
      showTo = lineEnd(lines, i);
      refusal = 'It is an alias (*name) of another value';
    } else {
      // A plain word: to the end of the line or a comment set off by a space.
      let to = t.length;
      for (let x = q + 1; x < t.length; x++) {
        if (t[x] === '#' && WS.test(t[x - 1]!)) {
          to = x;
          break;
        }
      }
      const word = t.slice(q, to).trimEnd();
      value = word;
      quoting = 'plain';
      showTo = lines[i]!.at + q + word.length;
      showFrom = lines[i]!.at + q;
      if (propsReason !== null) refusal = propsReason;
      else if (/^[%@`]/.test(word)) refusal = 'It starts with a character YAML reserves';
      else if (/^[-?:](?:[ \t]|$)/.test(word)) refusal = 'It is not a plain word';
      else if (/:(?:[ \t]|$)/.test(word)) refusal = 'It holds a colon that YAML reads as a mapping';
      else {
        token = { from: lines[i]!.at + q, to: lines[i]!.at + q + word.length };
      }
    }
    // Whatever follows a single-line value on indented lines is its continuation: the value is longer than the line.
    if (next === i + 1) {
      const run = indentedRun(lines, next, end);
      if (run > next) {
        spans(run - 1);
        token = null;
        refusal = refusal ?? 'It runs over several lines';
        value = '';
        quoting = null;
        showFrom = valueAt;
      }
    }
    const shown = quoting !== null ? value : dedent(block.slice(showFrom, showTo));
    entries.push({
      key,
      line: keyLine,
      value: shown.replace(/^\n+/, ''),
      quoting: token === null ? null : quoting,
      token,
      refusal,
    });
    i = next;
  }
  return { entries, unreadable: null };
}

// ---- TOML -----------------------------------------------------------------------------------------------------------------

/** A TOML key and where its `=` ends: bare, quoted, or dotted from either. Null when the line is not a key. */
function tomlKey(t: string): { key: string; after: number } | null {
  let i = 0;
  const parts: string[] = [];
  for (;;) {
    while (i < t.length && WS.test(t[i]!)) i++;
    const c = t[i];
    if (c === '"') {
      let j = i + 1;
      while (j < t.length && t[j] !== '"') j += t[j] === '\\' ? 2 : 1;
      if (j >= t.length) return null;
      const inner = decodeTomlBasic(t.slice(i + 1, j));
      if (inner === null) return null;
      parts.push(inner);
      i = j + 1;
    } else if (c === "'") {
      const j = t.indexOf("'", i + 1);
      if (j < 0) return null;
      parts.push(t.slice(i + 1, j));
      i = j + 1;
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(t.slice(i));
      if (!m) return null;
      parts.push(m[0]);
      i += m[0].length;
    }
    while (i < t.length && WS.test(t[i]!)) i++;
    if (t[i] === '.') {
      i++;
      continue;
    }
    if (t[i] === '=') return { key: parts.join('.'), after: i + 1 };
    return null;
  }
}

/** Where a TOML array or inline table opened at (line, col) closes, or null when the block ends first. */
function closeToml(lines: readonly Ln[], line: number, col: number, end: number): number | null {
  let depth = 0;
  let quote = '';
  for (let l = line; l < end; l++) {
    const t = lines[l]!.text;
    for (let c = l === line ? col : 0; c < t.length; c++) {
      const ch = t[c]!;
      if (quote === '"') {
        if (ch === '\\') c++;
        else if (ch === '"') quote = '';
      } else if (quote === "'") {
        if (ch === "'") quote = '';
      } else if (ch === '#') break;
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '[' || ch === '{') depth++;
      else if ((ch === ']' || ch === '}') && --depth === 0) return l;
    }
    // A basic or literal string does not run past its line (the multi-line forms are read before this).
    quote = '';
  }
  return null;
}

/** The line where a TOML multi-line string opened on `line` after `col` ends, or null. */
function closeTomlTriple(lines: readonly Ln[], line: number, col: number, end: number, q: string): number | null {
  for (let l = line; l < end; l++) {
    const t = lines[l]!.text;
    let c = l === line ? col : 0;
    for (; c < t.length; c++) {
      if (q === '"' && t[c] === '\\') c++;
      else if (t.startsWith(q.repeat(3), c)) return l;
    }
  }
  return null;
}

function scanToml(block: string, lines: readonly Ln[], from: number, end: number): { entries: Entry[]; unreadable: string | null } {
  const entries: Entry[] = [];
  const bad = (why: string): { entries: Entry[]; unreadable: string } => ({ entries, unreadable: why });
  let i = from;
  while (i < end) {
    const t = lines[i]!.text;
    if (blank(t) || t[0] === '#') {
      i++;
      continue;
    }
    if (WS.test(t[0]!)) return bad(`line ${i + 1} is indented`);
    if (t[0] === '[') break; // a table: what follows is not top level
    const k = tomlKey(t);
    if (k === null) return bad(`line ${i + 1} is not a key and a value`);
    let p = k.after;
    while (p < t.length && WS.test(t[p]!)) p++;
    const c = t[p] ?? '';
    const keyLine = i;
    let refusal: string | null = null;
    let quoting: Quoting | null = null;
    let value = '';
    let token: { from: number; to: number } | null = null;
    let next = i + 1;
    let showTo = lineEnd(lines, i);
    const showFrom = lines[i]!.at + p;
    if (c === '') {
      return bad(`the key on line ${i + 1} has no value`);
    } else if (t.startsWith('"""', p) || t.startsWith("'''", p)) {
      const l = closeTomlTriple(lines, i, p + 3, end, c);
      if (l === null) return bad(`the string on line ${i + 1} is never closed`);
      next = l + 1;
      showTo = lineEnd(lines, l);
      refusal = 'It is a string over several lines';
    } else if (c === '"') {
      let j = p + 1;
      while (j < t.length && t[j] !== '"') j += t[j] === '\\' ? 2 : 1;
      if (j >= t.length) return bad(`the string on line ${i + 1} is never closed`);
      const decoded = decodeTomlBasic(t.slice(p + 1, j));
      quoting = 'double';
      value = decoded ?? t.slice(p + 1, j);
      showTo = lines[i]!.at + j + 1;
      if (!tailOk(t.slice(j + 1))) refusal = 'Text follows its closing quote';
      else if (decoded === null) refusal = 'It uses an escape that is not read';
      else token = { from: lines[i]!.at + p, to: lines[i]!.at + j + 1 };
    } else if (c === "'") {
      const j = t.indexOf("'", p + 1);
      if (j < 0) return bad(`the string on line ${i + 1} is never closed`);
      quoting = 'single';
      value = t.slice(p + 1, j);
      showTo = lines[i]!.at + j + 1;
      if (!tailOk(t.slice(j + 1))) refusal = 'Text follows its closing quote';
      else token = { from: lines[i]!.at + p, to: lines[i]!.at + j + 1 };
    } else if (c === '[' || c === '{') {
      const l = closeToml(lines, i, p, end);
      if (l === null) return bad(`the ${c === '[' ? 'array' : 'table'} on line ${i + 1} is never closed`);
      next = l + 1;
      showTo = lineEnd(lines, l);
      refusal = c === '[' ? 'It is an array' : 'It is an inline table';
    } else {
      const hash = t.indexOf('#', p);
      const word = t.slice(p, hash < 0 ? t.length : hash).trimEnd();
      value = word;
      quoting = 'plain';
      showTo = lines[i]!.at + p + word.length;
      if (!TOML_BARE.test(word)) refusal = 'It is not a value Marxy reads';
      else token = { from: lines[i]!.at + p, to: lines[i]!.at + p + word.length };
    }
    const multi = next > i + 1;
    entries.push({
      key: k.key,
      line: keyLine,
      value: multi ? dedent(block.slice(showFrom, showTo)) : value,
      quoting: token === null ? null : quoting,
      token,
      refusal,
    });
    i = next;
  }
  return { entries, unreadable: null };
}

// ---- the block ------------------------------------------------------------------------------------------------------------

function scanBlock(block: string): Scan {
  const lines = splitLines(block);
  const lineStarts = lines.map((l) => l.at);
  const none = (why: string): Scan => ({ format: 'yaml', entries: [], lineStarts, unreadable: why });
  const opener = /^(---|\+\+\+)[ \t]*$/.exec(lines[0]!.text);
  if (!opener) return none('the front matter does not begin with --- or +++');
  const format: FrontMatterFormat = opener[1] === '---' ? 'yaml' : 'toml';
  let end = -1;
  for (let l = lines.length - 1; l > 0; l--) {
    if (new RegExp(`^\\${opener[1]!.split('').join('\\')}[ \\t]*$`).test(lines[l]!.text)) {
      end = l;
      break;
    }
  }
  if (end < 0) return { ...none('the front matter is not closed'), format };
  // TOML ends a line with LF or CRLF only: a bare CR is a character to its parser, and here a line end, so nothing is read.
  if (format === 'toml' && /\r(?!\n)/.test(block)) return { ...none('it has a bare carriage return, which TOML does not read as a line ending'), format };
  const { entries, unreadable } = format === 'yaml' ? scanYaml(block, lines, 1, end) : scanToml(block, lines, 1, end);
  // A key twice is ambiguous: neither is read as a scalar.
  const seen = new Map<string, number>();
  for (const e of entries) seen.set(e.key, (seen.get(e.key) ?? 0) + 1);
  const marked = entries.map((e): Entry =>
    seen.get(e.key)! > 1 ? { ...e, token: null, quoting: null, refusal: 'The key is written more than once' } : e,
  );
  return { format, entries: unreadable === null ? marked : [], lineStarts, unreadable };
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

interface Located {
  readonly block: string;
  readonly start: number;
  readonly file: string;
  readonly scan: Scan;
}

/** The front matter of `document` read from `bytes`; a refusal in words when there is none or it is not text. */
function locate(document: Document, bytes: Uint8Array): Located | string {
  const first = document.children[0];
  if (first === undefined || first.type !== 'frontmatter') return 'This file has no front matter';
  const { start, end, file } = first.src;
  if (start < 0 || end > bytes.length || start >= end) return 'The front matter is not where the document says';
  let block: string;
  try {
    block = decoder.decode(bytes.subarray(start, end));
  } catch {
    return 'The front matter is not valid UTF-8';
  }
  return { block, start, file, scan: scanBlock(block) };
}


/**
 * The top-level keys of `document`'s front matter with what each shows and whether it is one scalar. Null when the
 * document has none. `bytes` are the document's bytes (`buffer.bytes`).
 */
export function frontMatterValues(document: Document, bytes: Uint8Array): FrontMatterValues | null {
  const found = locate(document, bytes);
  if (typeof found === 'string') return found === 'This file has no front matter' ? null : { format: 'yaml', values: [], unreadable: found };
  const { scan, block, start } = found;
  // The byte offset of each entry's line, taken as a running total: the entries come in line order, so each is the last one
  // plus the bytes between them. (Measuring from the top of the block for every entry is quadratic: 23 s for a 30,000-key head.)
  let seenChar = 0;
  let seenByte = start;
  const base = (line: number): number => {
    const at = scan.lineStarts[line]!;
    if (at < seenChar) {
      seenChar = 0;
      seenByte = start;
    }
    seenByte += utf8Length(block.slice(seenChar, at));
    seenChar = at;
    return seenByte;
  };
  return {
    format: scan.format,
    unreadable: scan.unreadable,
    values: scan.entries.map((e) => ({
      key: e.key,
      value: e.value,
      quoting: e.quoting,
      line: e.line + 1,
      lineStart: base(e.line),
      refusal: e.refusal,
    })),
  };
}
