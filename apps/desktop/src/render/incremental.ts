// The page again after a reload, replacing only the blocks the change touched (B-24).
//
// A reload of a long document used to render, sanitise and mount the whole of it again, after B-23 had
// already reparsed only the blocks the change touched. Here the new parse is compared with the one the
// page was rendered from, the top-level blocks that differ are rendered and sanitised on their own, and
// they replace the old ones in the DOM; every other block keeps its element, moved only in its
// provenance (`data-marxy-s` / `data-marxy-e`, shifted by the change's length).
//
// The result must be the DOM a whole render would give, byte for byte, so the shortcut is taken only
// where a block's render can be shown not to depend on its neighbours, and anything else is a whole
// render (`spliceRendered` answers `null` with a reason). What can reach across blocks in a render:
//
// - heading ids: GitHub's slugger numbers duplicates in document order, so a heading above can renumber
//   one below. The ids of every heading outside the replaced blocks are compared, old with new, and
//   those inside are compared with what the whole document gives them.
// - footnotes: a definition numbers every reference to it and adds a list at the end. A document that
//   holds one, before or after the change, is rendered whole.
// - the sanitiser's writer keeps one stack of open elements through the whole document, so raw inline
//   HTML that leaves one open (or closes one it never opened) changes what follows. Blocks whose raw tags
//   are not properly nested within the block are rendered whole, and so is everything after one.
//   `truncation` (an element never closed, so the rest is gone) is the same case, reported.
// - what the sanitiser removed, which the notices name: the removals of the replaced blocks come out of
//   the document's list, in the order the whole render gives them, and those of the new blocks go in.
//   Where that cannot be done exactly (the same removal text above and below the change) it is a whole render.
//
// The blocks that stay are found by comparing the two parses node for node (`sameMoved`): a block counts
// as kept only when it is the old block with every range moved by the same number of bytes. The
// sanitiser still runs over every block that is rendered: they go through `renderDocumentSafeHtml`,
// the one pipeline there is (ADR-0009).

import type { Block, Document, Node as AstNode } from '@marxy/core';
import { headingIdsForDocument } from '@marxy/core/src/render/heading-ids.ts';
import { renderDocumentSafeHtml } from '@marxy/core/src/render/index.ts';
import type { RenderRemoval } from '@marxy/core/src/render/pipeline.ts';
import { FOREIGN_ROOTS, RAW_TEXT_ELEMENTS, VOID_ELEMENTS, type Policy } from '@marxy/core/src/sanitize/policy.ts';

/** What a render is known by: enough to splice the next one into it. One per page set from a whole render. */
export interface RenderRecord {
  readonly ast: Document;
  /** Everything the sanitiser took out of the whole document, in the order the render reported it. */
  readonly removed: readonly RenderRemoval[];
  /** The grant the render was made under: a change of it is a whole render. */
  readonly htmlGranted: boolean;
  /** Worked out once, the first time a splice needs them. */
  memo?: { headingIds?: ReadonlyMap<string, string>; clean?: boolean; footnotes?: boolean };
}

export function renderRecord(ast: Document, removed: readonly RenderRemoval[], htmlGranted: boolean): RenderRecord {
  return { ast, removed, htmlGranted };
}

/** Where the article's top-level nodes are: the page, then what a progressive mount has not moved in yet. */
export interface SpliceTarget {
  readonly live: HTMLElement;
  /** The mount's inert container of blocks not yet in the page, or null when there is none. */
  readonly pending: HTMLElement | null;
}

export interface Spliced {
  /** The record of the page as it is now. */
  readonly record: RenderRecord;
  /** The elements now in the page that were not there, top level, in order. */
  readonly added: readonly HTMLElement[];
  /** The first block the grid pass must look at again: the first added, else the one after them, else null. */
  readonly from: HTMLElement | null;
  /** What the sanitiser took out of the whole document, as a whole render would report it. */
  readonly removed: readonly RenderRemoval[];
  /** Top-level blocks kept, and replaced (old count, new count). */
  readonly kept: number;
  readonly replaced: { readonly old: number; readonly new: number };
  /** Elements whose provenance was shifted. */
  readonly shifted: number;
}

export type SpliceResult = { readonly spliced: true; readonly value: Spliced } | { readonly spliced: false; readonly reason: string };

const fell = (reason: string): SpliceResult => ({ spliced: false, reason });

export interface SpliceOptions {
  readonly policy: Policy;
  /** Run on the parsed new blocks before any of them reaches the page (the image pass that drops a `src`). */
  readonly prepare?: (parsed: HTMLElement) => void;
  /** The changed region must be under this share of the document's blocks, or a whole render is as cheap. */
  readonly maxShare?: number;
}

const DIAGRAM_LANGUAGES = new Set(['mermaid', 'plantuml', 'dot', 'd2']);

/**
 * A block that renders to exactly one top-level element carrying its own range (`data-marxy-s` equal to the
 * block's start): the kinds the page can be cut at. A diagram fence also renders a caption with none, and an
 * HTML block, frontmatter or a footnote definition renders none or many.
 */
function isCutPoint(block: Block): boolean {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'thematicBreak':
    case 'blockquote':
    case 'list':
    case 'table':
    case 'mathBlock':
      return true;
    case 'codeBlock': {
      const lang = block.lang ?? '';
      return !DIAGRAM_LANGUAGES.has(lang.toLowerCase()) && !DIAGRAM_LANGUAGES.has(lang.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32)));
    }
    default:
      return false;
  }
}

/** True when `a` is `b` with every range moved by `delta`: the same fields, values and children. */
export function sameMoved(a: unknown, b: unknown, delta: number): boolean {
  if (a === b && (delta === 0 || typeof a !== 'object' || a === null)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameMoved(a[i], b[i], delta)) return false;
    return true;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const key of keys) {
    if (!(key in y)) return false;
    if (key === 'src' || key === 'content') {
      const r = x[key] as { file: string; start: number; end: number };
      const s = y[key] as { file: string; start: number; end: number };
      if (r.file !== s.file || s.start !== r.start + delta || s.end !== r.end + delta) return false;
    } else if (!sameMoved(x[key], y[key], delta)) return false;
  }
  return true;
}

/**
 * True when the raw tags among a block's inline nodes are properly nested within it, so the sanitiser's
 * stack of open elements is where it was when the block started, once the block is done. A tag the
 * sanitiser would take with its contents to a later end tag (`script`, `style`, `svg`, …) does not count.
 */
export function rawTagsBalanced(block: AstNode): boolean {
  const open: string[] = [];
  let ok = true;
  const walk = (node: AstNode): void => {
    if (!ok) return;
    if (node.type === 'html') {
      ok = tagKeepsStack(node.value, open);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(block);
  return ok && open.length === 0;
}

const TAG = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)(?:\s[^>]*)?\/?>$/s;

function tagKeepsStack(value: string, open: string[]): boolean {
  if (value.startsWith('<!') || value.startsWith('<?')) return true; // a comment or a declaration: removed, no element
  const m = TAG.exec(value);
  if (m === null) return false;
  const name = m[2]!.toLowerCase();
  if (RAW_TEXT_ELEMENTS.has(name) || FOREIGN_ROOTS.has(name)) return false;
  if (m[1] === '/') return open.pop() === name;
  if (!VOID_ELEMENTS.has(name)) open.push(name);
  return true;
}

/**
 * The ids the document gives its headings, from the blocks that can hold one (the rest are most of a long
 * document's nodes, and the slugger walks every node of what it is given).
 */
function idsOf(doc: Document): ReadonlyMap<string, string> {
  const holders = doc.children.filter((b) => b.type === 'heading' || b.type === 'blockquote' || b.type === 'list' || b.type === 'footnoteDefinition');
  return headingIdsForDocument({ ...doc, children: holders });
}

function headingIds(record: RenderRecord): ReadonlyMap<string, string> {
  record.memo ??= {};
  return (record.memo.headingIds ??= idsOf(record.ast));
}

function holdsFootnotes(doc: Document): boolean {
  for (const child of doc.children) if (child.type === 'footnoteDefinition') return true;
  return false;
}

/** Every top-level block of the document keeps the sanitiser's stack where it found it. */
function isClean(record: RenderRecord): boolean {
  record.memo ??= {};
  if (record.memo.clean === undefined) record.memo.clean = record.ast.children.every(rawTagsBalanced);
  return record.memo.clean;
}

const keyOf = (start: number, end: number): string => `${start}-${end}`;

/** The document `blocks` make on their own: what the pipeline renders when asked for just them. */
function documentOf(ast: Document, blocks: readonly Block[]): Document {
  return { ...ast, children: blocks };
}

/** An element's range as the page carries it, or null when it has none. */
function rangeOf(el: Element): { start: number; end: number } | null {
  const s = el.getAttribute('data-marxy-s');
  const e = el.getAttribute('data-marxy-e');
  return s === null || e === null ? null : { start: Number(s), end: Number(e) };
}

/** The first top-level element of the page, live then pending, with each given start, and its range checked. */
function findCutElements(target: SpliceTarget, wanted: readonly (Block | null)[]): (HTMLElement | null)[] | null {
  const found: (HTMLElement | null)[] = wanted.map(() => null);
  let missing = wanted.filter((w) => w !== null).length;
  const scan = (parent: HTMLElement | null): void => {
    for (let el = parent?.firstElementChild ?? null; el !== null && missing > 0; el = el.nextElementSibling) {
      const s = el.getAttribute('data-marxy-s');
      if (s === null) continue;
      const start = Number(s);
      wanted.forEach((block, i) => {
        if (block === null || found[i] !== null || block.src.start !== start) return;
        found[i] = el as HTMLElement;
        missing--;
      });
    }
  };
  scan(target.live);
  if (missing > 0) scan(target.pending);
  if (missing > 0) return null;
  for (let i = 0; i < wanted.length; i++) {
    const block = wanted[i];
    const el = found[i];
    if (block === null || el === null) continue;
    const range = rangeOf(el!);
    if (range === null || range.end !== block.src.end) return null;
  }
  return found;
}

/** The nodes of the page strictly between `from` and `to` (the ends when null), live then pending. */
function nodesBetween(target: SpliceTarget, from: Element | null, to: Element | null): Node[] | null {
  const out: Node[] = [];
  let reachedTo = to === null;
  const walk = (first: Node | null): boolean => {
    for (let n = first; n !== null; n = n.nextSibling) {
      if (n === to) {
        reachedTo = true;
        return true;
      }
      out.push(n);
    }
    return false;
  };
  const inLive = from === null || from.parentNode === target.live;
  const stopped = walk(from === null ? target.live.firstChild : from.nextSibling);
  // A region that starts in the page may end in what is still pending.
  if (!stopped && inLive && target.pending !== null) walk(target.pending.firstChild);
  return reachedTo ? out : null;
}

/**
 * Shifts the provenance of every element from `first` on (live, then pending) by `delta`: the blocks after a
 * change are the same blocks, `delta` bytes on.
 */
function shiftFrom(target: SpliceTarget, first: Element | null, delta: number): number {
  if (first === null || delta === 0) return 0;
  let count = 0;
  const shift = (el: Element): void => {
    for (const name of ['data-marxy-s', 'data-marxy-e']) {
      const v = el.getAttribute(name);
      if (v !== null) el.setAttribute(name, String(Number(v) + delta));
    }
    count++;
  };
  const from = (start: Element | null): void => {
    for (let top = start; top !== null; top = top.nextElementSibling) {
      shift(top);
      for (const el of top.querySelectorAll('[data-marxy-s], [data-marxy-e]')) shift(el);
    }
  };
  from(first);
  if (target.pending !== null && first.parentNode !== target.pending) from(target.pending.firstElementChild);
  return count;
}

let inertBody: HTMLElement | null = null;
/**
 * `html`, which has been through the sanitiser, parsed in a document that fetches and runs nothing, so none of
 * it is in the page before it is allowed there: the nodes are the container's children.
 */
export function parseInert(html: string): HTMLElement {
  inertBody ??= document.implementation.createHTMLDocument('').body;
  const holder = inertBody.ownerDocument.createElement('div');
  holder.innerHTML = html;
  return holder;
}

const removalKey = (r: RenderRemoval): string =>
  JSON.stringify([r.what, r.name, r.on, r.value, r.url, r.reason, r.src?.start, r.src?.end]);

/**
 * The document's removals after the replaced blocks' came out and the new blocks' went in, in the order a
 * whole render reports them: those of HTML blocks (they carry the block's range) first, in block order,
 * then the rest, in document order. Null when that cannot be told exactly.
 */
function mergeRemovals(
  all: readonly RenderRemoval[],
  gone: readonly RenderRemoval[],
  came: readonly RenderRemoval[],
  oldLeft: number,
  oldRight: number,
  delta: number,
): RenderRemoval[] | null {
  const islands = all.filter((r) => r.src !== undefined);
  const rest = all.filter((r) => r.src === undefined);
  const outIslands: RenderRemoval[] = [];
  const goneIslands = new Set(gone.filter((r) => r.src !== undefined).map(removalKey));
  let inserted = false;
  const insertCame = (): void => {
    if (inserted) return;
    inserted = true;
    for (const r of came) if (r.src !== undefined) outIslands.push(r);
  };
  const leftOver = new Map<string, number>();
  for (const r of gone) if (r.src !== undefined) leftOver.set(removalKey(r), (leftOver.get(removalKey(r)) ?? 0) + 1);
  for (const r of islands) {
    const src = r.src!;
    if (src.end <= oldLeft) {
      outIslands.push(r);
      continue;
    }
    if (src.start >= oldRight) {
      insertCame();
      outIslands.push(delta === 0 ? r : { ...r, src: { ...src, start: src.start + delta, end: src.end + delta } });
      continue;
    }
    // Inside the replaced blocks: it must be one the old blocks give on their own.
    const key = removalKey(r);
    const left = leftOver.get(key) ?? 0;
    if (left === 0 || !goneIslands.has(key)) return null;
    leftOver.set(key, left - 1);
  }
  insertCame();
  for (const left of leftOver.values()) if (left !== 0) return null;

  // The rest: each key is taken out only where every one of its occurrences is the replaced blocks'.
  const goneRest = gone.filter((r) => r.src === undefined);
  const cameRest = came.filter((r) => r.src === undefined);
  const count = new Map<string, number>();
  for (const r of rest) count.set(removalKey(r), (count.get(removalKey(r)) ?? 0) + 1);
  const goneCount = new Map<string, number>();
  for (const r of goneRest) goneCount.set(removalKey(r), (goneCount.get(removalKey(r)) ?? 0) + 1);
  for (const [key, n] of goneCount) if ((count.get(key) ?? 0) !== n) return null;
  const kept: RenderRemoval[] = [];
  let anchor = -1;
  for (const r of rest) {
    if (goneCount.has(removalKey(r))) {
      if (anchor < 0) anchor = kept.length;
      continue;
    }
    kept.push(r);
  }
  // Where the new ones go is where the old ones were. With none there the place is not known, unless nothing
  // else was removed in this way, and then it is the only place.
  if (cameRest.length > 0 && anchor < 0 && kept.length > 0) return null;
  const out = anchor < 0 ? [...kept, ...cameRest] : [...kept.slice(0, anchor), ...cameRest, ...kept.slice(anchor)];
  return [...outIslands, ...out];
}

/**
 * Replaces in the page the top-level blocks that differ between `before` (what the page was rendered from)
 * and `next`, renders and sanitises just those, and moves the provenance of the blocks after them. On
 * `{ spliced: false }` nothing has been changed and the page must be rendered whole.
 */
export function spliceRendered(before: RenderRecord, next: Document, target: SpliceTarget, opts: SpliceOptions): SpliceResult {
  const old = before.ast;
  if (old.path !== next.path) return fell('another document');
  const n = old.children.length;
  const m = next.children.length;
  const delta = next.src.end - old.src.end;

  // The blocks the two parses share: the same block, in the same place or `delta` bytes on.
  let p = 0;
  const limit = Math.min(n, m);
  while (p < limit && (old.children[p] === next.children[p] || sameMoved(old.children[p], next.children[p], 0))) p++;
  let s = 0;
  while (s < limit - p && sameMoved(old.children[n - 1 - s], next.children[m - 1 - s], delta)) s++;

  if (holdsFootnotes(next)) return fell('a footnote definition applies across the document');
  before.memo ??= {};
  before.memo.footnotes ??= holdsFootnotes(old);
  if (before.memo.footnotes) return fell('a footnote definition applies across the document');
  if (!isClean(before)) return fell('raw HTML leaves an element open across blocks');
  if (before.removed.some((r) => r.what === 'truncation')) return fell('the document was truncated at an element never closed');

  // The cut: extended outward until the blocks next to it each render one element the page can be cut at.
  let from = p;
  while (from > 0 && !isCutPoint(old.children[from - 1]!)) from--;
  let oldTo = n - s;
  while (oldTo < n && !isCutPoint(old.children[oldTo]!)) oldTo++;
  const newTo = m - (n - oldTo);
  if (from === 0 && oldTo === n) return fell('nothing is left to keep');
  const share = Math.max(oldTo - from, newTo - from) / Math.max(n, m, 1);
  if (share > (opts.maxShare ?? 0.5)) return fell('the change is most of the document');

  const oldBlocks = old.children.slice(from, oldTo);
  const newBlocks = next.children.slice(from, newTo);
  for (const block of newBlocks) if (!rawTagsBalanced(block)) return fell('raw HTML leaves an element open across blocks');

  // Heading ids: those outside the replaced blocks are unchanged, and those inside are what the document gives them.
  const oldLeft = from < n ? old.children[from]!.src.start : old.src.end;
  const oldRight = oldTo < n ? old.children[oldTo]!.src.start : old.src.end;
  const oldIds = headingIds(before);
  const newIds = idsOf(next);
  for (const [key, id] of oldIds) {
    const [a, b] = key.split('-').map(Number) as [number, number];
    if (b <= oldLeft) {
      if (newIds.get(key) !== id) return fell('a heading id above the change moved');
    } else if (a >= oldRight) {
      if (newIds.get(keyOf(a + delta, b + delta)) !== id) return fell('a heading id below the change moved');
    }
  }
  const alone = headingIdsForDocument(documentOf(next, newBlocks));
  for (const [key, id] of alone) if (newIds.get(key) !== id) return fell('a heading id inside the change depends on the headings around it');

  // The new blocks, rendered and sanitised as the whole document would render them; and the old ones, for what they removed.
  let oldRemoved: readonly RenderRemoval[] = [];
  let html = '';
  let newRemoved: readonly RenderRemoval[] = [];
  try {
    if (oldBlocks.length > 0) oldRemoved = renderDocumentSafeHtml(documentOf(old, oldBlocks), opts.policy).removed;
    if (newBlocks.length > 0) {
      const result = renderDocumentSafeHtml(documentOf(next, newBlocks), opts.policy);
      html = result.html;
      newRemoved = result.removed;
    }
  } catch {
    return fell('a block could not be rendered on its own');
  }
  if (oldRemoved.some((r) => r.what === 'truncation') || newRemoved.some((r) => r.what === 'truncation')) {
    return fell('the document was truncated at an element never closed');
  }
  const removed = mergeRemovals(before.removed, oldRemoved, newRemoved, oldLeft, oldRight, delta);
  if (removed === null) return fell('what the replaced blocks removed cannot be told apart from the rest');

  // The page: the elements at each end of the cut, found by their ranges.
  const prevBlock = from > 0 ? old.children[from - 1]! : null;
  const nextBlock = oldTo < n ? old.children[oldTo]! : null;
  const cuts = findCutElements(target, [prevBlock, nextBlock]);
  if (cuts === null) return fell('the page is not the render of the document it was said to be');
  const [prevEl, nextEl] = cuts as [HTMLElement | null, HTMLElement | null];
  const between = nodesBetween(target, prevEl, nextEl);
  if (between === null) return fell('the page is not the render of the document it was said to be');

  // What a whole render puts between the two elements: its blocks, a newline on each side that has a neighbour.
  const text =
    prevEl !== null && nextEl !== null
      ? html === '' ? '\n' : `\n${html}\n`
      : prevEl !== null
        ? html === '' ? '' : `\n${html}`
        : html === '' ? '' : `${html}\n`;
  const holder = parseInert(text);
  opts.prepare?.(holder);
  const fresh = [...holder.childNodes];

  // Nothing above this line has touched the page.
  for (const node of between) node.parentNode?.removeChild(node);
  if (nextEl !== null) {
    const parent = nextEl.parentNode!;
    for (const node of fresh) parent.insertBefore(node, nextEl);
  } else {
    const parent = prevEl!.parentNode!;
    for (const node of fresh) parent.appendChild(node);
  }
  const shifted = shiftFrom(target, nextEl, delta);

  const added = fresh.filter((node): node is HTMLElement => node instanceof HTMLElement && node.ownerDocument === target.live.ownerDocument && target.live.contains(node));
  const record: RenderRecord = {
    ast: next,
    removed,
    htmlGranted: before.htmlGranted,
    memo: { headingIds: newIds, clean: true, footnotes: false },
  };
  const first = added[0] ?? (nextEl !== null && target.live.contains(nextEl) ? nextEl : null);
  return {
    spliced: true,
    value: { record, added, from: first, removed, kept: p + s, replaced: { old: oldBlocks.length, new: newBlocks.length }, shifted },
  };
}
