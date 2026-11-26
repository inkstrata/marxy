// Small DOM makers the frame's branches and cards share.
import { icon } from './icons.ts';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function btn(className: string, text: string, onClick: (e: MouseEvent) => void, label?: string): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

/** A drawer section: a small capitals label (with an optional quiet note at its right) over its rows. */
export function section(label: string, note?: string | Node): { readonly root: HTMLElement; readonly head: HTMLElement } {
  const root = el('section', 'marxy-dsec');
  const head = el('div', 'marxy-dlab');
  head.append(el('span', '', label));
  if (note !== undefined) head.append(typeof note === 'string' ? el('small', '', note) : note);
  root.append(head);
  return { root, head };
}

/** A key and its value, as the panel's fact rows read. */
export function factRow(key: string, value: string | Node, title?: string): HTMLElement {
  const row = el('div', 'marxy-fact');
  const v = el('span', 'marxy-fact-v');
  if (typeof value === 'string') v.textContent = value;
  else v.append(value);
  if (title) v.title = title;
  row.append(el('span', 'marxy-fact-k', key), v);
  return row;
}

/** A switch: a button that is a checkbox. */
export function toggle(label: string, on: boolean, set: (on: boolean) => void): HTMLButtonElement {
  const b = el('button', 'marxy-switch');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(on));
  b.setAttribute('aria-label', label);
  b.addEventListener('click', () => {
    const next = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(next));
    set(next);
  });
  return b;
}

/** A row of choices, one pressed. */
export function segmented<T extends string>(label: string, options: readonly (readonly [T, string])[], value: T, set: (v: T) => void): HTMLElement {
  const seg = el('div', 'marxy-seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', label);
  for (const [v, text] of options) {
    const b = el('button', '', text);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(v === value));
    b.addEventListener('click', () => {
      for (const other of seg.children) other.setAttribute('aria-checked', String(other === b));
      set(v);
    });
    seg.append(b);
  }
  return seg;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** An overlay gone: focus back where it was when the overlay came, else to `fallback` (a pane), never to <body>. */
export function returnFocus(before: Element | null, fallback: HTMLElement): void {
  const to = before instanceof HTMLElement && before !== document.body && before.isConnected ? before : fallback;
  to.focus({ preventScroll: true });
}

export interface ButtonOptions {
  readonly kind?: 'primary' | 'quiet' | 'danger' | 'icon' | 'link';
  readonly size?: 'compact';
  /** A hook class for tests and layout; it carries no look. */
  readonly className?: string;
  readonly title?: string;
  readonly onClick?: (e: MouseEvent) => void;
}

/** The one button: the look is the theme's `.marxy-btn`, picked by kind and size. Build every button with this. */
export function button(label: string, opts: ButtonOptions = {}): HTMLButtonElement {
  const b = el('button', opts.className ? `marxy-btn ${opts.className}` : 'marxy-btn', label);
  b.type = 'button';
  if (opts.kind) b.dataset.marxyBtn = opts.kind;
  if (opts.size) b.dataset.marxySize = opts.size;
  if (opts.title) b.title = opts.title;
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}

/** An icon-only close; `label` is what a screen reader hears and `title` the tooltip. */
export function closeButton(label: string, opts: Omit<ButtonOptions, 'kind' | 'size'> = {}): HTMLButtonElement {
  const b = button('', { ...opts, kind: 'icon', size: 'compact' });
  b.setAttribute('aria-label', label);
  b.append(icon('close'));
  return b;
}
