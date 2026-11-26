// Compare: the canvas split down a seam that can be dragged. Left of it
// the look as it was when the Studio opened, right of it the look now: two stacked leaves of the same text, the top one
// (before) clipped, both kept on the same words.
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { el } from '../frame/dom.ts';
import type { Leaf, StudioPiece } from './context.ts';
import css from './compare.css?inline';

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

/** The block of `leaf` holding the line at `y` (logical px from the scroller's top), and how far down it `y` falls. */
function blockAt(leaf: Leaf, y: number): { readonly i: number; readonly f: number } | null {
  const kids = leaf.article.children;
  for (let i = 0; i < kids.length; i++) {
    const b = kids[i] as HTMLElement;
    const top = b.offsetTop;
    const h = b.offsetHeight || 1;
    if (top + h > y) return { i, f: clamp((y - top) / h, 0, 1) };
  }
  return null;
}

export const mountCompare: StudioPiece = (paper, ctx) => {
  adoptRuntimeSheet(document, 'marxy-studio-compare-style', css);
  const now = ctx.canvas();
  if (!now) return () => {};
  const v = ctx.view();
  const before = ctx.makeLeaf(v.kind, { lang: v.lang ?? undefined });
  before.el.classList.add('marxy-studio-compare-before');
  before.el.setAttribute('aria-label', 'Before: the look as it was when the Studio opened');
  const seam = el('div', 'marxy-studio-compare-seam');
  seam.setAttribute('role', 'separator');
  seam.setAttribute('aria-orientation', 'vertical');
  seam.setAttribute('aria-label', 'The seam between before and now');
  seam.tabIndex = 0;
  seam.title = 'Drag to move the seam';
  seam.append(el('span', 'marxy-studio-compare-grip'));
  const labelBefore = el('span', 'marxy-studio-compare-label marxy-studio-compare-label-l', 'Before');
  const labelNow = el('span', 'marxy-studio-compare-label marxy-studio-compare-label-r', 'Now');
  paper.classList.add('marxy-studio-compare');
  paper.append(before.el, seam, labelBefore, labelNow);

  let at = 0.5;
  function place(): void {
    seam.style.left = `${(at * 100).toFixed(2)}%`;
    before.el.style.clipPath = `inset(0 ${((1 - at) * 100).toFixed(2)}% 0 0)`;
    seam.setAttribute('aria-valuenow', String(Math.round(at * 100)));
  }

  // One side scrolled moves the other to the same words; the echo of that move is ignored.
  let echo: { el: HTMLElement; t: number } | null = null;
  function align(from: Leaf, to: Leaf): void {
    const mid = from.scroller.clientHeight / 2;
    const y = from.scroller.scrollTop + mid;
    const b = blockAt(from, y);
    const target = b ? (to.article.children[b.i] as HTMLElement | undefined) : undefined;
    const ty = (b && target ? target.offsetTop + b.f * target.offsetHeight : y) - mid;
    if (Math.abs(to.scroller.scrollTop - ty) < 1) return;
    echo = { el: to.scroller, t: performance.now() };
    to.scroller.scrollTop = ty;
  }
  const onScroll = (from: Leaf, to: Leaf) => (): void => {
    if (echo?.el === from.scroller && performance.now() - echo.t < 100) return;
    align(from, to);
  };
  const nowScroll = onScroll(now, before);
  const beforeScroll = onScroll(before, now);
  now.scroller.addEventListener('scroll', nowScroll, { passive: true });
  before.scroller.addEventListener('scroll', beforeScroll, { passive: true });

  const move = (e: PointerEvent): void => {
    const r = paper.getBoundingClientRect();
    if (r.width > 0) at = clamp((e.clientX - r.left) / r.width, 0.03, 0.97);
    place();
  };
  const up = (): void => {
    seam.removeAttribute('data-marxy-held');
    seam.removeEventListener('pointermove', move);
    seam.removeEventListener('pointerup', up);
    seam.removeEventListener('pointercancel', up);
  };
  seam.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      seam.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer has nothing to capture */
    }
    seam.setAttribute('data-marxy-held', '');
    seam.addEventListener('pointermove', move);
    seam.addEventListener('pointerup', up);
    seam.addEventListener('pointercancel', up);
    move(e);
  });
  seam.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : 0;
    if (!d) return;
    e.preventDefault();
    at = clamp(at + d, 0.03, 0.97);
    place();
  });

  function paint(): void {
    // The frame sizes and scales the canvas leaf; the before leaf stands exactly on it.
    before.el.style.width = now!.el.style.width;
    before.el.style.height = now!.el.style.height;
    before.el.style.transform = now!.el.style.transform;
    const o = ctx.opened();
    if (o.theme) {
      // The theme painted the page when the Studio opened: before is the theme as it was, whatever the scheme now.
      for (const [k, v] of Object.entries(o.theme)) if (before.el.style.getPropertyValue(k) !== v) before.el.style.setProperty(k, v);
      const kind = ctx.canvasContext().kind;
      if (kind) before.el.setAttribute('data-marxy-kind', kind);
    } else ctx.paint(before.el, ctx.canvasContext(), { id: o.id, tweaks: o.tweaks, scheme: ctx.view().scheme });
    align(now!, before);
  }
  const off = ctx.onPaint(paint);
  void before.ready.then(paint);
  place();
  paint();

  return () => {
    off();
    up();
    now.scroller.removeEventListener('scroll', nowScroll);
    before.scroller.removeEventListener('scroll', beforeScroll);
    paper.classList.remove('marxy-studio-compare');
    before.el.remove();
    seam.remove();
    labelBefore.remove();
    labelNow.remove();
  };
};
