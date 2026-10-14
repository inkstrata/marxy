// Seeded front-matter documents for the differential fuzz of `set-front-matter-value` (W-17). Each document is YAML or TOML
// front matter built from entries whose meaning the generator knows (the key, whether it is a scalar that can be edited, and the
// value it reads as), then a body built to look like front matter and to hold the bytes an edit must never touch. Test support
// only (it imports the test kit, which imports node:test): never exported from the package index.
import { isDeepStrictEqual } from 'node:util';
import { parse as parseToml } from 'smol-toml';
import type { Document } from '../../contracts/ast.ts';
import { parseMarkdown } from '../../parse/parse.ts';
import { frontmatterRows } from '../../render/frontmatter.ts';
import { frontMatterValues, type FrontMatterEdit } from '../front-matter-value.ts';
import { seededRandom } from './test-kit.ts';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });

export interface ModelEntry {
  readonly key: string;
  /** A scalar on one line that the operation is meant to edit. */
  readonly editable: boolean;
  /** What the value reads as, for an editable one. */
  readonly value?: string;
  /** Listed by the Metadata tab: false for a key below a TOML table. */
  readonly listed: boolean;
}

export interface GeneratedDoc {
  readonly format: 'yaml' | 'toml';
  readonly source: string;
  readonly entries: readonly ModelEntry[];
  /** The front matter block as written: opener to closer, no trailing line ending. */
  readonly block: string;
}

type Rng = () => number;
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;

/** Text that reads as itself when written as a YAML plain word on a key line. */
export const YAML_PLAIN_WORDS: readonly string[] = [
  'Old title', 'hello', 'a-b_c', 'https://example.org/a?b=1&c=2', '12:30', 'true', '42', '2026-10-13', '~', 'null', 'café', '日本語 text',
  "it's", 'a#b', 'say "hi"', 'x.y', '1.5e3', '0x1F', 'yes', 'no', 'path/to/file.md', 'a,b', 'a]b', 'a}b', '100%', 'x@y', 'a&b', 'a*b', 'a!b',
  'a|b', 'a>b', 'a-', 'a?b', 'N', 'Off', '😀 emoji', 'two  spaces inside', 'tab\tinside',
];

/** Text for the quoted forms: anything a line can hold. */
export const QUOTED_TEXTS: readonly string[] = [
  'Hello', 'a "q" b', 'back\\slash', 'tab\there', 'é', '', ' spaced ', 'a: b', '#x', '- y', "it's", '"', "'", '\\', 'a #b', '[x]', '{y}', 'true', '日本語',
];

/** New values to try, awkward on purpose. None holds a line break or a control character. */
export const NEW_VALUES: readonly string[] = [
  'New', 'x', '', '  spaced  ', 'a: b', 'a #b', '#hash', '- dash', '-', '?', ':', '[x]', '{x}', '&a', '*a', '!t', '|b', '>c', "'q'", '"dq"', 'back\\slash',
  'tab\there', 'true', 'False', 'null', '~', '42', '-1.5e3', '2026-01-01', 'yes', 'No', 'é', '日本語', '😀 emoji', "a'b", 'a"b', '"', "'", '\\', '%x',
  '@x', '`x', '---', '...', 'key: value', 'multi word value', 'https://x.y/z#frag', 'ends:', 'ends #', ' nbsp', 'zero​width', '0x1F', '1_000',
  '3.14', '12:30', 'a,b', 'a]b', '\\n', '\\u0041', '""', "''", '# not a comment', 'x # y', ': x', 'x:y', "it's: odd", '<<', '=', '{{ x }}',
];

const doubleQuoted = (t: string): string => `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\t/g, '\\t')}"`;
const singleQuoted = (t: string): string => `'${t.replace(/'/g, "''")}'`;

const KEYS = ['title', 'name', 'author', 'date', 'tags', 'draft', 'a-b', 'x.y', 'description', 'version', 'café', '日本語', 'key two', 'priority', 'url'];

interface Piece {
  readonly key: string;
  readonly lines: readonly string[];
  readonly editable: boolean;
  readonly value?: string;
}

function comment(rng: Rng): string {
  return pick(rng, ['', '', '', ' # note', '   #tight', '\t# tab']);
}

function yamlKey(rng: Rng, used: Set<string>): { text: string; key: string } {
  let key = pick(rng, KEYS);
  if (used.has(key) && rng() < 0.7) key = `${key}${used.size}`;
  used.add(key);
  const form = rng();
  if (form < 0.12) return { text: doubleQuoted(key), key };
  if (form < 0.2) return { text: singleQuoted(key), key };
  return { text: key, key };
}

function yamlPiece(rng: Rng, used: Set<string>): Piece {
  const { text: k, key } = yamlKey(rng, used);
  const sep = pick(rng, [': ', ': ', ': ', ':  ', ':\t']);
  const c = comment(rng);
  const form = rng();
  const refuse = (lines: string[]): Piece => ({ key, lines, editable: false });
  if (form < 0.2) {
    const v = pick(rng, YAML_PLAIN_WORDS);
    return { key, lines: [`${k}${sep}${v}${c}`], editable: true, value: v };
  }
  if (form < 0.32) {
    const v = pick(rng, QUOTED_TEXTS);
    return { key, lines: [`${k}${sep}${doubleQuoted(v)}${c}`], editable: true, value: v };
  }
  if (form < 0.42) {
    const v = pick(rng, QUOTED_TEXTS);
    return { key, lines: [`${k}${sep}${singleQuoted(v)}${c}`], editable: true, value: v };
  }
  if (form < 0.46) return { key, lines: [`${k}${sep}"a\\x41\\u00e9\\n"${c}`], editable: true, value: 'aAé\n' };
  const nested = [
    () => refuse([`${k}: |`, '  line one', '', '  line two', ...(rng() < 0.5 ? [''] : [])]),
    () => refuse([`${k}: >-`, '  folded text', '  more: not a key']),
    () => refuse([`${k}: |+`, '    keep', '', '']),
    () => refuse([`${k}: &anc ${pick(rng, YAML_PLAIN_WORDS)}`]),
    () => refuse([`${k}: &anc2 "quoted"`]),
    () => refuse([`${k}: *anc`]),
    () => refuse([`${k}: !!str ${pick(rng, YAML_PLAIN_WORDS)}`]),
    () => refuse([`${k}: !custom "v"`]),
    () => refuse([`${k}: [a, b, "c, d", 'e']`]),
    () => refuse([`${k}: {a: 1, "b": 'two'}`]),
    () => refuse([`${k}: [it's, fine, a#b]`]),
    () => refuse([`${k}: [a,`, 'fake: yes', '  b]']),
    () => refuse([`${k}: {a: 1,`, 'b: 2}']),
    () => refuse([`${k}: "one`, `fake${used.size}: x"`]),
    () => refuse([`${k}: "one`, '  two"']),
    () => refuse([`${k}: 'one`, 'two'.concat("'")]),
    () => refuse([`${k}: first`, '  second', '  third']),
    () => refuse([`${k}: first`, '', '  second']),
    () => refuse([`${k}:`]),
    () => refuse([`${k}: # nothing`]),
    () => refuse([`${k}:`, '  a: 1', '  b:', '    c: [1, 2]', '', '  d: x']),
    () => refuse([`${k}:`, '  - one', '  - two']),
    () => refuse([`${k}:`, '- one', '- two: x', '# a comment', '- three']),
    () => refuse([`${k}: a: b`]),
    () => refuse([`${k}: "a" b`]),
    () => refuse([`${k}: %reserved`]),
  ];
  return pick(rng, nested)();
}

function tomlPiece(rng: Rng, used: Set<string>): Piece {
  let key = pick(rng, ['title', 'name', 'author', 'date', 'draft', 'count', 'a-b', 'when', 'ratio', 'url']);
  if (used.has(key)) key = `${key}${used.size}`;
  used.add(key);
  const dotted = rng() < 0.12;
  const quotedKey = !dotted && rng() < 0.12;
  const k = dotted ? `${key}.sub` : quotedKey ? doubleQuoted(key) : key;
  const readKey = dotted ? `${key}.sub` : key;
  const sep = pick(rng, [' = ', '=', ' =  ', '\t=\t']);
  const c = pick(rng, ['', '', ' # note', '  #tight']);
  const form = rng();
  const refuse = (lines: string[]): Piece => ({ key: readKey, lines, editable: false });
  if (form < 0.25) {
    const v = pick(rng, QUOTED_TEXTS);
    return { key: readKey, lines: [`${k}${sep}${doubleQuoted(v)}${c}`], editable: true, value: v };
  }
  if (form < 0.4) {
    const v = pick(rng, QUOTED_TEXTS.filter((t) => !t.includes("'")));
    return { key: readKey, lines: [`${k}${sep}'${v}'${c}`], editable: true, value: v };
  }
  if (form < 0.6) {
    const v = pick(rng, ['3', '-17', '1_000', '3.14', '1e6', 'true', 'false', '2026-10-13', '2026-10-13T08:30:00Z', '07:32:00', '0xFF', 'inf', '+nan']);
    return { key: readKey, lines: [`${k}${sep}${v}${c}`], editable: true, value: v };
  }
  return pick(rng, [
    () => refuse([`${k}${sep}[1, 2, 3]${c}`]),
    () => refuse([`${k} = [`, '  "a",', '[1, 2],', ']', '']),
    () => refuse([`${k} = ["a", # c`, '  "b#c"]']),
    () => refuse([`${k} = { x = 1, y = "two" }`]),
    () => refuse([`${k} = """`, 'line [not a table]', '[x] = y"""']),
    () => refuse([`${k} = '''`, "it's", "'''"]),
    () => refuse([`${k} = """one line"""`]),
    () => refuse([`${k} = "a" b`]),
  ])();
}

/** A body that looks like front matter in places and must come through every edit unchanged. */
function bodyOf(rng: Rng): string {
  const pool = ['# A heading', '', 'title: not front matter', '---', '+++', 'text with "quotes" and ---', '```', 'code: here', '```', '- item', '> quote', '[link](x)', '***', '...'];
  const n = Math.floor(rng() * 8);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) lines.push(pick(rng, pool));
  return lines.join('\n');
}

/** One seeded document. The same seed is the same document everywhere. */
export function generateDoc(seed: number): GeneratedDoc {
  const rng = seededRandom(seed * 2654435761 + 12345);
  const format: 'yaml' | 'toml' = rng() < 0.65 ? 'yaml' : 'toml';
  const used = new Set<string>();
  const count = 1 + Math.floor(rng() * 6);
  const lines: string[] = [];
  const entries: ModelEntry[] = [];
  const spacer = (): void => {
    const r = rng();
    if (r < 0.15) lines.push('');
    else if (r < 0.3) lines.push('# a comment line');
  };
  spacer();
  const keyCounts = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const piece = format === 'yaml' ? yamlPiece(rng, used) : tomlPiece(rng, used);
    // Now and then the same key is written again: neither is editable then.
    lines.push(...piece.lines);
    entries.push({ key: piece.key, editable: piece.editable, value: piece.value, listed: true });
    keyCounts.set(piece.key, (keyCounts.get(piece.key) ?? 0) + 1);
    spacer();
    if (rng() < 0.07 && piece.lines.length === 1) {
      lines.push(...piece.lines);
      entries.push({ key: piece.key, editable: piece.editable, value: piece.value, listed: true });
      keyCounts.set(piece.key, (keyCounts.get(piece.key) ?? 0) + 1);
    }
  }
  if (format === 'toml' && rng() < 0.4) {
    lines.push('[table]', 'inside = "v"', 'other = 3');
  }
  const marks = format === 'yaml' ? '---' : '+++';
  const closer = marks + pick(rng, ['', '', '', '  ']);
  // TOML ends a line with LF or CRLF; YAML also with a lone CR.
  const eolMode = format === 'toml' ? pick(rng, ['lf', 'lf', 'crlf', 'mixed']) : pick(rng, ['lf', 'lf', 'crlf', 'cr', 'mixed']);
  const eol = (): string =>
    eolMode === 'lf' ? '\n' : eolMode === 'crlf' ? '\r\n' : eolMode === 'cr' ? '\r' : format === 'toml' ? pick(rng, ['\n', '\r\n']) : pick(rng, ['\n', '\r\n', '\r']);
  // A multi-line value's own line breaks follow the same convention as the rest of the block.
  let block = marks;
  for (const line of lines) block += eol() + line;
  block += eol() + closer;
  const bom = rng() < 0.2 ? '\ufeff' : '';
  const body = bodyOf(rng);
  const after = body === '' ? pick(rng, ['', eol()]) : eol() + body.split('\n').join(eol()) + pick(rng, ['', eol()]);
  // A key written twice is ambiguous: neither is editable.
  const marked = entries.map((e): ModelEntry => ((keyCounts.get(e.key) ?? 0) > 1 ? { key: e.key, editable: false, listed: true } : e));
  return { format, source: `${bom}${block}${after}`, entries: marked, block };
}

const lineSplit = (bytes: Uint8Array): Uint8Array[] => {
  const out: Uint8Array[] = [];
  let from = 0;
  for (let i = 0; i < bytes.length; i++) {
    const crlf = bytes[i] === 0x0d && bytes[i + 1] === 0x0a;
    if (bytes[i] === 0x0a || bytes[i] === 0x0d) {
      const stop = crlf ? i + 2 : i + 1;
      out.push(bytes.subarray(from, stop));
      from = stop;
      if (crlf) i++;
    }
  }
  out.push(bytes.subarray(from));
  return out;
};
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export function frontOf(doc: Document): { start: number; end: number } | null {
  const first = doc.children[0];
  return first !== undefined && first.type === 'frontmatter' ? { start: first.src.start, end: first.src.end } : null;
}

/** Everything that must hold of one successful edit of `key` to `value` in `before`; a list of what does not. */
export function problemsWith(before: Uint8Array, key: string, value: string, edit: Extract<FrontMatterEdit, { ok: true }>, format: 'yaml' | 'toml'): string[] {
  const problems: string[] = [];
  const bad = (m: string): void => void problems.push(m);
  const docBefore = parseMarkdown(before, { file: 'f.md' });
  const fmBefore = frontOf(docBefore)!;
  const { start, end } = edit.range;
  const replacementBytes = enc.encode(edit.replacement);
  const after = new Uint8Array(start + replacementBytes.length + (before.length - end));
  after.set(before.subarray(0, start), 0);
  after.set(replacementBytes, start);
  after.set(before.subarray(end), start + replacementBytes.length);

  // The splice sits inside the front matter, on one line: no line ending in what it replaces or what replaces it.
  if (start < fmBefore.start || end > fmBefore.end) bad('the range leaves the front matter');
  if (/[\r\n]/.test(edit.replacement) || before.subarray(start, end).some((b) => b === 0x0a || b === 0x0d)) bad('the splice holds a line ending');
  // Every line but the edited one is byte for byte as it was, and the edited line differs only inside the token.
  const a = lineSplit(before);
  const b = lineSplit(after);
  if (a.length !== b.length) bad(`the line count changed (${a.length} to ${b.length})`);
  else {
    let at = 0;
    let edited = -1;
    for (let i = 0; i < a.length; i++) {
      if (start >= at && start <= at + a[i]!.length) {
        edited = i;
        break;
      }
      at += a[i]!.length;
    }
    for (let i = 0; i < a.length; i++) if (i !== edited && !same(a[i]!, b[i]!)) bad(`line ${i + 1} changed`);
  }
  // The body and the bytes before the front matter (a BOM) are what they were.
  const docAfter = parseMarkdown(after, { file: 'f.md' });
  const fmAfter = frontOf(docAfter);
  if (fmAfter === null) {
    bad('the result no longer begins with front matter');
    return problems;
  }
  if (fmAfter.start !== fmBefore.start) bad('the front matter starts elsewhere');
  const delta = replacementBytes.length - (end - start);
  if (fmAfter.end !== fmBefore.end + delta) bad(`the front matter ends ${fmAfter.end - fmBefore.end - delta} bytes from where it should`);
  if (!same(after.subarray(fmAfter.end), before.subarray(fmBefore.end))) bad('the body changed');
  if (!same(after.subarray(0, fmBefore.start), before.subarray(0, fmBefore.start))) bad('the bytes before the front matter changed');
  // The rest of the document parses as it did: the same blocks in the same order, the same text.
  if (docAfter.children.length !== docBefore.children.length) bad('the document has a different number of blocks');
  else {
    docAfter.children.forEach((child, i) => {
      if (i > 0 && child.type !== docBefore.children[i]!.type) bad(`block ${i} is another kind of block`);
    });
  }

  // Every other key reads as it did; this one as asked.
  const was = frontMatterValues(docBefore, before)!;
  const now = frontMatterValues(docAfter, after);
  if (now === null || now.unreadable !== null) {
    bad('the result is not readable');
    return problems;
  }
  if (now.values.length !== was.values.length) bad('the keys changed');
  else {
    now.values.forEach((v, i) => {
      const w = was.values[i]!;
      if (v.key !== w.key) bad(`key ${i} is ${v.key}, was ${w.key}`);
      else if (w.key === key) {
        if (v.value !== value) bad(`${key} reads ${JSON.stringify(v.value)}, not ${JSON.stringify(value)}`);
        if (v.refusal !== null) bad(`${key} is no longer editable`);
      } else if (v.value !== w.value || v.refusal !== w.refusal || v.quoting !== w.quoting || v.line !== w.line) bad(`${w.key} reads differently`);
    });
  }
  // K-20's own reader, which shares no code with the scanner, sees every other row the same.
  const rowsBefore = frontmatterRows((docBefore.children[0] as { value: string }).value);
  const rowsAfter = frontmatterRows((docAfter.children[0] as { value: string }).value);
  if (rowsBefore.length !== rowsAfter.length) bad('the row reader finds another number of rows');
  else {
    rowsBefore.forEach((row, i) => {
      if (row.key !== rowsAfter[i]!.key) bad('the row reader finds another key');
      else if (row.key !== key && !isDeepStrictEqual(row.lines, rowsAfter[i]!.lines)) bad(`the row reader reads ${row.key} differently`);
    });
  }
  // TOML has a real parser: every other key is the same value, and this one is what its token says.
  if (format === 'toml') {
    const inner = (text: Uint8Array): string => {
      const s = dec.decode(text).replace(/^﻿/, '');
      return s.replace(/^\+\+\+[^\r\n]*(\r\n|\r|\n)/, '').replace(/(\r\n|\r|\n)\+\+\+[ \t]*$/, '');
    };
    let parsedBefore: Record<string, unknown> | null = null;
    try {
      parsedBefore = parseToml(inner(before.subarray(fmBefore.start, fmBefore.end)));
    } catch {
      parsedBefore = null; // the generator writes a few values that are not TOML (`"a" b`); nothing to compare against
    }
    if (parsedBefore !== null) {
      let parsedAfter: Record<string, unknown> | null = null;
      try {
        parsedAfter = parseToml(inner(after.subarray(fmAfter.start, fmAfter.end)));
      } catch (e) {
        bad(`the result is not TOML: ${(e as Error).message}`);
      }
      if (parsedAfter !== null) {
        const flat = (o: Record<string, unknown>, prefix = ''): Map<string, unknown> => {
          const out = new Map<string, unknown>();
          for (const [k, v] of Object.entries(o)) {
            if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && Object.getPrototypeOf(v) === Object.prototype) {
              for (const [k2, v2] of flat(v as Record<string, unknown>, `${prefix}${k}.`)) out.set(k2, v2);
            } else out.set(`${prefix}${k}`, v);
          }
          return out;
        };
        const fa = flat(parsedBefore);
        const fb = flat(parsedAfter);
        if (fa.size !== fb.size) bad('the TOML has another number of keys');
        for (const [k, v] of fa) {
          if (k === key) continue;
          if (!isDeepStrictEqual(fb.get(k), v)) bad(`TOML key ${k} reads differently`);
        }
        const expected = ((): unknown => {
          try {
            return parseToml(`v = ${edit.replacement}`).v;
          } catch {
            return undefined;
          }
        })();
        if (!isDeepStrictEqual(fb.get(key), expected)) bad(`TOML key ${key} is ${JSON.stringify(fb.get(key))}, its token reads ${JSON.stringify(expected)}`);
        // A value written quoted is the string asked for; a bare one is only written for a bare literal.
        if (/^["']/.test(edit.replacement) && fb.get(key) !== value) bad(`TOML key ${key} is not the string asked for`);
      }
    }
  }
  return problems;
}

