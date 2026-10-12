// The column ruler of the Source frame (V-05): a tick for every fifth column, taller for every tenth, numbers every
// tenth, the caret's column as a notch and a selection on one line as a bar. It sits on the editor's character grid:
// every position is a number of `ch` of the same face and size as the text, so tick N is under character N whatever the
// reader's size, and a tick is centred on its character. It scrolls with the text, because it is placed from where the
// text begins (read from the editor, not remembered). Lazy: only the columns in view are drawn, so a line of ten
// thousand columns costs the same as one of eighty. Display only: it reads the editor and never writes to it.

import type { EditorView } from '@codemirror/view';

/** Columns drawn beyond each edge, so a small scroll does not rebuild the ticks. */
const MARGIN = 60;
/** A number is left out when it would sit closer than this many columns to the right edge. */
const EDGE_CLEAR = 3;

export interface Ruler {
  readonly element: HTMLElement;
  /** Re-reads the editor and redraws: on a scroll, a resize, a new selection or a new document. */
  update(): void;
  destroy(): void;
}

interface Reading {
  readonly clipLeft: number;
  readonly clipWidth: number;
  readonly origin: number;
  readonly cw: number;
  readonly caret: number | null;
  readonly span: { readonly from: number; readonly to: number } | null;
}

function node(className: string): HTMLElement {
  const el = document.createElement('i');
  el.className = className;
  return el;
}

export function createRuler(view: EditorView): Ruler {
  const element = document.createElement('div');
  element.className = 'marxy-source-ruler';
  // Display only, and the same facts are in the bottom bar as words.
  element.setAttribute('aria-hidden', 'true');
  const clip = document.createElement('div');
  clip.className = 'marxy-source-ruler-clip';
  const probe = node('marxy-source-ruler-probe');
  const ticks = document.createElement('div');
  ticks.className = 'marxy-source-ruler-ticks';
  const caret = node('marxy-source-ruler-caret');
  const span = node('marxy-source-ruler-span');
  caret.hidden = true;
  span.hidden = true;
  clip.append(probe, ticks, span, caret);
  element.append(clip);

  let destroyed = false;
  /** The first and last column (inclusive) the ticks hold. */
  let built: { from: number; to: number; cw: number } | null = null;
  const measureKey = {};

  const buildTicks = (first: number, last: number, cw: number): void => {
    const from = Math.max(5, Math.floor((first - MARGIN) / 10) * 10);
    const to = last + MARGIN;
    const frag = document.createDocumentFragment();
    for (let col = Math.ceil(from / 5) * 5; col <= to; col += 5) {
      const tick = node(col % 10 === 0 ? 'marxy-source-ruler-tick marxy-source-ruler-tick-major' : 'marxy-source-ruler-tick');
      tick.style.setProperty('--marxy-col', String(col));
      if (col % 10 === 0) {
        const num = document.createElement('span');
        num.className = 'marxy-source-ruler-num';
        num.textContent = String(col);
        tick.append(num);
      }
      frag.append(tick);
    }
    ticks.replaceChildren(frag);
    built = { from, to, cw };
  };

  const read = (): Reading | null => {
    if (destroyed || element.clientWidth === 0) return null;
    const ruler = element.getBoundingClientRect();
    const gutters = view.dom.querySelector('.cm-gutters');
    const edge = gutters instanceof HTMLElement && gutters.offsetWidth > 0 ? gutters.getBoundingClientRect().right : view.scrollDOM.getBoundingClientRect().left;
    const clipLeft = Math.max(0, edge - ruler.left);
    const clipWidth = ruler.width - clipLeft;
    if (clipWidth <= 0) return null;
    const cw = probe.getBoundingClientRect().width;
    if (!(cw > 0)) return null;
    const origin = view.contentDOM.getBoundingClientRect().left - (ruler.left + clipLeft);
    const { main } = view.state.selection;
    const here = view.coordsAtPos(main.head);
    const sameLine = !main.empty && view.state.doc.lineAt(main.from).number === view.state.doc.lineAt(main.to).number;
    const a = sameLine ? view.coordsAtPos(main.from) : null;
    const b = sameLine ? view.coordsAtPos(main.to) : null;
    const left = ruler.left + clipLeft;
    return {
      clipLeft,
      clipWidth,
      origin,
      cw,
      caret: here === null ? null : here.left - left,
      span: a !== null && b !== null ? { from: Math.min(a.left, b.left) - left, to: Math.max(a.left, b.left) - left } : null,
    };
  };

  const write = (r: Reading | null): void => {
    if (r === null || destroyed) return;
    clip.style.left = `${r.clipLeft}px`;
    ticks.style.left = `${r.origin}px`;
    // Columns in view, 1-based: character N spans [(N-1) cw, N cw) from the text's start.
    const first = Math.max(1, Math.floor(-r.origin / r.cw));
    const last = Math.ceil((r.clipWidth - r.origin) / r.cw);
    if (built === null || built.cw !== r.cw || (first < built.from && built.from > 5) || last > built.to) {
      buildTicks(first, last, r.cw);
    }
    // A number never sits against the right edge: it is cut off there, so it is not drawn within a few columns of it.
    const clear = (r.clipWidth - r.origin) / r.cw - EDGE_CLEAR;
    for (const num of ticks.querySelectorAll<HTMLElement>('.marxy-source-ruler-num')) {
      const col = Number(num.textContent);
      num.hidden = col > clear;
    }
    // The caret's column: a notch centred on the character after the caret, so on its column's tick grid.
    if (r.caret === null) caret.hidden = true;
    else {
      caret.hidden = false;
      caret.style.left = `${r.caret + r.cw / 2}px`;
    }
    if (r.span === null) span.hidden = true;
    else {
      span.hidden = false;
      span.style.left = `${r.span.from}px`;
      span.style.width = `${r.span.to - r.span.from}px`;
    }
  };

  const update = (): void => {
    if (destroyed) return;
    view.requestMeasure({ key: measureKey, read, write });
  };

  const onScroll = (): void => update();
  view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => update());
  observer?.observe(element);

  return {
    element,
    update,
    destroy() {
      destroyed = true;
      view.scrollDOM.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    },
  };
}
