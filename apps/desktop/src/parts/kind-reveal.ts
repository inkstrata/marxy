// Reveal on a text kind's reading: what Read left out is put back beside it, quietly, from the
// bytes each part's provenance names (`data-marxy-s`/`-e`), never from a second parse of the file's syntax. A data tree gets
// its quotes, keys as written, colons, commas, brackets, dashes and comments; a delimited table its quotes and delimiters;
// JSON Lines its braces, keys and quotes; a log its timestamps and spacing as written; a transcript each record's fields
// the reading did not draw; a notebook its code cells' fences. The marks are the depths' own (`marxy-reveal-mark`), so the
// cursor never takes one for a part. State is the article's, in memory only; the page is dressed again after a redraw.
import { around, delimiterIn, droppedFields, splitDelimited, splitGap, valueIn } from './reveal-text.ts';

export type RevealKind = 'tree' | 'table' | 'records' | 'log' | 'transcript' | 'notebook';

const MARK = 'marxy-reveal-mark';
const LINE = 'marxy-reveal-line';
const ON = 'data-marxy-reveal';
/** On a dressed value the reading drew in its own way; its value as written stands beside it instead. */
const SWAPPED = 'data-marxy-reveal-swapped';

interface State {
  bytes: () => Uint8Array | null;
  observer: MutationObserver;
  frame: number;
}

const states = new WeakMap<HTMLElement, State>();
const decoder = new TextDecoder();

const KINDS: readonly [RevealKind, string][] = [
  ['tree', '[data-marxy-reading="tree"]'],
  ['table', '[data-marxy-reading="table"]'],
  ['records', '[data-marxy-reading="records"]'],
  ['notebook', '[data-marxy-reading="notebook"]'],
  ['transcript', '[data-marxy-derived="jsonl-transcript"]'],
  ['log', 'pre.language-log.marxy-run'],
];

/** The kind of reading `article` shows that Reveal has something to put back on, or null. */
export function revealKindOf(article: Element): RevealKind | null {
  // A reading inside a fenced part of a Markdown page is that page's; its Reveal is the depths' own.
  for (const [kind, sel] of KINDS) if ([...article.querySelectorAll(sel)].some((el) => el.closest('.marxy-part, pre[data-marxy-part]') === null)) return kind;
  return null;
}

export function kindRevealOn(article: Element): boolean {
  return states.has(article as HTMLElement);
}

function mark(text: string, line = false): HTMLElement {
  const el = document.createElement(line ? 'div' : 'span');
  el.className = line ? `${MARK} ${LINE}` : MARK;
  el.textContent = text;
  return el;
}

function rangeOf(el: Element): { s: number; e: number } | null {
  const s = el.getAttribute('data-marxy-s');
  const e = el.getAttribute('data-marxy-e');
  return s === null || e === null ? null : { s: Number(s), e: Number(e) };
}

const text = (bytes: Uint8Array, s: number, e: number): string => decoder.decode(bytes.subarray(Math.max(0, s), Math.max(s, Math.min(e, bytes.length))));

function undress(article: HTMLElement): void {
  for (const el of article.querySelectorAll(`.${MARK}`)) el.remove();
  for (const el of article.querySelectorAll(`[${SWAPPED}]`)) el.removeAttribute(SWAPPED);
}

/* ---------- a data tree ---------- */

const NODE = 'div.marxy-tree-leaf, details.marxy-tree-branch, tr';

/** The nodes directly under `holder` (a branch, or the tree's root): each carrier whose nearest node above is the holder. */
function nodesUnder(holder: Element, root: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of holder.querySelectorAll<HTMLElement>(NODE)) {
    if (el === holder || el.closest('.marxy-tree-stop')) continue;
    const r = rangeOf(el);
    if (!r || r.e <= r.s) continue;
    const up = el.parentElement?.closest(NODE);
    if ((up && up !== holder && root.contains(up)) || (holder === root && up && root.contains(up))) continue;
    out.push(el);
  }
  return out;
}

/** Marks `pre` (what is written before the value) around the node's key, or before it when the key is not written there. */
function leadMarks(at: HTMLElement, pre: string): void {
  const text = pre.trim();
  if (text === '') return;
  const keyEl = at.querySelector<HTMLElement>(':scope > .marxy-tree-key, :scope > .marxy-tree-index');
  const parts = keyEl?.classList.contains('marxy-tree-key') ? around(text, keyEl.textContent ?? '') : null;
  if (keyEl && parts) {
    if (parts.before.trim()) keyEl.before(mark(parts.before.trim()));
    if (parts.after.trim()) keyEl.after(mark(parts.after.trim()));
  } else if (at.localName === 'tr') at.firstElementChild?.prepend(mark(text));
  else at.prepend(mark(text));
}

/** The value as the reading drew it: a string without the quotes it is set in. */
function shownValue(el: Element): string {
  const t = el.textContent ?? '';
  return el.classList.contains('marxy-tree-string') ? t.replace(/^“/, '').replace(/”$/, '') : t;
}

const VALUE = ':scope > .marxy-tree-string, :scope > .marxy-tree-number, :scope > .marxy-tree-literal, :scope > .marxy-tree-block, :scope > .marxy-tree-text';

interface Dressed {
  /** What its range opens with before its first node (a bracket, `key:`), put beside its key by its holder. */
  readonly open: string;
  /** Its close's line (a bracket), where the comma after it goes; null when nothing closes it. */
  readonly close: HTMLElement | null;
}

/** A holder's nodes with what is written between them, and its close after them. */
function dressHolder(holder: HTMLElement, root: HTMLElement, bytes: Uint8Array, range: { s: number; e: number }): Dressed {
  const nodes = nodesUnder(holder, root);
  const inner = new Map<HTMLElement, Dressed>();
  for (const n of nodes) if (n.localName === 'details') inner.set(n, dressHolder(n, root, bytes, rangeOf(n)!));
  /** Where a node's trail (its comma) goes: the end of its line, or its close's line. */
  const trailAt = (n: HTMLElement): HTMLElement =>
    n.localName === 'details' ? (inner.get(n)?.close ?? n.querySelector<HTMLElement>(':scope > summary') ?? n) : n.localName === 'tr' ? ((n.lastElementChild as HTMLElement | null) ?? n) : n;
  let prev = range.s;
  let before: HTMLElement | null = null;
  let open = '';
  for (const n of nodes) {
    const r = rangeOf(n)!;
    const gap = splitGap(text(bytes, prev, r.s));
    if (before) {
      if (gap.trail) trailAt(before).append(mark(gap.trail));
    } else open = gap.trail;
    if (n.localName !== 'tr') for (const l of gap.lines) n.before(mark(l, true));
    if (n.localName === 'details') leadMarks(n.querySelector<HTMLElement>(':scope > summary')!, `${gap.lead} ${inner.get(n)!.open}`);
    else if (n.localName === 'tr') leadMarks(n, gap.lead);
    else {
      const raw = text(bytes, r.s, r.e).replace(/\s+$/, '');
      const value = n.querySelector<HTMLElement>(VALUE);
      if (raw.trimStart().startsWith('<')) {
        // An element written whole (XML): the element as written stands for its key and its value.
        for (const c of n.children) c.setAttribute(SWAPPED, '');
        n.append(mark(`${gap.lead ? `${gap.lead} ` : ''}${raw}`));
      } else {
        const v = valueIn(raw, value ? shownValue(value) : '');
        leadMarks(n, `${gap.lead} ${v.before}`);
        if (value) {
          value.setAttribute(SWAPPED, '');
          value.after(mark(v.value));
        }
        if (v.after.trim()) n.append(mark(v.after.trim()));
      }
    }
    prev = r.e;
    before = n;
  }
  const last = splitGap(text(bytes, prev, range.e));
  if (before && last.trail) trailAt(before).append(mark(last.trail));
  let close: HTMLElement | null = null;
  for (const l of [...last.lines, last.lead].filter((x) => x !== '')) {
    close = mark(l, true);
    if (holder.localName === 'details') holder.append(close);
    else if (before) (before.localName === 'tr' ? (before.closest('table') ?? before) : before).after(close);
  }
  return { open, close };
}

function dressTree(root: HTMLElement, bytes: Uint8Array): void {
  const { open } = dressHolder(root, root, bytes, { s: 0, e: bytes.length });
  // The file's own opening (a brace) stands on a line of its own above its first node.
  const first = nodesUnder(root, root)[0];
  if (open && first) {
    let at: Element = first;
    while (at.previousElementSibling?.classList.contains(MARK)) at = at.previousElementSibling;
    at.before(mark(open, true));
  }
}

/* ---------- delimited tables and records ---------- */

function dressTable(root: HTMLElement, bytes: Uint8Array): void {
  const heads = [...root.querySelectorAll<HTMLElement>('thead th[data-marxy-s]')];
  const r0 = heads[0] ? rangeOf(heads[0]) : null;
  const r1 = heads[1] ? rangeOf(heads[1]) : null;
  const delim = r0 && r1 ? delimiterIn(text(bytes, r0.e, r1.s).replace(/"/g, '')) : ',';
  const shown = delim === '\t' ? '⇥' : delim;
  const dress = (cells: readonly HTMLElement[], fields: readonly string[]): void => {
    cells.forEach((cell, i) => {
      const f = (fields[i] ?? '').trim();
      if (f.startsWith('"') && f.endsWith('"') && f.length >= 2) {
        cell.prepend(mark('"'));
        cell.append(mark('"'));
      }
      if (i < cells.length - 1) cell.append(mark(shown));
    });
  };
  dress(heads, heads.map((th) => {
    const r = rangeOf(th)!;
    return text(bytes, r.s, r.e);
  }));
  for (const tr of root.querySelectorAll<HTMLElement>('tbody tr[data-marxy-s]')) {
    if (tr.classList.contains('marxy-records-bad')) continue;
    const r = rangeOf(tr)!;
    dress([...tr.querySelectorAll<HTMLElement>(':scope > td')], splitDelimited(text(bytes, r.s, r.e).replace(/\r?\n$|\r$/, ''), delim));
  }
}

function dressRecords(root: HTMLElement, bytes: Uint8Array): void {
  const keys = [...root.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
  for (const tr of root.querySelectorAll<HTMLElement>('tbody tr[data-marxy-s]')) {
    const r = rangeOf(tr)!;
    let rec: unknown;
    try {
      rec = JSON.parse(text(bytes, r.s, r.e));
    } catch {
      continue;
    }
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) continue;
    const cells = [...tr.querySelectorAll<HTMLElement>(':scope > td')];
    cells.forEach((td, i) => {
      const key = keys[i] ?? '';
      if (!Object.hasOwn(rec as object, key)) return;
      const v = (rec as Record<string, unknown>)[key];
      td.prepend(mark(`${i === 0 ? '{' : ''}${JSON.stringify(key)}: ${typeof v === 'string' ? '"' : ''}`));
      td.append(mark(`${typeof v === 'string' ? '"' : ''}${i < cells.length - 1 ? ',' : '}'}`));
    });
  }
}

/* ---------- a transcript, a notebook ---------- */

function dressTranscript(root: HTMLElement, bytes: Uint8Array): void {
  for (const turn of root.querySelectorAll<HTMLElement>('section.marxy-turn[data-marxy-s]')) {
    const r = rangeOf(turn)!;
    const head = turn.querySelector(':scope > h2');
    const said: string[] = [];
    for (const line of text(bytes, r.s, r.e).split(/\r?\n/)) {
      if (line.trim() === '') continue;
      try {
        said.push(droppedFields(JSON.parse(line)).join(' · '));
      } catch {
        said.push('a line that does not read as JSON');
      }
    }
    for (const s of said.reverse()) if (s) (head ?? turn).after(mark(s, true));
  }
}

function dressNotebook(root: HTMLElement): void {
  for (const pre of root.querySelectorAll<HTMLElement>('section.marxy-nb-code > pre, section.marxy-nb-raw > pre')) {
    const lang = pre.getAttribute('data-marxy-lang') ?? (pre.closest('.marxy-nb-raw') ? 'raw' : '');
    pre.before(mark(`\`\`\`${lang}`, true));
    pre.after(mark('```', true));
  }
}

function dress(article: HTMLElement, bytes: Uint8Array): void {
  const kind = revealKindOf(article);
  const root = kind ? article.querySelector<HTMLElement>(KINDS.find(([k]) => k === kind)![1]) : null;
  // The pane went on to a page with nothing of this to put back (a Markdown file): Reveal there is the depths' own.
  if (!kind || !root) return off(article, false);
  undress(article);
  article.setAttribute(ON, '');
  if (kind === 'tree') dressTree(root, bytes);
  else if (kind === 'table') dressTable(root, bytes);
  else if (kind === 'records') dressRecords(root, bytes);
  else if (kind === 'transcript') dressTranscript(root, bytes);
  else if (kind === 'notebook') dressNotebook(root);
  // A log has no marks: its stamps and spacing are drawn already, and ON alone shows them (base.css).
}

function redress(article: HTMLElement): void {
  const st = states.get(article);
  if (!st) return;
  st.frame = 0;
  const bytes = st.bytes();
  if (!bytes || !article.isConnected) return off(article);
  dress(article, bytes);
  st.observer.takeRecords();
}

/** Reveal off; `clean`: its marks taken off too (not when the page has already gone on to another, which may have its own). */
function off(article: HTMLElement, clean = true): void {
  const st = states.get(article);
  if (!st) return;
  st.observer.disconnect();
  cancelAnimationFrame(st.frame);
  states.delete(article);
  if (clean) {
    undress(article);
    article.removeAttribute(ON);
  }
  offListeners.forEach((cb) => cb());
}

const offListeners = new Set<() => void>();
/** `cb` hears Reveal go off on a page by itself (the pane went on to another kind). */
export function onKindRevealOff(cb: () => void): void {
  offListeners.add(cb);
}

const ours = (n: Node): boolean => n instanceof Element && n.classList.contains(MARK);

/** Reveal on or off for the reading on `article`; `bytes` gives the file's bytes now. True when it is on. */
export function toggleKindReveal(article: HTMLElement, bytes: () => Uint8Array | null): boolean {
  if (states.has(article)) {
    off(article);
    return false;
  }
  const st: State = {
    bytes,
    frame: 0,
    // The page drawn again (an edit, a sort, a fold opened, rows read on): its marks are put back once a frame.
    observer: new MutationObserver((records) => {
      const theirs = records.some((r) => (r.type === 'attributes' ? !article.hasAttribute(ON) : ![...r.addedNodes, ...r.removedNodes].every(ours)));
      if (theirs && st.frame === 0) st.frame = requestAnimationFrame(() => redress(article));
    }),
  };
  states.set(article, st);
  const now = bytes();
  if (now) dress(article, now);
  st.observer.observe(article, { childList: true, subtree: true, attributes: true, attributeFilter: [ON] });
  return true;
}
