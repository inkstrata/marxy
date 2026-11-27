// Lenses (`A.setLens`): the page shows only the top-level parts that hold something (open
// tasks, code, tables, links, notes, unsaved changes, odd characters, a find), with the headings above each, and a dashed
// row for every run left out. One mechanism with the Metadata panel's lenses: both set the depths' lens (dress.ts), whose
// ranges follow edits and which is dressed again after every page set, so a relayout keeps it. It goes when another
// document is shown, a dashed row is pressed, Esc is pressed, or another lens is chosen. Nothing is written.
import type { DocumentStore } from '../document/store.ts';
import { changedLines } from '../changes/state.ts';
import { notesFor } from '../notes/store.ts';
import { lineSpan } from '../selection/cursor.ts';
import { lensLabelOf, setLensOn, type DepthTarget } from './dress.ts';

export type LensId = 'heads' | 'tasks' | 'code' | 'tables' | 'links' | 'notes' | 'changed' | 'odd' | 'find';

export interface Lens {
  readonly id: LensId;
  readonly label: string;
  /** "3 open of 7", "none": what the page holds of it now. */
  readonly count: string;
}

/** A pane as a lens reads it (the pane set's pane, narrowed). */
export interface LensPane {
  readonly article: HTMLElement;
  path(): string | null;
  readonly view: { readonly mode: string; viewer(): unknown; mountThrough(byte: number): void };
  readonly content: { store(): DocumentStore | null };
}

interface Unit {
  readonly el: Element;
  readonly start: number;
  readonly end: number;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

const targetOf = (pane: LensPane): DepthTarget => ({ article: pane.article, store: () => pane.content.store(), mountThrough: (b) => pane.view.mountThrough(b) });

function rangeOf(el: Element): { start: number; end: number } | null {
  const own = el.hasAttribute('data-marxy-s') ? el : el.querySelector('[data-marxy-s][data-marxy-e]');
  if (!own) return null;
  return { start: Number(own.getAttribute('data-marxy-s')), end: Number(own.getAttribute('data-marxy-e')) };
}

/** The page's top-level parts with their byte ranges; the depths' own boxes and rows are not parts. */
function topUnits(article: HTMLElement): Unit[] {
  const out: Unit[] = [];
  for (const el of article.children) {
    if (el.matches('.marxy-xray, .marxy-elide, .marxy-reveal-mark')) continue;
    const r = rangeOf(el);
    if (r) out.push({ el, ...r });
  }
  return out;
}

/** The pane shows a Rendered text page whose parts carry their bytes: a lens can apply. */
export function lensable(pane: LensPane | null): pane is LensPane {
  return pane !== null && pane.view.mode === 'rendered' && pane.view.viewer() === null && pane.content.store() !== null && !pane.article.hidden && pane.article.querySelector(':scope > [data-marxy-s]') !== null;
}

const SELECTOR: Partial<Record<LensId, string>> = {
  tasks: 'input[type="checkbox"]:not(:checked)',
  code: 'pre',
  tables: 'table',
  links: 'a[href]',
  odd: '.marxy-invisible',
};

/** The test a lens keeps a part by. */
function testOf(pane: LensPane, id: LensId, re: RegExp | null): (u: Unit) => boolean {
  const bytes = pane.content.store()!.snapshot().buffer.bytes;
  const path = pane.path() ?? '';
  const lines = (u: Unit): { first: number; last: number } => lineSpan(bytes, u.start, u.end);
  if (id === 'heads') return (u) => /^h[1-6]$/.test(u.el.localName);
  if (id === 'notes') {
    const notes = notesFor(path);
    return (u) => {
      const { first, last } = lines(u);
      return notes.some((n) => n.l0 + 1 >= first && n.l0 + 1 <= last);
    };
  }
  if (id === 'changed') {
    const changed = new Set(changedLines(path).map((l) => l + 1));
    return (u) => {
      const { first, last } = lines(u);
      for (let l = first; l <= last; l++) if (changed.has(l)) return true;
      return false;
    };
  }
  if (id === 'find') {
    const decoder = new TextDecoder();
    return (u) =>
      re !== null &&
      decoder
        .decode(bytes.subarray(u.start, u.end))
        .split(/\r\n|\r|\n/)
        .some((line) => {
          re.lastIndex = 0;
          return re.test(line);
        });
  }
  const sel = SELECTOR[id]!;
  return (u) => u.el.matches(sel) || u.el.querySelector(sel) !== null;
}

/** The lenses this page offers, each with what it holds now. Empty where no lens applies. */
export function lensesOf(pane: LensPane | null): Lens[] {
  if (!lensable(pane)) return [];
  pane.view.mountThrough(Number.MAX_SAFE_INTEGER);
  const a = pane.article;
  const n = (sel: string): number => a.querySelectorAll(sel).length;
  const path = pane.path() ?? '';
  const out: Lens[] = [];
  const open = n('input[type="checkbox"]:not(:checked)');
  const tasks = n('input[type="checkbox"]');
  out.push({ id: 'heads', label: 'Headings only', count: plural(n('h1, h2, h3, h4, h5, h6'), 'heading') });
  if (tasks > 0) out.push({ id: 'tasks', label: 'Open tasks', count: `${open} open of ${tasks}` });
  out.push({ id: 'code', label: 'Code and fenced parts', count: String(n('pre')) });
  out.push({ id: 'tables', label: 'Tables', count: String(n('table')) });
  out.push({ id: 'links', label: 'Links and references', count: String(n('a[href]')) });
  out.push({ id: 'notes', label: 'Parts you have noted', count: String(notesFor(path).length) });
  const changed = changedLines(path).length;
  if (changed > 0) out.push({ id: 'changed', label: 'Parts you have changed and not saved', count: plural(changed, 'line') });
  const odd = n('.marxy-invisible');
  out.push({ id: 'odd', label: 'Odd characters: invisible and ambiguous', count: odd > 0 ? plural(odd, 'finding') : 'none' });
  return out;
}

/** The lens on the pane taken off: everything shows again. False when none was on. */
export function clearLens(pane: LensPane | null): boolean {
  if (!pane || lensLabelOf(pane.article) === null) return false;
  setLensOn(targetOf(pane), null);
  return true;
}

/** The lens on the pane, by its words, or null. */
export function lensOn(pane: LensPane | null): string | null {
  return pane ? lensLabelOf(pane.article) : null;
}

/**
 * Shows only the parts lens `id` keeps (for `find`, those holding `re`) and the headings above each, through the depths'
 * lens. Returns how many parts it kept, or null where no lens applies.
 */
export function setLens(pane: LensPane | null, id: LensId, label: string, re: RegExp | null = null): number | null {
  if (!lensable(pane)) return null;
  pane.view.mountThrough(Number.MAX_SAFE_INTEGER);
  const test = testOf(pane, id, re);
  // Read with no lens on, so the parts an earlier lens left out are tested too.
  const tops = topUnits(pane.article);
  const keep = new Set<Unit>();
  const stack: Unit[] = [];
  for (const u of tops) {
    const level = /^h([1-6])$/.exec(u.el.localName);
    if (level) while (stack.length > 0 && Number(stack.at(-1)!.el.localName[1]) >= Number(level[1])) stack.pop();
    if (test(u)) {
      keep.add(u);
      for (const s of stack) keep.add(s);
    }
    if (level) stack.push(u);
  }
  setLensOn(targetOf(pane), { id, label, ranges: [...keep].map((u) => ({ start: u.start, end: u.end })) });
  return keep.size;
}
