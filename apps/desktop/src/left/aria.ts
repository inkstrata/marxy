// What the panel cursor means to a screen reader. The drawer holds focus and the cursor row is drawn, not focused, so the
// rows carry roles and names and the drawer points at the cursor row with aria-activedescendant. Nothing here is visible.
import { rowOptions } from './ui.ts';

let serial = 0;

/** State a row shows only by colour or a mark, said in words after its text. */
const STATES: readonly (readonly [cls: string, words: string])[] = [
  ['marxy-l-at', 'current'],
  ['marxy-l-open', 'open in a tab'],
  ['marxy-l-dirty', 'unsaved changes'],
];

const SKIP = ['marxy-l-tw', 'marxy-l-bar', 'marxy-l-ck', 'marxy-l-rd', 'marxy-l-sr'];

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The words of `el` as a reader would say them: no twisty glyph, no bar, a segmented choice by its pressed item. */
function wordsOf(el: Node): string {
  if (el instanceof Text) return el.data;
  if (!(el instanceof HTMLElement)) return '';
  if (SKIP.some((c) => el.classList.contains(c)) || el.getAttribute('aria-hidden') === 'true') return '';
  if (el.getAttribute('role') === 'switch') return '';
  if (el.classList.contains('marxy-l-sg')) return el.querySelector('[aria-pressed="true"]')?.textContent ?? '';
  let out = '';
  for (const k of el.childNodes) out += wordsOf(k);
  return out;
}

function nameOf(row: HTMLElement): string {
  const parts: string[] = [];
  for (const k of row.childNodes) {
    const t = squash(wordsOf(k));
    if (t) parts.push(t);
  }
  const words = parts.join(' ') || rowOptions(row)?.what || '';
  const states = STATES.filter(([c]) => row.classList.contains(c)).map(([, w]) => w);
  const o = rowOptions(row);
  if (o?.toggle !== undefined && row.getAttribute('role') !== 'treeitem') states.push(o.open === true ? 'open' : 'shut');
  for (const sw of row.querySelectorAll('[role="switch"]')) states.push(sw.getAttribute('aria-checked') === 'true' ? 'on' : 'off');
  return states.length ? `${words}, ${states.join(', ')}` : words;
}

const depthOf = (row: HTMLElement): number => {
  if (row.classList.contains('marxy-l-gh')) return 0;
  const d = row.style.getPropertyValue('--marxy-l-depth');
  if (d !== '') return Number(d);
  return row.classList.contains('marxy-l-hit') ? 1 : 0;
};

function set(el: Element, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name);
  else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/**
 * Roles for the rows a panel drew into `body`: a tree where a row opens and closes, else a listbox. Run after every draw
 * and again for the cursor row, whose classes a panel may have changed since (the row that is current).
 */
export function describeBody(body: HTMLElement, panel: string, nests?: boolean): void {
  const rows = [...body.querySelectorAll<HTMLElement>('.marxy-l-prow')];
  if (rows.length === 0) {
    body.removeAttribute('role');
    body.removeAttribute('aria-label');
    return;
  }
  // A tree only where rows nest; one row that opens over its siblings (Metadata) is a list whose row says its state. A
  // list drawn a window at a time says so for all its rows (`nests`), not only for those drawn now.
  const tree = nests ?? rows.some((r) => depthOf(r) > 0 || r.classList.contains('marxy-l-gh'));
  set(body, 'role', tree ? 'tree' : 'listbox');
  set(body, 'aria-label', panel);
  for (const row of rows) describeRow(row, tree);
}

/**
 * After a panel's `light`, which moves the current mark and the pressed choice but adds and removes no row: names again
 * only the rows it can have changed (`was` held the mark before), not every row of a long list on every scrolled frame.
 */
export function describeLit(body: HTMLElement, panel: string, was: readonly HTMLElement[], nests?: boolean): void {
  if (!body.hasAttribute('role')) return describeBody(body, panel, nests);
  const tree = body.getAttribute('role') === 'tree';
  const touched = new Set(was);
  for (const row of body.querySelectorAll<HTMLElement>('.marxy-l-prow.marxy-l-at')) touched.add(row);
  for (const choice of body.querySelectorAll('.marxy-l-prow [aria-pressed]')) {
    const row = choice.closest<HTMLElement>('.marxy-l-prow');
    if (row) touched.add(row);
  }
  for (const row of touched) if (body.contains(row)) describeRow(row, tree);
}

export function describeRow(row: HTMLElement, tree: boolean): void {
  if (!row.id) row.id = `marxy-l-o-${++serial}`;
  const o = rowOptions(row);
  set(row, 'role', tree ? 'treeitem' : 'option');
  set(row, 'aria-label', nameOf(row));
  if (tree) {
    set(row, 'aria-level', String(depthOf(row) + 1));
    set(row, 'aria-expanded', o?.toggle === undefined ? null : String(o.open === true));
  }
  const ticked = row.querySelector(':scope > .marxy-l-ck, :scope > .marxy-l-rd');
  set(row, 'aria-checked', ticked ? String(ticked.classList.contains('marxy-l-on')) : null);
  set(row, 'aria-selected', row.classList.contains('marxy-l-sel') ? 'true' : null);
}

/** Names the controls a panel drew without one: a segmented choice by the label before it. */
export function nameControls(root: HTMLElement): void {
  for (const g of root.querySelectorAll<HTMLElement>('.marxy-l-sg:not([aria-label])')) {
    const near = g.closest('.marxy-l-prow')?.querySelector('.marxy-l-nm') ?? g.closest('.marxy-l-tool, .marxy-l-fld')?.querySelector('.marxy-l-lab, .marxy-l-lb');
    const name = squash(near?.textContent ?? '');
    if (name) g.setAttribute('aria-label', name);
  }
}

