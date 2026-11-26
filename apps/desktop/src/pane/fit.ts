// Whether the window holds two columns at the typography floor (45 characters, the
// arithmetic). The numbers are read from the page, the same ones the divider clamps with; the refusal
// names the width worked out from them, never a typed one.

import { fitsTwoColumns, minSplitWidth, type SplitMetrics } from '@marxy/core/src/layout/index.ts';
import { splitMetrics } from './divider.ts';
import type { PaneContent, PaneSet } from './pane-set.ts';

/** The theme's average character, the body size and the column gutter, read from the page now. */
export function readSplitMetrics(main: HTMLElement): SplitMetrics {
  return splitMetrics(main);
}

/**
 * How wide the panes' grid would be with two panes, where something lays the window out around them (the frame lets
 * its panel step aside, then lays the drawer over the page, before two columns are refused). Null: `main` as it is.
 */
let splitRoom: (() => number | null) | null = null;

export function setSplitRoom(room: (() => number | null) | null): void {
  splitRoom = room;
}

const roomFor = (main: HTMLElement): number => splitRoom?.() ?? main.clientWidth;

/** Whether `main` is wide enough to show two panes side by side. */
export function canShowTwoColumns(main: HTMLElement): boolean {
  return fitsTwoColumns(roomFor(main), readSplitMetrics(main));
}

/**
 * What the reader is told when a second pane would not fit: the narrowest window, in whole pixels, counting what the
 * window holds beside the panes.
 */
export function splitFitNotice(main: HTMLElement): string {
  const beside = Math.max(0, window.innerWidth - roomFor(main));
  const width = Math.floor(minSplitWidth(readSplitMetrics(main)) + beside);
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
