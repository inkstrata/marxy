// What every panel is drawn with: rows the panel cursor rests on, section heads, fields, and small controls. Text goes
// in as text nodes; nothing here takes an HTML string. Looks: packages/theme/src/left.css.
import { markedNode } from '../frame/model/metadata-marks.ts';
import type { FieldOptions, RowEvent, RowOptions } from './types.ts';
import { button } from '../frame/dom.ts';
import { icon } from '../frame/icons.ts';

type Kid = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const k of kids) if (k !== null && k !== undefined && k !== false) node.append(k);
  return node;
}

const ROW_WORDS: Readonly<Record<string, string>> = {
  dir: 'marxy-l-dir',
  sub: 'marxy-l-sub',
  dim: 'marxy-l-dim',
  sel: 'marxy-l-sel',
  at: 'marxy-l-at',
  open: 'marxy-l-open',
  dirty: 'marxy-l-dirty',
};

const options = new WeakMap<Element, RowOptions>();
/** What the frame hears when a row is pressed: the cursor goes to it. */
let pressed: (row: HTMLElement) => void = () => {};

/** The options a live row was made with; the frame reads its verbs and acts from here. */
export const rowOptions = (row: Element): RowOptions | undefined => options.get(row);
export function onRowPress(cb: (row: HTMLElement) => void): void {
  pressed = cb;
}

/** Makes any element a row the cursor can rest on. */
export function live<T extends HTMLElement>(row: T, o: RowOptions): T {
  if (!(o.run || o.toggle || o.verbs || o.tick || o.enter)) return row;
  row.classList.add('marxy-l-prow');
  options.set(row, o);
  if (o.k !== undefined) row.dataset.marxyLeftRow = o.k;
  row.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('button, input, select')) return;
    pressed(row);
    const ev: RowEvent = { ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, beside: e.ctrlKey || e.metaKey, detail: e.detail };
    if (e.shiftKey && o.tick) o.tick(e);
    else if (o.toggle && ((e.target instanceof Element && e.target.closest('.marxy-l-tw')) || !o.run)) o.toggle(ev);
    else o.run?.(ev);
  });
  return row;
}

/**
 * A row's twisty. ▸ and ▾ are drawn as a chevron that turns; the glyph stays in the text, hidden, for screen readers
 * and for anything that reads the row's words.
 */
export function twisty(tw: string): HTMLElement {
  if (tw !== '▸' && tw !== '▾') return h('span', 'marxy-l-tw', tw);
  return h('span', tw === '▾' ? 'marxy-l-tw marxy-l-chev marxy-l-on' : 'marxy-l-tw marxy-l-chev', icon('chevron'), h('span', 'marxy-l-sr', tw));
}

const count = (n: number | string): string => (typeof n === 'number' ? n.toLocaleString('en-GB') : n);

export function row(o: RowOptions): HTMLElement {
  const cls = ['marxy-l-row', ...(o.cls ?? '').split(/\s+/).map((w) => ROW_WORDS[w] ?? '').filter(Boolean)];
  if (o.lines) cls.push('marxy-l-two');
  const el = h('div', cls.join(' '));
  el.style.setProperty('--marxy-l-depth', String(o.d ?? 0));
  if (o.title) el.title = o.title;
  if (o.pre) el.append(o.pre);
  if (o.tw !== undefined) el.append(twisty(o.tw));
  const nm = h('span', 'marxy-l-nm', o.nm ?? '');
  if (o.small) nm.append(' ', h('small', '', o.small));
  el.append(nm);
  if (o.bar !== undefined) {
    const fill = h('u', '');
    fill.style.width = `${Math.max(4, Math.round(o.bar * 100))}%`;
    el.append(h('span', 'marxy-l-bar', fill));
  }
  if (o.pv) el.append(h('span', 'marxy-l-pv', o.pv));
  if (o.as) el.append(h('span', `marxy-l-as${o.g ? ' marxy-l-g' : ''}${o.red ? ' marxy-l-red' : ''}`, o.as));
  if (o.n !== undefined) el.append(h('span', 'marxy-l-n', count(o.n)));
  if (o.post) el.append(o.post);
  for (const [text, c] of o.lines ?? []) el.append(h('span', c === 'mono' ? 'marxy-l-ln marxy-l-mono' : 'marxy-l-ln', text));
  return live(el, o);
}

/** A section head: its title in small capitals, and a note only where it states a consequence (`staged` in the accent). */
export function sec(title: string, note?: string, staged?: boolean): HTMLElement {
  return h('div', 'marxy-l-sec', h('span', '', title), h('em', staged ? 'marxy-l-staged' : '', note ?? ''));
}

/** A group head (Pinned, a folder, Loose): its twisty, name, quiet words, and a count. */
export function gh(tw: string, name: string, small: string, n: number | string | null, o?: RowOptions): HTMLElement {
  const el = h('div', 'marxy-l-gh', twisty(tw), h('b', '', name), small ? h('small', '', small) : null, h('span', 'marxy-l-n', n === null ? '' : count(n)));
  return live(el, o ?? {});
}

export function kv(k: string, v: string | Node, o?: RowOptions & { readonly vcls?: string }): HTMLElement {
  const el = h('div', 'marxy-l-kv', h('span', '', k), h('span', o?.vcls ?? '', v));
  if (o?.title) el.title = o.title;
  return live(el, o ?? {});
}

/** A field. Keep its value in the panel's state: the frame puts focus and caret back by `name` after a redraw. */
export function fld(o: FieldOptions): HTMLElement {
  const input = h('input', '');
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = o.placeholder ?? '';
  input.setAttribute('aria-label', o.placeholder || o.lb || o.name);
  input.dataset.marxyLeftField = o.name;
  input.value = o.value ?? '';
  if (o.oninput) input.addEventListener('input', () => o.oninput?.(input.value));
  if (o.onenter) fieldEnter.set(input, (e) => o.onenter?.(input.value, e));
  return h('div', o.mono ? 'marxy-l-fld marxy-l-mono' : 'marxy-l-fld', o.lb ? h('span', 'marxy-l-lb', o.lb) : null, input, o.right ?? null);
}
const fieldEnter = new WeakMap<HTMLInputElement, (e: KeyboardEvent) => void>();
export const enterOf = (input: HTMLInputElement): ((e: KeyboardEvent) => void) | undefined => fieldEnter.get(input);

export const stack = (...fields: HTMLElement[]): HTMLElement => h('div', 'marxy-l-stack', ...fields);

/** A segmented choice; items are ids or `[id, label]`. */
export function sg(items: readonly (string | readonly [string, string])[], on: string, pick: (id: string) => void, name?: string): HTMLElement {
  const group = h(
    'span',
    'marxy-l-sg',
    ...items.map((x) => {
      const [id, label] = typeof x === 'string' ? [x, x] : x;
      const b = h('button', id === on ? 'marxy-l-on' : '', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(id === on));
      b.addEventListener('click', () => pick(id));
      return b;
    }),
  );
  group.setAttribute('role', 'group');
  if (name) group.setAttribute('aria-label', name);
  return group;
}

export interface ButtonSpec {
  readonly label: string;
  readonly pri?: boolean;
  readonly title?: string;
  run(e: MouseEvent): void;
}

export function btns(...list: (ButtonSpec | null | false)[]): HTMLElement {
  return h(
    'div',
    'marxy-l-btns',
    ...list.filter((x): x is ButtonSpec => !!x).map((x) => {
      const b = button(x.label, { kind: x.pri ? 'primary' : undefined, size: 'compact', className: x.pri ? 'marxy-l-pri' : undefined });
      if (x.title) b.title = x.title;
      b.addEventListener('click', (e) => x.run(e));
      return b;
    }),
  );
}

export const tool = (...kids: Kid[]): HTMLElement => h('div', 'marxy-l-tool', ...kids);
export const lab = (text: string): HTMLElement => h('span', 'marxy-l-lab', text);
export const hint = (text: string): HTMLElement => h('div', 'marxy-l-hint', text);
export const empty = (text: string): HTMLElement => h('div', 'marxy-l-empty', text);
/** A large line and a smaller one under it; `small` may be a node with a guessed part in the accent (`mark`'s). */
export const hero = (big: string, small?: string | Node, quiet?: boolean): HTMLElement =>
  h('div', quiet ? 'marxy-l-hero marxy-l-none' : 'marxy-l-hero', h('div', 'marxy-l-k1', big), h('div', 'marxy-l-k2', small ?? ''));
export const ck = (on: boolean): HTMLElement => h('span', on ? 'marxy-l-ck marxy-l-on' : 'marxy-l-ck');
export const rd = (on: boolean): HTMLElement => h('span', on ? 'marxy-l-rd marxy-l-on' : 'marxy-l-rd');

export function tog(on: boolean, flip: () => void, label?: string): HTMLElement {
  const b = h('button', on ? 'marxy-l-tog marxy-l-on' : 'marxy-l-tog');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  if (label) b.setAttribute('aria-label', label);
  b.setAttribute('aria-checked', String(on));
  b.addEventListener('click', flip);
  return b;
}

/** A hit: a line number and its text (a node, so `mark` can mark the words). */
export function hit(no: string | number, text: string | Node, o?: RowOptions): HTMLElement {
  const el = h('div', 'marxy-l-hit', h('span', 'marxy-l-no', String(no)), h('span', 'marxy-l-tx', text));
  return live(el, o ?? {});
}

/**
 * Where `words` occur in `text`, any case, as ranges of `text` itself. Lowered a character at a time with each lowered unit
 * kept against its character: İ lowers to two units, and offsets into the lowered string would shift the rest.
 */
export function markRanges(text: string, words: readonly string[]): [number, number][] {
  const lower = (s: string): { low: string; from: number[]; to: number[] } => {
    let low = '';
    const from: number[] = [];
    const to: number[] = [];
    for (let k = 0; k < s.length; ) {
      const n = s.codePointAt(k)! > 0xffff ? 2 : 1;
      const lc = s.slice(k, k + n).toLowerCase();
      for (let u = 0; u < lc.length; u++) {
        from.push(k);
        to.push(k + n);
      }
      low += lc;
      k += n;
    }
    return { low, from, to };
  };
  const want = words.filter(Boolean).map((w) => lower(w).low);
  const out: [number, number][] = [];
  if (want.length === 0) return out;
  const { low, from, to } = lower(text);
  let i = 0;
  while (i < low.length) {
    let at = -1;
    let len = 0;
    for (const w of want) {
      const j = low.indexOf(w, i);
      if (j !== -1 && (at === -1 || j < at || (j === at && w.length > len))) {
        at = j;
        len = w.length;
      }
    }
    if (at === -1) break;
    const start = Math.max(from[at]!, out.length > 0 ? out[out.length - 1]![1] : 0);
    const end = to[at + len - 1]!;
    if (end > start) out.push([start, end]);
    i = at + len;
  }
  return out;
}

/** `text` with every case-insensitive occurrence of `words` in a <mark>. */
export function mark(text: string, words: readonly string[]): HTMLElement {
  const out = h('span', '');
  let i = 0;
  for (const [a, b] of markRanges(text, words)) {
    if (a > i) out.append(markedNode(text.slice(i, a)));
    out.append(h('mark', 'marxy-l-mark', markedNode(text.slice(a, b))));
    i = b;
  }
  // Names are drawn as written: a character that reorders or hides the rest is shown.
  if (i < text.length) out.append(markedNode(text.slice(i)));
  return out;
}

export const mono = (text: string): HTMLElement => h('span', 'marxy-l-mono', text);

/** A key cap, as the verb bar draws one. */
export const key = (text: string): HTMLElement => h('span', 'marxy-l-key', text);

/**
 * Brings `el` into view inside the drawer's body only. `scrollIntoView` would scroll every ancestor, the page's window
 * among them, and a page scrolled is a place moved (layout.json is written for it). `auto` is nearest for a row within a
 * view's height of the view, else center: a far jump lands with rows on both sides of it.
 */
export function scrollWithin(el: HTMLElement, block: 'nearest' | 'center' | 'auto' = 'nearest'): void {
  const box = el.closest<HTMLElement>('.marxy-l-body');
  if (!box) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  if (block === 'auto') block = r.bottom < b.top - b.height || r.top > b.bottom + b.height ? 'center' : 'nearest';
  if (block === 'center') box.scrollTop += r.top - b.top - (b.height - r.height) / 2;
  else if (r.top < b.top) box.scrollTop += r.top - b.top;
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
}

export { h };
