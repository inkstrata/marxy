// Line diff over source text, bytes-first. No DOM, no Node built-ins (scripts/check-boundaries.mjs).
//
// A "line" keeps its terminator: `b\n`, `b\r\n`, `b\r` and a last `b` with none are four different
// lines, so a CRLF -> LF conversion or a missing final newline is a change, and every op carries the
// exact UTF-8 byte range it covers on both sides (the unit the AST's provenance uses).
//
// Algorithm: trim the common prefix and suffix; anchor on the common line that occurs least often
// in the region (histogram) and recurse either side; when every common line occurs more than 64
// times, run a Myers shortest-edit search on the region instead. One work budget covers the whole
// call: a region that would exceed it is reported as a coarse delete-then-insert, so no input can
// make the call run long. The result is always a valid edit script; `exact` says whether it is
// also minimal-ish (false once any region was given up on).

export interface DiffOp {
  readonly kind: 'equal' | 'delete' | 'insert';
  /** Line indices, half-open, in A and in B. A delete has an empty B range and an insert an empty A range. */
  readonly aStart: number;
  readonly aEnd: number;
  readonly bStart: number;
  readonly bEnd: number;
  /** UTF-8 byte offsets of the same ranges, half-open. */
  readonly aByteStart: number;
  readonly aByteEnd: number;
  readonly bByteStart: number;
  readonly bByteEnd: number;
}

export interface DiffLinesOptions {
  /** Give up (return null) when either side has more lines than this. Default 50,000. */
  readonly maxLines?: number;
  /** Total work units (line comparisons) before a region degrades to a coarse diff. Default 3,000,000. */
  readonly budget?: number;
}

export const DEFAULT_MAX_LINES = 50_000;
export const DEFAULT_BUDGET = 3_000_000;
/** A common line occurring more often than this in a region is no anchor; Myers takes over. */
const HISTOGRAM_LIMIT = 64;

export type LineSplit = 'any' | 'lf';

export interface LineDiff {
  readonly ops: DiffOp[];
  readonly aLines: string[];
  readonly bLines: string[];
  /** False when the work budget ran out and at least one region was emitted as a coarse replace. */
  readonly exact: boolean;
  /** True when some line has the same text on both sides and a different terminator. */
  readonly eolChanged: boolean;
}

/** Split keeping terminators. 'any' breaks on \r\n, \n and a lone \r; 'lf' only on \n (git's lines). */
export function splitLines(text: string, split: LineSplit): string[] {
  const out: string[] = [];
  let start = 0;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    } else if (c === 13 && split === 'any') {
      const end = text.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
      out.push(text.slice(start, end));
      start = end;
      i = end - 1;
    }
  }
  if (start < n) out.push(text.slice(start));
  return out;
}

/** UTF-8 length of a string without allocating (a lone surrogate counts as U+FFFD, three bytes, as TextEncoder does). */
export function utf8Length(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function byteOffsets(lines: string[]): number[] {
  const out = new Array<number>(lines.length + 1);
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    out[i] = at;
    at += utf8Length(lines[i] as string);
  }
  out[lines.length] = at;
  return out;
}

interface Ctx {
  a: Int32Array;
  b: Int32Array;
  work: number;
  budget: number;
  exact: boolean;
  /** Matched blocks [aStart, bStart, length], in discovery order. */
  matches: Array<[number, number, number]>;
}

/** Diff two texts. Same as `diffLinesDetailed` but only the ops; null when over `maxLines`. */
export function diffLines(a: string, b: string, opts: DiffLinesOptions = {}): DiffOp[] | null {
  return diffLinesDetailed(a, b, 'any', opts)?.ops ?? null;
}

export function diffLinesDetailed(a: string, b: string, split: LineSplit, opts: DiffLinesOptions = {}): LineDiff | null {
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const aLines = splitLines(a, split);
  const bLines = splitLines(b, split);
  if (aLines.length > maxLines || bLines.length > maxLines) return null;

  const intern = new Map<string, number>();
  const ids = (lines: string[]): Int32Array => {
    const out = new Int32Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      let id = intern.get(line);
      if (id === undefined) {
        id = intern.size;
        intern.set(line, id);
      }
      out[i] = id;
    }
    return out;
  };
  const ctx: Ctx = { a: ids(aLines), b: ids(bLines), work: 0, budget: opts.budget ?? DEFAULT_BUDGET, exact: true, matches: [] };
  region(ctx, 0, aLines.length, 0, bLines.length);

  const aOff = byteOffsets(aLines);
  const bOff = byteOffsets(bLines);
  const ops = toOps(ctx.matches, aLines.length, bLines.length, aOff, bOff);
  return { ops, aLines, bLines, exact: ctx.exact, eolChanged: eolChangedIn(ops, aLines, bLines) };
}

function region(ctx: Ctx, a0: number, a1: number, b0: number, b1: number): void {
  const stack: number[] = [a0, a1, b0, b1];
  const { a, b } = ctx;
  while (stack.length > 0) {
    let rb1 = stack.pop() as number;
    let rb0 = stack.pop() as number;
    let ra1 = stack.pop() as number;
    let ra0 = stack.pop() as number;
    // Trim the common prefix and suffix.
    let p = 0;
    while (ra0 + p < ra1 && rb0 + p < rb1 && a[ra0 + p] === b[rb0 + p]) p++;
    if (p > 0) ctx.matches.push([ra0, rb0, p]);
    ra0 += p;
    rb0 += p;
    let s = 0;
    while (ra1 - s > ra0 && rb1 - s > rb0 && a[ra1 - s - 1] === b[rb1 - s - 1]) s++;
    if (s > 0) ctx.matches.push([ra1 - s, rb1 - s, s]);
    ra1 -= s;
    rb1 -= s;
    if (ra0 >= ra1 || rb0 >= rb1) continue;

    ctx.work += ra1 - ra0 + (rb1 - rb0);
    if (ctx.work > ctx.budget) {
      ctx.exact = false;
      continue;
    }

    // Histogram: occurrences of each line in the A region.
    const positions = new Map<number, number[]>();
    for (let i = ra0; i < ra1; i++) {
      const id = a[i] as number;
      const list = positions.get(id);
      if (list) list.push(i);
      else positions.set(id, [i]);
    }
    let bestJ = -1;
    let bestCount = Number.POSITIVE_INFINITY;
    for (let j = rb0; j < rb1; j++) {
      const list = positions.get(b[j] as number);
      if (list && list.length < bestCount) {
        bestCount = list.length;
        bestJ = j;
        if (bestCount === 1) break;
      }
    }
    if (bestJ < 0) continue; // nothing in common: the region is a replace
    if (bestCount > HISTOGRAM_LIMIT) {
      if (!myers(ctx, ra0, ra1, rb0, rb1)) ctx.exact = false;
      continue;
    }
    // Among the anchor line's occurrences in A, take the one whose match extends furthest.
    let bi = -1;
    let bLen = 0;
    let bAStart = 0;
    let bBStart = 0;
    for (const i of positions.get(b[bestJ] as number) as number[]) {
      let u = 0;
      while (i - u > ra0 && bestJ - u > rb0 && a[i - u - 1] === b[bestJ - u - 1]) u++;
      let d = 0;
      while (i + d < ra1 && bestJ + d < rb1 && a[i + d] === b[bestJ + d]) d++;
      if (u + d > bLen) {
        bLen = u + d;
        bi = i;
        bAStart = i - u;
        bBStart = bestJ - u;
      }
    }
    if (bi < 0) continue;
    ctx.matches.push([bAStart, bBStart, bLen]);
    ctx.work += bLen;
    stack.push(ra0, bAStart, rb0, bBStart);
    stack.push(bAStart + bLen, ra1, bBStart + bLen, rb1);
  }
}

/** Myers O(ND) on a region whose ends already differ. False (no matches added) if the budget ran out. */
function myers(ctx: Ctx, a0: number, a1: number, b0: number, b1: number): boolean {
  const { a, b } = ctx;
  const n = a1 - a0;
  const m = b1 - b0;
  const max = n + m;
  const v = new Int32Array(2 * max + 3);
  const off = max + 1;
  const trace: Int32Array[] = [];
  v[off + 1] = 0;
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    ctx.work += d + 1;
    if (ctx.work > ctx.budget) return false;
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[off + k - 1] as number) < (v[off + k + 1] as number))) x = v[off + k + 1] as number;
      else x = (v[off + k - 1] as number) + 1;
      let y = x - k;
      const sx = x;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
        x++;
        y++;
      }
      ctx.work += x - sx;
      v[off + k] = x;
      if (x >= n && y >= m) found = d;
    }
    const slice = new Int32Array(2 * d + 1);
    for (let k = -d; k <= d; k += 2) slice[k + d] = v[off + k] as number;
    trace.push(slice);
    if (ctx.work > ctx.budget) return false;
  }
  if (found < 0) return false;
  let x = n;
  let y = m;
  const found2: Array<[number, number, number]> = [];
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1] as Int32Array;
    const k = x - y;
    const down = k === -d || (k !== d && (prev[k - 1 + d - 1] as number) < (prev[k + 1 + d - 1] as number));
    const prevK = down ? k + 1 : k - 1;
    const prevX = prev[prevK + d - 1] as number;
    const prevY = prevX - prevK;
    const midX = down ? prevX : prevX + 1;
    if (x - midX > 0) found2.push([a0 + midX, b0 + (midX - k), x - midX]);
    x = prevX;
    y = prevY;
  }
  if (x > 0) found2.push([a0, b0, x]);
  for (const mt of found2) ctx.matches.push(mt);
  return true;
}

function toOps(matches: Array<[number, number, number]>, an: number, bn: number, aOff: number[], bOff: number[]): DiffOp[] {
  matches.sort((p, q) => p[0] - q[0]);
  const ops: DiffOp[] = [];
  const push = (kind: DiffOp['kind'], aS: number, aE: number, bS: number, bE: number): void => {
    ops.push({
      kind,
      aStart: aS,
      aEnd: aE,
      bStart: bS,
      bEnd: bE,
      aByteStart: aOff[aS] as number,
      aByteEnd: aOff[aE] as number,
      bByteStart: bOff[bS] as number,
      bByteEnd: bOff[bE] as number,
    });
  };
  const gap = (i: number, j: number, ai: number, bj: number): void => {
    if (ai > i) push('delete', i, ai, j, j);
    if (bj > j) push('insert', ai, ai, j, bj);
  };
  let i = 0;
  let j = 0;
  let pendA = -1;
  let pendB = -1;
  let pendLen = 0;
  const flush = (): void => {
    if (pendLen > 0) push('equal', pendA, pendA + pendLen, pendB, pendB + pendLen);
    pendLen = 0;
  };
  for (const [ai, bj, len] of matches) {
    if (pendLen > 0 && ai === pendA + pendLen && bj === pendB + pendLen) {
      pendLen += len;
    } else {
      flush();
      gap(i, j, ai, bj);
      pendA = ai;
      pendB = bj;
      pendLen = len;
    }
    i = ai + len;
    j = bj + len;
  }
  flush();
  gap(i, j, an, bn);
  return ops;
}

const stripEnding = (line: string): string => (line.endsWith('\r\n') ? line.slice(0, -2) : line.endsWith('\n') || line.endsWith('\r') ? line.slice(0, -1) : line);

/** Within each replaced region, is there a line whose text survives but whose terminator changed? */
function eolChangedIn(ops: DiffOp[], aLines: string[], bLines: string[]): boolean {
  for (let k = 0; k + 1 < ops.length; k++) {
    const del = ops[k] as DiffOp;
    const ins = ops[k + 1] as DiffOp;
    if (del.kind !== 'delete' || ins.kind !== 'insert') continue;
    const seen = new Map<string, string>();
    for (let i = del.aStart; i < del.aEnd; i++) {
      const line = aLines[i] as string;
      const text = stripEnding(line);
      if (!seen.has(text)) seen.set(text, line);
    }
    for (let j = ins.bStart; j < ins.bEnd; j++) {
      const line = bLines[j] as string;
      const was = seen.get(stripEnding(line));
      if (was !== undefined && was !== line) return true;
    }
  }
  return false;
}
