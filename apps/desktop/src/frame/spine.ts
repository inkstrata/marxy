// The spine: a narrow map along a pane's right edge in Rendered, in place of the scrollbar. Ticks for
// headings by level, the view as a thumb to drag, a mark for the cursor's part, marks for find's hits while find is
// open; a press goes there. Every place comes from bytes through the block list (spine-map.ts), never from measuring
// the page, so a long page costs a binary search per mark. Later slices add their own marks with
// `spineMarks(pane).set(kind, ranges)`.
import { appHandle } from '../commands/app-handle.ts';
import { findAll } from '../find/text-index.ts';
import { walkText } from '../find/walk.ts';
import { activeFind } from '../find/view.ts';
import { headingsOf } from './crumbs.ts';
import { scrollTopAt, spineFraction, thumbOf, type SpineGeometry } from './spine-map.ts';
import type { FramePane } from './types.ts';

/** A span of the document's bytes a mark stands for; a mark is drawn at its start. */
export interface SpineRange {
  readonly start: number;
  readonly end?: number;
}

export interface SpineMarks {
  /** Puts `kind`'s marks on the spine in place of the ones it had; an empty list takes them away. */
  set(kind: string, ranges: readonly SpineRange[]): void;
}

interface Spine extends SpineMarks {
  readonly el: HTMLElement;
  draw(): void;
  destroy(): void;
}

/** The deepest heading level drawn as a tick, and the most marks of one kind. */
const TICK_LEVELS = 4;
const MARKS_MAX = 600;
const TICKS_MAX = 2000;
const FULL_MS = 120;

const spines = new WeakMap<Element, Spine>();
/** Marks set before the pane's spine was made wait for it. */
const waiting = new WeakMap<Element, Map<string, readonly SpineRange[]>>();

/** The spine of `pane`, for marks of a kind of one's own. */
export function spineMarks(pane: Pick<FramePane, 'host'>): SpineMarks {
  return {
    set(kind, ranges) {
      const spine = spines.get(pane.host);
      if (spine) spine.set(kind, ranges);
      else {
        const w = waiting.get(pane.host) ?? new Map<string, readonly SpineRange[]>();
        w.set(kind, ranges);
        waiting.set(pane.host, w);
      }
    },
  };
}

const div = (className: string): HTMLElement => {
  const d = document.createElement('div');
  d.className = className;
  return d;
};

export function mountSpine(pane: FramePane): { destroy(): void; draw(): void } {
  const el = div('marxy-spine');
  el.setAttribute('aria-hidden', 'true');
  const thumb = div('marxy-spine-thumb');
  const layer = div('marxy-spine-layer');
  el.append(layer, thumb);
  // Before the notices region, which must stay the pane's last child to pin to its foot (pane/dom.ts).
  pane.host.insertBefore(el, pane.host.querySelector(':scope > [role="status"]'));
  const kinds = new Map<string, readonly SpineRange[]>(waiting.get(pane.host) ?? []);
  waiting.delete(pane.host);
  let ticks: { frac: number; text: string }[] = [];
  let tip: HTMLElement | null = null;

  const scroller = (): HTMLElement => pane.view.scroller;
  const shownIn = (): boolean => pane.path() !== null && pane.view.mode === 'rendered' && pane.view.viewer() === null && pane.view.document() !== null;

  function geometry(): SpineGeometry {
    const s = scroller();
    const top = s === document.documentElement ? 0 : s.getBoundingClientRect().top + s.clientTop;
    const offset = pane.article.getBoundingClientRect().top - top + s.scrollTop;
    const store = pane.content.store();
    const total = store?.snapshot().buffer.bytes.length ?? 0;
    const blocks = pane.view.blocks();
    let mounted = total;
    for (let n = pane.article.lastElementChild; n !== null; n = n.previousElementSibling) {
      const end = n.getAttribute('data-marxy-e');
      if (end !== null) {
        mounted = Math.min(total, Number(end));
        break;
      }
    }
    return { blocks, offset: Number.isFinite(offset) ? offset : 0, scrollHeight: s.scrollHeight, totalBytes: total, mountedBytes: mounted };
  }

  function viewHeight(): number {
    const s = scroller();
    return s === document.documentElement ? window.innerHeight : s.clientHeight;
  }

  /** Over the pane's right edge, from under its head to the bottom of what is seen of it. */
  function place(): void {
    const host = pane.host.getBoundingClientRect();
    const head = pane.host.querySelector(':scope > .marxy-head')?.getBoundingClientRect();
    const top = Math.max(0, head ? head.bottom : host.top);
    const bottom = Math.min(window.innerHeight, host.bottom);
    // The minimap (a proposal) keeps the pane's very edge; the spine sits just inside it.
    const map = [...document.querySelectorAll<HTMLElement>('.marxy-mmap')].map((m) => m.getBoundingClientRect()).find((b) => b.width > 0 && Math.abs(b.right - host.right) < 2);
    // Written only when changed: a style write that changes nothing still wakes every observer of the attribute.
    setStyle(el, 'left', `${Math.round((map ? map.left : host.right) - 18)}px`);
    setStyle(el, 'top', `${Math.round(top)}px`);
    setStyle(el, 'height', `${Math.max(0, Math.round(bottom - top))}px`);
  }

  // What was last written, since the style reads back normalised ("50.000%" as "50%") and would never compare equal.
  const written = new Map<string, string>();
  function setStyle(target: HTMLElement, property: 'left' | 'top' | 'height', value: string): void {
    const key = `${target === thumb ? 'thumb' : 'el'}.${property}`;
    if (written.get(key) === value) return;
    written.set(key, value);
    target.style[property] = value;
  }

  function placeThumb(g: SpineGeometry = geometry()): void {
    place();
    const t = thumbOf(g, scroller().scrollTop, viewHeight());
    setStyle(thumb, 'top', `${(t.top * 100).toFixed(3)}%`);
    setStyle(thumb, 'height', `${(t.size * 100).toFixed(3)}%`);
    const hidden = t.size >= 0.999;
    if (thumb.hidden !== hidden) thumb.hidden = hidden;
  }

  function put(kind: string, frac: number, extra?: (m: HTMLElement) => void): void {
    const m = div(kind === 'tick' ? 'marxy-spine-tick' : 'marxy-spine-mark');
    m.style.top = `${(frac * 100).toFixed(3)}%`;
    if (kind !== 'tick') m.setAttribute('data-marxy-mark', kind);
    extra?.(m);
    layer.append(m);
  }

  function draw(): void {
    el.hidden = !shownIn();
    pane.host.toggleAttribute('data-marxy-spine', !el.hidden);
    layer.replaceChildren();
    ticks = [];
    if (el.hidden) return;
    const g = geometry();
    const frac = (byte: number): number => spineFraction(g, byte);
    // Past TICKS_MAX headings, one tick per pixel row of the spine, the outermost heading's: a page of ten thousand drew
    // ten thousand nodes, and laying them out and taking them away again held the window for half a second.
    const rows = Math.max(1, Math.round(el.clientHeight || 1000));
    const all: { frac: number; level: number }[] = [];
    const drawn = new Map<number, { frac: number; level: number }>();
    // Never the parse's first ask: a code file's waits for Rendered.
    for (const h of pane.content.store()?.parsed() ? headingsOf(pane.view.document()?.ast) : []) {
      if (h.level > TICK_LEVELS) continue;
      const f = frac(h.start);
      ticks.push({ frac: f, text: h.text });
      all.push({ frac: f, level: h.level });
      const row = Math.round(f * rows);
      const had = drawn.get(row);
      if (!had || h.level < had.level) drawn.set(row, { frac: had?.frac ?? f, level: h.level });
    }
    for (const t of all.length > TICKS_MAX ? drawn.values() : all) put('tick', t.frac, (m) => m.setAttribute('data-marxy-level', String(t.level)));
    for (const [kind, ranges] of kinds) for (const r of ranges.slice(0, MARKS_MAX)) put(kind, frac(r.start));
    const at = cursorStart();
    if (at !== null) put('cursor', frac(at));
    placeThumb(g);
  }

  // A drag on the spine moves the page under it; a press goes there.
  const go = (e: PointerEvent): void => {
    const box = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientY - box.top) / Math.max(1, box.height)));
    scroller().scrollTop = scrollTopAt(geometry(), f, viewHeight());
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    el.setAttribute('data-marxy-dragging', '');
    go(e);
    const move = (ev: PointerEvent): void => go(ev);
    const up = (): void => {
      el.removeAttribute('data-marxy-dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  // The heading at the pointer, said beside the spine.
  el.addEventListener('pointermove', (e) => {
    if (el.hasAttribute('data-marxy-dragging')) return;
    const box = el.getBoundingClientRect();
    const f = (e.clientY - box.top) / Math.max(1, box.height);
    let text: string | null = null;
    for (const t of ticks) if (t.frac <= f + 3 / Math.max(1, box.height)) text = t.text;
    if (!text) {
      tip?.remove();
      tip = null;
      return;
    }
    tip ??= document.body.appendChild(div('marxy-spine-tip'));
    tip.textContent = text;
    tip.style.left = `${box.left - 8}px`;
    tip.style.top = `${e.clientY}px`;
  });
  el.addEventListener('pointerleave', () => {
    tip?.remove();
    tip = null;
  });

  // The thumb follows the scroll each frame; the marks follow the page as it is laid out, at most every FULL_MS (a long
  // page grows in steps while it mounts, and each step would otherwise draw every tick again).
  let queued = false;
  let fullQueued = false;
  let lastFull = 0;
  let fullTimer: ReturnType<typeof setTimeout> | undefined;
  const later = (full: boolean): void => {
    if (full) {
      const wait = lastFull + FULL_MS - performance.now();
      if (wait > 0) {
        if (fullTimer === undefined) fullTimer = setTimeout(() => {
          fullTimer = undefined;
          later(true);
        }, wait);
        return;
      }
      fullQueued = true;
    }
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (fullQueued) {
        fullQueued = false;
        lastFull = performance.now();
        draw();
      } else if (!el.hidden) placeThumb();
    });
  };
  const onScroll = (e: Event): void => {
    const t = e.target;
    if (t === document ? scroller() === document.documentElement : t === scroller()) later(false);
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  // Placed at once, marks later: a divider drag resizes the pane on every move, and the spine trailed it by FULL_MS.
  const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    if (!el.hidden) place();
    later(true);
  });
  resized?.observe(pane.article);
  resized?.observe(pane.host);
  // A drawer opening moves a pane without resizing it, which no ResizeObserver hears. The frame writes its lengths on
  // <body> and eases the move (frame.css, 0.28 s), so the spine is placed again each frame of it.
  let until = 0;
  let tracking = 0;
  const track = (): void => {
    tracking = 0;
    if (el.hidden) return;
    placeThumb();
    if (performance.now() < until) tracking = requestAnimationFrame(track);
  };
  const moved = new MutationObserver(() => {
    until = performance.now() + 400;
    if (tracking === 0) tracking = requestAnimationFrame(track);
  });
  moved.observe(document.body, { attributes: true, attributeFilter: ['style', 'data-marxy-frame', 'data-marxy-moving', 'data-marxy-drawer', 'data-marxy-left'] });
  const offDoc = pane.content.onDocumentChange(() => later(true));
  const modes = new MutationObserver(() => later(true));
  modes.observe(pane.host, { attributes: true, attributeFilter: ['data-marxy-mode', 'data-marxy-kind'] });
  if (pane.slot === 0) modes.observe(document.body, { attributes: true, attributeFilter: ['data-marxy-mode'] });
  // The cursor's part, as the selection controller holds it: only the focused pane's article has one.
  const selection = appHandle()?.selection ?? null;
  function cursorStart(): number | null {
    if (!selection || selection.article() !== pane.article) return null;
    const sel = selection.state().selection;
    return sel.kind === 'node' ? sel.node.src.start : sel.kind === 'section' || sel.kind === 'blocks' ? sel.range.start : null;
  }
  const offCursor = selection?.onChange(() => later(true)) ?? (() => {});

  // Find's hits, while find is open in this pane: found again when its query changes, as find finds them.
  let findKey = '';
  const checkFind = (): void => {
    const f = activeFind();
    const state = f && f.pane === pane && f.isOpen() ? f.state() : null;
    const key = state ? `${state.query}\n${String(state.pattern)}\n${state.count}` : '';
    if (key === findKey) return;
    findKey = key;
    const re = state?.pattern ?? null;
    if (!re) {
      spine.set('hit', []);
      return;
    }
    const walked = walkText(pane.article);
    const hits: SpineRange[] = [];
    let lastBlock: Element | null = null;
    for (const span of findAll(walked.index, re)) {
      if (hits.length >= MARKS_MAX) break;
      const node = walked.nodes[walked.index.locate(span.start).piece];
      const block = node?.parentElement?.closest('[data-marxy-s]') ?? null;
      if (!block || block === lastBlock) continue;
      lastBlock = block;
      hits.push({ start: Number(block.getAttribute('data-marxy-s')) });
    }
    spine.set('hit', hits);
  };
  let findTimer: ReturnType<typeof setTimeout> | undefined;
  const onFindInput = (): void => {
    clearTimeout(findTimer);
    findTimer = setTimeout(checkFind, 150);
  };
  document.addEventListener('input', onFindInput, true);
  document.addEventListener('keyup', onFindInput, true);

  const spine: Spine = {
    el,
    draw: () => later(true),
    set(kind, ranges) {
      if (ranges.length === 0) kinds.delete(kind);
      else kinds.set(kind, [...ranges].sort((a, b) => a.start - b.start));
      later(true);
    },
    destroy() {
      document.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('input', onFindInput, true);
      document.removeEventListener('keyup', onFindInput, true);
      clearTimeout(findTimer);
      clearTimeout(fullTimer);
      resized?.disconnect();
      moved.disconnect();
      cancelAnimationFrame(tracking);
      modes.disconnect();
      offCursor();
      offDoc();
      tip?.remove();
      pane.host.removeAttribute('data-marxy-spine');
      el.remove();
      spines.delete(pane.host);
    },
  };
  spines.set(pane.host, spine);
  later(true);
  return spine;
}
