// Whether the window holds two columns at the typography floor (D-07; ADR-0033's 45 characters, D-02's
// arithmetic). The numbers are read from the page, the same ones the divider clamps with; the refusal
// names the width worked out from them, never a typed one.

import { fitsTwoColumns, minSplitWidth, type SplitMetrics } from '@marxy/core/src/layout/index.ts';
import { splitMetrics } from './divider.ts';
import type { PaneContent, PaneSet } from './pane-set.ts';

/** The theme's average character, the body size and the column gutter, read from the page now. */
export function readSplitMetrics(main: HTMLElement): SplitMetrics {
  return splitMetrics(main);
}

/** Whether `main` is wide enough to show two panes side by side. */
export function canShowTwoColumns(main: HTMLElement): boolean {
  return fitsTwoColumns(main.clientWidth, readSplitMetrics(main));
}

/** What the reader is told when a second pane would not fit: the narrowest window, in whole pixels. */
export function splitFitNotice(main: HTMLElement): string {
  const width = Math.floor(minSplitWidth(readSplitMetrics(main)));
  return `Marxy needs a window at least ${width} px wide to show two documents side by side.`;
}

/**
 * Why a second pane cannot be made now, or null: with a second pane already open nothing is refused (the
 * other pane's document is replaced), and with one the window must hold two columns.
 */
export function splitRefusal<C extends PaneContent>(panes: PaneSet<C>): string | null {
  if (panes.panes.length > 1) return null;
  const main = panes.panes[0]?.host.parentElement;
  if (!main || canShowTwoColumns(main)) return null;
  return splitFitNotice(main);
}
