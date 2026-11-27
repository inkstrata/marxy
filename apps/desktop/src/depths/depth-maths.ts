// What the depths work out without the page: which sections `Z` folds, what a fold holds, and
// where a part's range goes after an edit. Pure.
import { sectionRange, type Block, type Document, type Heading } from '@marxy/core';
import type { Transition } from '../document/store.ts';

export interface Range {
  readonly start: number;
  readonly end: number;
}

/**
 * The index of the first top-level block that starts at or after `byte`: the blocks are in source order. Fold-all
 * looks up every heading, and a scan per heading made 100,000 of them quadratic.
 */
function firstFrom(doc: Document, byte: number): number {
  let lo = 0;
  let hi = doc.children.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (doc.children[mid]!.src.start < byte) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The top-level heading whose range is exactly `r`, or null. */
export function headingAt(doc: Document, r: Range): Heading | null {
  for (let i = firstFrom(doc, r.start); i < doc.children.length && doc.children[i]!.src.start === r.start; i++) {
    const b = doc.children[i]!;
    if (b.type === 'heading' && b.src.end === r.end) return b;
  }
  return null;
}

/** The innermost top-level section that holds the top-level block `block` (the nearest heading before it), or null. */
export function sectionOf(doc: Document, block: Block): Heading | null {
  const at = doc.children.indexOf(block);
  for (let i = at - 1; i >= 0; i--) {
    const b = doc.children[i]!;
    if (b.type === 'heading' && sectionRange(doc, b).end >= block.src.end) return b;
  }
  return null;
}

/** What a folded section hides: the top-level blocks after its heading and inside its range. */
export function foldedBlocks(doc: Document, heading: Heading): Block[] {
  const end = sectionRange(doc, heading).end;
  const out: Block[] = [];
  for (let i = firstFrom(doc, heading.src.end); i < doc.children.length && doc.children[i]!.src.end <= end; i++) out.push(doc.children[i]!);
  return out;
}

/**
 * The headings `Z` folds, "to the second level": the level under the title when the shallowest level is a single title,
 * else the shallowest level. Only headings with something under them are folded.
 */
export function foldAllHeadings(doc: Document): Heading[] {
  const heads = doc.children.filter((b): b is Heading => b.type === 'heading');
  if (heads.length === 0) return [];
  // Loops, not Math.min(...levels): a heading per argument is past the engine's limit in a long document.
  let top = 6;
  for (const h of heads) if (h.level < top) top = h.level;
  const titles = heads.filter((h) => h.level === top).length;
  let next = 7;
  for (const h of heads) if (h.level > top && h.level < next) next = h.level;
  const level = titles === 1 && next <= 6 ? next : top;
  return heads.filter((h) => {
    if (h.level !== level) return false;
    // Something is under it when the block right after it is inside its section.
    const after = doc.children[firstFrom(doc, h.src.end)];
    return after !== undefined && after.src.end <= sectionRange(doc, h).end;
  });
}

/** The words a folded heading carries: how many parts and lines are inside. */
export function foldCount(parts: number, lines: number): string {
  const n = (k: number, w: string): string => `${k} ${w}${k === 1 ? '' : 's'}`;
  return `${n(parts, 'part')}, ${n(lines, 'line')}`;
}

interface Splice {
  readonly start: number;
  readonly removed: number;
  readonly inserted: number;
}

/** The one splice a reload made, read off its bytes: the common head and tail kept, the run between them replaced. */
export function reloadSplice(before: Uint8Array, after: Uint8Array): Splice {
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before[start] === after[start]) start++;
  let tail = 0;
  while (tail < limit - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return { start, removed: before.length - tail - start, inserted: after.length - tail - start };
}

/** The bytes an edit transition replaced and what replaced them, at `start`; null for one that did not splice. */
function editOf(change: Transition): { readonly start: number; readonly from: Uint8Array; readonly to: Uint8Array } | null {
  if (change.kind !== 'apply' && change.kind !== 'commitSource' && change.kind !== 'undo' && change.kind !== 'redo') return null;
  const { edit } = change;
  const [from, to] = change.kind === 'undo' ? [edit.after, edit.before] : [edit.before, edit.after];
  return { start: edit.range.start, from, to };
}

/**
 * The splices, last first, when `to` only adds bytes to `from` or only takes some away: a section promoted or demoted,
 * one `#` per heading, whose folds and x-rays then stay on their parts. Null for any other change.
 */
function scattered(start: number, from: Uint8Array, to: Uint8Array): Splice[] | null {
  if (from.length === to.length) return null;
  const cut = from.length > to.length;
  const [long, short] = cut ? [from, to] : [to, from];
  const out: Splice[] = [];
  let j = 0;
  let added = 0;
  for (let i = 0; i < long.length; i++) {
    if (j < short.length && long[i] === short[j]) {
      j++;
      continue;
    }
    const last = out[out.length - 1];
    const at = start + (cut ? i : i - added);
    if (last && (cut ? last.start + last.removed === at : last.start === at)) out[out.length - 1] = cut ? { ...last, removed: last.removed + 1 } : { ...last, inserted: last.inserted + 1 };
    else out.push(cut ? { start: at, removed: 1, inserted: 0 } : { start: at, removed: 0, inserted: 1 });
    if (!cut) added++;
  }
  return j === short.length ? out.reverse() : null;
}

/** `to` as `from` turned at a line start (two sections swapped, the second now first): where the second began, or -1. */
function turnedAt(from: Uint8Array, to: Uint8Array): number {
  const n = from.length;
  if (n !== to.length) return -1;
  // Repeated lines could make every line start a long near-match: past this many bytes compared it is no swap.
  let budget = 1 << 22;
  const same = (a: number, b: number, len: number): boolean => {
    for (let i = 0; i < len; i++) if (--budget < 0 || from[a + i] !== to[b + i]) return false;
    return true;
  };
  for (let k = 1; k < n && budget > 0; k++) if (from[k - 1] === 0x0a && same(k, 0, n - k) && same(0, n - k, k)) return k;
  return -1;
}

/**
 * `r` in the bytes after `change`: an edit before it moves it, one inside it (or replacing it whole) moves its end; one
 * that took its start away from before it, or removed all of it, is null: the part is gone. A reload carries no splice:
 * `bytes` (before and after it) give one, and without them the range is dropped, never left on bytes it no longer names.
 * An edit that only added or took away bytes here and there, or swapped two runs of lines, keeps the parts it moved.
 */
export function mapRange(change: Transition, r: Range, bytes?: { readonly before: Uint8Array; readonly after: Uint8Array }): Range | null {
  if (change.kind === 'reload') return bytes ? through(reloadSplice(bytes.before, bytes.after), r) : null;
  const e = editOf(change);
  if (e === null) return r;
  const k = turnedAt(e.from, e.to);
  if (k > 0) {
    const n = e.from.length;
    const split = e.start + k;
    if (r.end <= e.start || r.start >= e.start + n) return r;
    if (r.start >= e.start && r.end <= split) return { start: r.start + n - k, end: r.end + n - k };
    if (r.start >= split && r.end <= e.start + n) return { start: r.start - k, end: r.end - k };
    return null;
  }
  const many = scattered(e.start, e.from, e.to);
  if (many === null) return through({ start: e.start, removed: e.from.length, inserted: e.to.length }, r);
  let out: Range | null = r;
  for (const s of many) out = out && through(s, out);
  return out;
}

function through(s: Splice, r: Range): Range | null {
  const cut = s.start + s.removed;
  const delta = s.inserted - s.removed;
  if (cut <= r.start) return { start: r.start + delta, end: r.end + delta };
  if (s.start >= r.end) return r;
  if (s.start >= r.start && cut <= r.end) return r.end + delta > r.start ? { start: r.start, end: r.end + delta } : null;
  if (s.start < r.start) return null;
  return { start: r.start, end: s.start + s.inserted };
}
