// The hairline between two panes (D-04; ADR-0057): one 1 px line, no handle, no label and no layout
// width. It exists exactly while two panes do (`PaneSet.onSplit`). Dragging it, the arrow keys on it and
// the palette's split commands all go through `PaneSet.setRatio`, clamped so neither column drops below
// the 45-character floor (`clampRatio`, D-02). Double-click and "Even split" make the
// panes even; Home does the same (there is no End). Arrow keys and Home are the whole keyboard.
// How it looks is `.marxy-divider` in the theme's base.css and three `--marxy-*` tokens.

import { DEFAULT_RATIO, clampRatio, type SplitMetrics } from '@marxy/core/src/layout/index.ts';
import type { PaneContent, PaneSet } from './pane-set.ts';

/** How far one arrow key or one palette step moves the divider, as a share of the window. */
export const RATIO_STEP = 0.05;

/** The typography the clamp is measured in, read from the page: the theme's average character, body size and gutter. */
export function splitMetrics(main: HTMLElement): SplitMetrics {
  const root = getComputedStyle(document.documentElement);
  const article = main.querySelector<HTMLElement>('.marxy-pane .marxy-article');
  const gutter = article ? parseFloat(getComputedStyle(article).paddingLeft) : NaN;
  return {
    avgChar: parseFloat(root.getPropertyValue('--marxy-avg-char')),
    bodyPx: parseFloat(root.getPropertyValue('--marxy-size-body')),
    gutterPx: Number.isFinite(gutter) ? gutter : 0,
  };
}

/** `ratio` held to the floor for `main`'s width now. */
export function clampToMain(main: HTMLElement, ratio: number): number {
  return clampRatio(ratio, main.getBoundingClientRect().width, splitMetrics(main));
}

export function createDivider<C extends PaneContent>(panes: PaneSet<C>, main: HTMLElement): { el: HTMLElement; destroy(): void } {
  const el = document.createElement('div');
  el.className = 'marxy-divider';
  el.setAttribute('role', 'separator');
  el.setAttribute('aria-orientation', 'vertical');
  el.setAttribute('aria-label', 'Resize panes');
  el.tabIndex = 0;

  const place = (): void => {
    // The left pane's share of the window, 0 to 100. The floor is not advertised: it depends on each
    // column's own gutter, so it is not one stable number. `aria-valuenow` is clamped into the range anyway.
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', '100');
    el.style.left = `${panes.ratio * 100}%`;
    el.setAttribute('aria-valuenow', String(Math.min(100, Math.max(0, Math.round(panes.ratio * 100)))));
  };
  const set = (ratio: number): void => panes.setRatio(clampToMain(main, ratio));

  let dragging: number | null = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = e.pointerId;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (dragging !== e.pointerId) return;
    const rect = main.getBoundingClientRect();
    set((e.clientX - rect.left) / rect.width);
  });
  const release = (e: PointerEvent): void => {
    if (dragging !== e.pointerId) return;
    dragging = null;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('dblclick', () => set(DEFAULT_RATIO));
  el.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Home evens the panes rather than going to the smallest column (the APG splitter's Home). The floor
    // depends on the column's own gutter (24 px or 16 px with its width), so a fixed minimum is not stable:
    // pressed twice it would move again. Evening is a fixed point, and matches double-click.
    const next = e.key === 'ArrowLeft' ? panes.ratio - RATIO_STEP : e.key === 'ArrowRight' ? panes.ratio + RATIO_STEP : e.key === 'Home' ? DEFAULT_RATIO : null;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    set(next);
  });

  // In DOM order between the panes, so Tab reaches it at the boundary it sits on (WCAG 2.4.3).
  main.insertBefore(el, panes.panes[1]?.host ?? null);
  place();
  const onResize = (): void => place();
  window.addEventListener('resize', onResize);
  const off = panes.onChange((e) => {
    if (e.kind === 'ratio') place();
  });
  return {
    el,
    destroy() {
      off();
      window.removeEventListener('resize', onResize);
      el.remove();
    },
  };
}
