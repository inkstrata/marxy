// What the Outline's move-section commands ask the page before they are offered: is this heading's section movable,
// and which heading row has focus. Its own module because the registry asks it (`when`) every time the palette
// lists commands, while the tab (outline-tab.ts) is read with the other panels on the first unfold (F-111).
import type { Document, Heading, Node } from '@marxy/core';
import { sectionSwapOf, type MoveDirection } from '@marxy/core/src/operations/move-section.ts';
import { walk } from '@marxy/core/src/transforms/prose.ts';
import type { DocumentStore } from '../document/store.ts';

export function headingAt(ast: Document, start: number): Heading | null {
  let found: Heading | null = null;
  walk(ast, (node: Node) => {
    if (found === null && node.type === 'heading' && node.src.start === start) found = node as Heading;
  });
  return found;
}

/** Whether the heading that starts at `start` has a sibling section to trade places with in `direction`. A cheap look, for a command's `when`. */
export function canMoveSection(store: DocumentStore, start: number, direction: MoveDirection): boolean {
  if (!store.parsed()) return false;
  const ast = store.snapshot().ast;
  const heading = headingAt(ast, start);
  return heading !== null && sectionSwapOf(ast, heading, direction) !== null;
}

/** The heading row that has focus in the Outline tab: where it starts, or null when focus is elsewhere. */
export function focusedOutlineHeading(): number | null {
  if (typeof document === 'undefined') return null;
  const row = document.activeElement?.closest?.('[data-marxy-outline-row="heading"]');
  if (!row) return null;
  const start = Number((row as HTMLElement).dataset.marxyOutlineStart);
  return Number.isInteger(start) ? start : null;
}
