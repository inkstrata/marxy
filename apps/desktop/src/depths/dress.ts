// The four depths of looking at a part in Rendered (the prototype's `A.dress`): x-ray boxes in
// place of parts, Reveal's marks around the reading, folded sections, and the one part shown alone. The state is the
// pane's, kept beside its article in memory only; the page is dressed again after every page set, and the ranges it
// names follow edits through the store's transitions (a part an edit removed is dropped).
import { invisibleSegments } from '@marxy/core/src/render/index.ts';
import { sectionRange, type Document, type Heading, type Node } from '@marxy/core';
import type { DocumentSnapshot, DocumentStore, Transition } from '../document/store.ts';
import { appendInvisibleSegments } from '../render/invisibles-dom.ts';
import { lineSpan } from '../selection/cursor.ts';
import { foldCount, foldedBlocks, headingAt, mapRange, type Range } from './depth-maths.ts';
import { revealMarks, type MarkPlace, type RevealMark } from './reveal-marks.ts';
import { endGlyph, endingsOf, xrayLines, xrayPieces, type LineEnd } from './xray-lines.ts';
import { kindRevealOn } from '../parts/kind-reveal.ts';

/** One pane's article as the depths read it: its page, its document's store, and its progressive mount. */
export interface DepthTarget {
  readonly article: HTMLElement;
  store(): DocumentStore | null;
  mountThrough(byte: number): void;
}

interface DepthState {
  target: DepthTarget;
  path: string | null;
  xrays: Range[];
  reveal: boolean;
  /** Folded sections, by their heading's range. */
  folds: Range[];
  focus: Range | null;
  /** A lens (depths/lens.ts, the Metadata panel): only the parts that hold one of its ranges shown. `label` is its words. */
  lens: { readonly id: string; readonly label: string; ranges: Range[] } | null;
  /** The store version the ranges above are in, and the one the page was last set from. */
  version: number;
  /** That version's bytes: a reload is mapped from them. */
  bytes: Uint8Array | null;
  rendered: number;
  store: DocumentStore | null;
  offStore: () => void;
}

const states = new WeakMap<HTMLElement, DepthState>();
const listeners = new Set<() => void>();

const XRAY = 'marxy-xray';
const XRAYED = 'marxy-xrayed';
const MARK = 'marxy-reveal-mark';
const ELIDE = 'marxy-elide';
const FOLDED = 'marxy-folded';
const FOLD_OUT = 'marxy-fold-out';
const FOCUS_OUT = 'marxy-focus-out';
const REVEAL_ATTR = 'data-marxy-reveal';
const FOLD_ATTR = 'data-marxy-folded';
const LENS_ATTR = 'data-marxy-lens';

/** The part each x-rayed element stands in the page by: its box. */
const boxOf = new WeakMap<Element, HTMLElement>();

const same = (a: Range, b: Range): boolean => a.start === b.start && a.end === b.end;
const within = (inner: Range, outer: Range): boolean => inner.start >= outer.start && inner.end <= outer.end;

function rangeAttr(el: Element): Range | null {
  const s = el.getAttribute('data-marxy-s');
  const e = el.getAttribute('data-marxy-e');
  return s === null || e === null ? null : { start: Number(s), end: Number(e) };
}

/** A top-level element's range: its own, or its first carrier's. */
function unitRange(el: Element): Range | null {
  return rangeAttr(el) ?? (() => {
    const inner = el.querySelector('[data-marxy-s][data-marxy-e]');
    return inner ? rangeAttr(inner) : null;
  })();
}

const ownNode = (el: Element): boolean => el.classList.contains(XRAY) || el.classList.contains(ELIDE) || el.classList.contains(MARK);

/** A code block's carrier is its `code`; the block on the page is the `pre` around it. */
const shown = (el: Element): Element => (el.localName === 'code' && el.parentElement?.localName === 'pre' ? el.parentElement : el);

function stateFor(target: DepthTarget): DepthState {
  let st = states.get(target.article);
  if (!st) {
    st = { target, path: null, xrays: [], reveal: false, folds: [], focus: null, lens: null, version: -1, bytes: null, rendered: -1, store: null, offStore: () => {} };
    states.set(target.article, st);
  }
  st.target = target;
  return st;
}

function stateOf(article: HTMLElement): DepthState | null {
  return states.get(article) ?? null;
}

function undress(article: HTMLElement): void {
  for (const el of article.querySelectorAll(`.${XRAY}, .${MARK}, .${ELIDE}`)) el.remove();
  for (const el of article.querySelectorAll(`.${XRAYED}, .${FOLD_OUT}, .${FOCUS_OUT}, .${FOLDED}`)) {
    el.classList.remove(XRAYED, FOLD_OUT, FOCUS_OUT, FOLDED);
    el.removeAttribute(FOLD_ATTR);
  }
  article.removeAttribute(REVEAL_ATTR);
  article.removeAttribute(LENS_ATTR);
}

const empty = (st: DepthState): boolean => st.xrays.length === 0 && st.folds.length === 0 && st.focus === null && st.lens === null;

function followStore(st: DepthState, store: DocumentStore | null): void {
  if (st.store === store) return;
  st.offStore();
  st.store = store;
  st.offStore = () => {};
  if (!store) return;
  st.version = store.snapshot().version;
  st.bytes = store.snapshot().buffer.bytes;
  st.offStore = store.subscribe((snap, change) => moved(st, snap, change));
}

/** A transition of the pane's document: the ranges follow it, and the page is dressed again once it shows these bytes. */
function moved(st: DepthState, snap: DocumentSnapshot, change: Transition): void {
  if (change.kind === 'close' || change.kind === 'open') {
    st.xrays = [];
    st.folds = [];
    st.focus = null;
    st.lens = null;
  } else {
    const bytes = st.bytes ? { before: st.bytes, after: snap.buffer.bytes } : undefined;
    const map = (list: Range[]): Range[] => list.flatMap((r) => mapRange(change, r, bytes) ?? []);
    st.xrays = map(st.xrays);
    st.folds = map(st.folds);
    st.focus = st.focus && mapRange(change, st.focus, bytes);
    if (st.lens) st.lens.ranges = map(st.lens.ranges);
  }
  st.version = snap.version;
  st.bytes = snap.buffer.bytes;
  if (st.rendered === snap.version) dress(st);
}

/**
 * The pane's page was set: dress it with what the pane holds. Called after each page set (the selection's
 * `afterRender`), for every pane.
 */
export function dressDepths(target: DepthTarget): void {
  const st = states.get(target.article);
  // A pane that never used a depth has nothing to take off or put on.
  if (!st) return;
  st.target = target;
  const store = target.store();
  followStore(st, store);
  const snap = store?.snapshot();
  if (!snap) {
    st.xrays = [];
    st.folds = [];
    st.focus = null;
    st.lens = null;
    undress(target.article);
    return;
  }
  st.rendered = snap.version;
  // The store has moved past the ranges: its subscriber maps them and dresses the page then.
  if (st.version !== snap.version) {
    undress(target.article);
    return;
  }
  dress(st);
}

function dress(st: DepthState): void {
  const { article } = st.target;
  const snap = st.target.store()?.snapshot();
  undress(article);
  if (!snap) return;
  if (st.path !== snap.path) {
    if (st.path !== null) {
      st.xrays = [];
      st.folds = [];
      st.focus = null;
      st.lens = null;
    }
    st.path = snap.path;
  }
  const doc = snap.ast;
  const bytes = snap.buffer.bytes;
  // A long page mounts progressively; a fold, Reveal or the part alone speak for the whole of it.
  if (st.reveal || st.folds.length > 0 || st.focus || st.lens) st.target.mountThrough(bytes.length);
  if (st.reveal) putReveal(article, doc, bytes);
  if (st.folds.length > 0) st.folds = putFolds(article, doc, bytes, st.folds);
  if (st.focus) putFocus(article, [st.focus], bytes);
  else if (st.lens) {
    putFocus(article, st.lens.ranges, bytes);
    article.setAttribute(LENS_ATTR, st.lens.label);
  }
  st.xrays = st.xrays.filter((x) => putXray(st.target, bytes, x));
  markCurrent();
  for (const cb of [...listeners]) cb();
}

/* ---------- folds ---------- */

/** The article's top-level elements with the range each stands for; one with none (a diagram's caption) takes the next one's. */
function topUnits(article: HTMLElement): { el: Element; range: Range | null }[] {
  const out = [...article.children].filter((el) => !ownNode(el)).map((el) => ({ el, range: unitRange(el) }));
  for (let i = out.length - 2; i >= 0; i--) if (out[i]!.range === null && out[i]!.el.localName !== 'hr') out[i]!.range = out[i + 1]!.range;
  return out;
}

const headingSelector = (node: Node): string => `[data-marxy-s="${node.src.start}"][data-marxy-e="${node.src.end}"]`;

function elementOf(article: HTMLElement, node: Node): Element | null {
  return article.querySelector(headingSelector(node));
}

/**
 * Puts the folds on the page and returns the ones that still have their heading. The page's parts are read once
 * and each is hidden when some fold holds it: fold-all on a long document is a fold per heading, and a walk of
 * every part per fold made that quadratic.
 */
function putFolds(article: HTMLElement, doc: Document, bytes: Uint8Array, folds: readonly Range[]): Range[] {
  const units = topUnits(article);
  const byRange = new Map<string, Element>();
  for (const { el, range } of units) if (range && !byRange.has(`${range.start}:${range.end}`)) byRange.set(`${range.start}:${range.end}`, el);
  const kept: Range[] = [];
  // What each fold hides, as [from, to): the bytes after its heading to its section's end.
  const hides: [number, number][] = [];
  for (const fold of folds) {
    const heading = headingAt(doc, fold);
    const mapped = heading && byRange.get(`${heading.src.start}:${heading.src.end}`);
    const headEl = heading && (mapped?.matches(headingSelector(heading)) ? mapped : elementOf(article, heading));
    if (!heading || !headEl) continue;
    const end = sectionRange(doc, heading).end;
    hides.push([heading.src.end, end]);
    const lines = lineSpan(bytes, heading.src.start, end).last - lineSpan(bytes, heading.src.start, heading.src.end).last;
    headEl.classList.add(FOLDED);
    headEl.setAttribute(FOLD_ATTR, foldCount(foldedBlocks(doc, heading).length, lines));
    kept.push(fold);
  }
  hides.sort((a, b) => a[0] - b[0]);
  // The furthest end of any fold starting at or before each one, so one search answers "does some fold hold it".
  const reach: number[] = [];
  for (const [, to] of hides) reach.push(Math.max(to, reach[reach.length - 1] ?? -Infinity));
  for (const { el, range } of units) {
    if (!range) continue;
    let lo = 0;
    let hi = hides.length - 1;
    let last = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (hides[mid]![0] <= range.start) {
        last = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (last >= 0 && reach[last]! >= range.end) el.classList.add(FOLD_OUT);
  }
  return kept;
}

/* ---------- the part alone ---------- */

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function putFocus(article: HTMLElement, keep: readonly Range[], bytes: Uint8Array): void {
  const meets = (r: Range): boolean => keep.some((k) => r.start < k.end && r.end > k.start);
  const inKept = (r: Range): boolean => keep.some((k) => within(r, k));
  const elide = (run: { el: Element; range: Range | null }[]): void => {
    if (run.length === 0) return;
    const ranged = run.filter((u) => u.range !== null);
    const first = ranged[0]?.range;
    const last = ranged.at(-1)?.range;
    const row = document.createElement('div');
    row.className = ELIDE;
    row.setAttribute('role', 'button');
    const lines = first && last ? lineSpan(bytes, first.start, last.end) : null;
    const words = `${plural(ranged.length, 'part')}${lines ? ` · lines ${lines.first}–${lines.last}` : ''}`;
    row.setAttribute('data-marxy-elide', words);
    row.setAttribute('aria-label', `${words} left out. Show them all.`);
    row.addEventListener('click', () => {
      const st = stateOf(article);
      if (st)
        change(st.target, (s) => {
          s.focus = null;
          s.lens = null;
        });
    });
    run[0]!.el.before(row);
  };
  const inside = (container: Element): void => {
    for (const el of [...container.children]) {
      if (ownNode(el)) continue;
      const range = unitRange(el);
      if (!range) continue;
      if (!meets(range)) el.classList.add(FOCUS_OUT);
      else if (!inKept(range)) inside(el);
    }
  };
  let run: { el: Element; range: Range | null }[] = [];
  for (const unit of topUnits(article)) {
    const { el, range } = unit;
    if (range && inKept(range)) {
      elide(run);
      run = [];
    } else if (range && meets(range)) {
      elide(run);
      run = [];
      inside(el);
    } else {
      el.classList.add(FOCUS_OUT);
      run.push(unit);
    }
  }
  elide(run);
}

/* ---------- x-ray ---------- */

/** The elements standing for `[start, end)`: every carrier inside it whose nearest carrier above is not. */
function outermost(article: HTMLElement, r: Range): Element[] {
  const out: Element[] = [];
  for (const el of article.querySelectorAll('[data-marxy-s][data-marxy-e]')) {
    const own = rangeAttr(el)!;
    if (!within(own, r)) continue;
    const up = el.parentElement?.closest('[data-marxy-s][data-marxy-e]');
    if (up && article.contains(up) && within(rangeAttr(up)!, r)) continue;
    const block = shown(el);
    if (!out.includes(block)) out.push(block);
  }
  return out;
}

const endingsKept = new WeakMap<Uint8Array, ReadonlySet<LineEnd>>();

function xrayBox(bytes: Uint8Array, r: Range): HTMLElement {
  let endings = endingsKept.get(bytes);
  if (!endings) endingsKept.set(bytes, (endings = endingsOf(bytes)));
  const x = xrayLines(bytes, r.start, r.end, endings);
  const first = x.lines[0]!.number;
  const last = x.lines.at(-1)!.number;
  const where = first === last ? `line ${first}` : `lines ${first}–${last}`;
  const box = document.createElement('div');
  box.className = XRAY;
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', `As written, ${where}`);
  box.setAttribute('data-marxy-xray', `${r.start}-${r.end}`);
  const head = document.createElement('div');
  head.className = 'marxy-xray-head';
  head.setAttribute('data-marxy-xray-head', `As written · ${where}`);
  box.append(head);
  x.lines.forEach((line, i) => {
    const row = document.createElement('div');
    row.className = 'marxy-xray-line';
    row.setAttribute('data-marxy-line', String(line.number));
    const text = document.createElement('span');
    text.className = 'marxy-xray-text';
    const end = x.showEnds ? endGlyph(line.end) : '';
    if (i === x.lines.length - 1 && x.noFinalNewline) {
      text.setAttribute('data-marxy-eol', '∅');
      row.title = 'No line break at the end of the file';
    } else if (end) text.setAttribute('data-marxy-eol', end);
    for (const piece of xrayPieces(line.text)) {
      if (piece.kind === 'text') appendInvisibleSegments(text, invisibleSegments(piece.value, { inCode: true, sourceStart: 1 }));
      else {
        const ws = document.createElement('span');
        ws.className = piece.kind === 'tab' ? 'marxy-xray-tab' : 'marxy-xray-space';
        ws.textContent = piece.kind === 'tab' ? '\t' : ' ';
        text.append(ws);
      }
    }
    row.append(text);
    box.append(row);
  });
  return box;
}

function putXray(target: DepthTarget, bytes: Uint8Array, r: Range): boolean {
  target.mountThrough(r.start);
  const els = outermost(target.article, r);
  if (els.length === 0) return false;
  const box = xrayBox(bytes, r);
  els[0]!.before(box);
  for (const el of els) {
    el.classList.add(XRAYED);
    boxOf.set(el, box);
  }
  return true;
}

/** The selection's range, for marking the x-ray box the cursor is in. Set by the commands' side, which knows it. */
let cursorRange: () => { article: HTMLElement; range: Range } | null = () => null;
export function setCursorRangeSource(read: typeof cursorRange): void {
  cursorRange = read;
}

/** The box the cursor is in looks as a part under the cursor does. */
export function markCurrent(): void {
  const at = cursorRange();
  for (const box of document.querySelectorAll(`.${XRAY}`)) {
    const [s, e] = (box.getAttribute('data-marxy-xray') ?? '').split('-').map(Number);
    const on = at !== null && box.parentElement !== null && at.article.contains(box) && within(at.range, { start: s!, end: e! });
    box.classList.toggle('marxy-xray-current', on);
  }
}

/* ---------- Reveal ---------- */

const TAGS: Partial<Record<Node['type'], readonly string[]>> = {
  heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  paragraph: ['p'],
  listItem: ['li'],
  emphasis: ['em'],
  strong: ['strong'],
  strikethrough: ['del'],
  code: ['code'],
  link: ['a'],
  image: ['img'],
  taskMarker: ['input'],
  codeBlock: ['pre', 'code'],
  thematicBreak: ['hr'],
  frontmatter: ['dl'],
};

const marksKept = new WeakMap<Document, RevealMark[]>();

function markEl(text: string, place: MarkPlace): HTMLElement {
  const el = document.createElement('span');
  el.className = place === 'hang' ? `${MARK} marxy-reveal-hang` : place === 'line-before' || place === 'line-after' ? `${MARK} marxy-reveal-line` : MARK;
  el.textContent = text;
  return el;
}

/** A mark for what made no element, before the first top-level part at or after byte `end`, else at the page's end. */
function putGap(article: HTMLElement, mark: HTMLElement, end: number): void {
  for (const el of article.children) {
    if (ownNode(el)) continue;
    const r = unitRange(el);
    if (r && r.start >= end) {
      el.before(mark);
      return;
    }
  }
  article.append(mark);
}

function putReveal(article: HTMLElement, doc: Document, bytes: Uint8Array): void {
  article.setAttribute(REVEAL_ATTR, '');
  let marks = marksKept.get(doc);
  if (!marks) marksKept.set(doc, (marks = revealMarks(doc, bytes)));
  const byRange = new Map<string, Element[]>();
  for (const el of article.querySelectorAll('[data-marxy-s][data-marxy-e]')) {
    if (el.closest('[data-marxy-derived]')) continue;
    const key = `${el.getAttribute('data-marxy-s')}-${el.getAttribute('data-marxy-e')}`;
    const list = byRange.get(key);
    if (list) list.push(el);
    else byRange.set(key, [el]);
  }
  for (const m of marks) {
    if (m.place === 'gap') {
      putGap(article, markEl(m.text, 'line-before'), m.end);
      continue;
    }
    const tags = TAGS[m.type];
    const found = byRange.get(`${m.start}-${m.end}`)?.find((el) => tags?.includes(el.localName));
    if (!found) continue;
    const el = m.type === 'codeBlock' ? shown(found) : found;
    const mark = markEl(m.text, m.place);
    switch (m.place) {
      case 'open':
        el.prepend(mark);
        break;
      case 'close':
        el.append(mark);
        break;
      case 'before':
      case 'line-before':
        el.before(mark);
        break;
      case 'after':
      case 'line-after':
        el.after(mark);
        break;
      case 'hang': {
        // A loose item's text is in its paragraph: the marker hangs at that paragraph's start.
        const first = el.firstElementChild;
        (first && first.localName === 'p' && el.firstChild === first ? first : el).prepend(mark);
        break;
      }
    }
  }
}

/* ---------- what the commands and the page ask ---------- */

/** Whether Reveal is on for the pane. */
export function revealOn(pane: { readonly article: HTMLElement }): boolean {
  return stateOf(pane.article)?.reveal === true || kindRevealOn(pane.article);
}

/** Tells whoever follows the depths (the head's chip) that one changed outside a dressing: a kind's Reveal. */
export function depthsChanged(): void {
  for (const cb of [...listeners]) cb();
}

/** Whether the pane shows one part alone. */
export function focusOn(article: HTMLElement): boolean {
  return stateOf(article)?.focus != null;
}

/** The ranges x-rayed in the pane, and the sections folded there, by their headings' ranges. */
export function depthsOf(article: HTMLElement): { xrays: readonly Range[]; folds: readonly Range[]; focus: Range | null; reveal: boolean } {
  const st = stateOf(article);
  return { xrays: st?.xrays ?? [], folds: st?.folds ?? [], focus: st?.focus ?? null, reveal: st?.reveal ?? false };
}

/** Hidden by a fold or by the part shown alone: the cursor passes over it. */
export function depthHidden(el: Element): boolean {
  return el.closest(`.${FOLD_OUT}, .${FOCUS_OUT}`) !== null;
}

/** What stands for `el` on the page: its x-ray box when it is x-rayed, else itself. */
export function standIn(el: Element): Element {
  const block = shown(el);
  return block.classList.contains(XRAYED) ? (boxOf.get(block) ?? block) : el;
}

/** `cb` runs after each dressing of any pane. Returns the off switch. */
export function onDepths(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function change(target: DepthTarget, edit: (st: DepthState) => void): void {
  const st = stateFor(target);
  const store = target.store();
  followStore(st, store);
  const snap = store?.snapshot();
  if (!snap) return;
  st.path ??= snap.path;
  st.rendered = snap.version;
  edit(st);
  dress(st);
}

/** `x`: the part's lines in place of it, or, when it is in one, that x-ray closed. */
export function toggleXray(target: DepthTarget, r: Range): void {
  change(target, (st) => {
    const open = st.xrays.filter((x) => within(r, x));
    st.xrays = open.length > 0 ? st.xrays.filter((x) => !open.includes(x)) : [...st.xrays, r];
  });
}

export function toggleReveal(target: DepthTarget): void {
  change(target, (st) => {
    st.reveal = !st.reveal;
  });
}

/** `z` on a section: folded, or unfolded again. */
export function toggleFold(target: DepthTarget, heading: Heading): void {
  change(target, (st) => {
    const had = st.folds.some((f) => same(f, heading.src));
    st.folds = had ? st.folds.filter((f) => !same(f, heading.src)) : [...st.folds, { start: heading.src.start, end: heading.src.end }];
  });
}

/** `Z`: every heading of `heads` folded; with any fold already made, every fold opened. True when it folded. */
export function foldAll(target: DepthTarget, heads: readonly Heading[]): boolean {
  let folded = false;
  change(target, (st) => {
    folded = st.folds.length === 0 && heads.length > 0;
    st.folds = folded ? heads.map((h) => ({ start: h.src.start, end: h.src.end })) : [];
  });
  return folded;
}

/** `v`: only `r` shown; null shows everything again. */
export function setFocus(article: HTMLElement, r: Range | null): void {
  const st = stateOf(article);
  if (st) change(st.target, (s) => {
    s.focus = r;
  });
}

export function setFocusOn(target: DepthTarget, r: Range | null): void {
  change(target, (st) => {
    st.focus = r;
  });
}

/**
 * Find or a link landed on `el`: a fold that hides it is opened, and the part shown alone gives way, so what was looked
 * for is on the page.
 */
export function exposeAt(el: Element): void {
  let article: HTMLElement | null = el.parentElement;
  while (article && !states.has(article)) article = article.parentElement;
  const st = article && stateOf(article);
  if (!st || empty(st)) return;
  const hiddenByFold = el.closest(`.${FOLD_OUT}`) !== null;
  const hiddenByFocus = el.closest(`.${FOCUS_OUT}`) !== null;
  if (!hiddenByFold && !hiddenByFocus) return;
  const carrier = el.closest('[data-marxy-s]');
  const byte = carrier ? Number(carrier.getAttribute('data-marxy-s')) : -1;
  const doc = st.target.store()?.snapshot().ast;
  if (hiddenByFocus) {
    st.focus = null;
    st.lens = null;
  }
  if (hiddenByFold && doc) {
    st.folds = st.folds.filter((f) => {
      const h = headingAt(doc, f);
      return !h || !(byte >= h.src.end && byte < sectionRange(doc, h).end);
    });
  }
  dress(st);
}

/** The lens on the pane's page, by its id, or null. */
export function lensOf(article: HTMLElement): string | null {
  return stateOf(article)?.lens?.id ?? null;
}

/** The lens on the pane's page, by its words, or null. */
export function lensLabelOf(article: HTMLElement): string | null {
  return stateOf(article)?.lens?.label ?? null;
}

/**
 * A lens: only the parts holding one of `ranges` stay on the page; null shows everything again. The part alone gives way.
 * The one mechanism for the Line's `%` and `/` lenses (depths/lens.ts) and the Metadata panel's.
 */
export function setLensOn(target: DepthTarget, lens: { readonly id: string; readonly label?: string; readonly ranges: readonly Range[] } | null): void {
  change(target, (st) => {
    st.focus = null;
    st.lens = lens ? { id: lens.id, label: lens.label ?? lens.id, ranges: [...lens.ranges] } : null;
  });
}

/** Esc: the lens on the pane taken off. False when there was none. */
export function dropLens(article: HTMLElement): boolean {
  const st = stateOf(article);
  if (!st?.lens) return false;
  change(st.target, (s) => {
    s.lens = null;
  });
  return true;
}

/** The folds made exactly `heads` (none opens every fold): the Outline's level switch. */
export function setFoldsOn(target: DepthTarget, heads: readonly Heading[]): void {
  change(target, (st) => {
    st.folds = heads.map((h) => ({ start: h.src.start, end: h.src.end }));
  });
}
