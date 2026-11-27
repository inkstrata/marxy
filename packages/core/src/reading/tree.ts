// A data file as a tree: maps, lists and values, each with the span of text it came from, in the order the file writes
// them. The parsers here (JSON, the parts of YAML and TOML that config files use, XML) refuse what they do not read, with
// the line and what was expected there, so a file is never shown as something it is not. Pure.
import { budget, figure } from '../util/budget.ts';
import { own } from '../util/text.ts';

export type ScalarType = 'string' | 'number' | 'bool' | 'null' | 'date' | 'block' | 'text';

export interface TreeNode {
  readonly kind: 'map' | 'list' | 'scalar' | 'element';
  /** A map's key, an element's name; null for a list item and the root. */
  readonly key: string | null;
  /** UTF-16 offsets into the text. */
  readonly start: number;
  readonly end: number;
  readonly type?: ScalarType;
  readonly value?: string;
  readonly children?: readonly TreeNode[];
  /** An element's attributes, in the order written. */
  readonly attrs?: readonly { readonly name: string; readonly value: string }[];
}

export class TreeError extends Error {
  readonly at: number;
  constructor(message: string, at: number) {
    super(message);
    this.at = at;
  }
}

const isWs = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/**
 * Levels of nesting a tree is read to. Past it the parse stops with a TreeError, so the file is set as written: the
 * parsers and the page both go down a level at a time, and a file nested 10,000 deep ran the engine out of stack.
 */
export const TREE_MAX_DEPTH = 256;

/**
 * Where a tree is drawn from (Draw from here): the value reached by `path`, each step an entry's index in
 * its map, list or element, and its entries from `from` on. The top is no steps from 0. Held by the tab, never kept.
 */
export interface TreeFrom {
  readonly path: readonly number[];
  readonly from: number;
}

/** `2/584@6`: the steps, then the entry; the page carries it on each way to draw from somewhere. */
export const treeFromCode = (f: TreeFrom): string => `${f.path.join('/')}@${f.from}`;

export function treeFromOf(code: string): TreeFrom | null {
  const m = /^((?:\d+(?:\/\d+)*)?)@(\d+)$/.exec(code);
  if (!m) return null;
  return { path: m[1] === '' ? [] : m[1]!.split('/').map(Number), from: Number(m[2]) };
}

export const isTreeTop = (f: TreeFrom | null | undefined): boolean => !f || (f.path.length === 0 && f.from === 0);

const tooDeep = (at: number): TreeError => new TreeError(`nesting more than ${TREE_MAX_DEPTH} levels deep, which this view does not draw`, at);

// ---- JSON --------------------------------------------------------------------------------------------------------

const JSON_ESCAPES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
/** A number, `true`, `false` or `null` where the scan stands, however long the number. */
const JSON_SCALAR = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;

export function parseJson(text: string): TreeNode {
  let i = 0;
  const fail = (what: string): never => {
    throw new TreeError(`expected ${what}`, i);
  };
  const skip = (): void => {
    while (isWs(text[i])) i++;
  };
  const str = (): string => {
    if (text[i] !== '"') fail('a string');
    i++;
    let out = '';
    while (i < text.length && text[i] !== '"') {
      const c = text[i]!;
      if (c === '\\') {
        const e = text[i + 1];
        if (e === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('four hex digits after \\u');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        const escaped = e === undefined ? undefined : own(JSON_ESCAPES, e);
        if (escaped === undefined) fail('an escape');
        out += escaped;
        i += 2;
        continue;
      }
      if (c === '\n') fail('the string to close before the line ends');
      // The plain run up to the next quote, escape or line break, in one piece.
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== '\\' && text[j] !== '\n') j++;
      out += text.slice(i, j);
      i = j;
    }
    if (text[i] !== '"') fail('a closing quote');
    i++;
    return out;
  };
  const value = (key: string | null, depth: number): TreeNode => {
    skip();
    const start = i;
    const c = text[i];
    if ((c === '{' || c === '[') && depth >= TREE_MAX_DEPTH) throw tooDeep(i);
    if (c === '{') {
      i++;
      const children: TreeNode[] = [];
      skip();
      if (text[i] === '}') {
        i++;
        return { kind: 'map', key, start, end: i, children };
      }
      for (;;) {
        skip();
        const k = str();
        skip();
        if (text[i] !== ':') fail('a colon after the key');
        i++;
        children.push(value(k, depth + 1));
        skip();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return { kind: 'map', key, start, end: i, children };
        }
        fail('a comma or a closing brace');
      }
    }
    if (c === '[') {
      i++;
      const children: TreeNode[] = [];
      skip();
      if (text[i] === ']') {
        i++;
        return { kind: 'list', key, start, end: i, children };
      }
      for (;;) {
        children.push(value(null, depth + 1));
        skip();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return { kind: 'list', key, start, end: i, children };
        }
        fail('a comma or a closing bracket');
      }
    }
    if (c === '"') {
      const v = str();
      return { kind: 'scalar', key, start, end: i, type: 'string', value: v };
    }
    JSON_SCALAR.lastIndex = i;
    const m = JSON_SCALAR.exec(text);
    if (!m) fail('a value');
    i += m![0].length;
    const v = m![0];
    return { kind: 'scalar', key, start, end: i, type: v === 'null' ? 'null' : v === 'true' || v === 'false' ? 'bool' : 'number', value: v };
  };
  const root = value(null, 0);
  skip();
  if (i < text.length) fail('the end of the file');
  return root;
}

// ---- YAML (block maps and lists, flow lists and maps of scalars, quoted and block scalars) ---------------------------

interface Line {
  readonly indent: number;
  readonly text: string;
  /** Offset of the first non-space character. */
  readonly at: number;
  /** Offset just past the line's content (before its break). */
  readonly end: number;
}

/** A line less its comment: a `#` that starts the line or follows a space, outside quotes. */
function withoutComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) return line.slice(0, i);
  }
  return line;
}

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let pos = 0;
  for (const raw of text.split('\n')) {
    const start = pos;
    pos += raw.length + 1;
    const body = raw.replace(/\r$/, '');
    const stripped = withoutComment(body);
    if (stripped.trim() === '') continue;
    const indent = body.length - body.trimStart().length;
    out.push({ indent, text: stripped.trimEnd().slice(indent), at: start + indent, end: start + stripped.trimEnd().length });
  }
  return out;
}

function yamlScalar(raw: string, at: number, key: string | null): TreeNode {
  const t = raw.trim();
  const end = at + raw.length;
  if (/^".*"$/.test(t)) {
    try {
      return { kind: 'scalar', key, start: at, end, type: 'string', value: JSON.parse(t) as string };
    } catch {
      throw new TreeError('expected a closed double-quoted string', at);
    }
  }
  if (/^'.*'$/.test(t)) return { kind: 'scalar', key, start: at, end, type: 'string', value: t.slice(1, -1).replace(/''/g, "'") };
  if (/^[&*!]/.test(t)) throw new TreeError('an anchor, alias or tag, which this view does not read', at);
  if (/^(true|false|yes|no|on|off)$/i.test(t)) return { kind: 'scalar', key, start: at, end, type: 'bool', value: t };
  if (/^(null|~)?$/i.test(t)) return { kind: 'scalar', key, start: at, end, type: 'null', value: t === '' ? 'null' : t };
  if (/^[-+]?(\d[\d_]*(\.\d+)?([eE][-+]?\d+)?|0x[0-9a-fA-F]+|\.inf|\.nan)$/.test(t)) return { kind: 'scalar', key, start: at, end, type: 'number', value: t };
  if (/^\d{4}-\d\d-\d\d([T ][\d:.]+(Z|[+-]\d\d:?\d\d)?)?$/.test(t)) return { kind: 'scalar', key, start: at, end, type: 'date', value: t };
  return { kind: 'scalar', key, start: at, end, type: 'string', value: t };
}

/** `[a, b]` or `{a: 1, b: 2}` of scalars, on one line. */
function yamlFlow(raw: string, at: number, key: string | null): TreeNode {
  const t = raw.trim();
  const inner = t.slice(1, -1);
  if (/[[\]{}]/.test(inner)) throw new TreeError('a nested flow collection, which this view does not read', at);
  const parts = inner.trim() === '' ? [] : inner.split(',');
  let off = at + raw.indexOf(t) + 1;
  const children: TreeNode[] = [];
  for (const part of parts) {
    const lead = part.length - part.trimStart().length;
    if (t[0] === '{') {
      const m = /^([^:]+):\s*(.*)$/.exec(part.trim());
      if (!m) throw new TreeError('a key and a value in the flow map', off);
      children.push(yamlScalar(m[2]!, off + lead + part.trim().indexOf(m[2]!), m[1]!.trim()));
    } else children.push(yamlScalar(part.trim(), off + lead, null));
    off += part.length + 1;
  }
  return { kind: t[0] === '{' ? 'map' : 'list', key, start: at, end: at + raw.length, children };
}

export function parseYaml(text: string): TreeNode {
  const lines = linesOf(text).filter((l) => !/^(---|\.\.\.)\s*$/.test(l.text));
  if (lines.length === 0) return { kind: 'map', key: null, start: 0, end: text.length, children: [] };
  let n = 0;
  const value = (raw: string, at: number, key: string | null, indent: number, depth: number): TreeNode => {
    const t = raw.trim();
    if (t === '') return block(indent, key, at, depth);
    if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'))) return yamlFlow(raw, at, key);
    if (/^[|>][+-]?\d*$/.test(t)) {
      const kept: string[] = [];
      let end = at + raw.length;
      const first = lines[n];
      const base = first && first.indent > indent ? first.indent : null;
      while (base !== null && n < lines.length && lines[n]!.indent >= base) {
        kept.push(text.slice(lines[n]!.at - (lines[n]!.indent - base), lines[n]!.end));
        end = lines[n]!.end;
        n++;
      }
      const joined = t[0] === '>' ? kept.join(' ') : kept.join('\n');
      return { kind: 'scalar', key, start: at, end, type: 'block', value: joined };
    }
    return yamlScalar(raw, at, key);
  };
  const block = (parentIndent: number, key: string | null, at: number, depth: number): TreeNode => {
    const first = lines[n];
    if (!first || first.indent <= parentIndent) return { kind: 'scalar', key, start: at, end: at, type: 'null', value: 'null' };
    if (depth >= TREE_MAX_DEPTH) throw tooDeep(first.at);
    const indent = first.indent;
    const isList = first.text.startsWith('- ') || first.text === '-';
    const children: TreeNode[] = [];
    let end = first.end;
    while (n < lines.length && lines[n]!.indent === indent) {
      const line = lines[n]!;
      if (isList) {
        if (!(line.text.startsWith('- ') || line.text === '-')) throw new TreeError('a list item, as the lines above it are', line.at);
        n++;
        const rest = line.text.slice(1);
        const restAt = line.at + 1 + (rest.length - rest.trimStart().length);
        const m = /^\s*([^\s"'[{][^:]*?|"[^"]*"|'[^']*'):(\s+(.*))?$/.exec(rest);
        if (m) {
          // `- key: value` opens a map whose further keys sit under the key.
          const itemIndent = line.indent + 2;
          const k = m[1]!.replace(/^["']|["']$/g, '');
          const first = value(m[3] ?? '', restAt + rest.trimStart().indexOf(m[3] ?? '') , k, itemIndent, depth + 2);
          const kids: TreeNode[] = [first];
          while (n < lines.length && lines[n]!.indent === itemIndent && !lines[n]!.text.startsWith('- ')) kids.push(mapEntry(lines[n]!, itemIndent, depth + 2));
          const last = kids[kids.length - 1]!;
          children.push({ kind: 'map', key: null, start: line.at, end: last.end, children: kids });
        } else if (rest.trim() === '') {
          children.push(block(line.indent, null, line.at, depth + 1));
        } else children.push(value(rest, restAt, null, line.indent, depth + 1));
      } else {
        children.push(mapEntry(line, indent, depth + 1));
      }
      end = children[children.length - 1]!.end;
    }
    if (n < lines.length && lines[n]!.indent > indent) throw new TreeError('the line to line up with the ones above it', lines[n]!.at);
    return { kind: isList ? 'list' : 'map', key, start: first.at, end, children };
  };
  const mapEntry = (line: Line, indent: number, depth: number): TreeNode => {
    const m = /^("[^"]*"|'[^']*'|[^:]+?):(\s+(.*))?$/.exec(line.text);
    if (!m) throw new TreeError('a key and a colon', line.at);
    n++;
    const k = m[1]!.replace(/^["']|["']$/g, '').trim();
    const raw = m[3] ?? '';
    const node = value(raw, raw === '' ? line.at : line.at + line.text.indexOf(raw, m[1]!.length + 1), k, indent, depth);
    return { ...node, start: line.at };
  };
  const root = block(-1, null, 0, 0);
  if (n < lines.length) throw new TreeError('the end of the file', lines[n]!.at);
  return root;
}

// ---- TOML ----------------------------------------------------------------------------------------------------------

/** A TOML value where the scan stands: a number, a boolean, a date or a time. */
const TOML_SCALAR = /true|false|[-+]?(?:inf|nan)|[-+]?(?:0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][-+]?\d+)?)|\d{4}-\d\d-\d\d(?:[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?)?|\d\d:\d\d:\d\d(?:\.\d+)?/y;

function tomlValue(text: string, i: number, key: string | null, depth: number): { node: TreeNode; end: number } {
  const start = i;
  const c = text[i];
  const fail = (what: string): never => {
    throw new TreeError(`expected ${what}`, i);
  };
  if ((c === '[' || c === '{') && depth >= TREE_MAX_DEPTH) throw tooDeep(i);
  if (text.startsWith('"""', i) || text.startsWith("'''", i)) {
    const q = text.slice(i, i + 3);
    const close = text.indexOf(q, i + 3);
    if (close < 0) fail(`${q} to close the string`);
    const v = text.slice(i + 3, close).replace(/^\r?\n/, '');
    return { node: { kind: 'scalar', key, start, end: close + 3, type: 'block', value: v }, end: close + 3 };
  }
  if (c === '"') {
    const m = /^"(?:[^"\\\n]|\\.)*"/.exec(text.slice(i));
    if (!m) fail('a closed string');
    let v: string;
    try {
      v = JSON.parse(m![0]) as string;
    } catch {
      v = m![0].slice(1, -1);
    }
    return { node: { kind: 'scalar', key, start, end: i + m![0].length, type: 'string', value: v }, end: i + m![0].length };
  }
  if (c === "'") {
    const close = text.indexOf("'", i + 1);
    if (close < 0 || text.slice(i, close).includes('\n')) fail('a closed literal string');
    return { node: { kind: 'scalar', key, start, end: close + 1, type: 'string', value: text.slice(i + 1, close) }, end: close + 1 };
  }
  if (c === '[') {
    i++;
    const children: TreeNode[] = [];
    for (;;) {
      while (isWs(text[i]) || text[i] === '#') {
        if (text[i] === '#') while (i < text.length && text[i] !== '\n') i++;
        else i++;
      }
      if (text[i] === ']') return { node: { kind: 'list', key, start, end: i + 1, children }, end: i + 1 };
      const got = tomlValue(text, i, null, depth + 1);
      children.push(got.node);
      i = got.end;
      while (isWs(text[i]) || text[i] === '#') {
        if (text[i] === '#') while (i < text.length && text[i] !== '\n') i++;
        else i++;
      }
      if (text[i] === ',') i++;
      else if (text[i] !== ']') fail('a comma or a closing bracket');
    }
  }
  if (c === '{') {
    i++;
    const children: TreeNode[] = [];
    for (;;) {
      while (text[i] === ' ' || text[i] === '\t') i++;
      if (text[i] === '}') return { node: { kind: 'map', key, start, end: i + 1, children }, end: i + 1 };
      const km = /^("[^"]*"|'[^']*'|[A-Za-z0-9_-]+)\s*=\s*/.exec(text.slice(i));
      if (!km) fail('a key in the inline table');
      const k = km![1]!.replace(/^["']|["']$/g, '');
      const got = tomlValue(text, i + km![0].length, k, depth + 1);
      children.push(got.node);
      i = got.end;
      while (text[i] === ' ' || text[i] === '\t') i++;
      if (text[i] === ',') i++;
      else if (text[i] !== '}') fail('a comma or a closing brace');
    }
  }
  TOML_SCALAR.lastIndex = i;
  const m = TOML_SCALAR.exec(text);
  if (!m) fail('a value');
  const v = m![0];
  const type: ScalarType = v === 'true' || v === 'false' ? 'bool' : /^\d{4}-|^\d\d:/.test(v) ? 'date' : 'number';
  return { node: { kind: 'scalar', key, start, end: i + v.length, type, value: v }, end: i + v.length };
}

interface MutableNode {
  kind: 'map' | 'list';
  key: string | null;
  start: number;
  end: number;
  children: (TreeNode | MutableNode)[];
}

/**
 * Table names a TOML file may look up: each key of a `[table]` header and each dotted key before a value's own. Past it
 * the parse stops with a TreeError and the file is set as written.
 */
export const TOML_MAX_KEY_STEPS = 250_000;

export function parseToml(text: string): TreeNode {
  const root: MutableNode = { kind: 'map', key: null, start: 0, end: text.length, children: [] };
  let table: MutableNode = root;
  let tableDepth = 0;
  // Each table's children by key, the first written winning as a search in order would: a file of 150,000 headers
  // searched its parent's children line by line, some 10^10 comparisons.
  const byKey = new Map<MutableNode, Map<string, TreeNode | MutableNode>>();
  const put = (parent: MutableNode, node: TreeNode | MutableNode): void => {
    parent.children.push(node);
    if (node.key === null) return;
    let keys = byKey.get(parent);
    if (!keys) byKey.set(parent, (keys = new Map()));
    if (!keys.has(node.key)) keys.set(node.key, node);
  };
  const steps = budget(TOML_MAX_KEY_STEPS);
  const keysOf = (raw: string): string[] => raw.split('.').map((k) => k.trim().replace(/^["']|["']$/g, ''));
  const child = (parent: MutableNode, key: string, at: number, kind: 'map' | 'list'): MutableNode => {
    if (!steps.take()) throw new TreeError(`more than ${figure(TOML_MAX_KEY_STEPS)} table names to look up, which this view does not draw`, at);
    let found = byKey.get(parent)?.get(key) as MutableNode | undefined;
    if (!found) {
      found = { kind, key, start: at, end: at, children: [] };
      put(parent, found);
    }
    if (found.kind !== kind && !(found.kind === 'map' && kind === 'map')) throw new TreeError(`"${key}" to be one kind of table`, at);
    return found;
  };
  let i = 0;
  while (i < text.length) {
    while (isWs(text[i])) i++;
    if (i >= text.length) break;
    const lineEnd = text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i);
    if (text[i] === '#') {
      i = lineEnd;
      continue;
    }
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?[ \t]*(#.*)?$/.exec(text.slice(i, lineEnd).trimEnd());
    if (header) {
      const array = text.startsWith('[[', i);
      const keys = keysOf(header[1]!);
      tableDepth = keys.length + (array ? 1 : 0);
      if (tableDepth > TREE_MAX_DEPTH) throw tooDeep(i);
      let at: MutableNode = root;
      for (const k of keys.slice(0, -1)) {
        const next = child(at, k, i, 'map');
        at = next.kind === 'list' ? (next.children[next.children.length - 1] as MutableNode) : next;
      }
      const last = keys[keys.length - 1]!;
      if (array) {
        const list = child(at, last, i, 'list');
        const item: MutableNode = { kind: 'map', key: null, start: i, end: lineEnd, children: [] };
        list.children.push(item);
        table = item;
      } else {
        table = child(at, last, i, 'map');
        table.start = i;
      }
      i = lineEnd;
      continue;
    }
    const km = /^("[^"]*"|'[^']*'|[A-Za-z0-9_.-]+(?:\s*\.\s*[A-Za-z0-9_-]+)*)\s*=\s*/.exec(text.slice(i, lineEnd));
    if (!km) throw new TreeError('a key = value, or a [table]', i);
    const keys = keysOf(km[1]!);
    if (tableDepth + keys.length > TREE_MAX_DEPTH) throw tooDeep(i);
    let at = table;
    for (const k of keys.slice(0, -1)) at = child(at, k, i, 'map');
    const got = tomlValue(text, i + km[0].length, keys[keys.length - 1]!, tableDepth + keys.length - 1);
    put(at, { ...got.node, start: i });
    for (let up: MutableNode | null = at; up; up = null) up.end = Math.max(up.end, got.end);
    table.end = Math.max(table.end, got.end);
    i = got.end;
    const rest = text.slice(i, text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i));
    if (!/^\s*(#.*)?\r?$/.test(rest)) throw new TreeError('the end of the line after the value', i);
  }
  const freeze = (m: MutableNode | TreeNode): TreeNode =>
    'children' in m && m.children ? { ...m, children: (m.children as (TreeNode | MutableNode)[]).map(freeze) } : (m as TreeNode);
  return freeze(root);
}

// ---- XML -----------------------------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
/** `s` with its references decoded; a character reference past U+10FFFF is not XML, and the file does not read. */
const decodeXml = (s: string, at: number): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, e: string) => {
    if (e[0] !== '#') return own(ENTITIES, e) ?? whole;
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    if (!(code <= 0x10ffff)) throw new TreeError(`a character reference no higher than &#x10FFFF; (${whole})`, at);
    return String.fromCodePoint(code);
  });

export function parseXml(text: string): TreeNode {
  let i = 0;
  const fail = (what: string): never => {
    throw new TreeError(`expected ${what}`, i);
  };
  const skipMisc = (): void => {
    for (;;) {
      while (isWs(text[i])) i++;
      if (text.startsWith('<?', i)) {
        const close = text.indexOf('?>', i);
        if (close < 0) fail('?> to close the declaration');
        i = close + 2;
      } else if (text.startsWith('<!--', i)) {
        const close = text.indexOf('-->', i);
        if (close < 0) fail('--> to close the comment');
        i = close + 3;
      } else if (text.startsWith('<!DOCTYPE', i) || text.startsWith('<!doctype', i)) {
        const close = text.indexOf('>', i);
        if (close < 0) fail('> to close the doctype');
        i = close + 1;
      } else return;
    }
  };
  const element = (depth: number): TreeNode => {
    if (depth >= TREE_MAX_DEPTH) throw tooDeep(i);
    const start = i;
    const m = /^<([A-Za-z_][\w:.-]*)/.exec(text.slice(i));
    if (!m) fail('an element');
    const name = m![1]!;
    i += m![0].length;
    const attrs: { name: string; value: string }[] = [];
    for (;;) {
      while (isWs(text[i])) i++;
      if (text.startsWith('/>', i)) {
        i += 2;
        return { kind: 'element', key: name, start, end: i, attrs, children: [] };
      }
      if (text[i] === '>') {
        i++;
        break;
      }
      const a = /^([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(text.slice(i));
      if (!a) fail(`an attribute or the end of <${name}>`);
      attrs.push({ name: a![1]!, value: decodeXml(a![3] ?? a![4] ?? '', i) });
      i += a![0].length;
    }
    const children: TreeNode[] = [];
    let textRun = '';
    let textAt = -1;
    const flush = (): void => {
      if (textRun.trim() !== '') children.push({ kind: 'scalar', key: null, start: textAt, end: i, type: 'text', value: decodeXml(textRun.trim().replace(/\s+/g, ' '), textAt) });
      textRun = '';
      textAt = -1;
    };
    for (;;) {
      if (i >= text.length) fail(`</${name}>`);
      if (text.startsWith('</', i)) {
        flush();
        const close = new RegExp(`^</${name.replace(/[.]/g, '\\.')}\\s*>`).exec(text.slice(i));
        if (!close) fail(`</${name}>`);
        i += close![0].length;
        return { kind: 'element', key: name, start, end: i, attrs, children };
      }
      if (text.startsWith('<!--', i)) {
        const close = text.indexOf('-->', i);
        if (close < 0) fail('--> to close the comment');
        i = close + 3;
        continue;
      }
      if (text.startsWith('<![CDATA[', i)) {
        const close = text.indexOf(']]>', i);
        if (close < 0) fail(']]> to close the CDATA');
        if (textAt < 0) textAt = i;
        textRun += text.slice(i + 9, close).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        i = close + 3;
        continue;
      }
      if (text[i] === '<') {
        flush();
        children.push(element(depth + 1));
        continue;
      }
      if (textAt < 0) textAt = i;
      textRun += text[i];
      i++;
    }
  };
  skipMisc();
  const root = element(0);
  skipMisc();
  if (i < text.length) fail('the end of the file');
  return root;
}
