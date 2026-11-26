// The parts of a text kind read by core's readings: a data tree's nodes, records and a table's rows
// then cells, verse's stanzas then lines, a notebook's cells then their blocks and outputs, plain prose's paragraphs, a file
// set as written by its lines, a transcript's turns, and a log's entries or a patch's hunks then lines. Each is found on the
// page from the bytes it carries (`data-marxy-s`/`-e`); its address is its lines, or the kind's own (`#cell=7`).
import { lineSpan } from '../selection/cursor.ts';
import type { PartTree, PartUnit } from '../viewers/types.ts';
import { treeParts } from './moves.ts';

interface Range {
  readonly start: number;
  readonly end: number;
}

/** A page the parts cursor walks in place of Rendered's: a reading, a derived view, or a log or patch read as its lines. */
const PAGE = '[data-marxy-reading], [data-marxy-derived], pre.language-log.marxy-run, pre.language-diff.marxy-run';

/** A fenced part of a Markdown page read on its own (a table, a data tree, a log): one part of that page, not the page. */
const FENCED = '.marxy-part, pre[data-marxy-part]';

interface Looked {
  root: Element | null;
  stale: boolean;
  watch: MutationObserver;
}

/** Each article's last answer, kept until something that could change it happens inside the article. */
const looked = new WeakMap<Element, Looked>();

const PART_CLASS = 'marxy-part';

/** What a node added to the article must not hold unnoticed: a page, or a fence that may hide one. */
const WATCHED = `${PAGE}, ${FENCED}`;

/** Whether a change to the article could make or unmake a reading root, or move one in or out of a fenced part. */
function mayChangeRoot(r: MutationRecord, root: Element | null): boolean {
  if (r.type === 'childList') {
    // The typesetter adds line spans all through the page as it sets it; only a node holding a page or a fence matters.
    for (const n of r.addedNodes) if (n.nodeType === 1 && ((n as Element).matches(WATCHED) || (n as Element).querySelector(WATCHED) !== null)) return true;
    if (root !== null) for (const n of r.removedNodes) if (n.contains(root)) return true;
    return false;
  }
  // The cursor repaints classes on every key; only a `pre` (a run) or a fence's class can matter.
  if (r.attributeName === 'class') {
    const t = r.target as Element;
    return t.localName === 'pre' || (r.oldValue ?? '').split(/\s+/).includes(PART_CLASS) !== t.classList.contains(PART_CLASS);
  }
  return true;
}

/**
 * The root of the reading on `article`, or null; a reading inside a fenced part of a Markdown page is not the page's.
 * A Markdown page has none, so the scan over its whole tree is paid once per drawing, not once per key.
 */
export function readingRoot(article: Element): Element | null {
  let kept = looked.get(article);
  if (kept) {
    // Records not yet delivered are changes already made: a read in the same task must see them.
    if (kept.watch.takeRecords().some((r) => mayChangeRoot(r, kept!.root))) kept.stale = true;
    if (!kept.stale && (kept.root === null || kept.root.isConnected)) return kept.root;
  }
  let root: Element | null = null;
  for (const el of article.querySelectorAll(PAGE)) {
    if (el.closest(FENCED) === null) {
      root = el;
      break;
    }
  }
  if (!kept) {
    const entry: Looked = { root, stale: false, watch: new MutationObserver((rs) => (entry.stale ||= rs.some((r) => mayChangeRoot(r, entry.root)))) };
    entry.watch.observe(article, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'data-marxy-reading', 'data-marxy-derived', 'data-marxy-part'] });
    looked.set(article, entry);
    return root;
  }
  kept.root = root;
  kept.stale = false;
  return root;
}

/** Whether `article` shows a page whose parts are the reading's, not the Markdown parse's. */
export function readingPage(article: Element): boolean {
  return readingRoot(article) !== null;
}

/** The fenced part holding `el` whose reading has parts of its own (its rows, its nodes, its lines), or null. */
export function fencedReading(el: Element | null): HTMLElement | null {
  const part = el?.closest<HTMLElement>(FENCED) ?? null;
  if (!part) return null;
  return part.matches(PAGE) || part.querySelector(PAGE) !== null ? part : null;
}

const BLOCKS = new Set(['div', 'p', 'li', 'ul', 'ol', 'tr', 'td', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'details', 'blockquote', 'pre', 'dl', 'figure', 'hr', 'table']);

function rangeOf(el: Element): Range | null {
  const s = el.getAttribute('data-marxy-s');
  const e = el.getAttribute('data-marxy-e');
  return s === null || e === null ? null : { start: Number(s), end: Number(e) };
}

/** What the depths' own boxes are: never parts. */
const OWN = '.marxy-xray, .marxy-reveal-mark, .marxy-elide, .marxy-mnote, .marxy-tree-stop, thead, summary, button';

function isUnit(el: Element): boolean {
  if (!BLOCKS.has(el.localName) || el.closest(OWN)) return false;
  if (el.localName === 'table') return false;
  if (el.localName === 'td') return el.parentElement !== null && rangeOf(el.parentElement) !== null;
  if (el.matches('.marxy-stanza, section[data-marxy-cell], .marxy-nb-out')) return true;
  const r = rangeOf(el);
  return r !== null && r.end > r.start;
}

/** A unit's bytes: its own, or the hull of what it holds. */
function hullOf(el: Element): Range | null {
  const own = rangeOf(el);
  if (own) return own;
  let start = Infinity;
  let end = -1;
  for (const inner of el.querySelectorAll('[data-marxy-s][data-marxy-e]')) {
    const r = rangeOf(inner)!;
    if (r.end <= r.start) continue;
    start = Math.min(start, r.start);
    end = Math.max(end, r.end);
  }
  return end > start ? { start, end } : null;
}

function wordFor(el: Element, reading: string | null): string {
  if (el.matches('section[data-marxy-cell]')) return 'cell';
  if (el.matches('.marxy-nb-out')) return 'output';
  if (el.matches('.marxy-stanza')) return 'stanza';
  if (el.matches('.marxy-verse-line, .marxy-written-line, .marxy-lines-row')) return 'line';
  if (el.matches('.marxy-verse-title')) return 'title';
  if (el.matches('section.marxy-turn')) return `turn · ${el.getAttribute('data-marxy-turn') ?? ''}`.replace(/ · $/, '');
  if (el.matches('details.marxy-tree-branch, .marxy-tree-leaf')) {
    const key = el.querySelector(':scope > summary .marxy-tree-key, :scope > .marxy-tree-key')?.textContent?.trim();
    return key ? `node ${key}` : 'node';
  }
  if (el.localName === 'tr') return reading === 'records' ? 'record' : 'row';
  if (el.localName === 'td') return 'cell';
  if (el.localName === 'p') return 'paragraph';
  if (/^h[1-6]$/.test(el.localName)) return `heading ${el.localName[1]}`;
  if (el.localName === 'li') return 'item';
  if (el.localName === 'pre') return 'code';
  return 'block';
}

export interface ReadingPartsInputs {
  readonly article: HTMLElement;
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly readOnly: boolean;
  /** A fenced part of a Markdown page whose reading is walked, in place of the page's own reading. */
  readonly within?: HTMLElement;
  /**
   * The page whose blocks are the parts, whatever it holds (an archive's preview of Markdown or code, `viewers/embed.ts`):
   * its blocks by their bytes, or a code page's lines.
   */
  readonly root?: HTMLElement;
  /** The depths' x-ray of a byte range on this page (depths/dress.ts), drawn in place. */
  xray(range: Range): void;
  /** The first part at or below the reading line, from the page's own elements. */
  startAt(units: readonly PartUnit[]): PartUnit | null;
}

const decode = (bytes: Uint8Array, r: Range): string => new TextDecoder().decode(bytes.subarray(r.start, r.end));

/** The cell's column, from the table's head. */
function columnOf(td: Element): string {
  const row = td.parentElement!;
  const at = [...row.children].indexOf(td);
  const head = row.closest('table')?.querySelector('thead tr')?.children[at];
  return head?.textContent?.trim() || String(at + 1);
}

/** A log's or a patch's piece: each line its own part; a patch's lines are held by their hunks. */
function codeUnits(code: HTMLElement, i: ReadingPartsInputs, mk: (o: UnitInit) => PartUnit): PartUnit[] {
  const base = rangeOf(code);
  if (!base) return [];
  const { bytes } = i;
  const lines = [...code.children].filter((c): c is HTMLElement => c.classList.contains('marxy-line'));
  const out: PartUnit[] = [];
  let at = base.start;
  const diff = code.closest('pre')?.classList.contains('language-diff') === true;
  const log = code.closest('pre')?.classList.contains('language-log') === true;
  let hunk: { head: HTMLElement; kids: PartUnit[]; start: number } | null = null;
  const closeHunk = (end: number): void => {
    if (!hunk) return;
    const h = hunk;
    out.push(mk({ el: h.head, label: `hunk · ${h.head.getAttribute('data-marxy-hunk') ?? ''}`.replace(/ · $/, ''), range: { start: h.start, end }, children: h.kids }));
    hunk = null;
  };
  for (const line of lines) {
    let end = at;
    while (end < base.end && bytes[end] !== 0x0a) end++;
    const next = end < base.end ? end + 1 : end;
    const textEnd = end > at && bytes[end - 1] === 0x0d ? end - 1 : end;
    const unit = mk({ el: line, label: log ? 'entry' : 'line', range: { start: at, end: textEnd } });
    if (diff && line.hasAttribute('data-marxy-hunk')) {
      closeHunk(at);
      hunk = { head: line, kids: [unit], start: at };
    } else if (hunk) hunk.kids.push(unit);
    else out.push(unit);
    at = next;
    if (at >= base.end) break;
  }
  closeHunk(at);
  return out;
}

interface UnitInit {
  readonly el: HTMLElement;
  readonly label: string;
  readonly range: Range | null;
  readonly children?: readonly PartUnit[];
  readonly address?: string;
  readonly stored?: () => string;
  readonly id?: string;
}

/** The parts of the reading on `article`, or null when it shows none. */
export function readingParts(i: ReadingPartsInputs): PartTree | null {
  const root = i.root ?? (i.within ? (i.within.matches(PAGE) ? i.within : i.within.querySelector<HTMLElement>(PAGE)) : (readingRoot(i.article) as HTMLElement | null));
  if (!root) return null;
  const reading = root.getAttribute('data-marxy-reading');
  const mk = (o: UnitInit): PartUnit => {
    const r = o.range;
    const lines = r ? lineSpan(i.bytes, r.start, r.end) : null;
    const address = o.address ?? (lines ? `:${lines.first}${lines.last > lines.first ? `–${lines.last}` : ''}` : '');
    return {
      id: o.id ?? (r ? `${r.start}-${r.end}:${o.el.localName}` : `${o.el.localName}:${address}`),
      label: o.label,
      address,
      at: r?.start,
      el: () => (o.el.isConnected ? o.el : null),
      children: o.children && o.children.length > 0 ? o.children : undefined,
      stored: o.stored ?? (() => (r ? decode(i.bytes, r) : (o.el.textContent ?? ''))),
      xray: r ? () => (i.xray(r), null) : undefined,
    };
  };

  let top: PartUnit[];
  if (root.matches('pre')) {
    // A log or a patch read as a file of lines: each of the file's pieces in turn.
    top = [];
    const codes = i.within ? [...root.querySelectorAll<HTMLElement>(':scope > code[data-marxy-s]')] : [...i.article.querySelectorAll<HTMLElement>('pre.marxy-run > code[data-marxy-s]')].filter((c) => c.closest(FENCED) === null);
    for (const code of codes) top.push(...codeUnits(code, i, mk));
  } else {
    const build = (holder: Element): PartUnit[] => {
      const out: PartUnit[] = [];
      const walk = (el: Element): void => {
        for (const child of el.children) {
          if (isUnit(child)) out.push(unitOf(child as HTMLElement));
          else walk(child);
        }
      };
      walk(holder);
      return out;
    };
    const unitOf = (el: HTMLElement): PartUnit => {
      const kids = el.localName === 'td' ? [] : build(el);
      if (el.localName === 'td') {
        const row = rangeOf(el.parentElement!)!;
        const col = columnOf(el);
        const lines = lineSpan(i.bytes, row.start, row.end);
        return mk({
          el,
          label: `cell ${col}`,
          range: null,
          // By place, not header: a table may name two columns alike.
          id: `${row.start}-${row.end}/${[...el.parentElement!.children].indexOf(el)}`,
          address: `:${lines.first}#${col}`,
          stored: () => el.getAttribute('data-marxy-value') ?? el.textContent ?? '',
        });
      }
      const cell = el.getAttribute('data-marxy-cell');
      if (cell !== null) return mk({ el, label: `cell ${cell}`, range: hullOf(el), children: kids, address: `#cell=${cell}`, id: `cell=${cell}` });
      if (el.matches('.marxy-nb-out')) return mk({ el, label: 'output', range: null, id: `${el.closest('[data-marxy-cell]')?.getAttribute('data-marxy-cell')}:out:${[...(el.parentElement?.children ?? [])].indexOf(el)}` });
      return mk({ el, label: wordFor(el, reading), range: hullOf(el), children: kids });
    };
    top = build(root);
  }
  return treeParts(top, { readOnly: i.readOnly, start: () => i.startAt(top) });
}
