// A JSON file too large to parse whole (question 4), read only as far as its tree is drawn. A fast scan
// counts the values and lists the root's entries without building a value; a streaming parse builds the first values
// from any point and stops between items, counting what is left in each list it stopped in. Both run over the bytes, so
// nothing is decoded but the keys and strings drawn, and every offset here is a byte offset into the file. Pure.
import { TREE_MAX_DEPTH, TreeError, type TreeFrom, type TreeNode } from './tree.ts';

/** One entry of the root map or list, as the scan found it: its key, what it holds and where its value starts. */
export interface RootEntry {
  readonly key: string | null;
  readonly index: number;
  readonly kind: 'map' | 'list' | 'scalar';
  /** A map's keys or a list's items; 0 for a value. */
  readonly size: number;
  readonly start: number;
}

export interface JsonScan {
  /** Every value in the file, the root and each map and list included. */
  readonly values: number;
  readonly root: 'map' | 'list' | 'scalar' | null;
  /** The root's first entries (ROOT_ENTRIES_MAX at most), and how many it has. */
  readonly entries: readonly RootEntry[];
  readonly entryCount: number;
  /** Where the bytes stop being JSON's shape (a bracket that does not close, a string left open), or null. */
  readonly broken: { readonly at: number; readonly why: string } | null;
}

/** Root entries the scan keeps; a root list of a million items is counted, not listed. */
export const ROOT_ENTRIES_MAX = 1000;

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const isWsByte = (c: number | undefined): boolean => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;
/** The bytes a number, `true`, `false` or `null` is made of, and what a malformed one runs on with. */
const isTokenByte = (c: number | undefined): boolean =>
  c !== undefined && ((c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || c === 0x2b || c === 0x2d || c === 0x2e);

const utf8 = new TextDecoder();

function skipWs(b: Uint8Array, i: number): number {
  while (isWsByte(b[i])) i++;
  return i;
}

/** Just past the string whose opening quote is at `i`, or -1 when it never closes. */
function stringEnd(b: Uint8Array, i: number): number {
  let from = i + 1;
  for (;;) {
    const q = b.indexOf(QUOTE, from);
    if (q < 0) return -1;
    let slashes = 0;
    for (let k = q - 1; b[k] === BACKSLASH; k--) slashes++;
    if (slashes % 2 === 0) return q + 1;
    from = q + 1;
  }
}

const bomOf = (b: Uint8Array): number => (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0);

const scans = new WeakMap<Uint8Array, JsonScan>();

/** The values in `bytes`, the root's entries, and whether the brackets and strings close, in one pass. */
export function scanJson(b: Uint8Array): JsonScan {
  const held = scans.get(b);
  if (held) return held;
  let values = 0;
  let root: JsonScan['root'] = null;
  const entries: RootEntry[] = [];
  let entryCount = 0;
  let broken: JsonScan['broken'] = null;
  // Each open container's closer; the scan keeps its depth, never a value.
  let stack = new Uint8Array(64);
  let depth = 0;
  let key: string | null = null;
  let entry: { key: string | null; index: number; kind: RootEntry['kind']; size: number; start: number } | null = null;
  const flush = (): void => {
    if (entry && entries.length < ROOT_ENTRIES_MAX) entries.push(entry);
    entry = null;
  };
  const value = (at: number, kind: RootEntry['kind']): boolean => {
    values++;
    if (depth === 0) {
      if (root !== null) return false;
      root = kind;
    } else if (depth === 1) {
      flush();
      entry = { key: root === 'map' ? key : null, index: entryCount++, kind, size: 0, start: at };
    } else if (depth === 2 && entry) entry.size++;
    return true;
  };
  const n = b.length;
  let i = bomOf(b);
  scan: while (i < n) {
    const c = b[i]!;
    if (isWsByte(c) || c === 0x2c || c === 0x3a) {
      i++;
      continue;
    }
    if (c === QUOTE) {
      const end = stringEnd(b, i);
      if (end < 0) {
        broken = { at: i, why: 'a closing quote' };
        break;
      }
      const after = skipWs(b, end);
      if (b[after] === 0x3a && depth > 0 && stack[depth - 1] === 0x7d) {
        if (depth === 1) {
          const raw = utf8.decode(b.subarray(i + 1, end - 1));
          try {
            key = unescape(raw, i);
          } catch {
            key = raw;
          }
        }
        i = after + 1;
        continue;
      }
      if (!value(i, 'scalar')) {
        broken = { at: i, why: 'the end of the file' };
        break;
      }
      i = end;
      continue;
    }
    if (c === 0x7b || c === 0x5b) {
      if (!value(i, c === 0x7b ? 'map' : 'list')) {
        broken = { at: i, why: 'the end of the file' };
        break;
      }
      if (depth === stack.length) {
        const grown = new Uint8Array(stack.length * 2);
        grown.set(stack);
        stack = grown;
      }
      stack[depth++] = c === 0x7b ? 0x7d : 0x5d;
      i++;
      continue;
    }
    if (c === 0x7d || c === 0x5d) {
      if (depth === 0 || stack[depth - 1] !== c) {
        broken = { at: i, why: depth === 0 ? 'the end of the file' : `${stack[depth - 1] === 0x7d ? 'a closing brace' : 'a closing bracket'}` };
        break;
      }
      depth--;
      if (depth === 0) flush();
      i++;
      continue;
    }
    if (isTokenByte(c)) {
      if (!value(i, 'scalar')) {
        broken = { at: i, why: 'the end of the file' };
        break;
      }
      while (isTokenByte(b[i])) i++;
      continue;
    }
    broken = { at: i, why: 'a value' };
    break scan;
  }
  if (!broken && depth > 0) broken = { at: n, why: stack[depth - 1] === 0x7d ? 'a closing brace' : 'a closing bracket' };
  if (!broken && root === null) broken = { at: n, why: 'a value' };
  flush();
  const out: JsonScan = { values, root, entries, entryCount, broken };
  scans.set(b, out);
  return out;
}

const JSON_ESCAPES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/** A string's text from between its quotes, its escapes read as parseJson reads them; `at` is its opening quote. */
function unescape(raw: string, at: number): string {
  if (raw.includes('\n')) throw new TreeError('expected the string to close before the line ends', at);
  if (!raw.includes('\\')) return raw;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = raw[i + 1];
    if (e === 'u') {
      const hex = raw.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new TreeError('expected four hex digits after \\u', at);
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    const escaped = e !== undefined && Object.hasOwn(JSON_ESCAPES, e) ? JSON_ESCAPES[e] : undefined;
    if (escaped === undefined) throw new TreeError('expected an escape', at);
    out += escaped;
    i++;
  }
  return out;
}

const JSON_SCALAR = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/;

/** Where a list or map stopped being built: how many more entries it has, and where the next one's value starts. */
export interface Cut {
  readonly more: number;
  readonly at: number;
}

export interface JsonStream {
  /** The value drawn from: the root, or the one at `from.path`; a list or map holds the entries built, from `first` on. */
  readonly base: TreeNode;
  readonly first: number;
  /** Each list or map whose entries stop before its end. */
  readonly cut: ReadonlyMap<TreeNode, Cut>;
  /** The keys and indices from the root to `base`, for the crumb. */
  readonly trail: readonly { readonly key: string | null; readonly index: number }[];
}

/**
 * The value at `from.path`, built from its entry `from.from` on until `limit` values are built, then cut between
 * entries; null when the path does not lead anywhere in this file. Throws TreeError where the bytes are not JSON.
 */
export function parseJsonFrom(b: Uint8Array, limit: number, from: TreeFrom = { path: [], from: 0 }, scan?: JsonScan): JsonStream | null {
  const n = b.length;
  let i = skipWs(b, bomOf(b));
  let built = 0;
  const cut = new Map<TreeNode, Cut>();
  const fail = (what: string): never => {
    throw new TreeError(`expected ${what}`, i);
  };
  const str = (): string => {
    if (b[i] !== QUOTE) fail('a string');
    const end = stringEnd(b, i);
    if (end < 0) fail('a closing quote');
    const s = unescape(utf8.decode(b.subarray(i + 1, end - 1)), i);
    i = end;
    return s;
  };
  const skipString = (): void => {
    const end = stringEnd(b, i);
    if (end < 0) fail('a closing quote');
    i = end;
  };
  /** Forward until `levels` more containers close than open, past the last closer. */
  const skipOut = (levels: number): void => {
    let depth = 0;
    for (;;) {
      if (i >= n) fail('a closing bracket');
      const x = b[i]!;
      if (x === QUOTE) {
        skipString();
        continue;
      }
      if (x === 0x7b || x === 0x5b) depth++;
      else if (x === 0x7d || x === 0x5d) {
        depth--;
        if (depth === -levels) {
          i++;
          return;
        }
      }
      i++;
    }
  };
  /** Past one value without building it. */
  const skip = (): void => {
    const c = b[i];
    if (c === QUOTE) return skipString();
    if (c === 0x7b || c === 0x5b) {
      i++;
      return skipOut(1);
    }
    if (!isTokenByte(c)) fail('a value');
    while (isTokenByte(b[i])) i++;
  };
  /** Past `,` or onto the closer; true when the container goes on. */
  const next = (close: number): boolean => {
    i = skipWs(b, i);
    if (b[i] === 0x2c) {
      i = skipWs(b, i + 1);
      return true;
    }
    if (b[i] === close) return false;
    return fail(close === 0x7d ? 'a comma or a closing brace' : 'a comma or a closing bracket');
  };
  /** A map's key and its colon; `i` ends on the value. */
  const keyOf = (): string => {
    const k = str();
    i = skipWs(b, i);
    if (b[i] !== 0x3a) fail('a colon after the key');
    i = skipWs(b, i + 1);
    return k;
  };
  /** The entries left from here to the closer, skipped and counted; `i` ends past the closer. */
  const rest = (close: number): Cut => {
    let more = 0;
    let at = -1;
    i = skipWs(b, i);
    if (b[i] !== close) {
      for (;;) {
        if (close === 0x7d) keyOf();
        if (at < 0) at = i;
        skip();
        more++;
        if (!next(close)) break;
      }
    }
    i++;
    return { more, at };
  };
  /**
   * Whether `i` was left inside the entry just built, which was cut where its count was known from the scan. Then the
   * scan's count of the root and its entries stands in for skipping the rest of the file.
   */
  let inside = false;
  const knownSize = (depth: number, rootIndex: number | null): number | null => {
    if (!scan) return null;
    if (depth === 0) return scan.entryCount;
    return depth === 1 && rootIndex !== null ? (scan.entries[rootIndex]?.size ?? null) : null;
  };
  /** The cut of a container at its entry `k`: how many more it has and where the next starts. */
  const cutAt = (close: number, depth: number, rootIndex: number | null, k: number, within: boolean): Cut => {
    const size = knownSize(depth, rootIndex);
    if (size !== null) {
      const more = size - k;
      let at = -1;
      if (more > 0 && depth === 0 && scan!.entries[k]) at = scan!.entries[k]!.start;
      else if (more > 0) {
        if (within) {
          skipOut(1);
          next(close);
        }
        at = i;
      }
      inside = true;
      return { more, at };
    }
    if (within) {
      skipOut(1);
      if (!next(close)) {
        i++;
        inside = false;
        return { more: 0, at: -1 };
      }
    }
    inside = false;
    return rest(close);
  };
  const value = (key: string | null, depth: number, rootIndex: number | null, skipTo = 0): TreeNode => {
    i = skipWs(b, i);
    const start = i;
    const c = b[i];
    if ((c === 0x7b || c === 0x5b) && depth >= TREE_MAX_DEPTH) throw new TreeError(`nesting more than ${TREE_MAX_DEPTH} levels deep, which this view does not draw`, i);
    if (c === 0x7b || c === 0x5b) {
      const close = c === 0x7b ? 0x7d : 0x5d;
      built++;
      i = skipWs(b, i + 1);
      const children: TreeNode[] = [];
      let stopped: Cut | null = null;
      let closed = false;
      if (b[i] === close) {
        i++;
        closed = true;
      } else {
        for (let j = 0; ; j++) {
          if (j < skipTo) {
            if (close === 0x7d) keyOf();
            skip();
            if (!next(close)) {
              i++;
              closed = true;
              break;
            }
            continue;
          }
          if (built >= limit) {
            stopped = cutAt(close, depth, rootIndex, j, false);
            closed = !inside;
            break;
          }
          const k = close === 0x7d ? keyOf() : null;
          children.push(value(k, depth + 1, depth === 0 ? j : rootIndex));
          if (inside) {
            stopped = cutAt(close, depth, rootIndex, j + 1, true);
            closed = !inside;
            break;
          }
          if (!next(close)) {
            i++;
            closed = true;
            break;
          }
        }
      }
      inside = !closed;
      const end = closed ? i : (children[children.length - 1]?.end ?? start + 1);
      const node: TreeNode = { kind: close === 0x7d ? 'map' : 'list', key, start, end, children };
      if (stopped && stopped.more > 0) cut.set(node, stopped);
      return node;
    }
    built++;
    if (c === QUOTE) {
      const v = str();
      return { kind: 'scalar', key, start, end: i, type: 'string', value: v };
    }
    let e = i;
    while (isTokenByte(b[e])) e++;
    const v = utf8.decode(b.subarray(i, e));
    if (!JSON_SCALAR.test(v)) fail('a value');
    i = e;
    return { kind: 'scalar', key, start, end: i, type: v === 'null' ? 'null' : v === 'true' || v === 'false' ? 'bool' : 'number', value: v };
  };
  // Down the path to the value drawn from, past the entries before each step.
  const trail: { key: string | null; index: number }[] = [];
  for (const step of from.path) {
    const c = b[i];
    if (c !== 0x7b && c !== 0x5b) return null;
    if (trail.length >= TREE_MAX_DEPTH) return null;
    const close = c === 0x7b ? 0x7d : 0x5d;
    i = skipWs(b, i + 1);
    if (b[i] === close) return null;
    let key: string | null = null;
    for (let j = 0; ; j++) {
      if (close === 0x7d) key = keyOf();
      if (j === step) break;
      skip();
      if (!next(close)) return null;
    }
    trail.push({ key, index: step });
  }
  const at = b[i];
  if (from.from > 0 && at !== 0x7b && at !== 0x5b) return null;
  const base = value(trail.length > 0 ? trail[trail.length - 1]!.key : null, trail.length, trail[0]?.index ?? null, from.from);
  if (from.path.length === 0 && from.from === 0 && !inside) {
    i = skipWs(b, i);
    if (i < n) fail('the end of the file');
  }
  return { base, first: from.from, cut, trail };
}

const lineStarts = new WeakMap<Uint8Array, Int32Array>();

/** The line (1-based) holding byte `at`. */
export function lineOfByte(b: Uint8Array, at: number): number {
  let starts = lineStarts.get(b);
  if (!starts) {
    let list = new Int32Array(1024);
    let count = 1;
    for (let k = b.indexOf(0x0a); k !== -1; k = b.indexOf(0x0a, k + 1)) {
      if (count === list.length) {
        const grown = new Int32Array(list.length * 2);
        grown.set(list);
        list = grown;
      }
      list[count++] = k + 1;
    }
    starts = list.subarray(0, count);
    lineStarts.set(b, starts);
  }
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
