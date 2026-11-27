// JSON with comments (what tsconfig.json, .vscode/*.json and devcontainer.json are) and JSON5, as the tree `parseJson`
// makes. Every node keeps its span: comments and the commas around them are trivia between nodes, never part of one, so an
// edit through a node splices only its own range. JSON5's features are all other spellings of a value inside its span (a
// key without quotes, a single-quoted string, a hex number), so none of them costs the file a byte. Pure.
import { own } from '../util/text.ts';
import { TREE_MAX_DEPTH, TreeError, type TreeNode } from './tree.ts';

const JSON_ESCAPES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const JSON5_ESCAPES: Readonly<Record<string, string>> = { ...JSON_ESCAPES, "'": "'", v: '\v', '0': '\0' };
const JSON_SCALAR = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;
/** JSON5's numbers: a sign, hex, a bare or trailing dot, Infinity, NaN. */
const JSON5_NUMBER = /[+-]?(?:Infinity|NaN|0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/y;
// JSON5 IdentifierName: Unicode ID_Start/ID_Continue plus $, _, ZWNJ and ZWJ.
const JSON5_IDENT = /[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*/yu;
const EXTRA_SPACE = new RegExp(String.raw`[\v\f\u00a0\u2028\u2029\ufeff\p{Zs}]`, 'u');

const isWs = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/** `json5` false: comments and trailing commas on top of JSON; true: JSON5 as well. */
export function parseJsonc(text: string, json5 = false): TreeNode {
  let i = 0;
  const fail = (what: string): never => {
    throw new TreeError(`expected ${what}`, i);
  };
  const isSpace = (c: string | undefined): boolean => isWs(c) || (json5 && c !== undefined && EXTRA_SPACE.test(c));
  const skip = (): void => {
    for (;;) {
      while (isSpace(text[i])) i++;
      if (text[i] === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i++;
      } else if (text[i] === '/' && text[i + 1] === '*') {
        const close = text.indexOf('*/', i + 2);
        if (close < 0) fail('*/ to close the comment');
        i = close + 2;
      } else return;
    }
  };
  const str = (): string => {
    const q = text[i];
    if (q !== '"' && !(json5 && q === "'")) fail('a string');
    i++;
    let out = '';
    while (i < text.length && text[i] !== q) {
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
        if (json5 && e === 'x') {
          const hex = text.slice(i + 2, i + 4);
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail('two hex digits after \\x');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
          continue;
        }
        if (json5 && (e === '\n' || e === ' ' || e === ' ')) {
          i += 2;
          continue;
        }
        if (json5 && e === '\r') {
          i += text[i + 2] === '\n' ? 3 : 2;
          continue;
        }
        const escaped = e === undefined ? undefined : own(json5 ? JSON5_ESCAPES : JSON_ESCAPES, e);
        if (escaped === undefined) fail('an escape');
        out += escaped;
        i += 2;
        continue;
      }
      if (c === '\n') fail('the string to close before the line ends');
      out += c;
      i++;
    }
    if (text[i] !== q) fail('a closing quote');
    i++;
    return out;
  };
  const key = (): string => {
    if (json5 && text[i] !== '"' && text[i] !== "'") {
      JSON5_IDENT.lastIndex = i;
      const m = JSON5_IDENT.exec(text);
      if (!m) return fail('a key');
      i += m[0].length;
      return m[0];
    }
    return str();
  };
  const value = (k: string | null, depth: number): TreeNode => {
    skip();
    const start = i;
    const c = text[i];
    if (c === '{' || c === '[') {
      if (depth >= TREE_MAX_DEPTH) throw new TreeError(`nesting more than ${TREE_MAX_DEPTH} levels deep, which this view does not draw`, i);
      const close = c === '{' ? '}' : ']';
      const kind = c === '{' ? 'map' : 'list';
      i++;
      const children: TreeNode[] = [];
      for (;;) {
        skip();
        if (text[i] === close) {
          i++;
          return { kind, key: k, start, end: i, children };
        }
        if (kind === 'map') {
          const name = key();
          skip();
          if (text[i] !== ':') fail('a colon after the key');
          i++;
          children.push(value(name, depth + 1));
        } else children.push(value(null, depth + 1));
        skip();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] !== close) fail(kind === 'map' ? 'a comma or a closing brace' : 'a comma or a closing bracket');
      }
    }
    if (c === '"' || (json5 && c === "'")) {
      const v = str();
      return { kind: 'scalar', key: k, start, end: i, type: 'string', value: v };
    }
    const scalar = json5 ? JSON5_NUMBER : JSON_SCALAR;
    scalar.lastIndex = i;
    let m = scalar.exec(text);
    if (!m && json5) {
      JSON_SCALAR.lastIndex = i;
      m = JSON_SCALAR.exec(text);
    }
    if (!m) return fail('a value');
    i += m[0].length;
    const v = m[0];
    return { kind: 'scalar', key: k, start, end: i, type: v === 'null' ? 'null' : v === 'true' || v === 'false' ? 'bool' : 'number', value: v };
  };
  const root = value(null, 0);
  skip();
  if (i < text.length) fail('the end of the file');
  return root;
}
