// The change verbs on the cursor's part as pure splices: `d` removes the part, `Alt+↑`/`Alt+↓`
// trade it with the sibling before or after. Each is one range and its replacement bytes, so it lands as one `apply` and
// one undo step. A block's bytes end before its line ending, so a trade moves only the two parts' own bytes and the gap
// between them stays where it was: the trade and its inverse give back the file byte for byte, CRLF and all. Ordered list
// items keep their numbers in place, so a list never starts at a different number.
import type { Block, Document, Source } from '@marxy/core';
import { byteSiblings } from '../selection/selection.ts';

export interface Splice {
  readonly range: { readonly start: number; readonly end: number };
  readonly replacement: Uint8Array;
  /** Where the moved part begins once the splice is made (a removal: where the part was). */
  readonly landed: number;
}

/** The outermost block whose bytes are exactly `start`..`start + length`: the part a splice landed, not the list it opens. */
export function blockSpanning(doc: Document, start: number, length: number): Block | null {
  const walk = (children: readonly Block[]): Block | null => {
    for (const c of children) {
      if (!c.src || c.src.start > start) continue;
      if (c.src.start === start && c.src.end - c.src.start === length) return c;
      if (c.src.end >= start) {
        const inner = walk((c.children ?? []) as Block[]);
        if (inner) return inner;
      }
    }
    return null;
  };
  return walk(doc.children as Block[]);
}

/** The run of sibling blocks `first`..`last` and the siblings around it. Null when they are not siblings. */
function around(doc: Document, first: Block, last: Block): { readonly before: Block | null; readonly after: Block | null } | null {
  const siblings = byteSiblings(doc, first);
  const i = siblings.indexOf(first);
  const j = siblings.indexOf(last);
  if (i < 0 || j < i) return null;
  return { before: siblings[i - 1] ?? null, after: siblings[j + 1] ?? null };
}

/** How many digits the ordered list item `b` opens its marker with (`12.`, `3)`); 0 for any other block. */
function markerDigits(bytes: Uint8Array, b: Block): number {
  if (b.type !== 'listItem') return 0;
  let i = b.src.start;
  while (i < bytes.length && i - b.src.start < 9 && bytes[i]! >= 0x30 && bytes[i]! <= 0x39) i++;
  return i > b.src.start && (bytes[i] === 0x2e || bytes[i] === 0x29) ? i - b.src.start : 0;
}

/**
 * Removes the run `first`..`last` with the gap that parted it from the next sibling (or, for the last, from the one
 * before), so no blank line is left doubled. Alone in its holder, only its own bytes go.
 */
export function removePart(doc: Document, bytes: Uint8Array, first: Block, last: Block): Splice | null {
  const n = around(doc, first, last);
  if (!n) return null;
  // The first item of an ordered list sets its start number: the next item takes over that number, not its own.
  const keep = !n.before && n.after ? markerDigits(bytes, first) : 0;
  const next = keep ? markerDigits(bytes, n.after!) : 0;
  if (keep && next) return { range: { start: first.src.start + keep, end: n.after!.src.start + next }, replacement: new Uint8Array(0), landed: first.src.start };
  const range = n.after ? { start: first.src.start, end: n.after.src.start } : n.before ? { start: n.before.src.end, end: last.src.end } : { start: first.src.start, end: last.src.end };
  return { range, replacement: new Uint8Array(0), landed: range.start };
}

/** Removes the bytes of a section (`sectionRange`), as far as the next heading that ends it. */
export function removeRange(range: Source): Splice {
  return { range: { start: range.start, end: range.end }, replacement: new Uint8Array(0), landed: range.start };
}

/**
 * Trades `a` and `b` (a before b), each its own bytes, the gap between them kept. `digits` keeps the first `da` and `db`
 * bytes of each where they are: the numbers of two ordered list items, so the list starts at the number it did.
 */
export function trade(bytes: Uint8Array, a: { start: number; end: number }, b: { start: number; end: number }, moved: 'a' | 'b', digits: readonly [number, number] = [0, 0]): Splice {
  const [da, db] = digits;
  const left = bytes.subarray(a.start + da, a.end);
  const gap = bytes.subarray(a.end, b.start);
  const right = bytes.subarray(b.start + db, b.end);
  const out = new Uint8Array(b.end - a.start);
  out.set(bytes.subarray(a.start, a.start + da), 0);
  out.set(right, da);
  out.set(gap, da + right.length);
  out.set(bytes.subarray(b.start, b.start + db), da + right.length + gap.length);
  out.set(left, da + right.length + gap.length + db);
  // `a` moves down past `b`: it now starts after b's bytes and the gap. `b` moving up starts where `a` did.
  const landed = moved === 'b' ? a.start : a.start + da + right.length + gap.length;
  return { range: { start: a.start, end: b.end }, replacement: out, landed };
}

/** Moves the run `first`..`last` past the sibling before it (`-1`) or after it (`1`). Null at the edge. */
export function movePart(doc: Document, bytes: Uint8Array, first: Block, last: Block, dir: -1 | 1): Splice | null {
  const n = around(doc, first, last);
  if (!n) return null;
  const run = { start: first.src.start, end: last.src.end };
  const numbers = (x: Block, y: Block): [number, number] => {
    const dx = markerDigits(bytes, x);
    const dy = markerDigits(bytes, y);
    return dx && dy ? [dx, dy] : [0, 0];
  };
  if (dir === 1) return n.after ? trade(bytes, run, n.after.src, 'a', numbers(first, n.after)) : null;
  return n.before ? trade(bytes, n.before.src, run, 'b', numbers(n.before, first)) : null;
}
